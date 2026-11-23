// Kiểm tra luật và trạng thái bàn với bài cố định, không cần server đang chạy.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CardRoom } from '../server/cards.js';
import { tlCombo } from '../shared/cards.js';

function makeTable(game) {
  const room = new CardRoom('kiem-thu', 'Kiểm thử', { roomsChanged() {} }, game);
  room.destroy();   // gọi hành động trực tiếp để thời gian và bài luôn xác định
  function join(id) {
    const log = [];
    room.add({ id, name: 'Người chơi ' + id, char: 'kaze', ws: {
      readyState: 1,
      send: raw => log.push(JSON.parse(raw)),
    } });
    return { player: room.players.get(id), log };
  }
  return { room, join };
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
