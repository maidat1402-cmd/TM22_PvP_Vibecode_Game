// Kiểm tra máy chủ chỉ cập nhật đạn khi dữ liệu phát bắn hợp lệ.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ShooterRoom } from '../server/shooter.js';

test('Gói bắn thiếu dữ liệu giữ nguyên đạn, phát hợp lệ gây sát thương', () => {
  const room = new ShooterRoom('kiem-thu', 'Kiểm thử', { roomsChanged() {} }, 'dm', 'lantern');
  room.destroy();
  const log = [];
  for (const id of [1, 2]) {
    room.add({ id, name: 'Người chơi ' + id, ws: {
      readyState: 1,
      send: raw => log.push(JSON.parse(raw)),
    } });
  }

  const shooter = room.players.get(1), target = room.players.get(2);
  // Dùng đoạn sân trống để kiểm tra một phát súng ngắn, không phụ thuộc điểm hồi sinh ngẫu nhiên.
  const originX = shooter.x, originZ = shooter.z;
  target.x = originX + 0.5;
  target.y = shooter.y;
  target.z = originZ;
  target.protectUntil = 0;
  const wid = shooter.weapons[shooter.cur];
  const ammo = shooter.ammo[wid], mag = ammo.mag;
  const origin = [originX, shooter.y + 1.3, originZ];
  const base = { t: 'fire', w: wid, o: origin };
  const hp = target.hp;

  room.handleFire(shooter, { ...base, p: [] }, 10);
  assert.equal(ammo.mag, mag);
  assert.equal(shooter.lastFire, 0);
  assert.equal(target.hp, hp);
  assert.ok(!log.some(message => message.t === 'sshot'));

  const point = [target.x, origin[1], target.z, target.id, 2];
  room.handleFire(shooter, { ...base, p: [point] }, 10);
  assert.equal(ammo.mag, mag - 1);
  assert.ok(log.some(message => message.t === 'sshot' && message.id === shooter.id));
  assert.ok(target.hp < hp);
});

test('Bù trễ dùng nhịp snapshot của chính người bắn và giữ giới hạn lịch sử', () => {
  const room = new ShooterRoom('rewind', 'Kiểm thử', { roomsChanged() {} }, 'dm', 'lantern');
  room.destroy();
  for (const id of [1, 2]) room.add({ id, name: 'Người chơi ' + id, ws: { readyState: 1, send() {} } });
  const shooter = room.players.get(1), target = room.players.get(2);
  target.protectUntil = 0;
  const origin = [shooter.x, shooter.y + 1.3, shooter.z];
  const point = [origin[0] + 0.5, origin[1], origin[2], target.id, 2];
  const fire = { o: origin, w: shooter.weapons[shooter.cur], p: [point] };
  const rewind = [];
  let t;
  room.nearPast = (_, x, y, z, since) => { rewind.push(t - since); return false; };
  shooter.ws.rtt = 0.15;
  t = 10;
  room.handleFire(shooter, fire, t);
  shooter.ws.snapshotFlow = { room: room.id, slow: true };
  t = 11;
  room.handleFire(shooter, fire, t);
  shooter.ws.rtt = 1;
  t = 12;
  room.handleFire(shooter, fire, t);
  assert.deepEqual(rewind.map(value => Math.round(value * 1000)), [387, 420, 700]);
});
