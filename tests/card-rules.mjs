// Kiểm tra luật và trạng thái bàn với bài cố định, không cần server đang chạy.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CardRoom } from '../server/cards.js';
import { CARD_OFFLINE_TAKEOVER, CARD_REJOIN_SECONDS, XD, TL_MONEY, tlCombo, xdScore } from '../shared/cards.js';

function makeTable(game) {
  const room = new CardRoom('kiem-thu', 'Kiểm thử', { roomsChanged() {} }, game);
  room.destroy();   // gọi hành động trực tiếp để thời gian và bài luôn xác định
  function connection(id) {
    const log = [];
    const client = { id, session: 'phien-' + id, name: 'Người chơi ' + id, char: 'kaze', ws: {
      readyState: 1, close() { this.readyState = 3; },
      send: raw => log.push(JSON.parse(raw)),
    } };
    return { client, log };
  }
  function join(id) {
    const { client, log } = connection(id);
    room.add(client);
    return { player: room.players.get(id), client, log };
  }
  return { room, join, connection };
}

test('Xì dách từ chối dằn dưới 16 điểm và giữ nguyên lượt', () => {
  const { room, join } = makeTable('xidach');
  const { player, log } = join(1);
  player.hand = [0, 4];    // 3 và 4
  room.phase = 'play';
  room.turn = player.seat;
  room.onMessage(player.id, { t: 'cstand' });
  assert.match(log.at(-1)?.msg ?? '', /Chưa đủ 16 điểm/);
  assert.equal(room.turn, player.seat);
  assert.equal(room.phase, 'play');
  assert.equal(Boolean(player.done), false);
});

test('Tiến lên báo người thật và máy bỏ lượt cho người chơi khác', () => {
  const { room, join } = makeTable('tienlen');
  const { player: first, log } = join(1);
  const { player: second } = join(2);
  const bots = room.seated().filter(player => player.bot);
  first.hand = [4];
  second.hand = [8];
  bots[0].hand = [12];
  bots[1].hand = [16];
  room.phase = 'play';
  room.turn = second.seat;
  room.passed = new Set();
  room.trick = { by: first.seat, cards: [0], combo: tlCombo([0]) };

  room.onMessage(second.id, { t: 'cpass' });
  assert.equal(room.turn, bots[0].seat);
  room.tlPass(bots[0]);
  const state = log.at(-1);
  assert.equal(state.t, 'cs');
  assert.equal(state.seats[second.seat].passed, true);
  assert.equal(state.seats[bots[0].seat].passed, true);
  assert.equal(state.seats[bots[1].seat].passed, false);
  assert.deepEqual(state.seats[second.seat].cards, []);

  room.tlPass(bots[1]);
  assert.equal(room.turn, first.seat);
  assert.equal(log.at(-1).seats[second.seat].passed, false);
});

test('Tiến lên giữ bài, xu và lượt khi rớt mạng rồi vào lại', () => {
  const { room, join, connection } = makeTable('tienlen');
  const { player, client } = join(1);
  join(2);
  Object.assign(player, { hand: [0, 8], chips: 760 });
  room.phase = 'play';
  room.turn = player.seat;
  room.setTurnDeadline(25);

  room.disconnect(client);
  assert.equal(player.rejoinUntil - room.deadline, CARD_REJOIN_SECONDS - CARD_OFFLINE_TAKEOVER);
  assert.equal(room.view(player).seats[player.seat].offline, true);
  const returned = connection(3);
  assert.equal(room.resume(returned.client, client.session), true);
  assert.equal(returned.client.id, player.id);
  const state = returned.log.at(-1);
  assert.equal(state.turn, player.seat);
  assert.deepEqual(state.seats[player.seat].cards, [0, 8]);
  assert.equal(state.seats[player.seat].chips, 760);
  assert.equal(state.seats[player.seat].offline, false);
  room.onMessage(player.id, { t: 'cresumeack' });
  assert.equal(room.resume(connection(4).client, client.session), false);
});

test('Rớt mạng lần nữa trước xác nhận vẫn lấy lại đúng ghế bằng mã đã lưu', () => {
  const { room, join, connection } = makeTable('tienlen');
  const { player, client } = join(1);
  player.chips = 760;
  room.disconnect(client);
  const retry = connection(2).client;
  assert.equal(room.resume(retry, client.session), true);
  room.disconnect(retry); // Chưa nhận được cj nên tab vẫn lưu mã cũ.
  const returned = connection(3);
  assert.equal(room.resume(returned.client, client.session), true);
  assert.equal(returned.log.at(-1).seats[player.seat].chips, 760);

  room.disconnect(returned.client); // Tab đã lưu mã mới, nhưng xác nhận chưa đến server.
  const saved = connection(4).client;
  assert.equal(room.resume(saved, returned.client.session), true);
  room.onMessage(player.id, { t: 'cresumeack' });
  assert.equal(room.resume(connection(5).client, client.session), false);
});

test('Xì dách giữ ghế 60 giây và máy rút rồi dằn từ giây thứ 20', t => {
  let clock = 10_000;
  t.mock.method(performance, 'now', () => clock);
  const { room, join, connection } = makeTable('xidach');
  const { player, client } = join(1);
  const next = join(2).player;
  player.hand = [0, 4];
  next.hand = [8, 12];
  room.deck = [28];
  room.phase = 'play';
  room.turn = player.seat;
  room.disconnect(client);
  assert.equal(player.rejoinUntil, 70);
  assert.equal(room.deadline, 30);

  clock = 29_999;
  room.tick();
  assert.equal(player.hand.length, 2);
  clock = 30_000;
  room.tick();
  assert.deepEqual(player.hand, [0, 4, 28]);
  assert.equal(player.done, undefined);
  clock = 31_000;
  room.tick();
  assert.equal(room.turn, next.seat);
  assert.equal(room.bySeat(player.seat), player);
  assert.equal(player.done, true);
  assert.equal(room.resume(connection(3).client, client.session), true);
  assert.equal(room.turn, next.seat);
});

test('Nhà cái Xì dách lấy lại quyền sau khi máy rút giúp lúc mất mạng', t => {
  let clock = 10_000;
  t.mock.method(performance, 'now', () => clock);
  const { room, join, connection } = makeTable('xidach');
  const { player: dealer, client } = join(1);
  const guest = join(2).player;
  room.setHostDealer(true);
  room.dealer.hand = [0, 4];
  guest.hand = [12, 13];
  room.xdPlayers = [guest];
  room.deck = [28];
  room.phase = 'dealer';
  room.disconnect(client);
  clock = 30_000;
  room.tick();
  assert.deepEqual(room.dealer.hand, [0, 4, 28]);
  assert.equal(room.dealer.pid, dealer.id);

  clock = 30_300;
  assert.equal(room.resume(connection(3).client, client.session), true);
  clock = 31_100;
  room.tick();
  assert.equal(room.phase, 'dealer');
  room.onMessage(dealer.id, { t: 'cstand' });
  assert.equal(room.phase, 'result');
});

test('Hết hạn ở Tiến lên thì máy giữ bài và xu của người rời', () => {
  const { room, join, connection } = makeTable('tienlen');
  const { player, client } = join(1);
  const next = join(2).player;
  Object.assign(player, { hand: [0, 8], chips: 760 });
  Object.assign(next, { hand: [4, 12] });
  room.phase = 'play';
  room.turn = player.seat;
  room.setTurnDeadline(25);
  room.disconnect(client);
  player.rejoinUntil = performance.now() / 1000 - 0.01;
  assert.equal(room.resume(connection(3).client, client.session), false);
  room.tick();
  const bot = room.bySeat(player.seat);
  assert.equal(bot.bot, true);
  assert.deepEqual(bot.hand, [0, 8]);
  assert.equal(bot.chips, 760);
  assert.equal(room.hostId, next.id);
});

test('Hết hạn ở Xì dách thì chuyển chủ và để máy tiếp quản nhà cái', () => {
  const { room, join } = makeTable('xidach');
  const { player, client } = join(1);
  const next = join(2).player;
  room.setHostDealer(true);
  room.dealer.hand = [16, 20];
  room.disconnect(client);
  assert.equal(room.dealer.pid, player.id);
  assert.equal(room.hostId, player.id);
  player.rejoinUntil = performance.now() / 1000 - 0.01;
  room.tick();
  assert.equal(room.hostId, next.id);
  assert.equal(room.dealer.pid, 0);
  assert.deepEqual(room.dealer.hand, [16, 20]);
});

test('Xì dách có tám ghế cược và vẫn đủ bài cho nhà cái', () => {
  const { room, join } = makeTable('xidach');
  for (let id = 1; id <= 9; id++) join(id);
  assert.equal(room.seated().length, 8);
  assert.equal(room.players.get(9).seat, -1);
  room.setHostDealer(true);
  assert.equal(room.seated().length, 8);
  assert.equal(room.dealer.pid, 1);
  assert.ok((room.seatCount + 1) * XD.maxCards <= 52);
});

test('Quắc vẫn giữ lượt, giữ kín bài và chỉ tính tiền đền lúc so bài', () => {
  const { room, join } = makeTable('xidach');
  const { player: one } = join(1);
  const { player: two } = join(2);
  const { player: three } = join(3);
  Object.assign(one, { hand: [28, 24], bet: 50 });
  Object.assign(two, { hand: [25, 30], bet: 100 });
  Object.assign(three, { hand: [16, 17], bet: 200 });
  room.xdPlayers = [one, two, three];
  room.dealer.hand = [26, 31];
  room.deck = [0, 20];
  room.phase = 'play';
  room.turn = one.seat;

  room.onMessage(one.id, { t: 'chit' });   // 27 điểm
  assert.equal(room.turn, one.seat);
  assert.equal(xdScore(one.hand), 27);
  room.onMessage(one.id, { t: 'chit' });   // 30 điểm
  assert.equal(room.turn, one.seat);
  assert.equal(xdScore(one.hand), 30);
  assert.equal(one.chips, 1000);
  assert.equal(two.chips, 1000);
  room.onMessage(one.id, { t: 'cstand' });
  assert.equal(room.turn, Math.min(two.seat, three.seat));
  assert.deepEqual(room.view(two).seats[one.seat].cards, []);
  assert.equal(room.view(two).seats[one.seat].kind, undefined);
  assert.equal(room.view(two).seats[one.seat].n, 4);

  room.xdSettle();
  assert.equal(one.result.penalty, -300);
  assert.equal(two.result.penalty, 100);
  assert.equal(three.result.penalty, 200);
  assert.equal(one.chips, 650);
  assert.equal(two.chips, 1100);
  assert.equal(three.chips, 1000);
  assert.deepEqual(room.view(two).seats[one.seat].cards, one.hand);
});

test('Nhà cái quắc 28 điểm so bài bình thường với cả xì dách và bài quắc', () => {
  const { room, join } = makeTable('xidach');
  const dealer = join(1).player;
  const player = join(2).player;
  const second = join(3).player;
  room.setHostDealer(true);
  Object.assign(player, { hand: [44, 31], bet: 100 });
  Object.assign(second, { hand: [28, 29, 0], bet: 200 });
  room.xdPlayers = [player, second];
  room.dealer.hand = [28, 29];
  room.deck = [20];
  room.phase = 'dealer';
  room.onMessage(dealer.id, { t: 'chit' });
  assert.equal(room.phase, 'dealer');
  room.onMessage(dealer.id, { t: 'cstand' });
  assert.equal(room.phase, 'result');
  assert.equal(xdScore(room.dealer.hand), 28);
  assert.equal(dealer.result.delta, -200);
  assert.equal(player.result.delta, 200);
  assert.equal(second.result.delta, 0);
  assert.equal(player.result.penalty, 0);
  assert.equal(second.result.penalty, 0);
});

test('Chủ bàn Xì dách đặt vốn và mức cược cho cả người mới, kiểm tra mức hợp lệ', () => {
  const { room, join } = makeTable('xidach');
  const host = join(1);
  const guest = join(2);
  room.onMessage(guest.player.id, { t: 'cconfig', chips: 3300, bets: [75, 300] });
  assert.equal(guest.log.at(-1).t, 'cno');
  assert.equal(room.startChips, 1000);
  room.onMessage(host.player.id, { t: 'cconfig', chips: 3300, bets: [75, 75] });
  assert.equal(host.log.at(-1).t, 'cno');
  room.onMessage(host.player.id, { t: 'cconfig', chips: 3300, bets: [4000] });
  assert.equal(room.startChips, 1000);

  room.onMessage(host.player.id, { t: 'cconfig', chips: 3300, bets: [300, 75, 125] });
  assert.deepEqual(room.view(guest.player).rules, { startChips: 3300, bets: [75, 125, 300], cardStyle: 'classic' });
  assert.equal(guest.player.chips, 3300);
  const newcomer = join(3).player;
  assert.equal(newcomer.chips, 3300);
  assert.equal(newcomer.bet, 75);
  room.xdBetPhase();
  room.onMessage(newcomer.id, { t: 'cbet', v: 125 });
  assert.equal(newcomer.bet, 125);
  room.onMessage(newcomer.id, { t: 'cbet', v: 100 });
  assert.equal(newcomer.bet, 125);
  newcomer.chips = 150;
  room.onMessage(newcomer.id, { t: 'cbet', v: 300 });
  assert.equal(newcomer.bet, 125);
  room.onMessage(host.player.id, { t: 'cconfig', chips: 5000, bets: [100] });
  assert.equal(room.startChips, 3300);

  room.games = 1;
  room.toLobby();
  room.onMessage(host.player.id, { t: 'cconfig', chips: 2100, bets: [300] });
  assert.equal(newcomer.chips, 150);
  assert.equal(join(4).player.chips, 2100);
  room.xdBetPhase();
  assert.equal(newcomer.chips, 2100);
  assert.equal(newcomer.bet, 300);
});

test('Tiến lên cấp vốn tùy chỉnh và giữ nguyên luật tính tiền của ván', () => {
  const { room, join } = makeTable('tienlen');
  const host = join(1).player;
  room.onMessage(host.id, { t: 'cconfig', chips: 5, bets: [] });
  const guest = join(2).player;
  assert.equal(guest.chips, 5);
  assert.deepEqual(room.view(guest).rules, { startChips: 5, bets: [], cardStyle: 'classic', tl: TL_MONEY });
  room.botWant = 0;
  room.rebalance();
  host.hand = [4];
  guest.hand = [0];
  guest.played = true;
  Object.assign(room, { phase: 'play', turn: host.seat, trick: null, mustHave: -1, passed: new Set() });
  room.tlPlay(host, [4]);
  assert.equal(guest.result.delta, -20);
  assert.equal(guest.chips, 5);
});

function fixedTienLenRound(hands) {
  const { room, join } = makeTable('tienlen');
  room.botWant = 0;
  const people = hands.map((_, i) => join(i + 1));
  room.seats.fill(null);
  people.forEach(({ player }, i) => room.sit(player, i));
  Object.assign(room, { phase: 'play', turn: 0, mustHave: -1, trick: null, passed: new Set() });
  people.forEach(({ player }, i) => Object.assign(player, { hand: hands[i], played: false, tlRank: 0, tlChop: 0 }));
  return { room, people };
}

test('Tiến lên đánh tiếp sau khi có người về, hưởng sái và tính tiền theo hạng', () => {
  const { room, people: [{ player: a }, { player: b }, { player: c, log }, { player: d }] } = fixedTienLenRound([[44], [4, 8], [12], [48, 51]]);
  room.tlPlay(a, [44]);
  assert.equal(room.phase, 'play');
  assert.equal(log.at(-1).seats[a.seat].rank, 1);
  assert.equal(log.at(-1).seats[a.seat].result, undefined);
  assert.deepEqual(log.at(-1).seats[d.seat].cards, []);
  assert.equal(room.turn, b.seat);

  for (const q of [b, c, d]) room.tlPass(q);
  assert.equal(room.turn, b.seat);
  assert.equal(room.trick, null);
  assert.equal(room.passed.size, 0);
  assert.match(room.msg, /hưởng sái/);
  // Người đã về rời bàn giữa ván vẫn giữ hạng và quyền nhận xu cho ghế.
  room.remove(a.id);
  const first = room.bySeat(a.seat);
  assert.ok(first.bot);
  assert.equal(first.tlRank, 1);
  room.tlPlay(b, [4]);
  for (const q of [c, d]) room.tlPass(q);
  room.tlPlay(b, [8]);
  assert.equal(room.phase, 'play');
  assert.equal(b.tlRank, 2);
  room.tlPlay(c, [12]);
  assert.equal(room.phase, 'result');
  assert.equal(room.lastWinner, a.seat);
  assert.deepEqual(room.seated().map(q => q.result.rank), [1, 2, 3, 4]);
  assert.deepEqual(room.seated().map(q => q.result.delta), [100, 10, -10, -100]);
  assert.equal(d.result.heo, 2);
  assert.equal(d.result.burn, true);
});

test('Tiến lên chặt chồng chuyển khoản đền sang người bị chặt cuối', () => {
  const { room, people } = fixedTienLenRound([[0, 51], [1, 4, 5, 6, 7], [8, 9, 12, 13, 16, 17, 20, 21], [2]]);
  const [a, b, c, d] = people.map(q => q.player);
  room.tlPlay(a, [51]);
  room.tlPlay(b, [4, 5, 6, 7]);
  room.tlPlay(c, c.hand);
  for (const q of [d, a, b]) room.tlPass(q);
  assert.equal(room.turn, d.seat);
  assert.deepEqual([a.tlChop, b.tlChop, c.tlChop, d.tlChop], [0, -80, 80, 0]);
  room.tlPlay(d, [2]);
  assert.equal(room.turn, a.seat);
  room.tlPass(a);
  room.tlPass(b);
  room.tlPlay(a, [0]);
  assert.equal(room.phase, 'result');
  assert.deepEqual([a, b, c, d].map(q => q.result.delta), [-10, -100, 100, 10]);
});

test('Tiến lên bàn ba người chia tiền hạng và tới trắng trả đều', () => {
  const { room, people } = fixedTienLenRound([[0], [4], [48]]);
  const [a, b, c] = people.map(q => q.player);
  c.played = true;
  room.tlPlay(a, [0]);
  room.tlPlay(b, [4]);
  assert.deepEqual([a, b, c].map(q => q.result.delta), [50, -10, -40]);

  room.tlInstant(b, 'Sảnh rồng');
  assert.deepEqual([a, b, c].map(q => q.result.delta), [-40, 80, -40]);
  assert.equal(a.result.instantLoss, true);
});

test('Tiến lên dùng từng mức cược và mức đền do chủ phòng đặt', () => {
  const { room, people } = fixedTienLenRound([[0], [49, 51]]);
  const [a, b] = people.map(q => q.player);
  room.phase = 'lobby';
  const tl = { unit: 25, black: 7, red: 13, burn: 0, instant: 75, pairs3: 4, quad: 5, pairs4: 6 };
  room.onMessage(b.id, { t: 'cconfig', chips: 1000, tl });
  assert.deepEqual(room.tlMoney, TL_MONEY);
  room.onMessage(a.id, { t: 'cconfig', chips: 1000, tl: { ...tl, unit: 0 } });
  assert.deepEqual(room.tlMoney, TL_MONEY);
  room.onMessage(a.id, { t: 'cconfig', chips: 1000, tl });
  assert.deepEqual(room.view(b).rules.tl, tl);
  room.phase = 'play';
  room.onMessage(a.id, { t: 'cconfig', chips: 1000, tl: { unit: 10 } });
  room.tlPlay(a, [0]);
  assert.deepEqual([a.result.delta, b.result.delta], [70, -70]);
  room.tlInstant(b, 'Sảnh rồng');
  assert.deepEqual([a.result.delta, b.result.delta], [-75, 75]);
});

test('Mẫu bài chỉ đổi trong phòng chờ và được giữ khi khách mất kết nối', () => {
  for (const mode of ['xidach', 'tienlen']) {
    const { room, join, connection } = makeTable(mode);
    const host = join(1), guest = join(2);
    const edit = { t: 'cconfig', chips: 2000, bets: [50, 100], cardStyle: 'chibi' };
    room.onMessage(guest.player.id, edit);
    assert.equal(guest.log.at(-1).t, 'cno');
    assert.equal(room.cardStyle, 'classic');

    room.onMessage(host.player.id, { ...edit, cardStyle: 'constructor' });
    assert.equal(host.log.at(-1).t, 'cno');
    assert.equal(room.startChips, 1000);
    room.onMessage(host.player.id, edit);
    assert.equal(guest.log.at(-1).rules.cardStyle, 'chibi');
    assert.equal(join(3).log.at(-1).rules.cardStyle, 'chibi');

    room.disconnect(guest.client);
    const back = connection(4);
    assert.equal(room.resume(back.client, guest.client.session), true);
    assert.equal(back.log.at(-1).rules.cardStyle, 'chibi');
    room.phase = 'play';
    room.onMessage(host.player.id, { ...edit, cardStyle: 'classic' });
    assert.equal(host.log.at(-1).t, 'cno');
    assert.equal(room.cardStyle, 'chibi');

    room.phase = 'lobby';
    room.onMessage(host.player.id, { t: 'cconfig', chips: 2500, bets: [200] });
    assert.equal(room.cardStyle, 'chibi');
    room.onMessage(host.player.id, { ...edit, cardStyle: 'classic' });
    assert.equal(back.log.at(-1).rules.cardStyle, 'classic');
  }
});

test('Nhà cái mở từng người và giữ nguyên kết quả sau khi rút thêm', () => {
  const { room, join } = makeTable('xidach');
  const dealer = join(1).player;
  const first = join(2).player;
  const second = join(3).player;
  room.setHostDealer(true);
  Object.assign(first, { hand: [24, 22], bet: 100 });
  Object.assign(second, { hand: [25, 26], bet: 200 });
  room.xdPlayers = [first, second];
  room.dealer.hand = [20, 21];  // 16 điểm
  room.dealer.open = true;
  room.deck = [4];              // thêm 4 điểm
  room.phase = 'dealer';

  room.onMessage(first.id, { t: 'copen', seat: second.seat });
  assert.equal(room.xdOpened.size, 0);
  room.onMessage(dealer.id, { t: 'copen', seat: first.seat });
  const seen = room.view(second).seats[first.seat];
  assert.deepEqual(seen.cards, first.hand);
  assert.deepEqual(seen.opened, { dealerScore: 16, delta: 100 });
  assert.deepEqual(room.view(dealer).seats[second.seat].cards, []);
  room.onMessage(dealer.id, { t: 'chit' });
  room.onMessage(dealer.id, { t: 'copen', seat: first.seat });
  assert.equal(room.xdOpened.get(first.id).dealerScore, 16);
  room.onMessage(dealer.id, { t: 'copen', seat: second.seat });
  assert.equal(room.phase, 'result');
  assert.equal(first.result.delta, 100);
  assert.equal(second.result.delta, -200);
  assert.equal(dealer.result.delta, 100);
});

test('Nhà cái rút lên 28 sau khi mở giữ kết quả đã chốt và không phát sinh khoản đền', () => {
  const { room, join } = makeTable('xidach');
  const dealer = join(1).player;
  const first = join(2).player;
  const second = join(3).player;
  room.setHostDealer(true);
  Object.assign(first, { hand: [0, 4], bet: 100 });
  Object.assign(second, { hand: [44, 31], bet: 200 });
  room.xdPlayers = [first, second];
  room.dealer.hand = [28, 29];
  room.deck = [20];
  room.phase = 'dealer';
  room.onMessage(dealer.id, { t: 'copen', seat: first.seat });
  room.onMessage(dealer.id, { t: 'chit' });
  room.onMessage(dealer.id, { t: 'copen', seat: second.seat });
  assert.equal(first.result.delta, -100);
  assert.equal(first.result.penalty, 0);
  assert.equal(second.result.delta, 400);
  assert.equal(dealer.result.delta, -300);
});

test('Tiến lên bỏ lượt sau 20 giây và vẫn giữ ghế cho người mất mạng', t => {
  let clock = 10_000;
  t.mock.method(performance, 'now', () => clock);
  const { room, join, connection } = makeTable('tienlen');
  const { player: first } = join(1);
  const { player, client } = join(2);
  room.botWant = 0;
  room.rebalance();
  first.hand = [8, 12];
  player.hand = [4];
  room.phase = 'play';
  room.turn = player.seat;
  room.passed = new Set();
  room.trick = { by: first.seat, cards: [0], combo: tlCombo([0]) };
  room.disconnect(client);
  assert.equal(room.view(first).seats[player.seat].offlineLeft, 60);
  clock = 29_999;
  room.tick();
  assert.equal(room.turn, player.seat);
  clock = 30_000;
  room.tick();
  assert.equal(room.turn, first.seat);
  assert.equal(room.view(first).seats[player.seat].offlineLeft, 40);
  assert.equal(room.bySeat(player.seat), player);
  assert.equal(room.resume(connection(3).client, client.session), true);
  assert.deepEqual(player.hand, [4]);
});

test('Bảng tính xu Tiến lên tách đúng cóng, thối heo và chặt cho từng ghế', () => {
  const { room, join } = makeTable('tienlen');
  const first = join(1).player, last = join(2).player;
  Object.assign(first, { hand: [], tlRank: 1, tlChop: 5 });
  Object.assign(last, { hand: [51], tlRank: 2, tlChop: -5, played: false });
  room.tlFinish([first, last]);
  assert.equal(last.result.burnXu, -TL_MONEY.burn);
  assert.equal(last.result.heoXu, -TL_MONEY.red);
  for (const { result: r } of [first, last]) assert.equal(r.delta, r.rankXu + r.chop + r.burnXu + r.heoXu);
  assert.equal(first.result.delta + last.result.delta, 0);
});
