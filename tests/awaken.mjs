// Kiểm tra dị biến ở server: thanh tích, kích hoạt, bộ chiêu mới, nội tại, kiểu chiêu mới, ngắm dọc,
// dị biến v2 (cọc sét + hàng rào điện, cột đá + nhổ cột + động đất, lướt 3 chiều + phân thân gió, bay tự do,
// vệt lửa + boomerang + hồi sinh, phân thân mồi + đổi chỗ + sương đêm, sàn băng + tường băng + vùng ngưng đọng,
// giữ phím tụ lực + túm ném, cây bắn gai + người cây) và chế độ đấu tập (bia tập, võ sĩ máy, nạp đầy thanh).
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
  const c = { ws, log: [], pos: [0, 0, 0], yaw: 0, f: 0 };
  ws.onmessage = ev => { const m = JSON.parse(ev.data); c.log.push(m); if (m.t === 'joined') { c.you = m.you; c.room = m.room; } };
  c.send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
  c.ready = new Promise(r => ws.onopen = r);
  return c;
}
let cs = 1;
async function room(chars, mode) {
  const cl = chars.map(() => client());
  for (const c of cl) await c.ready;
  cl.forEach((c, i) => c.send({ t: 'hello', name: 'P' + i, char: chars[i] }));
  cl[0].send({ t: 'create', name: 'aw', map: 'tournament', mode }); await sleep(200);
  for (const c of cl.slice(1)) c.send({ t: 'join', id: cl[0].room.id });
  await sleep(250);
  const tick = setInterval(() => { for (const c of cl) c.send({ t: 's', p: c.pos, r: c.yaw, a: 0, f: c.f }); }, 33);
  return { cl, close: async () => { clearInterval(tick); for (const c of cl) c.ws.close(); await sleep(150); } };
}
const cast = (c, sk, extra = {}) => c.send({ t: 'cast', sk, cs: cs++, seed: 5, p: c.pos, d: [0, 0, 1], ...extra });
const hitsOn = (c, tid, from = 0) => c.log.slice(from).filter(m => m.t === 'hit' && m.tid === tid);
const snapOf = (c, id) => c.log.filter(m => m.t === 'snap').pop()?.ps.find(p => p[0] === id);
const gauge = (c, id) => snapOf(c, id)?.[9] ?? 0;
const propsOf = (c, kind) => { const m = new Map(); for (const q of c.log) if (q.t === 'prop') { if (q.end) m.delete(q.id); else if (q.k) m.set(q.id, q); } return [...m.values()].filter(q => !kind || q.k === kind); };
const norm = (x, y, z) => { const L = Math.hypot(x, y, z); return [x / L, y / L, z / L]; };
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
const mk = async (chars, mode) => { const r = await room(chars, mode); r.cl.forEach((c, i) => c.char = chars[i]); return r; };

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
  // D làm bia để tích thanh, B (Kage) còn đầy máu để bắn thử vào giáp đá
  const { cl: [A, B, D], close } = await mk(['gantetsu', 'kage', 'raiga']);
  A.pos = [0, 0, -14]; D.pos = [0, 0, -10]; B.pos = [25, 0, 0]; await sleep(200);
  const { on } = await awaken(A, D, 1);
  ok(!!on, 'Gantetsu dị biến');
  D.pos = [-25, 0, 25]; B.pos = [0, 0, -10]; await sleep(300);
  // Sơn Thần Giáp: giảm 30%, không bị choáng
  let n = A.log.length;
  B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] }); await sleep(450);
  const hk = hitsOn(B, A.you, n);
  ok(hk.length && hk.every(h => h.dmg === Math.max(1, Math.round(6 * 0.7))), `phi đao vào giáp đá: ${hk.map(h => h.dmg)} (6 × 0.7)`);
  // Dựng Sơn Trụ: cột đá trồi lên dưới chân đối thủ ở tâm ngắm → hất tung
  n = A.log.length;
  B.pos = [0, 0, -6]; await sleep(150);
  cast(A, 3, { aw: 1, a: [0, 0, -6] }); await sleep(500);
  const hp1 = hitsOn(A, B.you, n).find(h => h.fx === 'stonePillar');
  ok(hp1 && hp1.kb[1] >= 14, `cột đá trồi dưới chân đối thủ: ${hp1?.dmg} sát thương, hất lên ${hp1?.kb[1]}`);
  ok(propsOf(A, 'pillar').length === 1 && B.log.some(m => m.t === 'prop' && m.k === 'pillar'), 'cột đá thành công trình, cả phòng nhận gói prop');
  // dựng thêm 3 cột: chỉ giữ tối đa 3
  for (const x of [-4, 4, 0]) { await sleep(2300); cast(A, 3, { aw: 1, a: [x, 0, -18] }); }
  await sleep(500);
  ok(propsOf(A, 'pillar').length === 3, `tối đa 3 cột đá (đang có ${propsOf(A, 'pillar').length})`);
  // Nhổ Sơn Thạch: nhổ cột gần nhất ném vào đối thủ
  B.pos = [0, 0, -4]; await sleep(300);
  const near = propsOf(A, 'pillar').sort((a, b) => Math.hypot(a.p[0], a.p[2] + 14) - Math.hypot(b.p[0], b.p[2] + 14))[0];
  n = A.log.length;
  cast(A, 1, { aw: 1, rp: near.id, d: norm(0 - near.p[0], 0, -4 - near.p[2]) }); await sleep(1300);
  const rc = A.log.slice(n).find(m => m.t === 'cast' && m.id === A.you);
  ok(rc?.rp === near.id && A.log.slice(n).some(m => m.t === 'prop' && m.id === near.id && m.end === 'rip'), 'nhổ đúng cột đá (cột biến mất, cast kèm rp)');
  const hr = hitsOn(A, B.you, n);
  ok(hr.some(h => h.dmg >= 20 && h.fx === 'pillarThrow'), `cột đá ném trúng: ${hr.map(h => h.dmg)}`);
  // Địa Chấn Toàn Sân: B đứng dưới đất bị choáng, C... dùng B nhảy lên để né
  await sleep(500);
  n = A.log.length;
  B.pos = [3, 0, -6];
  cast(A, 4, { aw: 1 }); await sleep(1700);
  const hq = hitsOn(A, B.you, n).find(h => h.fx === 'groundQuake');
  ok(hq && hq.dmg >= 26 && hq.stun, `động đất trúng người đứng dưới đất: ${hq?.dmg}, choáng ${hq?.stun}s`);
  ok(A.log.slice(n).some(m => m.t === 'pulse' && m.k === 'rock') && !propsOf(A, 'pillar').length, 'động đất làm vỡ hết cột đá còn lại');
  await sleep(6500);
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
{ // ---- Gantetsu: nhảy lên né động đất ----
  console.log('Gantetsu: nhảy lên né Địa Chấn Toàn Sân');
  const { cl: [A, B, C], close } = await mk(['gantetsu', 'kage', 'kage']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; C.pos = [20, 0, 10]; await sleep(200);
  await awaken(A, B, 1);
  B.pos = [4, 0, -8]; C.pos = [-4, 3, -8];   // C đang ở trên không
  await sleep(300);
  const n = A.log.length;
  cast(A, 4, { aw: 1 }); await sleep(1700);
  ok(hitsOn(A, B.you, n).some(h => h.fx === 'groundQuake' && h.stun), 'B đứng dưới đất: trúng động đất');
  ok(!hitsOn(A, C.you, n).some(h => h.fx === 'groundQuake') && A.log.slice(n).some(m => m.t === 'evade' && m.id === C.you), 'C đang ở trên không: né được (gói evade)');
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
  ok(burns.length >= 4 && burns.every(h => h.dmg === 2), `chém trúng (đối thủ đứng trong vệt lửa) → bỏng ${burns.length} nhịp × ${burns[0]?.dmg}`);
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
  ok(h && hp1 >= hp0, `roi gai ${h?.dmg} sát thương → hồi ${hp1 - hp0} máu (hút 12%)`);
  ok(h && h.kb[2] < 0, 'roi gai kéo đối thủ về phía Midori');
  await close();
}
{ // ---- Kaze: tường gió ----
  console.log('Kaze: Thiên Phong Bích');
  const { cl: [A, B, C], close } = await mk(['kaze', 'raiga', 'raiga']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -4]; C.pos = [-25, 0, 20]; await sleep(200);
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
  // Phong Ảnh Bộ: lướt chếch lên trời trúng đối thủ đang bay, 0.4 s sau phân thân gió chém lại (C còn đầy máu)
  await sleep(300);
  B.pos = [25, 0, 20]; C.pos = [0, 6, -6]; await sleep(250);
  n = A.log.length;
  cast(A, 2, { aw: 1, d: norm(0, 6, 8) }); await sleep(1000);
  const hd = hitsOn(A, C.you, n);
  ok(hd.some(h => h.fx === 'windDash'), `lướt 3 chiều trúng đối thủ ở độ cao 6 m (${hd.map(h => h.fx + ':' + h.dmg)})`);
  ok(hd.some(h => h.fx === 'windClone') && A.log.slice(n).some(m => m.t === 'pulse' && m.k === 'windClone'), 'phân thân gió chém thêm 1 nhát');
  // bay tự do không tốn mana: gửi cờ bay 2 giây
  A.pos = [0, 5, -14]; A.f = 1; await sleep(300);
  const mp0 = snapOf(A, A.you)[7];
  await sleep(2000);
  const mp1 = snapOf(A, A.you)[7];
  ok(mp1 >= mp0, `đang bay 2 giây: mana ${mp0} → ${mp1} (không tốn mana)`);
  // đang ở trên không nhận thêm 15% sát thương
  C.pos = [0, 5, -10]; await sleep(300);
  n = C.log.length;
  C.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: C.pos, d: [0, 0, -1] }); await sleep(500);
  const dk = CHARACTERS.find(c => c.id === 'raiga').skills[1].dmg;
  const ha = hitsOn(C, A.you, n)[0];
  ok(ha && ha.dmg === Math.round(dk * 1.15), `Kaze đang bay trúng khí đạn: ${ha?.dmg} (${dk} × 1.15)`);
  A.f = 0;
  await close();
}
{ // ---- Shiden: sét nảy + phán quyết ----
  console.log('Shiden: cọc sét + hàng rào điện + Lôi Độn + Thiên Lôi Phán Quyết');
  const { cl: [A, B, C], close } = await mk(['shiden', 'gantetsu', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; C.pos = [5, 0, -8]; await sleep(200);
  await awaken(A, B, 1);
  // ra khỏi bục giữa sân để thương bay thẳng 20 m
  A.pos = [14, 0, -14]; B.pos = [-25, 0, -10]; C.pos = [-25, 0, 10];
  await sleep(800);
  // 2 thương bay chéo không trúng ai: cắm thành 2 cọc cách nhau ~8 m ở 20 m phía trước
  let n = A.log.length;
  cast(A, 1, { aw: 1, d: [Math.sin(-0.2), 0, Math.cos(-0.2)] }); await sleep(1000);
  cast(A, 1, { aw: 1, d: [Math.sin(0.2), 0, Math.cos(0.2)] }); await sleep(1000);
  const rods = propsOf(A, 'rod');
  ok(rods.length === 2 && Math.abs(Math.hypot(rods[0].p[0] - rods[1].p[0], rods[0].p[2] - rods[1].p[2]) - 8) < 1.5, `2 thương không trúng ai thành 2 cọc sét: ${rods.map(r => '(' + r.p[0] + ',' + r.p[2] + ')').join(' ')}`);
  // đối thủ đi xuyên qua hàng rào điện
  const mx = (rods[0].p[0] + rods[1].p[0]) / 2, mz = (rods[0].p[2] + rods[1].p[2]) / 2;
  n = A.log.length;
  B.pos = [mx, 0, mz]; await sleep(1000);
  const hf = hitsOn(A, B.you, n).filter(h => h.fx === 'fence');
  ok(hf.length >= 1 && hf[0].dmg === 8, `hàng rào điện: ${hf.length} lần chạm × ${hf[0]?.dmg} sát thương`);
  n = A.log.length;
  B.pos = [mx, 3, mz]; await sleep(1000);
  ok(!hitsOn(A, B.you, n).some(h => h.fx === 'fence'), 'nhảy lên cao hơn hàng rào: không bị giật');
  // Thiên Lôi Phán Quyết: sét trời + mỗi cọc phóng thêm 1 tia vào đối thủ gần nó
  B.pos = [mx, 0, mz - 3]; await sleep(300);   // trong tầm 22 m của Shiden, cách mỗi cọc ~5 m
  n = A.log.length;
  cast(A, 4, { aw: 1 }); await sleep(1900);
  const sm = A.log.slice(n).find(m => m.t === 'chain' && m.sky);
  const hb = hitsOn(A, B.you, n).filter(h => h.fx === 'judgement');
  const rodBolts = A.log.slice(n).filter(m => m.t === 'chain' && m.nosky).length;
  ok(sm && hb.some(h => h.dmg >= 30 && h.stun), `phán quyết giáng sét ${sm?.pts.length} người, B nhận ${hb.map(h => h.dmg)}`);
  ok(rodBolts === 2 && hb.filter(h => h.dmg === 14).length === 2, `2 cọc sét cùng phóng tia vào B (${rodBolts} tia)`);
  // Lôi Độn: dịch chuyển tới cọc gần tâm ngắm nhất
  B.pos = [-25, 0, -10];
  await sleep(300);
  n = A.log.length;
  cast(A, 2, { aw: 1, d: norm(rods[1].p[0] - 14, 0, rods[1].p[2] + 14) }); await sleep(400);
  const tp = A.log.slice(n).find(m => m.t === 'tp' && m.id === A.you);
  ok(tp && Math.hypot(tp.p[0] - rods[1].p[0], tp.p[2] - rods[1].p[2]) < 1.5, `Lôi Độn tới cọc sét: (${tp?.p}) ~ (${rods[1].p[0]}, ${rods[1].p[2]})`);
  if (tp) A.pos = tp.p;
  await sleep(400);
  // Lôi Võng: mọi cọc trong 16 m cũng phóng vòng sét
  n = A.log.length;
  cast(A, 3, { aw: 1 }); await sleep(1300);
  const pz = A.log.slice(n).find(m => m.t === 'pulse' && m.k === 'zap');
  ok(pz && pz.pts.length === 2, `lưới sét: ${pz?.pts.length} cọc cùng phóng vòng sét`);
  // cọc sét đánh phá được: cắm cọc mới rồi cho B đấm
  await sleep(1500);
  n = A.log.length;
  cast(A, 1, { aw: 1, d: [-1, 0, 0] }); await sleep(900);
  const rod0 = A.log.slice(n).find(m => m.t === 'prop' && m.k === 'rod');
  ok(!!rod0, 'cắm thêm cọc mới (cọc cũ nhất bị thay nếu quá 3)');
  if (rod0) {
    n = A.log.length;
    B.pos = [rod0.p[0], 0, rod0.p[2] - 2.2]; await sleep(300);
    for (let i = 0; i < 6; i++) { B.send({ t: 'cast', sk: 0, cs: cs++, seed: 1, p: B.pos, d: [0, 0, 1] }); await sleep(500); }
    ok(A.log.slice(n).some(m => m.t === 'prop' && m.id === rod0.id && m.end === 'break'), 'đối thủ đấm vỡ cọc sét (30 máu)');
  }
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
  console.log('Raiga: Bạo Trảo Quăng + Tụ Khí Đạn + Bạo Long Chưởng');
  // D làm bia để tích thanh, B còn đầy máu
  const { cl: [A, B, D], close } = await mk(['raiga', 'gantetsu', 'gantetsu']);
  A.pos = [0, 0, -14]; D.pos = [0, 0, -10]; B.pos = [25, 0, 0]; await sleep(200);
  await awaken(A, D, 1);
  D.pos = [-25, 0, 20];
  B.pos = [0, 0, -8];
  await sleep(300);
  let n = A.log.length;
  cast(A, 2, { aw: 1 }); await sleep(400);
  const lifted = snapOf(A, B.you)?.[2];
  await sleep(900);
  const gb = A.log.slice(n).find(m => m.t === 'grab' && m.id === B.you);
  const slam = hitsOn(A, B.you, n).find(h => h.fx === 'grabSlam'), thr = hitsOn(A, B.you, n).find(h => h.fx === 'grabThrow');
  ok(gb && lifted > 1.2, `túm được đối thủ, nhấc bổng lên ${lifted} m`);
  ok(slam?.stun && thr && Math.hypot(thr.kb[0], thr.kb[2]) >= 20, `quật xuống (${slam?.dmg}, choáng ${slam?.stun}s) rồi ném văng (${thr?.dmg}, lực ${thr && Math.round(Math.hypot(thr.kb[0], thr.kb[2]))})`);
  await sleep(500);
  // Tụ Khí Đạn: giữ phím 1.5 giây → sát thương ×2.2
  B.pos = [0, 0, -8]; await sleep(300);
  n = A.log.length;
  A.send({ t: 'hold', sk: 1 }); await sleep(1500);
  cast(A, 1, { aw: 1, hold: 1.5 }); await sleep(600);
  const hc = A.log.slice(n).find(m => m.t === 'cast' && m.id === A.you);
  const hh = hitsOn(A, B.you, n)[0];
  ok(hc?.hk === 1 && hh?.dmg === 18, `giữ K 1.5 s: cast hk=${hc?.hk}, khí đạn ${hh?.dmg} sát thương (8 × 2.2)`);
  await sleep(500);
  n = A.log.length;
  cast(A, 1, { aw: 1, hold: 1.5 }); await sleep(600);   // không gửi 'hold' trước: không được tính tụ lực
  ok(!A.log.slice(n).find(m => m.t === 'cast' && m.id === A.you)?.hk && hitsOn(A, B.you, n)[0]?.dmg === 8, 'báo giữ phím mà không có gói hold: không được tụ lực');
  B.pos = [8, 0, -8]; A.pos = [0, 0, -14]; await sleep(300);
  n = A.log.length;
  cast(A, 3, { aw: 1 });
  // lái tia sang phải về phía B
  for (let i = 0; i < 25; i++) { A.send({ t: 'steer', a: [8, 1, -8] }); await sleep(66); }
  await sleep(800);
  ok(hitsOn(A, B.you, n).filter(h => h.fx === 'beam').length >= 3, `chưởng lái theo tâm quét trúng B lệch 53°: ${hitsOn(A, B.you, n).filter(h => h.fx === 'beam').length} nhịp`);
  await close();
}
{ // ---- đấu tập ----
  console.log('Đấu tập: bia tập, võ sĩ máy, nạp đầy thanh');
  const { cl: [A], close } = await mk(['kaze'], 'practice');
  A.pos = [0, 0, -14]; await sleep(300);
  const jn = A.log.find(m => m.t === 'joined');
  const fakes = jn.players.filter(p => p.fk);
  ok(jn.room.practice && fakes.filter(p => p.fk === 'dummy').length === 2 && fakes.filter(p => p.fk === 'bot').length === 1, `phòng đấu tập có ${fakes.map(p => p.fk).join(', ')}`);
  const lister = client(); await lister.ready; lister.send({ t: 'list' }); await sleep(200);
  const info = lister.log.find(m => m.t === 'rooms')?.list.find(r => r.id === jn.room.id);
  ok(info?.mode === 'practice' && info.count === 1, `danh sách phòng: chế độ ${info?.mode}, ${info?.count} người chơi thật`);
  lister.ws.close();
  // võ sĩ máy tự tìm tới đánh
  const bot = fakes.find(p => p.fk === 'bot');
  A.pos = [0, 0, 6]; await sleep(9000);
  ok(hitsOn(A, A.you).some(h => h.sid === bot.id), `võ sĩ máy đánh A: ${hitsOn(A, A.you).filter(h => h.sid === bot.id).map(h => h.dmg)}`);
  // bia tập: đánh rồi tự hồi đầy máu
  const dm = fakes.find(p => p.fk === 'dummy');
  A.pos = [dm.x, 0, dm.z - 2]; await sleep(300);
  let n = A.log.length;
  cast(A, 1); await sleep(500);
  const hd = hitsOn(A, dm.id, n)[0];
  await sleep(3200);
  ok(hd && snapOf(A, dm.id)[6] === dm.hp, `bia tập trúng ${hd?.dmg} sát thương, 2.5 s sau hồi đầy (${snapOf(A, dm.id)[6]})`);
  // nạp đầy thanh và biến hình
  A.send({ t: 'pfill' }); await sleep(200);
  ok(gauge(A, A.you) === 100, 'P / nút ⚡: thanh dị biến đầy ngay');
  n = A.log.length;
  A.send({ t: 'awk' }); await sleep(300);
  ok(A.log.slice(n).some(m => m.t === 'awk' && m.on), 'biến hình được khi chơi một mình');
  await close();
  await sleep(300);
  const l2 = client(); await l2.ready; l2.send({ t: 'list' }); await sleep(200);
  ok(!l2.log.find(m => m.t === 'rooms')?.list.some(r => r.id === jn.room.id), 'người thật cuối cùng rời đi: phòng đấu tập bị xoá');
  l2.ws.close();
}
{ // ---- Homura v2 ----
  console.log('Homura: vệt lửa + boomerang + Niết Bàn + hồi sinh');
  const { cl: [A, B, C, D], close } = await mk(['homura', 'kage', 'kage', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; C.pos = [20, 0, 20]; await sleep(200);
  D.pos = B.pos; B.pos = [25, 0, 0]; await sleep(200);
  await awaken(A, D, 1);
  D.pos = [-25, 0, 25];
  B.pos = [20, 0, -20];
  // chạy 5 m: để lại vệt lửa
  let n = A.log.length;
  for (let i = 1; i <= 10; i++) { A.pos = [12, 0, -14 + i * 0.5]; await sleep(60); }
  await sleep(200);
  const fz = A.log.slice(n).filter(m => m.t === 'zone' && m.k === 'fire');
  ok(fz.length >= 2, `chạy 5 m để lại ${fz.length} vệt lửa`);
  // đối thủ đứng vào vệt lửa → bỏng
  n = A.log.length;
  B.pos = [12, 0, -12]; await sleep(1500);
  ok(hitsOn(A, B.you, n).some(h => h.fx === 'burn'), `đứng trong lửa bị bỏng: ${hitsOn(A, B.you, n).filter(h => h.fx === 'burn').length} nhịp`);
  // Hồi Nguyệt Viêm: trúng cả lượt đi lẫn lượt về
  A.pos = [12, 0, -14]; B.pos = [12, 0, -8]; await sleep(300);
  n = A.log.length;
  cast(A, 1, { aw: 1 }); await sleep(1700);
  const bh = hitsOn(A, B.you, n).filter(h => h.fx === 'crescent');
  ok(bh.length === 2, `boomerang trúng ${bh.length} lần (đi + về)`);
  // Phượng Hoàng Niết Bàn: vệt lửa dưới chân B bùng lên
  await sleep(300);
  // chém J để lại vệt lửa ngay dưới chân B (vệt lửa chỉ sống 3 giây)
  B.pos = [12, 0, -11.8]; await sleep(200);
  cast(A, 0, { aw: 1 }); await sleep(450);
  n = A.log.length;
  cast(A, 4, { aw: 1, d: [-1, 0, 0] }); await sleep(2600);
  ok(hitsOn(A, B.you, n).some(h => h.fx === 'flameBurst') && A.log.slice(n).some(m => m.t === 'pulse' && m.k === 'flame'), 'Niết Bàn: vệt lửa dưới chân đối thủ bùng thành cột lửa');
  // hồi sinh: B và C đánh gục Homura đang dị biến
  B.pos = [12, 0, -10]; C.pos = [12, 0, -18]; A.pos = [12, 0, -14]; await sleep(300);
  n = A.log.length;
  const t0 = Date.now();
  while (!A.log.slice(n).some(m => m.t === 'revive' || m.t === 'die' && m.id === A.you) && Date.now() - t0 < 12000) {
    B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] });
    C.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: C.pos, d: [0, 0, 1] });
    await sleep(520);
  }
  const rv = A.log.slice(n).find(m => m.t === 'revive' && m.id === A.you);
  ok(rv && !A.log.slice(n).some(m => m.t === 'die' && m.id === A.you) && rv.hp === 45, `gục khi đang dị biến: hồi sinh với ${rv?.hp} máu (30%)`);
  ok(A.log.slice(n).some(m => m.t === 'awk' && m.id === A.you && !m.on), 'hồi sinh xong thì hết dị biến');
  await close();
}
{ // ---- Kage v2 ----
  console.log('Kage: phân thân mồi + Hoán Ảnh + sương đêm');
  const { cl: [A, B, D], close } = await mk(['kage', 'gantetsu', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; await sleep(200);
  D.pos = B.pos; B.pos = [25, 0, 0]; await sleep(200);
  await awaken(A, D, 1);
  D.pos = [-25, 0, 25];
  B.pos = [14, 0, -4];
  await sleep(300);
  let n = A.log.length, nb = B.log.length;
  cast(A, 3, { aw: 1 }); await sleep(500);
  const dA = A.log.slice(n).filter(m => m.t === 'pjoin').map(m => m.player), dB = B.log.slice(nb).filter(m => m.t === 'pjoin').map(m => m.player);
  ok(dA.length === 2 && dA.every(p => p.fk === 'decoy' && p.ms === A.you), 'chủ thấy 2 phân thân (biết là phân thân)');
  ok(dB.length === 2 && dB.every(p => !p.fk && p.name === 'P0' && p.char === 'kage'), 'đối thủ thấy 2 "Kage" y như thật');
  ok(A.log.slice(n).some(m => m.t === 'buff' && m.id === A.you && m.stealth), 'Kage tàng hình khi thả phân thân');
  await sleep(600);
  const s1 = snapOf(A, dA[0].id), s2 = snapOf(A, dA[1].id);
  ok(s1 && s2 && Math.hypot(s1[1] - s2[1], s1[3] - s2[3]) > 3, `2 phân thân chạy chéo tách xa nhau (${s1 && Math.round(Math.hypot(s1[1] - s2[1], s1[3] - s2[3]))} m)`);
  // Hoán Ảnh: đổi chỗ với phân thân thứ hai
  const d1 = snapOf(A, dA[1].id);
  n = A.log.length;
  cast(A, 2, { aw: 1, d: norm(d1[1] - A.pos[0], 0, d1[3] - A.pos[2]) }); await sleep(400);
  const tps = A.log.slice(n).filter(m => m.t === 'tp');
  ok(tps.some(m => m.id === A.you && Math.hypot(m.p[0] - d1[1], m.p[2] - d1[3]) < 3) && tps.some(m => m.id === dA[1].id), 'Hoán Ảnh: Kage tới chỗ phân thân, phân thân về chỗ Kage');
  // phân thân đầu dừng chạy (sau 3.75 s) thì B đấm tan nó
  await sleep(2700);
  const d0 = snapOf(B, dA[0].id);
  B.pos = [d0[1], 0, d0[3] - 2]; await sleep(200);
  n = A.log.length;
  B.send({ t: 'cast', sk: 0, cs: cs++, seed: 1, p: B.pos, d: [0, 0, 1] }); await sleep(400);
  ok(A.log.slice(n).some(m => m.t === 'pleave' && m.why === 'pop') && A.log.slice(n).some(m => m.t === 'pulse' && m.k === 'shadowPop'), 'đối thủ đánh trúng phân thân: phân thân tan, nổ bóng');
  ok(hitsOn(A, B.you, n).some(h => h.fx === 'shadowPop' && h.slow), 'nổ bóng làm chậm đối thủ đứng gần');
  // Vạn Ảnh Táng + sương đêm
  const tp = tps.find(m => m.id === A.you);
  if (tp) A.pos = tp.p;
  B.pos = [A.pos[0] + 4, 0, A.pos[2] + 4];
  await sleep(1500);
  n = A.log.length;
  cast(A, 4, { aw: 1 }); await sleep(1600);
  const dk = A.log.slice(n).find(m => m.t === 'dark');
  ok(dk && dk.ids.includes(B.you) && !dk.ids.includes(A.you) && dk.see === 6, `sương đêm phủ đối thủ trong tầm (${dk?.dur}s, chỉ thấy ${dk?.see} m)`);
  await close();
}
{ // ---- Yuki v2 ----
  console.log('Yuki: sàn băng + Băng Tường + Thời Băng Giới');
  const { cl: [A, B, D], close } = await mk(['yuki', 'raiga', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; await sleep(200);
  D.pos = B.pos; B.pos = [25, 0, 0]; await sleep(200);
  await awaken(A, D, 1);
  D.pos = [-25, 0, 25];
  let n = A.log.length;
  cast(A, 0, { aw: 1 }); await sleep(500);
  ok(A.log.slice(n).some(m => m.t === 'zone' && m.k === 'ice'), 'Băng Tinh Đạn đóng băng sàn chỗ trúng');
  B.pos = [20, 0, 20]; A.pos = [12, 0, -14]; await sleep(300);
  n = A.log.length;
  cast(A, 2, { aw: 1 }); await sleep(600);
  ok(A.log.slice(n).filter(m => m.t === 'zone' && m.k === 'ice').length >= 4, `trượt băng để lại ${A.log.slice(n).filter(m => m.t === 'zone' && m.k === 'ice').length} vệt băng`);
  // Băng Tường chắn đạn đối thủ
  A.pos = [12, 0, -14]; B.pos = [12, 0, -4]; await sleep(300);
  n = A.log.length;
  cast(A, 3, { aw: 1 }); await sleep(500);
  const iw = A.log.slice(n).filter(m => m.t === 'prop' && m.k === 'iceWall');
  ok(iw.length === 5, `dựng ${iw.length} khối tường băng`);
  n = A.log.length;
  B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] }); await sleep(600);
  ok(!hitsOn(B, A.you, n).length, 'khí đạn của đối thủ bị tường băng chặn');
  // B đập vỡ khối giữa → mảnh băng làm chậm
  const mid = iw[2];
  B.pos = [mid.p[0], 0, mid.p[2] + 2]; await sleep(300);
  n = A.log.length;
  for (let i = 0; i < 6 && !A.log.slice(n).some(m => m.t === 'prop' && m.id === mid.id && m.end); i++) { B.send({ t: 'cast', sk: 0, cs: cs++, seed: 1, p: B.pos, d: [0, 0, -1] }); await sleep(450); }
  ok(A.log.slice(n).some(m => m.t === 'prop' && m.id === mid.id && m.end === 'break'), 'đối thủ đập vỡ khối băng');
  ok(hitsOn(A, B.you, n).some(h => h.fx === 'iceShatter' && h.slow), 'khối băng vỡ bắn mảnh làm chậm người đập');
  // Thời Băng Giới
  await sleep(500);
  B.pos = [12, 0, -9]; await sleep(200);
  n = A.log.length;
  cast(A, 4, { aw: 1 }); await sleep(1500);
  const sz = A.log.slice(n).find(m => m.t === 'zone' && m.k === 'slow');
  ok(sz && sz.mul === 0.4 && sz.r === 10, `vùng ngưng đọng ${sz?.r} m, tốc độ ×${sz?.mul}`);
  await sleep(4200);
  const tz = hitsOn(A, B.you, n).filter(h => h.fx === 'timeFreeze');
  ok(tz.length >= 7 && tz.some(h => h.dmg >= 22 && h.stun), `trong vùng mất máu ${tz.length} nhịp, hết giờ băng vỡ ${tz.find(h => h.dmg >= 22)?.dmg} + choáng`);
  await close();
}
{ // ---- Midori v2 ----
  console.log('Midori: cây bắn gai + Mộc Thần');
  const { cl: [A, B, D], close } = await mk(['midori', 'gantetsu', 'gantetsu']);
  A.pos = [0, 0, -14]; B.pos = [0, 0, -10]; await sleep(200);
  D.pos = B.pos; B.pos = [25, 0, 0]; await sleep(200);
  await awaken(A, D, 1);
  D.pos = [-25, 0, 25];
  A.pos = [12, 0, -14]; B.pos = [12, 0, -3]; await sleep(300);
  let n = A.log.length;
  cast(A, 2, { aw: 1 }); await sleep(2400);
  const tur = A.log.slice(n).find(m => m.t === 'prop' && m.k === 'turret');
  const ts = hitsOn(A, B.you, n).filter(h => h.fx === 'thorn' && h.sid === A.you);
  ok(tur && ts.length >= 2 && A.log.slice(n).some(m => m.t === 'cast' && m.sub === 'tur'), `cây bắn gai tự bắn đối thủ ${ts.length} lần trong 2 giây`);
  await sleep(800);
  n = A.log.length;
  B.pos = [12, 0, -8];
  cast(A, 4, { aw: 1 }); await sleep(1700);
  const pj = A.log.slice(n).find(m => m.t === 'pjoin' && m.player.fk === 'pet');
  ok(pj && pj.player.ms === A.you && pj.player.char === 'treant', `Mộc Thần xuất hiện (${pj?.player.name})`);
  await sleep(3500);
  const ph = pj ? hitsOn(A, B.you, n).filter(h => h.sid === pj.player.id) : [];
  ok(ph.length >= 1, `Mộc Thần tự đấm đối thủ: ${ph.map(h => h.dmg)}`);
  ok(pj && !hitsOn(A, A.you, n).some(h => h.sid === pj.player.id), 'Mộc Thần không đánh chủ');
  // đối thủ đánh được người cây
  n = A.log.length;
  const ps = snapOf(B, pj.player.id);
  B.send({ t: 'cast', sk: 1, cs: cs++, seed: 1, p: B.pos, d: norm(ps[1] - B.pos[0], 0, ps[3] - B.pos[2]) }); await sleep(800);
  ok(pj && hitsOn(A, pj.player.id, n).length >= 1, 'đối thủ đánh trúng Mộc Thần');
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
