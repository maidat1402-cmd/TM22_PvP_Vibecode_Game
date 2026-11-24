// Kiểm tra độ bền server: nhiều bot ở cả 5 chế độ (đối kháng, đấu tập, đấu đội, sinh tử, đặt bom),
// vào/ra phòng liên tục, ngắt kết nối đột ngột, bot "ma" không trả lời ping, gói rác / thiếu trường / số khổng lồ.
//
// Cách chạy:
//   node server/index.js --port 3123
//   node tests/stress.mjs [cổng=3123] [số giây=60] [số bot vào/ra=24]
//
// Đạt khi: server không chết, các bot "trụ" (ở suốt bài test) không bị ngắt và vẫn nhận snapshot đều,
// bot "ma" bị server cắt sau ~10 s, và cuối bài không còn phòng/người chơi nào sót lại.
import WebSocket from 'ws';
import { CHARACTERS } from '../shared/characters.js';
import { CARD_GAMES, CARD_REJOIN_SECONDS } from '../shared/cards.js';
import { WEAPON_LIST, NADE_LIST, BUY_MENU } from '../shared/weapons.js';

const PORT = +process.argv[2] || 3123;
const SECONDS = +(process.argv[3] ?? 60);
const CHURNERS = +(process.argv[4] ?? 24);
const URL = `ws://127.0.0.1:${PORT}/ws`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const fails = [];
const fail = msg => { fails.push(msg); console.log('  ✗ ' + msg); };

const MODES = [['brawl', 'shrine'], ['practice', 'village'], ['team', 'tournament'], ['dm', 'lantern'], ['bomb', 'temple'], ['xidach', ''], ['tienlen', '']];
const BUY_ITEMS = BUY_MENU.flatMap(c => c.items);
const TYPES = ['s', 'cast', 'dodge', 'heal', 'steer', 'char', 'chat', 'tteam', 'tready', 'tstart', 'awk', 'hold', 'pfill',
  'cbet', 'cready', 'cbot', 'chit', 'cstand', 'cplay', 'cpass', 'cstart', 'cdealer', 'cstop', 'cconfig', 'copen', 'cresume', 'cresumeack',
  'fire', 'throw', 'drop', 'pickup', 'reload', 'switch', 'buy', 'use', 'loadout', 'team',
  'hello', 'list', 'create', 'join', 'leave', 'ping', '__proto__', 'constructor', 'toString', ''];
const FIELDS = ['p', 'd', 'a', 'r', 'f', 'sk', 'cs', 'seed', 'tg', 'team', 'on', 'msg', 'char', 'k', 'o', 'v',
  'w', 'slot', 'item', 'w1', 'w2', 'pi', 'id', 'mode', 'map', 'name', 'c', 'aw', 'rp', 'hold', 'hk', 'cards', 'session', 'chips', 'bets', 'cardStyle', 'seat'];
const BIG = 'x'.repeat(3000);
const JUNK = [undefined, null, true, false, 0, -1, 1, 3, 99, -99999, 1e308, -1e308, 2 ** 53, 0.5, '', 'NaN', 'Infinity',
  '__proto__', 'constructor', 'toString', 'hasOwnProperty', BIG, [], [null], [1], [1, 2], ['a', 'b', 'c'],
  [1e308, 1e308, 1e308], [-1e308, 0, 1e308], [0, 0, 0], [[1, 2, 3, 1, 1]], [[0, 0, 0, '1', 1], [1e308, 0, 0, 2, 9]],
  Array(300).fill([1, 1, 1, 1, 1]), Array(300).fill(0), {}, { a: 1 }, { toString: 1 }, { valueOf: 1, toString: 1 }, { length: 5 }, { 0: 1, 1: 2, 2: 3, length: 3 },
  'T', 'CT', 'A', 'B', 'he', 'flash', 'smoke', 'rifle', 'sniper', 'knife', 'armor', 'kit', 'kaze',
  'treant', 'dummy', ...CHARACTERS.map(c => c.id), ...WEAPON_LIST, ...NADE_LIST];

function junkPacket() {
  const m = { t: pick(TYPES) };
  const n = Math.floor(rnd(0, 6));
  for (let i = 0; i < n; i++) m[pick(FIELDS)] = pick(JUNK);
  return m;
}
// Chuỗi gửi thẳng (không qua JSON.stringify của ta): JSON lỗi, kiểu lạ, __proto__ thật trong JSON
const RAW_JUNK = ['', 'null', '1', '"s"', '[]', '[1,2]', '{', '{"t":', '{"t":1}', '{"t":null}', '{"t":["s"]}',
  '{"t":"s","p":"abc"}', '{"__proto__":{"t":"s"}}', '{"t":"cast","__proto__":{"sk":1}}', '{"t":"s","p":{"length":3}}',
  '{"t":"fire","w":"pistol","o":[0,1.3,0],"p":[[0,1,0,"__proto__",1]]}', 'x'.repeat(10000)];

function connect(opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, opts);
    const c = { ws, id: 0, handlers: {}, count: 0, closed: false, last: {} };
    c.on = (t, fn) => { (c.handlers[t] ||= []).push(fn); };
    c.send = m => { if (ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
    ws.on('message', raw => {
      c.count++;
      let m; try { m = JSON.parse(raw); } catch { return fail('server gửi JSON lỗi'); }
      c.last[m.t] = m;
      if (m.t === 'welcome') { c.id = m.id; resolve(c); }
      for (const fn of c.handlers[m.t] || []) fn(m);
    });
    ws.on('close', (code) => { c.closed = true; c.closeCode = code; for (const fn of c.handlers.close || []) fn(code); });
    ws.on('error', e => { if (!c.id) reject(e); });
  });
}
const waitFor = (c, t, ms = 3000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('hết giờ chờ ' + t)), ms);
  c.on(t, m => { clearTimeout(to); res(m); });
});

// ---------- Bot trụ: ở suốt bài test, chơi hợp lệ, phải không bị ngắt ----------
async function anchor(mode, map, roomId, name) {
  const c = await connect();
  const shooter = mode === 'dm' || mode === 'bomb';
  c.mode = mode; c.name = name;
  c.cards = mode === 'xidach' || mode === 'tienlen';
  c.send({ t: 'hello', name, char: pick(CHARACTERS).id });
  const joined = waitFor(c, c.cards ? 'cj' : shooter ? 'sj' : 'joined');
  c.send(roomId ? { t: 'join', id: roomId, char: pick(CHARACTERS).id } : { t: 'create', name, mode, map, char: pick(CHARACTERS).id });
  const j = await joined;
  c.roomId = j.room.id;
  c.pos = [0, 0, 0];
  if (c.cards) {   // đánh bài không có snapshot: chỉ ghi nhận bị ngắt
    c.on('close', code => { if (!c.stopping) fail(`bot trụ ${name} (${mode}) bị ngắt, mã ${code}`); });
    return c;
  }
  const me = j.players.find(p => p.id === j.you);
  if (me && Number.isFinite(me.x)) c.pos = [me.x, me.y || 0, me.z];
  c.on(shooter ? 'sspawn' : 'respawn', m => { if (m.id === c.id || m.id == null) { if (Array.isArray(m.p)) c.pos = m.p.slice(0, 3); else if (Number.isFinite(m.x)) c.pos = [m.x, 0, m.z]; } });
  c.on('close', code => { if (!c.stopping) fail(`bot trụ ${name} (${mode}) bị ngắt, mã ${code}`); });
  c.snapTimes = [];
  c.on(shooter ? 'ss' : 'snap', () => c.snapTimes.push(performance.now()));
  return c;
}

function anchorTick(c, others) {
  if (c.cards) {
    const r = Math.random();
    if (r < 0.02) c.send({ t: 'cstart' });
    else if (r < 0.04) c.send({ t: 'cready' });
    else if (r < 0.05) c.send({ t: 'cbet', v: pick([50, 100, 200, 500, -1, 1e308]) });
    else if (r < 0.07) c.send({ t: pick(['chit', 'cstand', 'cpass']) });
    else if (r < 0.09) c.send({ t: 'cplay', cards: pick([[0], [3, 3], [1, 2, 3], [51, 50], [-1], [1e308], Array(60).fill(7)]) });
    else if (r < 0.095) c.send({ t: 'cbot', d: pick([1, -1]) });
    else if (r < 0.097) c.send({ t: pick(['cdealer', 'cstop']) });
    else if (r < 0.098) c.send({ t: 'char', char: pick(['treant', 'dummy', ...CHARACTERS.map(q => q.id)]) });
    return;
  }
  const shooter = c.mode === 'dm' || c.mode === 'bomb';
  const [x, y, z] = c.pos;
  const nx = x + rnd(-0.15, 0.15), nz = z + rnd(-0.15, 0.15);
  c.pos = [nx, y, nz];
  c.send(shooter
    ? { t: 's', p: [+nx.toFixed(2), +y.toFixed(2), +nz.toFixed(2)], r: rnd(-3, 3), pi: rnd(-1, 1), f: 0, w: 0 }
    : { t: 's', p: [+nx.toFixed(2), +y.toFixed(2), +nz.toFixed(2)], r: rnd(-3, 3), a: 1, f: 0 });
  const r = Math.random();
  if (!shooter) {
    if (r < 0.08) c.send({ t: 'cast', sk: Math.floor(rnd(0, 6)), cs: Math.floor(rnd(1, 1e6)), seed: Math.floor(rnd(1, 1e9)),
      p: c.pos.map(v => +v.toFixed(2)), d: [rnd(-1, 1), rnd(-0.5, 0.5), rnd(-1, 1)], tg: [nx + rnd(-8, 8), 0, nz + rnd(-8, 8)],
      a: [nx + rnd(-8, 8), 0, nz + rnd(-8, 8)], aw: c.aw ? 1 : 0, hold: rnd(0, 2), rp: Math.floor(rnd(0, 50)) });
    else if (r < 0.085) c.send({ t: 'hold', sk: Math.floor(rnd(0, 6)) });
    else if (r < 0.09) { if (c.mode === 'practice') c.send({ t: 'pfill' }); c.send({ t: 'awk' }); c.aw = !c.aw; }
    else if (r < 0.1) c.send({ t: 'steer', a: [rnd(-1, 1), 0, rnd(-1, 1)] });
    else if (r < 0.105) c.send({ t: 'heal' });
    else if (r < 0.11) c.send({ t: 'dodge' });
    else if (r < 0.112 && c.mode === 'team') { c.send({ t: 'tready', on: true }); c.send({ t: 'tstart' }); }
    else if (r < 0.113) c.send({ t: 'char', char: pick(CHARACTERS).id });
  } else {
    const tgt = pick(others);
    if (r < 0.15) {
      const o = [nx, y + 1.3, nz];
      const tp = tgt ? tgt.pos : [0, 1, 0];
      c.send({ t: 'fire', w: pick(['pistol', 'rifle', 'knife', 'sniper', 'smg', 'shotgun']), o,
        p: [[tp[0], tp[1] + 1, tp[2], tgt ? tgt.id : 0, Math.floor(rnd(1, 4))]] });
    } else if (r < 0.17) c.send({ t: 'switch', slot: Math.floor(rnd(1, 4)) });
    else if (r < 0.18) c.send({ t: 'reload' });
    else if (r < 0.19) c.send({ t: 'buy', item: pick(BUY_ITEMS) });
    else if (r < 0.195) c.send({ t: 'throw', k: pick(NADE_LIST), o: [nx, y + 1.3, nz], v: [rnd(-10, 10), rnd(0, 8), rnd(-10, 10)] });
    else if (r < 0.2) c.send({ t: 'use', on: Math.random() < 0.5 });
    else if (r < 0.203) c.send({ t: 'drop' });
    else if (r < 0.206) c.send({ t: 'pickup' });
    else if (r < 0.207 && c.mode === 'bomb') c.send({ t: 'team', team: pick(['T', 'CT']) });
  }
}

// ---------- Bot vào/ra: gói rác, rời phòng bằng mọi cách ----------
async function churner(idx, stopAt, stats) {
  while (performance.now() < stopAt) {
    let c;
    try { c = await connect({ autoPong: Math.random() > 0.05 }); } catch (e) { fail('không kết nối được: ' + e.message); await sleep(500); continue; }
    stats.sessions++;
    c.send({ t: 'hello', name: pick([`bot${idx}`, BIG, '<b>x</b>', '', null, 123, ['a']]), char: pick(JUNK) });
    await sleep(rnd(10, 100));
    const rooms = (c.last.rooms && c.last.rooms.list) || [];
    if (rooms.length && Math.random() < 0.7) c.send({ t: 'join', id: pick(rooms).id, char: pick([...CHARACTERS.map(x => x.id), ...JUNK]) });
    else { const [mode, map] = pick(MODES); c.send({ t: 'create', name: pick(['', BIG, 'p' + idx]), mode: pick([mode, mode, pick(JUNK)]), map: pick([map, map, pick(JUNK)]), char: pick(JUNK) }); }
    const until = performance.now() + rnd(200, 3000);
    while (performance.now() < until && !c.closed) {
      const r = Math.random();
      if (r < 0.6) c.send(junkPacket());
      else if (r < 0.65) c.send(pick(RAW_JUNK));
      else if (r < 0.66) c.ws.readyState === 1 && c.ws.send(Buffer.from([0, 1, 2, 255]));
      else c.send({ t: 's', p: [rnd(-30, 30), rnd(0, 3), rnd(-30, 30)], r: rnd(-3, 3), a: 1 });
      await sleep(rnd(5, 40));
    }
    const how = Math.random();
    if (how < 0.3) c.send({ t: 'leave' }), await sleep(20), c.ws.close();
    else if (how < 0.6) c.ws.close();
    else c.ws.terminate(); // mất mạng đột ngột
  }
}

async function httpFuzz() {
  const paths = ['//', '/%', '/%E0%A4%A', '/%ZZ', '/shared/%', '/../../server/index.js', '/..%2f..%2fpackage.json', '/vendor/three/%',
    '/api/info', '/index.html', '/shared/config.js', '/' + 'a'.repeat(4000)];
  for (const p of paths) {
    try { await fetch(`http://127.0.0.1:${PORT}${p}`); } catch { /* bỏ qua */ }
  }
}

async function info() {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/info`);
  return r.json();
}

// ---------- Chạy ----------
console.log(`Stress ${SECONDS}s, ${CHURNERS} bot vào/ra, cổng ${PORT}`);
await info().catch(() => { console.log('Không kết nối được server'); process.exit(2); });

const anchors = [];
for (const [mode, map] of MODES) {
  const a = await anchor(mode, map, null, `tru-${mode}-1`);
  const b = await anchor(mode, map, a.roomId, `tru-${mode}-2`);
  anchors.push(a, b);
}
const byRoom = id => anchors.filter(a => a.roomId === id);

// Bot "ma": vào phòng rồi ngừng trả lời ping (giống tab bị treo / mất mạng không báo)
const ghost = await connect({ autoPong: false });
ghost.send({ t: 'hello', name: 'ma' });
ghost.send({ t: 'join', id: anchors[0].roomId });
const ghostStart = performance.now();
let ghostClosedAfter = null;
ghost.on('close', () => { ghostClosedAfter = (performance.now() - ghostStart) / 1000; });

const anchorTimer = setInterval(() => { for (const a of anchors) anchorTick(a, byRoom(a.roomId).filter(o => o !== a)); }, 33);

// snapshot phải đều: mỗi 2 s kiểm tra không có khoảng trống > 1 s
const gapTimer = setInterval(() => {
  const t = performance.now();
  for (const a of anchors) {
    if (a.cards) continue;   // bàn bài không có snapshot
    const last = a.snapTimes[a.snapTimes.length - 1] || 0;
    if (!a.closed && t - last > 1000) fail(`bot trụ ${a.name} không nhận snapshot ${((t - last) / 1000).toFixed(1)} s`);
    a.snapTimes = a.snapTimes.slice(-5);
  }
}, 2000);

const stopAt = performance.now() + SECONDS * 1000;
const stats = { sessions: 0 };
const churn = Array.from({ length: CHURNERS }, (_, i) => churner(i, stopAt, stats));
const httpTimer = setInterval(httpFuzz, 3000);
const progress = setInterval(async () => {
  try { const i = await info(); console.log(`  ${Math.round((stopAt - performance.now()) / 1000)}s còn lại — online ${i.online}, phòng ${i.rooms.length}, phiên vào/ra ${stats.sessions}`); }
  catch { fail('server không trả lời /api/info (đã chết?)'); }
}, 10000);

await Promise.all(churn);
clearInterval(httpTimer); clearInterval(progress); clearInterval(anchorTimer); clearInterval(gapTimer);
await httpFuzz();

if (SECONDS >= 15) {
  if (ghostClosedAfter == null) fail('bot ma không bị server cắt');
  else console.log(`  bot ma bị cắt sau ${ghostClosedAfter.toFixed(1)} s`);
}
for (const a of anchors) { a.stopping = true; a.ws.close(); }
ghost.ws.terminate();
await sleep(1500);
try {
  let i = await info();
  if (i.online !== 0) fail(`còn ${i.online} kết nối sau khi mọi bot đã thoát`);
  const cardRooms = i.rooms.filter(room => Object.hasOwn(CARD_GAMES, room.mode));
  if (cardRooms.length === i.rooms.length && cardRooms.length) {
    console.log(`  Chờ tối đa ${CARD_REJOIN_SECONDS} s để ${cardRooms.length} bàn bài hết hạn giữ chỗ`);
    const deadline = performance.now() + CARD_REJOIN_SECONDS * 1000;
    while (i.rooms.length && performance.now() < deadline) { await sleep(1000); i = await info(); }
  }
  if (i.rooms.length) fail(`còn ${i.rooms.length} phòng sót lại: ${JSON.stringify(i.rooms).slice(0, 200)}`);
} catch { fail('server không trả lời sau bài test (đã chết?)'); }

console.log(fails.length ? `\nKHÔNG ĐẠT: ${fails.length} lỗi` : `\nĐẠT — ${stats.sessions} phiên vào/ra, server vẫn sống, bot trụ không bị ngắt`);
process.exit(fails.length ? 1 : 0);
