// Một phòng đấu: lưu người chơi, mô phỏng chiêu thức, tính sát thương (server-authoritative).
import { startLoop } from './loop.js';
import { NET, Ticker, GAME, MOVE, TEAM, AWAKEN, rainPoints, hitsObstacle, arenaGround, arenaCollide, dynCollide } from '../shared/config.js';
import { getArena } from '../shared/arenas.js';
import { CHARACTERS, getChar, charMaxHp, charSkills, skillLifetime, holdSkill } from '../shared/characters.js';
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
let nextFakeId = 90000;    // id người chơi giả do server điều khiển (bia tập, võ sĩ máy, phân thân mồi, người cây)
let nextZoneId = 1;        // vùng trên sàn (lửa, băng, ngưng đọng)
const FAKE_WS = { readyState: 0, send() {} };
const ANIM_ID = { idle: 0, run: 1, air: 3, stun: 8 };   // trùng ANIM ở client/js/chibi.js
const FIRE_BURN = { dmg: 2, every: 0.5 };

let nextRoomId = 1;
let nextEntityId = 1;

export class Room {
  constructor(name, hub, mapId, team = false, practice = false) {
    this.id = String(nextRoomId++);
    this.practice = !team && practice;   // đấu tập: có bia tập + võ sĩ máy, nạp đầy thanh dị biến được
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
    this.zones = [];          // vùng trên sàn { id, k: 'fire'|'ice'|'slow', owner, side, x, y, z, r, until, mul }
    this.lastTick = now();
    this.snapT = new Ticker(NET.snapRate);
    this.stopLoop = startLoop(NET.tickRate, () => this.tick());
    if (this.practice) this.spawnPracticeBots();
  }

  // số người chơi thật (không tính người chơi giả do server điều khiển)
  get count() { let n = 0; for (const p of this.players.values()) if (!p.fake) n++; return n; }

  destroy() { this.stopLoop(); }

  info() {
    return { id: this.id, name: this.name, count: this.count, mode: this.team ? 'team' : this.practice ? 'practice' : 'brawl', map: this.arena.id, mapName: this.arena.name,
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

  // viewer: người nhận. Phân thân mồi chỉ lộ là phân thân với chủ và đồng đội của chủ
  publicPlayer(p, viewer) {
    const o = { id: p.id, name: p.name, char: p.char, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw),
      hp: Math.ceil(p.hp), mp: Math.floor(p.mp), dead: p.dead, kills: p.kills, deaths: p.deaths, team: p.team || null,
      awk: Math.floor(p.awk || 0), aw: p.awUntil > now() ? r2(p.awUntil - now()) : 0 };
    if (p.fake && (p.fake !== 'decoy' || (viewer && this.allied(viewer, this.players.get(p.master))))) { o.fk = p.fake; o.ms = p.master || 0; }
    return o;
  }

  // ---------- Đồng minh ----------
  // phe của người chơi: người chơi giả có chủ (phân thân, người cây) cùng phe với chủ
  side(p) { return p.sideId || p.master || p.id; }
  allied(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (this.team && a.team && a.team === b.team) return true;
    return this.side(a) === this.side(b);
  }

  // ---------- Người chơi giả (server điều khiển) ----------
  // o: { fake: 'dummy'|'bot'|'decoy'|'pet', name, char, x, z, yaw, master, team, hp, maxHp, until, awUntil, ai }
  addFake(o) {
    const t = now(), ch = getChar(o.char);
    const p = {
      id: nextFakeId++, ws: FAKE_WS, name: o.name, char: ch.id, x: o.x, y: o.y || 0, z: o.z, yaw: o.yaw || 0, anim: 0, flags: 0,
      hp: o.hp ?? charMaxHp(ch), maxHp: o.maxHp ?? charMaxHp(ch), mp: GAME.maxMana, dead: false, respawnAt: 0,
      lastHit: -99, kills: o.kills || 0, deaths: o.deaths || 0, cds: {}, lockUntil: 0, healCd: 0, healUntil: 0, healRate: 0,
      invulnUntil: 0, stunUntil: 0, lastSeen: t, team: o.team ?? null, ready: true, awk: 0, awUntil: o.awUntil || 0, tiredUntil: 0,
      fake: o.fake, master: o.master || 0, until: o.until || 0, ai: o.ai || {}, home: o.home || null, vel: [0, 0, 0], kbT: 0,
      sideId: o.sideId || 0,   // bia tập + võ sĩ máy chung một phe: không đánh nhau
    };
    this.players.set(p.id, p);
    for (const q of this.players.values()) if (!q.fake) this.send(q, { t: 'pjoin', player: this.publicPlayer(p, q) });
    return p;
  }

  // why: 'expire' (hết giờ), 'pop' (phân thân tan), 'die' (bị đánh gục)
  removeFake(p, why) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this.entities = this.entities.filter(e => e.owner !== p.id);
    this.broadcast({ t: 'pleave', id: p.id, why });
  }

  // Đấu tập: 2 bia đứng yên (tự hồi đầy máu) + 1 võ sĩ máy biết chạy, nhảy, đánh nhẹ
  spawnPracticeBots() {
    const R = this.arena.radius * 0.38;
    const spot = (x, z) => this.freeSpot(x, z, 0, 0);
    const chars = CHARACTERS.map(c => c.id);
    const [ax, az] = spot(R, -R * 0.4), [bx, bz] = spot(-R, -R * 0.4), [cx, cz] = spot(0, R);
    this.addFake({ fake: 'dummy', sideId: 'bots', name: '🎯 Bia tập', char: 'dummy', x: ax, z: az, home: [ax, az], yaw: Math.atan2(-ax, -az) });
    this.addFake({ fake: 'dummy', sideId: 'bots', name: '🎯 Bia tập', char: 'dummy', x: bx, z: bz, home: [bx, bz], yaw: Math.atan2(-bx, -bz) });
    this.addFake({ fake: 'bot', sideId: 'bots', name: '🤖 Võ sĩ tập', char: chars[(Math.random() * chars.length) | 0], x: cx, z: cz, home: [cx, cz], ai: { range: 5 } });
  }

  // Vật lý đơn giản cho người chơi giả: (wx, wz) là vận tốc muốn đi; bị đánh thì văng theo đòn
  stepFake(p, dt, wx, wz, t) {
    const v = p.vel;
    const g0 = arenaGround(this.arena, p.x, p.z, p.y, BODY_R);
    const onG = p.y <= g0 + 0.05;
    const ctrl = p.kbT > 0 ? 0.08 : 1;
    p.kbT -= dt;
    const a = Math.min(1, dt * (onG ? 10 : 2) * ctrl);
    v[0] += (wx - v[0]) * a; v[2] += (wz - v[2]) * a;
    v[1] -= MOVE.gravity * dt;
    p.x += v[0] * dt; p.y += v[1] * dt; p.z += v[2] * dt;
    const pos = { x: p.x, y: p.y, z: p.z };
    arenaCollide(this.arena, pos, BODY_R);
    if (this.dyn.length) dynCollide(this.dyn, pos, BODY_R);
    p.x = pos.x; p.z = pos.z;
    let gy = arenaGround(this.arena, p.x, p.z, p.y, BODY_R);
    for (const o of this.dyn) if (!o.noBody && p.y >= o.h - 0.3 && Math.hypot(p.x - o.x, p.z - o.z) < o.r + BODY_R * 0.4) gy = Math.max(gy, o.h);
    if (p.y <= gy) { p.y = gy; if (v[1] < 0) v[1] = 0; }
    const hs = Math.hypot(v[0], v[2]);
    if (hs > 0.5 && t >= (p.faceUntil || 0)) p.yaw = Math.atan2(v[0], v[2]);
    p.anim = t < p.stunUntil ? ANIM_ID.stun : p.y > gy + 0.1 ? ANIM_ID.air : hs > 1 ? ANIM_ID.run : ANIM_ID.idle;
  }

  updateFake(p, t, dt) {
    if (p.grab) return;   // đang bị túm: vị trí do người túm quyết định
    const stun = t < p.stunUntil;
    switch (p.fake) {
      case 'dummy': {
        // bia tập: 2.5 giây không bị đánh thì hồi đầy máu, bị đánh văng thì tự đi về chỗ cũ
        if (t - p.lastHit > 2.5) p.hp = p.maxHp;
        const dx = p.home[0] - p.x, dz = p.home[1] - p.z, d = Math.hypot(dx, dz), v = d > 0.6 && !stun ? Math.min(4, d * 2) : 0;
        this.stepFake(p, dt, v ? dx / d * v : 0, v ? dz / d * v : 0, t);
        break;
      }
      case 'bot': this.botAI(p, t, dt, stun); break;
      case 'decoy': {
        // phân thân mồi: chạy thẳng, máu hiện y như chủ
        const M = this.players.get(p.master);
        if (M) p.hp = Math.max(1, M.hp);
        const run = t < p.ai.stopAt && !stun;
        this.stepFake(p, dt, run ? p.ai.dir[0] * p.ai.speed : 0, run ? p.ai.dir[1] * p.ai.speed : 0, t);
        break;
      }
      case 'pet': this.petAI(p, t, dt, stun); break;
    }
    if (p.until && t >= p.until) this.removeFake(p, 'expire');
  }

  // Võ sĩ máy: giữ khoảng cách ~5 m với người chơi gần nhất, chạy vòng, thỉnh thoảng nhảy, đánh J / bắn K
  botAI(p, t, dt, stun) {
    const A = p.ai;
    let tgt = null, bd = 30;
    for (const q of this.players.values()) {
      if (q.dead || q.fake || this.allied(p, q)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; tgt = q; }
    }
    let wx = 0, wz = 0;
    if (tgt && !stun) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
      const sp = MOVE.walk * 0.75, f = d > A.range + 1 ? 1 : d < A.range - 2 ? -0.7 : 0;
      if (t > (A.sw || 0)) { A.str = A.str === 1 ? -1 : 1; A.sw = t + 1.5 + Math.random() * 2; }
      wx = (ux * f - uz * A.str * 0.6) * sp; wz = (uz * f + ux * A.str * 0.6) * sp;
      if (t > (A.jump || 0) && p.vel[1] === 0) { A.jump = t + 3 + Math.random() * 4; p.vel[1] = MOVE.jump; }
      if (t > (A.next || 0) && t >= p.lockUntil) {
        A.next = t + 1.3 + Math.random() * 1.2;
        const dy = Math.max(-0.9, Math.min(0.9, (tgt.y - p.y) / Math.max(1, d)));
        p.yaw = Math.atan2(ux, uz); p.faceUntil = t + 0.4;
        this.handleCast(p, { sk: d < 3.2 ? 0 : 1, cs: 0, seed: (Math.random() * 2 ** 31) | 0, p: [p.x, p.y, p.z], d: [ux, dy, uz] }, t);
      }
    }
    this.stepFake(p, dt, wx, wz, t);
    p.mp = GAME.maxMana;
  }

  // Người cây: đi theo chủ, thấy đối thủ gần (trong 10 m) thì lao tới đấm
  petAI(p, t, dt, stun) {
    const M = this.players.get(p.master);
    if (!M || M.dead) { this.removeFake(p, 'expire'); return; }
    const ch = getChar(p.char), sp = ch.speed || 5;
    let tgt = null, bd = 10;
    for (const q of this.players.values()) {
      if (q.dead || this.allied(p, q) || Math.hypot(q.x - M.x, q.z - M.z) > 14) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; tgt = q; }
    }
    let wx = 0, wz = 0;
    if (!stun) {
      if (tgt) {
        const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz) || 1;
        if (d > 2.2) { wx = dx / d * sp; wz = dz / d * sp; }
        if (d < 3 && t >= p.lockUntil && t >= (p.cds[0] || 0)) {
          p.yaw = Math.atan2(dx, dz); p.faceUntil = t + 0.6;
          this.handleCast(p, { sk: 0, cs: 0, seed: 1, p: [p.x, p.y, p.z], d: [dx / d, 0, dz / d] }, t);
        }
      } else {
        // đứng sau lưng chủ 2.5 m
        const fx = M.x - Math.sin(M.yaw) * 2.5, fz = M.z - Math.cos(M.yaw) * 2.5, dx = fx - p.x, dz = fz - p.z, d = Math.hypot(dx, dz);
        if (d > 1.2) { const v = Math.min(sp * 1.2, d * 2); wx = dx / d * v; wz = dz / d * v; }
      }
    }
    this.stepFake(p, dt, wx, wz, t);
  }

  // Phân thân mồi tan: nổ bóng làm chậm đối thủ đứng gần
  popDecoy(d) {
    const M = this.players.get(d.master), P = d.ai.pop;
    this.broadcast({ t: 'pulse', k: 'shadowPop', pts: [[r2(d.x), r2(d.y + 1), r2(d.z)]], c: 0x9d4edd, r: P.radius });
    this.removeFake(d, 'pop');
    if (!M) return;
    const sk = { fx: { kind: 'shadowPop', color: 0x9d4edd }, slow: P.slow, noMark: true };
    for (const q of [...this.players.values()]) {
      if (q.dead || q.fake === 'decoy' || this.allied(M, q)) continue;
      if (Math.hypot(q.x - d.x, q.z - d.z) < P.radius + BODY_R && Math.abs(q.y - d.y) < 3) this.damage(M, q, P.dmg, this.kbFrom(d.x, d.z, q, { kb: 4, kbUp: 2 }), sk, [q.x, q.y + 1, q.z]);
    }
  }

  // Phân thân mồi của p gần hướng ngắm nhất trong tầm
  aimDecoy(p, x, z, h, range) {
    let best = null, bs = Infinity;
    for (const q of this.players.values()) {
      if (q.fake !== 'decoy' || q.master !== p.id) continue;
      const vx = q.x - x, vz = q.z - z, d = Math.hypot(vx, vz);
      if (d > range || d < 0.5) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * h[0] + vz * h[1]) / d)));
      const sc = ang * 3 + d * 0.05;
      if (sc < bs) { bs = sc; best = q; }
    }
    return best;
  }

  // ---------- Vùng trên sàn: lửa (Homura), băng (Yuki), ngưng đọng (Yuki) ----------
  addZone(k, owner, x, z, r, dur, opts = {}) {
    const y = opts.y ?? arenaGround(this.arena, x, z, Math.max(0, owner.y) + 0.5, 0.3);
    const zn = { id: nextZoneId++, k, owner: owner.id, side: this.side(owner), team: owner.team, x, y, z, r, until: now() + dur, mul: opts.mul || 1 };
    this.zones.push(zn);
    const m = { t: 'zone', id: zn.id, k, o: owner.id, p: [r2(x), r2(y), r2(z)], r, dur };
    if (opts.mul) m.mul = opts.mul;
    this.broadcast(m);
    return zn;
  }

  // hệ số tốc độ đạn của phe side tại (x, z): vùng ngưng đọng của đối phương làm chậm
  zoneSlow(x, z, src) {
    let k = 1;
    for (const zn of this.zones) {
      if (zn.k !== 'slow' || (src && this.side(src) === zn.side) || (this.team && src && zn.team === src.team)) continue;
      if (Math.hypot(x - zn.x, z - zn.z) < zn.r) k = Math.min(k, zn.mul);
    }
    return k;
  }

  updateZones(t, dt) {
    this.zones = this.zones.filter(zn => t < zn.until);
    const onFire = new Set();
    for (const zn of this.zones) {
      if (zn.k !== 'fire') continue;
      const src = this.players.get(zn.owner);
      if (!src) continue;
      const B = this.awOf(src, t)?.passive.burn || FIRE_BURN;
      for (const q of this.players.values()) {
        if (q.dead || q.fake === 'decoy' || this.allied(src, q)) continue;
        if (Math.hypot(q.x - zn.x, q.z - zn.z) > zn.r + BODY_R * 0.5 || q.y - zn.y > 0.6) continue;
        // đứng trong lửa: bỏng liên tục (làm mới thời gian, không cộng dồn)
        if (!q.burn || q.burn.until < t + 0.4) q.burn = { src: src.id, dmg: B.dmg, every: B.every, next: q.burn && q.burn.next > t ? q.burn.next : t + 0.2, until: t + 1.2 };
      }
      if (!src.dead && Math.hypot(src.x - zn.x, src.z - zn.z) < zn.r && src.y - zn.y < 0.6) onFire.add(src);
    }
    // Homura đứng trên lửa của mình: hồi mana nhanh hơn
    for (const p of onFire) { const F = this.awOf(p, t)?.passive.fireTrail; if (F) p.mp = Math.min(GAME.maxMana, p.mp + F.mana * dt); }
  }

  // ---------- Túm ném (dị biến Raiga) ----------
  startGrab(src, q, s, t) {
    const G = s.grab;
    q.grab = { by: src.id, t0: t, G, color: s.fx.color, slammed: false };
    q.stunUntil = Math.max(q.stunUntil, t + G.dur + 0.1);
    this.broadcast({ t: 'grab', id: q.id, by: src.id, dur: G.dur, slam: G.slam });
  }

  stepGrab(q, t) {
    const g = q.grab, A = this.players.get(g.by), G = g.G;
    if (!A || A.dead || q.dead) { q.grab = null; return; }
    const el = t - g.t0, fx = Math.sin(A.yaw), fz = Math.cos(A.yaw);
    // nhấc bổng lên trước mặt người túm, rồi quật xuống đất, rồi ném văng theo hướng nhìn
    q.x = A.x + fx * 1.3; q.z = A.z + fz * 1.3;
    q.y = el < G.slam ? A.y + 2.4 * Math.min(1, el / 0.25) : A.y;
    if (q.vel) q.vel = [0, 0, 0];
    if (el >= G.slam && !g.slammed) {
      g.slammed = true;
      this.broadcast({ t: 'pulse', k: 'slam', pts: [[r2(q.x), r2(A.y), r2(q.z)]], c: g.color, r: 2.5 });
      this.damage(A, q, G.slamDmg, [0, 0, 0], { fx: { kind: 'grabSlam', color: g.color }, stun: G.stun }, [q.x, q.y + 0.5, q.z]);
    }
    if (el >= G.dur && q.grab) {
      q.grab = null;
      q.tpUntil = t + 0.3;
      this.damage(A, q, G.throwDmg, [fx * G.kb, G.kbUp, fz * G.kb], { fx: { kind: 'grabThrow', color: g.color } }, [q.x, q.y + 1, q.z]);
    }
  }

  // Bắn 1 viên đạn từ vị trí bất kỳ (cây bắn gai) — gửi 'cast' kèm extra để client vẽ
  fireShot(src, s, x, y, z, d, extra) {
    const t = now(), seed = (Math.random() * 2 ** 31) | 0;
    const e = { id: nextEntityId++, owner: src.id, skill: s, t0: t, p: [x, y, z], d, hits: new Map(), seed, dead: false, end: t + skillLifetime(s), state: {} };
    const hl = hlen(d[0], d[2]);
    e.h = [d[0] / hl, d[2] / hl];
    e.subs = [{ k: 0, d: [...d], pos: [x + d[0] * 0.3, y + CHEST + d[1] * 0.3, z + d[2] * 0.3], alive: true }];
    this.entities.push(e);
    this.broadcast({ t: 'cast', id: src.id, eid: e.id, p: [r2(x), r2(y), r2(z)], d: d.map(r2), seed, ...extra });
  }

  // Cây bắn gai: mỗi `every` giây bắn đối thủ gần nhất trong tầm
  updateTurrets(t) {
    for (const pr of this.props) {
      const T = pr.tur;
      if (!T || pr.dead || t < T.next) continue;
      const src = this.players.get(pr.owner);
      if (!src) continue;
      let best = null, bd = T.range;
      for (const q of this.players.values()) {
        if (q.dead || this.allied(src, q)) continue;
        const d = Math.hypot(q.x - pr.x, q.z - pr.z);
        if (d < bd) { bd = d; best = q; }
      }
      if (!best) continue;
      T.next = t + T.every;
      const oy = pr.y + 0.7;
      const v = [best.x - pr.x, best.y + CHEST - (oy + CHEST), best.z - pr.z], L = Math.hypot(...v) || 1;
      this.fireShot(src, T.s, pr.x, oy, pr.z, v.map(c => c / L), { sk: T.sk, aw: 1, sub: 'tur' });
    }
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
    this.send(p, { t: 'joined', you: p.id, room: { id: this.id, name: this.name, map: this.arena.id, team: this.team, practice: this.practice },
      players: [...this.players.values()].map(q => this.publicPlayer(q, p)), props: this.props.map(q => this.publicProp(q)),
      zones: this.zones.map(z => ({ id: z.id, k: z.k, o: z.owner, p: [r2(z.x), r2(z.y), r2(z.z)], r: z.r, dur: r2(z.until - now()), mul: z.mul })) });
    if (this.practice) this.send(p, { t: 'sys', msg: '🎯 Đấu tập: đánh bia hoặc võ sĩ máy để tích thanh dị biến. Bấm P (hoặc nút trong menu ☰) để nạp đầy thanh ngay.' });
    this.broadcast({ t: 'pjoin', player: this.publicPlayer(p) }, p.id);
    this.broadcast({ t: 'sys', msg: this.team ? `${p.name} đã vào ${TEAM.names[team]}` : `${p.name} đã vào phòng` });
    if (this.team) this.sendTeamState();
    this.hub.roomsChanged();
  }

  remove(clientId) {
    const p = this.players.get(clientId);
    if (!p) return;
    this.players.delete(clientId);
    for (const q of [...this.players.values()]) if (q.master === clientId) this.removeFake(q, 'expire');
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
    this.zones = [];
    for (const q of [...this.players.values()]) if (q.master) this.removeFake(q, 'expire');
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
        if (p.grab) break;   // đang bị túm: server quyết định vị trí
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
      case 'hold': { // bắt đầu giữ phím tụ lực (dị biến Raiga)
        const hs = charSkills(getChar(p.char), p.awUntil > t)[m.sk | 0];
        if (!hs?.hold || p.dead) return;
        p.holdStart = t; p.holdSk = m.sk | 0;
        this.broadcast({ t: 'hold', id: p.id, sk: m.sk | 0, max: hs.hold.max }, p.id);
        break;
      }
      case 'pfill': // đấu tập: nạp đầy thanh dị biến
        if (!this.practice || p.dead || p.awUntil > t) return;
        p.awk = AWAKEN.max; p.mp = GAME.maxMana;
        this.send(p, { t: 'sys', msg: '⚡ Đã nạp đầy thanh dị biến — bấm L L (nút ⚡) để biến hình' });
        break;
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
    // giữ phím tụ lực: thời gian giữ client báo, server giới hạn theo lúc nhận gói 'hold'
    let hk = 0;
    if (s.hold) {
      const held = Math.min(Number(m.hold) || 0, p.holdSk === sIdx ? t - p.holdStart + 0.2 : 0, s.hold.max);
      s = holdSkill(s, Math.max(0, held / s.hold.max));
      hk = s.hk || 0;
      p.holdSk = -1;
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
      hits: new Map(), seed, dead: false, end: t + skillLifetime(s), state: {}, sk: sIdx,
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
      // Lôi Độn (dị biến Shiden): tới cọc sét của mình gần tâm ngắm nhất; Hoán Ảnh (Kage): đổi chỗ với phân thân
      const rod = s.toRod ? this.aimProp(p, x, z, e.h, s.toRod, 'rod') : null;
      const dc = s.swap ? this.aimDecoy(p, x, z, e.h, s.swap) : null;
      if (dc) { tg = [dc.x, dc.z]; e.swapId = dc.id; }
      else if (rod) {
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
    } else if (s.type === 'wall' || s.type === 'icewall' || s.type === 'turret') {
      tg = this.clampToArena(x + e.h[0] * s.offset, z + e.h[1] * s.offset);
    }
    if (tg) e.tg = tg;
    this.entities.push(e);

    const out = { t: 'cast', id: p.id, sk: sIdx, eid: e.id, p: [r2(x), r2(y), r2(z)], d: [r2(dx), r2(dy), r2(dz)], seed };
    if (aw) out.aw = 1;
    if (tg) out.tg = tg.map(r2);
    if (ripId) out.rp = ripId;
    if (hk) out.hk = hk;
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
        if (q === src || q.dead || hitIds.has(q.id) || this.allied(src, q)) continue;
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
      if (q === p || q.dead || this.allied(p, q)) continue;
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
    // tường băng bị đập vỡ: mảnh băng bắn ra làm chậm đối thủ của chủ tường đứng gần
    const S = pr.shatter, M = S && why === 'break' ? this.players.get(pr.owner) : null;
    if (M) {
      const sk = { fx: { kind: 'iceShatter', color: 0x9bf6ff }, slow: S.slow, noMark: true };
      for (const q of [...this.players.values()]) {
        if (q.dead || this.allied(M, q)) continue;
        if (Math.hypot(q.x - pr.x, q.z - pr.z) < S.radius + BODY_R && q.y - pr.y < 4) this.damage(M, q, S.dmg, this.kbFrom(pr.x, pr.z, q, { kb: 5, kbUp: 2 }), sk, [q.x, q.y + 1, q.z]);
      }
    }
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
          if (q === src || q.dead || this.allied(src, q)) continue;
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
      if (q === p || q.dead || this.allied(p, q)) continue;
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
    // đấu đội: phòng chờ/kết quả không mất máu; không đánh được đồng đội / vật triệu hồi phe mình
    if (this.team && this.phase !== 'play') return false;
    if (src && src !== tgt && this.allied(src, tgt)) return false;
    // phân thân mồi: trúng 1 đòn là tan
    if (tgt.fake === 'decoy') { this.popDecoy(tgt); return true; }
    if (src?.fake === 'bot') amount *= 0.5;   // võ sĩ máy đánh nhẹ
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
    // người chơi giả không tự xử lý đẩy lùi như client: server cho văng luôn
    if (tgt.fake && tgt.vel && !tgt.grab) { tgt.vel[0] += kb[0]; tgt.vel[2] += kb[2]; tgt.vel[1] = Math.max(tgt.vel[1], kb[1]); tgt.kbT = 0.3; }
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
    if (tgt.fake === 'decoy' || tgt.fake === 'pet') {
      this.broadcast({ t: 'die', id: tgt.id, by: src ? src.id : 0, k: src ? src.kills : 0, d: 0 });
      this.removeFake(tgt, 'die');
      return;
    }
    // Viêm Hoàng (dị biến Homura): gục lần đầu khi đang biến hình thì sống lại tại chỗ, hết dị biến
    const RV = src && src !== tgt ? this.awOf(tgt)?.passive.revive : 0;
    if (RV) {
      tgt.hp = Math.max(1, Math.round(tgt.maxHp * RV));
      tgt.invulnUntil = now() + 1.5;
      tgt.burn = null;
      this.endAwaken(tgt);
      this.broadcast({ t: 'revive', id: tgt.id, hp: Math.ceil(tgt.hp) });
      this.broadcast({ t: 'sys', msg: `🔥 ${tgt.name} hồi sinh từ tro tàn!` });
      return;
    }
    tgt.hp = 0;
    tgt.dead = true;
    tgt.deaths++;
    tgt.respawnAt = now() + GAME.respawnTime;
    tgt.healUntil = 0;
    tgt.charges = null;
    tgt.grab = null;
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
        if (!e.state.m) {
          e.state.m = 1; swing(1);
          if (s.fireZone && src) this.addZone('fire', src, px + hx * s.fireZone.off, pz + hz * s.fireZone.off, s.fireZone.r, s.fireZone.dur);
        }
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
          // boomerang: bay hết tầm thì quay đầu bay về tay người ném
          if (s.boomerang && src) {
            if (!sub.back && (sub.dist || 0) >= s.range) { sub.back = true; sub.dist = 0; }
            if (sub.back) {
              const v = [src.x - sub.pos[0], src.y + CHEST - sub.pos[1], src.z - sub.pos[2]], L = Math.hypot(...v) || 1;
              sub.d = v.map(c => c / L);
            }
          }
          const [ox, oy, oz] = sub.pos;
          const tv = this.zones.length ? travel * this.zoneSlow(ox, oz, src) : travel;
          const nx = ox + sub.d[0] * tv, ny = oy + sub.d[1] * tv, nz = oz + sub.d[2] * tv;
          sub.pos = [nx, ny, nz];
          sub.dist = (sub.dist || 0) + tv;
          let ended = false;
          for (const q of this.targets(e)) {
            const key = q.id * 16 + sub.k + (sub.back ? 8 : 0);
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
          if (!ended) {
            if (sub.back) ended = !src || Math.hypot(src.x - nx, src.y + CHEST - ny, src.z - nz) < 1.2 || sub.dist >= s.range * 1.8;
            else if ((!s.boomerang && sub.dist >= s.range) || hitsObstacle(nx, ny, nz, s.radius, this.arena, this.dyn, e.owner, src?.team)) ended = true;
          }
          if (ended) {
            sub.alive = false;
            // thương sét không trúng ai: cắm xuống chỗ rơi thành cọc sét
            if (s.rod && src && !sub.hitP) this.spawnRod(e, src, s.rod, nx - sub.d[0] * 0.5, ny, nz - sub.d[2] * 0.5, t);
            if (s.iceAt && src) this.addZone('ice', src, ...this.clampToArena(nx, nz), s.iceAt.r, s.iceAt.dur, { y: arenaGround(this.arena, nx, nz, Math.max(0, ny), 0.3) });
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
        // vệt băng theo đường trượt
        const IT = s.iceTrail;
        if (IT && src && !e.state.fin) {
          const li = e.state.li;
          if (!li || Math.hypot(x - li[0], z - li[1]) >= IT.gap) { e.state.li = [x, z]; this.addZone('ice', src, x, z, IT.r, IT.dur); }
        }
        if (!e.state.fin) for (const q of this.targets(e)) {
          // multi: lướt đánh nhiều nhịp — mỗi mục tiêu trúng tối đa s.multi lần, cách nhau s.multiInt giây
          const hc = e.hits.get(q.id);
          if (s.multi ? hc && (hc.n >= s.multi || t - hc.t < s.multiInt) : hc) continue;
          const d = distPointSeg(q.x, q.y, q.z, prev[0], prev[1], prev[2], x, y, z);
          if (d < s.radius + BODY_R && Math.abs(q.y - y) < 2.5) {
            e.hits.set(q.id, s.multi ? { n: (hc?.n || 0) + 1, t } : t);
            const hit = this.damage(src, q, s.dmg, [dhx * s.kb, s.kbUp ?? 3, dhz * s.kb], s, [q.x, q.y + 1, q.z]);
            // túm ném: người đầu tiên trúng (không bất tử, không miễn đẩy lùi)
            if (s.grab && hit && src && !e.state.grabbed && !q.isProp && !q.grab && !this.awOf(q, t)?.passive.noKb && !(q.buff?.noKb && t < q.buff.until) && !q.dead) {
              e.state.grabbed = q.id;
              this.startGrab(src, q, s, t);
            }
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
          // Phượng Hoàng Niết Bàn: mọi vệt lửa của chủ chiêu bùng thành cột lửa
          if (s.ignite && src) {
            const IG = s.ignite, pts = [], hitSet = new Set(), sk = { fx: { kind: 'flameBurst', color: s.fx.color } };
            for (const zn of this.zones) {
              if (zn.k !== 'fire' || zn.owner !== src.id) continue;
              if (pts.length < 30) pts.push([r2(zn.x), r2(zn.y), r2(zn.z)]);
              for (const q of this.targets(e, false)) {
                if (hitSet.has(q.id) || Math.hypot(q.x - zn.x, q.z - zn.z) > zn.r + BODY_R || q.y - zn.y > 4) continue;
                hitSet.add(q.id);
                this.damage(src, q, IG.dmg, this.kbFrom(zn.x, zn.z, q, IG), sk, [q.x, q.y + 1, q.z]);
              }
            }
            if (pts.length) this.broadcast({ t: 'pulse', k: 'flame', pts, c: s.fx.color, r: 1.6 });
          }
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
              const friend = q.id === e.owner || (src && this.allied(src, q));
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
        if (s.fireZone && src) this.addZone('fire', src, cx, cz, s.fireZone.r, s.fireZone.dur);
        e.dead = true;
        break;
      }
      case 'decoy': {
        // tàng hình chốc lát + thả phân thân mồi chạy chéo về phía trước
        if (e.state.done) break;
        e.state.done = true;
        if (src && !src.dead) {
          for (const q of [...this.players.values()]) if (q.fake === 'decoy' && q.master === src.id) this.removeFake(q, 'expire');
          this.applyBuff(src, { fx: s.fx, stealth: true, nextHitMul: s.nextHitMul || 1 }, t + s.stealth);
          const base = Math.atan2(hx, hz);
          for (let i = 0; i < s.count; i++) {
            const a = base + (s.count > 1 ? (i / (s.count - 1) * 2 - 1) * s.spread : 0);
            this.addFake({ fake: 'decoy', master: src.id, team: src.team, char: src.char, name: src.name, x: src.x, y: src.y, z: src.z, yaw: a,
              hp: src.hp, maxHp: src.maxHp, kills: src.kills, deaths: src.deaths, awUntil: src.awUntil, until: t + s.dur,
              ai: { dir: [Math.sin(a), Math.cos(a)], speed: s.speed, stopAt: t + s.dur * 0.75, pop: s.pop } });
          }
        }
        e.dead = true;
        break;
      }
      case 'icewall': {
        // tường băng cong: các đoạn là công trình có máu, chắn đường và chắn đạn
        if (e.state.up) break;
        e.state.up = true;
        const [cx, cz] = e.tg, w = s.width / 2;
        for (const q of this.props.filter(q => q.owner === e.owner && q.kind === 'iceWall')) this.removeProp(q, 'time');
        for (let i = 0; i < s.segs; i++) {
          const f = s.segs > 1 ? i / (s.segs - 1) * 2 - 1 : 0;
          // hai đầu tường cong về phía Yuki
          const sx = cx - hz * f * w - hx * s.curve * f * f, sz = cz + hx * f * w - hz * s.curve * f * f;
          this.addProp({ kind: 'iceWall', owner: e.owner, team: src?.team || null, x: sx, y: 0, z: sz, r: s.r, h: s.h, hp: s.hp, until: t + s.dur, solid: true, shatter: s.shatter });
          for (const q of this.targets(e, false)) {
            if (e.hits.has(q.id) || Math.hypot(q.x - sx, q.z - sz) > s.r + BODY_R + 0.4 || q.y > s.h) continue;
            e.hits.set(q.id, t);
            this.damage(src, q, s.dmg, [hx * s.kb, s.kbUp, hz * s.kb], s, [q.x, q.y + 1, q.z]);
          }
        }
        e.dead = true;
        break;
      }
      case 'timezone': {
        // vùng ngưng đọng: làm chậm đối thủ và đạn đối thủ, sàn đóng băng, mất máu theo nhịp, hết giờ vỡ tung
        if (!e.state.up) {
          e.state.up = true;
          e.state.c = src ? [src.x, src.z] : [px, pz];
          if (src) {
            this.addZone('slow', src, e.state.c[0], e.state.c[1], s.radius, s.dur, { mul: s.slowMul });
            this.addZone('ice', src, e.state.c[0], e.state.c[1], s.radius, s.dur);
          }
        }
        const [cx, cz] = e.state.c, run = el - s.delay;
        const n = Math.floor(run / s.tickInt);
        if (run < s.dur && n > (e.state.n ?? -1)) {
          e.state.n = n;
          for (const q of this.targets(e, false)) {
            if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R && q.y < 6) this.damage(src, q, s.dmg, [0, s.kbUp, 0], s, [q.x, q.y + 1, q.z]);
          }
        }
        if (run >= s.dur) {
          const sk = { ...s, stun: s.endStun, slow: null };
          for (const q of this.targets(e, false)) {
            if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R && q.y < 6) this.damage(src, q, s.endDmg, this.kbFrom(cx, cz, q, { kb: 5, kbUp: 6 }), sk, [q.x, q.y + 1, q.z]);
          }
          this.broadcast({ t: 'pulse', k: 'iceBurst', pts: [[r2(cx), 0, r2(cz)]], c: s.fx.color, r: s.radius });
          e.dead = true;
        }
        break;
      }
      case 'turret': {
        // trồng cây bắn gai (tối đa s.max cây)
        if (e.state.up) break;
        e.state.up = true;
        const [cx, cz] = e.tg;
        const mine = this.props.filter(q => q.owner === e.owner && q.kind === 'turret');
        while (mine.length >= s.max) this.removeProp(mine.shift(), 'time');
        this.addProp({ kind: 'turret', owner: e.owner, team: src?.team || null, x: cx, y: arenaGround(this.arena, cx, cz, 0.5, 0.3), z: cz, r: 0.7, h: 1.6, hp: s.hp, until: t + s.dur,
          tur: { s: s.shot, range: s.range, every: s.every, next: t + 0.4, sk: e.sk } });
        e.dead = true;
        break;
      }
      case 'pet': {
        // người cây Mộc Thần trồi lên trước mặt (mỗi người 1 cây), hất tung đối thủ quanh đó
        if (e.state.up) break;
        e.state.up = true;
        if (src && !src.dead) {
          for (const q of [...this.players.values()]) if (q.fake === 'pet' && q.master === src.id) this.removeFake(q, 'expire');
          const [cx, cz] = this.freeSpot(...this.clampToArena(px + hx * s.offset, pz + hz * s.offset), px, pz);
          for (const q of this.targets(e, false)) {
            if (Math.hypot(q.x - cx, q.z - cz) < s.radius + BODY_R && q.y < 4) this.damage(src, q, s.dmg, this.kbFrom(cx, cz, q, s), s, [q.x, q.y + 1, q.z]);
          }
          const ch = getChar(s.pet);
          this.addFake({ fake: 'pet', master: src.id, team: src.team, char: ch.id, name: `${ch.name} (${src.name})`, x: cx, z: cz, yaw: Math.atan2(hx, hz), until: t + s.dur });
        }
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
        // sương đêm: đối thủ trong tầm chỉ nhìn thấy người ở gần
        if (s.dark && !e.state.dk && src) {
          e.state.dk = 1;
          const ids = [];
          for (const q of this.players.values()) if (!q.fake && !q.dead && !this.allied(src, q) && Math.hypot(q.x - src.x, q.z - src.z) < s.dark.range) ids.push(q.id);
          this.broadcast({ t: 'dark', by: src.id, ids, dur: s.dark.dur, see: s.dark.see });
        }
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
          const dc = e.swapId ? this.players.get(e.swapId) : null;
          const ox = src.x, oz = src.z;
          this.teleport(src, cx, cz, t);
          if (dc) this.teleport(dc, ox, oz, t);   // phân thân về chỗ cũ của Kage
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

    for (const p of [...this.players.values()]) {
      if (p.dead) {
        if (t >= p.respawnAt) {
          const [sx, sz] = p.home || this.spawnPoint(p.team);
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
      // đang bị túm / người chơi giả do server điều khiển
      if (p.grab) this.stepGrab(p, t);
      if (p.fake) { this.updateFake(p, t, dt); if (!this.players.has(p.id)) continue; }
      // Viêm Hoàng (Homura): vệt lửa theo bước chạy
      const FT = p.awUntil > t ? getChar(p.char).awaken?.passive.fireTrail : null;
      if (FT && p.y - arenaGround(this.arena, p.x, p.z, p.y, BODY_R) < 0.4) {
        const lt = p.lastTrail;
        if (!lt || Math.hypot(p.x - lt[0], p.z - lt[1]) >= FT.gap) { p.lastTrail = [p.x, p.z]; this.addZone('fire', p, p.x, p.z, FT.r, FT.dur); }
      }
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
      if (p.dead) continue;
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
      this.updateTurrets(t);
    }
    if (this.zones.length) this.updateZones(t, dt);
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
