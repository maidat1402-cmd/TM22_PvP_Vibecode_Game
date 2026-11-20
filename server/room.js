// Một phòng đấu: lưu người chơi, mô phỏng chiêu thức, tính sát thương (server-authoritative).
import { startLoop } from './loop.js';
import { NET, Ticker, GAME, MOVE, TEAM, AWAKEN, rainPoints, hitsObstacle, arenaGround } from '../shared/config.js';
import { getArena } from '../shared/arenas.js';
import { getChar, charMaxHp, charSkills, skillLifetime } from '../shared/characters.js';
import { initSteer, steerStep, validAim } from '../shared/steer.js';

const BODY_R = GAME.bodyRadius;
const CHEST = 0.85;

function now() { return performance.now() / 1000; }
function r2(v) { return Math.round(v * 100) / 100; }
function hlen(x, z) { return Math.hypot(x, z) || 1e-6; }

// Khoảng cách từ điểm P tới đoạn thẳng AB (3D)
function distPointSeg(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const ab2 = abx * abx + aby * aby + abz * abz || 1e-6;
  let t = (apx * abx + apy * aby + apz * abz) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return Math.hypot(cx, cy, cz);
}

// Sát thương bỏng mỗi nhịp: không cộng dấu, không tích thanh dị biến, không gây bỏng tiếp
const BURN_SKILL = { fx: { kind: 'burn', color: 0xff5400 }, noMark: true, noGauge: true, noBurn: true };
// Hàng rào điện giữa 2 cọc sét (dị biến Shiden): mỗi lần chạm cộng 1 dấu điện
const FENCE_SKILL = { fx: { kind: 'fence', color: 0xc77dff } };
let nextPropId = 100000;   // id công trình (cọc sét, cột đá) — tách hẳn khỏi id người chơi

let nextRoomId = 1;
let nextEntityId = 1;

export class Room {
  constructor(name, hub, mapId, team = false) {
    this.id = String(nextRoomId++);
    this.name = name;
    this.arena = getArena(mapId);
    // Đấu đội: phòng chờ (lobby) → trận (play) → kết quả (end) → lại phòng chờ
    this.team = team;
    if (team) {
      this.phase = 'lobby';
      this.hostId = 0;
      this.score = { A: 0, B: 0 };
      this.winner = null;
      this.phaseEnd = 0;
      this.stateAcc = 0;
      // chia điểm hồi sinh: nửa phía nam cho đội Xanh, nửa phía bắc cho đội Đỏ
      const sorted = [...this.arena.spawns].sort((a, b) => a[1] - b[1]);
      const half = Math.ceil(sorted.length / 2);
      this.teamSpawns = { A: sorted.slice(0, half), B: sorted.slice(sorted.length - half) };
    }
    this.hub = hub;
    this.players = new Map(); // id -> player
    this.entities = [];
    this.dyn = [];            // chướng ngại vật tạm thời { x, z, r, h, until, owner }
    this.props = [];          // công trình có máu (cọc sét, cột đá): đối thủ đánh phá được
    this.fenceCd = new Map(); // hàng rào điện: lần chạm gần nhất của từng (cặp cọc, người)
    this.lastTick = now();
    this.snapT = new Ticker(NET.snapRate);
    this.stopLoop = startLoop(NET.tickRate, () => this.tick());
  }

  get count() { return this.players.size; }

  destroy() { this.stopLoop(); }

  info() {
    return { id: this.id, name: this.name, count: this.count, mode: this.team ? 'team' : 'brawl', map: this.arena.id, mapName: this.arena.name,
      phase: this.team ? this.phase : undefined };
  }

  // ---------- Quản lý người chơi ----------
  spawnPoint(team) {
    // chọn điểm hồi sinh xa người chơi khác (đấu đội: xa đối thủ, trong nửa sân của đội mình)
    const list = this.team && team ? this.teamSpawns[team] : this.arena.spawns;
    let best = list[0], bestD = -1;
    for (const s of list) {
      let minD = 1e9;
      for (const p of this.players.values()) {
        if (p.dead || (this.team && p.team === team)) continue;
        minD = Math.min(minD, Math.hypot(p.x - s[0], p.z - s[1]));
      }
      minD += Math.random() * 4;
      if (minD > bestD) { bestD = minD; best = s; }
    }
    return best;
  }

  publicPlayer(p) {
    return { id: p.id, name: p.name, char: p.char, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw),
      hp: Math.ceil(p.hp), mp: Math.floor(p.mp), dead: p.dead, kills: p.kills, deaths: p.deaths, team: p.team || null,
      awk: Math.floor(p.awk || 0), aw: p.awUntil > now() ? r2(p.awUntil - now()) : 0 };
  }

  add(client) {
    // đấu đội: vào đội ít người hơn
    let team = null;
    if (this.team) {
      const n = this.teamCounts();
      team = n.A <= n.B ? 'A' : 'B';
    }
    const [sx, sz] = this.spawnPoint(team);
    const p = {
      id: client.id, ws: client.ws, name: client.name, char: client.char,
      x: sx, y: 0, z: sz, yaw: Math.atan2(-sx, -sz), anim: 0, flags: 0,
      hp: charMaxHp(client.char), maxHp: charMaxHp(client.char), mp: GAME.maxMana, dead: false, respawnAt: 0,
      lastHit: -99, kills: 0, deaths: 0, cds: {}, lockUntil: 0, healCd: 0,
      healUntil: 0, healRate: 0, invulnUntil: 0, stunUntil: 0, lastSeen: now(),
      team, ready: false,
      awk: 0, awUntil: 0, tiredUntil: 0,   // thanh dị biến, hết dị biến lúc, kiệt sức tới lúc
    };
    this.players.set(p.id, p);
    client.room = this;
    if (this.team && !this.hostId) this.hostId = p.id;
    this.send(p, { t: 'joined', you: p.id, room: { id: this.id, name: this.name, map: this.arena.id, team: this.team },
      players: [...this.players.values()].map(q => this.publicPlayer(q)), props: this.props.map(q => this.publicProp(q)) });
    this.broadcast({ t: 'pjoin', player: this.publicPlayer(p) }, p.id);
    this.broadcast({ t: 'sys', msg: this.team ? `${p.name} đã vào ${TEAM.names[team]}` : `${p.name} đã vào phòng` });
    if (this.team) this.sendTeamState();
    this.hub.roomsChanged();
  }

  remove(clientId) {
    const p = this.players.get(clientId);
    if (!p) return;
    this.players.delete(clientId);
    this.broadcast({ t: 'pleave', id: clientId });
    this.broadcast({ t: 'sys', msg: `${p.name} đã rời phòng` });
    this.entities = this.entities.filter(e => e.owner !== clientId);
    for (const pr of this.props.filter(q => q.owner === clientId)) this.removeProp(pr, 'time');
    this.dyn = this.dyn.filter(o => o.owner !== clientId);
    if (this.team && this.players.size) {
      if (this.hostId === clientId) {
        const next = this.players.values().next().value;
        this.hostId = next.id;
        this.broadcast({ t: 'sys', msg: `👑 ${next.name} trở thành chủ phòng` });
      }
      // đang đánh mà một đội không còn ai: đội còn lại thắng
      if (this.phase === 'play') {
        const n = this.teamCounts();
        if (!n.A || !n.B) this.endMatch(n.A ? 'A' : 'B');
      }
      this.sendTeamState();
    }
    this.hub.roomsChanged();
  }

  // ---------- Đấu đội ----------
  teamCounts() {
    const n = { A: 0, B: 0 };
    for (const q of this.players.values()) n[q.team]++;
    return n;
  }

  // Lý do chưa bắt đầu được (null = bắt đầu được)
  startBlock() {
    const n = this.teamCounts();
    if (!n.A || !n.B) return 'Mỗi đội cần ít nhất 1 người';
    const wait = [...this.players.values()].filter(q => q.id !== this.hostId && !q.ready).length;
    if (wait) return `Còn ${wait} người chưa sẵn sàng`;
    return null;
  }

  sendTeamState() {
    const t = now();
    this.broadcast({
      t: 'tstate', phase: this.phase, host: this.hostId, score: this.score, winner: this.winner,
      left: this.phaseEnd ? Math.max(0, Math.round(this.phaseEnd - t)) : 0, limit: TEAM.killLimit,
      block: this.phase === 'lobby' ? this.startBlock() : null,
      players: [...this.players.values()].map(q => [q.id, q.team, q.ready ? 1 : 0, q.kills, q.deaths]),
    });
    this.stateAcc = 0;
  }

  startMatch() {
    const t = now();
    this.phase = 'play';
    this.score = { A: 0, B: 0 };
    this.winner = null;
    this.phaseEnd = t + TEAM.timeLimit;
    this.entities = [];
    for (const pr of [...this.props]) this.removeProp(pr, 'time');
    for (const p of this.players.values()) {
      const [sx, sz] = this.spawnPoint(p.team);
      Object.assign(p, { dead: false, hp: p.maxHp, mp: GAME.maxMana, x: sx, y: 0, z: sz, kills: 0, deaths: 0,
        invulnUntil: t + 1.5, stunUntil: 0, lockUntil: 0, cds: {}, healCd: 0, healUntil: 0, ready: false, burn: null, frost: null });
      this.endAwaken(p, true);
      p.awk = 0;
      this.broadcast({ t: 'respawn', id: p.id, p: [sx, 0, sz] });
    }
    this.broadcast({ t: 'sys', msg: `⚔ Trận đấu bắt đầu! Đội nào hạ ${TEAM.killLimit} mạng trước sẽ thắng.` });
    this.sendTeamState();
    this.hub.roomsChanged();
  }

  endMatch(winner) {
    if (this.phase !== 'play') return;
    this.phase = 'end';
    this.winner = winner;          // 'A' | 'B' | 'draw'
    this.phaseEnd = now() + TEAM.endDelay;
    this.entities = [];
    this.broadcast({ t: 'sys', msg: winner === 'draw' ? '🤝 Hai đội hoà!' : `🏆 ${TEAM.names[winner]} chiến thắng ${this.score.A} - ${this.score.B}!` });
    this.sendTeamState();
  }

  backToLobby() {
    this.phase = 'lobby';
    this.phaseEnd = 0;
    this.winner = null;
    this.score = { A: 0, B: 0 };
    for (const p of this.players.values()) p.ready = false;
    this.sendTeamState();
    this.hub.roomsChanged();
  }

  onTeamMessage(p, m) {
    switch (m.t) {
      case 'tteam': {
        if (this.phase !== 'lobby') return;
        const team = m.team === 'B' ? 'B' : 'A';
        if (team === p.team) return;
        p.team = team;
        p.ready = false;
        this.broadcast({ t: 'sys', msg: `${p.name} chuyển sang ${TEAM.names[team]}` });
        break;
      }
      case 'tready':
        if (this.phase !== 'lobby') return;
        p.ready = !!m.on;
        break;
      case 'tstart': {
        if (this.phase !== 'lobby' || p.id !== this.hostId) return;
        const why = this.startBlock();
        if (why) return this.send(p, { t: 'sys', msg: `Chưa bắt đầu được: ${why}` });
        return this.startMatch();
      }
      default: return;
    }
    this.sendTeamState();
  }

  send(p, msg) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(msg, exceptId) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
    }
  }

  // ---------- Xử lý tin nhắn ----------
  onMessage(clientId, m) {
    const p = this.players.get(clientId);
    if (!p) return;
    const t = now();
    p.lastSeen = t;
    switch (m.t) {
      case 's': { // trạng thái di chuyển (client-authoritative cho mượt)
        if (p.dead || !Array.isArray(m.p)) return;
        const [x, y, z] = m.p;
        if (![x, y, z].every(Number.isFinite)) return;
        p.yaw = +m.r || 0; p.anim = m.a | 0; p.flags = m.f | 0;
        // vừa dịch chuyển: gói vị trí cũ còn trên đường truyền thì bỏ qua
        if (t < (p.tpUntil || 0) && Math.hypot(x - p.x, z - p.z) > 3) break;
        p.x = x; p.y = Math.max(0, y); p.z = z;
        break;
      }
      case 'dodge': // né (dash) => bất tử ngắn
        if (!p.dead) p.invulnUntil = Math.max(p.invulnUntil, t + MOVE.dashInvuln);
        break;
      case 'cast': this.handleCast(p, m, t); break;
      case 'tteam': case 'tready': case 'tstart': if (this.team) this.onTeamMessage(p, m); break;
      case 'heal': this.handleHeal(p, t); break;
      case 'awk': this.handleAwaken(p, t); break;
      case 'steer': { // cập nhật tâm ngắm cho chiêu cuối đang chạy
        const e = p.steerEnt, a = validAim(m.a);
        if (!e || e.dead || !a) return;
        e.st.aim = a;
        this.broadcast({ t: 'steer', eid: e.id, a: a.map(r2) }, p.id);
        break;
      }
      case 'char': {
        const c = getChar(m.char);
        // đổi nhân vật: mất dị biến và thanh dị biến
        this.endAwaken(p, true);
        p.awk = 0;
        p.char = c.id;
        // đổi nhân vật: giữ nguyên tỉ lệ máu hiện tại theo máu tối đa mới
        const ratio = p.maxHp ? p.hp / p.maxHp : 1;
        p.maxHp = charMaxHp(c);
        if (!p.dead) p.hp = Math.max(1, Math.round(ratio * p.maxHp));
        this.broadcast({ t: 'pchar', id: p.id, char: c.id });
        break;
      }
      case 'chat': {
        const msg = String(m.msg || '').slice(0, 140).trim();
        if (msg) this.broadcast({ t: 'chat', id: p.id, name: p.name, msg });
        break;
      }
    }
  }

  handleHeal(p, t) {
    const H = GAME.heal;
    if (p.dead || t < p.healCd || p.mp < H.mana) return this.send(p, { t: 'healno' });
    p.mp -= H.mana;
    p.healCd = t + H.cd;
    p.healUntil = t + H.dur;
    p.healRate = H.amount / H.dur;
    this.broadcast({ t: 'healfx', id: p.id });
  }

  handleCast(p, m, t) {
    const ch = getChar(p.char);
    const sIdx = m.sk | 0;
    // dạng dị biến: client báo aw = 1, server chấp nhận nếu còn dị biến (dung sai trễ mạng 0.25 s)
    const aw = !!m.aw;
    if (aw && !(p.awUntil > t - 0.25)) return this.send(p, { t: 'castno', cs: m.cs, sk: sIdx, aw: 1, mp: Math.floor(p.mp) });
    let s = charSkills(ch, aw)[sIdx];
    const cdKey = sIdx + (aw ? 10 : 0);
    const reject = () => this.send(p, { t: 'castno', cs: m.cs, sk: sIdx, aw: aw ? 1 : 0, mp: Math.floor(p.mp) });
    if (!s || p.dead || t < p.stunUntil - 0.05) return reject();
    if (t < (p.cds[cdKey] || 0) - 0.08) return reject();      // dung sai nhỏ cho lag
    if (t < p.lockUntil - 0.12) return reject();
    if (p.mp < s.mana) return reject();
    // đòn kết chuỗi J: chỉ hợp lệ ngay sau 2 đòn J liên tiếp
    if (s.chain && !((p.jn || 0) >= 2 && t - (p.jLast || 0) < 1.3)) return reject();
    if (!Array.isArray(m.p) || !Array.isArray(m.d)) return reject();
    let [x, y, z] = m.p.map(Number);
    let [dx, dy, dz] = m.d.map(Number);
    if (![x, y, z, dx, dy, dz].every(Number.isFinite)) return reject();
    // Không tin vị trí cast lệch quá xa vị trí server biết
    if (Math.hypot(x - p.x, z - p.z) > 6) { x = p.x; y = p.y; z = p.z; }
    // cho phép ngắm lên/xuống dốc (đối thủ đang bay, hoặc mình đang bay bắn xuống)
    const hl0 = Math.hypot(dx, dz);
    if (hl0 < 0.3) { const k = 0.3 / (hl0 || 1); dx = hl0 ? dx * k : 0.3; dz *= k; }
    dy = Math.max(-0.95, Math.min(0.95, dy));
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    // nhổ cột đá ném (dị biến Gantetsu): đạn bay ra từ cột đá của mình gần nhất, cột đá biến mất
    let ripId = 0;
    if (s.rip) {
      const pr = this.findRip(p, x, z, m.rp, s.rip.range);
      if (pr) { ripId = pr.id; x = pr.x; y = pr.y + 1.2; z = pr.z; this.removeProp(pr, 'rip'); s = s.ripSkill; }
    }

    p.mp -= s.mana;
    p.cds[cdKey] = t + s.cd;
    p.lockUntil = t + s.lock;
    // đếm chuỗi J
    if (sIdx === 0) { p.jn = t - (p.jLast || 0) < 1.3 ? (p.jn || 0) + 1 : 1; p.jLast = t; }
    else p.jn = 0;
    if (s.invuln && s.type === 'dash' && !s.bigCharge) p.invulnUntil = Math.max(p.invulnUntil, t + s.delay + s.dur + 0.05);

    const seed = (m.seed >>> 0) || ((Math.random() * 2 ** 31) | 0);
    const e = {
      id: nextEntityId++, owner: p.id, skill: s, t0: t, p: [x, y, z], d: [dx, dy, dz],
      hits: new Map(), seed, dead: false, end: t + skillLifetime(s), state: {},
    };
    const hl = hlen(dx, dz);
    e.h = [dx / hl, dz / hl];
    if (s.type === 'projectile') {
      e.subs = [];
      for (let k = 0; k < s.count; k++) {
        const a = (k - (s.count - 1) / 2) * s.spread;
        const c = Math.cos(a), sn = Math.sin(a);
        // xoay hướng quanh trục Y
        const ddx = dx * c - dz * sn, ddz = dx * sn + dz * c;
        e.subs.push({ k, d: [ddx, dy, ddz], pos: [x + ddx * 0.6, y + CHEST + dy * 0.6, z + ddz * 0.6], alive: true });
        if (s.seek) e.subs[k].seek = true;
      }
    }
    if (s.type === 'rain') e.pts = rainPoints(s, seed);
    e.st = initSteer(s, [x, y, z], [dx, dy, dz], e.h);
    if (e.st) p.steerEnt = e;
    let tg = null;   // điểm đích (nhảy / dịch chuyển / bẫy / cây) gửi kèm để mọi máy vẽ cùng chỗ
    if (s.type === 'leap' || s.type === 'pillar') {
      // nhảy tới (dựng cột đá ở) điểm tâm ngắm, giới hạn tầm và trong sân
      const a = validAim(m.a);
      let tx = a ? a[0] : x + e.h[0] * Math.min(10, s.range), tz = a ? a[2] : z + e.h[1] * Math.min(10, s.range);
      const L2 = Math.hypot(tx - x, tz - z);
      if (L2 > s.range) { tx = x + (tx - x) / L2 * s.range; tz = z + (tz - z) / L2 * s.range; }
      tg = this.clampToArena(tx, tz);
    } else if (s.type === 'blink') {
      // ra sau lưng đối thủ gần tâm ngắm nhất (dị biến Kage); không có thì như Thuấn Ảnh:
      // dấu phi đao còn hạn và trong tầm thì tới đó, không thì lướt bóng về phía trước
      const mk = p.shadowMark;
      const bt = s.behind ? this.aimTarget(p, x, z, e.h, s.behind) : null;
      // Lôi Độn (dị biến Shiden): tới cọc sét của mình gần tâm ngắm nhất
      const rod = s.toRod ? this.aimProp(p, x, z, e.h, s.toRod, 'rod') : null;
      if (rod) {
        const rl = Math.hypot(x - rod.x, z - rod.z) || 1;
        tg = this.clampToArena(rod.x + (x - rod.x) / rl * 0.9, rod.z + (z - rod.z) / rl * 0.9);
      } else if (bt) tg = this.clampToArena(bt.x - Math.sin(bt.yaw) * 1.6, bt.z - Math.cos(bt.yaw) * 1.6);
      else if (mk && t < mk.until && Math.hypot(mk.x - x, mk.z - z) <= s.markRange) { tg = [mk.x, mk.z]; p.shadowMark = null; this.broadcast({ t: 'kmark', id: p.id, off: 1 }); }
      else tg = this.clampToArena(x + e.h[0] * s.dist, z + e.h[1] * s.dist);
      tg = this.freeSpot(tg[0], tg[1], x, z);
    } else if (s.type === 'trap' || s.type === 'summon') {
      tg = this.clampToArena(x + e.h[0] * s.offset, z + e.h[1] * s.offset);
      if (s.type === 'trap') {
        // tối đa s.max bẫy mỗi người: bẫy cũ nhất biến mất
        const mine = this.entities.filter(q => q.owner === p.id && q.skill === s && !q.dead);
        while (mine.length >= s.max) { const old = mine.shift(); old.dead = true; this.broadcast({ t: 'pend', eid: old.id, k: 0 }); }
      }
    } else if (s.type === 'buff') {
      this.applyBuff(p, s, t + s.delay + s.dur);
      if (s.invuln) p.invulnUntil = Math.max(p.invulnUntil, t + s.delay + s.dur);
    } else if (s.type === 'wall') {
      tg = this.clampToArena(x + e.h[0] * s.offset, z + e.h[1] * s.offset);
    }
    if (tg) e.tg = tg;
    this.entities.push(e);

    const out = { t: 'cast', id: p.id, sk: sIdx, eid: e.id, p: [r2(x), r2(y), r2(z)], d: [r2(dx), r2(dy), r2(dz)], seed };
    if (aw) out.aw = 1;
    if (tg) out.tg = tg.map(r2);
    if (ripId) out.rp = ripId;
    this.broadcast(out, p.id);
    this.send(p, { ...out, cs: m.cs, mp: Math.floor(p.mp) });
  }

  // ---------- Cơ chế đặc biệt ----------
  clampToArena(x, z) {
    const R = this.arena.radius - 1.2, d = Math.hypot(x, z);
    return d > R ? [x / d * R, z / d * R] : [x, z];
  }

  // lùi điểm đích về phía điểm xuất phát nếu rơi vào trong chướng ngại vật
  freeSpot(x, z, fx, fz) {
    for (let i = 0; i < 12; i++) {
      if (!hitsObstacle(x, 1, z, 1.4, this.arena, this.dyn)) break;
      x += (fx - x) * 0.15; z += (fz - z) * 0.15;
    }
    return [x, z];
  }

  // dịch chuyển tức thời người chơi tới (x, z)
  teleport(p, x, z, t) {
    const from = [r2(p.x), r2(p.y), r2(p.z)];
    p.x = x; p.z = z; p.y = 0;
    p.tpUntil = t + 0.35;
    this.broadcast({ t: 'tp', id: p.id, from, p: [r2(x), 0, r2(z)] });
  }

  applyBuff(p, s, until) {
    p.buff = { until, kind: s.fx.kind, dmgTaken: s.dmgTaken || 1, noKb: !!s.noKb, stealth: !!s.stealth, nextHitMul: s.nextHitMul || 1 };
    this.broadcast({ t: 'buff', id: p.id, kind: s.fx.kind, dur: r2(until - now()), stealth: !!s.stealth });
  }

  endBuff(p) {
    if (!p.buff) return;
    p.buff = null;
    this.broadcast({ t: 'buff', id: p.id, kind: null });
  }

  // Nội tại Tích Điện (Shiden): thêm dấu, đủ dấu thì sét nảy
  addCharge(src, tgt, n, t) {
    const ps = getChar(src.char).passive;
    if (!ps || ps.kind !== 'charge' || tgt.dead) return;
    const stacks = this.awOf(src, t)?.passive.chargeStacks || ps.stacks;
    const mk = (tgt.charges ||= new Map());
    const cur = mk.get(src.id);
    let cnt = (cur && t < cur.until ? cur.n : 0) + n;
    if (cnt < stacks) {
      mk.set(src.id, { n: cnt, until: t + ps.dur });
      this.broadcast({ t: 'mark', tid: tgt.id, sid: src.id, n: cnt, dur: ps.dur });
      return;
    }
    mk.delete(src.id);
    this.broadcast({ t: 'mark', tid: tgt.id, sid: src.id, n: 0 });
    // sét nảy: mục tiêu chính rồi tối đa ps.jumps đối thủ gần nhất
    this.chainFrom(src, tgt, ps.dmg, ps.jumps, ps.jumpDmg, ps.range, ps.stun, 0xc77dff);
  }

  // Sét nảy từ first sang tối đa jumps đối thủ gần nhất (firstDmg = 0: first đã trúng đòn rồi)
  chainFrom(src, first, firstDmg, jumps, jumpDmg, range, stun, color) {
    const chainSkill = { fx: { kind: 'chain', color }, stun, noMark: true };
    const pts = [[r2(first.x), r2(first.y + 1), r2(first.z)]];
    const hitIds = new Set([first.id]);
    let last = first;
    if (firstDmg) this.damage(src, first, firstDmg, [0, 2, 0], chainSkill, [first.x, first.y + 1, first.z]);
    for (let j = 0; j < jumps; j++) {
      let best = null, bd = range;
      for (const q of this.players.values()) {
        if (q === src || q.dead || hitIds.has(q.id) || (this.team && q.team === src.team)) continue;
        const d = Math.hypot(q.x - last.x, q.z - last.z);
        if (d < bd) { bd = d; best = q; }
      }
      if (!best) break;
      hitIds.add(best.id);
      pts.push([r2(best.x), r2(best.y + 1), r2(best.z)]);
      this.damage(src, best, jumpDmg, [0, 2, 0], chainSkill, [best.x, best.y + 1, best.z]);
      last = best;
    }
    if (firstDmg || pts.length > 1) this.broadcast({ t: 'chain', pts, c: color, nosky: firstDmg ? undefined : 1 });
  }

  // Đối thủ gần hướng nhìn nhất trong tầm (dịch chuyển ra sau lưng)
  aimTarget(p, x, z, h, range) {
    let best = null, bs = Infinity;
    for (const q of this.players.values()) {
      if (q === p || q.dead || (this.team && q.team === p.team)) continue;
      const vx = q.x - x, vz = q.z - z, d = Math.hypot(vx, vz);
      if (d > range || d < 0.5) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * h[0] + vz * h[1]) / d)));
      if (ang > 0.8) continue;
      const sc = ang * 3 + d * 0.05;
      if (sc < bs) { bs = sc; best = q; }
    }
    return best;
  }

  // Cọc sét ở chỗ thương rơi (cắm xuống mặt đất / nóc chướng ngại vật bên dưới)
  spawnRod(e, src, R, x, y, z, t) {
    [x, z] = this.clampToArena(x, z);
    const gy = arenaGround(this.arena, x, z, Math.max(0, y), 0.3);
    const mine = this.props.filter(q => q.owner === src.id && q.kind === 'rod');
    while (mine.length >= R.max) this.removeProp(mine.shift(), 'time');
    this.addProp({ kind: 'rod', owner: src.id, team: src.team || null, x, y: gy, z, r: 0.45, h: 2.6, hp: R.hp, until: t + R.dur, fence: R.fence });
  }

  // Vòng cột đá tạm thời quanh (cx, cz)
  spawnWalls(cx, cz, W, e, t) {
    for (let i = 0; i < W.count; i++) {
      const a = (i / W.count) * Math.PI * 2 + e.seed % 7;
      this.dyn.push({ x: cx + Math.cos(a) * W.ring, z: cz + Math.sin(a) * W.ring, r: W.r, h: W.h, until: t + W.dur, owner: e.owner });
    }
  }

  // ---------- Công trình (cọc sét, cột đá): có máu, đối thủ đánh phá được ----------
  publicProp(pr) {
    return { id: pr.id, k: pr.kind, o: pr.owner, tm: pr.team || null, p: [r2(pr.x), r2(pr.y), r2(pr.z)], r: pr.r, h: pr.h,
      hp: Math.ceil(pr.hp), mhp: pr.maxHp, dur: r2(Math.max(0, pr.until - now())), fr: pr.fence?.range };
  }

  addProp(o) {
    const pr = { id: nextPropId++, isProp: true, dead: false, yaw: 0, maxHp: o.hp, ...o };
    // cột đá: chướng ngại vật chắn đường, chắn đạn, đứng lên nóc được
    if (o.solid) { pr.dyn = { x: pr.x, z: pr.z, r: pr.r, h: pr.y + pr.h, until: pr.until, owner: pr.owner, prop: pr.id }; this.dyn.push(pr.dyn); }
    this.props.push(pr);
    this.broadcast({ t: 'prop', ...this.publicProp(pr) });
    return pr;
  }

  // why: 'time' (hết giờ), 'break' (bị phá), 'rip' (bị nhổ lên ném), 'quake' (vỡ khi động đất)
  removeProp(pr, why) {
    if (pr.dead) return;
    pr.dead = true;
    this.props = this.props.filter(q => q !== pr);
    if (pr.dyn) this.dyn = this.dyn.filter(o => o !== pr.dyn);
    this.broadcast({ t: 'prop', id: pr.id, end: why });
  }

  damageProp(src, pr, amount) {
    if (pr.dead) return false;
    pr.hp -= Math.max(1, Math.round(amount));
    if (pr.hp <= 0) this.removeProp(pr, 'break');
    else this.broadcast({ t: 'prop', id: pr.id, hp: Math.ceil(pr.hp) });
    return true;
  }

  // Công trình loại kind của p gần hướng ngắm nhất trong tầm (ưu tiên góc nhỏ, rồi gần)
  aimProp(p, x, z, h, range, kind) {
    let best = null, bs = Infinity;
    for (const pr of this.props) {
      if (pr.dead || pr.owner !== p.id || pr.kind !== kind) continue;
      const vx = pr.x - x, vz = pr.z - z, d = Math.hypot(vx, vz);
      if (d > range || d < 1) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * h[0] + vz * h[1]) / d)));
      if (ang > 1.2) continue;
      const sc = ang * 3 + d * 0.05;
      if (sc < bs) { bs = sc; best = pr; }
    }
    return best;
  }

  // Cột đá để nhổ lên ném: cột client gợi ý (rp) nếu hợp lệ, không thì cột của mình gần nhất trong tầm
  findRip(p, x, z, rp, range) {
    let best = null, bd = range;
    for (const pr of this.props) {
      if (pr.dead || pr.owner !== p.id || pr.kind !== 'pillar') continue;
      const d = Math.hypot(pr.x - x, pr.z - z);
      if (pr.id === rp && d <= range + 2) return pr;
      if (d <= bd) { bd = d; best = pr; }
    }
    return best;
  }

  // Hàng rào điện: mọi cặp cọc sét của cùng một người cách nhau dưới fence.range
  updateFences(t) {
    const by = new Map();
    for (const pr of this.props) if (pr.kind === 'rod' && !pr.dead) { if (!by.has(pr.owner)) by.set(pr.owner, []); by.get(pr.owner).push(pr); }
    for (const [oid, rods] of by) {
      if (rods.length < 2) continue;
      const src = this.players.get(oid);
      if (!src) continue;
      for (let i = 0; i < rods.length; i++) for (let j = i + 1; j < rods.length; j++) {
        const a = rods[i], b = rods[j], F = a.fence;
        if (Math.hypot(a.x - b.x, a.z - b.z) > F.range) continue;
        for (const q of this.players.values()) {
          if (q === src || q.dead || (this.team && q.team === src.team)) continue;
          if (q.y > Math.max(a.y, b.y) + F.h) continue;   // nhảy qua hàng rào thì né được
          if (distPointSeg(q.x, 0, q.z, a.x, 0, a.z, b.x, 0, b.z) > F.w + BODY_R * 0.5) continue;
          const key = a.id + ':' + b.id + ':' + q.id;
          if (t < (this.fenceCd.get(key) || 0)) continue;
          this.fenceCd.set(key, t + F.cd);
          this.damage(src, q, F.dmg, [0, 2, 0], FENCE_SKILL, [q.x, q.y + 1, q.z]);
        }
      }
    }
    if (this.fenceCd.size > 200) for (const [k, v] of this.fenceCd) if (v < t) this.fenceCd.delete(k);
  }

  // ---------- Dị biến ----------
  awOf(p, t = now()) { return p && p.awUntil > t ? getChar(p.char).awaken : null; }

  handleAwaken(p, t) {
    if (p.dead || p.awUntil > t || (p.awk || 0) < AWAKEN.max - 0.01 || t < p.stunUntil) return this.send(p, { t: 'awkno', awk: Math.floor(p.awk || 0) });
    const A = getChar(p.char).awaken;
    p.awk = 0;
    p.awUntil = t + AWAKEN.transform + AWAKEN.dur;
    p.tiredUntil = 0;
    p.invulnUntil = Math.max(p.invulnUntil, t + AWAKEN.transform);
    p.lockUntil = Math.max(p.lockUntil, t + AWAKEN.transform);
    p.mp = GAME.maxMana;
    p.jn = 0;
    this.broadcast({ t: 'awk', id: p.id, on: 1, dur: r2(p.awUntil - t), tf: AWAKEN.transform });
    this.broadcast({ t: 'sys', msg: `⚡ ${p.name} dị biến: ${A.name}!` });
    // sóng xung kích lúc biến hình: đẩy văng đối thủ đứng gần
    const S = AWAKEN.shock, sk = { fx: { kind: 'awaken', color: A.color }, noGauge: true, noMark: true, noBurn: true };
    for (const q of this.players.values()) {
      if (q === p || q.dead || (this.team && q.team === p.team)) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) < S.radius + BODY_R && Math.abs(q.y - p.y) < 4) this.damage(p, q, S.dmg, this.kbFrom(p.x, p.z, q, S), sk, [q.x, q.y + 1, q.z]);
    }
  }

  // Hết dị biến (silent: chết / đổi nhân vật / trận mới — không kiệt sức)
  endAwaken(p, silent) {
    if (!p.awUntil) return;
    p.awUntil = 0;
    for (const k of Object.keys(p.cds)) if (+k >= 10) delete p.cds[k];
    p.tiredUntil = silent ? 0 : now() + AWAKEN.tired;
    this.broadcast({ t: 'awk', id: p.id, on: 0, tired: silent ? 0 : AWAKEN.tired });
  }

  hitsDyn(x, y, z, r) {
    for (const o of this.dyn) if (y < o.h && Math.hypot(x - o.x, z - o.z) < o.r + r * 0.5) return true;
    return false;
  }

  // ---------- Sát thương ----------
  damage(src, tgt, amount, kb, s, at) {
    if (tgt.isProp) return this.damageProp(src, tgt, amount);
    const t = now();
    if (tgt.dead || t < tgt.invulnUntil) return false;
    // đấu đội: phòng chờ/kết quả không mất máu, không đánh được đồng đội
    if (this.team && (this.phase !== 'play' || (src && src !== tgt && src.team === tgt.team))) return false;
    let crit = false;
    const other = src && src !== tgt;
    const sa = other ? this.awOf(src, t)?.passive : null;   // nội tại dị biến của người đánh
    const ta = this.awOf(tgt, t)?.passive;                   // nội tại dị biến của người bị đánh
    if (other) {
      // đòn đầu tiên khi đang tàng hình
      if (src.buff?.stealth && t < src.buff.until) { amount *= src.buff.nextHitMul; crit = true; this.endBuff(src); }
      // đâm sau lưng: kẻ tấn công nằm phía sau hướng nhìn của mục tiêu
      const back = s.backstab || (s.noMark ? 0 : sa?.backAll);
      if (back) {
        const fx = Math.sin(tgt.yaw), fz = Math.cos(tgt.yaw);
        if (fx * (src.x - tgt.x) + fz * (src.z - tgt.z) < 0) { amount *= back; crit = true; }
      }
    }
    // giáp đá: giảm sát thương, không bị đẩy lùi
    if (tgt.buff && t < tgt.buff.until) {
      amount *= tgt.buff.dmgTaken;
      if (tgt.buff.noKb) kb = [0, 0, 0];
    }
    if (ta) {
      if (ta.dmgTaken) amount *= ta.dmgTaken;
      if (ta.noKb) kb = [0, 0, 0];
      // đang ở trên không (Kaze dị biến bay tự do) thì nhận thêm sát thương
      if (ta.airTaken && tgt.y - arenaGround(this.arena, tgt.x, tgt.z, tgt.y, BODY_R) > 1.2) amount *= ta.airTaken;
    }
    amount = Math.max(1, Math.round(amount));
    tgt.hp -= amount;
    tgt.lastHit = t;
    if (other) src.mp = Math.min(GAME.maxMana, src.mp + amount * GAME.manaOnHitRatio);
    // thanh dị biến: chỉ tích khi chưa dị biến
    if (other && !s.noGauge && !(src.awUntil > t)) src.awk = Math.min(AWAKEN.max, (src.awk || 0) + amount * AWAKEN.gain);
    const msg = { t: 'hit', tid: tgt.id, sid: src ? src.id : 0, dmg: amount, hp: Math.max(0, Math.ceil(tgt.hp)),
      kb: kb.map(r2), at: at.map(r2), fx: s.fx.kind, c: s.fx.color };
    let stun = s.stun || 0;
    if (sa && !s.noBurn) {
      if (sa.lifesteal) src.hp = Math.min(src.maxHp, src.hp + amount * sa.lifesteal);
      if (sa.burn) { const B = sa.burn; tgt.burn = { src: src.id, dmg: B.dmg, every: B.every, next: t + B.every, until: t + B.dur }; msg.burn = 1; }
      if (sa.frost) {
        // dấu băng: đủ số dấu trong khoảng thời gian thì đóng băng
        const F = sa.frost, fr = tgt.frost ||= { n: 0, until: 0, immune: 0 };
        if (t >= fr.immune) {
          fr.n = (t < fr.until ? fr.n : 0) + 1;
          fr.until = t + F.window;
          if (fr.n >= F.stacks) { fr.n = 0; fr.immune = t + F.stun + F.immune; stun = Math.max(stun, F.stun); msg.frz = 1; }
          else msg.frost = fr.n;
        }
      }
    }
    if (stun && !(tgt.buff?.noKb && t < tgt.buff.until) && !ta?.noStun) { msg.stun = stun; tgt.stunUntil = t + stun; }
    if (s.slow) msg.slow = s.slow;
    if (crit) msg.crit = 1;
    this.broadcast(msg);
    if (tgt.hp <= 0) this.kill(tgt, src);
    else if (src && src !== tgt && !s.noMark) this.addCharge(src, tgt, s.marks || 1, t);
    return true;
  }

  kill(tgt, src) {
    tgt.hp = 0;
    tgt.dead = true;
    tgt.deaths++;
    tgt.respawnAt = now() + GAME.respawnTime;
    tgt.healUntil = 0;
    tgt.charges = null;
    tgt.burn = null; tgt.frost = null;
    this.endBuff(tgt);
    // dị biến: chết thì hết dị biến, thanh còn lại một nửa
    this.endAwaken(tgt, true);
    tgt.awk = Math.floor((tgt.awk || 0) * AWAKEN.deathKeep);
    if (src && src !== tgt) src.kills++;
    this.broadcast({ t: 'die', id: tgt.id, by: src ? src.id : 0, k: src ? src.kills : 0, d: tgt.deaths });
    if (this.team && this.phase === 'play') {
      // hạ đối thủ: +1 cho đội mình; tự rơi khỏi sân: +1 cho đội kia
      const scorer = src && src !== tgt ? src.team : (tgt.team === 'A' ? 'B' : 'A');
      this.score[scorer]++;
      if (this.score[scorer] >= TEAM.killLimit) this.endMatch(scorer);
      else this.sendTeamState();
    }
  }

  // Đạn tự tìm: bẻ hướng dần về đối thủ gần nhất phía trước (trong 12 m)
  seekStep(e, sub, k) {
    const [x, y, z] = sub.pos;
    let best = null, bd = 12;
    for (const q of this.targets(e, false)) {
      const vx = q.x - x, vy = q.y + CHEST - y, vz = q.z - z, d = Math.hypot(vx, vy, vz);
      if (d > bd || d < 0.3 || (vx * sub.d[0] + vy * sub.d[1] + vz * sub.d[2]) / d < 0.5) continue;
      bd = d; best = [vx / d, vy / d, vz / d];
    }
    if (!best) return;
    k = Math.min(1, k);
    const d = sub.d.map((v, i) => v + (best[i] - v) * k), L = Math.hypot(...d) || 1;
    sub.d = d.map(v => v / L);
  }

  kbFrom(fx, fz, tgt, s, mul = 1) {
    let vx = tgt.x - fx, vz = tgt.z - fz;
    const L = hlen(vx, vz);
    vx /= L; vz /= L;
    let k = (s.kb || 0) * mul;
    if (s.pull) k = -s.pull;
    return [vx * k, s.kbUp != null ? s.kbUp : Math.abs(k) * 0.25, vz * k];
  }

  // Lọc mục tiêu hợp lệ (không phải chủ chiêu, còn sống). props: cả công trình của đối thủ (cọc sét, cột đá)
  *targets(e, props = true) {
    const owner = this.team ? this.players.get(e.owner) : null;
    for (const q of this.players.values()) {
      if (q.id === e.owner || q.dead) continue;
      if (owner && q.team === owner.team) continue;   // đấu đội: chiêu xuyên qua đồng đội
      yield q;
    }
    if (!props) return;
    for (const pr of this.props) {
      if (pr.dead || pr.owner === e.owner || (owner && pr.team === owner.team)) continue;
      yield pr;
    }
  }

  explode(e, src, x, y, z, ex, k) {
    this.broadcast({ t: 'boom', eid: e.id, k, at: [r2(x), r2(y), r2(z)], r: ex.radius, c: e.skill.fx.color });
    const s = e.skill;
    for (const q of this.targets(e)) {
      const d = Math.hypot(q.x - x, q.y + CHEST - y, q.z - z);
      if (d < ex.radius + BODY_R) {
        const fall = 1 - 0.5 * Math.min(1, d / ex.radius);
        this.damage(src, q, ex.dmg * fall, this.kbFrom(x, z, q, { kb: ex.kb, kbUp: ex.kbUp }), s, [q.x, q.y + 1, q.z]);
      }
    }
  }

  updateEntity(e, t, dt) {
    const s = e.skill;
    const el = t - e.t0;
    const src = this.players.get(e.owner);
    const [px, py, pz] = e.p;
    const [hx, hz] = e.h;
    if (e.st) {
      if (e.st.mode !== 'homing') steerStep(e.st, s, dt, el);
      else if (el < s.delay) steerStep(e.st, s, dt, el, e.subs[0].pos);   // đang tụ lực: xoay hướng phóng
    }
    if (el < s.delay) return;

    switch (s.type) {
      case 'melee': {
        const swing = mul => {
          for (const q of this.targets(e)) {
            const vx = q.x - px, vz = q.z - pz;
            const d = Math.hypot(vx, vz);
            if (d > s.range + BODY_R || Math.abs(q.y - py) > 2.2) continue;
            const ang = d < 0.5 ? 0 : Math.acos(Math.max(-1, Math.min(1, (vx * hx + vz * hz) / d)));
            if (ang <= s.arc) this.damage(src, q, s.dmg * mul, this.kbFrom(px, pz, q, s, mul), s, [q.x, q.y + 1, q.z]);
          }
        };
        if (!e.state.m) { e.state.m = 1; swing(1); }
        // phân thân chém theo sau mỗi nhát
        if (s.echo) {
          const i = Math.floor((el - s.delay) / s.echo.gap);
          while ((e.state.ei || 0) < Math.min(i, s.echo.n)) { e.state.ei = (e.state.ei || 0) + 1; swing(s.echo.mul); }
          if ((e.state.ei || 0) >= s.echo.n) e.dead = true;
        } else e.dead = true;
        break;
      }
      case 'projectile': {
        const travel = s.speed * dt;
        let any = false;
        for (const sub of e.subs) {
          if (!sub.alive) continue;
          if (e.st) { steerStep(e.st, s, dt, el, sub.pos); sub.d = e.st.d; }
          if (sub.seek) this.seekStep(e, sub, s.seek * dt);
          const [ox, oy, oz] = sub.pos;
          const nx = ox + sub.d[0] * travel, ny = oy + sub.d[1] * travel, nz = oz + sub.d[2] * travel;
          sub.pos = [nx, ny, nz];
          sub.dist = (sub.dist || 0) + travel;
          let ended = false;
          for (const q of this.targets(e)) {
            const key = q.id * 16 + sub.k;
            if (e.hits.has(key)) continue;
            // công trình: thân trụ đứng (bán kính r, cao h); người chơi: hình cầu ở ngực
            const d = q.isProp ? (ny >= q.y - 0.3 && ny <= q.y + q.h ? distPointSeg(q.x, 0, q.z, ox, 0, oz, nx, 0, nz) - q.r + BODY_R : 1e9)
              : distPointSeg(q.x, q.y + CHEST, q.z, ox, oy, oz, nx, ny, nz);
            if (d < s.radius + BODY_R) {
              e.hits.set(key, t);
              if (!q.isProp) sub.hitP = true;
              const kb = [sub.d[0] * s.kb, s.kbUp != null ? s.kbUp : s.kb * 0.3, sub.d[2] * s.kb];
              const hit = this.damage(src, q, s.dmg, kb, s, [q.x, q.y + 1, q.z]);
              if (hit && s.bounce && src) this.chainFrom(src, q, 0, s.bounce.n, s.bounce.dmg, s.bounce.range, 0, s.fx.color);
              if (!s.pierce) { ended = true; break; }
            }
          }
          if (!ended && (sub.dist >= s.range || hitsObstacle(nx, ny, nz, s.radius, this.arena, this.dyn, e.owner, src?.team))) ended = true;
          if (ended) {
            sub.alive = false;
            // thương sét không trúng ai: cắm xuống chỗ rơi thành cọc sét
            if (s.rod && src && !sub.hitP) this.spawnRod(e, src, s.rod, nx - sub.d[0] * 0.5, ny, nz - sub.d[2] * 0.5, t);
            if (s.mark && sub.k === 0 && src) {
              // dấu phi đao: Thuấn Ảnh dịch chuyển tới đây
              const [mx, mz] = this.clampToArena(nx - sub.d[0] * 0.8, nz - sub.d[2] * 0.8);
              src.shadowMark = { x: mx, z: mz, until: t + s.mark };
              this.broadcast({ t: 'kmark', id: src.id, p: [r2(mx), r2(mz)], dur: s.mark });
            }
            if (s.teleport && src && !src.dead) {
              const tp = s.teleport;
              let [tx, tz] = this.freeSpot(...this.clampToArena(nx - sub.d[0] * 1.2, nz - sub.d[2] * 1.2), src.x, src.z);
              this.teleport(src, tx, tz, t);
              const ps = { fx: s.fx, stun: tp.stun };
              this.broadcast({ t: 'boom', eid: e.id, at: [r2(tx), 1, r2(tz)], r: tp.radius, c: s.fx.color });
              for (const q of this.targets(e)) {
                if (Math.hypot(q.x - tx, q.z - tz) < tp.radius + BODY_R && q.y < 4) this.damage(src, q, tp.dmg, this.kbFrom(tx, tz, q, { kb: tp.kb, kbUp: tp.kbUp }), ps, [q.x, q.y + 1, q.z]);
              }
            } else if (s.explode) this.explode(e, src, nx, ny, nz, s.explode, sub.k);
            else this.broadcast({ t: 'pend', eid: e.id, k: sub.k, at: [r2(nx), r2(ny), r2(nz)] });
          } else any = true;
        }
        if (!any) e.dead = true;
        break;
      }
      case 'dash': {
        const f = Math.min(1, (el - s.delay) / s.dur);
        let x = px + hx * s.dist * f, z = pz + hz * s.dist * f, y = py;
        let dhx = hx, dhz = hz;
        // free3d: lướt theo đúng hướng ngắm 3 chiều (lên trời / bổ xuống)
        if (s.free3d) { x = px + e.d[0] * s.dist * f; z = pz + e.d[2] * s.dist * f; y = Math.max(0, Math.min(MOVE.flyMaxHeight, py + e.d[1] * s.dist * f)); }
        if (e.st) { [x, z] = e.st.pos; [dhx, dhz] = e.st.h; if (e.st.y != null) y = e.st.y; }
        const prev = e.state.prev || [px, py, pz];
        e.state.prev = [x, y, z];
        if (!e.state.fin) for (const q of this.targets(e)) {
          // multi: lướt đánh nhiều nhịp — mỗi mục tiêu trúng tối đa s.multi lần, cách nhau s.multiInt giây
          const hc = e.hits.get(q.id);
          if (s.multi ? hc && (hc.n >= s.multi || t - hc.t < s.multiInt) : hc) continue;
          const d = distPointSeg(q.x, q.y, q.z, prev[0], prev[1], prev[2], x, y, z);
          if (d < s.radius + BODY_R && Math.abs(q.y - y) < 2.5) {
            e.hits.set(q.id, s.multi ? { n: (hc?.n || 0) + 1, t } : t);
            this.damage(src, q, s.dmg, [dhx * s.kb, s.kbUp || 3, dhz * s.kb], s, [q.x, q.y + 1, q.z]);
            // phân thân gió: hẹn giờ chém lại đúng chỗ vừa lướt qua
            if (s.clone && !q.isProp) (e.state.cl ||= []).push({ id: q.id, at: t + s.clone.delay, x: q.x, y: q.y, z: q.z });
          }
        }
        if (e.state.cl) for (const c of e.state.cl) {
          if (c.done || t < c.at) continue;
          c.done = true;
          const C = s.clone, q = this.players.get(c.id);
          this.broadcast({ t: 'pulse', k: 'windClone', pts: [[r2(c.x), r2(c.y + 1), r2(c.z)]], c: s.fx.color, r: C.radius });
          if (q && !q.dead && Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z) < C.radius + BODY_R) {
            this.damage(src, q, C.dmg, this.kbFrom(c.x - dhx, c.z - dhz, q, C), { fx: { kind: 'windClone', color: s.fx.color } }, [q.x, q.y + 1, q.z]);
          }
        }
        if (f >= 1 && !e.state.fin) {
          e.state.fin = true;
          if (s.explode) this.explode(e, src, x, y + 0.5, z, s.explode);
        }
        if (e.state.fin && !(e.state.cl && e.state.cl.some(c => !c.done))) e.dead = true;
        break;
      }
      case 'beam': {
        const n = Math.floor((el - s.delay) / s.tickInt);
        if (n > (e.state.n ?? -1) && el <= s.delay + s.dur) {
          e.state.n = n;
          const [dx, dy, dz] = e.st?.mode === 'aim' ? e.st.d : e.d;
          const ax = px + dx * 0.8, ay = py + CHEST + dy * 0.8, az = pz + dz * 0.8;
          const bx = ax + dx * s.length, by = ay + dy * s.length, bz = az + dz * s.length;
          for (const q of this.targets(e)) {
            const d = distPointSeg(q.x, q.y + CHEST, q.z, ax, ay, az, bx, by, bz);
            if (d < s.width + BODY_R) {
              this.damage(src, q, s.dmg, [dx * s.kb, 1.5, dz * s.kb], s, [q.x, q.y + 1, q.z]);
            }
          }
        }
        break;
      }
      case 'aoe': {
        const n = Math.floor((el - s.delay) / (s.tickInt || 1e9));
        if (n > (e.state.n ?? -1) && n < s.ticks) {
          e.state.n = n;
          let cx = px, cy = py, cz = pz;
          if (s.at === 'front') { cx = px + hx * s.offset; cz = pz + hz * s.offset; cy = 0; }
          if (s.follow && src && !src.dead) { cx = src.x; cy = src.y; cz = src.z; }   // vùng bám theo người ra chiêu
          if (e.st) { cx = e.st.c[0]; cz = e.st.c[2]; }
          if (n === 0 && s.healSelf && src && !src.dead) src.hp = Math.min(src.maxHp, src.hp + s.healSelf);
          if (n === 0 && s.walls) this.spawnWalls(cx, cz, s.walls, e, t);
          for (const q of this.targets(e)) {
            const d = Math.hypot(q.x - cx, q.z - cz);
            if (d < s.radius + BODY_R && q.y - cy > -1.5 && q.y - cy < 5) {
              this.damage(src, q, s.dmg, this.kbFrom(cx, cz, q, s), s, [q.x, q.y + 1, q.z]);
            }
          }
          // cọc sét trong tầm cũng phóng vòng sét kéo người về phía cọc
          const RP = s.rodPulse;
          if (RP) {
            const pts = [];
            for (const pr of this.props) {
              if (pr.dead || pr.kind !== 'rod' || pr.owner !== e.owner || Math.hypot(pr.x - cx, pr.z - cz) > RP.range) continue;
              pts.push([r2(pr.x), r2(pr.y + 1.2), r2(pr.z)]);
              for (const q of this.targets(e, false)) {
                if (Math.hypot(q.x - pr.x, q.z - pr.z) < RP.radius + BODY_R && q.y - pr.y < 4) this.damage(src, q, s.dmg, this.kbFrom(pr.x, pr.z, q, { pull: RP.pull, kbUp: 1 }), s, [q.x, q.y + 1, q.z]);
              }
            }
            if (pts.length) this.broadcast({ t: 'pulse', k: 'zap', pts, c: s.fx.color, r: RP.radius });
          }
        }
        break;
      }
      case 'line': {
        const n = Math.floor((el - s.delay) / s.interval);
        while ((e.state.n ?? -1) < Math.min(n, s.count - 1)) {
          const i = e.state.n = (e.state.n ?? -1) + 1;
          const dist = s.start + i * s.spacing;
          const cx = px + hx * dist, cz = pz + hz * dist;
          for (const q of this.targets(e)) {
            if (e.hits.has(q.id)) continue;
            if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R && q.y < 3.5) {
              e.hits.set(q.id, t);
              this.damage(src, q, s.dmg, this.kbFrom(cx, cz, q, s), s, [q.x, q.y + 1, q.z]);
            }
          }
        }
        break;
      }
      case 'trap': {
        // bẫy đã giương (sau arm giây): đối thủ bước vào thì sập
        if (el < s.delay + s.arm) break;
        const [cx, cz] = e.tg;
        let fired = false;
        for (const q of this.targets(e, false)) {
          if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R * 0.5 && q.y < 1.5) {
            this.damage(src, q, s.dmg, [0, s.kbUp || 0, 0], s, [q.x, q.y + 1, q.z]);
            fired = true;
          }
        }
        if (fired) { this.broadcast({ t: 'pend', eid: e.id, k: 0, at: [r2(cx), 0.3, r2(cz)], fire: 1 }); e.dead = true; }
        break;
      }
      case 'summon': {
        const [cx, cz] = e.tg;
        if (!e.state.up) {
          // mọc lên: hất tung đối thủ quanh gốc, thành chướng ngại vật chắn đạn
          e.state.up = true;
          for (const q of this.targets(e)) {
            if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R && q.y < 4) this.damage(src, q, s.dmg, this.kbFrom(cx, cz, q, s), s, [q.x, q.y + 1, q.z]);
          }
          if (s.obstacle) this.dyn.push({ x: cx, z: cz, r: s.obstacle.r, h: s.obstacle.h, until: e.end, owner: e.owner });
        }
        // hồi máu cho chủ cây và đồng đội đứng gần
        if (s.aura) {
          const n = Math.floor((el - s.delay) / s.aura.every);
          if (n > (e.state.n ?? -1)) {
            e.state.n = n;
            for (const q of this.players.values()) {
              if (q.dead || Math.hypot(q.x - cx, q.z - cz) > s.aura.radius) continue;
              const friend = q.id === e.owner || (this.team && src && q.team === src.team);
              if (friend) q.hp = Math.min(q.maxHp, q.hp + s.aura.heal);
            }
          }
        }
        break;
      }
      case 'leap': {
        // đáp xuống sau delay + dur
        if (el < s.delay + s.dur || e.state.done) break;
        e.state.done = true;
        const [cx, cz] = e.tg;
        for (const q of this.targets(e)) {
          if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R && q.y < 4) this.damage(src, q, s.dmg, this.kbFrom(cx, cz, q, s), s, [q.x, q.y + 1, q.z]);
        }
        if (s.walls) this.spawnWalls(cx, cz, s.walls, e, t);
        e.dead = true;
        break;
      }
      case 'wall': {
        // tường gió: một hàng trụ vô hình chặn đạn của đối thủ (đạn của chủ tường bay xuyên, người đi xuyên)
        if (e.state.up) break;
        e.state.up = true;
        const [cx, cz] = e.tg, w = s.width / 2;
        for (let i = 0; i < s.segs; i++) {
          const f = s.segs > 1 ? i / (s.segs - 1) * 2 - 1 : 0;
          this.dyn.push({ x: cx - hz * f * w, z: cz + hx * f * w, r: s.segR, h: s.height, until: e.end, owner: e.owner,
            pass: e.owner, passTeam: this.team ? src?.team : null, noBody: true });
        }
        // người đứng sát tường bị gió hất văng ra xa
        for (const q of this.targets(e)) {
          const d = distPointSeg(q.x, 0, q.z, cx - hz * w, 0, cz + hx * w, cx + hz * w, 0, cz - hx * w);
          if (d < 1.6 + BODY_R && q.y < s.height) this.damage(src, q, s.dmg, [hx * s.kb, s.kbUp, hz * s.kb], s, [q.x, q.y + 1, q.z]);
        }
        break;
      }
      case 'smite': {
        // sét giáng xuống mọi đối thủ trong tầm, dấu điện trên người thêm sát thương
        if (e.state.done) break;
        e.state.done = true;
        const pts = [], sm = { ...s, noMark: true };
        for (const q of this.targets(e, false)) {
          if (Math.hypot(q.x - px, q.z - pz) > s.range) continue;
          const mk = q.charges?.get(e.owner);
          const marks = mk && t < mk.until ? mk.n : 0;
          if (marks) { q.charges.delete(e.owner); this.broadcast({ t: 'mark', tid: q.id, sid: e.owner, n: 0 }); }
          pts.push([r2(q.x), r2(q.y + 1), r2(q.z)]);
          this.damage(src, q, s.dmg + marks * (s.perMark || 0), [0, s.kbUp, 0], sm, [q.x, q.y + 1, q.z]);
        }
        if (pts.length) this.broadcast({ t: 'chain', pts, c: s.fx.color, sky: 1 });
        // mỗi cọc sét phóng thêm 1 tia vào đối thủ gần nó nhất
        if (s.rodDmg) for (const pr of this.props) {
          if (pr.dead || pr.kind !== 'rod' || pr.owner !== e.owner) continue;
          let best = null, bd = s.rodRange;
          for (const q of this.targets(e, false)) { const d = Math.hypot(q.x - pr.x, q.z - pr.z); if (d < bd) { bd = d; best = q; } }
          if (!best) continue;
          this.damage(src, best, s.rodDmg, [0, 3, 0], sm, [best.x, best.y + 1, best.z]);
          this.broadcast({ t: 'chain', pts: [[r2(pr.x), r2(pr.y + 2.4), r2(pr.z)], [r2(best.x), r2(best.y + 1), r2(best.z)]], c: s.fx.color, nosky: 1 });
        }
        e.dead = true;
        break;
      }
      case 'pillar': {
        // cột đá trồi lên: hất tung đối thủ đứng ngay chỗ đó, rồi thành công trình chắn đường / đứng lên được
        if (e.state.up) break;
        e.state.up = true;
        const [cx, cz] = e.tg;
        const mine = this.props.filter(q => q.owner === e.owner && q.kind === 'pillar');
        while (mine.length >= s.max) this.removeProp(mine.shift(), 'time');
        for (const q of this.targets(e, false)) {
          if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R && q.y < s.h + 1) this.damage(src, q, s.dmg, this.kbFrom(cx, cz, q, s), s, [q.x, q.y + 1, q.z]);
        }
        this.addProp({ kind: 'pillar', owner: e.owner, team: src?.team || null, x: cx, y: 0, z: cz, r: s.r, h: s.h, hp: s.hp, until: t + s.dur, solid: true });
        e.dead = true;
        break;
      }
      case 'quake': {
        // động đất cả sân: ai đang đứng trên mặt đất (kể cả nóc chướng ngại vật của map) bị choáng; ở trên không thì né được
        if (e.state.done) break;
        e.state.done = true;
        for (const q of this.targets(e, false)) {
          if (Math.hypot(q.x - px, q.z - pz) > s.range) continue;
          const g = arenaGround(this.arena, q.x, q.z, q.y + 0.1, BODY_R);
          if (q.y - g > s.airTol) { this.broadcast({ t: 'evade', id: q.id }); continue; }
          this.damage(src, q, s.dmg, [0, s.kbUp, 0], s, [q.x, q.y + 1, q.z]);
        }
        // cột đá của mình vỡ tung, mảnh đá bắn ra xung quanh
        const S = s.shard, pts = [], sh = { fx: s.fx };
        for (const pr of this.props.filter(q => q.owner === e.owner && q.kind === 'pillar')) {
          pts.push([r2(pr.x), r2(pr.y + 1.5), r2(pr.z)]);
          this.removeProp(pr, 'quake');
          for (const q of this.targets(e, false)) {
            if (Math.hypot(q.x - pr.x, q.z - pr.z) < S.radius + BODY_R && q.y - pr.y < pr.h + 2) this.damage(src, q, S.dmg, this.kbFrom(pr.x, pr.z, q, S), sh, [q.x, q.y + 1, q.z]);
          }
        }
        if (pts.length) this.broadcast({ t: 'pulse', k: 'rock', pts, c: s.fx.color, r: S.radius });
        e.dead = true;
        break;
      }
      case 'multiblink': {
        // lướt chém lần lượt: mỗi nhịp dịch chuyển ra sau lưng đối thủ bị chém ít nhất (gần nhất) rồi chém
        const i = Math.floor((el - s.delay) / s.interval);
        while (!e.dead && (e.state.n ?? -1) < Math.min(i, s.strikes - 1)) {
          e.state.n = (e.state.n ?? -1) + 1;
          if (!src || src.dead) { e.dead = true; break; }
          let best = null, bs = Infinity;
          for (const q of this.targets(e, false)) {
            if (Math.hypot(q.x - px, q.z - pz) > s.range) continue;
            const sc = (e.hits.get(q.id) || 0) * 100 + Math.hypot(q.x - src.x, q.z - src.z);
            if (sc < bs) { bs = sc; best = q; }
          }
          if (!best) {
            // không có ai trong tầm: lướt bóng về phía trước
            const [tx, tz] = this.freeSpot(...this.clampToArena(src.x + hx * 8, src.z + hz * 8), src.x, src.z);
            this.teleport(src, tx, tz, t);
            e.dead = true;
            break;
          }
          e.hits.set(best.id, (e.hits.get(best.id) || 0) + 1);
          const [bx, bz] = this.freeSpot(...this.clampToArena(best.x - Math.sin(best.yaw) * 1.4, best.z - Math.cos(best.yaw) * 1.4), best.x, best.z);
          this.teleport(src, bx, bz, t);
          src.yaw = Math.atan2(best.x - bx, best.z - bz);
          this.damage(src, best, s.dmg, this.kbFrom(bx, bz, best, s), s, [best.x, best.y + 1, best.z]);
        }
        if ((e.state.n ?? -1) >= s.strikes - 1) e.dead = true;
        break;
      }
      case 'blink': {
        if (el < s.delay || e.state.done) break;
        e.state.done = true;
        if (src && !src.dead) {
          const [cx, cz] = e.tg;
          this.teleport(src, cx, cz, t);
          for (const q of this.targets(e)) {
            if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R && Math.abs(q.y - 0) < 3) this.damage(src, q, s.dmg, this.kbFrom(cx, cz, q, s), s, [q.x, q.y + 1, q.z]);
          }
        }
        e.dead = true;
        break;
      }
      case 'buff': e.dead = true; break;
      case 'rain': {
        const base = el - s.delay - (s.fall || 0);
        const n = Math.floor(base / s.interval);
        let cx = px + hx * s.offset, cz = pz + hz * s.offset;
        if (e.st) { cx = e.st.c[0]; cz = e.st.c[2]; }
        while ((e.state.n ?? -1) < Math.min(n, s.count - 1)) {
          const i = e.state.n = (e.state.n ?? -1) + 1;
          const [ox, oz] = e.pts[i];
          const x = cx + ox, z = cz + oz;
          for (const q of this.targets(e)) {
            if (Math.hypot(q.x - x, q.z - z) < s.radius + BODY_R && q.y < 3) {
              this.damage(src, q, s.dmg, this.kbFrom(x, z, q, s), s, [q.x, q.y + 1, q.z]);
            }
          }
        }
        break;
      }
    }
  }

  // ---------- Vòng lặp chính ----------
  tick() {
    const t = now();
    const dt = Math.min(0.1, t - this.lastTick);
    this.lastTick = t;

    for (const p of this.players.values()) {
      if (p.dead) {
        if (t >= p.respawnAt) {
          const [sx, sz] = this.spawnPoint(p.team);
          Object.assign(p, { dead: false, hp: p.maxHp, mp: GAME.maxMana, x: sx, y: 0, z: sz,
            invulnUntil: t + 1.5, stunUntil: 0, lockUntil: 0, cds: {}, healCd: 0 });
          this.broadcast({ t: 'respawn', id: p.id, p: [sx, 0, sz] });
        }
        continue;
      }
      // Hồi máu thụ động (chậm), chỉ khi không bị đánh một lúc
      if (t - p.lastHit > GAME.hpRegenDelay) p.hp += GAME.hpRegen * dt;
      // Chiêu hồi máu
      if (t < p.healUntil) p.hp += p.healRate * dt;
      // Dị biến hết giờ
      if (p.awUntil && t >= p.awUntil) this.endAwaken(p);
      // Bỏng (nội tại dị biến Homura)
      const B = p.burn;
      if (B && t >= B.next) {
        B.next += B.every;
        if (B.next > B.until + 0.01) p.burn = null;
        this.damage(this.players.get(B.src) || null, p, B.dmg, [0, 0, 0], BURN_SKILL, [p.x, p.y + 1, p.z]);
        if (p.dead) continue;
      }
      // Mana: thụ động (gấp đôi khi dị biến) + vận khí (flag 2) - bay (flag 1)
      let mr = GAME.manaRegen * (p.awUntil > t ? AWAKEN.manaRegenMul : 1);
      if (p.flags & 2) mr += GAME.chargeManaRate;
      if (p.flags & 1 && !this.awOf(p, t)?.passive.freeFly) mr -= MOVE.flyManaPerSec + GAME.manaRegen;   // Kaze dị biến bay không tốn mana
      p.mp += mr * dt;
      p.hp = Math.min(p.maxHp, p.hp);
      p.mp = Math.max(0, Math.min(GAME.maxMana, p.mp));
      // Rơi khỏi đấu trường
      if (p.y < -15 || Math.hypot(p.x, p.z) > this.arena.radius + 25) this.kill(p, null);
    }

    if (this.team) {
      if (this.phase === 'play' && t >= this.phaseEnd) {
        const { A, B } = this.score;
        this.endMatch(A === B ? 'draw' : A > B ? 'A' : 'B');
      } else if (this.phase === 'end' && t >= this.phaseEnd) this.backToLobby();
      // đồng bộ lại đồng hồ mỗi 5 giây
      this.stateAcc += dt;
      if (this.stateAcc >= 5) this.sendTeamState();
    }

    for (const e of this.entities) {
      this.updateEntity(e, t, dt);
      if (t > e.end) e.dead = true;
    }
    this.entities = this.entities.filter(e => !e.dead);
    if (this.props.length) {
      for (const pr of this.props) if (t >= pr.until) this.removeProp(pr, 'time');
      this.updateFences(t);
    }
    if (this.dyn.length) this.dyn = this.dyn.filter(o => t < o.until);
    for (const p of this.players.values()) if (p.buff && t >= p.buff.until) this.endBuff(p);

    if (this.snapT.due(dt)) {
      const ps = [];
      for (const p of this.players.values()) {
        ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), p.anim, Math.ceil(p.hp), Math.floor(p.mp),
          p.flags | (p.dead ? 128 : 0) | (p.awUntil > t ? 64 : 0), Math.floor(p.awk || 0)]);
      }
      this.broadcast({ t: 'snap', ps });
    }
  }
}
