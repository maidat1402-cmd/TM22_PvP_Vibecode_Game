// Chế độ BẮN SÚNG phía client: góc nhìn thứ nhất, nhân vật chibi cầm súng.
import * as THREE from 'three';
import { NET, Ticker } from '/shared/config.js';
import { getMap, PLAYER, moveAndCollide, rayMap, rayPlayer, inRect, newNade, stepNade, NADE_STEP } from '/shared/maps.js';
import { WEAPONS, WEAPON_LIST, BUY_MENU, GRENADES, NADE_LIST, THROW_SPEED, itemInfo, TEAMS, SHOOTER as S, moveSpeedFor, shotSpread } from '/shared/weapons.js';
import { buildChibi, ANIM } from '../chibi.js';
import { FX } from '../effects.js';
import { buildMapView } from './mapview.js';
import { buildGun, buildViewModel, buildBomb, buildNade } from './guns.js';
import { $, esc, lockPointer } from '../ui.js';
import { sfx } from '../audio.js';

const now = () => performance.now() / 1000;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const INTERP = NET.interp;

// Ngoại hình chibi theo phe (4 biến thể mỗi phe)
const HAIR = [[0x222222, 'spiky'], [0xd62828, 'ponytail'], [0x6a4c93, 'long'], [0xffb703, 'superSpiky']];
function teamLook(team, idx) {
  const [hair, hairStyle] = HAIR[idx % 4];
  return team === 'T'
    ? { skin: 0xffdfc4, hair, hairStyle, eye: 0x8a1c1c, outfit: 0x3d2c2e, outfit2: 0xe76f51, accessory: 'scarf', accColor: 0xe63946, weapon: 'none', headband: idx % 2 ? 0x555555 : undefined }
    : { skin: 0xffe8d6, hair, hairStyle, eye: 0x1d4e89, outfit: 0x1d3557, outfit2: 0xa8dadc, accessory: 'belt', accColor: 0xf1faee, weapon: 'none', headband: idx % 2 ? 0x9aa7b8 : undefined };
}

// ======================= Người chơi khác =======================
class SAvatar {
  constructor(game, d) {
    this.game = game;
    this.id = d.id;
    this.name = d.name;
    this.pos = v3(d.x || 0, d.y || 0, d.z || 0);
    this.yaw = 0; this.pitch = 0; this.flags = 0; this.w = 0;
    this.buf = [];
    this.alive = d.alive; this.kills = d.kills; this.deaths = d.deaths;
    this.stepAcc = 0;
    this.setTeam(d.team, d.look);
  }

  setTeam(team, look) {
    if (this.team === team && this.model) return;
    this.team = team; this.look = look ?? this.look ?? 0;
    this.dispose();
    this.model = buildChibi(teamLook(this.game.mode === 'dm' ? (this.id % 2 ? 'T' : 'CT') : team, this.look));
    this.game.scene.add(this.model.root, this.model.rig.shadow);
    this.gunId = null;
    this.setWeapon(this.w);
    this.bombMesh = buildBomb();
    this.bombMesh.scale.setScalar(0.8);
    this.bombMesh.position.set(0, 0.55, -0.32);
    this.bombMesh.visible = false;
    this.model.rig.body.add(this.bombMesh);
  }

  setWeapon(idx) {
    const id = WEAPON_LIST[idx] || 'knife';
    if (id === this.gunId) return;
    this.gunId = id;
    if (this.gun) this.gun.removeFromParent();
    this.gun = buildGun(id);
    this.gun.scale.setScalar(1.6);
    this.gun.rotation.x = -Math.PI / 2;
    this.gun.position.set(0, -0.05, 0);
    this.model.rig.handR.add(this.gun);
  }

  dispose() {
    if (!this.model) return;
    this.model.root.removeFromParent();
    this.model.rig.shadow.removeFromParent();
  }

  pushSnap(x, y, z, yaw, pitch) {
    this.buf.push({ t: now(), x, y, z, yaw, pitch });
    if (this.buf.length > 30) this.buf.shift();
  }

  interpolate(dt) {
    const rt = now() - INTERP, b = this.buf;
    if (!b.length) return;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const s1 = b[i], s0 = b[Math.max(0, i - 1)];
    const k = s1.t === s0.t ? 1 : clamp((rt - s0.t) / (s1.t - s0.t), 0, 1.15);
    const px = this.pos.x, pz = this.pos.z;
    this.pos.set(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k, s0.z + (s1.z - s0.z) * k);
    let dy = s1.yaw - s0.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = s0.yaw + dy * Math.min(1, k);
    this.pitch = s0.pitch + (s1.pitch - s0.pitch) * Math.min(1, k);
    this.speed = Math.hypot(this.pos.x - px, this.pos.z - pz) / Math.max(dt, 1e-3);
  }

  render(dt) {
    const m = this.model, f = this.flags;
    const crouch = !!(f & 1);
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw + Math.PI;   // nhân vật nhìn +Z, camera nhìn -Z
    let st = ANIM.idle;
    if (!this.alive) st = ANIM.dead;
    else if (f & 8) st = ANIM.air;
    else if ((this.speed || 0) > 0.8) st = ANIM.run;
    m.update(dt, st, this.speed || 0);
    const r = m.rig;
    if (this.alive) {
      // tư thế cầm súng: tay hướng theo góc ngắm
      const aim = -1.45 - this.pitch * 0.9;
      const melee = this.gunId === 'knife';
      r.armR.rotation.set(melee ? -0.9 : aim, 0, 0.05);
      r.armL.rotation.set(melee ? -0.2 : aim + 0.15, 0, melee ? 0.2 : -0.55);
      r.head.rotation.x = -this.pitch * 0.4;
      if (crouch) {
        r.body.position.y -= 0.32;
        r.legR.rotation.x = -1.1; r.legL.rotation.x = -0.3;
      }
    }
    this.gun.visible = this.alive;
    this.bombMesh.visible = this.alive && !!(f & 32);
    r.shadow.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
    r.shadow.visible = this.alive;
  }
}

// ======================= Game =======================
export class ShooterGame {
  constructor(net, settings, renderer, hud) {
    this.net = net;
    this.settings = settings;
    this.renderer = renderer;
    this.hud = hud;              // HUD dùng chung (toast, số sát thương...)
    this.active = false;
    this.touch = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 500);
    this.camera.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene();
    this.vmCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x887799, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5);
    dl.position.set(1, 2, 1);
    this.vmScene.add(dl);
    this.map = null;
    this.view = null;
    this.nadeObjs = new Map();   // gid -> lựu đạn đang bay
    this.drops = new Map();      // id -> súng rơi trên đất
    this.smokes = [];
    this.blindUntil = 0; this.blindDur = 1;
    this.fx = new FX(this.scene, this.camera);
    this.fx.warmup(renderer);
    this.avatars = new Map();
    this.keys = new Set();
    this.decals = [];
    this.tracers = [];
    this.rs = null; this.rsAt = 0;
    this.bombObj = buildBomb();
    this.bombObj.visible = false;
    this.scene.add(this.bombObj);
    this.lastT = now();
    this.fpsAcc = 0; this.fpsN = 0;
    addEventListener('resize', () => this.resize());
    this.bindNet();
    this.bindInput();
    this.buildBuyMenu();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    this.camera.aspect = this.vmCam.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.vmCam.updateProjectionMatrix();
  }

  get myTeam() { return this.me?.team; }
  enemyOf(av) { return this.mode === 'dm' ? true : av.team !== this.myTeam; }
  curW() { return this.P?.weapons?.[this.P.cur] || 'knife'; }

  // ======================= Vào / rời =======================
  enter(m) {
    this.clear();
    this.active = true;
    this.mode = m.mode;
    // dựng map (chỉ dựng lại khi đổi map)
    const map = getMap(m.map);
    if (this.map !== map) {
      this.view?.dispose();
      this.map = map;
      this.view = buildMapView(this.scene, map);
    }
    for (const d of m.drops || []) this.addDrop(d);
    for (const s of m.smokes || []) this.addSmoke(s.pos, s.left, true);
    this.myId = m.you;
    this.roomId = m.room.id;
    this.roomName = m.room.name;
    for (const p of m.players) this.avatars.set(p.id, new SAvatar(this, p));
    this.me = this.avatars.get(this.myId);
    this.me.model.root.visible = false;     // không thấy chính mình ở góc nhìn thứ nhất
    this.me.model.rig.shadow.visible = false;
    this.P = {
      pos: this.me.pos.clone(), vel: v3(), grounded: true, crouch: false, crouchK: 0,
      yaw: 0, pitch: 0, alive: false, hp: 100, armor: 0, money: 0, weapons: { 1: null, 2: 'pistol', 3: 'knife' },
      ammo: {}, cur: 2, prev: 3, reloadUntil: 0, drawUntil: 0, nextFire: 0, punch: 0, punchYaw: 0, lastShot: 0,
      scoped: false, kit: false, bomb: false, trigger: false, fresh: true, stepAcc: 0, team: this.me.team,
      nades: { he: 0, flash: 0, smoke: 0 }, nadeSel: null, nextThrow: 0,
    };
    this.renderer.setClearColor(0x000000);
    $('shud').hidden = false;
    $('sRoom').textContent = `${m.room.name} · ${this.mode === 'dm' ? 'Sinh tử' : 'Đặt bom'} · ${this.map.name}`;
    $('sChatlog').innerHTML = '';
    $('sFeed').innerHTML = '';
    this.setViewModel();
    this.setupTouch();
    this.resize();
  }

  leave() {
    this.active = false;
    this.clear();
    $('shud').hidden = true;
    $('sBuy').hidden = true;
    $('sScore').hidden = true;
    $('sScope').hidden = true;
    document.exitPointerLock?.();
  }

  clear() {
    for (const a of this.avatars.values()) { a.dispose(); this.hud.removePlate('s' + a.id); }
    this.avatars.clear();
    for (const d of this.decals) d.removeFromParent();
    this.decals.length = 0;
    for (const t of this.tracers) t.mesh.removeFromParent();
    this.tracers.length = 0;
    for (const n of this.nadeObjs.values()) n.mesh.removeFromParent();
    this.nadeObjs.clear();
    for (const d of this.drops.values()) d.mesh.removeFromParent();
    this.drops.clear();
    this.clearSmokes();
    this.blindUntil = 0;
    $('sFlash').style.opacity = 0;
    this.me = null;
    this.bombObj.visible = false;
    if (this.vm) { this.vm.removeFromParent(); this.vm = null; }
  }

  // ======================= Mạng =======================
  bindNet() {
    const n = this.net;
    const on = (t, fn) => n.on(t, m => { if (this.active) fn(m); });
    on('sroster', m => {
      const seen = new Set();
      for (const p of m.list) {
        seen.add(p.id);
        let a = this.avatars.get(p.id);
        if (!a) { a = new SAvatar(this, p); this.avatars.set(p.id, a); }
        a.name = p.name; a.kills = p.kills; a.deaths = p.deaths;
        if (a !== this.me || !a.alive) a.alive = p.alive;
        if (a.team !== p.team) {
          a.setTeam(p.team, p.look);
          if (a === this.me) { a.model.root.visible = false; this.P.team = p.team; this.setViewModel(); }
        }
      }
      for (const id of [...this.avatars.keys()]) if (!seen.has(id)) this.removeAvatar(id);
    });
    on('sleave', m => this.removeAvatar(m.id));
    on('ss', m => {
      for (const [id, x, y, z, yaw, pitch, f, w] of m.ps) {
        const a = this.avatars.get(id);
        if (!a || a === this.me) continue;
        a.pushSnap(x, y, z, yaw, pitch);
        a.flags = f; a.alive = !(f & 16);
        if (a.w !== w) { a.w = w; a.setWeapon(w); }
      }
    });
    on('sme', m => this.onMe(m));
    on('sme2', m => { this.P.hp = m.hp; this.P.armor = m.armor; });
    on('srs', m => { this.rs = m; this.rsAt = now(); this.updateBombObj(); });
    on('sspawn', m => this.onSpawn(m));
    on('sshot', m => this.onRemoteShot(m));
    on('shit', m => this.onHit(m));
    on('sdie', m => this.onDie(m));
    on('suse', m => {
      if (m.id === this.myId) {
        this.useProg = m.kind ? { kind: m.kind, start: now(), dur: m.dur } : null;
        if (m.kind === 'plant') sfx('plant');
      }
    });
    on('sbomb', m => {
      const p = v3(...m.pos);
      if (m.ev === 'planted') { sfx('plant', this.dist(p)); this.beepT = 0; }
      if (m.ev === 'defused') { sfx('respawn'); this.fx.shockwave(p, 0x4895ef, 4); }
      if (m.ev === 'exploded') {
        this.fx.explosion(p.clone().setY(1.5), 0xff7b00, 9, 0xfff3b0);
        this.fx.explosion(p.clone().setY(4), 0xff4800, 6);
        this.fx.shake(1.2);
        sfx('explosion'); sfx('explosion', 5);
      }
    });
    on('sround', () => {
      for (const d of this.decals) d.removeFromParent();
      this.decals.length = 0;
      this.clearSmokes();
      for (const n of this.nadeObjs.values()) n.mesh.removeFromParent();
      this.nadeObjs.clear();
      sfx('respawn');
    });
    // ---- lựu đạn ----
    on('sgren', m => {
      const mesh = buildNade(m.k);
      mesh.scale.setScalar(1.6);
      this.scene.add(mesh);
      this.nadeObjs.set(m.gid, { k: m.k, sim: newNade(m.o, m.v), acc: 0, mesh, fuse: GRENADES[m.k].fuse });
      if (m.by !== this.myId) sfx('toss', this.dist(v3(...m.o)));
    });
    on('sgdet', m => this.detonate(m));
    on('sflash', m => {
      this.blindUntil = now() + m.dur;
      this.blindDur = m.dur;
      if (m.dur > 0.8) sfx('flashbang');
    });
    // ---- súng rơi ----
    on('sdrop', m => {
      if (m.add) this.addDrop(m.add);
      if (m.rem) { const d = this.drops.get(m.rem); if (d) { d.mesh.removeFromParent(); this.drops.delete(m.rem); } }
    });
    on('sround_end', m => {
      const T = TEAMS[m.winner];
      this.banner(`${T.name.toUpperCase()} THẮNG!`, m.reason, T.css, 4);
      sfx(m.winner === this.myTeam ? 'respawn' : 'die');
    });
    on('smatch_end', m => {
      if (this.mode === 'dm') this.banner('KẾT THÚC TRẬN', `🏆 ${m.winnerName || '—'} thắng!`, '#ffd166', 8);
      else this.banner(`${TEAMS[m.winner].name.toUpperCase()} THẮNG TRẬN!`, `${m.score.T} - ${m.score.CT}`, TEAMS[m.winner].css, 8);
    });
    on('smsg', m => this.centerMsg(m.msg, m.cls, m.dur));
    on('schat', m => this.chatLine(`<b style="color:${this.mode === 'dm' ? '#fff' : TEAMS[m.team]?.css}">${esc(m.name)}:</b> ${esc(m.msg)}`));
    on('ssys', m => this.chatLine(`<i>${esc(m.msg)}</i>`));
  }

  removeAvatar(id) {
    const a = this.avatars.get(id);
    if (a) { a.dispose(); this.avatars.delete(id); this.hud.removePlate('s' + id); }
  }

  onMe(m) {
    const P = this.P;
    const oldW = P.weapons[P.cur];
    P.money = m.money; P.armor = m.armor; P.kit = m.kit; P.bomb = m.bomb; P.hp = m.hp;
    P.loadout = m.loadout;
    if (m.team && m.team !== P.team) P.team = m.team;
    P.weapons = m.weapons;
    if (m.nades) {
      P.nades = m.nades;
      if (P.cur === 4 && !(P.nades[P.nadeSel] > 0)) this.afterNadeGone();
    }
    for (const [w, a] of Object.entries(m.ammo)) {
      const loc = P.ammo[w];
      // đạn: tin server nếu dự trữ thay đổi (nạp/mua), còn không lấy giá trị nhỏ hơn (tránh nhảy số khi đang xả đạn)
      if (!loc || loc.res !== a.res) P.ammo[w] = { ...a };
      else loc.mag = Math.min(loc.mag, a.mag);
    }
    if ((P.cur !== 4 && !P.weapons[P.cur]) || this.takeCur) { P.cur = m.cur; this.takeCur = false; }
    if (P.weapons[P.cur] !== oldW) this.setViewModel();
    if (!m.alive && P.alive) P.alive = false;
    this.refreshBuyMenu();
  }

  onSpawn(m) {
    const a = this.avatars.get(m.id);
    if (!a) return;
    a.pos.set(...m.p);
    a.buf.length = 0;
    a.pushSnap(m.p[0], m.p[1], m.p[2], m.yaw, 0);
    a.alive = true;
    if (m.id === this.myId) {
      const P = this.P;
      P.pos.set(...m.p); P.vel.set(0, 0, 0);
      P.yaw = m.yaw; P.pitch = 0; P.alive = true; P.hp = 100;
      P.scoped = false; P.reloadUntil = 0; P.punch = 0;
      P.drawUntil = now() + 0.4;
      this.takeCur = true;   // 'sme' ngay sau sẽ cho biết súng đang cầm
      this.spec = null;
      $('sSpec').hidden = true;
      this.setViewModel();
    }
  }

  onHit(m) {
    const tgt = this.avatars.get(m.tid);
    if (tgt) tgt.model.hitFlash();
    if (m.sid === this.myId && m.tid !== this.myId) {
      sfx(m.head ? 'headshot' : 'hitmark');
      const hm = $('sHitmark');
      hm.className = m.head ? 'head' : '';
      void hm.offsetWidth; hm.classList.add('on');
    }
    if (m.tid === this.myId) {
      this.P.hp = m.hp;
      this.fx.shake(0.12);
      $('hurt').classList.remove('on'); void $('hurt').offsetWidth; $('hurt').classList.add('on');
      this.P.punch += 0.02;    // bị bắn => tâm bị giật nhẹ
      if (m.from) {
        // chỉ hướng bị bắn
        const ang = Math.atan2(m.from[0] - this.P.pos.x, m.from[1] - this.P.pos.z);
        const rel = ang - (this.P.yaw + Math.PI);
        const el = $('sDmgDir');
        el.style.transform = `translate(-50%,-50%) rotate(${-rel}rad)`;
        el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
      }
    }
  }

  onDie(m) {
    const v = this.avatars.get(m.id), k = this.avatars.get(m.by);
    if (v) { v.alive = false; v.model.hitFlash(); }
    const wname = m.w >= 0 ? WEAPONS[WEAPON_LIST[m.w]].name : m.w === -2 ? '💥 Lựu đạn' : '💣 Bom';
    const col = a => this.mode === 'dm' ? '#fff' : TEAMS[a?.team]?.css || '#fff';
    const d = document.createElement('div');
    d.className = 'kf' + (m.by === this.myId || m.id === this.myId ? ' mine' : '');
    d.innerHTML = (k && k !== v ? `<b style="color:${col(k)}">${esc(k.name)}</b> ` : '') +
      `<span class="w">[${esc(wname)}]${m.head ? ' 🎯' : ''}</span> <b style="color:${col(v)}">${esc(v?.name || '?')}</b>`;
    $('sFeed').prepend(d);
    while ($('sFeed').children.length > 6) $('sFeed').lastChild.remove();
    setTimeout(() => d.remove(), 7000);
    if (v) this.fx.parts.burst(v3(v.pos.x, v.pos.y + 1, v.pos.z), 20, 0xffffff, { speed: 4, size: 0.3, life: 0.8, up: 1 });
    if (m.id === this.myId) {
      this.P.alive = false;
      this.P.scoped = false;
      this.killer = k && k !== v ? k : null;
      this.deathAt = now();
      this.centerMsg(this.killer ? `Bạn bị hạ bởi ${this.killer.name}${m.head ? ' (headshot)' : ''}` : 'Bạn đã gục', 'warn', 3);
      sfx('die');
    } else if (m.by === this.myId) {
      this.hud.toast(m.head ? `🎯 Headshot ${v?.name}!` : `Hạ gục ${v?.name}`, 1400);
    }
  }

  onRemoteShot(m) {
    const a = this.avatars.get(m.id);
    if (!a) return;
    const w = WEAPONS[WEAPON_LIST[m.w]];
    const yaw = a.yaw;
    const o = v3(a.pos.x - Math.sin(yaw) * 0.6, a.pos.y + ((a.flags & 1) ? 0.8 : 1.15), a.pos.z - Math.cos(yaw) * 0.6);
    for (const e of m.e) {
      const end = v3(...e);
      if (!w.melee) this.tracer(o, end, 0xfff1a8);
      this.impact(end, null, false);
    }
    if (!w.melee) this.fx.flash(o, 0xffc46b, 8, 0.06);
    sfx(w.sound, this.dist(o));
  }

  dist(p) { return this.camera.position.distanceTo(p); }

  // ======================= Input =======================
  bindInput() {
    const canvas = $('game');
    canvas.addEventListener('click', () => {
      if (!this.active || this.touch?.enabled) return;
      if (document.pointerLockElement !== canvas && $('sBuy').hidden && !this.chatting) lockPointer();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.active) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked) { this.P && (this.P.trigger = false); this.keys.clear(); }
      if (!locked && $('sBuy').hidden && !this.chatting && !this.touch?.enabled) this.onUnlock?.();
      $('clickToPlay').hidden = locked || this.touch?.enabled || !$('sBuy').hidden;
    });
    addEventListener('mousemove', e => {
      if (!this.active || document.pointerLockElement !== canvas) return;
      const sc = this.P.scoped ? 0.35 : 1;
      const s = 0.0022 * this.settings.sens * sc;
      this.look(e.movementX * s, e.movementY * s);
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.active || document.pointerLockElement !== canvas) return;
      if (e.button === 0) {
        if (!this.P.alive) return this.cycleSpec();
        this.P.trigger = true; this.P.fresh = true;
      }
      if (e.button === 2) this.toggleScope();
    });
    addEventListener('mouseup', e => { if (e.button === 0 && this.P) this.P.trigger = false; });
    addEventListener('wheel', e => {
      if (!this.active || document.pointerLockElement !== canvas) return;
      this.cycleWeapon(Math.sign(e.deltaY));
    }, { passive: true });

    addEventListener('keydown', e => {
      if (!this.active) return;
      if (this.chatting) {
        if (e.key === 'Enter') { const v = $('sChatInput').value.trim(); if (v) this.net.send({ t: 'chat', msg: v }); this.closeChat(); }
        else if (e.key === 'Escape') this.closeChat();
        return;
      }
      if (e.code === 'Tab') { e.preventDefault(); $('sScore').hidden = false; this.renderScore(); return; }
      if (e.key === 'Enter') { e.preventDefault(); this.openChat(); return; }
      if (e.code === 'KeyB') { this.toggleBuy(); return; }
      if (e.code === 'Escape' && !$('sBuy').hidden) { this.toggleBuy(false); return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'Digit1': this.switchTo(1); break;
        case 'Digit2': this.switchTo(2); break;
        case 'Digit3': this.switchTo(3); break;
        case 'Digit4': this.selectNade(); break;
        case 'KeyG': this.dropCurrent(); break;
        case 'KeyF': this.pickup(); break;
        case 'KeyQ': if (this.P.prev === 4) this.selectNade(); else this.switchTo(this.P.prev); break;
        case 'KeyR': this.reload(); break;
        case 'KeyE': this.use(true); break;
        case 'Space': this.jumpPressed = true; e.preventDefault(); break;
      }
    });
    addEventListener('keyup', e => {
      if (!this.active) return;
      this.keys.delete(e.code);
      if (e.code === 'Tab') $('sScore').hidden = true;
      if (e.code === 'KeyE') this.use(false);
    });
    addEventListener('blur', () => { this.keys.clear(); if (this.P) this.P.trigger = false; });
  }

  look(dx, dy) {
    const P = this.P;
    P.yaw -= dx;
    P.pitch = clamp(P.pitch - dy * (this.settings.invertY ? -1 : 1), -1.45, 1.45);
  }

  openChat() {
    this.chatting = true;
    this.keys.clear();
    $('sChatInput').hidden = false;
    $('sChatInput').value = '';
    document.exitPointerLock?.();
    setTimeout(() => $('sChatInput').focus(), 0);
  }
  closeChat() {
    this.chatting = false;
    $('sChatInput').hidden = true;
    $('sChatInput').blur();
    if (!this.touch?.enabled) lockPointer();
  }
  chatLine(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    $('sChatlog').appendChild(d);
    while ($('sChatlog').children.length > 30) $('sChatlog').firstChild.remove();
    $('sChatlog').scrollTop = 1e6;
    d.classList.add('new');
    setTimeout(() => d.classList.remove('new'), 8000);
  }

  // ======================= Vũ khí =======================
  setViewModel() {
    if (this.vm) this.vm.removeFromParent();
    const id = this.curW();
    const team = this.mode === 'dm' ? 'T' : this.P?.team || 'T';
    if (this.P?.cur === 4 && this.P.nadeSel) {
      // cầm lựu đạn
      this.vm = buildNade(this.P.nadeSel, true);
      this.vm.scale.setScalar(0.75);
      this.vmBase = v3(0.2, -0.19, -0.45);
      this.vm.position.copy(this.vmBase);
      this.vmScene.add(this.vm);
      this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
      this.flash.visible = false;
      this.updateWeaponHud();
      return;
    }
    this.vm = buildViewModel(id, 0xffe0c4, team === 'T' ? 0x3d2c2e : 0x1d3557);
    this.vmBase = id === 'knife' ? v3(0.2, -0.2, -0.4) : ['pistol', 'eagle'].includes(id) ? v3(0.16, -0.16, -0.42) : v3(0.15, -0.16, -0.4);
    this.vm.scale.setScalar(0.62);
    this.vm.position.copy(this.vmBase);
    this.vmScene.add(this.vm);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      map: this.fx.list.length >= 0 ? flashTex() : null }));
    this.flash.scale.setScalar(0.18);
    this.flash.visible = false;
    this.flash.position.copy(this.vm.userData.muzzle);
    this.vm.add(this.flash);
    this.updateWeaponHud();
  }

  switchTo(slot) {
    const P = this.P;
    if (!P.alive || !P.weapons[slot] || slot === P.cur) return;
    P.prev = P.cur;
    P.cur = slot;
    P.reloadUntil = 0;
    P.scoped = false;
    P.drawUntil = now() + (slot === 3 ? 0.3 : 0.5);
    this.net.send({ t: 'switch', slot });
    this.setViewModel();
  }

  // ======================= Lựu đạn =======================
  availableNades() { return NADE_LIST.filter(k => (this.P.nades[k] | 0) > 0); }

  selectNade() {
    const P = this.P;
    if (!P.alive) return;
    const av = this.availableNades();
    if (!av.length) return this.centerMsg('Không có lựu đạn — mua bằng phím B', 'warn', 1.5);
    if (P.cur !== 4) {
      P.prev = P.cur;
      P.cur = 4;
      if (!av.includes(P.nadeSel)) P.nadeSel = av[0];
    } else {
      P.nadeSel = av[(av.indexOf(P.nadeSel) + 1) % av.length];   // bấm tiếp để đổi loại
    }
    P.scoped = false; P.reloadUntil = 0;
    P.drawUntil = now() + 0.3;
    this.setViewModel();
  }

  afterNadeGone() {
    const P = this.P;
    const av = this.availableNades();
    if (av.length) P.nadeSel = av.includes(P.nadeSel) ? P.nadeSel : av[0];
    else { P.cur = P.weapons[P.prev] && P.prev !== 4 ? P.prev : (P.weapons[1] ? 1 : P.weapons[2] ? 2 : 3); }
    this.setViewModel();
  }

  throwNade() {
    const P = this.P, t = now(), k = P.nadeSel;
    if (!k || !(P.nades[k] > 0) || t < P.nextThrow) return;
    P.nextThrow = t + 0.8;
    // ném hơi chếch lên + cộng vận tốc chạy
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(P.pitch + 0.12, P.yaw, 0, 'YXZ'));
    const eye = this.eyePos();
    const r3 = v => Math.round(v * 1000) / 1000;
    const o = [eye.x + dir.x * 0.4, eye.y + dir.y * 0.4, eye.z + dir.z * 0.4].map(r3);
    const v = [dir.x * THROW_SPEED + P.vel.x * 0.6, dir.y * THROW_SPEED + Math.max(0, P.vel.y) * 0.5, dir.z * THROW_SPEED + P.vel.z * 0.6].map(r3);
    this.net.send({ t: 'throw', k, o, v });
    P.nades[k]--;
    this.vmSwing = 1;
    sfx('toss');
    setTimeout(() => { if (this.P.cur === 4 && !(this.P.nades[this.P.nadeSel] > 0)) this.afterNadeGone(); }, 300);
  }

  detonate(m) {
    const n = this.nadeObjs.get(m.gid);
    if (n) { n.mesh.removeFromParent(); this.nadeObjs.delete(m.gid); }
    const p = v3(...m.pos);
    const dist = this.dist(p);
    if (m.k === 'he') {
      this.fx.explosion(p.clone().setY(p.y + 0.6), 0xff7b00, 3.2, 0xfff3b0);
      this.fx.parts.burst(p, 30, 0x5c4a3a, { speed: 8, size: 0.35, life: 1, up: 1, grav: 12 });
      this.fx.shake(Math.max(0, 0.9 - dist / 25));
      sfx('explosion', dist);
    } else if (m.k === 'flash') {
      this.fx.flash(p.clone().setY(p.y + 0.5), 0xffffff, 120, 0.25);
      this.fx.parts.burst(p, 20, 0xffffff, { speed: 6, size: 0.25, life: 0.35 });
      sfx('clink', dist);
    } else if (m.k === 'smoke') {
      this.addSmoke(m.pos, GRENADES.smoke.time);
      sfx('smokepop', dist);
    }
  }

  updateNades(dt) {
    for (const n of this.nadeObjs.values()) {
      n.acc += dt;
      while (n.acc >= NADE_STEP && n.sim.t < n.fuse + 0.3) {
        n.acc -= NADE_STEP;
        if (stepNade(n.sim, this.map) && n.sim.bounces < 6) sfx('clink', this.dist(v3(...n.sim.p)) + 4);
      }
      n.mesh.position.set(n.sim.p[0], n.sim.p[1] + 0.05, n.sim.p[2]);
      if (!n.sim.rest) { n.mesh.rotation.x += dt * 12; n.mesh.rotation.z += dt * 7; }
      if (Math.random() < 0.4) this.fx.parts.emit(n.mesh.position.x, n.mesh.position.y, n.mesh.position.z, 0, 0.3, 0, 0xdddddd, 0.12, 0.3, { drag: 2 });
    }
  }

  // ---------- Khói ----------
  addSmoke(pos, left, instant = false) {
    const g = GRENADES.smoke;
    const grp = new THREE.Group();
    grp.position.set(pos[0], pos[1], pos[2]);
    const tint = this.map?.theme === 'snow' ? 0xe6ebf2 : 0xc9c4bc;
    const mat = new THREE.SpriteMaterial({ map: smokeTex(), color: tint, transparent: true, opacity: 0, depthWrite: false });
    const puffs = [];
    for (let i = 0; i < 34; i++) {
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * g.radius * 0.85;
      s.userData.target = v3(Math.cos(a) * r, 0.5 + Math.random() * 3.0 * (1 - r / g.radius * 0.5), Math.sin(a) * r);
      s.userData.size = 2.4 + Math.random() * 1.8;
      s.position.set(0, 0.3, 0);
      s.scale.setScalar(0.5);
      grp.add(s);
      puffs.push(s);
    }
    this.scene.add(grp);
    this.smokes.push({ grp, mat, puffs, pos: v3(...pos), born: now() - (instant ? 2 : 0), end: now() + left, radius: g.radius });
  }

  clearSmokes() {
    for (const s of this.smokes) { s.grp.removeFromParent(); s.mat.dispose(); }
    this.smokes.length = 0;
  }

  updateSmokes(dt) {
    const t = now();
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      const grow = Math.min(1, (t - s.born) / 1.6);
      const fade = Math.min(1, (s.end - t) / 2);
      s.mat.opacity = Math.max(0, Math.min(grow * 1.4, 0.92) * fade);
      s.alpha = s.mat.opacity;
      for (const p of s.puffs) {
        p.position.lerp(p.userData.target, Math.min(1, dt * 2.5));
        p.scale.setScalar(p.userData.size * (0.4 + grow * 0.6) * (1 + (1 - fade) * 0.3));
      }
      s.grp.rotation.y += dt * 0.05;
      if (t > s.end) { s.grp.removeFromParent(); s.mat.dispose(); this.smokes.splice(i, 1); }
    }
  }

  // Tia nhìn có bị khói che không (dùng cho hiện tên địch)
  smokeBlocks(o, d, maxT) {
    for (const s of this.smokes) {
      if ((s.alpha || 0) < 0.5) continue;
      const cx = s.pos.x - o[0], cy = s.pos.y + 1.5 - o[1], cz = s.pos.z - o[2];
      const tt = cx * d[0] + cy * d[1] + cz * d[2];
      if (tt < 0 || tt > maxT + s.radius) continue;
      const px = cx - d[0] * tt, py = cy - d[1] * tt, pz = cz - d[2] * tt;
      if (Math.hypot(px, py, pz) < s.radius * 0.8) return true;
    }
    return false;
  }

  // ======================= Súng rơi =======================
  addDrop(d) {
    if (this.drops.has(d.id)) return;
    const mesh = buildGun(d.w);
    mesh.scale.setScalar(1.5);
    mesh.position.set(d.pos[0], d.pos[1] + 0.07, d.pos[2]);
    mesh.rotation.set(0, d.rot, Math.PI / 2 * 0.95);
    this.scene.add(mesh);
    this.drops.set(d.id, { ...d, mesh });
  }

  nearestDrop() {
    const P = this.P;
    let best = null, bd = 2.2;
    for (const d of this.drops.values()) {
      const dist = Math.hypot(d.pos[0] - P.pos.x, d.pos[2] - P.pos.z);
      if (dist < bd && Math.abs(d.pos[1] - P.pos.y) < 1.5) { bd = dist; best = d; }
    }
    return best;
  }

  pickup() {
    if (!this.P.alive || !this.nearestDrop()) return;
    this.takeCur = true;
    this.net.send({ t: 'pickup' });
    sfx('pickup');
  }

  dropCurrent() {
    const P = this.P;
    if (!P.alive || P.cur === 3 || P.cur === 4 || !P.weapons[P.cur]) return;
    this.takeCur = true;
    this.net.send({ t: 'drop' });
    sfx('toss');
  }

  cycleWeapon(dir) {
    const order = [1, 2, 3].filter(s => this.P.weapons[s]);
    let i = order.indexOf(this.P.cur);
    i = (i + dir + order.length) % order.length;
    this.switchTo(order[i]);
  }

  toggleScope() {
    const w = WEAPONS[this.curW()];
    if (!w.scope || !this.P.alive) return;
    this.P.scoped = !this.P.scoped;
    sfx('empty');
  }

  reload() {
    const P = this.P, wid = this.curW(), w = WEAPONS[wid], a = P.ammo[wid];
    const t = now();
    if (!P.alive || w.melee || !a || a.res <= 0 || a.mag >= w.mag || t < P.reloadUntil) return;
    P.reloadUntil = t + w.reload;
    P.reloadW = wid;
    P.scoped = false;
    this.net.send({ t: 'reload' });
    sfx('reload');
  }

  spreadNow(w) {
    const P = this.P;
    return shotSpread(w, { speed: Math.hypot(P.vel.x, P.vel.z), grounded: P.grounded, crouch: P.crouch, scoped: P.scoped, punch: P.punch });
  }

  tryFire() {
    const P = this.P, t = now();
    const wid = this.curW(), w = WEAPONS[wid];
    const ph = this.rs?.phase;
    if (!P.alive || !P.trigger || ph === 'freeze' || ph === 'matchEnd') return;
    if (P.cur === 4) {
      if (P.fresh && t >= P.drawUntil) { P.fresh = false; this.throwNade(); }
      return;
    }
    if (t < P.drawUntil || t < P.reloadUntil || t < P.nextFire) return;
    if (!w.auto && !P.fresh) return;
    P.fresh = false;
    const a = P.ammo[wid];
    if (!w.melee) {
      if (!a || a.mag <= 0) { sfx('empty'); P.trigger = false; this.reload(); return; }
      a.mag--;
    }
    P.nextFire = t + 60 / w.rpm;
    const eye = this.eyePos();
    const o = [eye.x, eye.y, eye.z];
    const spread = this.spreadNow(w);
    const pellets = w.pellets || 1;
    const out = [];
    // hướng bắn = hướng nhìn + độ giật + tản ngẫu nhiên
    const pitch = P.pitch + P.punch, yaw = P.yaw + P.punchYaw;
    // đầu nòng tính từ vị trí mắt và hướng bắn của CHÍNH khung hình này (camera còn ở khung trước,
    // lấy theo camera thì khi chạy ngang tia đạn xuất phát lệch hẳn sang một bên)
    const muzzleW = this.muzzleAt(eye, pitch, yaw);
    for (let i = 0; i < pellets; i++) {
      const r = Math.sqrt(Math.random()) * spread, th = Math.random() * Math.PI * 2;
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch + Math.sin(th) * r, yaw + Math.cos(th) * r, 0, 'YXZ'));
      const d = [dir.x, dir.y, dir.z];
      const range = w.melee ? w.reach : 250;
      const wall = rayMap(o, d, range, this.map.boxes);
      let hit = null;
      for (const av of this.avatars.values()) {
        if (av === this.me || !av.alive || !this.enemyOf(av)) continue;
        const r2 = rayPlayer(o, d, av.pos.x, av.pos.y, av.pos.z, !!(av.flags & 1));
        if (r2.t < wall.t && (!hit || r2.t < hit.t)) hit = { t: r2.t, zone: r2.zone, av };
      }
      const tt = hit ? hit.t : wall.t;
      const end = v3(o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt);
      out.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2), hit ? hit.av.id : 0, hit ? hit.zone : 0]);
      if (!w.melee) this.tracer(muzzleW, end, 0xfff1a8);
      if (hit) this.impact(end, null, true, hit.zone === 1);
      else if (!w.melee || wall.t < range) this.impact(end, wall.n, false);
    }
    this.net.send({ t: 'fire', w: wid, o: o.map(v => +v.toFixed(2)), p: out });
    // giật
    P.punch = Math.min(0.14, P.punch + w.kick);
    P.punchYaw += (Math.random() - 0.5) * w.kick * (P.punch > 0.05 ? 1.6 : 0.6);
    P.lastShot = t;
    this.vmKick = w.melee ? 0 : 1;
    this.vmSwing = w.melee ? 1 : 0;
    if (!w.melee) {
      this.flash.visible = true;
      this.flash.material.rotation = Math.random() * 6;
      this.flashT = 0.05;
      this.fx.flash(muzzleW, 0xffc46b, 10, 0.06);
    }
    sfx(w.sound);
    if (w.scope && P.scoped) { P.scoped = false; this.rescopeAt = t + 60 / w.rpm * 0.9; }
    if (!w.melee && a.mag === 0 && a.res > 0) setTimeout(() => this.reload(), 250);
  }

  use(on) {
    if (!this.P?.alive && on) return;
    if (this.usingNow === on) return;
    this.usingNow = on;
    this.net.send({ t: 'use', on });
    if (!on) this.useProg = null;
  }

  eyePos() {
    const P = this.P;
    return v3(P.pos.x, P.pos.y + PLAYER.eye - (PLAYER.eye - PLAYER.crouchEye) * P.crouchK, P.pos.z);
  }

  // ước lượng đầu nòng trong thế giới (cho tia đạn đẹp), theo mắt + góc ngắm truyền vào
  muzzleAt(eye, pitch, yaw) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    return v3(0.14, -0.13, -0.6).applyQuaternion(q).add(eye);
  }

  tracer(a, b, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.07 });
  }

  impact(p, n, flesh, head) {
    if (flesh) {
      this.fx.parts.burst(p, head ? 16 : 9, head ? 0xffffff : 0xff6b8b, { speed: 3.5, size: 0.18, life: 0.4, grav: 6 });
      if (head) this.fx.parts.burst(p, 8, 0xffd166, { speed: 5, size: 0.15, life: 0.3 });
      return;
    }
    this.fx.parts.burst(p, 6, 0xffe6a8, { speed: 3, size: 0.1, life: 0.25, grav: 8 });
    this.fx.parts.burst(p, 3, 0x9c8b7a, { speed: 1.2, size: 0.25, life: 0.5, drag: 3, jitter: 0.1 });
    if (n) {
      // lỗ đạn
      const d = new THREE.Mesh(DECAL_GEO, DECAL_MAT);
      d.position.copy(p).addScaledVector(v3(...n), 0.01);
      d.lookAt(d.position.clone().add(v3(...n)));
      this.scene.add(d);
      this.decals.push(d);
      if (this.decals.length > 80) this.decals.shift().removeFromParent();
    }
  }

  // ======================= Bom / sử dụng =======================
  updateBombObj() {
    const b = this.rs?.bomb;
    if (!b) return;
    if (b.state === 'planted' || b.state === 'dropped') {
      this.bombObj.visible = true;
      this.bombObj.position.set(...b.pos);
    } else this.bombObj.visible = false;
  }

  useHint() {
    const P = this.P, rs = this.rs;
    if (!P.alive || this.mode !== 'bomb' || !rs) return '';
    const key = this.touch?.enabled ? 'nút 💣' : 'E';
    if (P.bomb && rs.phase === 'live') {
      for (const s of Object.values(this.map.sites)) if (inRect(s, P.pos.x, P.pos.z)) return `Giữ ${key} để cài bom`;
      return '💣 Bạn đang giữ bom';
    }
    if (P.team === 'CT' && rs.phase === 'planted' && rs.bomb.pos) {
      const [x, , z] = rs.bomb.pos;
      if (Math.hypot(P.pos.x - x, P.pos.z - z) < 2.2) return `Giữ ${key} để gỡ bom${P.kit ? ' (có bộ gỡ)' : ''}`;
    }
    return '';
  }

  // ======================= Mua đồ =======================
  buildBuyMenu() {
    const box = $('sBuyList');
    box.innerHTML = '';
    for (const cat of BUY_MENU) {
      const sec = document.createElement('div');
      sec.className = 'bcat';
      sec.innerHTML = `<h4>${cat.cat}</h4>`;
      for (const id of cat.items) {
        const it = itemInfo(id);
        const b = document.createElement('button');
        b.className = 'bitem';
        b.dataset.id = id;
        const NADE_DESC = { he: 'Nổ gây sát thương vùng', flash: 'Làm lóa mắt (tối đa 2)', smoke: 'Màn khói che tầm nhìn 15s' };
        const extra = WEAPONS[id] ? `${it.dmg}${it.pellets ? '×' + it.pellets : ''} dmg · ${it.auto ? 'Tự động' : 'Bán tự động'}`
          : GRENADES[id] ? NADE_DESC[id] : (id === 'kit' ? 'Chỉ phe Thủ' : 'Giảm sát thương');
        b.innerHTML = `<b>${esc(it.name)}</b><small>${extra}</small><span class="price">$${it.price}</span>`;
        b.onclick = () => {
          if (WEAPONS[id]) this.takeCur = true;   // mua súng thì cầm luôn súng mới
          this.net.send({ t: 'buy', item: id }); sfx('buy');
        };
        sec.appendChild(b);
      }
      box.appendChild(sec);
    }
    $('sBuyClose').onclick = () => this.toggleBuy(false);
  }

  refreshBuyMenu() {
    if (!this.P) return;
    const dm = this.mode === 'dm';
    $('sBuyTitle').textContent = dm ? 'Chọn vũ khí (miễn phí)' : `Mua đồ — $${this.P.money}`;
    for (const b of document.querySelectorAll('#sBuyList .bitem')) {
      const id = b.dataset.id;
      const it = itemInfo(id);
      const owned = Object.values(this.P.weapons).includes(id) || (id === 'armor' && this.P.armor >= 100) || (id === 'kit' && this.P.kit) ||
        (GRENADES[id] && (this.P.nades[id] | 0) >= GRENADES[id].max);
      b.classList.toggle('owned', owned);
      b.disabled = (!dm && this.P.money < it.price) || (id === 'kit' && (dm || this.P.team !== 'CT')) || (dm && !!GRENADES[id]);
      b.querySelector('.price').textContent = dm ? 'Free' : '$' + it.price;
    }
  }

  toggleBuy(force) {
    const open = force ?? $('sBuy').hidden;
    if (open && !this.P.alive) return;
    $('sBuy').hidden = !open;
    this.refreshBuyMenu();
    if (open) document.exitPointerLock?.();
    else if (!this.touch?.enabled) lockPointer();
  }

  switchTeam() {
    if (this.mode !== 'bomb') return;
    this.net.send({ t: 'team', team: this.P.team === 'T' ? 'CT' : 'T' });
  }

  // ======================= Theo dõi khi chết =======================
  cycleSpec() {
    const list = [...this.avatars.values()].filter(a => a !== this.me && a.alive && (this.mode === 'dm' || a.team === this.myTeam));
    const all = list.length ? list : [...this.avatars.values()].filter(a => a !== this.me && a.alive);
    if (!all.length) { this.spec = null; return; }
    const i = all.indexOf(this.spec);
    this.spec = all[(i + 1) % all.length];
  }

  // ======================= Cảm ứng =======================
  setupTouch() {
    if (!this.touch?.enabled) return;
    const P = () => this.P;
    this.touch.setButtons([
      { id: 'fire', label: '🎯<small>Bắn</small>', cls: 'big', look: true,
        down: () => { if (!P().alive) return this.cycleSpec(); P().trigger = true; P().fresh = true; }, up: () => { P().trigger = false; } },
      { id: 'scope', label: '🔭', down: () => this.toggleScope() },
      { id: 'reload', label: '⟳<small>Nạp</small>', down: () => this.reload() },
      { id: 'jump', label: '⤒<small>Nhảy</small>', down: () => { this.jumpPressed = true; } },
      { id: 'crouch', label: '⇩<small>Ngồi</small>', down: () => { this.touchCrouch = !this.touchCrouch; this.touch.setActive('crouch', this.touchCrouch); } },
      { id: 'swap', label: '⇄<small>Đổi súng</small>', down: () => this.cycleWeapon(1) },
      { id: 'nade', label: '💥<small>Lựu đạn</small>', down: () => this.selectNade() },
      { id: 'pick', label: '✋<small>Nhặt</small>', down: () => this.pickup() },
      ...(this.mode === 'bomb' ? [{ id: 'use', label: '💣<small>Cài/Gỡ</small>', down: () => this.use(true), up: () => this.use(false) }] : []),
      { id: 'buy', label: '🛒', cls: 'mini', down: () => this.toggleBuy() },
      { id: 'menu', label: '☰', cls: 'mini', down: () => this.onUnlock?.() },
      { id: 'score', label: '🏆', cls: 'mini', down: () => { $('sScore').hidden = false; this.renderScore(); }, up: () => { $('sScore').hidden = true; } },
      { id: 'chat', label: '💬', cls: 'mini', down: () => this.openChat() },
    ], 'shooter');
  }

  // ======================= Vật lý =======================
  updateLocal(dt) {
    const P = this.P, t = now();
    const k = this.keys;
    if (!P.alive) return;
    const w = WEAPONS[this.curW()];
    const frozen = this.rs?.phase === 'freeze' || this.rs?.phase === 'matchEnd';
    // hướng di chuyển theo camera
    let f = 0, r = 0;
    if (k.has('KeyW')) f++;
    if (k.has('KeyS')) f--;
    if (k.has('KeyD')) r++;
    if (k.has('KeyA')) r--;
    let mag = 1;
    if (this.touch?.enabled) {
      const m = this.touch.move, L = Math.hypot(m.x, m.y);
      if (L > 0.12) { f = -m.y / L; r = m.x / L; mag = L > 0.7 ? 1 : S.walkMul + 0.1; }
    }
    if (this.chatting || !$('sBuy').hidden && !this.touch?.enabled) { f = r = 0; }
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let wx = fx * f + -fz * r, wz = fz * f + fx * r;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    P.crouch = k.has('ControlLeft') || k.has('KeyC') || !!this.touchCrouch;
    P.crouchK += ((P.crouch ? 1 : 0) - P.crouchK) * Math.min(1, dt * 12);
    const walk = k.has('ShiftLeft') || mag < 1;
    let speed = moveSpeedFor(w.id) * (walk ? S.walkMul : 1) * (P.crouch ? S.crouchMul : 1) * (P.scoped ? 0.6 : 1);
    if (frozen) speed = 0;
    const accel = P.grounded ? Math.min(1, dt * 12) : Math.min(1, dt * 1.8);
    P.vel.x += (wx * speed - P.vel.x) * accel;
    P.vel.z += (wz * speed - P.vel.z) * accel;
    if (this.jumpPressed && P.grounded && !frozen) { P.vel.y = S.jump; P.grounded = false; }
    this.jumpPressed = false;
    P.vel.y -= S.gravity * dt;
    const h = P.crouch ? PLAYER.crouchHeight : PLAYER.height;
    P.grounded = moveAndCollide(P.pos, P.vel, dt, this.map.boxes, h, P.grounded);
    const B = this.map.bounds;
    P.pos.x = clamp(P.pos.x, -B.x + 0.5, B.x - 0.5);
    P.pos.z = clamp(P.pos.z, -B.z + 0.5, B.z - 0.5);

    // tiếng bước chân (chạy thường mới có tiếng, đi bộ / ngồi thì im lặng như game chiến thuật)
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (P.grounded && !walk && !P.crouch && hs > 3) {
      P.stepAcc += hs * dt;
      if (P.stepAcc > 2.3) { P.stepAcc = 0; sfx('step', 6); }
    }

    // giật hồi về
    if (t - P.lastShot > 60 / w.rpm + 0.05) {
      P.punch = Math.max(0, P.punch - dt * 0.35);
      P.punchYaw *= Math.max(0, 1 - dt * 6);
    }
    // nạp đạn xong (dự đoán)
    if (P.reloadUntil && t >= P.reloadUntil) {
      const a = P.ammo[P.reloadW], ww = WEAPONS[P.reloadW];
      if (a && ww) { const n = Math.min(ww.mag - a.mag, a.res); a.mag += n; a.res -= n; }
      P.reloadUntil = 0;
    }
    if (this.rescopeAt && t >= this.rescopeAt) { this.rescopeAt = 0; if (w.scope && P.trigger === false) P.scoped = true; }
    this.tryFire();

    // gửi trạng thái
    if ((this.sendT ||= new Ticker(NET.sendRate)).due(dt)) {
      const flags = (P.crouch ? 1 : 0) | (hs > 3 && !walk ? 2 : 0) | (walk ? 4 : 0) | (P.grounded ? 0 : 8) | (P.scoped ? 128 : 0);
      this.net.send({ t: 's', p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)], r: +P.yaw.toFixed(3), pi: +P.pitch.toFixed(3),
        f: flags, w: WEAPON_LIST.indexOf(this.curW()) });
    }
    this.me.pos.copy(P.pos);
  }

  updateCamera(dt) {
    const P = this.P, cam = this.camera;
    if (P.alive) {
      cam.position.copy(this.eyePos());
      cam.rotation.set(P.pitch + P.punch * 0.5, P.yaw + P.punchYaw * 0.5, 0);
      const fov = P.scoped ? WEAPONS[this.curW()].scope : 75;
      if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    } else {
      if (cam.fov !== 75) { cam.fov = 75; cam.updateProjectionMatrix(); }
      if (!this.spec || !this.spec.alive) {
        if (!this.specT || now() - this.specT > 0.5) { this.specT = now(); this.cycleSpec(); }
      }
      const s = this.spec;
      if (s) {
        const back = v3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
        const want = v3(s.pos.x + back.x * 3.2, s.pos.y + 2.2, s.pos.z + back.z * 3.2);
        cam.position.lerp(want, Math.min(1, dt * 6));
        cam.lookAt(s.pos.x, s.pos.y + 1.2, s.pos.z);
        $('sSpec').hidden = false;
        $('sSpec').innerHTML = `👁 Đang xem: <b>${esc(s.name)}</b> <small>(${this.touch?.enabled ? 'chạm nút Bắn' : 'click'} để đổi)</small>`;
      } else {
        const a = now() * 0.1;
        cam.position.set(Math.sin(a) * 30, 22, Math.cos(a) * 30);
        cam.lookAt(0, 0, 0);
        $('sSpec').hidden = true;
      }
    }
    if (this.fx.shakeAmt > 0) {
      const sh = this.fx.shakeAmt * 0.15 * this.settings.shake;
      cam.position.x += (Math.random() - 0.5) * sh; cam.position.y += (Math.random() - 0.5) * sh;
    }
  }

  updateViewModel(dt) {
    const vm = this.vm;
    if (!vm) return;
    const P = this.P, t = now();
    vm.visible = P.alive && !P.scoped;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    const bob = P.grounded ? Math.min(1, hs / 6) : 0.3;
    this.bobT = (this.bobT || 0) + dt * (4 + hs);
    this.vmKick = Math.max(0, (this.vmKick || 0) - dt * 14);
    this.vmSwing = Math.max(0, (this.vmSwing || 0) - dt * 5);
    let y = this.vmBase.y + Math.abs(Math.sin(this.bobT)) * 0.012 * bob;
    let x = this.vmBase.x + Math.cos(this.bobT) * 0.008 * bob;
    let z = this.vmBase.z + this.vmKick * 0.05;
    let rx = this.vmKick * 0.12, ry = 0, rz = 0;
    if (t < P.reloadUntil) {
      const w = WEAPONS[P.reloadW];
      const p = 1 - (P.reloadUntil - t) / w.reload;
      const dip = Math.sin(p * Math.PI);
      y -= dip * 0.12; rx -= dip * 0.6; rz += dip * 0.4;
    }
    if (t < P.drawUntil) {
      const p = (P.drawUntil - t) / 0.5;
      y -= p * 0.25; rx -= p * 0.8;
    }
    if (this.vmSwing > 0) { const s = Math.sin(this.vmSwing * Math.PI); ry = s * 0.9; rz = -s * 0.6; x -= s * 0.08; }
    vm.position.set(x, y, z);
    vm.rotation.set(rx, ry, rz);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
  }

  // ======================= HUD =======================
  updateWeaponHud() {
    const P = this.P;
    if (!P) return;
    const wid = this.curW(), w = WEAPONS[wid], a = P.ammo[wid];
    const nade = P.cur === 4 ? GRENADES[P.nadeSel] : null;
    $('sWname').textContent = nade ? nade.name : w.name;
    $('sMag').textContent = nade ? (P.nades[P.nadeSel] | 0) : w.melee ? '—' : (a?.mag ?? 0);
    $('sRes').textContent = nade || w.melee ? '' : (a?.res ?? 0);
    const nadeTxt = NADE_LIST.filter(k => P.nades[k] > 0).map(k => `${GRENADES[k].icon}${P.nades[k] > 1 ? '×' + P.nades[k] : ''}`).join(' ');
    $('sSlots').innerHTML = [1, 2, 3].map(s => P.weapons[s] ? `<span class="${s === P.cur ? 'cur' : ''}">${s} ${esc(WEAPONS[P.weapons[s]].name)}</span>` : '').join('') +
      (nadeTxt ? `<span class="${P.cur === 4 ? 'cur' : ''}">4 ${nadeTxt}</span>` : '');
  }

  updateHud(dt) {
    const P = this.P, rs = this.rs, t = now();
    $('sHp').textContent = Math.max(0, Math.ceil(P.hp));
    $('sHp').parentElement.classList.toggle('low', P.hp <= 25);
    $('sArmor').textContent = Math.ceil(P.armor) + (P.armor > 0 ? '' : '');
    $('sMoney').textContent = this.mode === 'dm' ? '' : `$ ${P.money}`;
    $('sTeamTag').textContent = this.mode === 'dm' ? 'SINH TỬ' : `${TEAMS[P.team].name} · ${TEAMS[P.team].role}`;
    $('sTeamTag').style.color = this.mode === 'dm' ? '#ffd166' : TEAMS[P.team].css;
    this.updateWeaponHud();
    if (rs) {
      const left = Math.max(0, rs.left - (t - this.rsAt));
      const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
      const planted = rs.phase === 'planted';
      $('sTimer').textContent = planted ? '💣' : `${mm}:${ss.toString().padStart(2, '0')}`;
      $('sTimer').classList.toggle('bomb', planted);
      const labels = { warmup: 'Khởi động — chờ đủ 2 phe', freeze: 'Chuẩn bị · Mua đồ (B)', live: '', planted: `Bom tại ${rs.bomb.site}`, roundEnd: 'Hết vòng', matchEnd: 'Hết trận' };
      $('sPhase').textContent = this.mode === 'dm' ? `Đạt ${rs.dmKills} mạng để thắng` : (labels[rs.phase] ?? '') + (rs.phase !== 'warmup' ? ` · Vòng ${rs.round}` : '');
      if (this.mode === 'bomb') {
        $('sScT').textContent = rs.score.T; $('sScCT').textContent = rs.score.CT;
        $('sAliveT').textContent = '●'.repeat(rs.alive.T); $('sAliveCT').textContent = '●'.repeat(rs.alive.CT);
      } else {
        const top = [...this.avatars.values()].sort((a, b) => b.kills - a.kills)[0];
        $('sScT').textContent = this.me.kills; $('sScCT').textContent = top ? top.kills : 0;
        $('sAliveT').textContent = 'Bạn'; $('sAliveCT').textContent = 'Top';
      }
      // tiếng bíp bom (nhanh dần)
      if (planted && rs.bomb.pos) {
        const bl = Math.max(0, rs.bomb.left - (t - this.rsAt));
        const interval = clamp(bl / S.bombTime, 0.08, 1) * 1.0;
        this.beepT = (this.beepT || 0) - dt;
        if (this.beepT <= 0) {
          this.beepT = interval;
          const bp = v3(...rs.bomb.pos);
          sfx('beep', this.dist(bp) * 0.6);
          this.bombObj.userData.light.visible = true;
          setTimeout(() => { this.bombObj.userData.light.visible = false; }, 80);
          this.fx.flash(bp.clone().setY(bp.y + 0.4), 0xff2020, 6, 0.1);
        }
      }
    }
    // dấu tâm động (giãn theo độ tản đạn)
    const w = WEAPONS[this.curW()];
    // khe hở = đúng bán kính nón tản trên màn hình (theo FOV hiện tại)
    const spr = this.spreadNow(w);
    const gap = 3 + Math.tan(spr) / Math.tan(this.camera.fov * Math.PI / 360) * innerHeight / 2;
    $('sCross').style.setProperty('--gap', Math.min(90, gap) + 'px');
    // trong scope chỉ hiện tâm xanh khi đang bị tản (chạy/nhảy) để biết phải đứng lại
    $('sCross').hidden = !P.alive || (P.scoped && spr < 0.004);
    $('sScope').hidden = !(P.alive && P.scoped);
    // gợi ý + tiến trình cài/gỡ bom + nhặt súng
    const near = P.alive ? this.nearestDrop() : null;
    const pickTxt = near ? `${this.touch?.enabled ? 'Chạm ✋' : 'F'}: nhặt ${WEAPONS[near.w].name}` : '';
    $('sHint').textContent = this.useHint() || pickTxt;
    if (this.useProg) {
      const p = clamp((t - this.useProg.start) / this.useProg.dur, 0, 1);
      $('sProg').hidden = false;
      $('sProgFill').style.width = p * 100 + '%';
      $('sProgText').textContent = this.useProg.kind === 'plant' ? 'Đang cài bom...' : 'Đang gỡ bom...';
    } else $('sProg').hidden = true;
    $('sPing').textContent = this.net.ping + ' ms';
    // tên đồng đội trên đầu
    const show = [];
    for (const a of this.avatars.values()) {
      if (a === this.me || !a.alive) { this.hud.removePlate('s' + a.id); continue; }
      const friend = this.mode === 'bomb' && a.team === this.myTeam;
      if (friend || a.aimed) show.push(a);
      else this.hud.removePlate('s' + a.id);
    }
    this.hud.updatePlates(show.map(a => ({ id: 's' + a.id, name: a.name, pos: a.pos.clone().setY(a.pos.y - 0.5), hp: 150, dead: false, isMe: false, targeted: !(this.mode === 'bomb' && a.team === this.myTeam) })), this.camera, innerWidth, innerHeight);
    if (this.touch?.enabled) {
      this.touch.setActive('scope', P.scoped);
      const u = this.useHint();
      this.touch.buttons.get('use')?.el.classList.toggle('dim', !u.startsWith('Giữ'));
      this.touch.buttons.get('scope')?.el.classList.toggle('dim', !w.scope);
      this.touch.buttons.get('pick')?.el.classList.toggle('dim', !near);
      this.touch.buttons.get('nade')?.el.classList.toggle('dim', !this.availableNades().length);
      this.touch.setActive('nade', P.cur === 4);
    }
  }

  renderScore() {
    const row = a => `<tr class="${a === this.me ? 'me' : ''} ${a.alive ? '' : 'dead'}"><td>${esc(a.name)}</td><td>${a.kills}</td><td>${a.deaths}</td></tr>`;
    const sorted = list => list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const all = [...this.avatars.values()];
    if (this.mode === 'dm') {
      $('sScoreBody').innerHTML = `<table><thead><tr><th>Người chơi</th><th>Hạ</th><th>Gục</th></tr></thead><tbody>${sorted(all).map(row).join('')}</tbody></table>`;
    } else {
      $('sScoreBody').innerHTML = ['T', 'CT'].map(tm => `<div class="steam"><h4 style="color:${TEAMS[tm].css}">${TEAMS[tm].name} (${TEAMS[tm].role}) — ${this.rs?.score[tm] ?? 0}</h4>
        <table><thead><tr><th>Người chơi</th><th>Hạ</th><th>Gục</th></tr></thead><tbody>${sorted(all.filter(a => a.team === tm)).map(row).join('')}</tbody></table></div>`).join('');
    }
  }

  centerMsg(msg, cls = '', dur = 2.5) {
    const el = $('sCenter');
    el.textContent = msg;
    el.className = 'on ' + (cls || '');
    clearTimeout(this.cmT);
    this.cmT = setTimeout(() => { el.className = ''; }, dur * 1000);
  }

  banner(title, sub, color, dur) {
    const el = $('sBanner');
    el.innerHTML = `<h2 style="color:${color}">${esc(title)}</h2><p>${esc(sub || '')}</p>`;
    el.hidden = false;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(this.bnT);
    this.bnT = setTimeout(() => { el.hidden = true; }, dur * 1000);
  }

  // ======================= Vòng lặp =======================
  loop() {
    requestAnimationFrame(this.loop);
    const t = now();
    const dt = Math.min(0.05, t - this.lastT);
    this.lastT = t;
    if (!this.active || !this.me) return;

    if (this.touch?.enabled) {
      const lk = this.touch.takeLook();
      const sc = this.P.scoped ? 0.35 : 1;
      this.look(lk.dx * 0.0045 * this.settings.sens * sc, lk.dy * 0.0045 * this.settings.sens * sc);
    }
    this.updateLocal(dt);
    // tia ngắm trúng ai (để hiện tên địch khi nhắm vào)
    const eye = this.eyePos();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.P.pitch, this.P.yaw, 0, 'YXZ'));
    const o = [eye.x, eye.y, eye.z], d = [dir.x, dir.y, dir.z];
    const wall = rayMap(o, d, 120, this.map.boxes).t;
    for (const a of this.avatars.values()) {
      if (a === this.me) continue;
      a.interpolate(dt);
      a.render(dt);
      const ta = a.alive ? rayPlayer(o, d, a.pos.x, a.pos.y, a.pos.z, !!(a.flags & 1)).t : Infinity;
      a.aimed = ta < wall && !this.smokeBlocks(o, d, ta);
      // tiếng bước chân người khác
      if (a.alive && (a.flags & 2) && !(a.flags & 8)) {
        a.stepAcc += (a.speed || 0) * dt;
        if (a.stepAcc > 2.3) { a.stepAcc = 0; sfx('step', this.dist(a.pos)); }
      }
    }
    // bom trên lưng người mang đã có trong model; bom rơi/cài nhấp nháy
    if (this.bombObj.visible) this.bombObj.rotation.y += dt * 0.5;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      tr.mesh.material.opacity = Math.max(0, tr.life / 0.07);
      if (tr.life <= 0) { tr.mesh.removeFromParent(); tr.mesh.geometry.dispose(); tr.mesh.material.dispose(); this.tracers.splice(i, 1); }
    }
    this.updateNades(dt);
    this.updateSmokes(dt);
    for (const dr of this.drops.values()) dr.mesh.position.y = dr.pos[1] + 0.07 + Math.sin(t * 2 + dr.id) * 0.02;
    this.updateCamera(dt);
    this.updateViewModel(dt);
    this.fx.update(dt);
    this.view.update(t, dt);
    this.updateHud(dt);
    // lóa mắt do lựu đạn choáng
    const bl = this.blindUntil - t;
    $('sFlash').style.opacity = bl > 0 ? Math.min(1, bl / (this.blindDur * 0.45)) : 0;

    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { $('sFps').textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS'; this.fpsAcc = 0; this.fpsN = 0; }

    const r = this.renderer;
    r.autoClear = true;
    r.render(this.scene, this.camera);
    if (this.vm?.visible) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, this.vmCam);
      r.autoClear = true;
    }
  }
}

// ---------- tài nguyên dùng chung ----------
const DECAL_GEO = new THREE.CircleGeometry(0.06, 8);
const DECAL_MAT = new THREE.MeshBasicMaterial({ color: 0x1a1410, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
let _smokeTex = null;
function smokeTex() {
  if (_smokeTex) return _smokeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = 40 + Math.random() * 48, y = 40 + Math.random() * 48, r = 30 + Math.random() * 25;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  _smokeTex = new THREE.CanvasTexture(c);
  return _smokeTex;
}
let _flashTex = null;
function flashTex() {
  if (_flashTex) return _flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.3, 'rgba(255,200,90,0.9)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = gr;
  for (let i = 0; i < 6; i++) {
    g.save(); g.translate(32, 32); g.rotate(i * Math.PI / 3);
    g.beginPath(); g.moveTo(0, -4); g.lineTo(30, 0); g.lineTo(0, 4); g.fill(); g.restore();
  }
  g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.fill();
  _flashTex = new THREE.CanvasTexture(c);
  return _flashTex;
}
