import assert from 'node:assert/strict';
import test from 'node:test';
import { Net } from '../client/js/net.js';
import { acknowledgeSnapshot, sendSnapshot, snapshotRate } from '../server/snapshots.js';

function socket(wantsSnapAck = false) {
  return { readyState: 1, bufferedAmount: 0, wantsSnapAck, received: [],
    send(data) { this.received.push(JSON.parse(data)); } };
}

test('Chỉ hạ nhịp kết nối nghẽn, phục hồi sau khi đường gửi ổn định', () => {
  const normal = socket(), congested = socket();
  const room = { id: 'arena', hub: {}, players: new Map([[1, { ws: normal }], [2, { ws: congested }]]) };
  for (let i = 0; i < 30; i++) sendSnapshot(room, 'ss', [[i]], i / 30);
  assert.equal(normal.received.length, 30);
  assert.equal(congested.received.length, 30);

  congested.bufferedAmount = 8192;
  for (let i = 30; i < 45; i++) sendSnapshot(room, 'ss', [[i]], i / 30);
  assert.equal(snapshotRate(congested, room.id), 20);
  assert.equal(snapshotRate(normal, room.id), 30);
  assert.equal(congested.received.length, 30);

  congested.bufferedAmount = 0;
  for (let i = 45; i < 75; i++) sendSnapshot(room, 'ss', [[i]], i / 30);
  assert.equal(congested.received.length, 50);
  assert.equal(normal.received.length, 75);
  assert.ok(congested.received[30].ps[0][0] >= 45);
  for (let i = 75; i < 150; i++) sendSnapshot(room, 'ss', [[i]], i / 30);
  assert.equal(snapshotRate(congested, room.id), 30);
});

test('Cửa sổ ACK chặn snapshot tích tụ sau socket và bỏ qua ACK sai phòng hoặc số thứ tự', () => {
  const ws = socket(true);
  ws.rtt = ws.rttMin = 0.05;
  const room = { id: 'arena', hub: {}, players: new Map([[1, { ws }]]) };
  for (let i = 0; i < 30; i++) sendSnapshot(room, 'snap', [[i]], i / 30);
  const sent = ws.received.length;
  assert.ok(sent > 0 && sent < 30);
  assert.equal(snapshotRate(ws, room.id), 20);
  acknowledgeSnapshot(ws, 'previous', sent, 1);
  acknowledgeSnapshot(ws, room.id, 9000, 1);
  sendSnapshot(room, 'snap', [[30]], 1);
  assert.equal(ws.received.length, sent);

  acknowledgeSnapshot(ws, room.id, sent, 1.1);
  sendSnapshot(room, 'snap', [[31]], 1.1);
  assert.equal(ws.received.length, sent + 1);
  assert.equal(ws.received.at(-1).ps[0][0], 31);
  for (let i = 0; i < 30; i++) sendSnapshot(room, 'snap', [[33 + i]], 1.2 + i / 30);
  assert.equal(ws.received.length, sent * 2); // ACK trễ không làm nới cửa sổ.

  const nextRoom = { ...room, id: 'next', snapshotSeq: 0 };
  sendSnapshot(nextRoom, 'snap', [[32]], 2.3);
  assert.equal(snapshotRate(ws, nextRoom.id), 30);
});

test('ACK cuối của đợt snapshot vẫn được gửi khi không có frame mới', async () => {
  const net = new Net(), sent = [];
  const flushed = new Promise(resolve => {
    net.send = ack => {
      sent.push(ack);
      if (ack.seq === 3) resolve();
    };
  });
  for (const seq of [1, 2, 3]) net.ackSnapshot({ room: 'arena', seq });
  await flushed;
  assert.deepEqual(sent.map(m => m.seq), [1, 3]);
});

test('RTT cao ổn định không làm giảm nhịp khi cửa sổ ACK theo kịp', () => {
  const ws = socket(true);
  ws.rttMin = 0.45;
  const room = { id: 'arena', hub: {}, players: new Map([[1, { ws }]]) };
  for (let i = 0; i < 90; i++) {
    if (i >= 15 && i % 3 === 0) acknowledgeSnapshot(ws, room.id, i - 14, i / 30);
    sendSnapshot(room, 'snap', [[i]], i / 30);
  }
  assert.equal(ws.received.length, 90);
  assert.equal(snapshotRate(ws, room.id), 30);
});
