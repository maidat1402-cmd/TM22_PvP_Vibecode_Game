// Khởi động: menu, chọn nhân vật (preview 3D), danh sách phòng, cài đặt.
import * as THREE from 'three';
import { CHARACTERS, getChar, charSkills, skillLifetime } from '/shared/characters.js';
import { VERSION } from '/shared/version.js';
import { ACTIONS, MODE_NAMES, loadBindings, saveBindings, setBinding, resetBindings, bindingsOf, keyName, actionKeys, comboKey, SYSTEM_KEYS } from './keys.js';
import { FX } from './effects.js';
import { Net } from './net.js';
import { Game } from './game.js';
import { buildChibi, ANIM } from './chibi.js';
import { $, hex, esc, lockPointer } from './ui.js';
import { initAudio, sfx, setVolume } from './audio.js';
import { ShooterGame } from './shooter/sgame.js';
import { CardGame } from './cards/cgame.js';
import { TouchControls, isTouchDevice } from './touch.js';

// ---------- Cài đặt (lưu localStorage nếu được) ----------
const IS_TOUCH = isTouchDevice();
const DEFAULTS = { name: '', char: 'kaze', quality: IS_TOUCH ? 'low' : 'high', bloom: !IS_TOUCH, sens: 1, invertY: false, shake: 1, volume: 0.5,
  touch: 'auto', mode: 'brawl' };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('chibiclash') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem('chibiclash', JSON.stringify(settings)); } catch { /* bỏ qua */ }
}
const settings = loadSettings();
loadBindings(settings.keys);   // bảng gán phím đã lưu
if (new URLSearchParams(location.search).has('char')) settings.char = new URLSearchParams(location.search).get('char');
// Tên người chơi: bắt buộc tự nhập (2–16 ký tự), không còn tên tự sinh. Tên tự sinh kiểu "Ninja123" của bản cũ coi như chưa có tên.
// ?name=... gắn sẵn tên (tiện cho link test / link mời)
const cleanName = s => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
const validName = n => n.length >= 2;
if (/^Ninja\d{3}$/.test(settings.name || '')) settings.name = '';
if (new URLSearchParams(location.search).has('name')) settings.name = cleanName(new URLSearchParams(location.search).get('name'));

const net = new Net();
const game = new Game(net, settings);
const shooter = new ShooterGame(net, settings, game.renderer, game.hud);
window.__game = game; // tiện debug trong DevTools
window.__shooter = shooter;
const cards = new CardGame(net, settings, game.renderer, game.hud);   // đánh bài quanh bàn tròn
window.__cards = cards;
let inGame = false;
let current = null;   // game đang chơi: game | shooter

// ---------- Cảm ứng ----------
const touch = new TouchControls();
game.touch = shooter.touch = touch;
function applyTouch() {
  const on = settings.touch === 'on' || (settings.touch === 'auto' && IS_TOUCH);
  touch.setEnabled(on && inGame && current !== cards);   // đánh bài: chỉ dùng nút HTML, không cần joystick
  if (on && inGame && current !== cards) (current === shooter ? shooter : game).setupTouch();
}
function goFullscreen() {
  if (!IS_TOUCH) return;
  try {
    const el = document.documentElement;
    const p = el.requestFullscreen?.({ navigationUI: 'hide' }) || el.webkitRequestFullscreen?.();
    Promise.resolve(p).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  } catch { /* bỏ qua */ }
}

// ---------- Preview nhân vật ----------
const pvCanvas = $('preview');
const pv = new THREE.WebGLRenderer({ canvas: pvCanvas, antialias: true, alpha: true });
pv.setPixelRatio(Math.min(devicePixelRatio, 2));
const pvScene = new THREE.Scene();
pvScene.add(new THREE.HemisphereLight(0xffffff, 0x8877aa, 2.2));
const pvLight = new THREE.DirectionalLight(0xffffff, 2);
pvLight.position.set(2, 4, 3);
pvScene.add(pvLight);
const pvCam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
pvCam.position.set(0, 1.35, 5.2);
pvCam.lookAt(0, 0.95, 0);
let pvModel = null, pvChar = null;
// sàn mờ để vòng phép / sóng xung kích có chỗ "đặt chân"
const pvFloor = new THREE.Mesh(new THREE.CircleGeometry(24, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
pvFloor.rotation.x = -Math.PI / 2;
pvScene.add(pvFloor);
const pvFx = new FX(pvScene, pvCam);
pvFx.arena = { radius: 100, obstacles: [], boxes: [] };   // sân trống: đạn không va cột của map
const PV_HOME = new THREE.Vector3(-2.2, 0, 0);   // chỗ đứng khi diễn chiêu (nhìn sang +X)
const pvHand = new THREE.Vector3();
const pvCaster = {
  pos: () => pvModel.root.position,
  hand: () => { pvModel.rig.handR.getWorldPosition(pvHand); return pvHand; },
};
// Trạng thái diễn chiêu: lần lượt từng chiêu, bấm vào dòng chiêu để xem chiêu đó
// idx 0..5: chiêu thường, 6..11: chiêu dị biến (mô hình đổi sang dạng biến hình)
const demo = { idx: -1, t: 0, dur: 0, wait: 1.2, effect: null, dash: null, pinned: false, aw: false };
const pvCamPos = new THREE.Vector3(0, 1.35, 5.2), pvCamLook = new THREE.Vector3(0, 0.95, 0);
const pvCamWant = pvCamPos.clone(), pvLookWant = pvCamLook.clone();

// Tầm xa nhất mà hiệu ứng của chiêu chạm tới (để lùi camera cho vừa khung)
function skillReach(s) {
  switch (s.type) {
    case 'projectile': return Math.min(s.range, 16);
    case 'beam': return Math.min(s.length, 16);
    case 'dash': return s.dist + (s.explode ? s.explode.radius : 1);
    case 'aoe': return (s.at === 'front' ? s.offset : 0) + s.radius;
    case 'line': return s.start + s.spacing * s.count;
    case 'rain': return s.offset + s.area;
    case 'trap': case 'summon': return s.offset + s.radius;
    case 'leap': return Math.min(s.range, 10) + s.radius * 0.5;
    case 'blink': return s.dist + s.radius;
    case 'buff': return 2;
    case 'wall': return s.offset + 2;
    case 'smite': return 10;
    case 'multiblink': return 9;
    case 'pillar': return 9;
    case 'decoy': return 9;
    case 'icewall': case 'turret': return s.offset + 3;
    case 'timezone': return s.radius;
    case 'pet': return s.offset + 4;
    case 'quake': return 14;
    default: return s.range || 3;
  }
}

// ---------- Bia tập trong màn xem trước: cho thấy chiêu tác động lên đối thủ thế nào ----------
const pvDummy = buildChibi(getChar('dummy').look);
pvDummy.root.visible = false;
pvDummy.root.rotation.y = -Math.PI / 2;   // quay mặt về phía người ra chiêu
pvScene.add(pvDummy.root);
const dum = { home: new THREE.Vector3(), off: 0, vel: 0, y: 0, vy: 0, stun: 0, slow: 0, hits: [], s: null, ult: false };
let pvKick = 0;   // góc nhìn rộng ra thoáng chốc khi trúng đòn mạnh

// Bia đứng ở đâu để chiêu trúng (tính từ chỗ người ra chiêu, theo hướng +X)
function pvTargetDist(s) {
  switch (s.type) {
    case 'melee': return Math.max(1.6, s.range * 0.75);
    case 'projectile': return Math.min(7, s.range * 0.8);
    case 'dash': return Math.min(s.dist * 0.6, 7);
    case 'beam': return 7;
    case 'aoe': return s.at === 'front' ? s.offset : Math.max(1.8, s.radius * 0.6);
    case 'line': return s.start + s.spacing * 2;
    case 'rain': return s.offset;
    case 'leap': return Math.min(s.range, 9);
    case 'blink': return s.dist + 1.2;
    case 'wall': return s.offset + 0.5;
    case 'smite': return 7;
    case 'multiblink': return 6;
    case 'pillar': return 7;
    case 'quake': return 6;
    case 'timezone': return 5;
    case 'turret': return s.offset + 5;
    case 'pet': return s.offset + 2;
    case 'icewall': return s.offset + 1.5;
    case 'summon': return s.offset || 2.5;
    case 'trap': return s.offset;
    default: return 5;
  }
}

// Lịch các cú trúng bia (ước lượng như server tính): thời điểm, sát thương, đẩy lùi, hất lên, choáng, làm chậm
function previewHits(s, d) {
  const out = [], base = { dmg: s.dmg || 0, kb: s.pull ? -s.pull : (s.kb || 0), up: s.kbUp ?? (s.kb || 0) * 0.25, stun: s.stun || 0, slow: s.slow || null };
  const add = (t, o = {}) => out.push({ t, ...base, ...o });
  switch (s.type) {
    case 'melee':
      add(s.delay);
      if (s.echo) for (let i = 1; i <= s.echo.n; i++) add(s.delay + i * s.echo.gap, { dmg: Math.round(base.dmg * s.echo.mul), kb: base.kb * s.echo.mul });
      break;
    case 'projectile': {
      const at = s.delay + Math.max(0, d - 0.6) / s.speed, n = s.spread <= 0.15 ? Math.min(s.count, 3) : 1;
      for (let i = 0; i < n; i++) add(at + i * 0.04);
      if (s.explode) add(at + 0.03, { dmg: s.explode.dmg, kb: s.explode.kb, up: s.explode.kbUp });
      if (s.teleport) add(at + 0.06, { dmg: s.teleport.dmg, kb: s.teleport.kb, up: s.teleport.kbUp, stun: s.teleport.stun });
      if (s.boomerang) add(at + 2 * Math.max(0, s.range - d) / s.speed);
      break;
    }
    case 'dash': {
      const at = s.delay + s.dur * Math.min(1, d / s.dist), n = s.multi ? Math.min(s.multi, 6) : 1;
      for (let i = 0; i < n; i++) add(at + i * (s.multiInt || 0.1));
      if (s.explode) add(s.delay + s.dur, { dmg: s.explode.dmg, kb: s.explode.kb, up: s.explode.kbUp });
      if (s.clone) add(at + s.clone.delay, { dmg: s.clone.dmg, kb: s.clone.kb, up: s.clone.kbUp });
      if (s.grab) { add(at + s.grab.slam, { dmg: s.grab.slamDmg, kb: 0, up: 0, stun: s.grab.stun }); add(at + s.grab.dur, { dmg: s.grab.throwDmg, kb: s.grab.kb, up: s.grab.kbUp }); }
      break;
    }
    case 'beam': for (let t = s.delay; t < s.delay + s.dur; t += s.tickInt * 2) add(t, { dmg: base.dmg * 2 }); break;
    case 'aoe': for (let i = 0; i < Math.min(s.ticks, 8); i++) add(s.delay + i * s.tickInt); break;
    case 'line': add(s.delay + Math.max(0, Math.round((d - s.start) / s.spacing)) * s.interval); break;
    case 'rain': for (let i = 0; i < 4; i++) add(s.delay + (s.fall || 0) + i * s.count * s.interval / 4); break;
    case 'leap': add(s.delay + s.dur); break;
    case 'multiblink': for (let i = 0; i < s.strikes; i += 2) add(s.delay + i * s.interval); break;
    case 'timezone':
      for (let t = 0; t < s.dur; t += s.tickInt * 2) add(s.delay + t, { dmg: base.dmg * 2, kb: 0, up: 0.5 });
      add(s.delay + s.dur, { dmg: s.endDmg, stun: s.endStun, kb: 3, up: 6, slow: null });
      break;
    case 'turret': for (let i = 0; i < 3; i++) add(s.delay + 0.4 + i * s.every, { dmg: s.shot.dmg, kb: s.shot.kb, up: 0.5, slow: s.shot.slow }); break;
    case 'trap': case 'buff': case 'decoy': break;
    default: add(s.delay);   // blink, smite, summon, wall, pillar, quake, pet, icewall
  }
  return out.sort((a, b) => a.t - b.t);
}

// Số sát thương / trạng thái nổi lên trên đầu bia
function pvNumber(text, cls) {
  const st = pvCanvas.parentElement, v = pvDummy.root.position.clone();
  v.y += 2 + Math.random() * 0.3;
  v.project(pvCam);
  const el = document.createElement('div');
  el.className = 'pvdmg ' + (cls || '');
  el.textContent = text;
  el.style.left = ((v.x + 1) * 50 + (Math.random() - 0.5) * 6) + '%';
  el.style.top = ((1 - v.y) * 50) + '%';
  st.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function dummyHit(h) {
  const s = dum.s, p = pvDummy.root.position;
  pvDummy.hitFlash?.();
  dum.vel += h.kb * 0.55;                       // đẩy lùi (âm: kéo về phía người ra chiêu)
  if (h.up > 2.5) dum.vy = Math.max(dum.vy, h.up * 0.75);
  const big = h.dmg >= 15;
  pvFx.hitSpark(new THREE.Vector3(p.x - 0.3, p.y + 1, p.z), s.fx.color, big);
  if (h.dmg) pvNumber(h.dmg, big ? 'big' : '');
  if (h.stun && dum.stun <= 0) pvNumber('Choáng!', 'tag');
  else if (h.slow && dum.slow <= 0) pvNumber('Chậm', 'tag ice');
  else if (h.kb < -1 && Math.abs(dum.vel) < 3) pvNumber('Bị kéo', 'tag');
  else if (h.up > 7 && dum.y < 0.3) pvNumber('Hất tung!', 'tag');
  if (h.stun) dum.stun = Math.max(dum.stun, h.stun);
  if (h.slow) dum.slow = Math.max(dum.slow, h.slow.dur);
  // cú trúng đầu tiên của tuyệt kỹ: nổ lớn, góc nhìn giật ra
  if (dum.ult) {
    dum.ult = false;
    pvFx.ultImpact(new THREE.Vector3(p.x, 0, p.z), s.fx.color, s.fx.core || s.fx.color, Math.min(5, s.radius || 4));
    pvKick = Math.max(pvKick, 6);
  } else if (big) pvKick = Math.max(pvKick, 2);
}

function updateDummy(dt) {
  if (!pvDummy.root.visible) return;
  while (dum.hits.length && demo.t >= dum.hits[0].t) dummyHit(dum.hits.shift());
  // văng ra theo đòn rồi tự về chỗ cũ
  dum.off += dum.vel * dt;
  dum.vel *= Math.max(0, 1 - dt * 5);
  dum.vy -= 22 * dt;
  dum.y = Math.max(0, dum.y + dum.vy * dt);
  if (dum.y === 0 && dum.vy < 0) dum.vy = 0;
  if (Math.abs(dum.vel) < 0.6 && dum.y === 0) dum.off += (0 - dum.off) * Math.min(1, dt * 1.8);
  dum.off = Math.max(-3, Math.min(6, dum.off));
  const p = pvDummy.root.position;
  p.set(dum.home.x + dum.off, dum.y, dum.home.z);
  dum.stun -= dt; dum.slow -= dt;
  // choáng: lắc lư + sao quay trên đầu; chậm: hạt băng xanh
  pvDummy.root.rotation.z = dum.stun > 0 ? Math.sin(demo.t * 18) * 0.12 : 0;
  if (dum.stun > 0 && Math.random() < 0.5) { const a = demo.t * 8; pvFx.parts.emit(p.x + Math.cos(a) * 0.5, p.y + 2.3, p.z + Math.sin(a) * 0.5, 0, 0, 0, 0xffe066, 0.25, 0.25); }
  if (dum.slow > 0 && Math.random() < 0.3) pvFx.parts.emit(p.x + (Math.random() - 0.5) * 0.8, p.y + Math.random() * 1.6, p.z + (Math.random() - 0.5) * 0.8, 0, -0.5, 0, 0x9bdcff, 0.22, 0.6);
  pvDummy.update(dt, dum.stun > 0 ? ANIM.stun : dum.y > 0.2 ? ANIM.air : ANIM.idle);
}

function setPreview(id) {
  pvChar = getChar(id);
  setPvForm(false);
  stopDemo();
  demo.idx = -1; demo.wait = 1.0; demo.pinned = false;
}

// đổi mô hình xem trước giữa dạng thường / dạng dị biến
function setPvForm(aw) {
  if (pvModel && demo.aw === aw && pvModel.char === pvChar) return;
  const pos = pvModel ? pvModel.root.position.clone() : null;
  pvModel?.dispose();
  const A = pvChar.awaken;
  pvModel = buildChibi(aw ? { ...pvChar.look, ...A.look, form: A.form, formColor: A.color, formCore: A.core } : pvChar.look);
  pvModel.char = pvChar;
  if (pos) pvModel.root.position.copy(pos);
  pvScene.add(pvModel.root);
  demo.aw = aw;
}

function stopDemo() {
  if (demo.effect) { demo.effect.done = true; demo.effect = null; }
  dum.hits = []; pvDummy.root.visible = false;
  for (const e of pvFx.list) e.done = true;
  demo.dash = null;
  if (pvModel) { pvModel.root.position.set(0, 0, 0); }
  $('pvSkill').classList.remove('on');
  for (const el of document.querySelectorAll('#skillList .skill-row')) el.classList.remove('playing');
}

function playSkill(i) {
  const aw = i >= 6;
  const s = charSkills(pvChar, aw)[i % 6];
  stopDemo();
  if (aw !== demo.aw) {
    setPvForm(aw);
    // lần đầu chuyển sang chiêu dị biến: diễn cảnh biến hình
    if (aw) pvFx.awakenBurst(() => pvModel.root.position, pvChar.awaken.color, pvChar.awaken.core, 0.8);
  }
  demo.idx = i;
  demo.t = 0;
  demo.dur = Math.min(4.5, skillLifetime(s) + (s.type === 'rain' ? 1.2 : 0.9));
  if (s.type === 'buff' || s.type === 'leap') demo.dur = Math.min(4.5, Math.max(demo.dur, s.delay + (s.dur || 0) + 1));
  const m = pvModel;
  m.root.position.copy(PV_HOME);
  m.root.rotation.y = Math.PI / 2;
  m.root.visible = true;
  m.play(s.pose, s.lock);
  const h = new THREE.Vector3(1, 0, 0);
  const d = new THREE.Vector3(1, s.type === 'projectile' && s.steer ? 0.05 : 0, 0).normalize();
  // điểm đích giả lập như server sẽ tính
  let tg = null;
  if (s.type === 'trap' || s.type === 'summon' || s.type === 'wall') tg = [PV_HOME.x + s.offset, 0];
  if (s.type === 'leap') tg = [PV_HOME.x + Math.min(s.range, 9), 0];
  if (s.type === 'pillar') tg = [PV_HOME.x + 7, 0];
  if (s.type === 'icewall' || s.type === 'turret') { tg = [PV_HOME.x + s.offset, 0]; demo.dur = Math.max(demo.dur, s.delay + 2.8); }
  if (s.type === 'decoy') demo.dur = Math.max(demo.dur, 2);
  if (s.type === 'timezone') demo.dur = Math.min(4.5, s.delay + 3);
  if (s.type === 'pillar') demo.dur = Math.max(demo.dur, s.delay + 2.8);
  if (s.type === 'quake') demo.dur = Math.max(demo.dur, s.delay + 1);
  // preview: các hiệu ứng cần server (cột đá...) tự dựng bản giả
  demo.effect = pvFx.castSkill({ skill: s, p: m.root.position.clone(), d, h, seed: 12345 + i, tg, caster: pvCaster, preview: true });
  // bia tập đứng đúng tầm trúng, nhận đòn theo lịch ước lượng
  const td = pvTargetDist(s);
  dum.home.set(PV_HOME.x + td, 0, 0);
  dum.off = 0; dum.vel = 0; dum.y = 0; dum.vy = 0; dum.stun = 0; dum.slow = 0;
  dum.s = s; dum.hits = previewHits(s, td); dum.ult = s.combo === 'JKL';
  pvDummy.root.position.copy(dum.home);
  pvDummy.root.visible = true;
  if (dum.hits.length) demo.dur = Math.min(4.5, Math.max(demo.dur, dum.hits[dum.hits.length - 1].t + 1));
  if (s.type === 'dash') demo.dash = { h, v: s.dist / s.dur, delay: s.delay, dur: s.dur };
  demo.leap = s.type === 'leap' ? { from: PV_HOME.clone(), to: new THREE.Vector3(tg[0], 0, 0), delay: s.delay, dur: s.dur, h: s.height || 5 } : null;
  // sét giáng (smite) / lướt chém (multiblink): diễn trên vài điểm giả lập phía trước
  demo.smite = s.type === 'smite' ? { at: s.delay, done: false, s } : null;
  demo.multi = s.type === 'multiblink' ? { s, n: 0 } : null;
  if (demo.multi || demo.smite) demo.dur = Math.max(demo.dur, s.delay + (s.strikes || 1) * (s.interval || 0.3) + 1);
  demo.blink = s.type === 'blink' ? { at: s.delay, to: new THREE.Vector3(PV_HOME.x + s.dist, 0, 0), done: false, s } : null;
  demo.tele = s.teleport ? { at: s.delay + Math.min(s.range, 12) / s.speed, to: new THREE.Vector3(PV_HOME.x + Math.min(s.range, 12) - 1.2, 0, 0), done: false, s } : null;
  demo.stealth = !!s.stealth;
  // góc máy như trong trận: sau lưng chếch bên nhân vật, nhìn theo hướng ra chiêu
  demo.reach = Math.min(skillReach(s), 12);
  demo.high = s.type === 'rain';
  $('pvSkill').innerHTML = `${aw ? '⚡ ' : ''}${[...s.combo].map(k => `<kbd>${esc(comboKey(k))}</kbd>`).join('')} ${s.combo.length === 3 ? '★ ' : ''}${esc(s.name)}`;
  $('pvSkill').style.color = hex(s.fx.color);
  $('pvSkill').classList.add('on');
  document.querySelectorAll('#skillList .skill-row').forEach(el => el.classList.toggle('playing', +el.dataset.i === i));
}

function updateDemo(dt) {
  const m = pvModel;
  if (demo.idx < 0) {
    // đứng xoay giới thiệu trước khi diễn chiêu đầu tiên
    m.root.rotation.y += dt * 0.6;
    pvCamWant.set(0, 1.35, 5.2); pvLookWant.set(0, 0.95, 0);
    demo.wait -= dt;
    if (demo.wait <= 0) playSkill(0);
    return;
  }
  demo.t += dt;
  updateDummy(dt);
  const dd = demo.dash;
  if (dd && demo.t >= dd.delay && demo.t <= dd.delay + dd.dur + dt) m.root.position.addScaledVector(dd.h, dd.v * dt);
  const lp = demo.leap;
  if (lp && demo.t >= lp.delay) {
    const k = Math.min(1, (demo.t - lp.delay) / lp.dur);
    m.root.position.lerpVectors(lp.from, lp.to, k);
    m.root.position.y = Math.sin(Math.PI * k) * Math.min(lp.h, 8);
  }
  const sm = demo.smite;
  if (sm && !sm.done && demo.t >= sm.at) {
    sm.done = true;
    for (const x of [4, 7, 10]) pvFx.judgement(new THREE.Vector3(PV_HOME.x + x, 1, (x - 7) * 0.8), sm.s.fx.color, x === 4);
  }
  const mb = demo.multi;
  if (mb && mb.n < mb.s.strikes && demo.t >= mb.s.delay + mb.n * mb.s.interval) {
    // lướt chém luân phiên giữa 2 điểm giả lập
    const to = new THREE.Vector3(PV_HOME.x + (mb.n % 2 ? 9 : 5), 0, mb.n % 2 ? -1.2 : 1.2);
    pvFx.blinkFx(m.root.position.clone(), to, mb.s.fx.color, mb.s.fx.core);
    m.root.position.copy(to);
    pvFx.hitSpark(to.clone().setY(1).add(new THREE.Vector3(1, 0, 0)), mb.s.fx.color, true);
    mb.n++;
  }
  // dịch chuyển: tới nơi thì gây sát thương quanh mình
  for (const b of [demo.blink, demo.tele]) {
    if (b && !b.done && demo.t >= b.at) {
      b.done = true;
      pvFx.blinkFx(m.root.position.clone(), b.to, b.s.fx.color, b.s.fx.core || 0xffffff);
      m.root.position.copy(b.to);
      if (b.s.teleport) pvFx.explosion(b.to.clone().setY(1), b.s.fx.color, b.s.teleport.radius * 0.6, b.s.fx.core);
    }
  }
  // tàng hình: nhân vật nhấp nháy mờ trong lúc ẩn
  if (demo.stealth) m.root.visible = demo.t > 2.6 || Math.sin(demo.t * 30) > 0.6;
  // camera bám theo nhân vật (kể cả khi lướt), lùi thêm theo tầm chiêu
  const base = m.root.position, r = demo.reach;
  pvCamWant.set(base.x - 5.2 - r * 0.15, 2.5 + (demo.high ? 1.4 : 0) + base.y * 0.7, base.z + 1.8 + r * 0.1);
  pvLookWant.set(base.x + 3 + r * 0.3, (demo.high ? 3 : 1.2) + base.y * 0.7, base.z);
  if (demo.t >= demo.dur) {
    if (demo.pinned) { demo.pinned = false; }
    playSkill((demo.idx + 1) % 12);
  }
}

let pvLast = performance.now();
function pvLoop() {
  requestAnimationFrame(pvLoop);
  if (inGame || !pvModel) return;
  const t = performance.now();
  const dt = Math.min(0.05, (t - pvLast) / 1000);
  pvLast = t;
  const w = pvCanvas.clientWidth, h = pvCanvas.clientHeight;
  if (pvCanvas.width !== Math.floor(w * pv.getPixelRatio())) { pv.setSize(w, h, false); pvCam.aspect = w / h; pvCam.updateProjectionMatrix(); }
  updateDemo(dt);
  pvModel.update(dt, ANIM.idle);
  pvFx.update(dt);
  // góc nhìn rộng khi diễn chiêu, hẹp khi đứng giới thiệu
  pvKick = Math.max(0, pvKick - dt * 12);
  const fov = (demo.idx < 0 ? 32 : 50) + pvKick;
  if (Math.abs(pvCam.fov - fov) > 0.05) { pvCam.fov += (fov - pvCam.fov) * Math.min(1, dt * (pvKick > 0.1 ? 20 : 4)); pvCam.updateProjectionMatrix(); }
  pvCamPos.lerp(pvCamWant, Math.min(1, dt * 4));
  pvCamLook.lerp(pvLookWant, Math.min(1, dt * 4));
  pvCam.position.copy(pvCamPos);
  pvCam.lookAt(pvCamLook);
  pv.render(pvScene, pvCam);
}
pvLoop();

// ---------- Chỉ số nhân vật (ước lượng từ dữ liệu chiêu, so sánh giữa các nhân vật) ----------
function skillDamage(s) {
  // sát thương dự kiến lên một mục tiêu đứng trong vùng chiêu
  switch (s.type) {
    case 'projectile': return s.dmg * (s.spread <= 0.15 ? s.count : 1) + (s.explode ? s.explode.dmg : 0) + (s.teleport ? s.teleport.dmg : 0);
    case 'beam': return s.dmg * Math.floor(s.dur / s.tickInt);
    case 'aoe': return s.dmg * s.ticks;
    case 'dash': return s.dmg + (s.explode ? s.explode.dmg * 0.5 : 0);
    case 'buff': return 0;
    case 'rain': return s.dmg * s.count * Math.min(1, 2 * ((s.radius + 0.6) / s.area) ** 2);
    default: return s.dmg;
  }
}
const STAT_DEFS = [
  { k: 'hp', n: '❤ Máu', c: '#4ade80', v: c => c.hp || 150, show: v => v },
  { k: 'dmg', n: '⚔ Sát thương', c: '#ff6b6b', v: c => c.skills.reduce((a, s) => a + skillDamage(s), 0) },
  { k: 'range', n: '🎯 Tầm đánh', c: '#ffd166', v: c => Math.max(...c.skills.map(s => Math.min(skillReach(s), 30))) + c.skills.filter(s => ['projectile', 'beam', 'rain'].includes(s.type)).length * 3 },
  { k: 'cc', n: '❄ Khống chế', c: '#7cc4ff', v: c => c.skills.reduce((a, s) => a + (s.stun || 0) * (s.type === 'aoe' ? s.ticks : 1) + (s.slow ? (1 - s.slow.mul) * s.slow.dur * 1.5 : 0) + (s.pull ? 0.5 : 0), 0) },
  { k: 'mob', n: '💨 Cơ động', c: '#c77dff', v: c => c.speedMul * 10 + c.skills.reduce((a, s) => a + (s.type === 'dash' || s.type === 'blink' ? s.dist / 3 : 0) + (s.type === 'leap' ? 3 : 0) + (s.teleport ? 3 : 0) + (s.leap ? 2 : 0) + (s.stealth ? 2 : 0), 0) },
];
const STAT_RANGE = STAT_DEFS.map(d => {
  const vals = CHARACTERS.map(d.v);
  return [Math.min(...vals), Math.max(...vals)];
});
function renderStats(c) {
  $('charStats').innerHTML = STAT_DEFS.map((d, i) => {
    const v = d.v(c), [lo, hi] = STAT_RANGE[i];
    const p = hi > lo ? 18 + ((v - lo) / (hi - lo)) * 82 : 60;
    const label = d.show ? d.show(v) : ['Thấp', 'Khá', 'Cao', 'Rất cao'][Math.max(0, Math.min(3, Math.floor((p - 18) / 82 * 4 - 1e-9)))];
    return `<div class="stat" style="--c:${d.c}"><span>${d.n}</span><span class="bar"><i style="width:${p.toFixed(0)}%"></i></span><b>${label}</b></div>`;
  }).join('');
}

// ---------- Mô tả chiêu (nút ! trong danh sách chiêu) ----------
// Sinh tự động từ dữ liệu chiêu nên luôn khớp số liệu sau mỗi lần cân bằng; chiêu có `desc` thì câu đó đứng đầu.
const pct = x => Math.round(x * 100) + '%';
const sec = x => (Math.round(x * 100) / 100) + ' giây';
const m_ = x => (Math.round(x * 10) / 10) + ' m';
// tên gọi hình ảnh của chiêu theo kiểu hiệu ứng (fx.kind), để câu mô tả nói đúng thứ người chơi nhìn thấy
const FX_NOUN = { shuriken: 'phi tiêu', thorn: 'gai độc', rock: 'tảng đá', kiBlast: 'khí đạn', iceShard: 'mảnh băng', crescent: 'trăng lửa', bolt: 'lôi tiễn',
  windBlade: 'lưỡi gió', spearRod: 'thương sét', pillarThrow: 'cột đá', kunaiThrow: 'kunai', kiFist: 'nắm đấm khí', iceLance: 'băng thương', bigBomb: 'quả cầu năng lượng khổng lồ' };
const FX_MELEE = { slash: 'Chém', impact: 'Đấm', quakePunch: 'Đấm chấn động hình nón', flameSlash: 'Chém lửa' };
const FX_DASH = { rockRoll: 'Cuộn tròn thành tảng đá lăn', phoenix: 'Hóa phượng hoàng lửa lao', flurry: 'Lao đấm loạn', windDash: 'Lướt gió', spiralOrb: 'Đẩy quả cầu gió xoáy lao',
  thunderDash: 'Hóa tia sét lướt', iceSkate: 'Trượt băng', dragonTornado: 'Cưỡi rồng lốc lao', dashPunch: 'Lao đấm' };
const FX_AOE = { bladeStorm: 'Bão đao xoáy', thunderRing: 'Vòng sét', tornado: 'Lốc xoáy', quake: 'Đập đất chấn động', frostNova: 'Kết giới băng nổ tung', flameRise: 'Cột lửa xoáy bốc lên',
  flameRing: 'Vòng lửa', stoneCage: 'Đất trồi', shadowMist: 'Màn sương bóng', bloom: 'Hoa nở bung' };
const FX_LINE = { vineSpike: 'rễ gai', iceSpike: 'gai băng', firePillar: 'cột lửa' };
const FX_RAIN = { icicleRain: 'băng nhọn', lightning: 'sét', meteor: 'thiên thạch', petalRain: 'cánh hoa', thornForest: 'gai' };
function describeSkill(s) {
  const k = s.fx.kind;
  const what = [], chips = [];
  const add = t => t && what.push(t);
  if (s.desc) add(s.desc);
  if (s.chain) add(`Đòn kết chuỗi đánh thường: bấm ${comboKey('J')} 3 lần liên tiếp (trong 1.2 giây), đòn thứ 3 tự đổi thành chiêu này.`);
  switch (s.type) {
    case 'melee':
      add(`${FX_MELEE[k] || 'Đòn cận chiến'} trước mặt, tầm ${m_(s.range)}, quét ${Math.round(s.arc * 2 * 57)}°${s.lunge ? `, lao người tới trước` : ''}.`);
      if (s.echo) add(`${s.echo.n} phân thân chém theo ngay sau, mỗi nhát ${pct(s.echo.mul)} sát thương.`);
      if (s.backstab) add(`Đâm trúng sau lưng đối thủ: sát thương ×${s.backstab}.`);
      if (s.marks) add(`Cộng ${s.marks} dấu điện một lúc.`);
      if (s.fireZone) add(`Để lại vệt lửa trên sàn ${sec(s.fireZone.dur)}: đối thủ đứng vào bị bỏng.`);
      break;
    case 'projectile': {
      const noun = FX_NOUN[k] || 'quả cầu năng lượng', n = s.count > 1 ? `${s.count} ${noun}` : noun;
      add(`Phóng ${n} bay ${m_(s.range)}${s.pierce ? ', xuyên qua mọi người trên đường bay' : ''}${s.seek ? ', tự bẻ hướng tìm đối thủ gần nhất' : ''}.`);
      if (s.boomerang) add('Bay hết tầm thì quay về tay người ném, trúng được cả lượt đi lẫn lượt về.');
      if (s.explode) add(`Nổ lan ${m_(s.explode.radius)} (thêm ${s.explode.dmg} sát thương, đứng càng gần càng đau).`);
      if (s.bounce) add(`Trúng thì sét nảy sang ${s.bounce.n} đối thủ gần đó (${s.bounce.dmg} mỗi người).`);
      if (s.mark) add(`Phi đao đầu tiên để lại dấu bóng ${sec(s.mark)}: Thuấn Ảnh dịch chuyển tới đó.`);
      if (s.teleport) add(`Thương cắm ở đâu thì dịch chuyển tới đó, nổ sét ${m_(s.teleport.radius)} (${s.teleport.dmg} + choáng ${sec(s.teleport.stun)}).`);
      if (s.rod) add(`Trượt không trúng ai thì cắm thành cọc sét (${sec(s.rod.dur)}, tối đa ${s.rod.max} cọc). Hai cọc cách nhau dưới ${m_(s.rod.fence.range)} nối thành hàng rào điện: đối thủ chạm vào mất ${s.rod.fence.dmg} máu, nhảy qua thì né được.`);
      if (s.rip) add(`Có cột đá của mình trong ${m_(s.rip.range)} thì nhổ cột đó lên ném: to hơn, ${s.rip.over.dmg} sát thương, nổ ${m_(s.rip.over.explode.radius)}.`);
      if (s.iceAt) add(`Chỗ trúng đóng băng sàn ${sec(s.iceAt.dur)}: đối thủ đứng trên băng bị trơn trượt.`);
      if (s.hold) add(`Giữ phím để tụ lực (tối đa ${sec(s.hold.max)}): giữ càng lâu càng to, sát thương tới ×${s.hold.dmg}.`);
      if (s.steer) add('Trong lúc bay, xoay chuột (điện thoại: giữ nút ★ rồi kéo) để lái theo tâm ngắm.');
      break;
    }
    case 'dash':
      add(`${s.grab ? 'Lao' : FX_DASH[k] || 'Lao'} tới ${m_(s.dist)}${s.free3d ? ' theo đúng hướng ngắm, kể cả lên trời hay bổ xuống' : ''}${s.grab ? '' : s.multi ? `, đánh ${s.multi} nhịp vào ai trên đường` : ', đánh trúng mọi người trên đường lao'}.`);
      if (s.invuln && !s.bigCharge) add('Bất tử trong lúc lao.');
      if (s.clone) add(`Lướt qua ai thì ${sec(s.clone.delay)} sau phân thân gió chém thêm 1 nhát (${s.clone.dmg}).`);
      if (s.grab) add(`Túm đối thủ đầu tiên trúng: nhấc bổng lên, quật xuống đất (${s.grab.slamDmg} + choáng ${sec(s.grab.stun)}) rồi ném văng theo hướng nhìn (${s.grab.throwDmg}). Không túm được người đang bất tử hoặc miễn đẩy lùi.`);
      if (s.explode) add(`Cuối đường lao nổ ${m_(s.explode.radius)} (${s.explode.dmg} sát thương${s.explode.kbUp >= 10 ? ', tung đối thủ lên trời' : ''}).`);
      if (s.iceTrail) add('Đường trượt để lại vệt băng làm đối thủ trơn trượt.');
      if (s.ignite) add(`Lao xong, mọi vệt lửa của Homura trên sàn cùng bùng thành cột lửa (${s.ignite.dmg}).`);
      if (s.steer) add(`Trong lúc lao, xoay chuột để lái hướng${s.steer.fly ? ' và độ cao (ngẩng camera để bay lên, nhìn xuống để bổ nhào)' : ''}.`);
      break;
    case 'beam':
      add(`Chưởng một tia dài ${m_(s.length)} trong ${sec(s.dur)}, trúng ${Math.floor(s.dur / s.tickInt)} nhịp × ${s.dmg} sát thương.`);
      if (s.steer) add('Xoay chuột để quét tia theo tâm ngắm, cả ngang lẫn dọc.');
      if (s.hold) add(`Giữ phím L để tụ lực (tối đa ${sec(s.hold.max)}): tia to hơn, sát thương tới ×${s.hold.dmg}.`);
      break;
    case 'aoe':
      add(`${FX_AOE[k] || 'Vùng chiêu'} ${m_(s.radius)} ${s.at === 'front' ? `ở ${m_(s.offset)} phía trước` : 'quanh mình'}${s.follow ? ', bám theo người' : ''}${s.ticks > 1 ? `, đánh ${s.ticks} nhịp × ${s.dmg}` : ''}.`);
      if (s.pull) add('Kéo đối thủ vào giữa vùng.');
      if (s.walls) add(`Dựng vòng ${s.walls.count} cột đá nhốt đối thủ ${sec(s.walls.dur)}.`);
      if (s.healSelf) add(`Hồi ${s.healSelf} máu cho người ra chiêu.`);
      if (s.rodPulse) add(`Mọi cọc sét trong ${m_(s.rodPulse.range)} cũng phóng vòng sét ${m_(s.rodPulse.radius)} kéo người về phía cọc.`);
      if (s.steer) add('Xoay chuột để kéo vùng chiêu theo tâm ngắm.');
      break;
    case 'line': add(`Chuỗi ${s.count} ${FX_LINE[k] || 'mũi'} trồi lên thẳng phía trước, dài ${m_(s.start + s.spacing * s.count)}; mỗi đối thủ trúng 1 lần.`); break;
    case 'rain':
      add(`Mưa ${FX_RAIN[k] || 'chiêu'} ${s.count} đợt rơi xuống vùng ${m_(s.area)} ở ${m_(s.offset)} phía trước.`);
      if (s.steer) add('Xoay chuột để kéo vùng mưa theo tâm ngắm.');
      break;
    case 'trap': add(`Đặt bẫy ở ${m_(s.offset)} phía trước (tồn tại ${sec(s.dur)}, tối đa ${s.max} bẫy): đối thủ giẫm vào bị trói và mất máu.`); break;
    case 'summon':
      if (s.obstacle) add(`Cây thần trồi lên ở ${m_(s.offset)} phía trước, hất tung đối thủ quanh gốc, đứng ${sec(s.dur)} và chắn đạn.`);
      else add(`Thảm hoa nở quanh mình ${sec(s.dur)}, hất văng đối thủ khi nở.`);
      if (s.aura) add(`Hồi ${s.aura.heal} máu mỗi ${sec(s.aura.every)} cho mình và đồng đội đứng trong ${m_(s.aura.radius)}.`);
      break;
    case 'leap': add(`Nhảy vọt tới điểm tâm ngắm (tối đa ${m_(s.range)}${s.height ? `, cao ${m_(s.height)}` : ''}), đáp xuống đập đất ${m_(s.radius)}.`); if (s.walls) add(`Dựng vòng ${s.walls.count} cột đá ${sec(s.walls.dur)} quanh chỗ đáp.`); if (s.fireZone) add('Chỗ đáp thành vũng lửa lớn.'); break;
    case 'blink':
      if (s.swap) add(`Đổi chỗ với phân thân mồi gần tâm ngắm nhất (trong ${m_(s.swap)}).`);
      if (s.toRod) add(`Dịch chuyển tới cọc sét gần tâm ngắm nhất (trong ${m_(s.toRod)}).`);
      if (s.behind) add(`${s.swap ? 'Không có phân thân thì d' : 'D'}ịch chuyển ra sau lưng đối thủ gần tâm ngắm (trong ${m_(s.behind)}).`);
      if (s.markRange) add(`Có dấu phi đao trong ${m_(s.markRange)} thì dịch chuyển tới đó.`);
      add(`${s.behind || s.toRod || s.markRange ? 'Nếu không thì d' : 'D'}ịch chuyển ${m_(s.dist)} về phía trước. Tới nơi đánh quanh mình ${m_(s.radius)}.`);
      break;
    case 'buff': {
      const fx = [];
      if (s.dmgTaken) fx.push(`giảm ${pct(1 - s.dmgTaken)} sát thương nhận vào`);
      if (s.noKb) fx.push('không bị đẩy lùi, không bị choáng');
      if (s.stealth) fx.push('tàng hình, đối thủ không khoá mục tiêu được');
      if (s.invuln) fx.push('không nhận sát thương');
      if (s.nextHitMul && s.nextHitMul > 1) fx.push(`đòn đầu tiên sau đó ×${s.nextHitMul}`);
      add(`Trong ${sec(s.dur)}: ${fx.join(', ')}.`);
      break;
    }
    case 'wall': add(`Dựng tường gió rộng ${m_(s.width)} ở ${m_(s.offset)} phía trước trong ${sec(s.dur)}: chặn đạn của đối thủ, đạn của mình bay xuyên, hất văng người đứng sát.${s.lift ? ' Bước vào chân tường thì được gió đẩy bay vọt lên.' : ''}`); break;
    case 'smite':
      add(`Sét giáng xuống mọi đối thủ trong ${m_(s.range)}; mỗi dấu điện trên người thêm ${s.perMark} sát thương.`);
      if (s.rodDmg) add(`Mỗi cọc sét phóng thêm 1 tia (${s.rodDmg}) vào đối thủ gần nó nhất trong ${m_(s.rodRange)}.`);
      break;
    case 'multiblink':
      add(`Lướt chém lần lượt ${s.strikes} nhát vào các đối thủ trong ${m_(s.range)}, mỗi nhát dịch chuyển ra sau lưng người bị chém.`);
      if (s.dark) add(`Kèm sương đêm: đối thủ trong ${m_(s.dark.range)} chỉ nhìn thấy người trong ${m_(s.dark.see)} suốt ${sec(s.dark.dur)}.`);
      break;
    case 'pillar': add(`Cột đá cao ${m_(s.h)} trồi lên ở điểm tâm ngắm (tầm ${m_(s.range)}, ${sec(s.dur)}, ${s.hp} máu, tối đa ${s.max} cột): chắn đường và chắn đạn, đứng lên nóc được. Trồi dưới chân đối thủ thì hất tung, dưới chân mình thì nâng mình lên.`); break;
    case 'quake': add(`Dậm đất cả sân: mọi đối thủ đang đứng trên mặt đất trong ${m_(s.range)} bị choáng ${sec(s.stun)}; ai đang ở trên không (nhảy, bay, đứng trên cột đá) thì né được. Cột đá của mình vỡ tung bắn mảnh.`); break;
    case 'decoy': add(`Tàng hình ${sec(s.stealth)} và thả ${s.count} phân thân giống hệt mình chạy chéo về phía trước (${sec(s.dur)}). Đối thủ thấy như người thật; trúng 1 đòn là tan, nổ bóng làm chậm người đứng gần.`); break;
    case 'icewall': add(`Dựng tường băng cong ${s.segs} khối ở ${m_(s.offset)} phía trước (${sec(s.dur)}, mỗi khối ${s.hp} máu): chắn đường và chắn đạn của cả hai bên. Bị đập vỡ thì mảnh băng làm chậm người đứng gần.`); break;
    case 'timezone': add(`Vùng ngưng đọng ${m_(s.radius)} quanh mình trong ${sec(s.dur)}: đối thủ và đạn của đối thủ đi vào chậm ${pct(1 - s.slowMul)}, sàn thành băng, mất ${s.dmg} máu mỗi ${sec(s.tickInt)}. Hết giờ băng vỡ tung (${s.endDmg} + choáng ${sec(s.endStun)}).`); break;
    case 'turret': add(`Trồng cây bắn gai ở ${m_(s.offset)} phía trước (${sec(s.dur)}, ${s.hp} máu, tối đa ${s.max} cây): tự bắn gai làm chậm vào đối thủ gần nhất trong ${m_(s.range)} mỗi ${sec(s.every)} (${s.shot.dmg} mỗi gai).`); break;
    case 'pet': { const pc = getChar(s.pet); add(`Gọi ${pc.name} trồi lên trước mặt (hất tung đối thủ quanh đó), đi theo mình ${sec(s.dur)}, tự đấm đối thủ ở gần và lấy thân chặn đạn (${pc.hp} máu).`); break; }
  }
  if (s.bigCharge) add(`Tụ lực ${sec(s.delay)} trước khi bung: dễ bị ngắt nếu đứng gần đối thủ.`);
  // chỉ số
  const dmg = Math.round(skillDamage(s));
  if (dmg) chips.push(['⚔', `~${dmg} sát thương`]);
  const reach = Math.round(Math.min(skillReach(s), 40));
  if (s.type !== 'buff' && reach) chips.push(['🎯', `tầm ~${reach} m`]);
  chips.push(['⏱', `hồi ${sec(s.cd)}`]);
  chips.push(['💧', s.mana ? `${s.mana} MP` : 'miễn phí']);
  if (s.stun) chips.push(['💫', `choáng ${sec(s.stun)}`]);
  if (s.slow) chips.push(['🐢', `chậm ${pct(1 - s.slow.mul)} trong ${sec(s.slow.dur)}`]);
  if (s.pull) chips.push(['🧲', 'kéo về']);
  else if ((s.kbUp || 0) >= 7) chips.push(['⤴', 'hất tung']);
  else if ((s.kb || 0) >= 9) chips.push(['💥', 'đẩy lùi mạnh']);
  if (s.root) chips.push(['🦶', 'đứng yên khi tung']);
  return { what, chips };
}

function skillDescHtml(s) {
  const { what, chips } = describeSkill(s);
  return `<div class="sk-desc" style="--c:${hex(s.fx.color)}">${what.map(t => `<p>${esc(t)}</p>`).join('')}
    <div class="sk-chips">${chips.map(([i, t]) => `<span>${i} ${esc(t)}</span>`).join('')}</div></div>`;
}

// ---------- Danh sách nhân vật ----------
function charCard(c, onPick) {
  const d = document.createElement('div');
  d.className = 'char-card';
  d.style.setProperty('--c', hex(c.skills[1].fx.color));
  d.style.setProperty('--h', hex(c.look.hair));
  d.style.setProperty('--o', hex(c.look.outfit));
  d.innerHTML = `<div class="face"></div><b>${esc(c.name)}</b><small>${esc(c.title)}</small>`;
  d.onclick = () => { sfx('ui'); onPick(c.id); };
  d.dataset.id = c.id;
  return d;
}

function renderCharList() {
  const list = $('charList');
  list.innerHTML = '';
  for (const c of CHARACTERS) list.appendChild(charCard(c, pickChar));
  pickChar(settings.char, true);
}

function pickChar(id, silent) {
  const c = getChar(id);
  settings.char = c.id;
  saveSettings();
  for (const el of document.querySelectorAll('#charList .char-card')) el.classList.toggle('sel', el.dataset.id === c.id);
  $('charInfo').innerHTML = `<b>${esc(c.name)}</b> — ${esc(c.title)}<br>${esc(c.desc)}`;
  const row = (s, i) => `<div class="skill-row${s.combo.length === 3 ? ' ult' : ''}${i >= 6 ? ' aw' : ''}" style="--c:${hex(s.fx.color)}" data-i="${i}" title="Bấm để xem chiêu">
      <span>${[...s.combo].map(k => `<kbd>${esc(comboKey(k))}</kbd>`).join('')}</span><span>${esc(s.name)} <span class="play">▶</span></span>
      <span class="cost">${s.mana ? s.mana + ' MP' : 'Miễn phí'}</span>
      <button class="sk-info" data-i="${i}" title="Mô tả chiêu" aria-label="Mô tả chiêu ${esc(s.name)}">!</button></div>`;
  const A = c.awaken;
  $('skillList').innerHTML = c.skills.map((s, i) => row(s, i)).join('')
    + `<div class="aw-head" style="--c:${hex(A.color)}"><b>⚡ Dị biến: ${esc(A.name)}</b> <kbd>${esc(comboKey('L'))}</kbd><kbd>${esc(comboKey('L'))}</kbd> khi thanh dị biến đầy · ${esc(A.desc)}</div>`
    + A.skills.map((s, i) => row(s, i + 6)).join('');
  for (const el of document.querySelectorAll('#skillList .skill-row')) {
    el.onclick = () => { demo.pinned = true; playSkill(+el.dataset.i); };
  }
  // nút !: mở / đóng mô tả ngay dưới dòng chiêu, đồng thời diễn chiêu đó lên bia tập
  const all = [...c.skills, ...A.skills];
  for (const b of document.querySelectorAll('#skillList .sk-info')) {
    b.onclick = ev => {
      ev.stopPropagation();
      const rowEl = b.parentElement, open = rowEl.nextElementSibling?.classList.contains('sk-desc');
      if (open) { rowEl.nextElementSibling.remove(); b.classList.remove('on'); return; }
      rowEl.insertAdjacentHTML('afterend', skillDescHtml(all[+b.dataset.i]));
      b.classList.add('on');
      sfx('ui');
      demo.pinned = true; playSkill(+b.dataset.i);
    };
  }
  renderStats(c);
  setPreview(c.id);
  if (!silent) sendHello();
}

// ---------- Phòng ----------
function renderRooms(list) {
  const el = $('roomList');
  if (!list.length) {
    el.innerHTML = '<div class="empty">Chưa có phòng nào. Hãy tạo phòng mới!</div>';
    return;
  }
  el.innerHTML = '';
  for (const r of list) {
    const d = document.createElement('div');
    d.className = 'room';
    const tag = { brawl: '⚔ Đối kháng', team: '👥 Đấu đội', practice: '🎯 Đấu tập', bomb: '💣 Đặt bom', dm: '🔫 Sinh tử', xidach: '🃏 Xì dách', tienlen: '🂡 Tiến lên' }[r.mode || 'brawl']
      + (r.mode === 'team' ? (r.phase === 'lobby' ? ' · đang chờ' : ' · đang đấu') : '');
    d.innerHTML = `<div><b>${esc(r.name)}</b><span class="mtag ${r.mode}">${tag}</span><small>${r.mapName ? esc(r.mapName) + ' · ' : ''}${r.count} người chơi · không giới hạn</small></div>`;
    const b = document.createElement('button');
    b.className = 'btn primary small';
    b.textContent = 'Vào ⚔';
    b.onclick = () => requireName(() => { initAudio(); sfx('ui'); sendHello(); goFullscreen(); net.send({ t: 'join', id: r.id, char: settings.char }); });
    d.appendChild(b);
    el.appendChild(d);
  }
}

function sendHello() {
  settings.name = cleanName($('nameInput').value) || settings.name;
  saveSettings();
  net.send({ t: 'hello', name: settings.name, char: settings.char });
}

async function loadServerInfo() {
  try {
    const info = await (await fetch('/api/info', { cache: 'no-store' })).json();
    const urls = [];
    if (info.publicUrl) urls.push(['🌐 Internet', info.publicUrl]);
    for (const u of info.lan) urls.push(['🏠 Mạng LAN', u]);
    if (!urls.length) urls.push(['💻 Máy này', location.origin]);
    $('serverInfo').innerHTML = `<b>Mời bạn bè vào cùng:</b>` +
      urls.map(([k, u]) => `<div class="url"><span>${k}</span><code>${esc(u)}</code><button class="btn small" data-u="${esc(u)}">Copy</button></div>`).join('') +
      (info.note ? `<div class="muted">${esc(info.note)}</div>` : '') +
      `<div class="muted">Đang online: ${info.online} người</div>`;
    for (const b of $('serverInfo').querySelectorAll('button')) b.onclick = () => copy(b.dataset.u);
    window.__inviteUrl = info.publicUrl || info.lan[0] || location.origin;
  } catch { /* bỏ qua */ }
}

function copy(text) {
  const done = () => game.hud.toast('Đã copy: ' + text, 1600);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Copy link:', text));
  else prompt('Copy link:', text);
}

// ---------- Kết nối ----------
// Mỗi tab lưu một phiên bàn bài, chỉ gửi mã qua kết nối WebSocket.
const CARD_SESSION_KEY = 'chibiclash.cardSession';
const params = new URLSearchParams(location.search);
let previousCardSession;
let cardSession;
let resumePending = false;
try {
  const saved = JSON.parse(sessionStorage.getItem(CARD_SESSION_KEY));
  if (typeof saved?.room === 'string' && typeof saved?.session === 'string' &&
      (!params.has('quick') || params.get('mode') === saved.mode) &&
      (!params.has('room') || params.get('room') === saved.room)) previousCardSession = saved;
} catch { /* trình duyệt có thể chặn lưu trữ */ }

function rememberCardSession(room, mode) {
  try {
    if (room && cardSession) {
      sessionStorage.setItem(CARD_SESSION_KEY, JSON.stringify({ room, mode, session: cardSession }));
      return true;
    }
    sessionStorage.removeItem(CARD_SESSION_KEY);
  } catch { /* trình duyệt có thể chặn lưu trữ */ }
  return false;
}

// Số phiên bản ở menu và bảng tạm dừng
for (const el of document.querySelectorAll('.ver-tag')) el.textContent = 'v' + VERSION;
net.on('welcome', m => {
  // Trình duyệt còn giữ bản cũ (server đã cập nhật): nhắc tải lại trang
  if (m.v && m.v !== VERSION) {
    for (const el of document.querySelectorAll('.ver-tag')) { el.textContent = `v${VERSION} ≠ server v${m.v}`; el.classList.add('bad'); }
    game.hud.toast(`Server đã cập nhật lên v${m.v}, hãy tải lại trang (F5)`, 6000);
  }
  $('connState').textContent = '● Đã kết nối';
  $('connState').classList.add('ok');
  cardSession = m.session;
  if (previousCardSession && cardSession) {
    resumePending = true;
    net.send({ t: 'cresume', id: previousCardSession.room, session: previousCardSession.session });
  } else sendHello();
});
net.on('cresumeno', () => {
  resumePending = false;
  rememberCardSession();
  sendHello();
});
// Link mời: ?room=ID vào thẳng phòng; ?quick vào phòng đầu tiên (hoặc tạo mới)
let autoJoinDone = false;
net.on('rooms', m => {
  renderRooms(m.list);
  if (resumePending || autoJoinDone || inGame) return;
  const want = params.get('room') || previousCardSession?.room;
  if (want || params.has('quick')) {
    autoJoinDone = true;
    const qmode = params.get('mode') || 'brawl';
    const r = m.list.find(x => x.id === want) || (params.has('quick') ? m.list.find(x => (x.mode || 'brawl') === qmode && (!params.get('map') || x.map === params.get('map'))) : null);
    if (r) requireName(() => { sendHello(); net.send({ t: 'join', id: r.id, char: settings.char }); });
    else if (params.has('quick')) requireName(() => { sendHello(); net.send({ t: 'create', name: '', char: settings.char, mode: qmode, map: params.get('map') || (['brawl', 'team', 'practice'].includes(qmode) ? 'shrine' : 'lantern') }); });
    else game.hud.toast('Phòng trong link mời không còn tồn tại', 2500);
  }
});
net.on('joined', m => {
  inGame = true;
  current = game;
  shooter.setMenuMap(null); cards.setMenuBg(false);
  if (shooter.active) shooter.leave();
  if (cards.active) cards.leave();
  game.suspended = false;
  $('menu').hidden = true;
  game.enter(m);
  afterJoin();
});
net.on('sj', m => {
  inGame = true;
  current = shooter;
  cards.setMenuBg(false);
  if (cards.active) cards.leave();
  if (game.active) game.leave();
  game.suspended = true;     // tạm dừng render chế độ đối kháng, dùng chung canvas
  $('menu').hidden = true;
  shooter.enter(m);
  $('plates').hidden = false;
  afterJoin();
  if (!touch.enabled) shooter.centerMsg('Click để điều khiển · B để mua đồ', '', 3);
});
// vào bàn bài
net.on('cj', m => {
  resumePending = false;
  autoJoinDone = true;
  inGame = true;
  current = cards;
  shooter.setMenuMap(null);
  if (game.active) game.leave();
  if (shooter.active) shooter.leave();
  game.suspended = true;     // dùng chung canvas với cảnh bàn bài
  $('menu').hidden = true;
  cards.enter(m);
  if (rememberCardSession(m.room.id, m.room.game) && m.resumed) net.send({ t: 'cresumeack' });
  if (m.resumed) game.hud.toast('Đã lấy lại chỗ ở bàn bài', 2000);
  afterJoin();
});
function afterJoin() {
  document.body.classList.add('ingame');
  applyTouch();
  $('clickToPlay').hidden = touch.enabled || current === cards;
  $('changeCharBtn').hidden = current === shooter;
  $('switchTeamBtn').hidden = !(current === shooter && shooter.mode === 'bomb');
}
net.on('err', m => game.hud.toast(m.msg, 2500));
net.on('close', () => { $('disconnected').hidden = false; });
$('reconnectBtn').onclick = () => {
  if (inGame && current?.roomId) {
    const url = new URL(location.href);
    url.searchParams.set('room', current.roomId);
    for (const key of ['quick', 'mode', 'map']) url.searchParams.delete(key);
    history.replaceState(history.state, '', url);
  }
  location.reload();
};

$('createBtn').onclick = () => requireName(() => {
  initAudio(); sfx('ui'); sendHello(); goFullscreen();
  const mode = document.querySelector('input[name=mode]:checked')?.value || 'brawl';
  const map = document.querySelector('input[name=map]:checked')?.value || 'lantern';
  const arena = document.querySelector('input[name=arena]:checked')?.value || 'shrine';
  settings.mode = mode; settings.map = map; settings.arena = arena; saveSettings();
  net.send({ t: 'create', name: $('roomNameInput').value.trim(), char: settings.char, mode, map: ['brawl', 'team', 'practice'].includes(mode) ? arena : map });
});

// Chưa có tên hợp lệ thì hỏi tên trước, nhập xong mới chạy then() (vào / tạo phòng)
let nameThen = null;
function requireName(then) {
  const n = cleanName($('nameInput').value);
  if (validName(n)) { settings.name = n; saveSettings(); then(); return; }
  nameThen = then;
  $('nameModalInput').value = n;
  $('nameErr').textContent = '';
  $('nameModal').hidden = false;
  setTimeout(() => $('nameModalInput').focus(), 30);
}
function submitName() {
  const n = cleanName($('nameModalInput').value);
  if (!validName(n)) { $('nameErr').textContent = 'Tên cần từ 2 đến 16 ký tự.'; $('nameModalInput').focus(); sfx('error'); return; }
  $('nameInput').value = n;
  settings.name = n; saveSettings();
  $('nameModal').hidden = true;
  const f = nameThen; nameThen = null;
  if (f) f(); else sendHello();
}
$('nameOk').onclick = submitName;
$('nameModalInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') $('nameCancel').click(); });
$('nameCancel').onclick = () => { nameThen = null; $('nameModal').hidden = true; $('nameInput').focus(); };
for (const r of document.querySelectorAll('input[name=mode]')) {
  r.checked = r.value === settings.mode;
  r.onchange = () => { showMapPick(r.value); updateMenuBg(); };
}
// Danh mục chế độ: chỉ hiện các chế độ trong danh mục đang chọn
const MODE_CAT = { brawl: 'skill', team: 'skill', practice: 'skill', bomb: 'gun', dm: 'gun', xidach: 'card', tienlen: 'card' };
const CARD_MODES = ['xidach', 'tienlen'];
function showCat(cat, pickFirst) {
  for (const b of document.querySelectorAll('#modeCats .btn')) b.classList.toggle('on', b.dataset.cat === cat);
  for (const l of document.querySelectorAll('#modeSelect label')) l.hidden = l.dataset.cat !== cat;
  const cur = document.querySelector('input[name=mode]:checked');
  if (pickFirst || !cur || MODE_CAT[cur.value] !== cat) {
    const first = document.querySelector(`#modeSelect label[data-cat="${cat}"] input`);
    first.checked = true;
    showMapPick(first.value); updateMenuBg();
  }
}
for (const b of document.querySelectorAll('#modeCats .btn')) b.onclick = () => { sfx('ui'); showCat(b.dataset.cat, true); };
if (!document.querySelector('input[name=mode]:checked')) document.querySelector('input[name=mode]').checked = true;
// Nền menu đổi theo chế độ và map đang chọn: map đối kháng dựng bằng cảnh đối kháng, map bắn súng bằng cảnh bắn súng
function updateMenuBg() {
  if (inGame) return;
  const mode = document.querySelector('input[name=mode]:checked')?.value || 'brawl';
  if (CARD_MODES.includes(mode)) {
    // đánh bài: nền là bàn bài với vài nhân vật ngồi quanh
    shooter.setMenuMap(null);
    game.suspended = true;
    cards.setMenuBg(true);
    return;
  }
  cards.setMenuBg(false);
  if (['brawl', 'team', 'practice'].includes(mode)) {
    shooter.setMenuMap(null);
    game.suspended = false;
    game.setMenuArena(document.querySelector('input[name=arena]:checked')?.value || 'shrine');
  } else {
    game.suspended = true;   // nhường canvas cho cảnh bắn súng
    shooter.setMenuMap(document.querySelector('input[name=map]:checked')?.value || 'lantern');
  }
}
for (const r of document.querySelectorAll('input[name=arena], input[name=map]')) r.addEventListener('change', updateMenuBg);
// chỉ hiện ô chọn map của chế độ đang chọn
function showMapPick(mode) {
  const brawlLike = mode === 'brawl' || mode === 'team' || mode === 'practice';
  $('mapPick').classList.toggle('off', brawlLike || CARD_MODES.includes(mode));   // đánh bài: không chọn map
  $('arenaPick').classList.toggle('off', !brawlLike);
}
for (const r of document.querySelectorAll('input[name=map]')) r.checked = r.value === (settings.map || 'lantern');
for (const r of document.querySelectorAll('input[name=arena]')) r.checked = r.value === (settings.arena || 'shrine');
showMapPick(settings.mode || 'brawl');
showCat(MODE_CAT[document.querySelector('input[name=mode]:checked').value] || 'skill');
updateMenuBg();
$('refreshBtn').onclick = () => { net.send({ t: 'list' }); loadServerInfo(); };
$('nameInput').value = settings.name;
$('nameInput').onchange = sendHello;

// ---------- Tạm dừng ----------
game.onUnlock = shooter.onUnlock = cards.onUnlock = () => {
  if ($('settings').hidden && $('keybinds').hidden && $('charModal').hidden && $('help').hidden && $('teamLobby').hidden) $('pause').hidden = false;
};
$('resumeBtn').onclick = () => { $('pause').hidden = true; if (!touch.enabled && current !== cards) lockPointer(); };
$('leaveBtn').onclick = () => {
  $('pause').hidden = true;
  net.send({ t: 'leave' });
  if (current === cards) rememberCardSession();
  if (current === shooter) shooter.leave(); else if (current === cards) cards.leave(); else game.leave();
  game.suspended = false;
  current = null;
  inGame = false;
  const url = new URL(location.href);
  if (url.searchParams.has('room')) {
    url.searchParams.delete('room');
    history.replaceState(history.state, '', url);
  }
  updateMenuBg();
  document.body.classList.remove('ingame');
  touch.setEnabled(false);
  $('plates').hidden = true;
  $('menu').hidden = false;
  $('clickToPlay').hidden = true;
  loadServerInfo();
};
// đấu tập: nạp đầy thanh dị biến rồi quay lại trận
$('fillAwkBtn').onclick = () => { game.net.send({ t: 'pfill' }); sfx('ui'); $('resumeBtn').click(); };
$('inviteBtn').onclick = () => copy(`${window.__inviteUrl || location.origin}/?room=${(current === shooter ? shooter : current === cards ? cards : game).roomId}`);
$('switchTeamBtn').onclick = () => { shooter.switchTeam(); $('pause').hidden = true; };
$('fullscreenBtn').onclick = () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else Promise.resolve(el.requestFullscreen?.()).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
};
$('changeCharBtn').onclick = () => {
  const list = $('charModalList');
  list.innerHTML = '';
  for (const c of CHARACTERS) {
    const card = charCard(c, id => {
      settings.char = id; saveSettings();
      game.changeChar(id);
      $('charModal').hidden = true;
      $('pause').hidden = false;
      game.hud.toast('Đã đổi sang ' + getChar(id).name, 1500);
    });
    if (c.id === game.me?.char.id) card.classList.add('sel');
    list.appendChild(card);
  }
  $('pause').hidden = true;
  $('charModal').hidden = false;
};
$('charModalClose').onclick = () => { $('charModal').hidden = true; $('pause').hidden = false; };

// ---------- Cài đặt ----------
function openSettings(back) {
  $('setQuality').value = settings.quality;
  $('setBloom').checked = settings.bloom;
  $('setSens').value = settings.sens;
  $('setInvert').checked = settings.invertY;
  $('setShake').value = settings.shake;
  $('setVol').value = settings.volume;
  $('setTouch').value = settings.touch;
  $('settings').hidden = false;
  $('settings').dataset.back = back || '';
  $('pause').hidden = true;
}
function readSettings() {
  settings.quality = $('setQuality').value;
  settings.bloom = $('setBloom').checked;
  settings.sens = +$('setSens').value;
  settings.invertY = $('setInvert').checked;
  settings.shake = +$('setShake').value;
  settings.volume = +$('setVol').value;
  settings.touch = $('setTouch').value;
  setVolume(settings.volume);
  game.applySettings();
  applyTouch();
  saveSettings();
}
for (const id of ['setQuality', 'setBloom', 'setSens', 'setInvert', 'setShake', 'setVol', 'setTouch']) $(id).oninput = readSettings;
$('settingsBtn').onclick = () => openSettings();

// ---------- Gán phím ----------
// cập nhật mọi chỗ hiện tên phím: hướng dẫn F1 (data-k / data-k2), thanh chiêu trong trận, danh sách chiêu ở menu
function refreshKeyLabels(initial) {
  for (const el of document.querySelectorAll('[data-k],[data-k2]')) {
    const [mode, id] = (el.dataset.k || el.dataset.k2).split('.');
    const [a, b] = actionKeys(mode, id);
    el.textContent = (el.dataset.k ? a || b : b || a) || '—';
  }
  if (initial) return;
  if (game.active && game.me) game.refreshSkills();
  if (!inGame && settings.char) pickChar(settings.char, true);
}
let kbMode = 'brawl', kbWait = null;   // kbWait: { id, slot, el } ô đang chờ người chơi nhấn phím
function renderKeybinds() {
  const b = bindingsOf(kbMode);
  $('kbList').innerHTML = ACTIONS[kbMode].map(a => `<div class="kb-row"><span>${esc(a.label)}</span>`
    + [0, 1].map(i => `<button class="kb-key${b[a.id][i] ? '' : ' empty'}" data-id="${a.id}" data-slot="${i}">${esc(b[a.id][i] ? keyName(b[a.id][i]) : i ? '+ phím phụ' : '+ phím chính')}</button>`).join('')
    + `</div>`).join('');
  for (const el of document.querySelectorAll('#kbList .kb-key')) el.onclick = ev => {
    ev.stopPropagation();
    if (kbWait) kbWait.el.classList.remove('wait');
    kbWait = { id: el.dataset.id, slot: +el.dataset.slot, el };
    el.classList.add('wait'); el.textContent = 'Nhấn phím…';
    $('kbMsg').textContent = '';
  };
  for (const t of document.querySelectorAll('.kb-tabs .btn')) t.classList.toggle('on', t.dataset.mode === kbMode);
}
function applyKey(code) {
  const w = kbWait;
  kbWait = null;
  if (!w) return;
  if (code === 'Escape') { renderKeybinds(); return; }
  if (code === 'Backspace' || code === 'Delete') code = '';
  else if (SYSTEM_KEYS.has(code)) { $('kbMsg').textContent = `${keyName(code)} là phím hệ thống, không gán được.`; renderKeybinds(); return; }
  else if (kbMode === 'shooter' && code.startsWith('Mouse')) { $('kbMsg').textContent = 'Chế độ bắn súng: chuột trái / phải luôn là bắn / ngắm, chỉ gán được phím bàn phím.'; renderKeybinds(); return; }
  const moved = setBinding(kbMode, w.id, w.slot, code);
  const label = ACTIONS[kbMode].find(a => a.id === w.id).label;
  $('kbMsg').textContent = code ? `${label}: ${keyName(code)}` + (moved ? ` (đã gỡ khỏi “${moved}”)` : '') : `${label}: đã xoá phím`;
  settings.keys = saveBindings(); saveSettings();
  renderKeybinds(); refreshKeyLabels();
  sfx('ui');
}
// bắt phím ở pha capture để game / menu không nhận phím đang được gán
addEventListener('keydown', e => {
  if (!kbWait) return;
  e.preventDefault(); e.stopImmediatePropagation();
  applyKey(e.code);
}, true);
addEventListener('mousedown', e => {
  if (!kbWait || e.target.closest?.('.kb-key, .kb-tabs, #kbReset, #kbClose')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  applyKey('Mouse' + e.button);
}, true);
addEventListener('contextmenu', e => { if (!$('keybinds').hidden) e.preventDefault(); });
$('keybindBtn').onclick = () => { $('settings').hidden = true; $('keybinds').hidden = false; kbWait = null; $('kbMsg').textContent = ''; renderKeybinds(); };
for (const t of document.querySelectorAll('.kb-tabs .btn')) t.onclick = () => { kbMode = t.dataset.mode; kbWait = null; $('kbMsg').textContent = ''; renderKeybinds(); };
$('kbReset').onclick = () => {
  resetBindings(kbMode); settings.keys = saveBindings(); saveSettings();
  $('kbMsg').textContent = `Đã khôi phục phím mặc định cho chế độ ${MODE_NAMES[kbMode]}.`;
  kbWait = null; renderKeybinds(); refreshKeyLabels();
};
$('kbClose').onclick = () => { kbWait = null; $('keybinds').hidden = true; $('settings').hidden = false; };
refreshKeyLabels(true);
$('pauseSettingsBtn').onclick = () => openSettings('pause');
$('settingsClose').onclick = () => {
  $('settings').hidden = true;
  if ($('settings').dataset.back === 'pause') $('pause').hidden = false;
};
const openHelp = back => { $('help').hidden = false; $('help').dataset.back = back || ''; $('pause').hidden = true; };
$('helpBtn').onclick = () => openHelp();
$('pauseHelpBtn').onclick = () => openHelp('pause');
$('helpClose').onclick = () => {
  $('help').hidden = true;
  if ($('help').dataset.back === 'pause') $('pause').hidden = false;
};
setVolume(settings.volume);

// ---------- Bắt đầu ----------
renderCharList();
loadServerInfo();
setInterval(() => { if (!inGame) loadServerInfo(); }, 10000);
net.connect().catch(() => { $('connState').textContent = '● Không kết nối được server'; });
addEventListener('pointerdown', () => initAudio());   // mỗi lần chạm: bật lại âm thanh nếu iOS đã tạm dừng
