// Kiểm tra chế độ đánh bài ở server: phòng chờ (sẵn sàng / bắt đầu), chủ phòng làm nhà cái, Xì dách và Tiến lên với bot.
//   node server/index.js --port 3123
//   node tests/cards.mjs            (đổi cổng: PORT=3000 node tests/cards.mjs)
import { xdScore, xdKind, xdCompare, tlCombo, tlSuggest, tlInstantWin, tlHeoFine, cardLabel, RANKS, SUITS } from '../shared/cards.js';
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

{ // ---- luật: tới trắng, thối heo ----
  console.log('Luật Tiến lên: tới trắng, thối heo');
  const c = (r, s) => RANKS.indexOf(r) * 4 + SUITS.indexOf(s);
  ok(tlInstantWin([c('2','♠'),c('2','♣'),c('2','♦'),c('2','♥'),c('3','♠'),c('5','♣'),c('7','♦'),c('9','♥'),c('J','♠'),c('K','♣'),c('4','♦'),c('6','♥'),c('8','♠')]) === 'Tứ quý heo', 'tứ quý heo');
  ok(tlInstantWin(['3','4','5','6','7','8','9','10','J','Q','K','A'].map((r, i) => c(r, SUITS[i % 4])).concat([c('2','♥')])) === 'Sảnh rồng', 'sảnh rồng 3 → A');
  ok(tlInstantWin([c('3','♠'),c('3','♣'),c('6','♦'),c('6','♥'),c('9','♠'),c('9','♣'),c('J','♦'),c('J','♥'),c('K','♠'),c('K','♣'),c('A','♦'),c('A','♥'),c('2','♠')]) === '6 đôi', '6 đôi');
  ok(tlInstantWin([c('5','♠'),c('5','♣'),c('6','♦'),c('6','♥'),c('7','♠'),c('7','♣'),c('8','♦'),c('8','♥'),c('9','♠'),c('9','♣'),c('3','♦'),c('J','♥'),c('2','♠')]) === '5 đôi thông', '5 đôi thông');
  ok(!tlInstantWin([c('3','♠'),c('4','♣'),c('6','♦'),c('6','♥'),c('9','♠'),c('9','♣'),c('J','♦'),c('Q','♥'),c('K','♠'),c('K','♣'),c('A','♦'),c('2','♥'),c('2','♠')]), 'bài thường: không tới trắng');
  const f = tlHeoFine([c('2','♠'), c('2','♥'), c('5','♦')]);
  ok(f.n === 2 && f.xu === 60, `thối 1 heo đen + 1 heo đỏ: phạt ${f.xu} xu`);
}
{ // ---- Xì dách ----
  console.log('Xì dách');
  const A = client('An'); await A.ready;
  A.send({ t: 'create', name: 'xd', mode: 'xidach' }); await sleep(400);
  ok(A.log.some(m => m.t === 'cj' && m.room.game === 'xidach'), 'vào bàn xì dách (gói cj)');
  await sleep(700);
  ok(A.st?.phase === 'lobby' && A.st.host === A.st.me, 'mới vào: ở phòng chờ, chưa chia bài, mình là chủ phòng');
  A.send({ t: 'cstart' });
  ok(await waitFor(A, s => s?.phase === 'bet'), 'chủ phòng bấm Bắt đầu: giai đoạn đặt cược');
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
      A.send({ t: me.score < 16 ? 'chit' : 'cstand' });
    }
    await sleep(300); rounds++;
  }
  ok(await waitFor(A, s => s?.phase === 'result', 30000), 'nhà cái lật bài, tính tiền');
  const r = A.st, me = r.seats[r.you];
  const exp = xdCompare(me.cards, r.dealer.cards);
  ok(me.result && me.result.r === exp.r && me.result.delta === exp.r * me.bet * exp.mult, `kết quả ${me.result?.r} (${xdScore(me.cards)} vs nhà cái ${xdScore(r.dealer.cards)} ${xdKind(r.dealer.cards)}), tiền ${me.result?.delta}`);
  ok(me.chips === 1000 + me.result.delta, `số xu ${me.chips}`);
  ok(r.seats.filter(Boolean).every(s => s.cards.length >= 2), 'hết ván: lật bài mọi người');
  ok(await waitFor(A, s => s?.phase === 'bet', 10000), 'sang ván mới');
  // bớt hết máy: chỉ còn mình với nhà cái
  A.send({ t: 'cbot', d: -1 }); await sleep(150); A.send({ t: 'cbot', d: -1 }); await sleep(250);
  ok(A.st.seats.filter(Boolean).length === 1 && A.st.botWant === 0, 'bớt 2 máy: chơi một mình với nhà cái');
  A.send({ t: 'cbot', d: -1 }); await sleep(200);
  ok(A.log.some(m => m.t === 'cno' && /Không còn máy/.test(m.msg)), 'không bớt được nữa');
  A.send({ t: 'cbot', d: 1 }); await sleep(250);
  ok(A.st.seats.filter(Boolean).length === 2 && A.st.seats.filter(s => s?.bot).length === 1, 'thêm 1 máy: có ngay trong ván này');
  A.send({ t: 'cbot', d: -1 }); await sleep(200);
  A.send({ t: 'cready' });
  ok(await waitFor(A, s => s?.phase === 'play' || s?.phase === 'result'), 'một mình vẫn chia bài, chơi được');
  A.ws.close(); await sleep(200);
}
{ // ---- Tiến lên ----
  console.log('Tiến lên');
  const A = client('Bình'); await A.ready;
  A.send({ t: 'create', name: 'tl', mode: 'tienlen' }); await sleep(500);
  ok(A.st?.phase === 'lobby', 'phòng chờ');
  A.send({ t: 'cstart' });
  ok(await waitFor(A, s => s?.phase === 'play'), 'chia bài, bắt đầu ván');
  const s0 = A.st;
  ok(s0.seats.filter(Boolean).length === 4 && s0.seats[s0.you].cards.length === 13, '4 người (3 bot), mỗi người 13 lá');
  ok(s0.seats.filter(s => s && s.seat !== s0.you).every(s => s.n === 13 && !s.cards.length), 'bài người khác úp');
  A.send({ t: 'cbot', d: -1 }); await sleep(150); A.send({ t: 'cbot', d: -1 }); await sleep(150); A.send({ t: 'cbot', d: -1 }); await sleep(250);
  ok(A.log.some(m => m.t === 'sys' && /áp dụng từ ván sau/.test(m.msg)) && A.st.seats.filter(Boolean).length === 4, 'bớt máy giữa ván: áp dụng từ ván sau');
  ok(A.st.botWant === 1 && A.log.some(m => m.t === 'cno' && /ít nhất 2 người/.test(m.msg)), 'tiến lên cần ít nhất 2 người (còn 1 máy)');
  // thử nước sai
  if (A.st.turn === A.st.you) {
    const hand = A.st.seats[A.st.you].cards;
    A.send({ t: 'cplay', cards: [hand[0], hand[12]] }); await sleep(200);
    ok(A.log.some(m => m.t === 'cno'), 'đánh bộ không hợp lệ: bị từ chối');
  }
  let plays = 0, guard = 0;
  while (A.st.phase === 'play' && guard++ < 1500) {
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
  ok(A.st.phase === 'result', 'chỉ còn một ghế có bài: hết ván');
  ok(A.log.some(s => s.t === 'cs' && s.phase === 'play' && s.seats.some(q => q?.rank === 1)), 'người về nhất xong thì các ghế còn lại vẫn đánh');
  const ranked = A.st.seats.filter(Boolean).sort((a, b) => a.result.rank - b.result.rank);
  const sum = ranked.reduce((total, s) => total + s.result.delta, 0);
  ok(ranked.slice(0, 3).every(s => s.n === 0) && ranked[3].n > 0 && sum === 0, `${ranked[0].name} về nhất, tổng tiền thắng thua = ${sum}`);
  const last = ranked[3], heo = tlHeoFine(last.cards);
  const fine = heo.xu + (last.result.burn ? 20 : 0);
  const expected = [20 + fine, 10, -10, -20 - fine];
  ok(ranked.every((s, i) => s.result.rank === i + 1 && s.result.delta - s.result.chop === expected[i]) && last.result.heo === heo.n,
    'số xu theo hạng, thối heo, cóng và tiền chặt');
  ok(await waitFor(A, s => s && s.games === 2 && s.phase !== 'result', 15000), 'sang ván 2');
  ok(A.st.seats.filter(Boolean).length === 2, `ván 2 chỉ còn ${A.st.seats.filter(Boolean).length} người (1 máy như đã chọn)`);
  A.ws.close(); await sleep(200);
}
{ // ---- Phòng chờ nhiều người + chủ phòng làm nhà cái ----
  console.log('Phòng chờ và chủ phòng làm nhà cái');
  const A = client('Chủ'), B = client('Khách'); await A.ready; await B.ready;
  A.send({ t: 'create', name: 'lobby', mode: 'xidach' }); await sleep(400);
  const rid = A.log.find(m => m.t === 'cj').room.id;
  B.send({ t: 'join', id: rid }); await sleep(500);
  ok(B.st?.phase === 'lobby' && B.st.you >= 0 && B.st.host === A.st.me, 'người thứ 2 vào phòng chờ, ngồi vào bàn');
  ok(/chưa sẵn sàng/.test(A.st.block || ''), `chưa bắt đầu được: ${A.st.block}`);
  A.send({ t: 'cstart' }); await sleep(250);
  ok(A.st.phase === 'lobby' && A.log.some(m => m.t === 'cno' && /chưa sẵn sàng/.test(m.msg)), 'bấm Bắt đầu khi khách chưa sẵn sàng: bị từ chối');
  B.send({ t: 'cstart' }); await sleep(200);
  ok(B.st.phase === 'lobby', 'khách không bắt đầu được');
  B.send({ t: 'cready' }); await sleep(200);
  ok(B.st.seats[B.st.you].lready && A.st.block == null, 'khách sẵn sàng: chủ phòng bắt đầu được');
  B.send({ t: 'cdealer' }); await sleep(200);
  ok(!A.st.hostDealer, 'khách không đổi được nhà cái');
  A.send({ t: 'cdealer' }); await sleep(250);
  ok(A.st.hostDealer && A.st.youDealer && A.st.you < 0 && A.st.dealer.pid === A.st.me && A.st.dealer.name === 'Chủ', 'chủ phòng làm nhà cái (rời ghế người chơi)');
  ok(!B.st.youDealer && B.st.dealer.human, 'khách thấy nhà cái là chủ phòng');
  A.send({ t: 'cstart' });
  ok(await waitFor(A, s => s?.phase === 'bet'), 'bắt đầu với chủ phòng làm nhà cái');
  for (const c of [A, B]) c.send({ t: 'cready' });
  ok(await waitFor(B, s => s && s.phase !== 'bet'), 'chia bài');
  ok(A.st.dealer.cards.length === A.st.dealer.n && (B.st.phase === 'result' || !B.st.dealer.cards.length), 'nhà cái thấy bài mình, người khác không thấy');
  A.send({ t: 'cstop' }); await sleep(150);
  ok(A.st.stopAfter, 'chủ phòng hẹn dừng sau ván này');
  // khách chơi: rút tới 16 rồi dằn; nhà cái: rút tới 15 rồi dằn
  let guard = 0, dealerActs = 0;
  while (guard++ < 200 && A.st.phase !== 'result') {
    const s = B.st;
    if (s.phase === 'play' && s.turn === s.you) { const me = s.seats[s.you]; B.send({ t: me.score < 16 ? 'chit' : 'cstand' }); }
    const d = A.st;
    if (d.phase === 'dealer' && !d.dealer.auto) {
      if (d.dealer.score < 15 && dealerActs === 0) { A.send({ t: 'cstand' }); await sleep(150); ok(A.log.some(m => m.t === 'cno' && /ít nhất 15/.test(m.msg)), 'nhà cái chưa đủ 15 điểm không được dằn'); }
      A.send({ t: d.dealer.score < 15 ? 'chit' : 'cstand' }); dealerActs++;
    }
    await sleep(250);
  }
  ok(A.st.phase === 'result', `hết ván (nhà cái đã thao tác ${dealerActs} lần)`);
  const r = A.st, sum = r.seats.filter(s => s?.result).reduce((a, s) => a + s.result.delta, 0);
  ok(r.dealer.result && r.dealer.result.delta === -sum && r.dealer.chips === 1000 + r.dealer.result.delta, `nhà cái ${r.dealer.result?.delta >= 0 ? 'ăn' : 'chung'} ${Math.abs(r.dealer.result?.delta)} xu = tổng thua của cả bàn`);
  ok(await waitFor(A, s => s?.phase === 'lobby', 10000), 'hết ván: về phòng chờ như đã hẹn');
  ok(!B.st.seats[B.st.you].lready, 'về phòng chờ: phải bấm sẵn sàng lại');
  // Chủ phòng chủ động rời: chuyển quyền ngay. Mất mạng sẽ giữ chỗ.
  A.send({ t: 'leave' }); await sleep(400);
  A.ws.close();
  ok(B.st.host === B.st.me && !B.st.hostDealer && !B.st.dealer.human, 'chủ phòng rời: khách thành chủ phòng, máy làm nhà cái');
  B.send({ t: 'cstart' });
  ok(await waitFor(B, s => s?.phase === 'bet'), 'chủ phòng mới bắt đầu được');
  B.ws.close(); await sleep(200);
}
console.log(fails ? `\n${fails} kiểm tra LỖI` : '\nTất cả đều qua');
process.exit(fails ? 1 : 0);
