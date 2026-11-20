// Khởi động: menu, chọn nhân vật (preview 3D), danh sách phòng, cài đặt.
import * as THREE from 'three';
import { CHARACTERS, getChar, charSkills, skillLifetime } from '/shared/characters.js';
import { FX } from './effects.js';
import { Net } from './net.js';
import { Game } from './game.js';
import { buildChibi, ANIM } from './chibi.js';
import { $, hex, esc, lockPointer } from './ui.js';
import { initAudio, sfx, setVolume } from './audio.js';
import { ShooterGame } from './shooter/sgame.js';
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
if (new URLSearchParams(location.search).has('char')) settings.char = new URLSearchParams(location.search).get('char');
if (!settings.name) settings.name = 'Ninja' + Math.floor(Math.random() * 900 + 100);

const net = new Net();
const game = new Game(net, settings);
const shooter = new ShooterGame(net, settings, game.renderer, game.hud);
window.__game = game; // tiện debug trong DevTools
window.__shooter = shooter;
let inGame = false;
let current = null;   // game đang chơi: game | shooter

// ---------- Cảm ứng ----------
const touch = new TouchControls();
game.touch = shooter.touch = touch;
function applyTouch() {
  const on = settings.touch === 'on' || (settings.touch === 'auto' && IS_TOUCH);
  touch.setEnabled(on && inGame);
  touch.sens = settings.sens;
  if (on && inGame) (current === shooter ? shooter : game).setupTouch();
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
    default: return s.range || 3;
  }
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
  if (pvModel) pvModel.root.removeFromParent();
  const A = pvChar.awaken;
  pvModel = buildChibi(aw ? { ...pvChar.look, ...A.look, form: A.form, formColor: A.color, formCore: A.core } : pvChar.look);
  pvModel.char = pvChar;
  if (pos) pvModel.root.position.copy(pos);
  pvScene.add(pvModel.root);
  demo.aw = aw;
}

function stopDemo() {
  if (demo.effect) { demo.effect.done = true; demo.effect = null; }
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
  demo.effect = pvFx.castSkill({ skill: s, p: m.root.position.clone(), d, h, seed: 12345 + i, tg, caster: pvCaster });
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
  $('pvSkill').innerHTML = `${aw ? '⚡ ' : ''}${[...s.combo].map(k => `<kbd>${k}</kbd>`).join('')} ${s.combo.length === 3 ? '★ ' : ''}${esc(s.name)}`;
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
  const fov = demo.idx < 0 ? 32 : 50;
  if (Math.abs(pvCam.fov - fov) > 0.05) { pvCam.fov += (fov - pvCam.fov) * Math.min(1, dt * 4); pvCam.updateProjectionMatrix(); }
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
      <span>${[...s.combo].map(k => `<kbd>${k}</kbd>`).join('')}</span><span>${esc(s.name)} <span class="play">▶</span></span>
      <span class="cost">${s.mana ? s.mana + ' MP' : 'Miễn phí'}</span></div>`;
  const A = c.awaken;
  $('skillList').innerHTML = c.skills.map((s, i) => row(s, i)).join('')
    + `<div class="aw-head" style="--c:${hex(A.color)}"><b>⚡ Dị biến: ${esc(A.name)}</b> <kbd>L</kbd><kbd>L</kbd> khi thanh dị biến đầy · ${esc(A.desc)}</div>`
    + A.skills.map((s, i) => row(s, i + 6)).join('');
  for (const el of document.querySelectorAll('#skillList .skill-row')) {
    el.onclick = () => { demo.pinned = true; playSkill(+el.dataset.i); };
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
    const tag = { brawl: '⚔ Đối kháng', team: '👥 Đấu đội', bomb: '💣 Đặt bom', dm: '🔫 Sinh tử' }[r.mode || 'brawl']
      + (r.mode === 'team' ? (r.phase === 'lobby' ? ' · đang chờ' : ' · đang đấu') : '');
    d.innerHTML = `<div><b>${esc(r.name)}</b><span class="mtag ${r.mode}">${tag}</span><small>${r.mapName ? esc(r.mapName) + ' · ' : ''}${r.count} người chơi · không giới hạn</small></div>`;
    const b = document.createElement('button');
    b.className = 'btn primary small';
    b.textContent = 'Vào ⚔';
    b.onclick = () => { initAudio(); sfx('ui'); sendHello(); goFullscreen(); net.send({ t: 'join', id: r.id, char: settings.char }); };
    d.appendChild(b);
    el.appendChild(d);
  }
}

function sendHello() {
  settings.name = $('nameInput').value.trim() || settings.name;
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
net.on('welcome', () => {
  $('connState').textContent = '● Đã kết nối';
  $('connState').classList.add('ok');
  sendHello();
});
// Link mời: ?room=ID vào thẳng phòng; ?quick vào phòng đầu tiên (hoặc tạo mới)
const params = new URLSearchParams(location.search);
let autoJoinDone = false;
net.on('rooms', m => {
  renderRooms(m.list);
  if (autoJoinDone || inGame) return;
  const want = params.get('room');
  if (want || params.has('quick')) {
    autoJoinDone = true;
    const qmode = params.get('mode') || 'brawl';
    const r = m.list.find(x => x.id === want) || (params.has('quick') ? m.list.find(x => (x.mode || 'brawl') === qmode && (!params.get('map') || x.map === params.get('map'))) : null);
    if (r) net.send({ t: 'join', id: r.id, char: settings.char });
    else if (params.has('quick')) net.send({ t: 'create', name: '', char: settings.char, mode: qmode, map: params.get('map') || (qmode === 'brawl' || qmode === 'team' ? 'shrine' : 'lantern') });
    else game.hud.toast('Phòng trong link mời không còn tồn tại', 2500);
  }
});
net.on('joined', m => {
  inGame = true;
  current = game;
  if (shooter.active) shooter.leave();
  game.suspended = false;
  $('menu').hidden = true;
  game.enter(m);
  afterJoin();
});
net.on('sj', m => {
  inGame = true;
  current = shooter;
  if (game.active) game.leave();
  game.suspended = true;     // tạm dừng render chế độ đối kháng, dùng chung canvas
  $('menu').hidden = true;
  shooter.enter(m);
  $('plates').hidden = false;
  afterJoin();
  if (!touch.enabled) shooter.centerMsg('Click để điều khiển · B để mua đồ', '', 3);
});
function afterJoin() {
  document.body.classList.add('ingame');
  applyTouch();
  $('clickToPlay').hidden = touch.enabled;
  $('changeCharBtn').hidden = current === shooter;
  $('switchTeamBtn').hidden = !(current === shooter && shooter.mode === 'bomb');
}
net.on('err', m => game.hud.toast(m.msg, 2500));
net.on('close', () => { $('disconnected').hidden = false; });

$('createBtn').onclick = () => {
  initAudio(); sfx('ui'); sendHello(); goFullscreen();
  const mode = document.querySelector('input[name=mode]:checked')?.value || 'brawl';
  const map = document.querySelector('input[name=map]:checked')?.value || 'lantern';
  const arena = document.querySelector('input[name=arena]:checked')?.value || 'shrine';
  settings.mode = mode; settings.map = map; settings.arena = arena; saveSettings();
  net.send({ t: 'create', name: $('roomNameInput').value.trim(), char: settings.char, mode, map: mode === 'brawl' || mode === 'team' ? arena : map });
};
for (const r of document.querySelectorAll('input[name=mode]')) {
  r.checked = r.value === settings.mode;
  r.onchange = () => showMapPick(r.value);
}
// chỉ hiện ô chọn map của chế độ đang chọn
function showMapPick(mode) {
  const brawlLike = mode === 'brawl' || mode === 'team';
  $('mapPick').classList.toggle('off', brawlLike);
  $('arenaPick').classList.toggle('off', !brawlLike);
}
for (const r of document.querySelectorAll('input[name=map]')) r.checked = r.value === (settings.map || 'lantern');
for (const r of document.querySelectorAll('input[name=arena]')) r.checked = r.value === (settings.arena || 'shrine');
showMapPick(settings.mode || 'brawl');
$('refreshBtn').onclick = () => { net.send({ t: 'list' }); loadServerInfo(); };
$('nameInput').value = settings.name;
$('nameInput').onchange = sendHello;

// ---------- Tạm dừng ----------
game.onUnlock = shooter.onUnlock = () => {
  if ($('settings').hidden && $('charModal').hidden && $('help').hidden && $('teamLobby').hidden) $('pause').hidden = false;
};
$('resumeBtn').onclick = () => { $('pause').hidden = true; if (!touch.enabled) lockPointer(); };
$('leaveBtn').onclick = () => {
  $('pause').hidden = true;
  net.send({ t: 'leave' });
  if (current === shooter) shooter.leave(); else game.leave();
  game.suspended = false;
  current = null;
  inGame = false;
  document.body.classList.remove('ingame');
  touch.setEnabled(false);
  $('plates').hidden = true;
  $('menu').hidden = false;
  $('clickToPlay').hidden = true;
  loadServerInfo();
};
$('inviteBtn').onclick = () => copy(`${window.__inviteUrl || location.origin}/?room=${current === shooter ? shooter.roomId : game.roomId}`);
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
addEventListener('pointerdown', () => initAudio(), { once: true });
