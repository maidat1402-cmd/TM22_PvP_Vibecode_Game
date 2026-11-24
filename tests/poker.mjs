import assert from 'node:assert/strict';
import test from 'node:test';
import { PokerRoom } from '../server/poker.js';
import { RANKS, SUITS } from '../shared/cards.js';
import { pokerCategory, pokerScore } from '../shared/poker.js';

const card = (rank, suit) => RANKS.indexOf(rank) * 4 + SUITS.indexOf(suit);

function roomWith(stacks) {
  const room = new PokerRoom('poker-test', 'Bàn Poker', { roomsChanged() {} });
  room.destroy();
  room.botWant = 0;
  const clients = stacks.map((_, i) => {
    const log = [];
    const client = { id: i + 1, name: 'Khách ' + (i + 1), session: 'phien-' + i, char: 'kaze',
      ws: { readyState: 1, send: raw => log.push(JSON.parse(raw)), close() {} } };
    room.add(client);
    return { client, log };
  });
  room.rebalance();
  const players = clients.map(({ client }) => room.players.get(client.id));
  room.seats.fill(null);
  players.forEach((p, i) => { room.sit(p, i); p.chips = stacks[i]; });
  return { room, players, clients };
}

test('Poker chọn bộ năm lá tốt nhất, nhận sảnh A thấp và so lá phụ', () => {
  const wheel = [card('A','♠'), card('2','♠'), card('3','♠'), card('4','♠'), card('5','♠')];
  assert.equal(pokerCategory(pokerScore(wheel)), 8);
  assert.ok(pokerScore(wheel.slice(1).concat(card('6','♠'))) > pokerScore(wheel));
  const board = [card('A','♠'), card('A','♣'), card('J','♥'), card('7','♦'), card('3','♣')];
  const strong = pokerScore([...board, card('K','♥'), card('Q','♥')]);
  const weak = pokerScore([...board, card('K','♣'), card('10','♣')]);
  assert.equal(pokerCategory(strong), 1);
  assert.ok(strong > weak);
  assert.equal(pokerCategory(pokerScore([0, 1, 2, 4, 5, 6, 8])), 6);
});

test('Poker đối đầu đặt mù đúng ghế, đi đủ vòng và giấu bài khi bỏ', () => {
  const { room, players: [a, b], clients } = roomWith([1000, 1000]);
  room.startRound();
  assert.equal(room.button, a.seat);
  assert.equal(room.smallSeat, a.seat);
  assert.equal(room.bigSeat, b.seat);
  assert.equal(room.turn, a.seat);
  assert.deepEqual(room.view(b).seats[a.seat].cards, []);
  room.onMessage(b.id, { t: 'cpoker', action: 'fold' });
  assert.equal(room.turn, a.seat);
  room.playPoker(a, 'check');
  assert.equal(clients[0].log.at(-1).t, 'cno');
  room.playPoker(a, 'call');
  room.playPoker(b, 'check');
  for (const size of [3, 4, 5]) {
    assert.equal(room.board.length, size);
    assert.equal(room.turn, b.seat);
    room.playPoker(b, 'check');
    room.playPoker(a, 'check');
  }
  assert.equal(room.phase, 'result');
  assert.equal(room.view(b).seats[a.seat].cards.length, 2);
  assert.equal(a.chips + b.chips, 2000);

  room.startRound();
  assert.equal(room.button, b.seat);
  room.playPoker(b, 'fold');
  assert.equal(room.phase, 'result');
  assert.deepEqual(room.view(a).seats[b.seat].cards, []);
  assert.deepEqual(room.view(b).seats[a.seat].cards, []);
  assert.equal(a.result.delta, 5);
  assert.equal(b.result.delta, -5);
});

test('Poker tất tay ngắn không mở quyền tố lại, vẫn chạy bài chung tới so bài', () => {
  const { room, players: [a, b, c, d] } = roomWith([1000, 1000, 25, 1000]);
  room.startRound();
  assert.equal(room.turn, d.seat);
  room.playPoker(d, 'raise', 20);
  room.playPoker(a, 'call');
  room.playPoker(b, 'call');
  room.playPoker(c, 'allin');
  const turn = room.view(d).poker.options;
  assert.equal(turn.owed, 5);
  assert.equal(turn.canRaise, false);
  assert.equal(turn.canAllIn, false);
  room.playPoker(d, 'raise', 50);
  assert.equal(room.turn, d.seat);
  for (const p of [d, a, b]) room.playPoker(p, 'call');
  assert.equal(room.board.length, 3);
  assert.equal(room.turn, b.seat);
});

test('Poker tách hũ phụ, trả cược dư và chia xu lẻ khi hòa', () => {
  const { room, players: [a, b, c] } = roomWith([100, 200, 350]);
  room.startRound();
  room.board = [card('A','♠'), card('K','♣'), card('8','♣'), card('5','♠'), card('2','♥')];
  a.hand = [card('A','♣'), card('A','♦')];
  b.hand = [card('K','♦'), card('K','♥')];
  c.hand = [card('8','♦'), card('8','♥')];
  [a, b, c].forEach((p, i) => {
    const total = [100, 200, 350][i];
    Object.assign(room.pokerSeats.get(p.seat), { total, streetBet: total });
    p.chips = 0;
  });
  room.finishPoker(room.activeSeats());
  assert.deepEqual([a.chips, b.chips, c.chips], [300, 200, 150]);
  assert.equal(c.result.refund, 150);
  assert.equal([a,b,c].reduce((sum, p) => sum + p.result.delta, 0), 0);

  room.board = ['10','J','Q','K','A'].map(r => card(r,'♠'));
  for (const state of room.pokerSeats.values()) state.total = 1;
  room.pokerSeats.get(c.seat).folded = true;
  room.finishPoker(room.activeSeats());
  assert.deepEqual([a.result.payout, b.result.payout, c.result.payout], [1, 2, 0]);
  assert.deepEqual(room.view(a).seats[c.seat].cards, []);
});

test('Poker chỉ chủ bàn đặt tiền mù hợp lệ trong phòng chờ', () => {
  const { room, clients, players: [a, b] } = roomWith([100, 200]);
  const configure = { t: 'cconfig', chips: 150, blinds: { small: 3, big: 7 } };
  room.onMessage(b.id, configure);
  assert.equal(clients[1].log.at(-1).t, 'cno');
  room.onMessage(a.id, { ...configure, blinds: { small: 9, big: 7 } });
  assert.equal(clients[0].log.at(-1).t, 'cno');
  room.onMessage(a.id, configure);
  assert.deepEqual(room.view(b).rules.blinds, { small: 3, big: 7 });
  room.startRound();
  room.onMessage(a.id, { ...configure, blinds: { small: 1, big: 2 } });
  assert.deepEqual(room.blinds, { small: 3, big: 7 });
  const turn = room.bySeat(room.turn);
  room.disconnect(turn.client);
  const reconnect = { ...clients[0].client, id: 3, session: 'new', ws: clients[0].client.ws };
  assert.ok(room.resume(reconnect, turn.session));
  assert.deepEqual(room.view(turn).seats[turn.seat].cards, turn.hand);
});
