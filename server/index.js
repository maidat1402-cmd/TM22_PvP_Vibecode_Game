// Máy chủ game: phục vụ file client (HTTP) + WebSocket cho multiplayer trên CÙNG một port.
//   node server/index.js [--port 3000] [--host 0.0.0.0] [--upnp] [--tunnel]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { ShooterRoom } from './shooter.js';
import { CardRoom } from './cards.js';
import { PokerRoom } from './poker.js';
import { acknowledgeSnapshot, snapshotStats } from './snapshots.js';
import { startServerLog, closeServerLog, logEvent, logError, logFatal } from './log.js';
import { CARD_GAMES } from '../shared/cards.js';
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
const LEGACY_SNAPSHOTS = arg('snapshot-policy') === 'legacy';
const COMPRESSION = arg('compression') !== 'off';
const logDir = arg('log-dir');
const logFile = arg('no-log', false) ? null : startServerLog(typeof logDir === 'string' ? logDir : path.join(ROOT, 'logs'));
if (logFile) process.on('uncaughtExceptionMonitor', logFatal);

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
  try {
    url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400); return res.end('Bad Request');
  }
  if (url.includes('\0')) { res.writeHead(400); return res.end('Bad Request'); }
  if (url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ...publicInfo, rooms: hub.roomList(), online: hub.clients.size }));
  }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    const relative = path.relative(dir, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) break;
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
    this.clients = new Set(); // các kết nối đang mở
    this.rooms = new Map();
    this.nextId = 1;
    this.legacySnapshots = LEGACY_SNAPSHOTS;
  }
  roomList() { return [...this.rooms.values()].map(r => r.info()); }
  roomsChanged() {
    for (const [id, r] of this.rooms) if (r.count === 0) { r.destroy(); this.rooms.delete(id); }
    const msg = JSON.stringify({ t: 'rooms', list: this.roomList() });
    for (const c of this.clients.values()) if (!c.room && c.ws.readyState === 1) c.ws.send(msg);
  }
  leaveRoom(c) {
    if (c.room) { const r = c.room; c.room = null; r.remove(c.id); }
    c.ws.snapshotFlow = null;
  }
  onConnection(ws) {
    const c = { id: this.nextId++, ws, name: 'Player', char: 'kaze', room: null, session: randomUUID() };
    this.clients.add(c);
    const send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
    send({ t: 'welcome', id: c.id, v: VERSION, session: c.session });
    const onMsg = raw => {
      if (ws.readyState !== 1) return;
      let m;
      // bỏ khoá toString/valueOf: {"toString":1} làm String()/|0/tra bảng ném lỗi ở mọi chỗ xử lý gói tin
      try { m = JSON.parse(raw, (k, v) => (k === 'toString' || k === 'valueOf' ? undefined : v)); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      switch (m.t) {
        case 'ping':
          return ws.send(JSON.stringify({ t: 'pong', c: m.c,
            at: m.measure === true ? Date.now() : undefined,
            queue: m.measure === true ? ws.bufferedAmount : undefined }), { compress: false });
        case 'snapAck':
          if (ws.wantsSnapAck && c.room?.id === m.room) acknowledgeSnapshot(ws, m.room, m.seq);
          return;
        case 'hello':
          ws.wantsSnapAck ||= m.snapAck === true;
          c.name = String(m.name || 'Player').replace(/[<>]/g, '').slice(0, 16).trim() || 'Player';
          c.char = playableChar(m.char).id;
          return send({ t: 'rooms', list: this.roomList() });
        case 'list': return send({ t: 'rooms', list: this.roomList() });
        case 'create': {
          this.leaveRoom(c);
          const name = String(m.name || '').replace(/[<>]/g, '').slice(0, 24).trim() || `Phòng của ${c.name}`;
          const supported = typeof m.mode === 'string' && (['bomb', 'dm', 'team', 'practice'].includes(m.mode) || Object.hasOwn(CARD_GAMES, m.mode));
          const mode = supported ? m.mode : 'brawl';
          // đấu tập: phòng đối kháng có bia tập + võ sĩ máy (chơi một mình vẫn tích được thanh dị biến)
          // đánh bài: bàn tròn Xì dách / Tiến lên / Poker
          const id = randomUUID();
          const r = mode === 'poker' ? new PokerRoom(id, name, this)
            : Object.hasOwn(CARD_GAMES, mode) ? new CardRoom(id, name, this, mode)
            : mode === 'brawl' || mode === 'team' || mode === 'practice' ? new Room(id, name, this, String(m.map || ''), mode === 'team', mode === 'practice')
            : new ShooterRoom(id, name, this, mode, String(m.map || ''));
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
        case 'cresume': {
          if (c.room) return;
          const room = typeof m.id === 'string' && m.id.length === 36 ? this.rooms.get(m.id) : null;
          if (room instanceof CardRoom && typeof m.session === 'string' && m.session.length === 36 && room.resume(c, m.session)) return;
          return send({ t: 'cresumeno' });
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
      try { onMsg(raw); } catch (error) {
        if (!c.errLogged) {
          c.errLogged = true;
          console.error('[msg]', error);
          logError('message_error', error, { client: c.id, room: c.room?.id });
        }
      }
    });
    ws.on('close', code => {
      closedSocketBytes += ws._socket?.bytesWritten ?? 0;
      disconnects++;
      if (code !== 1000 && code !== 1001) abnormalDisconnects++;
      this.clients.delete(c);
      if (c.room instanceof CardRoom) c.room.disconnect(c);
      else this.leaveRoom(c);
      c.room = null;
    });
    ws.on('error', error => logError('socket_error', error, { client: c.id, room: c.room?.id }));
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
      ws.rttMin = Math.min(ws.rttMin ?? Infinity, s);
    });
    sendPing(ws);
  }
}

const hub = new Hub();
let disconnects = 0, abnormalDisconnects = 0, heartbeatTimeouts = 0, closedSocketBytes = 0;
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: COMPRESSION && {
  // Giữ từ điển cho snapshot. Ping/pong JSON được gửi không nén bằng tùy chọn riêng.
  threshold: 128,
  zlibDeflateOptions: { level: 1, memLevel: 8 },
  serverNoContextTakeover: false,   // giữ từ điển giữa các gói → snapshot lặp lại nén rất tốt
  clientNoContextTakeover: true,
  concurrencyLimit: 16,
}, maxPayload: 16 * 1024 });
wss.on('connection', ws => hub.onConnection(ws));
wss.on('error', error => logError('websocket_server_error', error));
// Ngắt kết nối "ma": tải lại trang / mất mạng mà trình duyệt không kịp báo đóng.
// Không trả lời ping trong 2 lượt (~10 giây) thì cắt. Bàn bài giữ chỗ cho người mất kết nối.
function sendPing(ws) {
  ws.pingAt = performance.now();
  try { ws.ping(); } catch { /* bỏ qua */ }
}
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { heartbeatTimeouts++; ws.terminate(); continue; }
    ws.isAlive = false;
    if (!ws.pingAt) sendPing(ws);   // ping trước chưa có pong: gửi lại sẽ đo RTT từ mốc sai (quá nhỏ)
  }
}, 5000);

// Mẫu tổng hợp giúp phân biệt hàng đợi Node, ACK chậm và trễ trên event loop.
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
let cpuStart = process.cpuUsage(), sampleAt = performance.now(), sampledSocketBytes = 0;

function logNetworkSample() {
  const t = performance.now(), elapsed = t - sampleAt;
  const cpu = process.cpuUsage(cpuStart);
  let slow = 0, socketBytes = closedSocketBytes;
  for (const { ws, room } of hub.clients) {
    socketBytes += ws._socket?.bytesWritten ?? 0;
    if (room && ws.snapshotFlow?.room === room.id && ws.snapshotFlow.slow) slow++;
  }
  const sample = {
    intervalMs: Math.round(elapsed), online: hub.clients.size, rooms: hub.rooms.size, slow,
    cpuOneCorePct: Math.round((cpu.user + cpu.system) / Math.max(1, elapsed) / 10),
    wsOutMbps: +(Math.max(0, socketBytes - sampledSocketBytes) * 8 / Math.max(1, elapsed) / 1000).toFixed(3),
    rssMiB: Math.round(process.memoryUsage().rss / 1048576),
    loopP95Ms: Math.round(loopDelay.percentile(95) / 10000) / 100,
    loopMaxMs: Math.round(loopDelay.max / 10000) / 100,
    snapshots: snapshotStats(), disconnects, abnormalDisconnects, heartbeatTimeouts,
  };
  logEvent('network_sample', sample);
  disconnects = abnormalDisconnects = heartbeatTimeouts = 0;
  sampleAt = t;
  sampledSocketBytes = socketBytes;
  cpuStart = process.cpuUsage();
  loopDelay.reset();
}
const logTimer = setInterval(logNetworkSample, 10000);
logTimer.unref();

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
  logEvent('server_started', { version: VERSION, port: PORT, tunnel: USE_TUNNEL, compression: COMPRESSION, adaptive: !LEGACY_SNAPSHOTS });
  if (logFile) console.log('  Log         : ' + logFile);
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
      logError('upnp_error', e);
      publicInfo.note = 'UPnP lỗi: ' + e.message;
      console.log('  UPnP lỗi    : ' + e.message);
    }
  }
  if (USE_TUNNEL) {
    console.log('  Tunnel      : đang khởi tạo cloudflared...');
    try {
      const { startTunnel } = await import('./tunnel.js');
      const r = await startTunnel(PORT, ROOT, logEvent);
      logEvent('tunnel_ready');
      cleanups.push(r.close);
      publicInfo.publicUrl = r.url;
      console.log(`  Internet    : ${r.url}`);
    } catch (e) {
      logError('tunnel_start_error', e);
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
    clearInterval(logTimer);
    logNetworkSample();
    logEvent('server_stopped');
    await closeServerLog();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

server.on('error', async e => {
  logError('server_error', e, { port: PORT });
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} đang được dùng. Thử: npm start -- --port 3001`);
  else console.error(e);
  await closeServerLog();
  process.exit(1);
});
