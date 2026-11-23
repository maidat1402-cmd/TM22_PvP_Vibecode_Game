import assert from 'node:assert/strict';
import test from 'node:test';
import { Room } from '../server/room.js';
import { dashCooldown, MOVE } from '../shared/config.js';
import { getChar } from '../shared/characters.js';

function makeRoom(team) {
  const messages = [];
  const ws = { readyState: 1, send: raw => messages.push(JSON.parse(raw)) };
  const room = new Room('test', 'Kiểm thử', { roomsChanged() {} }, 'tournament', team);
  room.destroy(); // Kiểm tra từng bước, không chạy vòng lặp nền.
  room.add({ id: 1, name: 'Kaze', char: 'kaze', ws });
  return { room, messages, p: room.players.get(1) };
}

test('Kaze dị biến lướt lần nữa theo hồi chiêu thật, vẫn có khoảng hở miễn sát thương', t => {
  let clock = 10_000;
  t.mock.method(performance, 'now', () => clock);
  const { room, p } = makeRoom(false);
  p.awUntil = 15;
  room.onMessage(p.id, { t: 'dodge' });
  const first = p.invulnUntil;
  assert.equal(first, 10 + MOVE.dashInvuln);

  clock += (MOVE.dashInvuln - 0.01) * 1000;
  room.onMessage(p.id, { t: 'dodge' });
  assert.equal(p.invulnUntil, first);

  clock = 10_000 + dashCooldown(getChar('kaze').awaken) * 1000;
  room.onMessage(p.id, { t: 'dodge' });
  assert.equal(p.invulnUntil, clock / 1000 + MOVE.dashInvuln);

  clock = 15_000;
  room.onMessage(p.id, { t: 'dodge' });
  assert.equal(p.dodgeAt, clock / 1000 + MOVE.dashCd - 0.15);
});

test('Đấu đội dọn chiêu và vật cản khi bắt đầu và sau đòn chốt trận', async () => {
  const { room, p, messages } = makeRoom(true);
  function cast() {
    room.onMessage(p.id, { t: 'cast', sk: 1, p: [p.x, p.y, p.z], d: [0, 0, 1] });
    const entity = room.entities.at(-1);
    assert.ok(entity.skill.count > 1);
    return entity;
  }
  function addTerrain() {
    room.addProp({ kind: 'pillar', owner: p.id, team: p.team, x: 0, y: 0, z: 0, r: 1, h: 3, hp: 50, solid: true, until: 100 });
    room.addZone('ice', p, 0, 0, 2, 5);
    room.dyn.push({ owner: p.id, x: 2, z: 2, h: 2, r: 1 });
  }
  function assertCleared(entity) {
    assert.equal(entity.dead, true);
    assert.equal(room.entities.length, 0);
    assert.equal(room.props.length, 0);
    assert.equal(room.zones.length, 0);
    assert.equal(room.dyn.length, 0);
    assert.equal(messages.filter(m => m.t === 'tclear').length, 1);
    assert.ok(!messages.some(m => m.t === 'pend'));
  }

  const warmupCast = cast();
  addTerrain();
  messages.length = 0;
  room.startMatch();
  assertCleared(warmupCast);
  assert.ok(messages.findIndex(m => m.t === 'tclear') < messages.findIndex(m => m.t === 'respawn'));

  const lastCast = cast();
  messages.length = 0;
  room.endMatch(p.team);
  addTerrain(); // Mô phỏng đòn chốt điểm còn sinh công trình trong cùng lượt.
  await Promise.resolve();
  assertCleared(lastCast);
});
