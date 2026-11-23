// Máy chủ game: phục vụ file client (HTTP) + WebSocket cho multiplayer trên CÙNG một port.
//   node server/index.js [--port 3000] [--host 0.0.0.0] [--upnp] [--tunnel]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { ShooterRoom } from './shooter.js';
import { CardRoom } from './cards.js';
import { playableChar } from '../shared/characters.js';
import { VERSION } from '../shared/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Tham số dòng lệnh ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const PORT = +(arg('port', process.env.PORT || 3000));
const HOST = String(arg('host', process.env.HOST || '0.0.0.0'));
const USE_UPNP = !!arg('upnp', false);
const USE_TUNNEL = !!arg('tunnel', false);

const publicInfo = { version: VERSION, port: PORT, lan: [], publicUrl: null, note: null };

// ---------- HTTP tĩnh ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/vendor/three/addons/', path.join(ROOT, 'node_modules/three/examples/jsm')],
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/build')],
  ['/', path.join(ROOT, 'client')],
];

function serveStatic(req, res) {
  let url;
  // đường dẫn mã hoá sai (vd. "/%") làm decodeURIComponent ném lỗi → văng cả server
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ...publicInfo, rooms: hub.roomList(), online: hub.clients.size }));
  }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    if (!file.startsWith(dir)) break; // chống path traversal
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('Not found');
}

const server = http.createServer(serveStatic);

// ---------- Hub: lobby + phòng ----------
class Hub {
  constructor() {
    this.clients = new Map(); // id -> client
    this.rooms = new Map();
    this.nextId = 1;
  }
  roomList() { return [...this.rooms.values()].map(r => r.info()); }
  roomsChanged() {
    for (const [id, r] of this.rooms) if (r.count === 0) { r.destroy(); this.rooms.delete(id); }
    const msg = JSON.stringify({ t: 'rooms', list: this.roomList() });
    for (const c of this.clients.values()) if (!c.room && c.ws.readyState === 1) c.ws.send(msg);
  }
  leaveRoom(c) {
    if (c.room) { const r = c.room; c.room = null; r.remove(c.id); }
  }
  onConnection(ws) {
    const c = { id: this.nextId++, ws, name: 'Player', char: 'kaze', room: null };
    this.clients.set(c.id, c);
    const send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
    send({ t: 'welcome', id: c.id, v: VERSION });
    const onMsg = raw => {
      let m;
      // bỏ khoá toString/valueOf: {"toString":1} làm String()/|0/tra bảng ném lỗi ở mọi chỗ xử lý gói tin
      try { m = JSON.parse(raw, (k, v) => (k === 'toString' || k === 'valueOf' ? undefined : v)); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      switch (m.t) {
        case 'ping': return send({ t: 'pong', c: m.c });
        case 'hello':
          c.name = String(m.name || 'Player').replace(/[<>]/g, '').slice(0, 16).trim() || 'Player';
          c.char = playableChar(m.char).id;
          return send({ t: 'rooms', list: this.roomList() });
        case 'list': return send({ t: 'rooms', list: this.roomList() });
        case 'create': {
          this.leaveRoom(c);
          const name = String(m.name || '').replace(/[<>]/g, '').slice(0, 24).trim() || `Phòng của ${c.name}`;
          const mode = ['bomb', 'dm', 'team', 'practice', 'xidach', 'tienlen'].includes(m.mode) ? m.mode : 'brawl';
          // đấu tập: phòng đối kháng có bia tập + võ sĩ máy (chơi một mình vẫn tích được thanh dị biến)
          // đánh bài: bàn tròn Xì dách / Tiến lên
          const r = mode === 'xidach' || mode === 'tienlen' ? new CardRoom(name, this, mode)
            : mode === 'brawl' || mode === 'team' || mode === 'practice' ? new Room(name, this, String(m.map || ''), mode === 'team', mode === 'practice')
            : new ShooterRoom(name, this, mode, String(m.map || ''));
          this.rooms.set(r.id, r);
          if (m.char) c.char = playableChar(m.char).id;
          r.add(c);
          return;
        }
        case 'join': {
          const r = this.rooms.get(String(m.id));
          if (!r) return send({ t: 'err', msg: 'Phòng không tồn tại nữa.' });
          if (c.room === r) return;   // đang một mình trong phòng: rời trước sẽ huỷ phòng rồi vào lại phòng đã chết
          this.leaveRoom(c);
          if (m.char) c.char = playableChar(m.char).id;
          r.add(c);
          return;
        }
        case 'leave':
          this.leaveRoom(c);
          return send({ t: 'rooms', list: this.roomList() });
        default:
          if (c.room) c.room.onMessage(c.id, m);
      }
    };
    // gói tin dị dạng làm code xử lý ném lỗi thì chỉ bỏ gói đó, không để văng cả server (mọi người bị out)
    ws.on('message', raw => {
      try { onMsg(raw); } catch (e) { if (!c.errLogged) { c.errLogged = true; console.error('[msg]', e); } }  // chỉ ghi 1 lần/kết nối, tránh spam log
    });
    ws.on('close', () => { this.leaveRoom(c); this.clients.delete(c.id); });
    ws.on('error', () => {});
    // nhịp tim: trình duyệt tự trả lời ping (kể cả khi tab bị ẩn)
    // Đồng thời đo RTT (giây) từ ping/pong của WebSocket: phòng bắn súng dùng để bù trễ khi kiểm tra trúng đạn.
    // Trình duyệt tự trả pong, client không giả được giá trị nhỏ hơn thực tế.
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      if (!ws.pingAt) return;
      const s = (performance.now() - ws.pingAt) / 1000;
      ws.pingAt = 0;
      ws.rtt = ws.rtt == null ? s : ws.rtt * 0.6 + s * 0.4;
    });
    sendPing(ws);
  }
}

const hub = new Hub();
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: {
  // Nén gói tin. Gói < 128 byte (lệnh bắn, ping…) gửi thẳng, không nén, để không thêm trễ.
  threshold: 128,
  zlibDeflateOptions: { level: 1, memLevel: 8 },
  serverNoContextTakeover: false,   // giữ từ điển giữa các gói → snapshot lặp lại nén rất tốt
  clientNoContextTakeover: true,
  concurrencyLimit: 16,
}, maxPayload: 16 * 1024 });
wss.on('connection', ws => hub.onConnection(ws));
wss.on('error', () => {});   // lỗi cổng đã do server.on('error') báo; không có listener thì process chết trước khi in thông báo
// Ngắt kết nối "ma": tải lại trang / mất mạng mà trình duyệt không kịp báo đóng.
// Không trả lời ping trong 2 lượt (~10 giây) thì cắt, người chơi rời phòng ngay.
function sendPing(ws) {
  ws.pingAt = performance.now();
  try { ws.ping(); } catch { /* bỏ qua */ }
}
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    if (!ws.pingAt) sendPing(ws);   // ping trước chưa có pong: gửi lại sẽ đo RTT từ mốc sai (quá nhỏ)
  }
}, 5000);

// ---------- Khởi động ----------
function lanAddresses() {
  // Bỏ card mạng ảo (VMware, VirtualBox, Hyper-V, WSL, Docker...) và địa chỉ 169.254.x.x
  const virtual = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|docker|loopback|bluetooth/i;
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !virtual.test(name))
    .flatMap(([, list]) => list || [])
    .filter(n => n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
    .map(n => n.address);
}

server.listen(PORT, HOST, async () => {
  const lan = HOST === '0.0.0.0' ? lanAddresses() : [];
  publicInfo.lan = lan.map(ip => `http://${ip}:${PORT}`);
  console.log(`\n=== CHIBI CLASH SERVER v${VERSION} ===`);
  console.log(`  Máy này     : http://localhost:${PORT}`);
  for (const u of publicInfo.lan) console.log(`  Mạng nội bộ : ${u}`);
  if (HOST !== '0.0.0.0') console.log('  (Chỉ chạy local. Dùng --host 0.0.0.0 để cho máy khác trong LAN vào)');

  const cleanups = [];
  if (USE_UPNP) {
    console.log('  UPnP        : đang mở port trên router...');
    try {
      const { openPort } = await import('./upnp.js');
      const r = await openPort(PORT);
      cleanups.push(r.close);
      publicInfo.publicUrl = r.externalIp ? `http://${r.externalIp}:${PORT}` : null;
      console.log(`  Internet    : ${publicInfo.publicUrl || '(đã mở port ' + PORT + ', không lấy được IP ngoài)'}`);
      console.log('                (Nếu mạng dùng CGNAT thì UPnP không đủ — hãy dùng --tunnel)');
    } catch (e) {
      publicInfo.note = 'UPnP lỗi: ' + e.message;
      console.log('  UPnP lỗi    : ' + e.message);
    }
  }
  if (USE_TUNNEL) {
    console.log('  Tunnel      : đang khởi tạo cloudflared...');
    try {
      const { startTunnel } = await import('./tunnel.js');
      const r = await startTunnel(PORT, ROOT);
      cleanups.push(r.close);
      publicInfo.publicUrl = r.url;
      console.log(`  Internet    : ${r.url}`);
    } catch (e) {
      publicInfo.note = 'Tunnel lỗi: ' + e.message;
      console.log('  Tunnel lỗi  : ' + e.message);
      console.log('                Cài cloudflared (winget install Cloudflare.cloudflared) hoặc đặt cloudflared.exe vào thư mục tools/');
    }
  }
  console.log('==========================\n');

  let closing = false;
  const shutdown = async () => {
    if (closing) return process.exit(0);
    closing = true;
    console.log('\nĐang tắt server...');
    await Promise.all(cleanups.map(f => Promise.resolve(f()).catch(() => {})));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} đang được dùng. Thử: npm start -- --port 3001`);
  else console.error(e);
  process.exit(1);
});
