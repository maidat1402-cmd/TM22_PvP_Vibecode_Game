// Khởi động: menu, chọn nhân vật (preview 3D), danh sách phòng, cài đặt.
import * as THREE from 'three';
import { CHARACTERS, getChar } from '/shared/characters.js';
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
let pvModel = null;
const pvPoses = ['slash', 'throw', 'thrust', 'beam', 'raise', 'spin'];
let pvPoseT = 0;

function setPreview(id) {
  if (pvModel) pvModel.root.removeFromParent();
  pvModel = buildChibi(getChar(id).look);
  pvScene.add(pvModel.root);
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
  pvModel.root.rotation.y += dt * 0.6;
  pvPoseT += dt;
  if (pvPoseT > 2.2) { pvPoseT = 0; pvModel.play(pvPoses[Math.floor(Math.random() * pvPoses.length)], 0.8); }
  pvModel.update(dt, ANIM.idle);
  pv.render(pvScene, pvCam);
}
pvLoop();

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
  $('skillList').innerHTML = c.skills.map(s => `<div class="skill-row${s.combo.length === 3 ? ' ult' : ''}" style="--c:${hex(s.fx.color)}">
      <span>${[...s.combo].map(k => `<kbd>${k}</kbd>`).join('')}</span><span>${esc(s.name)}</span>
      <span class="cost">${s.mana ? s.mana + ' MP' : 'Miễn phí'}</span></div>`).join('');
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
    const tag = { brawl: '⚔ Đối kháng', bomb: '💣 Đặt bom', dm: '🔫 Sinh tử' }[r.mode || 'brawl'];
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
    else if (params.has('quick')) net.send({ t: 'create', name: '', char: settings.char, mode: qmode, map: params.get('map') || (qmode === 'brawl' ? 'shrine' : 'lantern') });
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
  net.send({ t: 'create', name: $('roomNameInput').value.trim(), char: settings.char, mode, map: mode === 'brawl' ? arena : map });
};
for (const r of document.querySelectorAll('input[name=mode]')) {
  r.checked = r.value === settings.mode;
  r.onchange = () => showMapPick(r.value);
}
// chỉ hiện ô chọn map của chế độ đang chọn
function showMapPick(mode) {
  $('mapPick').classList.toggle('off', mode === 'brawl');
  $('arenaPick').classList.toggle('off', mode !== 'brawl');
}
for (const r of document.querySelectorAll('input[name=map]')) r.checked = r.value === (settings.map || 'lantern');
for (const r of document.querySelectorAll('input[name=arena]')) r.checked = r.value === (settings.arena || 'shrine');
showMapPick(settings.mode || 'brawl');
$('refreshBtn').onclick = () => { net.send({ t: 'list' }); loadServerInfo(); };
$('nameInput').value = settings.name;
$('nameInput').onchange = sendHello;

// ---------- Tạm dừng ----------
game.onUnlock = shooter.onUnlock = () => {
  if ($('settings').hidden && $('charModal').hidden && $('help').hidden) $('pause').hidden = false;
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
