// Phòng chế độ BẮN SÚNG: 'bomb' (Đặt bom, 2 phe, theo vòng) và 'dm' (Sinh tử, tự do).
// Server quyết định: máu, giáp, tiền, đạn, thắng/thua vòng, bom. Client tự di chuyển và
// tự dò trúng đích (cho mượt), server kiểm tra lại (tầm, tường chắn, tốc độ bắn, đạn).
import { startLoop } from './loop.js';
import { newRoomId } from './room.js';
import { NET, Ticker } from '../shared/config.js';
import { getMap, rayMap, inRect, newNade, stepNade, lineOfSight, NADE_STEP } from '../shared/maps.js';
import { WEAPONS, WEAPON_LIST, weaponIndex, EQUIPMENT, GRENADES, THROW_SPEED, SHOOTER as S } from '../shared/weapons.js';

const now = () => performance.now() / 1000;
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const NO_NADES = () => ({ he: 0, flash: 0, smoke: 0 });

// Bù trễ khi kiểm tra trúng đạn. Người bắn nhìn thấy mục tiêu ở vị trí cũ:
// (server → người bắn) + nội suy 70 ms + chờ snapshot + 1 khung hình + (người bắn → server).
// Server giữ lịch sử vị trí ~1 s và chấp nhận điểm trúng nằm gần quỹ đạo mục tiêu trong khoảng đó.
const HIST_KEEP = 1.0;      // giây lịch sử vị trí giữ lại
const REWIND_MAX = 0.7;     // lùi tối đa (giây), dù ping cao tới đâu
const DEFAULT_RTT = 0.2;    // khi chưa đo được ping
const HIT_TOL = 1.0;        // điểm trúng cách tâm mục tiêu tối đa (m, theo phương ngang): hitbox ~0.5 m + dung sai
const MAX_SPEED = 15;       // m/s, nhanh hơn mức này giữa 2 mẫu thì coi là dịch chuyển tức thời

export class ShooterRoom {
  constructor(name, hub, mode, mapId) {
    this.id = newRoomId();
    this.name = name;
    this.hub = hub;
    this.mode = mode === 'dm' ? 'dm' : 'bomb';
    this.map = getMap(mapId);
    this.nades = [];            // lựu đạn đang bay
    this.smokes = [];           // khói đang tồn tại
    this.drops = new Map();     // súng rơi trên đất
    this.nextGid = 1;
    this.nextDrop = 1;
    this.players = new Map();
    this.phase = 'warmup';
    this.phaseEnd = 0;
    this.round = 0;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.bomb = { state: 'none' };
    this.using = new Map();
    this.lastTick = now();
    this.rsAcc = 0;
    this.snapT = new Ticker(NET.snapRate);
    if (this.mode === 'dm') { this.phase = 'live'; this.phaseEnd = now() + S.dmTime; }
    this.stopLoop = startLoop(NET.tickRate, () => this.tick());
  }

  get count() { return this.players.size; }
  info() { return { id: this.id, name: this.name, count: this.count, mode: this.mode, map: this.map.id, mapName: this.map.name }; }
  destroy() { this.stopLoop(); }

  // ================= Gửi tin =================
  send(p, m) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); }
  broadcast(m, except) {
    const data = JSON.stringify(m);
    for (const p of this.players.values()) if (p.id !== except && p.ws.readyState === 1) p.ws.send(data);
  }
  sys(msg) { this.broadcast({ t: 'ssys', msg }); }
  center(msg, cls = '', dur = 3) { this.broadcast({ t: 'smsg', msg, cls, dur }); }

  pub(p) {
    return { id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, alive: p.alive, look: p.look };
  }
  roster() { this.broadcast({ t: 'sroster', list: [...this.players.values()].map(p => this.pub(p)) }); }

  me(p) {
    const ammo = {};
    for (const w of Object.values(p.weapons)) if (w) ammo[w] = p.ammo[w] || { mag: 0, res: 0 };
    this.send(p, { t: 'sme', money: p.money, weapons: p.weapons, ammo, cur: p.cur, armor: Math.ceil(p.armor), kit: p.kit,
      hp: Math.ceil(p.hp), alive: p.alive, bomb: this.bomb.state === 'carried' && this.bomb.carrier === p.id, team: p.team,
      loadout: p.loadout, nades: p.nades });
  }

  roundState() {
    const t = now();
    const alive = { T: 0, CT: 0 };
    for (const p of this.players.values()) if (p.alive && p.team) alive[p.team]++;
    const b = this.bomb;
    return { t: 'srs', mode: this.mode, phase: this.phase, left: Math.max(0, r2(this.phaseEnd - t)), round: this.round,
      score: this.score, alive, winRounds: S.winRounds, halfRounds: S.halfRounds, buyLeft: Math.max(0, r2(this.buyEnd - t || 0)),
      bomb: { state: b.state, carrier: b.carrier || 0, pos: b.pos, site: b.site, left: b.explodeAt ? r2(b.explodeAt - t) : 0 },
      dmKills: S.dmKills };
  }

  // ================= Vào / ra =================
  add(client) {
    const counts = this.teamCounts();
    const team = this.mode === 'dm' ? 'T' : (counts.T <= counts.CT ? 'T' : 'CT');
    const p = {
      id: client.id, ws: client.ws, name: client.name, team, look: (client.id * 7) % 4,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, w: 0,
      hp: S.maxHp, armor: 0, kit: false, money: this.mode === 'dm' ? 0 : S.startMoney,
      weapons: { 1: null, 2: 'pistol', 3: 'knife' }, ammo: {}, cur: 2,
      alive: false, kills: 0, deaths: 0, respawnAt: 0, lastFire: 0, reloadUntil: 0, reloadW: null,
      protectUntil: 0, loadout: { 1: 'rifle', 2: 'pistol' }, nades: NO_NADES(), lastThrow: 0,
    };
    this.refill(p, 'pistol');
    this.players.set(p.id, p);
    client.room = this;
    const t = now();
    this.send(p, { t: 'sj', you: p.id, room: { id: this.id, name: this.name }, mode: this.mode, map: this.map.id,
      players: [...this.players.values()].map(q => ({ ...this.pub(q), x: q.x, y: q.y, z: q.z })),
      drops: [...this.drops.values()].map(d => this.pubDrop(d)),
      smokes: this.smokes.map(s => ({ pos: s.pos, left: r2(s.until - t) })) });
    this.send(p, this.roundState());
    // vào giữa vòng thì phải chờ vòng sau (trừ khởi động / sinh tử)
    if (this.mode === 'dm' || this.phase === 'warmup' || this.phase === 'freeze') this.spawn(p, true);
    this.broadcast({ t: 'sroster', list: [...this.players.values()].map(q => this.pub(q)) });
    this.me(p);
    if (!p.alive) this.send(p, { t: 'smsg', msg: 'Vòng đang diễn ra — bạn sẽ vào ở vòng sau', cls: '', dur: 4 });
    this.sys(`${p.name} đã vào phòng (${this.mode === 'dm' ? 'Sinh tử' : 'phe ' + (team === 'T' ? 'Công' : 'Thủ')})`);
    this.hub.roomsChanged();
    this.checkWarmup();
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.bomb.state === 'carried' && this.bomb.carrier === id) this.dropBomb(p);
    this.players.delete(id);
    this.using.delete(id);
    this.broadcast({ t: 'sleave', id });
    this.roster();
    this.sys(`${p.name} đã rời phòng`);
    this.hub.roomsChanged();
    if (this.mode === 'bomb') { this.checkWarmup(); this.checkWin(); }
  }

  teamCounts() {
    const c = { T: 0, CT: 0 };
    for (const p of this.players.values()) if (p.team) c[p.team]++;
    return c;
  }

  refill(p, wid) {
    const w = WEAPONS[wid];
    if (w) p.ammo[wid] = { mag: w.mag, res: w.reserve };
  }

  spawnPoint(p) {
    if (this.mode === 'dm') {
      // điểm xa kẻ địch nhất
      let best = this.map.dmSpawns[0], bestD = -1;
      for (const s of this.map.dmSpawns) {
        let d = 1e9;
        for (const q of this.players.values()) if (q.alive && q !== p) d = Math.min(d, Math.hypot(q.x - s[0], q.z - s[1]));
        d += Math.random() * 6;
        if (d > bestD) { bestD = d; best = s; }
      }
      return best;
    }
    const list = this.map.spawns[p.team];
    const used = new Set([...this.players.values()].filter(q => q.alive && q.team === p.team && q !== p).map(q => q.spawnIdx));
    let i = 0;
    while (used.has(i) && i < list.length - 1) i++;
    p.spawnIdx = i;
    const [x, z] = list[i];
    return [x + (Math.random() - 0.5) * 0.4, z];
  }

  spawn(p, resetLoadout) {
    const [x, z] = this.spawnPoint(p);
    p.x = x; p.y = 0; p.z = z;
    p.hist = [];               // vị trí trước khi hồi sinh không còn tính
    this.pushHist(p, now());
    p.yaw = this.mode === 'dm' ? Math.random() * 6.28 : (p.team === 'T' ? Math.PI : 0);
    p.hp = S.maxHp;
    p.alive = true;
    p.reloadUntil = 0;
    p.protectUntil = now() + S.spawnProtect;
    if (this.mode === 'dm') {
      p.weapons = { 1: p.loadout[1], 2: p.loadout[2], 3: 'knife' };
      p.armor = 100;
      p.cur = p.weapons[1] ? 1 : 2;
      p.nades = { he: 1, flash: 1, smoke: 0 };   // sinh tử: mỗi lần hồi sinh có 1 nổ + 1 choáng
      for (const w of Object.values(p.weapons)) if (w) this.refill(p, w);
    } else {
      if (resetLoadout) {
        p.weapons = { 1: null, 2: 'pistol', 3: 'knife' };
        p.armor = 0; p.kit = false;
        p.nades = NO_NADES();
      }
      for (const w of Object.values(p.weapons)) if (w) this.refill(p, w);
      p.cur = p.weapons[1] ? 1 : 2;
      if (this.phase === 'warmup') { p.money = S.maxMoney; }
    }
    this.broadcast({ t: 'sspawn', id: p.id, p: [r2(p.x), 0, r2(p.z)], yaw: r2(p.yaw) });
    this.me(p);
  }

  // ================= Tin nhắn từ client =================
  onMessage(id, m) {
    const p = this.players.get(id);
    if (!p) return;
    const t = now();
    switch (m.t) {
      case 's': {
        if (!p.alive || !Array.isArray(m.p)) return;
        const [x, y, z] = m.p;
        if (![x, y, z].every(Number.isFinite)) return;
        // đóng băng đầu vòng: không cho di chuyển xa
        if (this.phase === 'freeze' && Math.hypot(x - p.x, z - p.z) > 0.5) return;
        p.x = x; p.y = Math.max(0, y); p.z = z;
        this.pushHist(p, t);
        p.yaw = Number.isFinite(m.r) ? m.r : 0; p.pitch = Number.isFinite(m.pi) ? m.pi : 0; p.flags = m.f | 0; p.w = m.w | 0;
        // nhặt bom rơi
        if (this.bomb.state === 'dropped' && p.team === 'T' && this.mode === 'bomb') {
          const [bx, , bz] = this.bomb.pos;
          if (Math.hypot(bx - x, bz - z) < 1.6) this.giveBomb(p);
        }
        this.autoPickup(p, t);
        break;
      }
      case 'fire': this.handleFire(p, m, t); break;
      case 'throw': this.handleThrow(p, m, t); break;
      case 'drop': {
        const wid = p.weapons[p.cur];
        if (!p.alive || !wid || p.cur === 3) return;
        this.dropWeapon(p, wid, p.x - Math.sin(p.yaw) * 1.2, p.z - Math.cos(p.yaw) * 1.2, p.id);
        p.weapons[p.cur] = null;
        p.cur = p.weapons[1] ? 1 : p.weapons[2] ? 2 : 3;
        p.reloadUntil = 0;
        this.me(p);
        break;
      }
      case 'pickup': this.manualPickup(p, t); break;
      case 'reload': {
        const wid = p.weapons[p.cur], w = WEAPONS[wid];
        if (!w || w.melee || !p.alive) return;
        const a = p.ammo[wid];
        if (!a || a.res <= 0 || a.mag >= w.mag) return;
        p.reloadUntil = t + w.reload; p.reloadW = wid;
        break;
      }
      case 'switch': {
        const s = m.slot | 0;
        if (p.weapons[s]) { p.cur = s; p.reloadUntil = 0; }
        break;
      }
      case 'buy': this.handleBuy(p, String(m.item)); break;
      case 'use': this.handleUse(p, !!m.on, t); break;
      case 'loadout': {
        // chỉ nhận chuỗi: WEAPONS[["sniper"]] cũng tra ra súng nhưng lưu vào loadout là mảng → không bắn được
        const w1 = typeof m.w1 === 'string' && WEAPONS[m.w1], w2 = typeof m.w2 === 'string' && WEAPONS[m.w2];
        if (w1 && w1.slot === 1) p.loadout[1] = m.w1;
        if (w2 && w2.slot === 2) p.loadout[2] = m.w2;
        this.me(p);
        break;
      }
      case 'team': {
        if (this.mode !== 'bomb') return;
        const team = m.team === 'CT' ? 'CT' : 'T';
        if (team === p.team) return;
        if (p.alive && this.phase !== 'warmup') { this.kill(p, null, 'suicide', false, true); }
        if (this.bomb.state === 'carried' && this.bomb.carrier === p.id) this.dropBomb(p);
        p.team = team;
        p.alive = false;
        p.weapons = { 1: null, 2: 'pistol', 3: 'knife' };
        this.sys(`${p.name} chuyển sang phe ${team === 'T' ? 'Công' : 'Thủ'}`);
        if (this.phase === 'warmup') this.spawn(p, true);
        this.roster();
        this.me(p);
        this.checkWarmup();
        this.checkWin();
        break;
      }
      case 'chat': {
        const msg = String(m.msg || '').slice(0, 140).trim();
        if (msg) this.broadcast({ t: 'schat', name: p.name, team: p.team, msg });
        break;
      }
    }
  }

  handleFire(p, m, t) {
    const wid = p.weapons[p.cur];
    const w = WEAPONS[wid];
    if (!w || !p.alive || m.w !== wid) return;
    if (this.phase === 'freeze' || this.phase === 'matchEnd') return;
    const interval = 60 / w.rpm;
    if (t - p.lastFire < interval * 0.6) return;        // dung sai cho mạng chập chờn
    if (t < p.reloadUntil) return;
    const a = p.ammo[wid];
    if (!w.melee) {
      if (!a || a.mag <= 0) return this.me(p);
      a.mag--;
    }
    p.lastFire = t;
    p.protectUntil = 0;
    if (!Array.isArray(m.o) || m.o.length !== 3 || !Array.isArray(m.p)) return;   // o=[] lọt qua every() → NaN vào máu
    const o = m.o.map(Number);
    if (!o.every(Number.isFinite)) return;
    // gốc bắn phải gần vị trí người chơi
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 2.5 || Math.abs(o[1] - p.y - 1.3) > 2) return;

    const pellets = m.p.slice(0, w.pellets || 1).filter(q => Array.isArray(q) && q.slice(0, 3).every(Number.isFinite));
    this.broadcast({ t: 'sshot', id: p.id, w: weaponIndex(wid), o: o.map(r2), e: pellets.map(q => [r2(q[0]), r2(q[1]), r2(q[2])]) }, p.id);
    // người bắn thấy mục tiêu ở thời điểm t - rewind (theo giờ server nhận vị trí)
    const rewind = Math.min(REWIND_MAX, (p.ws.rtt ?? DEFAULT_RTT) + NET.interp + 2 / NET.snapRate + 0.1);
    const dmgBy = new Map();
    for (const q of pellets) {
      const [ex, ey, ez, tid, zone] = q;
      if (!tid) continue;
      const tgt = this.players.get(tid | 0);
      if (!tgt || !tgt.alive || tgt === p) continue;
      if (this.mode === 'bomb' && tgt.team === p.team) continue;  // không bắn đồng đội
      if (t < tgt.protectUntil) continue;
      const dx = ex - o[0], dy = ey - o[1], dz = ez - o[2];
      const dist = Math.hypot(dx, dy, dz);
      if (w.melee && dist > w.reach + 1) continue;
      // điểm trúng phải gần quỹ đạo mục tiêu trong khoảng thời gian người bắn có thể đang thấy
      if (!this.nearPast(tgt, ex, ey, ez, t - rewind)) continue;
      // không có tường chắn
      const dir = [dx / dist, dy / dist, dz / dist];
      const wall = rayMap(o, dir, dist, this.map.boxes);
      if (wall.t < dist - 0.6) continue;
      let dmg = w.dmg * (zone === 1 ? w.head : zone === 3 ? 0.75 : 1) * Math.pow(w.range, dist / 10);
      const prev = dmgBy.get(tgt) || { dmg: 0, head: false };
      dmgBy.set(tgt, { dmg: prev.dmg + dmg, head: prev.head || zone === 1, zone: prev.zone || zone });
    }
    for (const [tgt, h] of dmgBy) this.damage(p, tgt, h.dmg, h.head, wid);
  }

  // Lưu vị trí theo giờ server nhận (bỏ mẫu cũ hơn HIST_KEEP)
  pushHist(p, t) {
    const h = p.hist || (p.hist = []);
    h.push([t, p.x, p.y, p.z]);
    while (h.length > 2 && h[1][0] < t - HIST_KEEP) h.shift();
  }

  // Điểm (x, y, z) có nằm sát quỹ đạo của mục tiêu từ thời điểm `since` tới giờ không.
  // Xét từng đoạn thẳng giữa 2 mẫu liên tiếp (client nội suy tuyến tính giữa các snapshot).
  nearPast(tgt, x, y, z, since) {
    const h = tgt.hist || [];
    let i = h.length - 1;
    while (i > 0 && h[i][0] > since) i--;      // lấy cả mẫu ngay trước `since` làm điểm đầu
    const pts = h.slice(i);
    if (!pts.length) pts.push([0, tgt.x, tgt.y, tgt.z]);
    for (let k = 0; k < pts.length; k++) {
      const [ta, ax, ay, az] = pts[k], [tb, bx, by, bz] = pts[Math.min(k + 1, pts.length - 1)];
      let dx = bx - ax, dz = bz - az;
      // nhảy cóc xa hơn mức chạy được (dịch chuyển, gói tin lạ): không nội suy qua đoạn đó
      if (Math.hypot(dx, dz) > MAX_SPEED * (tb - ta) + 1) dx = dz = 0;
      const L2 = dx * dx + dz * dz;
      const s = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      const cx = ax + dx * s, cz = az + dz * s, cy = ay + (by - ay) * s;
      if (Math.hypot(x - cx, z - cz) <= HIT_TOL && y >= cy - 0.6 && y <= cy + 2.4) return true;
    }
    return false;
  }

  damage(src, tgt, dmg, head, wid) {
    const w = WEAPONS[wid];
    let armorHit = false;
    if (tgt.armor > 0) {
      const hp = dmg * (w?.armorPen ?? (wid === 'he' ? 0.6 : 1));
      tgt.armor = Math.max(0, tgt.armor - (dmg - hp) * 0.5);
      dmg = hp;
      armorHit = true;
    }
    dmg = Math.max(1, Math.round(dmg));
    tgt.hp -= dmg;
    this.broadcast({ t: 'shit', tid: tgt.id, sid: src ? src.id : 0, dmg, hp: Math.max(0, tgt.hp), head, armor: armorHit,
      from: src ? [r2(src.x), r2(src.z)] : null });
    this.send(tgt, { t: 'sme2', hp: Math.max(0, Math.ceil(tgt.hp)), armor: Math.ceil(tgt.armor) });
    if (tgt.hp <= 0) this.kill(tgt, src, wid, head);
  }

  kill(tgt, src, wid, head, silent = false) {
    tgt.hp = 0;
    tgt.alive = false;
    tgt.deaths++;
    this.using.delete(tgt.id);
    if (this.bomb.state === 'carried' && this.bomb.carrier === tgt.id) this.dropBomb(tgt);
    // rơi súng tốt nhất xuống đất (súng chính, nếu không có thì súng lục)
    const best = tgt.weapons[1] || tgt.weapons[2];
    if (best && !silent) {
      this.dropWeapon(tgt, best, tgt.x, tgt.z, 0);
      tgt.weapons[tgt.weapons[1] ? 1 : 2] = null;
    }
    tgt.nades = NO_NADES();
    if (src && src !== tgt) {
      if (this.mode === 'bomb' && src.team === tgt.team) {
        src.kills--; src.money = Math.max(0, src.money - 300);
      } else {
        src.kills++;
        if (this.mode === 'bomb') src.money = Math.min(S.maxMoney, src.money + (WEAPONS[wid]?.reward ?? 300));
      }
      this.me(src);
    }
    if (this.mode === 'dm' || this.phase === 'warmup') tgt.respawnAt = now() + S.dmRespawn;
    const wcode = WEAPONS[wid] ? weaponIndex(wid) : wid === 'he' ? -2 : -1;
    if (!silent) this.broadcast({ t: 'sdie', id: tgt.id, by: src ? src.id : 0, w: wcode, head: !!head });
    this.me(tgt);
    this.roster();
    if (this.mode === 'dm' && src && src.kills >= S.dmKills) this.endDM(src);
    if (this.mode === 'bomb') this.checkWin();
  }

  // ================= Mua đồ =================
  canBuy(p) {
    if (!p.alive) return false;
    if (this.mode === 'dm') return true;
    if (this.phase === 'warmup') return true;
    if (now() > this.buyEnd) return false;
    const z = this.map.buyZones[p.team];
    return Math.hypot(p.x - z.x, p.z - z.z) < z.r;
  }

  handleBuy(p, item) {
    if (!this.canBuy(p)) return this.send(p, { t: 'smsg', msg: 'Không thể mua lúc này / ngoài khu mua', cls: 'warn', dur: 1.5 });
    const free = this.mode === 'dm';
    const w = WEAPONS[item];
    const g = GRENADES[item];
    const noMoney = () => this.send(p, { t: 'smsg', msg: 'Không đủ tiền!', cls: 'warn', dur: 1.2 });
    if (g) {
      if (free) return this.send(p, { t: 'smsg', msg: 'Sinh tử: mỗi lần hồi sinh được 1 lựu đạn nổ + 1 choáng', cls: 'warn', dur: 2 });
      if (p.nades[item] >= g.max) return this.send(p, { t: 'smsg', msg: `Đã đủ ${g.name}`, cls: 'warn', dur: 1.2 });
      if (p.money < g.price) return noMoney();
      p.money -= g.price;
      p.nades[item]++;
    } else if (w && !w.melee) {
      if (!free && p.money < w.price) return noMoney();
      if (!free) p.money -= w.price;
      // mua súng mới thì súng cũ cùng ô rơi xuống (có thể mua giúp đồng đội)
      const old = p.weapons[w.slot];
      if (old && old !== item && !free) this.dropWeapon(p, old, p.x, p.z, p.id);
      p.weapons[w.slot] = item;
      p.cur = w.slot;
      this.refill(p, item);
      if (free) p.loadout[w.slot] = item;
    } else if (item === 'armor') {
      if (p.armor >= 100) return;
      if (!free && p.money < EQUIPMENT.armor.price) return this.send(p, { t: 'smsg', msg: 'Không đủ tiền!', cls: 'warn', dur: 1.2 });
      if (!free) p.money -= EQUIPMENT.armor.price;
      p.armor = 100;
    } else if (item === 'kit') {
      if (p.team !== 'CT' || p.kit || this.mode !== 'bomb') return;
      if (p.money < EQUIPMENT.kit.price) return this.send(p, { t: 'smsg', msg: 'Không đủ tiền!', cls: 'warn', dur: 1.2 });
      p.money -= EQUIPMENT.kit.price;
      p.kit = true;
    } else return;
    this.me(p);
  }

  // ================= Súng rơi trên đất =================
  pubDrop(d) { return { id: d.id, w: d.w, pos: [r2(d.x), r2(d.y), r2(d.z)], rot: d.rot }; }

  dropWeapon(p, wid, x, z, noPickId) {
    const w = WEAPONS[wid];
    if (!w || w.melee) return;
    // không để súng lọt vào trong tường
    const B = this.map.bounds;
    x = Math.max(-B.x + 0.5, Math.min(B.x - 0.5, x));
    z = Math.max(-B.z + 0.5, Math.min(B.z - 0.5, z));
    if (!lineOfSight([p.x, p.y + 0.5, p.z], [x, p.y + 0.5, z], this.map)) { x = p.x; z = p.z; }
    const a = p.ammo[wid] || { mag: w.mag, res: w.reserve };
    const d = { id: this.nextDrop++, w: wid, mag: a.mag, res: a.res, x, y: p.y, z, rot: r2(Math.random() * 6.28),
      noPick: noPickId, noPickUntil: now() + 1.2, at: now() };
    this.drops.set(d.id, d);
    if (this.drops.size > 40) this.removeDrop(this.drops.keys().next().value);
    this.broadcast({ t: 'sdrop', add: this.pubDrop(d) });
  }

  removeDrop(id) {
    if (this.drops.delete(id)) this.broadcast({ t: 'sdrop', rem: id });
  }

  takeDrop(p, d, switchTo) {
    const w = WEAPONS[d.w];
    p.weapons[w.slot] = d.w;
    p.ammo[d.w] = { mag: d.mag, res: d.res };
    if (switchTo || p.cur === 3) { p.cur = w.slot; p.reloadUntil = 0; }
    this.removeDrop(d.id);
    this.send(p, { t: 'smsg', msg: `Đã nhặt ${w.name}`, cls: '', dur: 1.2 });
    this.me(p);
  }

  // đi qua là tự nhặt nếu ô súng đó đang trống
  autoPickup(p, t) {
    if (!p.alive || !this.drops.size) return;
    for (const d of this.drops.values()) {
      if (d.noPick === p.id && t < d.noPickUntil) continue;
      if (Math.hypot(d.x - p.x, d.z - p.z) > 1.1 || Math.abs(d.y - p.y) > 1.5) continue;
      if (p.weapons[WEAPONS[d.w].slot]) continue;
      this.takeDrop(p, d, false);
      return;
    }
  }

  // nhấn F: đổi súng đang có lấy súng dưới đất
  manualPickup(p, t) {
    if (!p.alive) return;
    let best = null, bd = 2.2;
    for (const d of this.drops.values()) {
      const dist = Math.hypot(d.x - p.x, d.z - p.z);
      if (dist < bd && Math.abs(d.y - p.y) < 1.5) { bd = dist; best = d; }
    }
    if (!best) return;
    const slot = WEAPONS[best.w].slot;
    const old = p.weapons[slot];
    if (old) this.dropWeapon(p, old, p.x, p.z, p.id);
    this.takeDrop(p, best, true);
  }

  // ================= Lựu đạn =================
  handleThrow(p, m, t) {
    const g = typeof m.k === 'string' && GRENADES[m.k];
    if (!g || !p.alive || (p.nades[m.k] | 0) <= 0) return;
    if (this.phase === 'freeze' || this.phase === 'matchEnd' || t - p.lastThrow < 0.6) return;
    if (!Array.isArray(m.o) || m.o.length !== 3 || !Array.isArray(m.v) || m.v.length !== 3) return;
    const o = m.o.map(Number).map(r3), v = m.v.map(Number).map(r3);
    if (![...o, ...v].every(Number.isFinite)) return;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 2 || Math.abs(o[1] - p.y - 1.3) > 1.5) return;
    const sp = Math.hypot(...v);
    if (sp > THROW_SPEED + 9) { const k = (THROW_SPEED + 9) / sp; v[0] *= k; v[1] *= k; v[2] *= k; }
    p.nades[m.k]--;
    p.lastThrow = t;
    p.protectUntil = 0;
    const n = { gid: this.nextGid++, k: m.k, by: p.id, sim: newNade(o, v), fuse: g.fuse, acc: 0 };
    this.nades.push(n);
    this.broadcast({ t: 'sgren', gid: n.gid, k: n.k, by: p.id, o, v });
    this.me(p);
  }

  updateNades(dt) {
    for (const n of this.nades) {
      n.acc += dt;
      while (n.acc >= NADE_STEP && n.sim.t < n.fuse) { n.acc -= NADE_STEP; stepNade(n.sim, this.map); }
      if (n.sim.t >= n.fuse - 1e-6) { n.done = true; this.detonate(n); }
    }
    this.nades = this.nades.filter(n => !n.done);
    const t = now();
    this.smokes = this.smokes.filter(s => s.until > t);
  }

  detonate(n) {
    const g = GRENADES[n.k];
    const pos = n.sim.p.map(r2);
    const src = this.players.get(n.by) || null;
    this.broadcast({ t: 'sgdet', gid: n.gid, k: n.k, pos });
    const center = [pos[0], pos[1] + 0.3, pos[2]];
    if (n.k === 'he') {
      for (const q of [...this.players.values()]) {
        if (!q.alive) continue;
        if (this.mode === 'bomb' && src && q.team === src.team && q !== src) continue;
        const chest = [q.x, q.y + 1.0, q.z];
        const d = Math.hypot(chest[0] - center[0], chest[1] - center[1], chest[2] - center[2]);
        if (d > g.radius || !lineOfSight(center, chest, this.map)) continue;
        let dmg = g.dmg * Math.pow(1 - d / g.radius, 1.2);
        if (q === src) dmg *= 0.5;
        if (dmg >= 1) this.damage(src, q, dmg, false, 'he');
      }
    } else if (n.k === 'flash') {
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        const eye = [q.x, q.y + 1.55, q.z];
        const dx = center[0] - eye[0], dy = center[1] - eye[1], dz = center[2] - eye[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > g.radius || !lineOfSight(center, eye, this.map)) continue;
        // hướng nhìn của người chơi
        const cp = Math.cos(q.pitch);
        const look = [-Math.sin(q.yaw) * cp, Math.sin(q.pitch), -Math.cos(q.yaw) * cp];
        const dot = (look[0] * dx + look[1] * dy + look[2] * dz) / Math.max(d, 0.01);
        const facing = dot > 0.5 ? 1 : dot > 0 ? 0.55 : 0.2;
        const dur = r2(g.blind * facing * Math.sqrt(1 - d / g.radius) + 0.2);
        this.send(q, { t: 'sflash', dur, pos });
      }
    } else if (n.k === 'smoke') {
      this.smokes.push({ pos, until: now() + g.time });
    }
  }

  // ================= Bom =================
  giveBomb(p) {
    this.bomb = { state: 'carried', carrier: p.id };
    this.broadcast(this.roundState());
    for (const q of this.players.values()) if (q.team === 'T') this.me(q);
    this.send(p, { t: 'smsg', msg: '💣 Bạn đang giữ bom — đến điểm A hoặc B, giữ E để cài', cls: 'bomb', dur: 3 });
  }

  dropBomb(p) {
    this.bomb = { state: 'dropped', pos: [r2(p.x), r2(p.y), r2(p.z)] };
    this.broadcast(this.roundState());
    this.me(p);
  }

  siteAt(x, z) {
    for (const [k, r] of Object.entries(this.map.sites)) if (inRect(r, x, z)) return k;
    return null;
  }

  handleUse(p, on, t) {
    if (!on) { if (this.using.has(p.id)) { this.using.delete(p.id); this.broadcast({ t: 'suse', id: p.id, kind: null }); } return; }
    if (!p.alive || this.mode !== 'bomb' || this.using.has(p.id)) return;
    const b = this.bomb;
    if (p.team === 'T' && this.phase === 'live' && b.state === 'carried' && b.carrier === p.id) {
      const site = this.siteAt(p.x, p.z);
      if (!site) return this.send(p, { t: 'smsg', msg: 'Phải đứng trong điểm A hoặc B để cài bom', cls: 'warn', dur: 1.5 });
      this.using.set(p.id, { kind: 'plant', start: t, dur: S.plantTime, x: p.x, z: p.z, site });
    } else if (p.team === 'CT' && this.phase === 'planted') {
      const [bx, by, bz] = b.pos;
      if (Math.hypot(p.x - bx, p.z - bz) > 2.2 || Math.abs(p.y - by) > 1.5) return;
      this.using.set(p.id, { kind: 'defuse', start: t, dur: p.kit ? S.defuseKitTime : S.defuseTime, x: p.x, z: p.z });
    } else return;
    const u = this.using.get(p.id);
    this.broadcast({ t: 'suse', id: p.id, kind: u.kind, dur: u.dur });
  }

  updateUsing(t) {
    for (const [id, u] of this.using) {
      const p = this.players.get(id);
      const cancel = () => { this.using.delete(id); this.broadcast({ t: 'suse', id, kind: null }); };
      if (!p || !p.alive) { cancel(); continue; }
      if (Math.hypot(p.x - u.x, p.z - u.z) > 0.8) { cancel(); continue; }
      if (u.kind === 'plant' && (this.phase !== 'live' || this.bomb.carrier !== id)) { cancel(); continue; }
      if (u.kind === 'defuse' && this.phase !== 'planted') { cancel(); continue; }
      if (t - u.start < u.dur) continue;
      this.using.delete(id);
      this.broadcast({ t: 'suse', id, kind: null });
      if (u.kind === 'plant') {
        this.bomb = { state: 'planted', pos: [r2(p.x), r2(p.y), r2(p.z)], site: u.site, explodeAt: t + S.bombTime, planter: id };
        p.money = Math.min(S.maxMoney, p.money + S.plantMoney);
        this.phase = 'planted';
        this.phaseEnd = t + S.bombTime;
        this.center(`💣 BOM ĐÃ ĐƯỢC CÀI TẠI ĐIỂM ${u.site}!`, 'bomb', 3);
        this.broadcast({ t: 'sbomb', ev: 'planted', pos: this.bomb.pos, site: u.site });
        this.me(p);
        this.broadcast(this.roundState());
      } else {
        this.bomb.state = 'defused';
        this.broadcast({ t: 'sbomb', ev: 'defused', pos: this.bomb.pos, by: id });
        this.endRound('CT', 'defuse');
      }
    }
  }

  // ================= Vòng đấu =================
  checkWarmup() {
    if (this.mode !== 'bomb' || this.phase !== 'warmup') return;
    const c = this.teamCounts();
    if (c.T > 0 && c.CT > 0) {
      if (!this.warmupEnd) {
        this.warmupEnd = now() + 6;
        this.center('Đủ người hai phe — trận đấu bắt đầu sau 6 giây!', '', 3);
      }
    } else this.warmupEnd = 0;
  }

  startMatch() {
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.round = 0;
    for (const p of this.players.values()) {
      p.money = S.startMoney; p.kills = 0; p.deaths = 0;
      p.weapons = { 1: null, 2: 'pistol', 3: 'knife' }; p.armor = 0; p.kit = false; p.alive = false; p.nades = NO_NADES();
    }
    this.clearDrops();
    this.newRound();
  }

  clearDrops() {
    for (const id of [...this.drops.keys()]) this.removeDrop(id);
  }

  newRound() {
    const t = now();
    this.round++;
    this.using.clear();
    this.phase = 'freeze';
    this.phaseEnd = t + S.freezeTime;
    this.buyEnd = t + S.buyTime;
    this.bomb = { state: 'none' };
    this.nades = [];
    this.smokes = [];
    for (const p of this.players.values()) {
      if (!p.team) continue;
      this.spawn(p, !p.alive);
    }
    const ts = [...this.players.values()].filter(p => p.team === 'T' && p.alive);
    if (ts.length) this.giveBomb(ts[Math.floor(Math.random() * ts.length)]);
    this.broadcast({ t: 'sround', round: this.round });
    this.center(`VÒNG ${this.round}`, 'round', 2.5);
    this.broadcast(this.roundState());
    this.roster();
  }

  checkWin() {
    if (this.mode !== 'bomb' || !['live', 'planted', 'freeze'].includes(this.phase)) return;
    const alive = { T: 0, CT: 0 }, total = this.teamCounts();
    for (const p of this.players.values()) if (p.alive && p.team) alive[p.team]++;
    if (total.T === 0 || total.CT === 0) {
      // một phe bỏ đi hết => về khởi động
      this.phase = 'warmup'; this.warmupEnd = 0; this.bomb = { state: 'none' };
      this.center('Một phe không còn người — quay về khởi động', '', 3);
      for (const p of this.players.values()) if (!p.alive) p.respawnAt = now() + 1;
      this.broadcast(this.roundState());
      return;
    }
    if (alive.CT === 0) return this.endRound('T', 'elim');
    if (alive.T === 0 && this.phase !== 'planted') return this.endRound('CT', 'elim');
  }

  endRound(winner, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    const loser = winner === 'T' ? 'CT' : 'T';
    this.score[winner]++;
    this.lossStreak[winner] = 0;
    const planted = !!this.bomb.planter;
    for (const p of this.players.values()) {
      if (!p.team) continue;
      let add;
      if (p.team === winner) add = reason === 'bomb' || reason === 'defuse' ? S.bombWinMoney : S.winMoney;
      else add = S.lossMoney + S.lossBonus * Math.min(4, this.lossStreak[loser]) + (p.team === 'T' && planted ? S.plantLossBonus : 0);
      p.money = Math.min(S.maxMoney, p.money + add);
      this.me(p);
    }
    this.lossStreak[loser]++;
    const reasons = { elim: 'Tiêu diệt toàn bộ đối thủ', bomb: 'Bom đã phát nổ', defuse: 'Bom đã được gỡ', time: 'Hết giờ' };
    this.phase = 'roundEnd';
    this.phaseEnd = now() + S.roundEndTime;
    this.using.clear();
    this.broadcast({ t: 'sround_end', winner, reason: reasons[reason], score: this.score });
    this.broadcast(this.roundState());
  }

  afterRoundEnd() {
    if (this.score.T >= S.winRounds || this.score.CT >= S.winRounds) {
      const w = this.score.T >= S.winRounds ? 'T' : 'CT';
      this.phase = 'matchEnd';
      this.phaseEnd = now() + 10;
      this.broadcast({ t: 'smatch_end', winner: w, score: this.score });
      this.broadcast(this.roundState());
      return;
    }
    if (this.round === S.halfRounds) {
      // đổi phe giữa trận
      for (const p of this.players.values()) {
        p.team = p.team === 'T' ? 'CT' : 'T';
        p.money = S.startMoney;
        p.weapons = { 1: null, 2: 'pistol', 3: 'knife' }; p.armor = 0; p.kit = false; p.alive = false; p.nades = NO_NADES();
      }
      this.clearDrops();
      this.score = { T: this.score.CT, CT: this.score.T };
      this.lossStreak = { T: 0, CT: 0 };
      this.center('ĐỔI PHE!', 'round', 3);
    }
    this.newRound();
  }

  endDM(winner) {
    if (this.phase === 'matchEnd') return;
    this.phase = 'matchEnd';
    this.phaseEnd = now() + 10;
    this.broadcast({ t: 'smatch_end', winnerName: winner?.name || '', winnerId: winner?.id || 0 });
    this.broadcast(this.roundState());
  }

  explodeBomb() {
    const [bx, by, bz] = this.bomb.pos;
    this.bomb.state = 'exploded';
    this.broadcast({ t: 'sbomb', ev: 'exploded', pos: this.bomb.pos });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - bx, p.y - by, p.z - bz);
      if (d < S.bombRadius) this.damage(null, p, S.bombDamage * Math.pow(1 - d / S.bombRadius, 1.4), false, null);
    }
    this.endRound('T', 'bomb');
  }

  // ================= Vòng lặp =================
  tick() {
    const t = now();
    const dt = Math.min(0.2, t - this.lastTick);
    this.lastTick = t;

    this.updateNades(dt);
    // sinh tử: súng rơi biến mất sau 25 giây
    if (this.mode === 'dm') for (const d of [...this.drops.values()]) if (t - d.at > 25) this.removeDrop(d.id);

    // nạp đạn xong
    for (const p of this.players.values()) {
      if (p.reloadUntil && t >= p.reloadUntil) {
        p.reloadUntil = 0;
        const w = WEAPONS[p.reloadW], a = p.ammo[p.reloadW];
        if (w && a) { const n = Math.min(w.mag - a.mag, a.res); a.mag += n; a.res -= n; }
        this.me(p);
      }
      // hồi sinh (sinh tử / khởi động)
      if (!p.alive && p.respawnAt && t >= p.respawnAt && (this.mode === 'dm' ? this.phase === 'live' : this.phase === 'warmup')) {
        p.respawnAt = 0;
        this.spawn(p, this.mode === 'bomb');
      }
    }

    this.updateUsing(t);

    switch (this.phase) {
      case 'warmup':
        if (this.warmupEnd && t >= this.warmupEnd) { this.warmupEnd = 0; this.startMatch(); }
        break;
      case 'freeze':
        if (t >= this.phaseEnd) { this.phase = 'live'; this.phaseEnd = t + S.roundTime; this.broadcast(this.roundState()); }
        break;
      case 'live':
        if (this.mode === 'dm') {
          if (t >= this.phaseEnd) {
            const top = [...this.players.values()].sort((a, b) => b.kills - a.kills)[0];
            this.endDM(top);
          }
        } else if (t >= this.phaseEnd) this.endRound('CT', 'time');
        break;
      case 'planted':
        if (t >= this.bomb.explodeAt) this.explodeBomb();
        break;
      case 'roundEnd':
        if (t >= this.phaseEnd) this.afterRoundEnd();
        break;
      case 'matchEnd':
        if (t >= this.phaseEnd) {
          if (this.mode === 'dm') {
            this.phase = 'live'; this.phaseEnd = t + S.dmTime;
            for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; this.spawn(p, true); }
            this.center('TRẬN MỚI BẮT ĐẦU!', 'round', 2.5);
            this.roster();
            this.broadcast(this.roundState());
          } else this.startMatch();
        }
        break;
    }

    this.rsAcc += dt;
    if (this.rsAcc >= 1) { this.rsAcc = 0; this.broadcast(this.roundState()); }

    if (this.snapT.due(dt)) {
      const ps = [];
      for (const p of this.players.values()) {
        let f = p.flags & 0b10001111;  // crouch, run, walk, air, scoped(128)
        if (!p.alive) f |= 16;
        if (this.bomb.state === 'carried' && this.bomb.carrier === p.id) f |= 32;
        if (this.using.has(p.id)) f |= 64;
        ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), f, weaponIndex(p.weapons[p.cur] || 'knife')]);
      }
      this.broadcast({ t: 'ss', ps });
    }
  }
}

export { WEAPON_LIST };
