// Lõi game phía client: render, điều khiển, combo, đồng bộ mạng.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { NET, Ticker, GAME, MOVE, ARENA } from '/shared/config.js';
import { getChar, skillLifetime } from '/shared/characters.js';
import { STEER_SEND_HZ } from '/shared/steer.js';
import { buildChibi, ANIM } from './chibi.js';
import { FX } from './effects.js';
import { buildWorld } from './world.js';
import { HUD, $, lockPointer } from './ui.js';
import { sfx, skillSound } from './audio.js';

const now = () => performance.now() / 1000;
const BR = GAME.bodyRadius;
const COMBO_WINDOW = 0.5;   // thời gian tối đa giữa 2 phím trong một combo
const COMBO_WAIT = 0.2;     // chờ thêm phím nếu combo hiện tại có thể kéo dài
const INTERP_DELAY = NET.interp;   // nội suy người chơi khác (xem shared/config.js)
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function angLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ======================= Nhân vật (mình + người khác) =======================
class Avatar {
  constructor(game, data, isMe) {
    this.game = game;
    this.id = data.id;
    this.isMe = isMe;
    this.name = data.name;
    this.pos = v3(data.x, data.y, data.z);
    this.yaw = data.yaw || 0;
    this.hp = data.hp; this.mp = data.mp;
    this.dead = data.dead;
    this.kills = data.kills || 0; this.deaths = data.deaths || 0;
    this.flags = 0; this.anim = ANIM.idle;
    this.buf = [];
    this.forced = null;      // đường lao (dash skill) của người chơi khác
    this.faceUntil = 0; this.faceYaw = 0;
    this.healUntil = 0;
    this._hand = v3();
    this.speed = 0;
    this.setChar(data.char);
    const self = this;
    this.casterApi = {
      pos: () => self.pos,
      hand: () => { self.model.rig.handR.getWorldPosition(self._hand); return self._hand; },
    };
  }

  setChar(id) {
    if (this.model) { this.model.root.removeFromParent(); this.model.rig.shadow.removeFromParent(); }
    this.char = getChar(id);
    this.model = buildChibi(this.char.look);
    this.game.scene.add(this.model.root, this.model.rig.shadow);
  }

  dispose() {
    this.model.root.removeFromParent();
    this.model.rig.shadow.removeFromParent();
  }

  pushSnap(x, y, z, yaw) {
    this.buf.push({ t: now(), x, y, z, yaw });
    if (this.buf.length > 30) this.buf.shift();
  }

  // Nội suy vị trí người chơi khác
  interpolate() {
    const t = now();
    if (this.forced) {
      const f = this.forced, el = t - f.t0;
      if (el < f.delay + f.dur + 0.15) {
        if (f.steer) {
          // đường lao được lái theo tâm: tiến từng bước theo hướng hiện tại (f.h do hiệu ứng cập nhật)
          if (!f.cur) f.cur = f.p.clone();
          const a = Math.max(f.last ?? 0, f.delay), b = Math.min(el, f.delay + f.dur);
          if (b > a) f.cur.addScaledVector(f.h, f.dist / f.dur * (b - a));
          f.last = el;
          this.pos.copy(f.cur);
        } else {
          const k = Math.max(0, Math.min(1, (el - f.delay) / f.dur));
          this.pos.set(f.p.x + f.h.x * f.dist * k, f.p.y, f.p.z + f.h.z * f.dist * k);
        }
        this.yaw = Math.atan2(f.h.x, f.h.z);
        return;
      }
      this.forced = null;
    }
    const rt = t - INTERP_DELAY;
    const b = this.buf;
    if (!b.length) return;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const s1 = b[i], s0 = b[Math.max(0, i - 1)];
    let k = s1.t === s0.t ? 1 : (rt - s0.t) / (s1.t - s0.t);
    k = Math.max(0, Math.min(1.2, k));
    const prev = this.pos.clone();
    this.pos.set(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k, s0.z + (s1.z - s0.z) * k);
    this.speed = prev.distanceTo(this.pos) * 60;
    this.yaw = angLerp(s0.yaw, s1.yaw, Math.min(1, k));
  }

  render(dt) {
    const m = this.model;
    m.root.position.copy(this.pos);
    let yaw = this.yaw;
    if (now() < this.faceUntil) yaw = this.faceYaw;
    m.root.rotation.y = angLerp(m.root.rotation.y, yaw, Math.min(1, dt * 18));
    m.update(dt, this.dead ? ANIM.dead : this.anim, this.speed);
    // bóng dưới chân: bám mặt đất
    const gy = groundHeight(this.pos.x, this.pos.z, this.pos.y);
    m.rig.shadow.position.set(this.pos.x, gy + 0.03, this.pos.z);
    const hgt = Math.max(0, this.pos.y - gy);
    m.rig.shadow.scale.setScalar(Math.max(0.3, 1 - hgt * 0.08));
    m.rig.shadow.visible = !this.dead;
  }
}

// Độ cao mặt đất tại (x,z) – tính cả mặt trên chướng ngại vật
function groundHeight(x, z, y) {
  let g = 0;
  for (const [ox, oz, r, h] of ARENA.obstacles) {
    if (y >= h - 0.3 && Math.hypot(x - ox, z - oz) < r + BR * 0.4) g = Math.max(g, h);
  }
  return g;
}

// ======================= Game =======================
export class Game {
  constructor(net, settings) {
    this.net = net;
    this.settings = settings;
    this.active = false;

    // ---------- Render ----------
    const canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.4, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.world = buildWorld(this.scene);
    this.fx = new FX(this.scene, this.camera);
    this.fx.warmup(this.renderer);   // biên dịch shader trước để không giật khi tung chiêu lần đầu
    this.hud = new HUD();
    this.applySettings();
    addEventListener('resize', () => this.resize());
    this.resize();

    // ---------- Trạng thái ----------
    this.avatars = new Map();
    this.me = null;
    this.effects = new Map();    // eid -> effect
    this.predicted = new Map();  // cs -> effect (chiêu của mình, hiện ngay trước khi server xác nhận)
    this.cs = 1;
    this.keys = new Set();
    this.cam = { yaw: 0, pitch: 0.32, dist: 8.5, pos: v3(0, 5, 10) };
    this.L = null;               // trạng thái vật lý của mình
    this.combo = [];
    this.pending = null;
    this.sendT = new Ticker(NET.sendRate);
    this.lastT = now();
    this.fpsAcc = 0; this.fpsN = 0;
    this.chatting = false;
    this.touch = null;        // TouchControls (gán từ main.js)
    this.suspended = false;   // true khi đang ở chế độ bắn súng (dùng chung renderer)

    this.bindNet();
    this.bindInput();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  applySettings() {
    const q = this.settings.quality;
    const pr = q === 'low' ? 0.75 : q === 'medium' ? 1 : Math.min(devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    this.bloom.enabled = q !== 'low' && this.settings.bloom;
    this.fx.quality = q === 'low' ? 0.5 : 1;
    this.fx.parts.mat.uniforms.uScale.value = innerHeight * 0.55;
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.parts.mat.uniforms.uScale.value = h * 0.55;
  }

  // ======================= Vào / rời phòng =======================
  enter(msg) {
    this.clear();
    this.active = true;
    this.myId = msg.you;
    this.roomId = msg.room.id;
    for (const p of msg.players) this.addAvatar(p);
    this.me = this.avatars.get(this.myId);
    this.resetLocal();
    this.hud.setRoom(msg.room.name);
    this.hud.buildSkillbar(this.me.char);
    this.hud.show(true);
    this.cam.yaw = Math.atan2(this.me.pos.x, this.me.pos.z);
    $('chatlog').innerHTML = '';
    this.setupTouch();
  }

  leave() {
    this.active = false;
    this.clear();
    this.hud.show(false);
    this.hud.death(false);
    $('scoreboard').hidden = true;
  }

  clear() {
    for (const av of this.avatars.values()) { av.dispose(); this.hud.removePlate(av.id); }
    this.avatars.clear();
    for (const e of this.fx.list) e.dispose();
    this.fx.list.length = 0;
    this.effects.clear();
    this.predicted.clear();
    this.me = null;
  }

  addAvatar(p) {
    const av = new Avatar(this, p, p.id === this.myId);
    this.avatars.set(p.id, av);
    return av;
  }

  resetLocal() {
    this.L = {
      vel: v3(), onGround: true, jumps: 0, flying: false,
      dashT: 0, dashCd: 0, dashDir: v3(), sprint: false,
      lockUntil: 0, rootUntil: 0, stunUntil: 0, slowUntil: 0, slowMul: 1,
      knockT: 0, skillDash: null, cds: [], healCd: 0, charging: false,
      lastAir: false,
    };
    this.combo = [];
    this.pending = null;
  }

  changeChar(id) {
    this.net.send({ t: 'char', char: id });
  }

  // ======================= Mạng =======================
  bindNet() {
    const n = this.net;
    n.on('pjoin', m => { if (this.active) this.addAvatar(m.player); });
    n.on('pleave', m => {
      const av = this.avatars.get(m.id);
      if (av) { av.dispose(); this.avatars.delete(m.id); this.hud.removePlate(m.id); }
    });
    n.on('pchar', m => {
      const av = this.avatars.get(m.id);
      if (!av) return;
      av.setChar(m.char);
      if (av.isMe) { this.hud.buildSkillbar(av.char); this.L.cds = []; this.setupTouch(); }
    });
    n.on('snap', m => {
      if (!this.active) return;
      for (const [id, x, y, z, yaw, anim, hp, mp, flags] of m.ps) {
        const av = this.avatars.get(id);
        if (!av) continue;
        av.hp = hp; av.mp = mp;
        if (!av.isMe) {
          av.pushSnap(x, y, z, yaw);
          av.anim = anim; av.flags = flags;
          av.dead = !!(flags & 128);
        }
      }
    });
    n.on('cast', m => this.onCast(m));
    n.on('castno', m => {
      const e = this.predicted.get(m.cs);
      if (e) { e.done = true; e.endAll?.(); this.predicted.delete(m.cs); }
      if (this.L) this.L.cds[m.sk] = 0;
      if (this.me) this.me.mp = m.mp;
    });
    n.on('pend', m => this.effects.get(m.eid)?.endSub?.(m.k, m.at));
    n.on('steer', m => { const st = this.effects.get(m.eid)?.steer; if (st) st.aim = m.a; });
    n.on('boom', m => {
      const e = this.effects.get(m.eid);
      e?.endAll?.();
      this.fx.explosion(v3(...m.at), m.c, m.r);
      sfx('explosion', this.distToCam(m.at));
    });
    n.on('hit', m => this.onHit(m));
    n.on('die', m => {
      const av = this.avatars.get(m.id), by = this.avatars.get(m.by);
      if (!av) return;
      av.dead = true; av.hp = 0; av.deaths = m.d;
      if (by) by.kills = m.k;
      this.fx.deathBurst(av.pos, av.char.skills[0].fx.color);
      sfx('die', this.distToCam(av.pos));
      this.hud.killfeed(by?.name, av.name, by?.char.look.hair);
      if (av.isMe) { this.deathAt = now(); this.killer = by?.name; }
      else if (by?.isMe) this.hud.toast(`Bạn đã hạ gục ${av.name}! ⚔`, 1800);
    });
    n.on('respawn', m => {
      const av = this.avatars.get(m.id);
      if (!av) return;
      av.dead = false; av.hp = GAME.maxHp;
      av.pos.set(...m.p);
      av.buf.length = 0;
      av.pushSnap(...m.p, av.yaw);
      this.fx.shockwave(av.pos, 0xffffff, 3);
      this.fx.parts.burst(v3(av.pos.x, av.pos.y + 1, av.pos.z), 30, av.char.look.hair, { speed: 4, size: 0.4, life: 0.8, up: 1 });
      if (av.isMe) { this.resetLocal(); this.hud.death(false); sfx('respawn'); }
    });
    n.on('healfx', m => {
      const av = this.avatars.get(m.id);
      if (!av) return;
      av.healUntil = now() + GAME.heal.dur;
      this.fx.healFx(() => (av.dead || !this.avatars.has(av.id) ? null : av.pos), GAME.heal.dur);
      sfx('heal', this.distToCam(av.pos));
      if (av.isMe) this.L.healCd = now() + GAME.heal.cd;
    });
    n.on('healno', () => sfx('error'));
    n.on('chat', m => this.hud.chat(m.name, m.msg));
    n.on('sys', m => this.hud.chat('', m.msg, true));
  }

  distToCam(p) {
    const x = Array.isArray(p) ? p[0] : p.x, y = Array.isArray(p) ? p[1] : p.y, z = Array.isArray(p) ? p[2] : p.z;
    return Math.hypot(x - this.camera.position.x, y - this.camera.position.y, z - this.camera.position.z);
  }

  onCast(m) {
    const av = this.avatars.get(m.id);
    if (!av) return;
    const s = av.char.skills[m.sk];
    if (!s) return;
    if (av.isMe) {
      // chiêu của mình: đã hiện trước rồi, chỉ cần gắn eid để nhận sự kiện kết thúc
      const e = this.predicted.get(m.cs);
      if (e) { this.effects.set(m.eid, e); this.predicted.delete(m.cs); }
      av.mp = m.mp;
      return;
    }
    const d = v3(...m.d), p = v3(...m.p);
    const h = v3(d.x, 0, d.z).normalize();
    av.faceYaw = Math.atan2(h.x, h.z);
    av.faceUntil = now() + s.lock;
    av.model.play(s.pose, s.lock);
    if (s.type === 'dash') av.forced = { p, h, dist: s.dist, delay: s.delay, dur: s.dur, t0: now(), steer: !!s.steer };
    const e = this.fx.castSkill({ skill: s, p, d, h, seed: m.seed, caster: av.casterApi });
    if (e) this.effects.set(m.eid, e);
    setTimeout(() => this.effects.delete(m.eid), 8000);
    sfx(skillSound(s), this.distToCam(p));
  }

  onHit(m) {
    const tgt = this.avatars.get(m.tid);
    if (!tgt) return;
    tgt.hp = m.hp;
    const at = v3(...m.at);
    const big = m.dmg >= 15;
    this.fx.hitSpark(at, m.c, big);
    tgt.model.hitFlash();
    const src = this.avatars.get(m.sid);
    const w = innerWidth, h = innerHeight;
    if (tgt.isMe) {
      const L = this.L;
      L.vel.x += m.kb[0]; L.vel.z += m.kb[2];
      L.vel.y = Math.max(L.vel.y, m.kb[1]);
      if (m.kb[1] > 1) L.onGround = false;
      L.knockT = 0.3;
      if (m.stun) L.stunUntil = now() + m.stun;
      if (m.slow) { L.slowUntil = now() + m.slow.dur; L.slowMul = m.slow.mul; }
      this.fx.shake(big ? 0.45 : 0.22);
      $('hurt').classList.remove('on'); void $('hurt').offsetWidth; $('hurt').classList.add('on');
      this.hud.dmgNumber(at, '-' + m.dmg, 'mine', this.camera, w, h);
      sfx(big ? 'bigHit' : 'hit');
    } else {
      this.hud.dmgNumber(at, m.dmg, (src?.isMe ? 'dealt' : 'other') + (big ? ' big' : ''), this.camera, w, h);
      sfx(big ? 'bigHit' : 'hit', this.distToCam(at));
      if (src?.isMe) $('hitmark').classList.remove('on'), void $('hitmark').offsetWidth, $('hitmark').classList.add('on');
    }
    if (m.stun) {
      // hiệu ứng đóng băng
      this.fx.parts.burst(at, 20, 0xbdf0ff, { speed: 3, size: 0.4, life: 1 });
    }
  }

  // ======================= Input =======================
  bindInput() {
    const canvas = $('game');
    canvas.addEventListener('click', () => {
      if (this.active && !this.chatting && document.pointerLockElement !== canvas) lockPointer();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.active && !this.chatting) this.onUnlock?.();
      $('clickToPlay').hidden = locked || !this.active || this.chatting || !!this.touch?.enabled;
    });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas) return;
      const s = 0.0022 * this.settings.sens;
      this.cam.yaw -= e.movementX * s;
      this.cam.pitch = Math.max(-0.35, Math.min(1.25, this.cam.pitch + e.movementY * s * (this.settings.invertY ? -1 : 1)));
    });
    addEventListener('wheel', e => {
      if (!this.active) return;
      this.cam.dist = Math.max(4, Math.min(16, this.cam.dist + Math.sign(e.deltaY) * 0.8));
    }, { passive: true });
    canvas.addEventListener('mousedown', e => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) this.comboKey('J');
      if (e.button === 2) this.comboKey('K');
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    addEventListener('keydown', e => {
      if (!this.active) return;
      const chatIn = $('chatInput');
      if (this.chatting) {
        if (e.key === 'Enter') {
          const msg = chatIn.value.trim();
          if (msg) this.net.send({ t: 'chat', msg });
          this.closeChat();
        } else if (e.key === 'Escape') this.closeChat();
        return;
      }
      if (e.code === 'Tab') { e.preventDefault(); this.showScore = true; return; }
      if (e.key === 'Enter') { this.openChat(); e.preventDefault(); return; }
      if (e.code === 'F1') { e.preventDefault(); $('help').hidden = !$('help').hidden; return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyJ': this.comboKey('J'); break;
        case 'KeyK': this.comboKey('K'); break;
        case 'KeyL': this.comboKey('L'); break;
        case 'KeyH': this.tryHeal(); break;
        case 'Space': this.jump(); e.preventDefault(); break;
        case 'ShiftLeft': case 'ShiftRight': this.dash(); break;
      }
    });
    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.showScore = false;
    });
    addEventListener('blur', () => this.keys.clear());
  }

  openChat() {
    this.chatting = true;
    this.keys.clear();
    $('chatInput').hidden = false;
    $('chatInput').value = '';
    document.exitPointerLock?.();
    setTimeout(() => $('chatInput').focus(), 0);
  }
  closeChat() {
    this.chatting = false;
    $('chatInput').hidden = true;
    $('chatInput').blur();
    if (!this.touch?.enabled) lockPointer();
  }

  // ======================= Cảm ứng =======================
  setupTouch() {
    if (!this.touch?.enabled || !this.me) return;
    const short = s => s.name.split(' ').slice(0, 2).join(' ');
    const sk = this.me.char.skills;
    const hold = code => ({ down: () => this.keys.add(code), up: () => this.keys.delete(code) });
    this.touch.setButtons([
      { id: 'atk', label: '⚔<small>Đánh</small>', cls: 'big', down: () => this.castDirect(0) },
      { id: 's1', label: short(sk[1]), down: () => this.castDirect(1) },
      { id: 's2', label: short(sk[2]), down: () => this.castDirect(2) },
      { id: 's3', label: short(sk[3]), down: () => this.castDirect(3) },
      { id: 'ult', label: `★<small>${short(sk[4])}</small>`, cls: 'ult', look: true, down: () => this.castDirect(4) },
      { id: 'jump', label: '⤒<small>Nhảy/Bay</small>', down: () => { this.keys.add('Space'); this.jump(); }, up: () => this.keys.delete('Space') },
      { id: 'dash', label: '💨<small>Lướt</small>', down: () => { this.keys.add('ShiftLeft'); this.dash(); }, up: () => this.keys.delete('ShiftLeft') },
      { id: 'heal', label: '✚<small>Hồi máu</small>', down: () => this.tryHeal() },
      { id: 'charge', label: '☯<small>Vận khí</small>', ...hold('KeyU') },
      { id: 'menu', label: '☰', cls: 'mini', down: () => this.onUnlock?.() },
      { id: 'score', label: '🏆', cls: 'mini', down: () => { this.showScore = true; }, up: () => { this.showScore = false; } },
      { id: 'chat', label: '💬', cls: 'mini', down: () => this.openChat() },
    ], 'brawl');
    ['atk', 's1', 's2', 's3', 'ult'].forEach((id, i) =>
      this.touch.buttons.get(id).el.style.setProperty('--c', '#' + sk[i].fx.color.toString(16).padStart(6, '0')));
  }

  castDirect(idx) {
    if (!this.me || this.me.dead) return;
    this.queueCast(idx);
  }

  updateTouchHud(t) {
    const L = this.L, me = this.me, T = this.touch;
    ['atk', 's1', 's2', 's3', 'ult'].forEach((id, i) => {
      const s = me.char.skills[i];
      T.setCooldown(id, ((L.cds[i] || 0) - t) / s.cd, me.mp < s.mana);
    });
    T.setCooldown('heal', (L.healCd - t) / GAME.heal.cd, me.mp < GAME.heal.mana);
    T.setCooldown('dash', (L.dashCd - t) / 0.75, false);
    T.setActive('charge', L.charging);
  }

  // ======================= Combo phím =======================
  comboKey(k) {
    if (!this.me || this.me.dead) return;
    const t = now();
    if (!this.combo.length || t - this.combo[this.combo.length - 1].t > COMBO_WINDOW) this.combo = [];
    this.combo.push({ k, t });
    if (this.combo.length > 4) this.combo.shift();
    this.hud.showCombo(this.combo.map(c => c.k));
    this.resolveCombo(false);
  }

  resolveCombo(timeout) {
    const str = this.combo.map(c => c.k).join('');
    const skills = this.me.char.skills;
    let best = -1;
    for (let i = 0; i < skills.length; i++) {
      const c = skills[i].combo;
      if (str.endsWith(c) && (best < 0 || c.length > skills[best].combo.length)) best = i;
    }
    // còn combo dài hơn có thể xảy ra?
    let tail = '';
    let canExtend = false;
    for (let n = 1; n <= str.length; n++) {
      tail = str.slice(-n);
      if (skills.some(s => s.combo.length > tail.length && s.combo.startsWith(tail))) { canExtend = true; break; }
    }
    if (best < 0) { if (!canExtend) this.combo = []; this.pending = null; return; }
    const s = skills[best];
    if (s.instant || !canExtend || timeout) {
      this.pending = null;
      this.queueCast(best);
      if (!canExtend) this.combo = [];
    } else {
      this.pending = { idx: best, at: now() + COMBO_WAIT };
    }
  }

  queueCast(idx) {
    // nếu đang bận ra chiêu khác thì xếp hàng ngắn
    this.queued = { idx, until: Math.max(now(), this.L.lockUntil) + 0.3 };
  }

  canCast(s, idx) {
    const L = this.L, t = now();
    if (this.me.dead || t < L.stunUntil) return 'stun';
    if (t < (L.cds[idx] || 0)) return 'cd';
    if (this.me.mp < s.mana) return 'mana';
    if (t < L.lockUntil) return 'lock';
    return null;
  }

  // Hướng ngắm: tự khóa mục tiêu gần tâm màn hình
  aimDir() {
    const fwd = v3(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    const me = this.me;
    let best = null, bestScore = Infinity;
    for (const av of this.avatars.values()) {
      if (av.isMe || av.dead) continue;
      const dx = av.pos.x - me.pos.x, dz = av.pos.z - me.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 34 || d < 0.01) continue;
      const cos = (dx * fwd.x + dz * fwd.z) / d;
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      const lim = d < 4 ? 1.2 : 0.42;
      if (ang > lim) continue;
      const score = ang * 3 + d * 0.05;
      if (score < bestScore) { bestScore = score; best = av; }
    }
    for (const av of this.avatars.values()) av.targeted = av === best;
    if (best) {
      const d = v3(best.pos.x - me.pos.x, best.pos.y - me.pos.y, best.pos.z - me.pos.z);
      d.y = Math.max(-0.6, Math.min(0.6, d.y / Math.max(1, Math.hypot(d.x, d.z))));
      const hl = Math.hypot(d.x, d.z) || 1;
      return v3(d.x / hl, d.y, d.z / hl).normalize();
    }
    const dy = this.L.onGround ? 0 : Math.max(-0.5, Math.min(0.2, -this.cam.pitch * 0.6));
    return v3(fwd.x, dy, fwd.z).normalize();
  }

  // Điểm tâm ngắm trong thế giới: tia từ camera qua vòng tâm (#crosshair nằm ở 46% chiều cao).
  // Nếu tia đi sát một đối thủ thì nhắm thẳng vào người đó, không thì lấy điểm chạm đất.
  steerAim() {
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(this._ndc || (this._ndc = new THREE.Vector2(0, 0.08)), this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let best = null, bestAng = 0.09;
    for (const av of this.avatars.values()) {
      if (av.isMe || av.dead) continue;
      const vx = av.pos.x - o.x, vy = av.pos.y + 1 - o.y, vz = av.pos.z - o.z;
      const L = Math.hypot(vx, vy, vz);
      if (L > 40) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * d.x + vy * d.y + vz * d.z) / L)));
      if (ang < bestAng) { bestAng = ang; best = av; }
    }
    if (best) return [best.pos.x, best.pos.y + 1, best.pos.z];
    let dist = 38;
    if (d.y < -0.01) dist = Math.min(dist, o.y / -d.y);
    return [o.x + d.x * dist, Math.max(0, o.y + d.y * dist), o.z + d.z * dist];
  }

  updateSteer(dt, t) {
    const S = this.steering;
    const mk = this.steerMark;
    if (!S || t > S.until || this.me.dead) {
      if (S) this.steering = null;
      if (mk) mk.visible = false;
      document.body.classList.remove('steering');
      return;
    }
    const a = this.steerAim();
    S.st.aim = a;
    S.sendAcc += dt;
    if (S.sendAcc >= 1 / STEER_SEND_HZ) { S.sendAcc = 0; this.net.send({ t: 'steer', a: a.map(v => +v.toFixed(2)) }); }
    // vòng đánh dấu điểm đang lái tới trên mặt đất
    let m = mk;
    if (!m) {
      m = this.steerMark = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.05, 40),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 5;
      this.scene.add(m);
    }
    m.visible = true;
    m.material.color.setHex(S.color);
    m.position.set(a[0], 0.08, a[2]);
    m.scale.setScalar(1 + Math.sin(t * 10) * 0.12);
    document.body.classList.add('steering');
  }

  doCast(idx) {
    const s = this.me.char.skills[idx];
    const L = this.L, t = now();
    const why = this.canCast(s, idx);
    if (why === 'lock') return false;
    if (why) {
      this.hud.denySlot(idx);
      if (why === 'mana') this.hud.toast('Không đủ mana! Giữ U để vận khí', 1000);
      sfx('error');
      return true;
    }
    const d = this.aimDir();
    const h = v3(d.x, 0, d.z).normalize();
    const me = this.me;
    L.cds[idx] = t + s.cd;
    L.lockUntil = t + s.lock;
    if (s.root) L.rootUntil = t + s.lock;
    me.mp -= s.mana;
    me.faceYaw = Math.atan2(h.x, h.z);
    me.faceUntil = t + s.lock;
    me.yaw = me.faceYaw;
    me.model.play(s.pose, s.lock);
    if (s.lunge && L.onGround) { L.vel.x += h.x * s.lunge; L.vel.z += h.z * s.lunge; }
    if (s.leap) { L.vel.y = s.leap; L.onGround = false; }
    if (s.type === 'dash') L.skillDash = { h, dist: s.dist, delay: s.delay, dur: s.dur, t0: t };
    const seed = (Math.random() * 2 ** 31) | 0;
    const cs = this.cs++;
    const p = me.pos.clone();
    const e = this.fx.castSkill({ skill: s, p, d, h, seed, caster: me.casterApi });
    if (e) this.predicted.set(cs, e);
    if (e?.steer) {
      // chiêu cuối: lái theo tâm ngắm cho tới khi chiêu kết thúc
      e.steer.aim = this.steerAim();
      this.steering = { st: e.steer, color: s.fx.color, until: t + skillLifetime(s), sendAcc: 1 };
    }
    this.net.send({ t: 'cast', sk: idx, cs, seed, p: [p.x, p.y, p.z].map(v => +v.toFixed(2)), d: [d.x, d.y, d.z].map(v => +v.toFixed(3)) });
    this.hud.flashSlot(idx);
    sfx(skillSound(s));
    if (L.charging) L.charging = false;
    return true;
  }

  tryHeal() {
    if (!this.me || this.me.dead) return;
    if (now() < this.L.healCd || this.me.mp < GAME.heal.mana) {
      sfx('error');
      this.hud.toast(this.me.mp < GAME.heal.mana ? 'Không đủ mana để hồi máu' : 'Hồi máu đang hồi chiêu', 900);
      return;
    }
    this.L.healCd = now() + GAME.heal.cd;
    this.net.send({ t: 'heal' });
  }

  jump() {
    const L = this.L;
    if (!this.me || this.me.dead || now() < L.stunUntil) return;
    if (L.onGround) {
      L.vel.y = MOVE.jump; L.onGround = false; L.jumps = 1;
      sfx('jump'); this.fx.dust(this.me.pos, 8);
    } else if (L.jumps < 2) {
      L.vel.y = MOVE.doubleJump; L.jumps = 2;
      sfx('jump');
      this.fx.shockwave(this.me.pos, 0xffffff, 1.6, 0.3, 0);
      this.fx.parts.burst(this.me.pos, 12, 0xffffff, { speed: 4, size: 0.3, life: 0.4, flat: true });
    }
  }

  dash() {
    const L = this.L, t = now();
    if (!this.me || this.me.dead || t < L.dashCd || t < L.stunUntil || t < L.rootUntil) return;
    const dir = this.moveDir();
    if (dir.lengthSq() < 0.01) dir.set(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    L.dashDir.copy(dir).normalize();
    L.dashT = MOVE.dashTime;
    L.dashCd = t + MOVE.dashCd;
    L.sprint = true;
    if (!L.onGround) L.vel.y = Math.max(L.vel.y, 2);
    this.net.send({ t: 'dodge' });
    sfx('dash');
  }

  moveDir() {
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    if (this.touch?.enabled) {
      const m = this.touch.move;
      if (Math.hypot(m.x, m.y) > 0.15) { f -= m.y; r += m.x; }
    }
    const yaw = this.cam.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = -fz, rz = fx;
    const v = v3(fx * f + rx * r, 0, fz * f + rz * r);
    if (v.lengthSq() > 0) v.normalize();
    return v;
  }

  // ======================= Vật lý nhân vật của mình =======================
  updateLocal(dt) {
    const me = this.me, L = this.L, t = now();
    if (me.dead) { me.anim = ANIM.dead; return; }
    const stunned = t < L.stunUntil;
    const rooted = t < L.rootUntil;
    const k = this.keys;

    // Vận khí: giữ U khi đứng trên đất
    L.charging = k.has('KeyU') && L.onGround && !stunned && !rooted && t >= L.lockUntil;
    // Bay: giữ Space trên không sau khi đã nhảy đôi
    L.flying = !L.onGround && L.jumps >= 2 && k.has('Space') && me.mp > 1 && !stunned && !L.skillDash;

    const input = stunned || rooted || L.charging ? v3() : this.moveDir();
    L.sprint = L.sprint && (k.has('ShiftLeft') || k.has('ShiftRight')) && input.lengthSq() > 0;
    let speed = (L.sprint ? MOVE.sprint : MOVE.walk) * me.char.speedMul;
    if (t < L.slowUntil) speed *= L.slowMul;
    if (L.flying) speed *= 1.25;

    // Chiêu lao tới: di chuyển cưỡng bức
    const sd = L.skillDash;
    if (sd) {
      const el = t - sd.t0;
      if (el >= sd.delay && el <= sd.delay + sd.dur) {
        const v = sd.dist / sd.dur;
        L.vel.set(sd.h.x * v, 0, sd.h.z * v);
      } else if (el > sd.delay + sd.dur) {
        L.skillDash = null;
        L.vel.x *= 0.15; L.vel.z *= 0.15;
      } else L.vel.set(0, Math.max(0, L.vel.y * 0.5), 0);
    } else if (L.dashT > 0) {
      L.dashT -= dt;
      L.vel.x = L.dashDir.x * MOVE.dashSpeed;
      L.vel.z = L.dashDir.z * MOVE.dashSpeed;
      this.fx.dashTrail(me.pos, L.dashDir);
    } else {
      const ctrl = L.knockT > 0 ? 0.15 : 1;
      L.knockT -= dt;
      const accel = (L.onGround ? 16 : 6) * ctrl;
      const a = Math.min(1, accel * dt);
      L.vel.x += (input.x * speed - L.vel.x) * a;
      L.vel.z += (input.z * speed - L.vel.z) * a;
    }

    // Trọng lực / bay
    if (L.flying) {
      const target = me.pos.y < MOVE.flyMaxHeight ? MOVE.flyRise : 0;
      L.vel.y += (target - L.vel.y) * Math.min(1, dt * 5);
      me.mp -= MOVE.flyManaPerSec * dt;
      if (Math.random() < 0.6) this.fx.parts.emit(me.pos.x, me.pos.y, me.pos.z, (Math.random() - 0.5), -3, (Math.random() - 0.5), me.char.skills[1].fx.color, 0.35, 0.4);
    } else if (!(sd && t - sd.t0 >= sd.delay)) {
      L.vel.y -= MOVE.gravity * dt;
    }

    // Tích phân + va chạm
    const p = me.pos;
    p.x += L.vel.x * dt; p.y += L.vel.y * dt; p.z += L.vel.z * dt;
    for (const [ox, oz, r, h] of ARENA.obstacles) {
      const dx = p.x - ox, dz = p.z - oz, d = Math.hypot(dx, dz);
      if (d < r + BR && p.y < h - 0.3) {
        const s = (r + BR) / (d || 1);
        p.x = ox + dx * s; p.z = oz + dz * s;
      }
    }
    const dc = Math.hypot(p.x, p.z), maxR = ARENA.radius - 0.6;
    if (dc > maxR) { p.x *= maxR / dc; p.z *= maxR / dc; }
    const gy = groundHeight(p.x, p.z, p.y);
    if (p.y <= gy && L.vel.y <= 0) {
      if (!L.onGround && L.vel.y < -8) this.fx.dust(p, 12);
      p.y = gy; L.vel.y = 0; L.onGround = true; L.jumps = 0;
    } else if (p.y > gy + 0.05) {
      if (L.onGround && L.vel.y <= 0) { L.jumps = Math.max(L.jumps, 1); }
      L.onGround = false;
    }
    if (p.y > MOVE.flyMaxHeight + 2) { p.y = MOVE.flyMaxHeight + 2; L.vel.y = Math.min(0, L.vel.y); }

    // Hướng mặt theo hướng di chuyển
    const hs = Math.hypot(L.vel.x, L.vel.z);
    if (hs > 0.5 && t >= me.faceUntil) me.yaw = angLerp(me.yaw, Math.atan2(L.vel.x, L.vel.z), Math.min(1, dt * 14));
    me.speed = hs;

    // Trạng thái hoạt ảnh
    let a = ANIM.idle;
    if (stunned) a = ANIM.stun;
    else if (L.charging) a = ANIM.charge;
    else if (L.dashT > 0 || (sd && t - sd.t0 >= sd.delay)) a = ANIM.dash;
    else if (L.flying) a = ANIM.fly;
    else if (!L.onGround) a = ANIM.air;
    else if (t < me.healUntil && hs < 1) a = ANIM.heal;
    else if (hs > 1) a = L.sprint ? ANIM.sprint : ANIM.run;
    me.anim = a;
    if (L.sprint && L.onGround && hs > 8 && Math.random() < 0.3) this.fx.dust(p, 2);

    // Combo chờ + hàng đợi chiêu
    if (this.pending && t >= this.pending.at) { this.pending = null; this.resolveCombo(true); }
    if (this.queued) {
      if (t > this.queued.until) this.queued = null;
      else if (this.doCast(this.queued.idx)) this.queued = null;
    }

    // Gửi trạng thái
    if (this.sendT.due(dt)) {
      this.net.send({ t: 's', p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], r: +me.yaw.toFixed(2), a,
        f: (L.flying ? 1 : 0) | (L.charging ? 2 : 0) });
    }
  }

  // ======================= Camera =======================
  updateCamera(dt) {
    const me = this.me;
    const c = this.cam;
    const target = v3(me.pos.x, me.pos.y + 1.5, me.pos.z);
    const cp = Math.cos(c.pitch);
    const want = v3(
      target.x + Math.sin(c.yaw) * cp * c.dist,
      target.y + Math.sin(c.pitch) * c.dist,
      target.z + Math.cos(c.yaw) * cp * c.dist,
    );
    want.y = Math.max(0.4, want.y);
    c.pos.lerp(want, Math.min(1, dt * 14));
    this.camera.position.copy(c.pos);
    const sh = this.fx.shakeAmt * this.settings.shake;
    if (sh > 0) this.camera.position.add(v3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    // nhìn hơi lệch lên để thấy phía trước
    this.camera.lookAt(target.x, target.y + 0.4, target.z);
  }

  // ======================= Vòng lặp =======================
  loop() {
    requestAnimationFrame(this.loop);
    const t = now();
    const dt = Math.min(0.05, t - this.lastT);
    this.lastT = t;
    if (this.suspended) return;

    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      $('fps').textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS';
      $('ping').textContent = this.net.ping + ' ms';
      this.fpsAcc = 0; this.fpsN = 0;
    }

    if (this.active && this.me) {
      if (this.touch?.enabled) {
        const lk = this.touch.takeLook();
        this.cam.yaw -= lk.dx * 0.006 * this.settings.sens;
        this.cam.pitch = Math.max(-0.35, Math.min(1.25, this.cam.pitch + lk.dy * 0.005 * this.settings.sens));
        this.updateTouchHud(t);
      }
      this.updateLocal(dt);
      for (const av of this.avatars.values()) {
        if (!av.isMe) av.interpolate();
        av.render(dt);
        // hào quang vận khí
        if (!av.dead && (av.isMe ? this.L.charging : av.flags & 2)) this.fx.aura(av.pos, av.char.look.aura || av.char.skills[1].fx.color, dt);
      }
      this.updateCamera(dt);
      this.aimDir();   // cập nhật mục tiêu đang khóa
      this.updateSteer(dt, t);
      const L = this.L;
      this.hud.updateBars(this.me.hp, this.me.mp, t, L.cds, L.healCd, L.dashCd, this.me.mp, L.charging);
      this.hud.updatePlates(this.avatars.values(), this.camera, innerWidth, innerHeight);
      this.hud.scoreboard(this.avatars.values(), !!this.showScore);
      $('playerCount').textContent = this.avatars.size + ' người chơi';
      if (this.me.dead) this.hud.death(true, this.killer, GAME.respawnTime - (t - (this.deathAt || t)));
      $('stunned').hidden = !(t < L.stunUntil);
    } else {
      // màn hình chờ: camera quay quanh đấu trường
      const a = t * 0.08;
      this.camera.position.set(Math.sin(a) * 32, 14, Math.cos(a) * 32);
      this.camera.lookAt(0, 2, 0);
    }

    this.fx.update(dt);
    this.world.update(dt, t);
    if (this.bloom.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
