// Đo luồng di chuyển của bot trên server do mình vận hành. Kết quả in JSON.
import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  bots: { type: 'string', default: '8' },
  'room-size': { type: 'string', default: '8' },
  seconds: { type: 'string', default: '15' },
  mode: { type: 'string', default: 'dm' },
  'reference-url': { type: 'string' },
  'reference-bots': { type: 'string', default: '0' },
  'no-compression': { type: 'boolean' },
  'shared-clock': { type: 'boolean' },
} });
const count = +values.bots, roomSize = +values['room-size'], seconds = +values.seconds;
const referenceCount = +values['reference-bots'], mode = values.mode;
if (positionals.length !== 1 || ![count, roomSize, seconds, referenceCount].every(Number.isSafeInteger) ||
    count < 1 || roomSize < 1 || seconds < 1 || referenceCount < 0 || referenceCount >= count ||
    (referenceCount > 0 && !values['reference-url']) || !['dm', 'brawl'].includes(mode)) {
  throw new Error('Dùng: node tests/network-bench.mjs URL --bots 48 --room-size 8 --seconds 45 --mode dm');
}
function endpoint(input) {
  const url = new URL('/ws', input);
  url.protocol = { 'http:': 'ws:', 'https:': 'wss:', 'ws:': 'ws:', 'wss:': 'wss:' }[url.protocol] || url.protocol;
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('URL phải là HTTP hoặc WebSocket');
  return url;
}
const primary = endpoint(positionals[0]);
const reference = referenceCount ? endpoint(values['reference-url']) : null;
const epoch = () => performance.timeOrigin + performance.now();
const bots = [], connectFailures = [];
let measuring = false;

function send(bot, message) {
  if (bot.ws.readyState === WebSocket.OPEN) bot.ws.send(JSON.stringify(message), { compress: message.t === 's' });
}

function connect(index, isReference) {
  const ws = new WebSocket(isReference ? reference : primary, {
    perMessageDeflate: !values['no-compression'], handshakeTimeout: 8000,
  });
  const bot = { ws, index, route: isReference ? 'reference' : 'primary', id: null, join: null, ackAt: -Infinity,
    x: 0, y: 0, z: 0, rtts: [], down: [], up: [], pongQueues: [], gaps: [], ages: [],
    bytes: 0, snapshots: 0, missing: 0, lastArrival: null, seq: null };
  bots.push(bot);
  return new Promise((resolve, reject) => {
    const fail = error => { clearTimeout(timeout); reject(error); };
    const timeout = setTimeout(() => { fail(new Error('Thiếu gói welcome')); ws.terminate(); }, 10000);
    ws.on('unexpected-response', (_, response) => {
      response.resume();
      fail(new Error('HTTP ' + response.statusCode));
      ws.terminate();
    });
    ws.on('error', error => {
      if (bot.id === null) fail(error);
    });
    ws.on('close', code => {
      bot.wireAtClose = ws._socket?.bytesRead ?? 0;
      clearTimeout(bot.ackTimer);
      bot.closeCode = code;
      if (bot.id === null) fail(new Error('WebSocket đóng ' + code));
    });
    ws.on('message', data => {
      const t = epoch();
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (measuring) bot.bytes += data.length;
      if (m.t === 'welcome') {
        clearTimeout(timeout);
        bot.id = m.id;
        bot.version = m.v;
        send(bot, { t: 'hello', name: 'Bench' + index, char: 'kaze', snapAck: true });
        resolve(bot);
      } else if (m.t === 'joined' || m.t === 'sj') {
        const self = m.players.find(p => p.id === bot.id);
        if (Number.isFinite(self?.x)) Object.assign(bot, { x: self.x, y: self.y, z: self.z });
        bot.join?.(m.room.id);
      } else if (m.t === 'sspawn' && m.id === bot.id) {
        [bot.x, bot.y, bot.z] = m.p;
      } else if (m.t === 'snap' || m.t === 'ss') {
        if (Number.isSafeInteger(m.seq)) {
          bot.pendingAck = { t: 'snapAck', room: m.room, seq: m.seq };
          if (!bot.ackTimer) {
            const flush = () => {
              bot.ackTimer = null;
              bot.ackAt = epoch();
              send(bot, bot.pendingAck);
            };
            const delay = bot.ackAt + 95 - t;
            if (delay <= 0) flush();
            else bot.ackTimer = setTimeout(flush, delay);
          }
        }
        if (!measuring) return;
        bot.snapshots++;
        if (bot.lastArrival !== null) bot.gaps.push(t - bot.lastArrival);
        if (Number.isFinite(m.at)) bot.ages.push(t - m.at);
        if (bot.seq !== null && Number.isSafeInteger(m.seq)) bot.missing += Math.max(0, m.seq - bot.seq - 1);
        bot.lastArrival = t;
        bot.seq = m.seq ?? null;
      } else if (m.t === 'pong' && measuring && m.c >= startedAt) {
        bot.rtts.push(t - m.c);
        if (Number.isFinite(m.queue)) bot.pongQueues.push(m.queue);
        if (values['shared-clock'] && Number.isFinite(m.at)) {
          bot.up.push(m.at - m.c);
          bot.down.push(t - m.at);
        }
      }
    });
  });
}

function join(bot, id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { bot.join = null; reject(new Error('Hết giờ chờ vào phòng')); }, 10000);
    bot.join = room => { bot.join = null; bot.joined = true; clearTimeout(timeout); resolve(room); };
    send(bot, id ? { t: 'join', id } : { t: 'create', mode, name: 'Đo mạng', map: mode === 'dm' ? 'lantern' : 'tournament' });
  });
}
function percentile(samples, fraction) {
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  return +samples[Math.ceil(samples.length * fraction) - 1].toFixed(2);
}
function report(group, elapsed) {
  const stats = (key, p = .95) => percentile(group.flatMap(bot => bot[key]), p);
  const excess = group.flatMap(bot => {
    const baseline = bot.ages.reduce((min, age) => Math.min(min, age), Infinity);
    return bot.ages.map(age => age - baseline);
  });
  const closeCodes = {};
  for (const { closeCode } of group) if (closeCode !== undefined) closeCodes[closeCode] = (closeCodes[closeCode] || 0) + 1;
  return {
    activeAtStart: group.filter(bot => bot.activeAtStart).length,
    stillConnected: group.filter(bot => bot.ws.readyState === WebSocket.OPEN).length, closeCodes,
    compression: group.filter(bot => bot.ws.extensions.includes('permessage-deflate')).length,
    samples: { ping: group.reduce((sum, bot) => sum + bot.rtts.length, 0), age: excess.length },
    pingP50Ms: stats('rtts', .5), pingP95Ms: stats('rtts'),
    upstreamP95Ms: stats('up'), downstreamP95Ms: stats('down'),
    receiveGapP95Ms: stats('gaps'), extraSnapshotAgeP95Ms: percentile(excess, .95),
    snapshotAgeP95Ms: values['shared-clock'] ? stats('ages') : null,
    pongQueuedP95Bytes: stats('pongQueues'),
    snapshotHzPerClient: +(group.reduce((sum, bot) => sum + bot.snapshots, 0) / group.length / elapsed * 1000).toFixed(2),
    skippedSnapshotSeq: group.reduce((sum, bot) => sum + bot.missing, 0),
    wireRxMbps: +(group.reduce((sum, bot) =>
      sum + Math.max(0, (bot.wireAtClose ?? bot.ws._socket?.bytesRead ?? 0) - bot.wireAtStart), 0) * 8 / elapsed / 1000).toFixed(3),
    decodedMbps: +(group.reduce((sum, bot) => sum + bot.bytes, 0) * 8 / elapsed / 1000).toFixed(3),
  };
}

let timer, startedAt = Infinity;
try {
  for (let start = 0; start < count; start += roomSize) {
    const results = await Promise.allSettled(Array.from({ length: Math.min(roomSize, count - start) },
      (_, i) => connect(start + i, start + i < referenceCount)));
    const group = results.flatMap((result, i) => {
      if (result.status === 'fulfilled') return [result.value];
      connectFailures.push({ index: start + i, error: result.reason.message });
      return [];
    });
    if (!group.length) continue;
    const groupHost = group[0];
    let room;
    try { room = await join(groupHost); } catch (error) {
      connectFailures.push({ index: groupHost.index, error: error.message });
      continue;
    }
    const others = await Promise.allSettled(group.slice(1).map(bot => join(bot, room)));
    others.forEach((result, i) => {
      if (result.status === 'rejected') connectFailures.push({ index: group[i + 1].index, error: result.reason.message });
    });
  }
  const active = bots.filter(bot => bot.joined);
  if (!active.length) throw new Error('Không có bot nào vào được phòng');
  let frame = 0;
  timer = setInterval(() => {
    frame++;
    for (const bot of active) {
      const phase = frame / 42 + bot.index;
      const p = [bot.x + Math.cos(phase) * 0.6, bot.y, bot.z + Math.sin(phase) * 0.6].map(n => +n.toFixed(2));
      send(bot, { t: 's', p, r: phase % (2 * Math.PI), a: 0, f: 0, w: 0 });
      if (frame % 30 === bot.index % 30) send(bot, { t: 'ping', c: epoch(), measure: true });
    }
  }, 1000 / 30);
  await wait(2000);
  for (const bot of active) {
    bot.activeAtStart = bot.ws.readyState === WebSocket.OPEN;
    bot.wireAtStart = bot.ws._socket?.bytesRead ?? 0;
  }
  startedAt = epoch();
  measuring = true;
  await wait(seconds * 1000);
  const elapsed = epoch() - startedAt;
  measuring = false;
  const routes = {};
  for (const key of ['primary', 'reference']) {
    const group = active.filter(bot => bot.route === key);
    if (group.length) routes[key] = report(group, elapsed);
  }
  console.log(JSON.stringify({ version: active[0].version, mode, count, roomSize, seconds, routes, connectFailures }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, connectFailures }, null, 2));
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  for (const { ws } of bots) ws.terminate();
}
