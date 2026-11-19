// Một phòng đấu: lưu người chơi, mô phỏng chiêu thức, tính sát thương (server-authoritative).
import { startLoop } from './loop.js';
import { NET, Ticker, GAME, MOVE, ARENA, rainPoints, hitsObstacle } from '../shared/config.js';
import { getChar, skillLifetime } from '../shared/characters.js';
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

let nextRoomId = 1;
let nextEntityId = 1;

export class Room {
  constructor(name, hub) {
    this.id = String(nextRoomId++);
    this.name = name;
    this.hub = hub;
    this.players = new Map(); // id -> player
    this.entities = [];
    this.lastTick = now();
    this.snapT = new Ticker(NET.snapRate);
    this.stopLoop = startLoop(NET.tickRate, () => this.tick());
  }

  get count() { return this.players.size; }

  destroy() { this.stopLoop(); }

  info() { return { id: this.id, name: this.name, count: this.count, mode: 'brawl' }; }

  // ---------- Quản lý người chơi ----------
  spawnPoint() {
    // chọn điểm hồi sinh xa người chơi khác nhất
    let best = ARENA.spawns[0], bestD = -1;
    for (const s of ARENA.spawns) {
      let minD = 1e9;
      for (const p of this.players.values()) if (!p.dead) minD = Math.min(minD, Math.hypot(p.x - s[0], p.z - s[1]));
      minD += Math.random() * 4;
      if (minD > bestD) { bestD = minD; best = s; }
    }
    return best;
  }

  publicPlayer(p) {
    return { id: p.id, name: p.name, char: p.char, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw),
      hp: Math.ceil(p.hp), mp: Math.floor(p.mp), dead: p.dead, kills: p.kills, deaths: p.deaths };
  }

  add(client) {
    const [sx, sz] = this.spawnPoint();
    const p = {
      id: client.id, ws: client.ws, name: client.name, char: client.char,
      x: sx, y: 0, z: sz, yaw: Math.atan2(-sx, -sz), anim: 0, flags: 0,
      hp: GAME.maxHp, mp: GAME.maxMana, dead: false, respawnAt: 0,
      lastHit: -99, kills: 0, deaths: 0, cds: {}, lockUntil: 0, healCd: 0,
      healUntil: 0, healRate: 0, invulnUntil: 0, stunUntil: 0, lastSeen: now(),
    };
    this.players.set(p.id, p);
    client.room = this;
    this.send(p, { t: 'joined', you: p.id, room: { id: this.id, name: this.name },
      players: [...this.players.values()].map(q => this.publicPlayer(q)) });
    this.broadcast({ t: 'pjoin', player: this.publicPlayer(p) }, p.id);
    this.broadcast({ t: 'sys', msg: `${p.name} đã vào phòng` });
    this.hub.roomsChanged();
  }

  remove(clientId) {
    const p = this.players.get(clientId);
    if (!p) return;
    this.players.delete(clientId);
    this.broadcast({ t: 'pleave', id: clientId });
    this.broadcast({ t: 'sys', msg: `${p.name} đã rời phòng` });
    this.entities = this.entities.filter(e => e.owner !== clientId);
    this.hub.roomsChanged();
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
        p.x = x; p.y = Math.max(0, y); p.z = z;
        p.yaw = +m.r || 0; p.anim = m.a | 0; p.flags = m.f | 0;
        break;
      }
      case 'dodge': // né (dash) => bất tử ngắn
        if (!p.dead) p.invulnUntil = Math.max(p.invulnUntil, t + MOVE.dashInvuln);
        break;
      case 'cast': this.handleCast(p, m, t); break;
      case 'heal': this.handleHeal(p, t); break;
      case 'steer': { // cập nhật tâm ngắm cho chiêu cuối đang chạy
        const e = p.steerEnt, a = validAim(m.a);
        if (!e || e.dead || !a) return;
        e.st.aim = a;
        this.broadcast({ t: 'steer', eid: e.id, a: a.map(r2) }, p.id);
        break;
      }
      case 'char': {
        const c = getChar(m.char);
        p.char = c.id;
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
    const s = ch.skills[sIdx];
    const reject = () => this.send(p, { t: 'castno', cs: m.cs, sk: sIdx, mp: Math.floor(p.mp) });
    if (!s || p.dead || t < p.stunUntil - 0.05) return reject();
    if (t < (p.cds[sIdx] || 0) - 0.08) return reject();      // dung sai nhỏ cho lag
    if (t < p.lockUntil - 0.12) return reject();
    if (p.mp < s.mana) return reject();
    if (!Array.isArray(m.p) || !Array.isArray(m.d)) return reject();
    let [x, y, z] = m.p.map(Number);
    let [dx, dy, dz] = m.d.map(Number);
    if (![x, y, z, dx, dy, dz].every(Number.isFinite)) return reject();
    // Không tin vị trí cast lệch quá xa vị trí server biết
    if (Math.hypot(x - p.x, z - p.z) > 6) { x = p.x; y = p.y; z = p.z; }
    dy = Math.max(-0.6, Math.min(0.6, dy));
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;

    p.mp -= s.mana;
    p.cds[sIdx] = t + s.cd;
    p.lockUntil = t + s.lock;
    if (s.invuln && s.type === 'dash') p.invulnUntil = Math.max(p.invulnUntil, t + s.delay + s.dur + 0.05);

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
      }
    }
    if (s.type === 'rain') e.pts = rainPoints(s, seed);
    e.st = initSteer(s, [x, y, z], [dx, dy, dz], e.h);
    if (e.st) p.steerEnt = e;
    this.entities.push(e);

    const out = { t: 'cast', id: p.id, sk: sIdx, eid: e.id, p: [r2(x), r2(y), r2(z)], d: [r2(dx), r2(dy), r2(dz)], seed };
    this.broadcast(out, p.id);
    this.send(p, { ...out, cs: m.cs, mp: Math.floor(p.mp) });
  }

  // ---------- Sát thương ----------
  damage(src, tgt, amount, kb, s, at) {
    const t = now();
    if (tgt.dead || t < tgt.invulnUntil) return false;
    amount = Math.round(amount);
    tgt.hp -= amount;
    tgt.lastHit = t;
    if (src && src !== tgt) src.mp = Math.min(GAME.maxMana, src.mp + amount * GAME.manaOnHitRatio);
    const msg = { t: 'hit', tid: tgt.id, sid: src ? src.id : 0, dmg: amount, hp: Math.max(0, Math.ceil(tgt.hp)),
      kb: kb.map(r2), at: at.map(r2), fx: s.fx.kind, c: s.fx.color };
    if (s.stun) { msg.stun = s.stun; tgt.stunUntil = t + s.stun; }
    if (s.slow) msg.slow = s.slow;
    this.broadcast(msg);
    if (tgt.hp <= 0) this.kill(tgt, src);
    return true;
  }

  kill(tgt, src) {
    tgt.hp = 0;
    tgt.dead = true;
    tgt.deaths++;
    tgt.respawnAt = now() + GAME.respawnTime;
    tgt.healUntil = 0;
    if (src && src !== tgt) src.kills++;
    this.broadcast({ t: 'die', id: tgt.id, by: src ? src.id : 0, k: src ? src.kills : 0, d: tgt.deaths });
  }

  kbFrom(fx, fz, tgt, s, mul = 1) {
    let vx = tgt.x - fx, vz = tgt.z - fz;
    const L = hlen(vx, vz);
    vx /= L; vz /= L;
    let k = (s.kb || 0) * mul;
    if (s.pull) k = -s.pull;
    return [vx * k, s.kbUp != null ? s.kbUp : Math.abs(k) * 0.25, vz * k];
  }

  // Lọc mục tiêu hợp lệ (không phải chủ chiêu, còn sống)
  *targets(e) {
    for (const q of this.players.values()) if (q.id !== e.owner && !q.dead) yield q;
  }

  explode(e, src, x, y, z, ex) {
    this.broadcast({ t: 'boom', eid: e.id, at: [r2(x), r2(y), r2(z)], r: ex.radius, c: e.skill.fx.color });
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
        for (const q of this.targets(e)) {
          const vx = q.x - px, vz = q.z - pz;
          const d = Math.hypot(vx, vz);
          if (d > s.range + BODY_R || Math.abs(q.y - py) > 2.2) continue;
          const ang = d < 0.5 ? 0 : Math.acos(Math.max(-1, Math.min(1, (vx * hx + vz * hz) / d)));
          if (ang <= s.arc) this.damage(src, q, s.dmg, this.kbFrom(px, pz, q, s), s, [q.x, q.y + 1, q.z]);
        }
        e.dead = true;
        break;
      }
      case 'projectile': {
        const travel = s.speed * dt;
        let any = false;
        for (const sub of e.subs) {
          if (!sub.alive) continue;
          if (e.st) { steerStep(e.st, s, dt, el, sub.pos); sub.d = e.st.d; }
          const [ox, oy, oz] = sub.pos;
          const nx = ox + sub.d[0] * travel, ny = oy + sub.d[1] * travel, nz = oz + sub.d[2] * travel;
          sub.pos = [nx, ny, nz];
          sub.dist = (sub.dist || 0) + travel;
          let ended = false;
          for (const q of this.targets(e)) {
            const key = q.id * 16 + sub.k;
            if (e.hits.has(key)) continue;
            const d = distPointSeg(q.x, q.y + CHEST, q.z, ox, oy, oz, nx, ny, nz);
            if (d < s.radius + BODY_R) {
              e.hits.set(key, t);
              const kb = [sub.d[0] * s.kb, s.kbUp != null ? s.kbUp : s.kb * 0.3, sub.d[2] * s.kb];
              this.damage(src, q, s.dmg, kb, s, [q.x, q.y + 1, q.z]);
              if (!s.pierce) { ended = true; break; }
            }
          }
          if (!ended && (sub.dist >= s.range || hitsObstacle(nx, ny, nz, s.radius))) ended = true;
          if (ended) {
            sub.alive = false;
            if (s.explode) this.explode(e, src, nx, ny, nz, s.explode);
            else this.broadcast({ t: 'pend', eid: e.id, k: sub.k, at: [r2(nx), r2(ny), r2(nz)] });
          } else any = true;
        }
        if (!any) e.dead = true;
        break;
      }
      case 'dash': {
        const f = Math.min(1, (el - s.delay) / s.dur);
        let x = px + hx * s.dist * f, z = pz + hz * s.dist * f;
        let dhx = hx, dhz = hz;
        if (e.st) { [x, z] = e.st.pos; [dhx, dhz] = e.st.h; }
        const prev = e.state.prev || [px, pz];
        e.state.prev = [x, z];
        for (const q of this.targets(e)) {
          if (e.hits.has(q.id)) continue;
          const d = distPointSeg(q.x, q.y, q.z, prev[0], py, prev[1], x, py, z);
          if (d < s.radius + BODY_R && Math.abs(q.y - py) < 2.5) {
            e.hits.set(q.id, t);
            this.damage(src, q, s.dmg, [dhx * s.kb, s.kbUp || 3, dhz * s.kb], s, [q.x, q.y + 1, q.z]);
          }
        }
        if (f >= 1) {
          if (s.explode) this.explode(e, src, x, py + 0.5, z, s.explode);
          e.dead = true;
        }
        break;
      }
      case 'beam': {
        const n = Math.floor((el - s.delay) / s.tickInt);
        if (n > (e.state.n ?? -1) && el <= s.delay + s.dur) {
          e.state.n = n;
          const [dx, dy, dz] = e.d;
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
          if (e.st) { cx = e.st.c[0]; cz = e.st.c[2]; }
          for (const q of this.targets(e)) {
            const d = Math.hypot(q.x - cx, q.z - cz);
            if (d < s.radius + BODY_R && q.y - cy > -1.5 && q.y - cy < 5) {
              this.damage(src, q, s.dmg, this.kbFrom(cx, cz, q, s), s, [q.x, q.y + 1, q.z]);
            }
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
          const [sx, sz] = this.spawnPoint();
          Object.assign(p, { dead: false, hp: GAME.maxHp, mp: GAME.maxMana, x: sx, y: 0, z: sz,
            invulnUntil: t + 1.5, stunUntil: 0, lockUntil: 0, cds: {}, healCd: 0 });
          this.broadcast({ t: 'respawn', id: p.id, p: [sx, 0, sz] });
        }
        continue;
      }
      // Hồi máu thụ động (chậm), chỉ khi không bị đánh một lúc
      if (t - p.lastHit > GAME.hpRegenDelay) p.hp += GAME.hpRegen * dt;
      // Chiêu hồi máu
      if (t < p.healUntil) p.hp += p.healRate * dt;
      // Mana: thụ động + vận khí (flag 2) - bay (flag 1)
      let mr = GAME.manaRegen;
      if (p.flags & 2) mr += GAME.chargeManaRate;
      if (p.flags & 1) mr -= MOVE.flyManaPerSec + GAME.manaRegen;
      p.mp += mr * dt;
      p.hp = Math.min(GAME.maxHp, p.hp);
      p.mp = Math.max(0, Math.min(GAME.maxMana, p.mp));
      // Rơi khỏi đấu trường
      if (p.y < -15 || Math.hypot(p.x, p.z) > ARENA.radius + 25) this.kill(p, null);
    }

    for (const e of this.entities) {
      this.updateEntity(e, t, dt);
      if (t > e.end) e.dead = true;
    }
    this.entities = this.entities.filter(e => !e.dead);

    if (this.snapT.due(dt)) {
      const ps = [];
      for (const p of this.players.values()) {
        ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), p.anim, Math.ceil(p.hp), Math.floor(p.mp), p.flags | (p.dead ? 128 : 0)]);
      }
      this.broadcast({ t: 'snap', ps });
    }
  }
}
