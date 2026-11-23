// Kiểm tra luật và trạng thái bàn với bài cố định, không cần server đang chạy.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CardRoom } from '../server/cards.js';
import { XD, tlCombo, xdScore } from '../shared/cards.js';

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
  assert.ok(room.deadline >= player.rejoinUntil);
  assert.equal(room.view(player).seats[player.seat].offline, true);
  const returned = connection(3);
  assert.equal(room.resume(returned.client, client.session), true);
  assert.equal(returned.client.id, player.id);
  const state = returned.log.at(-1);
  assert.equal(state.turn, player.seat);
  assert.deepEqual(state.seats[player.seat].cards, [0, 8]);
  assert.equal(state.seats[player.seat].chips, 760);
  assert.equal(state.seats[player.seat].offline, false);
  assert.equal(room.resume(connection(4).client, client.session), false);
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

test('Nhà cái quắc đúng 28 điểm chung một lần cược cho từng ghế', () => {
  const { room, join } = makeTable('xidach');
  const dealer = join(1).player;
  const player = join(2).player;
  const second = join(3).player;
  room.setHostDealer(true);
  Object.assign(player, { hand: [44, 31], bet: 100 });
  Object.assign(second, { hand: [0, 4], bet: 200 });
  room.xdPlayers = [player, second];
  room.dealer.hand = [28, 29];
  room.deck = [20];
  room.phase = 'dealer';
  room.onMessage(dealer.id, { t: 'chit' });
  assert.equal(room.phase, 'result');
  assert.equal(xdScore(room.dealer.hand), 28);
  assert.equal(dealer.result.delta, -300);
  assert.equal(player.result.delta, 100);
  assert.equal(second.result.delta, 200);
});
