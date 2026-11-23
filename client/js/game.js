// Lõi game phía client: render, điều khiển, combo, đồng bộ mạng.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { NET, Ticker, GAME, MOVE, ARENA, TEAM, AWAKEN, arenaGround, arenaCollide, dynCollide } from '/shared/config.js';
import { getArena } from '/shared/arenas.js';
import { getChar, charSkills, skillLifetime, holdSkill } from '/shared/characters.js';
import { STEER_SEND_HZ } from '/shared/steer.js';
import { buildChibi, ANIM } from './chibi.js';
import { FX } from './effects.js';
import { buildWorld } from './world.js';
import { HUD, $, esc, hex, lockPointer } from './ui.js';
import { sfx, skillSound } from './audio.js';
import { translate, actionKey, comboKey } from './keys.js';

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
    this.awk = data.awk || 0;          // thanh dị biến 0..100
    this.fk = data.fk || null;         // người chơi giả: 'dummy' | 'bot' | 'decoy' | 'pet' (phân thân chỉ lộ với chủ và đồng đội)
    this.ms = data.ms || 0;            // chủ của phân thân / người cây
    if (this.fk === 'decoy') this.name = '👤 Phân thân';
    this.awUntil = 0; this.tiredUntil = 0;
    this.setChar(data.char);
    if (data.aw > 0) { this.awUntil = now() + data.aw; this.setForm(true); }
    const self = this;
    this.casterApi = {
      pos: () => self.pos,
      hand: () => { self.model.rig.handR.getWorldPosition(self._hand); return self._hand; },
    };
  }

  setChar(id) {
    this.char = getChar(id);
    this.aw = false;
    this.awUntil = 0;
    this.rebuild();
  }

  // Dựng lại hình nhân vật (dạng thường / dạng dị biến)
  rebuild() {
    this.model?.dispose();
    const A = this.char.awaken;
    this.model = buildChibi(this.aw && A ? { ...this.char.look, ...A.look, form: A.form, formColor: A.color, formCore: A.core } : this.char.look);
    this.game.scene.add(this.model.root, this.model.rig.shadow);
  }

  setForm(on) {
    if (!!on === this.aw) return;
    this.aw = !!on;
    this.rebuild();
  }

  // bộ chiêu đang dùng (thường / dị biến)
  get skills() { return charSkills(this.char, this.aw); }

  dispose() { this.model.dispose(); }

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
          if (f.st && f.st.y != null) this.pos.y = f.st.y;   // rồng lốc lái cả độ cao
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
    const t = now();
    const stealth = !!(this.buff?.stealth && t < this.buff.until);
    // đối thủ đang tàng hình: ẩn hẳn (đồng đội và chính mình vẫn thấy, có khói tím)
    this.hidden = stealth && !this.isMe && !this.game.isAlly(this);
    m.root.visible = !this.hidden;
    m.rig.shadow.visible = !this.dead && !this.hidden;
    const fx = this.game.fx;
    if (stealth && !this.hidden && Math.random() < 0.5) {
      fx.parts.emit(this.pos.x + (Math.random() - 0.5), this.pos.y + Math.random() * 1.8, this.pos.z + (Math.random() - 0.5), 0, 0.6, 0, 0x3c096c, 0.7, 0.6, { drag: 1 });
    }
    if (this.hidden && Math.random() < 0.04) {
      // dấu vết rất mờ để người chơi tinh mắt vẫn đoán được
      fx.parts.emit(this.pos.x, this.pos.y + 0.2, this.pos.z, 0, 0.3, 0, 0x5a189a, 0.25, 0.5);
    }
    // giáp đá: bụi đá rơi lả tả
    if (this.buff?.kind === 'stoneSkin' && t < this.buff.until && Math.random() < 0.3) {
      fx.parts.emit(this.pos.x + (Math.random() - 0.5) * 1.2, this.pos.y + 1 + Math.random(), this.pos.z + (Math.random() - 0.5) * 1.2, 0, -1, 0, 0xb08968, 0.25, 0.6, { grav: 6 });
    }
    // dấu điện Shiden: các tia nhỏ quay quanh đầu
    const mk = this.marks;
    if (mk && t < mk.until && !this.dead && !this.hidden) {
      for (let i = 0; i < mk.n; i++) {
        const a = t * 6 + i * Math.PI * 2 / mk.n;
        fx.parts.emit(this.pos.x + Math.cos(a) * 0.7, this.pos.y + 2.3, this.pos.z + Math.sin(a) * 0.7, 0, 0, 0, 0xfff3a0, 0.28, 0.08);
      }
    } else if (mk) this.marks = null;
    // dị biến: hạt bay quanh người theo từng dạng
    if (this.aw && !this.dead && !this.hidden) formParticles(fx, this, t, dt);
  }
}

// Hạt trang trí quanh nhân vật đang dị biến (ít hạt ở chất lượng thấp)
function formParticles(fx, av, t, dt) {
  const A = av.char.awaken, P = fx.parts, p = av.pos;
  const n = Math.random() < dt * 40 * fx.quality ? 1 : 0;
  if (!n) return;
  const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.6;
  const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, y = p.y + Math.random() * 1.8;
  switch (A.form) {
    case 'windGod': P.emit(x, y, z, -Math.sin(a) * 4, 1, Math.cos(a) * 4, Math.random() < 0.5 ? 0xffffff : A.color, 0.25, 0.5, { drag: 1 }); break;
    case 'magma': P.emit(x, p.y + 0.2 + Math.random(), z, 0, 2.5 + Math.random() * 2, 0, Math.random() < 0.3 ? 0xffe066 : 0xff5400, 0.28, 0.6, { drag: 0.5 }); break;
    case 'flameEmpress': P.emit(x, y, z, 0, 3 + Math.random() * 2, 0, Math.random() < 0.3 ? 0xffd60a : 0xff5400, 0.35, 0.5, { drag: 0.6 }); break;
    case 'iceQueen': P.emit(x, p.y + 2.2, z, (Math.random() - 0.5), -1.2, (Math.random() - 0.5), 0xffffff, 0.22, 1.4, { drag: 0.4 }); break;
    case 'thunderGod': P.emit(x, y, z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, Math.random() < 0.5 ? 0xfff3a0 : A.color, 0.2, 0.15); break;
    case 'forestSoul': P.emit(x, p.y + 0.1, z, (Math.random() - 0.5) * 0.6, 0.8, (Math.random() - 0.5) * 0.6, Math.random() < 0.5 ? 0xff8fab : 0x95d5b2, 0.3, 1, { drag: 0.6 }); break;
    case 'mountain': P.emit(x, y, z, 0, -1, 0, Math.random() < 0.5 ? 0xb08968 : 0x7f5539, 0.3, 0.7, { grav: 6 }); break;
    case 'thousandShadows': P.emit(x, p.y + Math.random() * 1.6, z, 0, 0.7, 0, Math.random() < 0.2 ? A.core : 0x10002b, 0.6, 0.7, { drag: 1 }); break;
  }
}

// Độ cao mặt đất tại (x,z) – tính cả mặt trên chướng ngại vật
let curArena = ARENA;   // map của phòng hiện tại
function clampArena(x, z) {
  const R = curArena.radius - 1.2, d = Math.hypot(x, z);
  return d > R ? [x / d * R, z / d * R] : [x, z];
}
// điểm (x, y, z) có nằm trong cột / hộp của map hoặc chướng ngại vật tạm thời không (để camera tránh)
function camBlocked(x, y, z, dyn) {
  const m = 0.35;
  for (const [ox, oz, r, h] of curArena.obstacles) if (y < h + m && Math.hypot(x - ox, z - oz) < r + m) return true;
  for (const [bx, bz, hw, hd, h] of curArena.boxes || []) if (y < h + m && Math.abs(x - bx) < hw + m && Math.abs(z - bz) < hd + m) return true;
  for (const o of dyn) if (!o.noBody && y < o.h + m && Math.hypot(x - o.x, z - o.z) < o.r + m) return true;
  return false;
}
let curDyn = [];        // chướng ngại vật tạm thời phía client (fx.dynObs): nóc cột đá đứng lên được
function groundHeight(x, z, y) {
  let g = arenaGround(curArena, x, z, y, BR);
  for (const o of curDyn) if (!o.noBody && y >= o.h - 0.3 && Math.hypot(x - o.x, z - o.z) < o.r + BR * 0.4) g = Math.max(g, o.h);
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
    this.world = buildWorld(this.scene, ARENA);
    this.fx = new FX(this.scene, this.camera);
    curDyn = this.fx.dynObs;
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

    this.kmarks = new Map();   // dấu phi đao đang hiện: id người chơi -> hiệu ứng
    // độ đã mắt: khựng hình khi trúng đòn mạnh, góc nhìn rộng ra thoáng chốc, theo dõi pha tụ lực tuyệt kỹ
    this.hitstopUntil = 0; this.lastStop = 0; this.fovK = 0;
    this.charges = [];
    this.props = new Map();    // công trình (cọc sét, cột đá): id -> { k, o, x, y, z, r, h, hp, fx }
    this.zones = new Map();    // vùng trên sàn (lửa, băng, ngưng đọng): id -> { k, o, x, y, z, r, until, mul, fx }
    this.fx.zoneList = [];
    // hệ số tốc độ đạn của chủ owner tại (x, z): vùng ngưng đọng của đối phương làm chậm (dùng cho hiệu ứng đạn)
    this.fx.zoneSlow = (x, z, owner) => {
      let k = 1;
      for (const zn of this.fx.zoneList) if (zn.k === 'slow' && zn.o !== owner && !this.allyId(zn.o, owner) && Math.hypot(x - zn.x, z - zn.z) < zn.r) k = Math.min(k, zn.mul);
      return k;
    };
    this.bindNet();
    this.bindInput();
    this.bindTeamUi();
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
    this.setArena(getArena(msg.room.map));
    this.teamMode = !!msg.room.team;
    this.practice = !!msg.room.practice;
    $('fillAwkBtn').hidden = !this.practice;
    this.darkUntil = 0;
    this.ts = null;
    this.hideTeamUi();
    this.active = true;
    this.myId = msg.you;
    this.roomId = msg.room.id;
    for (const p of msg.players) this.addAvatar(p);
    this.me = this.avatars.get(this.myId);
    this.resetLocal();
    this.hud.setRoom(msg.room.name);
    this.refreshSkills();
    this.hud.show(true);
    this.cam.yaw = Math.atan2(this.me.pos.x, this.me.pos.z);
    $('chatlog').innerHTML = '';
    this.setupTouch();
    for (const pr of msg.props || []) this.onProp(pr);
    for (const zn of msg.zones || []) this.onZone(zn);
  }

  // Nền menu: dựng map đối kháng đang chọn
  setMenuArena(id) { if (!this.active) this.setArena(getArena(id)); }

  // Dựng lại cảnh khi vào phòng có map khác
  setArena(a) {
    curArena = a;
    this.fx.arena = a;
    if (this.world.arena === a) return;
    this.world.dispose();
    this.world = buildWorld(this.scene, a);
  }

  leave() {
    this.active = false;
    this.teamMode = false;
    this.hideTeamUi();
    this.clear();
    // rời phòng giữa lúc lái tuyệt kỹ: tắt vòng ngắm và chế độ lái (updateSteer không chạy khi đã rời)
    this.steering = null;
    if (this.steerMark) this.steerMark.visible = false;
    document.body.classList.remove('steering');
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
    this.kmarks.clear();
    this.props.clear();
    this.charges = [];
    this.zones.clear();
    this.fx.zoneList.length = 0;
    this.fx.fences([], 0);
    this.setDark(false);
    this.me = null;
  }

  addAvatar(p) {
    const av = new Avatar(this, p, p.id === this.myId);
    av.team = p.team || null;
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
      if (!av) return;
      // phân thân / người cây biến mất
      if (m.why === 'expire' || m.why === 'die') this.fx.parts.burst(v3(av.pos.x, av.pos.y + 1, av.pos.z), 30, av.fk === 'pet' ? 0x74c69d : 0x240046, { speed: 5, size: 0.6, life: 0.7, up: 1 });
      av.dispose(); this.avatars.delete(m.id); this.hud.removePlate(m.id);
    });
    n.on('pchar', m => {
      const av = this.avatars.get(m.id);
      if (!av) return;
      av.setChar(m.char);
      if (av.isMe) { this.refreshSkills(); this.L.cds = []; }
    });
    n.on('snap', m => {
      if (!this.active) return;
      for (const [id, x, y, z, yaw, anim, hp, mp, flags, awk] of m.ps) {
        const av = this.avatars.get(id);
        if (!av) continue;
        av.hp = hp; av.mp = mp; av.awk = awk || 0;
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
      if (e) {
        e.done = true; e.endAll?.(); this.predicted.delete(m.cs);
        if (e.steer && this.steering?.st === e.steer) this.steering = null;
      }
      if (this.L) {
        this.L.cds[m.sk + (m.aw ? 10 : 0)] = 0;
        // server từ chối: huỷ cả cú lướt/nhảy đã chạy trước ở máy mình (không thì lướt tới mà không gây sát thương)
        const s = this.me && charSkills(this.me.char, !!m.aw)[m.sk];
        if (s?.type === 'dash') this.L.skillDash = null;
        if (s?.type === 'leap') this.L.skillLeap = null;
      }
      if (this.me) this.me.mp = m.mp;
    });
    n.on('pend', m => this.effects.get(m.eid)?.endSub?.(m.k, m.at, m.fire));
    n.on('steer', m => { const st = this.effects.get(m.eid)?.steer; if (st) st.aim = m.a; });
    n.on('boom', m => {
      const e = this.effects.get(m.eid);
      if (m.k != null && e?.endSub) e.endSub(m.k, m.at); else e?.endAll?.();
      this.fx.explosion(v3(...m.at), m.c, m.r);
      sfx('explosion', this.distToCam(m.at));
      // vụ nổ lớn (tuyệt kỹ): cột năng lượng, vết cháy, khói; gần camera thì góc nhìn giật ra
      if (m.r >= 4.5) {
        this.fx.ultImpact(v3(...m.at), m.c, m.c, m.r);
        if (this.distToCam(m.at) < 28) this.fovKick(3);
      }
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
      av.dead = false; av.hp = av.char.hp || GAME.maxHp;
      av.buff = null; av.marks = null;
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
    n.on('tstate', m => { if (this.active && this.teamMode) this.onTeamState(m); });
    // dịch chuyển tức thời (Thuấn Ảnh, Lôi Long Xuyên)
    n.on('tp', m => {
      const av = this.avatars.get(m.id);
      if (!av) return;
      const from = v3(...m.from), to = v3(...m.p);
      const sk = av.skills, s = sk.find(q => q.type === 'blink' || q.type === 'multiblink' || q.teleport) || sk[2];
      this.fx.blinkFx(from, to, s.fx.color, s.fx.core || 0xffffff);
      if (s.fx.kind === 'thunderStep') this.fx.judgement(v3(to.x, to.y + 1, to.z), s.fx.color, true);   // Lôi Độn: sét giáng xuống chỗ tới
      av.pos.copy(to);
      av.buf.length = 0; av.pushSnap(to.x, to.y, to.z, av.yaw);
      av.forced = null;
      if (av.isMe) { this.L.vel.set(0, 0, 0); this.L.skillDash = null; }
    });
    // tăng chỉ số tạm thời: giáp đá, tàng hình
    n.on('buff', m => {
      const av = this.avatars.get(m.id);
      if (!av) return;
      if (m.kind) av.buff = { kind: m.kind, until: now() + m.dur, stealth: !!m.stealth };
      else {
        if (av.buff?.stealth) this.fx.parts.burst(v3(av.pos.x, av.pos.y + 1, av.pos.z), 24, 0x7b2cbf, { speed: 4, size: 0.5, life: 0.5 });
        av.buff = null;
        // tắt hiệu ứng giáp đá còn đang chạy
        for (const e of this.fx.list) if (e.buffOf === av.id) e.done = true;
      }
    });
    // dấu điện của Shiden trên mục tiêu
    n.on('mark', m => {
      const av = this.avatars.get(m.tid);
      if (av) av.marks = m.n ? { n: m.n, until: now() + m.dur } : null;
    });
    // sét nảy (chain) / sét giáng từ trời xuống từng người (sky) / sét nảy tiếp từ người đã trúng (nosky)
    n.on('chain', m => {
      for (let i = 0; i < m.pts.length; i++) {
        const b = v3(...m.pts[i]);
        if (m.sky) { this.fx.judgement(b, m.c, i === 0); if (i < 3) this.fx.ultImpact(b, m.c, m.c, 2.8); continue; }
        if (!i && m.nosky) continue;
        const a = i ? v3(...m.pts[i - 1]) : v3(b.x, b.y + 9, b.z);
        this.fx.bolt(a, b, m.c, 0xfff7c2, 0.08, i === 0);
      }
      sfx(m.sky ? 'explosion' : 'beam', this.distToCam(m.pts[0]));
    });
    // dị biến bật / tắt
    n.on('awk', m => this.onAwaken(m));
    n.on('awkno', m => { sfx('error'); if (this.me) this.me.awk = m.awk; this.hud.toast('Thanh dị biến chưa đầy!', 900); });
    // dấu phi đao của Kage
    n.on('kmark', m => {
      const old = this.kmarks.get(m.id);
      if (old) { old.done = true; this.kmarks.delete(m.id); }
      if (m.p) this.kmarks.set(m.id, this.fx.groundMarker(v3(m.p[0], 0.05, m.p[1]), 0x9d4edd, m.dur));
    });
    // công trình: tạo / mất máu / biến mất
    n.on('prop', m => this.onProp(m));
    // hiệu ứng rời: phân thân gió, mảnh đá cột vỡ, vòng sét từ cọc
    n.on('pulse', m => {
      let i = 0;
      for (const pt of m.pts) {
        const p = v3(...pt);
        if (m.k === 'windClone') { this.fx.windClone(p, m.c); sfx('swing', this.distToCam(p)); }
        else if (m.k === 'rock') { this.fx.rockBurst(p, m.c, m.r); sfx('explosion', this.distToCam(p)); }
        else if (m.k === 'flame') { this.fx.flameBurst(p, m.c, m.r); if (i++ < 3) sfx('fire', this.distToCam(p)); }
        else if (m.k === 'shadowPop') { this.fx.shadowPop(p, m.c, m.r); sfx('wind', this.distToCam(p)); }
        else if (m.k === 'iceBurst') { this.fx.iceBurst(p, m.c, m.r); sfx('ice', this.distToCam(p)); }
        else if (m.k === 'slam') { this.fx.shockwave(p, m.c, m.r * 1.3, 0.4); this.fx.dust(p, 24); this.fx.shake(0.4, p); sfx('bigHit', this.distToCam(p)); }
        else { this.fx.zapRing(p, m.c, m.r); sfx('beam', this.distToCam(p)); }
      }
    });
    // né được động đất (đang ở trên không)
    n.on('evade', m => {
      const av = this.avatars.get(m.id);
      if (!av) return;
      this.hud.dmgNumber(v3(av.pos.x, av.pos.y + 1.6, av.pos.z), 'NÉ!', 'other', this.camera, innerWidth, innerHeight);
      if (av.isMe) this.hud.toast('Né được động đất! 🦘', 900);
    });
    // vùng trên sàn (lửa / băng / ngưng đọng)
    n.on('zone', m => this.onZone(m));
    // bị túm (dị biến Raiga): vị trí do người túm quyết định
    n.on('grab', m => {
      if (m.id !== this.myId || !this.L) return;
      const L = this.L;
      L.grab = { by: m.by, t0: now(), dur: m.dur, slam: m.slam };
      L.stunUntil = Math.max(L.stunUntil, now() + m.dur);
      L.skillDash = null; L.skillLeap = null;
      this.cancelHold();
      this.hud.toast('Bị túm!', 800);
    });
    // người khác bắt đầu giữ phím tụ lực
    n.on('hold', m => {
      const av = this.avatars.get(m.id), s = av?.skills[m.sk];
      if (!s) return;
      if (av.holdFx) av.holdFx.done = true;
      av.holdFx = this.fx.chargeUp(() => av.pos, s.fx.color, s.fx.core || 0xffffff, m.max);
      av.model.play('raise', m.max);
    });
    // Homura hồi sinh từ tro tàn
    n.on('revive', m => {
      const av = this.avatars.get(m.id);
      if (!av) return;
      av.hp = m.hp;
      this.fx.flameBurst(av.pos, 0xff5400, 3);
      this.fx.awakenBurst(() => av.pos, 0xff5400, 0xffd60a, 0.3);
      sfx('respawn', this.distToCam(av.pos));
      if (av.isMe) this.hud.toast('🔥 Hồi sinh từ tro tàn!', 1600);
    });
    // sương đêm (dị biến Kage): chỉ thấy người trong bán kính see
    n.on('dark', m => {
      const by = this.avatars.get(m.by);
      if (by) this.fx.parts.burst(v3(by.pos.x, by.pos.y + 1, by.pos.z), 60, 0x10002b, { speed: 12, size: 1.2, life: 1.2, drag: 1.5 });
      if (!m.ids.includes(this.myId)) return;
      this.darkSee = m.see;
      this.darkUntil = now() + m.dur;
      this.setDark(true);
      this.hud.toast(`🌑 Sương đêm! Chỉ nhìn thấy người trong ${m.see} m`, 1500);
    });
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
    let s = charSkills(av.char, !!m.aw)[m.sk];
    if (!s) return;
    if (m.rp && s.ripSkill) s = s.ripSkill;   // nhổ cột đá ném
    if (m.hk) s = holdSkill(s, m.hk);          // giữ phím tụ lực
    if (av.holdFx) { av.holdFx.done = true; av.holdFx = null; }
    // đạn do cây bắn gai bắn ra (không phải người ra chiêu)
    if (m.sub === 'tur') {
      const ts = s.shot;
      if (!ts) return;
      const e = this.fx.castSkill({ skill: ts, p: v3(...m.p), d: v3(...m.d), h: v3(m.d[0], 0, m.d[2]).normalize(), seed: m.seed, caster: { pos: () => v3(...m.p), hand: () => v3(m.p[0], m.p[1] + 1.3, m.p[2]) }, owner: av.id, team: av.team });
      if (e) { this.effects.set(m.eid, e); setTimeout(() => this.effects.delete(m.eid), 4000); }
      sfx('throw', this.distToCam(m.p));
      return;
    }
    // xoá eid sau khi chiêu chắc chắn đã hết (cả chiêu của mình, nếu không map tăng mãi theo mỗi lần ra chiêu)
    setTimeout(() => this.effects.delete(m.eid), Math.max(8000, (skillLifetime(s) + 1) * 1000));
    if (av.isMe) {
      // chiêu của mình: đã hiện trước rồi, chỉ cần gắn eid để nhận sự kiện kết thúc
      const e = this.predicted.get(m.cs);
      if (e) { this.effects.set(m.eid, e); this.predicted.delete(m.cs); if (m.tg) e.retarget?.(m.tg); }
      if (m.tg && this.L.skillLeap) this.L.skillLeap.to.set(m.tg[0], 0, m.tg[1]);
      av.mp = m.mp;
      return;
    }
    const d = v3(...m.d), p = v3(...m.p);
    const h = v3(d.x, 0, d.z).normalize();
    av.faceYaw = Math.atan2(h.x, h.z);
    av.faceUntil = now() + s.lock;
    av.model.play(s.pose, s.lock);
    // lướt 3 chiều (free3d): để nội suy theo snapshot lo, không ép đường lao ngang
    if (s.type === 'dash' && !s.free3d) av.forced = { p, h, dist: s.dist, delay: s.delay, dur: s.dur, t0: now(), steer: !!s.steer };
    const e = this.fx.castSkill({ skill: s, p, d, h, seed: m.seed, tg: m.tg, caster: av.casterApi, owner: av.id, team: av.team, seekTargets: () => this.seekTargets(av) });
    if (e) { this.effects.set(m.eid, e); if (s.type === 'buff') e.buffOf = av.id; }
    if (av.forced && e?.steer) av.forced.st = e.steer;   // rồng lốc lái cả độ cao
    this.ultCue(av, s, p, h, m.tg, e);
    if (s.type === 'quake' && !this.isAlly(av)) this.hud.toast(`⚠ ${av.name} sắp động đất cả sân — nhảy lên để né!`, 1500);
    sfx(skillSound(s), this.distToCam(p));
  }

  onHit(m) {
    const tgt = this.avatars.get(m.tid);
    if (!tgt) return;
    // đòn mạnh có mình tham gia (đánh hoặc bị đánh): khựng hình + góc nhìn giật nhẹ
    if (m.dmg >= 14 && (tgt.isMe || m.sid === this.myId)) {
      this.hitstop(m.dmg >= 26 ? 0.1 : 0.055);
      this.fovKick(m.dmg >= 26 ? 2.5 : 1.2);
    }
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
    // nội tại dị biến: quan tài băng / đóng băng cộng dồn / bỏng
    if (m.frz || m.fx === 'iceTomb') this.fx.iceBlock(() => (tgt.dead || !this.avatars.has(tgt.id) ? null : tgt.pos), m.stun || 1);
    else if (m.frost) this.fx.parts.burst(at, 6 * m.frost, 0xe0f7ff, { speed: 2, size: 0.3, life: 0.6 });
    if (m.burn) this.fx.parts.burst(at, 8, 0xff7b00, { speed: 3, size: 0.35, life: 0.5, up: 1 });
    if (m.fx === 'burn') this.fx.parts.burst(at, 5, 0xff5400, { speed: 2, size: 0.3, life: 0.4, up: 1.5 });
  }

  // ======================= Độ đã mắt =======================
  // khựng hình: hiệu ứng và hoạt ảnh gần như đứng lại trong chốc lát (không quá 4 lần / giây)
  hitstop(d) {
    const t = now();
    if (t - this.lastStop < 0.25) return;
    this.lastStop = t;
    this.hitstopUntil = t + d;
  }
  fovKick(a) { this.fovK = Math.max(this.fovK, a); }

  // Tuyệt kỹ (JKL) của mình hoặc người ở gần: theo dõi pha tụ lực, thời điểm bung chiêu và chỗ nổ
  ultCue(av, s, p, h, tg, e) {
    if (s.combo !== 'JKL' || !this.me) return;
    if (!av.isMe && av.pos.distanceTo(this.me.pos) > 32) return;
    const c = { av, s, t0: now(), p: p.clone(), h: h.clone(), e, released: false, impactAt: null, R: 4, at: null };
    const front = off => () => v3(c.p.x + c.h.x * off, 0, c.p.z + c.h.z * off);
    switch (s.type) {
      case 'aoe': c.at = s.at === 'front' ? front(s.offset) : () => av.pos; c.impactAt = s.delay; c.R = s.radius; break;
      case 'rain': c.at = () => (e?.steer ? v3(e.steer.c[0], 0, e.steer.c[2]) : front(s.offset)()); c.impactAt = s.delay + (s.fall || 0) + s.count * s.interval * 0.4; c.R = s.area; break;
      case 'dash': if (!s.explode) { c.at = () => av.pos; c.impactAt = s.delay + s.dur; c.R = s.radius * 1.6; } break;
      case 'quake': c.at = () => av.pos; c.impactAt = s.delay; c.R = 8; break;
      case 'timezone': c.at = () => av.pos; c.impactAt = s.delay; c.R = 6; break;
      case 'pet': c.at = front(s.offset); c.impactAt = s.delay; c.R = s.radius; break;
      case 'summon': c.at = tg ? () => v3(tg[0], 0, tg[1]) : front(s.offset); c.impactAt = s.delay; c.R = s.radius; break;
      case 'multiblink': c.at = () => av.pos; c.impactAt = s.delay + s.strikes * s.interval; c.R = 4; break;
    }
    this.charges.push(c);
  }

  updateCharges(t) {
    let best = null, bk = 0;
    for (const c of this.charges) {
      const el = t - c.t0, s = c.s;
      if (!c.released && el >= s.delay) { c.released = true; this.ultRelease(c); }
      if (!c.released && !c.av.dead && !c.av.hidden) {
        const k = Math.min(1, el / Math.max(0.25, s.delay)) * (c.av.isMe ? 1 : 0.6);
        if (k > bk) { bk = k; best = c; }
      }
      if (c.at && !c.impacted && el >= c.impactAt) {
        c.impacted = true;
        const at = c.at();
        this.fx.ultImpact(at, s.fx.color, s.fx.core || s.fx.color, c.R);
        if (this.distToCam(at) < 28) this.fovKick(c.av.isMe ? 4 : 2.5);
      }
    }
    if (this.charges.length) this.charges = this.charges.filter(c => t - c.t0 < c.s.delay + 5);
    // màn hình tối dần quanh người đang tụ lực (chỉ chừa sáng quanh họ)
    const el = $('chargeVig');
    if (best) {
      const v = this._vv || (this._vv = new THREE.Vector3());
      v.set(best.av.pos.x, best.av.pos.y + 1, best.av.pos.z).project(this.camera);
      el.style.setProperty('--cx', ((v.x + 1) * 50).toFixed(1) + '%');
      el.style.setProperty('--cy', ((1 - v.y) * 50).toFixed(1) + '%');
      el.style.opacity = (bk * 0.85).toFixed(2);
    } else if (el.style.opacity !== '0') el.style.opacity = '0';
  }

  // Bung tuyệt kỹ: chớp màu của chiêu, góc nhìn giật ra, khựng hình (chiêu của mình)
  ultRelease(c) {
    const s = c.s, me = c.av.isMe;
    const f = $('chargeFlash');
    f.style.setProperty('--fc', '#' + s.fx.color.toString(16).padStart(6, '0'));
    f.style.setProperty('--fo', me ? '0.26' : '0.14');
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
    this.fovKick(me ? 7 : 4);
    if (me) { this.lastStop = 0; this.hitstop(0.07); }
    this.fx.shake(me ? 0.45 : 0.25, c.av.pos);
  }

  // id a và b cùng phe (chủ + phân thân / người cây, hoặc cùng đội)
  allyId(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const A = this.avatars.get(a), B = this.avatars.get(b);
    if (!A || !B) return false;
    if ((A.ms || a) === (B.ms || b)) return true;
    return this.teamMode && !!A.team && A.team === B.team;
  }

  // ======================= Vùng trên sàn =======================
  onZone(m) {
    const zn = { id: m.id, k: m.k, o: m.o, x: m.p[0], y: m.p[1], z: m.p[2], r: m.r, until: now() + m.dur, mul: m.mul || 1 };
    if (m.k !== 'slow') zn.fx = this.fx.zone(zn, m.dur);
    this.zones.set(m.id, zn);
    this.fx.zoneList.push(zn);
  }

  // Ảnh hưởng của vùng lên chính mình: băng của đối phương = trơn trượt, băng của mình = chạy nhanh, ngưng đọng = chậm
  zoneEffect(p) {
    const t = now(), out = { ice: false, ownIce: false, slow: 1 };
    let dead = false;
    for (const zn of this.fx.zoneList) {
      if (t >= zn.until) { dead = true; continue; }
      if (Math.hypot(p.x - zn.x, p.z - zn.z) > zn.r) continue;
      const mine = this.allyId(zn.o, this.myId);
      if (zn.k === 'ice' && p.y - zn.y < 0.4) { if (mine) out.ownIce = true; else out.ice = true; }
      if (zn.k === 'slow' && !mine) out.slow = Math.min(out.slow, zn.mul);
    }
    if (dead) {
      this.fx.zoneList = this.fx.zoneList.filter(zn => t < zn.until);
      for (const [id, zn] of this.zones) if (t >= zn.until) this.zones.delete(id);
    }
    return out;
  }

  // Sương đêm: phủ sương tối quanh màn hình + sương mù trong cảnh (chỉ thấy gần)
  setDark(on) {
    const el = $('darkfog');
    if (el) el.hidden = !on;
    if (on) {
      if (!this._darkFog) this._fog0 = this.scene.fog;
      this._darkFog = this.scene.fog = new THREE.Fog(0x0d0618, 1.5, (this.darkSee || 6) + 5);
    } else if (this._darkFog) {
      this.scene.fog = this._fog0 || null;
      this._darkFog = null;
    }
  }

  cancelHold() {
    const L = this.L;
    if (!L?.holding) return;
    L.holding = null;
    L.lockUntil = 0; L.rootUntil = 0;
    if (L.holdFx) { L.holdFx.done = true; L.holdFx = null; }
  }

  // ======================= Công trình (cọc sét, cột đá) =======================
  onProp(m) {
    const P = this.props;
    if (m.end) { const pr = P.get(m.id); if (pr) { pr.fx.end(m.end); P.delete(m.id); } return; }
    let pr = P.get(m.id);
    if (pr) { if (m.hp != null) { if (m.hp < pr.hp) pr.fx.hit(); pr.hp = m.hp; } return; }
    if (!m.k) return;
    pr = { id: m.id, k: m.k, o: m.o, tm: m.tm, x: m.p[0], y: m.p[1], z: m.p[2], r: m.r, h: m.h, hp: m.hp, fr: m.fr };
    pr.fx = this.fx.prop({ k: m.k, p: m.p, r: m.r, h: m.h });
    P.set(m.id, pr);
    // cột đá trồi lên ngay dưới chân mình: được nâng lên nóc cột
    const me = this.me;
    if (m.k === 'pillar' && me && !me.dead && Math.hypot(me.pos.x - pr.x, me.pos.z - pr.z) < pr.r + BR * 0.4 && me.pos.y < pr.y + pr.h) {
      me.pos.y = pr.y + pr.h;
      this.L.vel.y = Math.max(this.L.vel.y, 3);
      this.L.onGround = false;
    }
  }

  // Hàng rào điện giữa các cặp cọc sét của cùng một người (vẽ mỗi khung hình)
  updateFences(dt) {
    const rods = [];
    for (const pr of this.props.values()) if (pr.k === 'rod') rods.push(pr);
    const pairs = [];
    for (let i = 0; i < rods.length; i++) for (let j = i + 1; j < rods.length; j++) {
      const a = rods[i], b = rods[j];
      if (a.o !== b.o || Math.hypot(a.x - b.x, a.z - b.z) > (a.fr || 10)) continue;
      pairs.push({ key: a.id + ':' + b.id, a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], c: 0xb388ff, h: 2.2 });
    }
    if (pairs.length || this.fx.fenceMap?.size) this.fx.fences(pairs, dt);
  }

  // Cột đá của mình gần p nhất trong tầm (để nhổ lên ném)
  ripPillar(p, range) {
    let best = null, bd = range;
    for (const pr of this.props.values()) {
      if (pr.k !== 'pillar' || pr.o !== this.myId) continue;
      const d = Math.hypot(pr.x - p.x, pr.z - p.z);
      if (d <= bd) { bd = d; best = pr; }
    }
    return best;
  }

  // Điểm cần ném tới: ngực mục tiêu đang khoá, không thì điểm tâm ngắm
  aimPoint() {
    for (const av of this.avatars.values()) if (av.targeted && !av.dead) return [av.pos.x, av.pos.y + 0.85, av.pos.z];
    return this.steerAim();
  }

  // ======================= Dị biến =======================
  awakened(av = this.me) { return !!av && av.aw && now() < av.awUntil; }

  // bộ chiêu mình đang dùng và độ lệch chỉ số hồi chiêu (dạng dị biến tính riêng: +10)
  curSkills() { return this.me.skills; }
  cdOff() { return this.me.aw ? 10 : 0; }

  refreshSkills() {
    if (!this.me) return;
    this.cancelHold();   // bộ chiêu đổi (biến hình / hết dị biến / đổi nhân vật): bỏ lượt tụ lực đang dở
    const A = this.me.char.awaken;
    this.hud.buildSkillbar(this.me.char, this.me.skills, this.cdOff(), this.me.aw ? A : null);
    this.setupTouch();
  }

  tryAwaken() {
    const me = this.me;
    if (!me || me.dead || me.aw) return;
    if ((me.awk || 0) < AWAKEN.max) {
      sfx('error');
      this.hud.toast(`Thanh dị biến mới ${Math.floor(me.awk || 0)}% — đánh trúng đối thủ để tích`, 1100);
      return;
    }
    this.net.send({ t: 'awk' });
  }

  onAwaken(m) {
    const av = this.avatars.get(m.id);
    if (!av) return;
    const A = av.char.awaken, t = now();
    if (m.on) {
      av.awUntil = t + m.dur;
      av.tiredUntil = 0;
      av.awk = 0;
      av.setForm(true);
      av.model.play('raise', m.tf);
      av.faceUntil = t + m.tf;
      this.fx.awakenBurst(() => av.pos, A.color, A.core, m.tf);
      sfx('charge', this.distToCam(av.pos));
      setTimeout(() => sfx('explosion', this.distToCam(av.pos)), m.tf * 1000);
      if (av.isMe) {
        this.L.rootUntil = t + m.tf;
        this.L.lockUntil = t + m.tf;
        this.L.skillDash = null;
        this.jn = 0;
        this.refreshSkills();
        this.hud.toast(`⚡ ${A.name}! Bộ chiêu đã thay đổi`, 2200);
        this.awFullTold = false;
      }
    } else {
      av.awUntil = 0;
      av.tiredUntil = m.tired ? t + m.tired : 0;
      if (av.aw && !av.dead) this.fx.parts.burst(v3(av.pos.x, av.pos.y + 1, av.pos.z), 30, A.color, { speed: 5, size: 0.4, life: 0.6 });
      av.setForm(false);
      if (av.isMe) {
        for (let i = 10; i < 16; i++) this.L.cds[i] = 0;
        this.refreshSkills();
        if (m.tired) this.hud.toast('Hết dị biến — kiệt sức trong giây lát', 1500);
      }
    }
  }

  // vị trí ngực các đối thủ của av (đạn tự tìm phía client, chỉ để vẽ)
  seekTargets(av) {
    const out = [];
    for (const q of this.avatars.values()) {
      if (q === av || q.dead || this.allyId(q.id, av.id)) continue;
      out.push([q.pos.x, q.pos.y + 0.85, q.pos.z]);
    }
    return out;
  }

  // ======================= Đấu đội =======================
  isAlly(av) {
    if (av === this.me || (av.ms && av.ms === this.myId)) return true;
    return this.teamMode && !!av.team && av.team === this.me?.team;
  }

  bindTeamUi() {
    for (const b of document.querySelectorAll('#teamLobby [data-join]')) {
      b.onclick = () => this.net.send({ t: 'tteam', team: b.dataset.join });
    }
    $('tlReady').onclick = () => this.net.send({ t: 'tready', on: !this.me?.ready });
    $('tlStart').onclick = () => this.net.send({ t: 'tstart' });
    $('tlHide').onclick = () => this.showLobby(false);
    $('tlShow').onclick = () => this.showLobby(true);
  }

  // Mở/đóng bảng phòng chờ. Đóng = chạy nhảy khởi động (không mất máu)
  showLobby(on) {
    $('teamLobby').hidden = !on;
    if (on) {
      if (document.pointerLockElement) document.exitPointerLock();
      $('clickToPlay').hidden = true;
      this.renderLobby();
    } else if (this.active && !this.touch?.enabled) {
      lockPointer();
      $('clickToPlay').hidden = !!document.pointerLockElement;
    }
  }

  hideTeamUi() {
    for (const id of ['teamLobby', 'tlShow', 'teamScore', 'teamBanner']) $(id).hidden = true;
    clearTimeout(this.bannerTimer);
  }

  banner(html, cls, dur = 3) {
    const b = $('teamBanner');
    b.className = cls;
    b.innerHTML = html;
    b.hidden = false;
    // chạy lại hiệu ứng xuất hiện
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.hidden = true; }, dur * 1000);
  }

  onTeamState(m) {
    const prev = this.ts?.phase;
    this.ts = { ...m, at: now() };
    for (const [id, team, ready, k, d] of m.players) {
      const av = this.avatars.get(id);
      if (av) { av.team = team; av.ready = !!ready; av.kills = k; av.deaths = d; }
    }
    if (prev !== m.phase) {
      if (m.phase === 'lobby') this.showLobby(true);
      else if (m.phase === 'play') {
        $('teamLobby').hidden = true;
        if (prev === 'lobby') {
          this.banner(`⚔ BẮT ĐẦU!<small>Đội nào hạ ${m.limit} mạng trước sẽ thắng</small>`, 'go', 3);
          sfx('respawn');
          if (!this.touch?.enabled) { lockPointer(); $('clickToPlay').hidden = !!document.pointerLockElement; }
        }
      } else if (m.phase === 'end') {
        const mine = m.winner === this.me?.team;
        const title = m.winner === 'draw' ? '🤝 HOÀ!' : `🏆 ${TEAM.names[m.winner].toUpperCase()} THẮNG!`;
        this.banner(`${title}<small>${m.score.A} - ${m.score.B} · ${m.winner === 'draw' ? '' : mine ? 'Đội bạn chiến thắng 🎉 · ' : 'Thua rồi, phục thù nhé! · '}về phòng chờ sau ${m.left}s</small>`, m.winner, m.left);
        sfx(mine ? 'respawn' : 'die');
      }
    }
    this.renderLobby();
  }

  renderLobby() {
    const m = this.ts;
    if (!m || $('teamLobby').hidden) return;
    const me = this.me;
    const isHost = m.host === this.myId;
    const counts = { A: 0, B: 0 };
    for (const t of ['A', 'B']) {
      const list = [...this.avatars.values()].filter(a => a.team === t);
      counts[t] = list.length;
      $('tlList' + t).innerHTML = list.map(a => `<li class="${a.isMe ? 'me' : ''}">
        <span class="dot" style="background:${hex(a.char.look.hair)}"></span>
        <span class="nm">${a.id === m.host ? '👑 ' : ''}${esc(a.name)} <small class="muted">${esc(a.char.name)}</small></span>
        <span class="st ${a.ready || a.id === m.host ? 'ok' : ''}">${a.id === m.host ? 'Chủ phòng' : a.ready ? '✔ Sẵn sàng' : '⏳ Chưa'}</span></li>`).join('')
        || '<li class="muted">Chưa có ai</li>';
      $('tlCount' + t).textContent = `(${list.length})`;
      document.querySelector(`#teamLobby [data-join="${t}"]`).disabled = me?.team === t;
    }
    $('tlInfo').textContent = `Map: ${this.world.arena.name} · Đội nào hạ ${m.limit} mạng trước, hoặc dẫn điểm khi hết ${Math.round(TEAM.timeLimit / 60)} phút, sẽ thắng. Trong lúc chờ có thể bấm Khởi động để chạy nhảy thử chiêu (chưa tính máu).`;
    const rb = $('tlReady');
    rb.hidden = isHost;
    rb.classList.toggle('on', !!me?.ready);
    rb.textContent = me?.ready ? '✖ Huỷ sẵn sàng' : '✔ Sẵn sàng';
    const sb = $('tlStart');
    sb.hidden = !isHost;
    sb.disabled = !!m.block;
    $('tlHint').textContent = isHost
      ? (m.block ? `⏳ ${m.block}` : '✅ Mọi người đã sẵn sàng — bấm Bắt đầu!')
      : (me?.ready ? '⏳ Chờ chủ phòng 👑 bắt đầu…' : 'Chọn đội rồi bấm Sẵn sàng khi bạn chuẩn bị xong');
  }

  updateTeamHud() {
    const m = this.ts;
    if (!m) return;
    const live = m.phase === 'play' || m.phase === 'end';
    $('tlShow').hidden = m.phase !== 'lobby' || !$('teamLobby').hidden;
    $('teamScore').hidden = !live;
    if (!live) return;
    const left = Math.max(0, m.left - (now() - m.at));
    $('tsA').textContent = m.score.A;
    $('tsB').textContent = m.score.B;
    const mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, '0');
    $('tsMid').innerHTML = m.phase === 'play' ? `${mm}:${ss}<br>tới ${m.limit}` : 'Kết thúc';
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
      $('clickToPlay').hidden = locked || !this.active || this.chatting || !!this.touch?.enabled || !$('teamLobby').hidden;
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
    // chuột cũng là "phím" gán được: Mouse0 (trái) / Mouse1 (giữa) / Mouse2 (phải)
    canvas.addEventListener('mousedown', e => {
      if (document.pointerLockElement !== canvas) return;
      const code = translate('brawl', 'Mouse' + e.button);
      if (code) this.pressKey(code);
    });
    addEventListener('mouseup', e => { const code = translate('brawl', 'Mouse' + e.button); if (code) this.keys.delete(code); });
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
      // dịch phím thật sang phím chuẩn theo bảng gán phím (Cài đặt → Gán phím); phím chưa gán thì bỏ qua
      const code = translate('brawl', e.code);
      if (!code) return;
      e.preventDefault();
      if (e.repeat) return;
      this.pressKey(code);
    });
    addEventListener('keyup', e => {
      const code = translate('brawl', e.code);
      if (code) this.keys.delete(code);
      if (e.code === 'Tab') this.showScore = false;
    });
    addEventListener('blur', () => this.keys.clear());
  }

  // một phím chuẩn vừa được bấm (từ bàn phím hoặc chuột, đã qua bảng gán phím)
  pressKey(code) {
    this.keys.add(code);
    switch (code) {
      case 'KeyJ': this.comboKey('J'); break;
      case 'KeyK': this.comboKey('K'); break;
      case 'KeyL': this.comboKey('L'); break;
      case 'KeyH': this.tryHeal(); break;
      case 'KeyP': if (this.practice) this.net.send({ t: 'pfill' }); break;
      case 'KeyT': if (this.teamMode && this.ts?.phase === 'lobby') this.showLobby($('teamLobby').hidden); break;
      case 'Space': this.jump(); break;
      case 'ShiftLeft': this.dash(); break;
    }
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
    const sk = this.curSkills();
    const hold = code => ({ down: () => this.keys.add(code), up: () => this.keys.delete(code) });
    this.touch.setButtons([
      { id: 'atk', label: '⚔<small>Đánh</small>', cls: 'big', down: () => this.castDirect(0) },
      // giữ nút = giữ phím (chiêu tụ lực của Raiga dị biến bắn khi thả nút)
      { id: 's1', label: short(sk[1]), down: () => { this.keys.add('KeyK'); this.castDirect(1); }, up: () => this.keys.delete('KeyK') },
      { id: 's2', label: short(sk[2]), down: () => this.castDirect(2) },
      { id: 's3', label: short(sk[3]), down: () => { this.keys.add('KeyL'); this.castDirect(3); }, up: () => this.keys.delete('KeyL') },
      { id: 'ult', label: `★<small>${short(sk[4])}</small>`, cls: 'ult', look: true, down: () => this.castDirect(4) },
      { id: 'jump', label: '⤒<small>Nhảy/Bay</small>', down: () => { this.keys.add('Space'); this.jump(); }, up: () => this.keys.delete('Space') },
      { id: 'dash', label: '💨<small>Lướt</small>', down: () => { this.keys.add('ShiftLeft'); this.dash(); }, up: () => this.keys.delete('ShiftLeft') },
      { id: 'heal', label: '✚<small>Hồi máu</small>', down: () => this.tryHeal() },
      { id: 'charge', label: '☯<small>Vận khí</small>', ...hold('KeyU') },
      { id: 'awk', label: '⚡<small>Dị biến</small>', cls: 'awk', down: () => this.tryAwaken() },
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
    const sk = this.curSkills(), off = this.cdOff();
    ['atk', 's1', 's2', 's3', 'ult'].forEach((id, i) => {
      const s = sk[i];
      T.setCooldown(id, ((L.cds[i + off] || 0) - t) / s.cd, me.mp < s.mana);
    });
    const aw = this.awakened();
    T.setCooldown('awk', aw ? 0 : 1 - (me.awk || 0) / AWAKEN.max, !aw && (me.awk || 0) < AWAKEN.max);
    T.setActive('awk', aw || (me.awk || 0) >= AWAKEN.max);
    T.setCooldown('heal', (L.healCd - t) / GAME.heal.cd, me.mp < GAME.heal.mana);
    T.setCooldown('dash', (L.dashCd - t) / 0.75, false);
    T.setActive('charge', L.charging);
  }

  // ======================= Combo phím =======================
  comboKey(k) {
    if (!this.me || this.me.dead) return;
    const t = now();
    // L L (bấm 2 lần liên tiếp, không dính vào combo khác) = dị biến
    if (k === 'L') {
      if (this.lastL && t - this.lastL < 0.45) {
        this.lastL = 0; this.combo = []; this.pending = null;
        this.hud.showCombo(['L', 'L']);
        this.tryAwaken();
        return;
      }
      this.lastL = t;
    } else this.lastL = 0;
    if (!this.combo.length || t - this.combo[this.combo.length - 1].t > COMBO_WINDOW) this.combo = [];
    this.combo.push({ k, t });
    if (this.combo.length > 4) this.combo.shift();
    this.hud.showCombo(this.combo.map(c => c.k));
    this.resolveCombo(false);
  }

  resolveCombo(timeout) {
    const str = this.combo.map(c => c.k).join('');
    const skills = this.curSkills();
    let best = -1;
    for (let i = 0; i < skills.length; i++) {
      if (skills[i].chain) continue;   // đòn kết chuỗi J: tự nâng cấp trong doCast
      const c = skills[i].combo;
      if (str.endsWith(c) && (best < 0 || c.length > skills[best].combo.length)) best = i;
    }
    // còn combo dài hơn có thể xảy ra?
    let tail = '';
    let canExtend = false;
    for (let n = 1; n <= str.length; n++) {
      tail = str.slice(-n);
      if (skills.some(s => !s.chain && s.combo.length > tail.length && s.combo.startsWith(tail))) { canExtend = true; break; }
    }
    if (best < 0) { if (!canExtend) this.combo = []; this.pending = null; return; }
    const s = skills[best];
    if (s.instant || !canExtend || timeout) {
      this.pending = null;
      this.queueCast(best);
      if (!canExtend) this.combo = [];
      this.lastL = 0;   // phím L vừa dùng cho combo (KL / JKL) thì không tính vào L L
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
    if (t < (L.cds[idx + this.cdOff()] || 0)) return 'cd';
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
      if (av.isMe || av.dead || this.isAlly(av) || av.hidden) continue;
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
      // nhắm thẳng vào ngực mục tiêu, kể cả khi mục tiêu đang bay cao / mình đang bay
      const d = v3(best.pos.x - me.pos.x, best.pos.y - me.pos.y, best.pos.z - me.pos.z);
      const hl = Math.max(0.5, Math.hypot(d.x, d.z));
      d.y = Math.max(-3, Math.min(3, d.y / hl));
      const hh = Math.hypot(d.x, d.z) || 1;
      return v3(d.x / hh, d.y, d.z / hh).normalize();
    }
    // không khoá được ai: bắn theo vòng tâm (tia từ camera), ngẩng chuột lên thì bắn chếch lên trời
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(this._ndc || (this._ndc = new THREE.Vector2(0, 0.08)), this.camera);
    const o = ray.ray.origin, rd = ray.ray.direction;
    const aim = v3(o.x + rd.x * 30, o.y + rd.y * 30, o.z + rd.z * 30);
    const hl = Math.hypot(aim.x - me.pos.x, aim.z - me.pos.z) || 1;
    let slope = (aim.y - (me.pos.y + 0.85)) / hl;
    if (this.L.onGround) slope = Math.max(0, slope);   // đứng dưới đất thì không bắn cắm xuống đất
    slope = Math.max(-1.5, Math.min(2.5, slope));
    return v3(fwd.x, slope, fwd.z).normalize();
  }

  // Điểm tâm ngắm trong thế giới: tia từ camera qua vòng tâm (#crosshair nằm ở 46% chiều cao).
  // Nếu tia đi sát một đối thủ thì nhắm thẳng vào người đó, không thì lấy điểm chạm đất.
  steerAim() {
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(this._ndc || (this._ndc = new THREE.Vector2(0, 0.08)), this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let best = null, bestAng = 0.09;
    for (const av of this.avatars.values()) {
      if (av.isMe || av.dead || this.isAlly(av) || av.hidden) continue;
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

  doCast(idx, held = null) {
    const L = this.L, t = now();
    // chuỗi J: đòn J thứ 3 liên tiếp (trong 1.2 s) thành đòn kết riêng của nhân vật
    const skills = this.curSkills(), aw = this.me.aw;
    if (idx === 0) {
      const fin = skills.findIndex(q => q.chain);
      if (fin > 0 && this.jn >= 2 && t - this.jLast < 1.2 && !this.canCast(skills[fin], fin)) idx = fin;
    }
    const s = skills[idx];
    const why = this.canCast(s, idx);
    if (why === 'lock') return false;
    if (why) {
      this.hud.denySlot(idx);
      if (why === 'mana') this.hud.toast(`Không đủ mana! Giữ ${actionKey('brawl', 'charge')} để vận khí`, 1000);
      sfx('error');
      return true;
    }
    // giữ phím tụ lực (dị biến Raiga): bắt đầu tụ, thả phím (hoặc tụ đầy) mới bắn
    if (s.hold && held == null) {
      if (L.holding) return true;
      L.holding = { idx, t0: t, key: s.combo.endsWith('L') ? 'KeyL' : 'KeyK', max: s.hold.max };
      L.lockUntil = L.rootUntil = t + s.hold.max + 0.3;
      L.holdFx = this.fx.chargeUp(() => this.me.pos, s.fx.color, s.fx.core || 0xffffff, s.hold.max);
      this.me.model.play('raise', s.hold.max);
      this.net.send({ t: 'hold', sk: idx });
      sfx('charge');
      return true;
    }
    let d = this.aimDir();
    const h = v3(d.x, 0, d.z).normalize();
    const me = this.me;
    L.cds[idx + this.cdOff()] = t + s.cd;
    L.lockUntil = t + s.lock;
    if (s.root) L.rootUntil = t + s.lock;
    me.mp -= s.mana;
    me.faceYaw = Math.atan2(h.x, h.z);
    me.faceUntil = t + s.lock;
    me.yaw = me.faceYaw;
    me.model.play(s.pose, s.lock);
    if (s.lunge && L.onGround) { L.vel.x += h.x * s.lunge; L.vel.z += h.z * s.lunge; }
    if (s.leap) { L.vel.y = s.leap; L.onGround = false; }
    if (s.type === 'dash') L.skillDash = { h, dist: s.dist, delay: s.delay, dur: s.dur, t0: t, d3: s.free3d ? d.clone() : null };
    if (idx === 0) { this.jn = t - (this.jLast || 0) < 1.2 ? (this.jn || 0) + 1 : 1; this.jLast = t; }
    else this.jn = 0;
    if (s.chain) this.hud.toast(`⚡ ${s.name}!`, 700);
    const seed = (Math.random() * 2 ** 31) | 0;
    const cs = this.cs++;
    const p = me.pos.clone();
    // nhổ cột đá ném (dị biến Gantetsu): đạn bay ra từ cột đá của mình gần nhất, hướng về điểm cần ném
    if (!s.hold) held = null;   // phòng hờ: chiêu ở ô này không còn là chiêu tụ lực
    let fs = held != null ? holdSkill(s, held / s.hold.max) : s, rp = null;
    if (s.rip && (rp = this.ripPillar(p, s.rip.range))) {
      fs = s.ripSkill;
      p.set(rp.x, rp.y + 1.2, rp.z);
      const a = this.aimPoint();
      d = v3(a[0] - p.x, a[1] - (p.y + 0.85), a[2] - p.z).normalize();
      rp.fx.end('rip');
      this.props.delete(rp.id);
    }
    // điểm đích dự đoán (server sẽ gửi lại điểm chính xác)
    let tg = null, aim = null;
    if (s.type === 'leap' || s.type === 'pillar') {
      aim = this.steerAim();
      let tx = aim[0], tz = aim[2];
      const L2 = Math.hypot(tx - p.x, tz - p.z);
      if (L2 > s.range) { tx = p.x + (tx - p.x) / L2 * s.range; tz = p.z + (tz - p.z) / L2 * s.range; }
      tg = clampArena(tx, tz);
      if (s.type === 'leap') L.skillLeap = { from: p.clone(), to: v3(tg[0], 0, tg[1]), t0: t, delay: s.delay, dur: s.dur, h: s.height || 6 };
    } else if (s.type === 'trap' || s.type === 'summon' || s.type === 'wall' || s.type === 'icewall' || s.type === 'turret') tg = clampArena(p.x + h.x * s.offset, p.z + h.z * s.offset);
    const e = this.fx.castSkill({ skill: fs, p, d, h, seed, tg, caster: me.casterApi, owner: me.id, team: me.team, seekTargets: () => this.seekTargets(me) });
    if (e) { this.predicted.set(cs, e); if (s.type === 'buff') e.buffOf = me.id; }
    if (L.skillDash && e?.steer && s.type === 'dash') L.skillDash.st = e.steer;   // rồng lốc: bám độ cao đang lái
    this.ultCue(me, fs, p, h, tg, e);
    if (e?.steer) {
      // chiêu cuối: lái theo tâm ngắm cho tới khi chiêu kết thúc
      e.steer.aim = this.steerAim();
      this.steering = { st: e.steer, color: s.fx.color, until: t + skillLifetime(s), sendAcc: 1, beam: s.steer.mode === 'aim' };
    }
    const msg = { t: 'cast', sk: idx, cs, seed, p: [p.x, p.y, p.z].map(v => +v.toFixed(2)), d: [d.x, d.y, d.z].map(v => +v.toFixed(3)) };
    if (aw) msg.aw = 1;
    if (aim) msg.a = aim.map(v => +v.toFixed(2));
    if (rp) msg.rp = rp.id;
    if (held != null) msg.hold = +held.toFixed(2);
    this.net.send(msg);
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
    L.dashCd = t + ((this.awakened() && this.me.char.awaken.passive.dashCd) || MOVE.dashCd);
    L.sprint = true;
    if (!L.onGround) L.vel.y = Math.max(L.vel.y, 2);
    this.net.send({ t: 'dodge' });
    sfx('dash');
  }

  moveDir() {
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW')) f += 1;   // phím chuẩn (đã qua bảng gán phím)
    if (k.has('KeyS')) f -= 1;
    if (k.has('KeyD')) r += 1;
    if (k.has('KeyA')) r -= 1;
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
    if (me.dead) { me.anim = ANIM.dead; this.cancelHold(); return; }
    // đang bị túm: đứng trước mặt người túm, nhấc bổng rồi quật xuống (server gửi cú ném bằng 'hit')
    if (L.grab) {
      const G = L.grab, A = this.avatars.get(G.by), el = t - G.t0;
      if (!A || el > G.dur + 0.1) L.grab = null;
      else {
        me.pos.set(A.pos.x + Math.sin(A.yaw) * 1.3, A.pos.y + (el < G.slam ? 2.4 * Math.min(1, el / 0.25) : 0), A.pos.z + Math.cos(A.yaw) * 1.3);
        L.vel.set(0, 0, 0);
        me.anim = ANIM.stun;
        if (this.sendT.due(dt)) this.net.send({ t: 's', p: [me.pos.x, me.pos.y, me.pos.z].map(v => +v.toFixed(2)), r: +me.yaw.toFixed(2), a: ANIM.stun, f: 0 });
        return;
      }
    }
    // giữ phím tụ lực: thả phím (hoặc tụ đầy, bị choáng) thì bắn
    const HD = L.holding;
    if (HD) {
      const el = t - HD.t0;
      if (!this.keys.has(HD.key) || el >= HD.max || t < L.stunUntil) {
        const ok = t >= L.stunUntil;
        this.cancelHold();
        if (ok) this.doCast(HD.idx, Math.min(el, HD.max));
      }
    }
    const stunned = t < L.stunUntil;
    const rooted = t < L.rootUntil;
    const k = this.keys;

    // Vận khí: giữ U khi đứng trên đất
    L.charging = k.has('KeyU') && L.onGround && !stunned && !rooted && t >= L.lockUntil;
    // Bay: giữ Space trên không sau khi đã nhảy đôi (tốn mana).
    // Kaze dị biến bay tự do: giữ Space là bay ngay, không tốn mana, thả ra thì lượn chậm xuống
    const FF = this.awakened() ? me.char.awaken.passive.freeFly : null;
    L.flying = !L.onGround && k.has('Space') && !stunned && !L.skillDash && (FF ? true : L.jumps >= 2 && me.mp > 1);

    const input = stunned || rooted || L.charging ? v3() : this.moveDir();
    L.sprint = L.sprint && k.has('ShiftLeft') && input.lengthSq() > 0;
    let speed = (L.sprint ? MOVE.sprint : MOVE.walk) * me.char.speedMul;
    // dị biến chạy nhanh hơn, hết dị biến thì kiệt sức một lúc
    if (this.awakened()) speed *= me.char.awaken.passive.speed ?? AWAKEN.speedMul;
    else if (t < me.tiredUntil) speed *= AWAKEN.tiredSlow;
    if (t < L.slowUntil) speed *= L.slowMul;
    if (L.flying) speed *= 1.25;
    // vùng trên sàn: băng của đối phương trơn trượt, băng của mình (Yuki) chạy nhanh, vùng ngưng đọng làm chậm
    const ZE = this.zoneEffect(me.pos);
    if (ZE.ownIce && this.awakened()) speed *= me.char.awaken.passive.iceSpeed || 1;
    speed *= ZE.slow;

    // Chiêu lao tới: di chuyển cưỡng bức
    const sd = L.skillDash;
    if (sd) {
      const el = t - sd.t0;
      if (el >= sd.delay && el <= sd.delay + sd.dur) {
        const v = sd.dist / sd.dur;
        if (sd.d3) L.vel.set(sd.d3.x * v, sd.d3.y * v, sd.d3.z * v);   // lướt 3 chiều theo hướng ngắm
        else L.vel.set(sd.h.x * v, 0, sd.h.z * v);
        if (sd.st && sd.st.y != null) L.vel.y = (sd.st.y - me.pos.y) * 8;   // rồng lốc: bám độ cao đang lái
      } else if (el > sd.delay + sd.dur) {
        L.skillDash = null;
        L.vel.x *= 0.15; L.vel.z *= 0.15;
        if (sd.d3 || sd.st) L.vel.y *= 0.3;
      } else L.vel.set(0, Math.max(0, L.vel.y * 0.5), 0);
    } else if (L.dashT > 0) {
      L.dashT -= dt;
      L.vel.x = L.dashDir.x * MOVE.dashSpeed;
      L.vel.z = L.dashDir.z * MOVE.dashSpeed;
      this.fx.dashTrail(me.pos, L.dashDir);
    } else {
      const ctrl = L.knockT > 0 ? 0.15 : 1;
      L.knockT -= dt;
      const accel = (L.onGround ? (ZE.ice ? 1.3 : 16) : 6) * ctrl;   // trên băng: rất khó dừng / đổi hướng
      const a = Math.min(1, accel * dt);
      L.vel.x += (input.x * speed - L.vel.x) * a;
      L.vel.z += (input.z * speed - L.vel.z) * a;
    }

    // Trọng lực / bay
    if (L.flying) {
      const maxH = FF ? FF.max : MOVE.flyMaxHeight;
      const target = me.pos.y < maxH ? (FF ? FF.rise : MOVE.flyRise) : 0;
      L.vel.y += (target - L.vel.y) * Math.min(1, dt * 5);
      if (!FF) me.mp -= MOVE.flyManaPerSec * dt;
      if (Math.random() < 0.6) this.fx.parts.emit(me.pos.x, me.pos.y, me.pos.z, (Math.random() - 0.5), -3, (Math.random() - 0.5), me.char.skills[1].fx.color, 0.35, 0.4);
    } else if (!(sd && t - sd.t0 >= sd.delay)) {
      L.vel.y -= MOVE.gravity * dt;
      if (FF && !L.onGround && L.knockT <= 0) L.vel.y = Math.max(L.vel.y, FF.glide);   // lượn chậm xuống
    }

    // Tích phân + va chạm
    const p = me.pos;
    p.x += L.vel.x * dt; p.y += L.vel.y * dt; p.z += L.vel.z * dt;
    arenaCollide(curArena, p, BR);
    if (this.fx.dynObs.length) {
      dynCollide(this.fx.dynObs, p, BR);
      // tường gió của mình / đồng đội: bước vào chân tường thì luồng gió đẩy bay vọt lên
      if (t >= (L.liftCd || 0)) for (const o of this.fx.dynObs) {
        if (!o.lift || !(o.pass === me.id || (me.team && o.passTeam === me.team))) continue;
        if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + BR + 0.3 && p.y < 2) {
          L.vel.y = o.lift; L.onGround = false; L.jumps = 2; L.liftCd = t + 0.8;
          this.fx.parts.burst(v3(p.x, p.y + 0.5, p.z), 20, 0x9ff7ee, { speed: 6, size: 0.35, life: 0.5, up: 2 });
          sfx('jump');
          break;
        }
      }
    }
    const sl = L.skillLeap;
    if (sl) {
      // chiêu nhảy: bay theo vòng cung tới điểm đích
      const el = t - sl.t0;
      if (el >= sl.delay) {
        const k = Math.min(1, (el - sl.delay) / sl.dur);
        p.x = sl.from.x + (sl.to.x - sl.from.x) * k;
        p.z = sl.from.z + (sl.to.z - sl.from.z) * k;
        p.y = sl.from.y * (1 - k) + Math.sin(Math.PI * k) * sl.h;
        L.vel.set(0, 0, 0);
        if (k >= 1) { L.skillLeap = null; this.fx.dust(p, 16); }
      } else L.vel.set(0, 0, 0);
    }
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
    // camera không chui vào cột / hộp / chướng ngại vật: dò từ nhân vật ra, gặp vật cản thì kéo camera vào trước nó
    const dx = want.x - target.x, dy = want.y - target.y, dz = want.z - target.z, L = Math.hypot(dx, dy, dz) || 1;
    for (let d = 1.2; d <= L; d += 0.3) {
      const k = d / L;
      if (camBlocked(target.x + dx * k, target.y + dy * k, target.z + dz * k, this.fx.dynObs)) {
        const kk = Math.max(1, d - 0.5) / L;
        want.set(target.x + dx * kk, target.y + dy * kk, target.z + dz * kk);
        c.pos.lerp(want, Math.min(1, dt * 30));   // vào gần nhanh để không thấy xuyên tường
        break;
      }
    }
    c.pos.lerp(want, Math.min(1, dt * 14));
    this.camera.position.copy(c.pos);
    const sh = this.fx.shakeAmt * this.settings.shake;
    if (sh > 0) this.camera.position.add(v3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    // nhìn hơi lệch lên để thấy phía trước
    this.camera.lookAt(target.x, target.y + 0.4, target.z);
    // góc nhìn rộng ra thoáng chốc khi bung tuyệt kỹ / trúng đòn mạnh, rồi thu về
    this.fovK = Math.max(0, this.fovK - dt * 14);
    const fov = 62 + this.fovK;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
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
        this.cam.pitch = Math.max(-0.35, Math.min(1.25, this.cam.pitch + lk.dy * 0.005 * this.settings.sens * (this.settings.invertY ? -1 : 1)));
        this.updateTouchHud(t);
      }
      this.updateLocal(dt);
      const fdt = t < this.hitstopUntil ? dt * 0.08 : dt;   // khựng hình
      for (const av of this.avatars.values()) {
        if (!av.isMe) av.interpolate();
        av.render(fdt);
        // hào quang vận khí
        if (!av.dead && (av.isMe ? this.L.charging : av.flags & 2)) this.fx.aura(av.pos, av.char.look.aura || av.char.skills[1].fx.color, dt);
      }
      this.updateFences(dt);
      this.updateCharges(t);
      // sương đêm: người ngoài bán kính nhìn thấy bị ẩn (cả bảng tên)
      if (this.darkUntil) {
        if (t >= this.darkUntil) { this.darkUntil = 0; this.setDark(false); }
        else for (const av of this.avatars.values()) {
          if (av.isMe || this.isAlly(av) || av.pos.distanceTo(this.me.pos) <= this.darkSee) continue;
          av.hidden = true; av.model.root.visible = false; av.model.rig.shadow.visible = false;
        }
      }
      this.updateCamera(dt);
      this.aimDir();   // cập nhật mục tiêu đang khóa
      this.updateSteer(dt, t);
      const L = this.L;
      this.hud.updateBars(this.me.hp, this.me.char.hp || GAME.maxHp, this.me.mp, t, L.cds, L.healCd, L.dashCd, this.me.mp, L.charging);
      this.hud.updateAwaken(this.me, t);
      if (!this.me.aw && this.me.awk >= AWAKEN.max && !this.awFullTold) {
        this.awFullTold = true;
        this.hud.toast(this.touch?.enabled ? '⚡ Thanh dị biến đã đầy! Bấm nút ⚡ để biến hình' : `⚡ Thanh dị biến đã đầy! Bấm ${comboKey('L')} ${comboKey('L')} để biến hình`, 2500);
        sfx('respawn');
      }
      this.hud.updatePlates(this.avatars.values(), this.camera, innerWidth, innerHeight);
      this.hud.scoreboard([...this.avatars.values()].filter(a => a.fk !== 'pet' && a.fk !== 'decoy'), !!this.showScore, this.teamMode ? this.ts?.score || { A: 0, B: 0 } : null);
      if (this.teamMode) this.updateTeamHud();
      $('playerCount').textContent = this.avatars.size + ' người chơi';
      if (this.me.dead) this.hud.death(true, this.killer, GAME.respawnTime - (t - (this.deathAt || t)));
      $('stunned').hidden = !(t < L.stunUntil);
    } else {
      // màn hình chờ (nền menu): camera bay vòng quanh map đang chọn, bán kính theo cỡ sân
      const a = t * 0.08, R = curArena.radius * 0.9 + 2;
      this.camera.position.set(Math.sin(a) * R, 9 + R * 0.15, Math.cos(a) * R);
      this.camera.lookAt(0, 2, 0);
      if (this.camera.fov !== 62) { this.camera.fov = 62; this.camera.updateProjectionMatrix(); }
    }

    this.fx.update(t < this.hitstopUntil ? dt * 0.08 : dt);
    this.world.update(dt, t);
    if (this.bloom.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
