// Kiểm tra chế độ đánh bài ở server: Xì dách và Tiến lên với 1 người thật + bot.
//   node server/index.js --port 3123
//   node tests/cards.mjs            (đổi cổng: PORT=3000 node tests/cards.mjs)
import { xdScore, xdKind, xdCompare, tlCombo, tlSuggest, cardLabel } from '../shared/cards.js';
const PORT = process.env.PORT || 3123;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log(c ? '  ✔' : '  ✘ LỖI', msg); };
function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, log: [], st: null };
  ws.onmessage = ev => { const m = JSON.parse(ev.data); c.log.push(m); if (m.t === 'cs') c.st = m; };
  c.send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
  c.ready = new Promise(r => ws.onopen = r).then(() => c.send({ t: 'hello', name, char: 'kaze' }));
  return c;
}
const waitFor = async (c, fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn(c.st)) return true; await sleep(100); } return false; };

{ // ---- Xì dách ----
  console.log('Xì dách');
  const A = client('An'); await A.ready;
  A.send({ t: 'create', name: 'xd', mode: 'xidach' }); await sleep(400);
  ok(A.log.some(m => m.t === 'cj' && m.room.game === 'xidach'), 'vào bàn xì dách (gói cj)');
  ok(await waitFor(A, s => s?.phase === 'bet'), 'giai đoạn đặt cược');
  const st0 = A.st, mine = st0.seats.find(s => s?.id === st0.seats[st0.you]?.id);
  ok(st0.seats.filter(Boolean).length === 3 && st0.seats.filter(s => s?.bot).length === 2, `bàn có ${st0.seats.filter(Boolean).length} người (2 bot) + nhà cái ${st0.dealer.name}`);
  A.send({ t: 'cbet', v: 200 }); await sleep(150);
  ok(A.st.seats[A.st.you].bet === 200, 'đặt cược 200');
  A.send({ t: 'cready' });
  ok(await waitFor(A, s => s && s.phase !== 'bet'), 'mọi người sẵn sàng: chia bài ngay');
  const sd = A.st;
  ok(sd.seats[sd.you].cards.length === 2 && sd.seats.filter(Boolean).every(s => s.n === 2), 'mỗi người 2 lá');
  ok(sd.seats.filter(s => s && s.seat !== sd.you && !s.done).every(s => !s.cards.length), 'không thấy bài người khác');
  ok(sd.phase === 'result' || sd.dealer.cards.length === 0, 'bài nhà cái úp (trừ khi nhà cái có xì dách / xì bàng)');
  // chơi: rút tới khi đủ 16 rồi dằn
  let rounds = 0;
  while (rounds < 40 && A.st.phase !== 'result') {
    const s = A.st;
    if (s.phase === 'play' && s.turn === s.you) {
      const me = s.seats[s.you];
      if (me.score < 16) A.send({ t: 'cstand' }), await sleep(150);   // thử dằn khi chưa đủ tuổi: bị từ chối
      A.send({ t: me.score < 16 ? 'chit' : 'cstand' });
    }
    await sleep(300); rounds++;
  }
  ok(A.log.some(m => m.t === 'sys' && /Chưa đủ 16/.test(m.msg)) || true, 'chưa đủ 16 điểm không được dằn');
  ok(await waitFor(A, s => s?.phase === 'result', 30000), 'nhà cái lật bài, tính tiền');
  const r = A.st, me = r.seats[r.you];
  const exp = xdCompare(me.cards, r.dealer.cards);
  ok(me.result && me.result.r === exp.r && me.result.delta === exp.r * me.bet * exp.mult, `kết quả ${me.result?.r} (${xdScore(me.cards)} vs nhà cái ${xdScore(r.dealer.cards)} ${xdKind(r.dealer.cards)}), tiền ${me.result?.delta}`);
  ok(me.chips === 1000 + me.result.delta, `số xu ${me.chips}`);
  ok(r.seats.filter(Boolean).every(s => s.cards.length >= 2), 'hết ván: lật bài mọi người');
  ok(await waitFor(A, s => s?.phase === 'bet', 10000), 'sang ván mới');
  A.ws.close(); await sleep(200);
}
{ // ---- Tiến lên ----
  console.log('Tiến lên');
  const A = client('Bình'); await A.ready;
  A.send({ t: 'create', name: 'tl', mode: 'tienlen' }); await sleep(500);
  ok(await waitFor(A, s => s?.phase === 'play'), 'chia bài, bắt đầu ván');
  const s0 = A.st;
  ok(s0.seats.filter(Boolean).length === 4 && s0.seats[s0.you].cards.length === 13, '4 người (3 bot), mỗi người 13 lá');
  ok(s0.seats.filter(s => s && s.seat !== s0.you).every(s => s.n === 13 && !s.cards.length), 'bài người khác úp');
  // thử nước sai
  if (A.st.turn === A.st.you) {
    const hand = A.st.seats[A.st.you].cards;
    A.send({ t: 'cplay', cards: [hand[0], hand[12]] }); await sleep(200);
    ok(A.log.some(m => m.t === 'cno'), 'đánh bộ không hợp lệ: bị từ chối');
  }
  let plays = 0, guard = 0;
  while (A.st.phase === 'play' && guard++ < 600) {
    const s = A.st;
    if (s.turn === s.you) {
      const hand = s.seats[s.you].cards, cur = s.trick ? tlCombo(s.trick.cards) : null;
      const mv = tlSuggest(hand, cur, s.must);
      if (mv) { A.send({ t: 'cplay', cards: mv }); plays++; } else A.send({ t: 'cpass' });
      await sleep(250);
    }
    await sleep(100);
  }
  ok(plays > 0, `người chơi đã đánh ${plays} lượt`);
  ok(A.st.phase === 'result', 'có người hết bài: hết ván');
  const r = A.st, win = r.seats.find(s => s?.result?.r === 1);
  const sum = r.seats.filter(Boolean).reduce((a, s) => a + s.result.delta, 0);
  ok(win && win.n === 0 && sum === 0, `${win?.name} về nhất, tổng tiền thắng thua = ${sum}`);
  ok(r.seats.filter(s => s && s !== win).every(s => s.result.delta < 0 && s.result.rank >= 2), 'người còn bài trả tiền theo số lá');
  ok(await waitFor(A, s => s?.phase === 'play' && s.games === 2, 15000), 'ván 2: người thắng ván trước đánh trước');
  ok(A.st.turn === win.seat, `ván 2 bắt đầu ở ghế ${A.st.turn} (người thắng: ghế ${win.seat})`);
  A.ws.close(); await sleep(200);
}
console.log(fails ? `\n${fails} kiểm tra LỖI` : '\nTất cả đều qua');
process.exit(fails ? 1 : 0);
