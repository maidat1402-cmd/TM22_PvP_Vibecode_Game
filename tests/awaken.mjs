// Kiểm tra dị biến ở server: thanh tích, kích hoạt, bộ chiêu mới, nội tại, kiểu chiêu mới, ngắm dọc.
// Chạy server riêng rồi chạy test (Node ≥ 22, mất khoảng 2 phút vì phải chờ hết 17 giây dị biến):
//   node server/index.js --port 3123
//   node tests/awaken.mjs            (đổi cổng: PORT=3000 node tests/awaken.mjs)
import { CHARACTERS } from '../shared/characters.js';
const PORT = process.env.PORT || 3123;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log(c ? '  ✔' : '  ✘ LỖI', msg); };
function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, log: [], pos: [0, 0, 0], yaw: 0 };
  ws.onmessage = ev => { const m = JSON.parse(ev.data); c.log.push(m); if (m.t === 'joined') { c.you = m.you; c.room = m.room; } };
  c.send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
  c.ready = new Promise(r => ws.onopen = r);
  return c;
}
let cs = 1;
async function room(chars) {
  const cl = chars.map(() => client());
  for (const c of cl) await c.ready;
  cl.forEach((c, i) => c.send({ t: 'hello', name: 'P' + i, char: chars[i] }));
  cl[0].send({ t: 'create', name: 'aw', map: 'tournament' }); await sleep(200);
  for (const c of cl.slice(1)) c.send({ t: 'join', id: cl[0].room.id });
  await sleep(250);
  const tick = setInterval(() => { for (const c of cl) c.send({ t: 's', p: c.pos, r: c.yaw, a: 0, f: 0 }); }, 33);
  return { cl, close: async () => { clearInterval(tick); for (const c of cl) c.ws.close(); await sleep(150); } };
}
const cast = (c, sk, extra = {}) => c.send({ t: 'cast', sk, cs: cs++, seed: 5, p: c.pos, d: [0, 0, 1], ...extra });
const hitsOn = (c, tid, from = 0) => c.log.slice(from).filter(m => m.t === 'hit' && m.tid === tid);
const snapOf = (c, id) => c.log.filter(m => m.t === 'snap').pop()?.ps.find(p => p[0] === id);
const gauge = (c, id) => snapOf(c, id)?.[9] ?? 0;
// đánh B bằng chiêu K tới khi đầy thanh (hồi máu cho B bằng cách để B chết/hồi sinh nếu cần)
async function fill(A, B, sk = 1) {
  const ch = CHARACTERS.find(c => c.id === A.char);
  const s = ch.skills[sk];
  const t0 = Date.now();
  while (gauge(A, A.you) < 100 && Date.now() - t0 < 30000) {
    cast(A, sk);
    await sleep(Math.max(s.cd, s.lock) * 1000 + 60);
  }
  await sleep(100);
  return gauge(A, A.you);
}
async function awaken(A, B, sk) {
  const g = await fill(A, B, sk);
  const n = A.log.length;
  A.send({ t: 'awk' }); await sleep(250);
  const on = A.log.slice(n).find(m => m.t === 'awk' && m.id === A.you && m.on);
  await sleep(900);   // hết thời gian biến hình
  return { g, on };
}
const mk = async (chars) => { const r = await room(chars); r.cl.forEach((c, i) => c.char = chars[i]); return r; };

{ // ---- cơ chế chung ----
  console.log('Cơ chế chung (Raiga)');
  const { cl: [A, B, C], close } = await mk(['raiga', 'kaze', 'kaze']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; C.pos = [20, 0, 10]; await sleep(200);
  ok(gauge(A, A.you) === 0, 'vào trận thanh dị biến = 0');
  let n = A.log.length;
  A.send({ t: 'awk' }); await sleep(200);
  ok(A.log.slice(n).some(m => m.t === 'awkno'), 'thanh chưa đầy: bấm dị biến bị từ chối');
  n = A.log.length;
  cast(A, 1, { aw: 1 }); await sleep(200);
  ok(A.log.slice(n).some(m => m.t === 'castno' && m.aw), 'chưa dị biến mà gửi chiêu dị biến: bị từ chối');
  cast(A, 1); await sleep(500);
  const dealt = hitsOn(A, B.you).reduce((a, h) => a + h.dmg, 0);
  ok(gauge(A, A.you) === dealt && dealt > 0, `gây ${dealt} sát thương → thanh ${gauge(A, A.you)}`);
  ok(gauge(B, B.you) === 0, 'người bị đánh không được cộng thanh');
  const { g, on } = await awaken(A, B, 1);
  ok(g >= 100 && on && Math.abs(on.dur - 17.8) < 0.05, `thanh ${g} → dị biến ${on?.dur}s (17 s + 0.8 s biến hình)`);
  ok(A.log.some(m => m.t === 'sys' && /dị biến/.test(m.msg)), 'cả phòng được thông báo');
  ok(B.log.some(m => m.t === 'hit' && m.tid === B.you && m.fx === 'awaken'), 'sóng xung kích biến hình đánh văng người đứng gần');
  ok(!C.log.some(m => m.t === 'hit' && m.tid === C.you && m.fx === 'awaken'), 'người đứng xa không bị sóng xung kích');
  ok(snapOf(A, A.you)[7] === 100, 'biến hình hồi đầy mana');
  n = A.log.length;
  cast(A, 0, { aw: 1 }); await sleep(400);
  const c0 = A.log.slice(n).find(m => m.t === 'cast' && m.id === A.you);
  ok(c0?.aw === 1 && B.log.some(m => m.t === 'cast' && m.id === A.you && m.aw === 1), 'chiêu dị biến: server và người khác nhận aw = 1');
  ok(hitsOn(A, B.you, n).some(h => h.dmg === 7 && h.fx === 'kiFist'), `J dị biến của Raiga là Khí Quyền (đạn 7 sát thương)`);
  await sleep(300);
  const g1 = gauge(A, A.you);
  ok(g1 === 0, 'đang dị biến đánh trúng không tích thanh');
  // Raiga dị biến: không bị đẩy lùi, giảm 15% sát thương
  n = B.log.length;
  B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] }); await sleep(500);
  const hb = hitsOn(B, A.you, n).pop();
  ok(hb && hb.dmg === Math.round(9 * 0.85) && hb.kb.every(v => v === 0), `Raiga dị biến bị phi tiêu: ${hb?.dmg} sát thương (9 × 0.85), đẩy lùi 0`);
  await close();
}
{ // ---- hết giờ + chết ----
  console.log('Hết dị biến / chết mất nửa thanh (Gantetsu)');
  const { cl: [A, B], close } = await mk(['gantetsu', 'kage']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; await sleep(200);
  const { on } = await awaken(A, B, 1);
  ok(!!on, 'Gantetsu dị biến');
  // Sơn Thần Giáp: giảm 30%, không bị choáng
  let n = A.log.length;
  B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] }); await sleep(450);
  const hk = hitsOn(B, A.you, n);
  ok(hk.length && hk.every(h => h.dmg === Math.max(1, Math.round(6 * 0.7))), `phi đao vào giáp đá: ${hk.map(h => h.dmg)} (6 × 0.7)`);
  // Thạch Lao: cột đá ở 6 m phía trước
  n = A.log.length;
  B.pos = [0, 0, -8]; await sleep(150);
  cast(A, 3, { aw: 1 }); await sleep(600);
  ok(hitsOn(A, B.you, n).some(h => h.fx === 'stoneCage' && h.stun), 'Thạch Lao trúng đối thủ ở 6 m + choáng');
  await sleep(17500);
  const off = A.log.find(m => m.t === 'awk' && m.id === A.you && !m.on);
  ok(off && off.tired === 2, `hết 17 giây: tắt dị biến, kiệt sức ${off?.tired}s`);
  n = A.log.length;
  cast(A, 0, { aw: 1 }); await sleep(200);
  ok(A.log.slice(n).some(m => m.t === 'castno'), 'hết dị biến: chiêu dị biến bị từ chối');
  // tích lại 60 rồi chết → còn 30
  B.pos = [0, 0, -10];
  while (gauge(A, A.you) < 60) { cast(A, 1); await sleep(1300); }
  const before = gauge(A, A.you);
  A.pos = [95, 0, 0]; await sleep(500);   // rơi khỏi sân
  ok(A.log.some(m => m.t === 'die' && m.id === A.you), 'A rơi khỏi sân');
  await sleep(200);
  ok(gauge(A, A.you) === Math.floor(before / 2), `chết: thanh ${before} → ${gauge(A, A.you)}`);
  await close();
}
{ // ---- Homura: bỏng ----
  console.log('Homura: bỏng');
  const { cl: [A, B], close } = await mk(['homura', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -11.5]; await sleep(200);
  await awaken(A, B, 0);
  const n = A.log.length;
  cast(A, 0, { aw: 1 }); await sleep(2600);
  const burns = hitsOn(A, B.you, n).filter(h => h.fx === 'burn');
  ok(burns.length === 4 && burns.every(h => h.dmg === 2), `chém trúng → bỏng ${burns.length} nhịp × ${burns[0]?.dmg}`);
  await close();
}
{ // ---- Yuki: đóng băng cộng dồn ----
  console.log('Yuki: đóng băng cộng dồn');
  const { cl: [A, B], close } = await mk(['yuki', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; await sleep(200);
  await awaken(A, B, 1);
  const n = A.log.length;
  for (let i = 0; i < 3; i++) { cast(A, 0, { aw: 1 }); await sleep(420); }
  const hs = hitsOn(A, B.you, n);
  ok(hs.length >= 3 && hs[0].frost === 1 && hs[1].frost === 2 && hs[2].frz && hs[2].stun === 1, `dấu băng ${hs.map(h => h.frz ? 'ĐÓNG BĂNG' : h.frost).join(' → ')}`);
  await close();
}
{ // ---- Midori: hút máu ----
  console.log('Midori: hút máu');
  const { cl: [A, B], close } = await mk(['midori', 'raiga']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; await sleep(200);
  B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] });   // B đánh A trước để A mất máu
  await sleep(300);
  await awaken(A, B, 1);
  B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] }); await sleep(400);
  const hp0 = snapOf(A, A.you)[6];
  const n = A.log.length;
  cast(A, 0, { aw: 1 }); await sleep(400);
  const h = hitsOn(A, B.you, n)[0];
  const hp1 = snapOf(A, A.you)[6];
  ok(h && hp1 - hp0 >= Math.floor(h.dmg * 0.2) && hp1 > hp0, `roi gai ${h?.dmg} sát thương → hồi ${hp1 - hp0} máu`);
  ok(h && h.kb[2] < 0, 'roi gai kéo đối thủ về phía Midori');
  await close();
}
{ // ---- Kaze: tường gió ----
  console.log('Kaze: Thiên Phong Bích');
  const { cl: [A, B], close } = await mk(['kaze', 'raiga']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -4]; await sleep(200);
  await awaken(A, B, 1);
  B.pos = [0, 0, -4];
  cast(A, 3, { aw: 1 }); await sleep(400);
  let n = A.log.length;
  B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] }); await sleep(600);
  ok(!hitsOn(B, A.you, n).length, 'khí đạn của đối thủ bị tường gió chặn');
  n = A.log.length;
  await sleep(300);
  cast(A, 1, { aw: 1 }); await sleep(800);   // Bão Phi Tiêu bắn từ sau tường
  ok(hitsOn(A, B.you, n).length > 0, 'đạn của Kaze bay xuyên tường trúng đối thủ');
  // Bão Phi Tiêu tự tìm mục tiêu lệch hướng
  await sleep(500);
  B.pos = [3.5, 0, -6];
  n = A.log.length; await sleep(200);
  cast(A, 1, { aw: 1 }); await sleep(800);
  ok(hitsOn(A, B.you, n).length >= 3, `phi tiêu tự tìm: ${hitsOn(A, B.you, n).length} phi tiêu trúng đối thủ đứng lệch`);
  await close();
}
{ // ---- Shiden: sét nảy + phán quyết ----
  console.log('Shiden: Lôi Tiễn Liên Hoàn + Thiên Lôi Phán Quyết');
  const { cl: [A, B, C], close } = await mk(['shiden', 'gantetsu', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; C.pos = [5, 0, -8]; await sleep(200);
  await awaken(A, B, 1);
  await sleep(800);
  let n = A.log.length;
  cast(A, 1, { aw: 1 }); await sleep(500);
  ok(hitsOn(A, C.you, n).some(h => h.dmg === 6), 'lôi tiễn trúng B, sét nảy sang C (6 sát thương)');
  await sleep(800);
  n = A.log.length;
  cast(A, 4, { aw: 1 }); await sleep(1900);
  const sm = A.log.slice(n).find(m => m.t === 'chain' && m.sky);
  const hb = hitsOn(A, B.you, n).filter(h => h.fx === 'judgement');
  ok(sm && sm.pts.length === 2 && hb.length === 1 && hb[0].dmg >= 20 && hb[0].stun, `phán quyết giáng sét ${sm?.pts.length} người, B nhận ${hb[0]?.dmg}`);
  await close();
}
{ // ---- Kage: ra sau lưng + vạn ảnh táng + phân thân ----
  console.log('Kage: Bối Ảnh Bộ + Vạn Ảnh Táng + phân thân');
  // D làm bia để tích thanh, B và C còn đầy máu cho Vạn Ảnh Táng
  const { cl: [A, B, C, D], close } = await mk(['kage', 'gantetsu', 'gantetsu', 'gantetsu']);
  A.pos = [0, 0, -14]; D.pos = [0, 0, -10]; B.pos = [-25, 0, 0]; C.pos = [25, 0, 0]; await sleep(200);
  await awaken(A, D, 1);
  D.pos = [0, 0, 30]; B.pos = [0, 0, -10]; C.pos = [4, 0, -6]; B.yaw = Math.PI; C.yaw = 0;
  await sleep(500);
  let n = A.log.length;
  cast(A, 0, { aw: 1 }); await sleep(500);
  B.pos = [0, 0, -12];
  n = A.log.length;
  cast(A, 0, { aw: 1 }); await sleep(500);
  const js = hitsOn(A, B.you, n);
  ok(js.length === 3, `Vạn Ảnh Trảm: ${js.length} nhát (1 + 2 phân thân): ${js.map(h => h.dmg)}`);
  B.pos = [0, 0, -6]; await sleep(300);
  n = A.log.length;
  cast(A, 2, { aw: 1 }); await sleep(400);
  const tp = A.log.slice(n).find(m => m.t === 'tp' && m.id === A.you);
  // B nhìn về -z (yaw = π) → sau lưng B là phía +z
  ok(tp && tp.p[2] > -6, `Bối Ảnh Bộ: dịch chuyển ra sau lưng B tại (${tp?.p})`);
  A.pos = tp ? tp.p : A.pos;
  await sleep(500);
  n = A.log.length;
  cast(A, 4, { aw: 1 }); await sleep(3000);
  const tps = A.log.slice(n).filter(m => m.t === 'tp' && m.id === A.you).length;
  const hB = hitsOn(A, B.you, n).filter(h => h.fx === 'shadowStep').length, hC = hitsOn(A, C.you, n).filter(h => h.fx === 'shadowStep').length;
  ok(tps === 5 && hB + hC === 5 && hB >= 2 && hC >= 2, `Vạn Ảnh Táng: ${tps} lần dịch chuyển, chém B ${hB} / C ${hC} nhát`);
  await close();
}
{ // ---- Raiga: lướt đấm nhiều nhịp + chưởng lái ----
  console.log('Raiga: Liên Hoàn Thiểm Quyền + Bạo Long Chưởng');
  const { cl: [A, B], close } = await mk(['raiga', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; await sleep(200);
  await awaken(A, B, 1);
  B.pos = [0, 0, -8];
  await sleep(300);
  let n = A.log.length;
  cast(A, 2, { aw: 1 }); await sleep(800);
  const dh = hitsOn(A, B.you, n).filter(h => h.fx === 'flurry');
  ok(dh.length >= 2, `lướt đấm trúng ${dh.length} nhịp`);
  B.pos = [8, 0, -8]; A.pos = [0, 0, -14]; await sleep(300);
  n = A.log.length;
  cast(A, 3, { aw: 1 });
  // lái tia sang phải về phía B
  for (let i = 0; i < 25; i++) { A.send({ t: 'steer', a: [8, 1, -8] }); await sleep(66); }
  await sleep(800);
  ok(hitsOn(A, B.you, n).filter(h => h.fx === 'beam').length >= 3, `chưởng lái theo tâm quét trúng B lệch 53°: ${hitsOn(A, B.you, n).filter(h => h.fx === 'beam').length} nhịp`);
  await close();
}
{ // ---- ngắm dọc ----
  console.log('Ngắm dọc: bắn đối thủ đang bay cao');
  const { cl: [A, B], close } = await mk(['kaze', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 9, -9]; await sleep(250);
  const dx = 0, dy = 9, dz = 5, L = Math.hypot(dx, dy, dz);
  const n = A.log.length;
  A.send({ t: 'cast', sk: 1, cs: cs++, seed: 5, p: A.pos, d: [dx / L, dy / L, dz / L] }); await sleep(600);
  ok(hitsOn(A, B.you, n).length >= 1, `phi tiêu bay chếch ${Math.round(Math.atan2(dy, dz) * 57)}° trúng đối thủ ở độ cao 9 m (${hitsOn(A, B.you, n).length} phi tiêu)`);
  await close();
}
console.log(fails ? `\n${fails} kiểm tra LỖI` : '\nTất cả đều qua');
process.exit(fails ? 1 : 0);
