// Kiểm tra server chấp nhận phát bắn hợp lệ ở chế độ bắn súng (Sinh tử) khi có trễ mạng,
// và vẫn từ chối phát bắn gian lận.
//
// Cách chạy (cần Node ≥ 22 vì dùng WebSocket có sẵn):
//   node server/index.js --port 3123
//   node tests/shooter-hit.mjs [cổng=3123] [trễ một chiều người bắn ms=75] [trễ một chiều mục tiêu ms=40]
//
// Script dựng proxy TCP làm trễ mọi byte (cả ping/pong của WebSocket) để giả lập mạng thật.
// Bot bắn giống hệt client: nội suy mục tiêu trễ NET.interp theo giờ nhận snapshot, dò trúng bằng rayPlayer.
import net from 'node:net';
import { NET } from '../shared/config.js';
import { getMap, rayMap, rayPlayer, PLAYER } from '../shared/maps.js';
import { WEAPONS, moveSpeedFor } from '../shared/weapons.js';

const PORT = +process.argv[2] || 3123;
const LAG_A = +(process.argv[3] ?? 75);
const LAG_B = +(process.argv[4] ?? 40);
const now = () => performance.now() / 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = v => Math.round(v * 100) / 100;

// ---------- Proxy làm trễ ----------
function lagProxy(delayMs) {
  return new Promise(res => {
    const srv = net.createServer(c => {
      const up = net.connect(PORT, '127.0.0.1');
      c.on('data', d => setTimeout(() => up.writable && up.write(d), delayMs));
      up.on('data', d => setTimeout(() => c.writable && c.write(d), delayMs));
      const end = () => { c.destroy(); up.destroy(); };
      c.on('close', end); up.on('close', end); c.on('error', end); up.on('error', end);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ---------- Bot ----------
class Bot {
  constructor(name) { this.name = name; this.handlers = {}; this.snaps = new Map(); this.hits = []; }
  async connect(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'welcome') this.id = m.id;
      if (m.t === 'sj') this.room = m.room.id;
      if (m.t === 'ss') for (const [id, x, y, z, , , f] of m.ps) {
        const b = this.snaps.get(id) || []; b.push({ t: now(), x, y, z, alive: !(f & 16) });
        if (b.length > 60) b.shift();
        this.snaps.set(id, b);
      }
      if (m.t === 'sspawn') (this.spawns ||= []).push({ id: m.id, at: now(), p: m.p });
      if (m.t === 'shit') this.hits.push({ ...m, at: now() });
      this.handlers[m.t]?.(m);
    };
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.send({ t: 'hello', name: this.name });
  }
  send(m) { this.ws.readyState === 1 && this.ws.send(JSON.stringify(m)); }
  waitFor(t, ms = 3000) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`${this.name}: không nhận được ${t}`)), ms);
      this.handlers[t] = m => { clearTimeout(to); delete this.handlers[t]; res(m); };
    });
  }
  // vị trí mục tiêu như client đang vẽ: nội suy trễ NET.interp (giống SAvatar.interpolate)
  seen(id, delay = NET.interp) {
    const b = this.snaps.get(id);
    if (!b || !b.length) return null;
    const rt = now() - delay;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const s1 = b[i], s0 = b[Math.max(0, i - 1)];
    const k = s1.t === s0.t ? 1 : Math.max(0, Math.min(1.15, (rt - s0.t) / (s1.t - s0.t)));
    return { x: s0.x + (s1.x - s0.x) * k, y: s0.y + (s1.y - s0.y) * k, z: s0.z + (s1.z - s0.z) * k, alive: s1.alive };
  }
  close() { try { this.ws.close(); } catch { /* */ } }
}

// ---------- Chọn vị trí trên map: A đứng yên/chạy ngắn, B chạy qua lại, nhìn thấy nhau rõ ----------
const map = getMap('lantern');
function clearLine(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
  return rayMap(a, d.map(v => v / L), L, map.boxes).t >= L - 0.01;
}
function freeSpot(x, z) {
  return !map.boxes.some(b => x > b.minX - 0.5 && x < b.maxX + 0.5 && z > b.minZ - 0.5 && z < b.maxZ + 0.5 && b.minY < 1.9);
}
function findSetup(minDist, segLen, aMove) {
  const B = map.bounds;
  for (let ax = -B.x + 3; ax < B.x - 3; ax += 1.5) for (let az = -B.z + 3; az < B.z - 3; az += 1.5) {
    for (let bx = -B.x + 3; bx < B.x - 3 - segLen; bx += 1.5) for (let bz = -B.z + 3; bz < B.z - 3; bz += 1.5) {
      const ok = (px, pz, qx, qz) => clearLine([px, PLAYER.eye, pz], [qx, 0.7, qz]) && clearLine([px, PLAYER.eye, pz], [qx, 1.4, qz]);
      if (Math.hypot(bx + segLen / 2 - ax, bz - az) < minDist) continue;
      let good = true;
      for (let s = 0; s <= segLen && good; s += 1) for (let m = 0; m <= aMove && good; m += 1)
        good = freeSpot(bx + s, bz) && freeSpot(ax, az + m) && ok(ax, az + m, bx + s, bz);
      if (good) return { a: [ax, az], b: [bx, bz], segLen, aMove };
    }
  }
  throw new Error('Không tìm được chỗ đứng thoáng trên map');
}

// ---------- Kịch bản ----------
// B chạy qua lại trên đoạn thẳng với tốc độ chạy tối đa, gửi vị trí 30 lần/giây.
function runTarget(bot, setup, speed) {
  let x = setup.b[0], dir = 1;
  const z = setup.b[1];
  let last = now();
  const iv = setInterval(() => {
    const t = now(), dt = t - last; last = t;
    x += dir * speed * dt;
    if (x > setup.b[0] + setup.segLen) { x = setup.b[0] + setup.segLen; dir = -1; }
    if (x < setup.b[0]) { x = setup.b[0]; dir = 1; }
    bot.send({ t: 's', p: [r2(x), 0, r2(z)], r: dir > 0 ? -1.57 : 1.57, pi: 0, f: 2, w: 0 });
  }, 1000 / NET.sendRate);
  return () => clearInterval(iv);
}

// A di chuyển (nếu aMove > 0) và gửi vị trí; trả về hàm lấy vị trí hiện tại
function moveShooter(bot, setup, speed) {
  let z = setup.a[1], dir = 1, last = now();
  const iv = setInterval(() => {
    const t = now(), dt = t - last; last = t;
    if (setup.aMove > 0) {
      z += dir * speed * dt;
      if (z > setup.a[1] + setup.aMove) { z = setup.a[1] + setup.aMove; dir = -1; }
      if (z < setup.a[1]) { z = setup.a[1]; dir = 1; }
    }
    bot.send({ t: 's', p: [r2(setup.a[0]), 0, r2(z)], r: 0, pi: 0, f: setup.aMove ? 2 : 0, w: 0 });
  }, 1000 / NET.sendRate);
  return { pos: () => [setup.a[0], 0, z], stop: () => clearInterval(iv) };
}

async function scenario({ title, weapon, minDist, segLen, aMove, count, cheat = null }) {
  const setup = findSetup(minDist, segLen, aMove);
  const pa = await lagProxy(LAG_A), pb = await lagProxy(LAG_B);
  const A = new Bot('A'), Bt = new Bot('B');
  await A.connect(pa.address().port);
  await Bt.connect(pb.address().port);
  A.send({ t: 'create', mode: 'dm', map: 'lantern', name: 'test-' + Date.now() });
  await A.waitFor('sj');
  Bt.send({ t: 'join', id: A.room });
  await Bt.waitFor('sj');
  A.send({ t: 'buy', item: weapon });
  const w = WEAPONS[weapon];
  const stopB = runTarget(Bt, setup, moveSpeedFor('knife'));
  const mover = moveShooter(A, setup, moveSpeedFor(weapon));
  await sleep(6000);          // chờ server đo được ping (ping đầu tiên ngay khi kết nối) + hết bảo vệ hồi sinh
  let fired = 0, mag = w.mag, protectUntil = 0;
  const hitsBefore = A.hits.length;
  A.handlers.sspawn = m => { if (m.id === Bt.id) protectUntil = now() + 1.5 + 0.4 + LAG_A / 1000; };
  const shots = [];
  const mid = [setup.b[0] + setup.segLen * 0.37, setup.b[0] + setup.segLen * 0.63];
  while (fired < count) {
    const tg = A.seen(Bt.id);
    if (!tg || !tg.alive || now() < protectUntil || Math.abs(tg.z - setup.b[1]) > 0.5) { await sleep(20); continue; }
    if (cheat === 'old' && (tg.x < mid[0] || tg.x > mid[1])) { await sleep(10); continue; }
    if (mag <= 0) { A.send({ t: 'reload' }); await sleep(w.reload * 1000 + 300); mag = w.mag; continue; }
    const me = mover.pos();
    const o = [me[0], me[1] + PLAYER.eye, me[2]];
    let zone, end;
    if (cheat === 'offset') {
      // trượt 2 m vuông góc với hướng chạy nhưng khai là trúng
      end = [tg.x, tg.y + 0.7, tg.z + 2]; zone = 2;
    } else if (cheat === 'old') {
      // khai trúng chỗ mục tiêu đứng 1,2 giây trước (đã chạy đi ~8 m)
      const old = A.seen(Bt.id, NET.interp + 1.2);
      end = [old.x, old.y + 0.7, old.z]; zone = 2;
    } else {
      const aimPt = [tg.x, tg.y + 0.7, tg.z];
      const d = aimPt.map((v, i) => v - o[i]), L = Math.hypot(...d);
      const dir = d.map(v => v / L);
      const r = rayPlayer(o, dir, tg.x, tg.y, tg.z, false);
      const wall = rayMap(o, dir, 250, map.boxes);
      if (!(r.t < wall.t)) { await sleep(20); continue; }
      end = dir.map((v, i) => o[i] + v * r.t); zone = r.zone;
    }
    shots.push({ at: now() });
    A.send({ t: 'fire', w: weapon, o: o.map(r2), p: [[r2(end[0]), r2(end[1]), r2(end[2]), Bt.id, zone]] });
    fired++; mag--;
    await sleep(60000 / w.rpm + 20);
  }
  await sleep(LAG_A * 2 + 500);
  // gán mỗi gói shit cho phát bắn tương ứng: shit tới A sau phát bắn ~1 RTT
  const rtt = 2 * LAG_A / 1000;
  const hits = A.hits.slice(hitsBefore).filter(h => h.sid === A.id && h.tid === Bt.id);
  let stray = 0;
  for (const h of hits) {
    let best = null;
    for (const s of shots) if (!s.ok && (!best || Math.abs(h.at - rtt - s.at) < Math.abs(h.at - rtt - best.at))) best = s;
    if (best && Math.abs(h.at - rtt - best.at) < 0.06) { best.ok = true; best.kill = h.hp === 0; } else stray++;
  }
  // phát bị từ chối vì tới server lúc mục tiêu vừa chết (A chưa kịp biết) là đúng luật
  for (const s of shots) if (!s.ok && shots.some(k => k.kill && k.at < s.at && s.at - k.at < 1.0)) s.afterKill = true;
  stopB(); mover.stop(); A.close(); Bt.close(); pa.close(); pb.close();
  const dist = Math.hypot(setup.b[0] + setup.segLen / 2 - setup.a[0], setup.b[1] - setup.a[1]).toFixed(1);
  return {
    title, fired, dist, stray,
    accepted: shots.filter(s => s.ok).length,
    afterKill: shots.filter(s => s.afterKill).length,
    rejected: shots.filter(s => !s.ok && !s.afterKill).length,
  };
}

const list = [
  { title: 'Sniper đứng yên, mục tiêu chạy, cách xa', weapon: 'sniper', minDist: 28, segLen: 10, aMove: 0, count: 5 },
  { title: 'Súng trường, người bắn đang chạy, mục tiêu chạy', weapon: 'rifle', minDist: 12, segLen: 8, aMove: 6, count: 25 },
  { title: 'Gian lận: khai trúng nhưng lệch 2 m', weapon: 'rifle', minDist: 12, segLen: 8, aMove: 0, count: 10, cheat: 'offset' },
  { title: 'Gian lận: khai trúng chỗ mục tiêu 1,2 s trước', weapon: 'rifle', minDist: 12, segLen: 22, aMove: 0, count: 10, cheat: 'old' },
];
console.log(`Trễ một chiều: người bắn ${LAG_A} ms (RTT ${LAG_A * 2} ms), mục tiêu ${LAG_B} ms`);
let fail = false;
for (const sc of list) {
  const r = await scenario(sc);
  const ok = sc.cheat ? r.accepted === 0 && r.stray === 0 : r.rejected === 0 && r.accepted > 0;
  if (!ok) fail = true;
  console.log(`${ok ? 'OK  ' : 'SAI '} ${r.title} (~${r.dist} m): bắn ${r.fired}, server nhận ${r.accepted}, từ chối ${r.rejected}` +
    (r.afterKill ? `, ${r.afterKill} phát tới sau khi mục tiêu đã chết` : '') + (r.stray ? `, ${r.stray} gói trúng không khớp phát nào` : '') +
    ` → mong đợi ${sc.cheat ? 'nhận 0' : 'không phát hợp lệ nào bị từ chối'}`);
}
process.exit(fail ? 1 : 0);
