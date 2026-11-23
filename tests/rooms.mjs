// Kiểm tra HTTP và luồng tạo/vào phòng ở cả 7 chế độ trên một server localhost riêng.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { VERSION } from '../shared/version.js';

const host = '127.0.0.1';
const probe = createServer().listen(0, host);
await once(probe, 'listening');
const { port } = probe.address();
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const server = spawn(process.execPath, ['server/index.js', '--host', host, '--port', String(port)], { windowsHide: true });
server.stderr.pipe(process.stderr);
const sockets = [];
const base = 'http://' + host + ':' + port;
function connect() {
  const ws = new WebSocket('ws://' + host + ':' + port + '/ws');
  sockets.push(ws);
  ws.on('error', () => {});   // chờ báo lỗi theo gói tin chưa nhận được
  const messages = [];
  ws.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  return {
    send: message => ws.send(JSON.stringify(message)),
    close: () => ws.close(),
    wait: async (type, predicate = () => true) => {
      for (let attempt = 0; attempt < 150; attempt++) {
        const match = messages.find(message => message.t === type && predicate(message));
        if (match) return match;
        await delay(20);
      }
      throw new Error('Thiếu gói tin ' + type);
    },
  };
}
try {
  let info;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error('Server đã dừng: ' + server.exitCode);
    try {
      info = await (await fetch(base + '/api/info')).json();
      break;
    } catch {
      await delay(50);
    }
  }
  assert.equal(info?.version, VERSION);
  for (const route of ['/', '/js/main.js', '/shared/version.js', '/vendor/three/three.module.js']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length, route);
  }
  const ids = new Set();
  for (const [mode, joined] of [['brawl','joined'], ['team','joined'], ['practice','joined'], ['bomb','sj'], ['dm','sj'], ['xidach','cj'], ['tienlen','cj']]) {
    const hostClient = connect(), guest = connect();
    const welcomes = await Promise.all([hostClient.wait('welcome'), guest.wait('welcome')]);
    assert.ok(welcomes.every(message => message.v === info.version));
    hostClient.send({ t: 'hello', name: 'Chủ phòng' });
    guest.send({ t: 'hello', name: 'Khách thử' });
    hostClient.send({ t: 'create', name: 'Kiểm thử', mode });
    const first = await hostClient.wait(joined);
    assert.match(first.room.id, /^[a-f0-9-]{36}$/i);
    assert.ok(!ids.has(first.room.id));
    ids.add(first.room.id);
    await guest.wait('rooms', message => message.list.some(room => room.id === first.room.id && room.mode === mode));
    guest.send({ t: 'join', id: first.room.id });
    const second = await guest.wait(joined);
    assert.equal(second.room.id, first.room.id);
    if (mode === 'xidach') {
      hostClient.send({ t: 'cdealer' });
      await guest.wait('cs', state => state.dealer.human);
      hostClient.close();
      await guest.wait('cs', state => state.dealer.offline && state.host === first.you);
      const returned = connect();
      const welcome = await returned.wait('welcome');
      assert.notEqual(welcome.session, welcomes[0].session);
      returned.send({ t: 'cresume', id: first.room.id, session: welcomes[0].session });
      assert.equal((await returned.wait('cj', packet => packet.resumed)).you, first.you);
      await returned.wait('cs', state => state.youDealer && state.host === first.you);
      returned.send({ t: 'cresumeack' });
      returned.send({ t: 'ping', c: 'resume-confirmed' });
      await returned.wait('pong', m => m.c === 'resume-confirmed');
      const replay = connect();
      await replay.wait('welcome');
      replay.send({ t: 'cresume', id: first.room.id, session: welcomes[0].session });
      await replay.wait('cresumeno');
    }
    console.log(mode + ': hai người vào đúng phòng ' + first.room.id);
  }
  const response = await fetch(base + '/api/info');
  const lobby = await response.json();
  assert.equal(lobby.rooms.filter(room => ids.has(room.id)).length, 7);
} finally {
  for (const ws of sockets) ws.terminate();
  if (server.exitCode === null) server.kill();
}
