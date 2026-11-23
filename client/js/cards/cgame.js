// Chế độ đánh bài: các nhân vật chibi ngồi quanh bàn tròn, lá bài (vẽ bằng canvas) bay ra bàn và nằm lại trên bàn.
// Server quyết định mọi thứ và gửi trạng thái 'cs' cho từng người; client dựng cảnh theo trạng thái và tự diễn hoạt cảnh
// (chia bài, đánh bài, lật bài) bằng cách so trạng thái mới với vị trí lá bài đang có.
import * as THREE from 'three';
import { getChar } from '/shared/characters.js';
import { RANKS, SUITS, cardRank, cardSuit, isRed, cardLabel, XD, XD_KIND, TL_NAME, tlCombo, tlBeats, tlSuggest, CARD_GAMES } from '/shared/cards.js';
import { buildChibi, ANIM } from '../chibi.js';
import { FX } from '../effects.js';
import { $, esc } from '../ui.js';
import { sfx } from '../audio.js';

const now = () => performance.now() / 1000;
const TABLE_Y = 1.0, TABLE_R = 3.2, SEAT_R = 4.25, ZONE_R = 2.2;
const CW = 0.5, CH = 0.7;

// ---------- Texture lá bài (vẽ bằng canvas, không có file ảnh) ----------
const TEX = new Map();
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function cardTex(id) {
  if (TEX.has(id)) return TEX.get(id);
  const c = document.createElement('canvas'); c.width = 128; c.height = 180;
  const g = c.getContext('2d');
  if (id < 0) {
    // mặt sau: nền đỏ đậm, viền vàng, hoa văn quả trám
    rr(g, 2, 2, 124, 176, 12); g.fillStyle = '#7a1630'; g.fill();
    g.strokeStyle = '#f2c14e'; g.lineWidth = 4; rr(g, 9, 9, 110, 162, 8); g.stroke();
    g.strokeStyle = 'rgba(242,193,78,.45)'; g.lineWidth = 2;
    for (let i = -180; i < 300; i += 18) { g.beginPath(); g.moveTo(i, 12); g.lineTo(i + 160, 168); g.stroke(); g.beginPath(); g.moveTo(i + 160, 12); g.lineTo(i, 168); g.stroke(); }
    g.fillStyle = '#7a1630'; g.beginPath(); g.arc(64, 90, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2c14e'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CC', 64, 91);
  } else {
    rr(g, 2, 2, 124, 176, 12); g.fillStyle = '#fdfaf2'; g.fill(); g.strokeStyle = '#b9b2a4'; g.lineWidth = 2; g.stroke();
    const col = isRed(id) ? '#d62828' : '#1b1630', r = RANKS[cardRank(id)], s = SUITS[cardSuit(id)];
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${r === '10' ? 30 : 36}px sans-serif`; g.fillText(r, 24, 26);
    g.font = '28px sans-serif'; g.fillText(s, 24, 56);
    g.font = '74px sans-serif'; g.fillText(s, 70, 112);
    g.save(); g.translate(104, 154); g.rotate(Math.PI);
    g.font = `bold ${r === '10' ? 30 : 36}px sans-serif`; g.fillText(r, 0, -4); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  TEX.set(id, t);
  return t;
}
const CARD_GEO = new THREE.PlaneGeometry(CW, CH);

export class CardGame {
  constructor(net, settings, renderer, hud) {
    this.net = net; this.settings = settings; this.renderer = renderer; this.hud = hud;
    this.active = false; this.menuBg = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d1428);
    this.scene.fog = new THREE.Fog(0x1d1428, 16, 34);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 80);
    this.fx = new FX(this.scene, this.camera);
    this.buildRoom();
    this.cards = new Map();     // key -> { mesh, face, tw }
    this.avatars = new Map();   // seat key -> { model, char, name }
    this.st = null; this.sel = new Set(); this.deadline = 0; this.history = []; this.lastGames = -1;
    this.buildUi();
    this.bindNet();
    addEventListener('resize', () => this.resize());
    addEventListener('keydown', e => {
      if (!this.active) return;
      if (this.chatting) { if (e.key === 'Enter') this.sendChat(); else if (e.key === 'Escape') this.closeChat(); return; }
      if (e.key === 'Enter') { e.preventDefault(); this.openChat(); }
      else if (e.key === 'Escape') this.onUnlock?.();
    });
    this.lastT = now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.fov = this.camera.aspect < 1 ? 68 : 50; this.camera.updateProjectionMatrix(); }

  // ---------- Căn phòng + bàn tròn ----------
  buildRoom() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xffe8c8, 0x3a2a4a, 1.6));
    const key = new THREE.DirectionalLight(0xfff1d6, 1.4); key.position.set(3, 9, 5); S.add(key);
    // đèn treo trên bàn
    const lamp = new THREE.PointLight(0xffd59a, 40, 14, 1.6); lamp.position.set(0, 5.2, 0); S.add(lamp);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.7, 24, 1, true), new THREE.MeshToonMaterial({ color: 0x9c2f2f, side: THREE.DoubleSide }));
    shade.position.set(0, 5.6, 0); S.add(shade);
    this.lampParts = [shade];
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); bulb.position.set(0, 5.35, 0); S.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4), new THREE.MeshBasicMaterial({ color: 0x222222 })); cord.position.set(0, 8, 0); S.add(cord);
    this.lampParts.push(bulb, cord);
    // sàn gỗ + thảm tròn
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshToonMaterial({ color: 0x5c3d2e })); floor.rotation.x = -Math.PI / 2; S.add(floor);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(7, 48), new THREE.MeshToonMaterial({ color: 0x7b2d3b })); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.01; S.add(rug);
    const rug2 = new THREE.Mesh(new THREE.RingGeometry(6.2, 6.6, 48), new THREE.MeshBasicMaterial({ color: 0xe0b04a })); rug2.rotation.x = -Math.PI / 2; rug2.position.y = 0.02; S.add(rug2);
    // bàn: mặt nỉ xanh, viền gỗ, chân bàn
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.12, 48), new THREE.MeshToonMaterial({ color: 0x1f7a4d }));
    felt.position.y = TABLE_Y - 0.06; S.add(felt);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R + 0.05, 0.16, 10, 48), new THREE.MeshToonMaterial({ color: 0x6b3f22 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = TABLE_Y; S.add(rim);
    const line = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.5, 48), new THREE.MeshBasicMaterial({ color: 0x9fe0b8, transparent: true, opacity: 0.35 }));
    line.rotation.x = -Math.PI / 2; line.position.y = TABLE_Y + 0.005; S.add(line);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, TABLE_Y - 0.12, 16), new THREE.MeshToonMaterial({ color: 0x4a2b17 }));
    leg.position.y = (TABLE_Y - 0.12) / 2; S.add(leg);
    // chồng bài ở giữa bàn
    this.deck = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(CARD_GEO, new THREE.MeshBasicMaterial({ map: cardTex(-1) }));
      m.rotation.x = -Math.PI / 2; m.position.y = TABLE_Y + 0.01 + i * 0.012; this.deck.add(m);
    }
    S.add(this.deck);
    // vòng sáng dưới chỗ người đang tới lượt
    this.turnRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 40), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7, depthWrite: false }));
    this.turnRing.rotation.x = -Math.PI / 2; this.turnRing.visible = false; S.add(this.turnRing);
  }

  // ---------- Giao diện HTML ----------
  buildUi() {
    const el = document.createElement('div');
    el.id = 'chud'; el.hidden = true;
    el.innerHTML = `<div class="c-top"><b id="cRoom"></b> · <span id="cGame"></span><div id="cMsg"></div></div>
      <div id="cTimer"></div>
      <div id="cPlates"></div>
      <div class="c-bottom"><div id="cInfo"></div><div id="cHand"></div><div id="cActs"></div></div>
      <div class="c-side"><span class="c-bots" title="Số máy (AI) chơi cùng"><button class="btn small" id="cBotSub" title="Bớt 1 máy">−</button><b id="cBotN">🤖 0</b><button class="btn small" id="cBotAdd" title="Thêm 1 máy">+</button></span>
        <button class="btn small" id="cStop" title="Chủ phòng: dừng sau ván này, về phòng chờ">⏸</button><button class="btn small" id="cMenu">☰</button><button class="btn small" id="cChatBtn">💬</button></div>
      <div id="cChat"></div><input id="cChatIn" maxlength="140" placeholder="Nhập tin nhắn, Enter để gửi" hidden>`;
    document.body.appendChild(el);
    this.ui = el;
    $('cMenu').onclick = () => this.onUnlock?.();
    $('cChatBtn').onclick = () => this.openChat();
    // thêm / bớt máy (AI) chơi cùng: chơi một mình với bao nhiêu máy tuỳ ý
    $('cBotAdd').onclick = () => { sfx('ui'); this.net.send({ t: 'cbot', d: 1 }); };
    $('cStop').onclick = () => { sfx('ui'); this.net.send({ t: 'cstop' }); };
    $('cBotSub').onclick = () => { sfx('ui'); this.net.send({ t: 'cbot', d: -1 }); };
  }
  openChat() { this.chatting = true; $('cChatIn').hidden = false; $('cChatIn').focus(); }
  closeChat() { this.chatting = false; $('cChatIn').hidden = true; $('cChatIn').value = ''; $('cChatIn').blur(); }
  sendChat() { const v = $('cChatIn').value.trim(); if (v) this.net.send({ t: 'chat', msg: v }); this.closeChat(); }
  chatLine(name, msg, sys) {
    const d = document.createElement('div');
    d.className = sys ? 'sys' : '';
    d.innerHTML = sys ? esc(msg) : `<b>${esc(name)}:</b> ${esc(msg)}`;
    const box = $('cChat'); box.appendChild(d);
    while (box.children.length > 7) box.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 9000);
  }

  bindNet() {
    const n = this.net;
    n.on('cs', m => { if (this.active) this.onState(m); });
    n.on('cno', m => { if (this.active) { this.hud.toast(m.msg, 1600); sfx('error'); } });
    n.on('chat', m => { if (this.active) this.chatLine(m.name, m.msg); });
    n.on('sys', m => { if (this.active) this.chatLine('', m.msg, true); });
  }

  // ======================= Vào / rời =======================
  enter(m) {
    this.clear();
    this.active = true; this.menuBg = false;
    this.myId = m.you; this.roomId = m.room.id; this.game = m.room.game;
    $('cRoom').textContent = m.room.name;
    $('cGame').textContent = CARD_GAMES[this.game];
    this.ui.hidden = false;
    this.ui.className = 'g-' + this.game;
    this.resize();
  }
  leave() { this.active = false; this.clear(); this.ui.hidden = true; this.closeChat(); }
  clear() {
    for (const c of this.cards.values()) c.mesh.removeFromParent();
    this.cards.clear();
    for (const a of this.avatars.values()) a.model.root.removeFromParent();
    this.avatars.clear();
    this.st = null; this.sel.clear(); this.history = []; this.lastGames = -1;
    $('cPlates').innerHTML = ''; $('cHand').innerHTML = ''; $('cActs').innerHTML = ''; $('cChat').innerHTML = '';
  }
  changeChar(id) { this.net.send({ t: 'char', char: id }); }

  // Nền menu: bàn bài với vài nhân vật ngồi quanh, camera bay vòng
  setMenuBg(on) {
    this.menuBg = !!on && !this.active;
    if (!this.menuBg || this.avatars.size) return;
    const ids = ['kaze', 'homura', 'raiga', 'yuki'];
    ids.forEach((c, i) => this.placeAvatar('m' + i, c, i * Math.PI / 2 + 0.4));
    const show = [44, 47, 10, 31, 3];
    show.forEach((id, i) => {
      const m = this.cardMesh('menu' + i, id);
      m.mesh.position.set(-0.9 + i * 0.45, TABLE_Y + 0.02, 0.1 + Math.sin(i) * 0.1);
      m.mesh.rotation.z = (i - 2) * 0.12;
    });
  }

  // ---------- Bố trí ghế ----------
  // ghế của mình luôn ở dưới (gần camera); xì dách: nhà cái ở trên cùng
  // mình làm nhà cái (xì dách): nhà cái ở dưới, 5 ghế chia đều phía trên
  dealerAngle() { return this.st?.youDealer ? 0 : Math.PI; }
  seatAngle(seat) {
    const st = this.st, n = st.seats.length, you = st.you >= 0 ? st.you : 0, k = (seat - you + n) % n;
    if (this.game === 'xidach' && st.youDealer) {
      // các ghế có người dàn đều quanh phía trên bàn, đối diện nhà cái
      const occ = st.seats.map((q, i) => q ? i : -1).filter(i => i >= 0), idx = Math.max(0, occ.indexOf(seat));
      return Math.PI + (idx - (occ.length - 1) / 2) * (Math.PI / 3);
    }
    if (this.game === 'xidach') return [0, 1, 2, -2, -1][k] * (Math.PI / 3) || 0;   // 0, ±60°, ±120°; nhà cái 180°
    return k * (Math.PI * 2 / n);
  }
  dirOf(a) { return new THREE.Vector3(Math.sin(a), 0, Math.cos(a)); }

  placeAvatar(key, charId, angle, back = 0) {
    let a = this.avatars.get(key);
    if (a && a.char !== charId) { a.model.root.removeFromParent(); a = null; }
    if (!a) {
      const model = buildChibi(getChar(charId).look);
      this.scene.add(model.root);
      a = { model, char: charId };
      this.avatars.set(key, a);
    }
    const d = this.dirOf(angle);
    a.model.root.position.set(d.x * (SEAT_R + back), 0, d.z * (SEAT_R + back));
    a.model.root.rotation.y = Math.atan2(-d.x, -d.z);   // quay mặt vào giữa bàn
    a.angle = angle; a.seen = true;
    return a;
  }

  cardMesh(key, face) {
    let c = this.cards.get(key);
    if (!c) {
      const mat = new THREE.MeshBasicMaterial({ map: cardTex(face), transparent: true });
      const mesh = new THREE.Mesh(CARD_GEO, mat);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      c = { mesh, face, tw: null };
      this.cards.set(key, c);
    }
    return c;
  }

  // đưa lá bài key tới vị trí to (bay theo vòng cung từ from nếu là lá mới)
  moveCard(key, face, to, rotY, from, delay = 0, lift = 0.6) {
    const isNew = !this.cards.has(key);
    const c = this.cardMesh(key, face);
    c.seen = true;
    if (isNew) { c.mesh.position.copy(from || to); c.mesh.rotation.y = rotY; }
    if (c.face !== face) c.flip = { t0: now() + delay, to: face };   // lật bài
    const p = c.mesh.position;
    if (isNew || p.distanceTo(to) > 0.01 || Math.abs(c.mesh.rotation.y - rotY) > 0.01) {
      c.tw = { from: p.clone(), to: to.clone(), r0: c.mesh.rotation.y, r1: rotY, t0: now() + delay, dur: isNew ? 0.45 : 0.3, lift: isNew ? lift : 0.15 };
      if (isNew && delay > 0) c.mesh.visible = false;
    }
  }

  // ======================= Trạng thái từ server =======================
  onState(s) {
    const prev = this.st;
    this.st = s;
    this.deadline = now() + s.left;
    if (s.games !== this.lastGames) { this.history = []; this.lastGames = s.games; this.sel.clear(); }
    for (const c of this.cards.values()) c.seen = false;
    for (const a of this.avatars.values()) a.seen = false;
    const deckPos = new THREE.Vector3(0, TABLE_Y + 0.1, 0);
    let dealIdx = 0;
    // nhân vật + bài trước mặt từng ghế
    s.seats.forEach((p, i) => {
      if (!p) return;
      const ang = this.seatAngle(i), d = this.dirOf(ang), tan = new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang));
      const mine = i === s.you;
      const av = this.placeAvatar('s' + i, p.char, ang, mine ? 0.7 : 0);   // nhân vật của mình lùi ra sau để không che bài
      av.name = p.name;
      if (this.game === 'xidach' || !mine) {
        // xì dách: bài mỗi người nằm trước mặt; tiến lên: bài người khác úp thành quạt
        const n = p.n, gap = this.game === 'xidach' ? 0.42 : 0.11, R = this.game === 'xidach' ? ZONE_R : ZONE_R + 0.25;
        for (let j = 0; j < n; j++) {
          const off = (j - (n - 1) / 2) * gap;
          const to = new THREE.Vector3(d.x * R + tan.x * off, TABLE_Y + 0.015 + j * 0.003, d.z * R + tan.z * off);
          const face = p.cards[j] ?? -1;
          const isNew = !this.cards.has(`h${i}_${j}`);
          this.moveCard(`h${i}_${j}`, face, to, ang + Math.PI, deckPos, isNew ? 0.12 * dealIdx++ : 0);
        }
      }
      // diễn: rút bài / đánh bài / thắng
      const pp = prev?.seats[i];
      if (pp && p.n > pp.n) av.model.play('push', 0.35);
      if (pp && p.n < pp.n) av.model.play('throw', 0.4);
      if (p.result && !pp?.result && p.result.r > 0) { av.model.play('raise', 1.4); this.fx.parts.burst(new THREE.Vector3(d.x * SEAT_R, 2.2, d.z * SEAT_R), 40, 0xffd166, { speed: 6, size: 0.35, life: 1, up: 1.5 }); }
    });
    // xì dách: nhà cái ngồi phía trên
    if (this.game === 'xidach' && s.dealer) {
      const ang = this.dealerAngle(), d = this.dirOf(ang), tan = new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang));
      const av = this.placeAvatar('dealer', s.dealer.char, ang, s.youDealer ? 0.7 : 0);
      av.name = s.dealer.name;
      for (let j = 0; j < s.dealer.n; j++) {
        const off = (j - (s.dealer.n - 1) / 2) * 0.42;
        const to = new THREE.Vector3(d.x * ZONE_R + tan.x * off, TABLE_Y + 0.015, d.z * ZONE_R + tan.z * off);
        const isNew = !this.cards.has('d_' + j);
        this.moveCard('d_' + j, s.dealer.cards[j] ?? -1, to, ang + Math.PI, deckPos, isNew ? 0.12 * dealIdx++ : 0);
      }
      const pd = prev?.dealer;
      if (pd && s.dealer.n > pd.n) av.model.play('push', 0.35);
      if (s.dealer.result && !pd?.result && s.dealer.result.r > 0) av.model.play('raise', 1.4);
    }
    // tiến lên: bộ bài trên bàn ở giữa, các bộ trước nằm chồng bên dưới
    if (this.game === 'tienlen') {
      if (s.trick) {
        const key = s.trick.cards.join(',');
        if (!this.history.length || this.history[this.history.length - 1].key !== key) {
          this.history.push({ key, cards: s.trick.cards, by: s.trick.by, rot: (Math.random() - 0.5) * 0.5, off: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.4) });
          if (this.history.length > 6) this.history.shift();
          sfx('throw');
        }
      }
      const H = this.history;
      H.forEach((h, hi) => {
        const top = hi === H.length - 1 && s.trick && h.key === s.trick.cards.join(',');
        const sAng = this.seatAngle(h.by), from = this.dirOf(sAng).multiplyScalar(ZONE_R + 0.3).setY(TABLE_Y + 0.4);
        h.cards.forEach((id, j) => {
          const off = (j - (h.cards.length - 1) / 2) * (top ? 0.4 : 0.3);
          const to = new THREE.Vector3(h.off.x * (top ? 0.2 : 1) + off * Math.cos(h.rot), TABLE_Y + 0.02 + hi * 0.008 + j * 0.002, h.off.z * (top ? 0.2 : 1) - off * Math.sin(h.rot));
          this.moveCard('c_' + id, id, to, h.rot, from, 0, 0.9);
          const c = this.cards.get('c_' + id);
          c.mesh.material.color.setScalar(top ? 1 : 0.62);   // bộ cũ tối đi
          c.mesh.scale.setScalar(top ? 1.12 : 0.9);
        });
      });
    }
    // lá bài không còn trong trạng thái: bỏ đi
    for (const [k, c] of this.cards) if (!c.seen && !k.startsWith('menu')) { c.mesh.removeFromParent(); c.mesh.material.dispose(); this.cards.delete(k); }
    for (const [k, a] of this.avatars) if (!a.seen) { a.model.root.removeFromParent(); this.avatars.delete(k); }
    // giữ lá đã chọn còn trên tay
    const hand = s.seats[s.you]?.cards || [];
    for (const id of [...this.sel]) if (!hand.includes(id)) this.sel.delete(id);
    if (prev && prev.turn !== s.turn && s.turn === s.you && s.phase === 'play') { sfx('respawn'); this.hud.toast('Tới lượt bạn!', 900); }
    if (s.youDealer && s.phase === 'dealer' && prev?.phase !== 'dealer' && !s.dealer.auto) { sfx('respawn'); this.hud.toast('Tới lượt nhà cái!', 900); }
    if (s.phase === 'lobby' && prev && prev.phase !== 'lobby') { this.history = []; this.sel.clear(); }
    if (s.phase === 'result' && prev?.phase !== 'result') sfx(s.seats[s.you]?.result?.r > 0 ? 'heal' : 'ui');
    this.renderUi();
  }

  // ---------- Giao diện theo trạng thái ----------
  renderUi() {
    const s = this.st, me = s.seats[s.you];
    $('cMsg').textContent = s.msg || '';
    $('cBotN').textContent = `🤖 ${s.botWant ?? s.bots} máy`;
    $('cBotN').title = s.canBot ? 'Số máy (AI) chơi cùng' : 'Số máy mới áp dụng từ ván sau';
    // bảng tên trên đầu từng người
    const plates = [], lobby = s.phase === 'lobby', isHost = s.host === s.me;
    $('cStop').style.display = isHost && !lobby ? '' : 'none';
    $('cStop').classList.toggle('on', !!s.stopAfter);
    $('cStop').title = s.stopAfter ? 'Đã hẹn dừng sau ván này — bấm để chơi tiếp' : 'Chủ phòng: dừng sau ván này, về phòng chờ';
    s.seats.forEach((p, i) => {
      if (!p) return;
      let st = '';
      if (lobby) st = p.bot ? 'Máy' : p.id === s.host ? 'Chủ phòng' : p.lready ? '✔ Sẵn sàng' : '… Chưa sẵn sàng';
      else if (this.game === 'xidach') {
        if (s.phase === 'bet') st = `Cược ${p.bet}${p.ready ? ' ✔' : ''}`;
        else if (p.result) st = p.result.r > 0 ? `+${p.result.delta}` : p.result.r < 0 ? `${p.result.delta}` : 'Hoà';
        else if (p.kind === 'quac') st = 'Quắc';
        else if (p.done) st = p.kind && p.kind !== 'normal' ? XD_KIND[p.kind] : 'Dằn';
        else st = `Cược ${p.bet}`;
        if (p.score != null && p.cards.length) st += ` · ${p.score}đ`;
      } else {
        if (p.result) st = p.result.r > 0 ? `🏆 ${p.result.instant ? p.result.instant + ' ' : ''}+${p.result.delta}` : `Hạng ${p.result.rank} · ${p.result.delta}${p.result.burn ? ' (cháy)' : ''}${p.result.heo ? ` · thối ${p.result.heo} heo` : ''}`;
        else st = (p.passed ? 'Bỏ lượt · ' : '') + `🂠 ${p.n}`;
      }
      if (i === s.you) return;   // bảng tên của mình: thông tin hiện ở khu vực dưới cùng
      const cls = (i === s.turn ? ' turn' : '') + (p.result ? (p.result.r > 0 ? ' win' : p.result.r < 0 ? ' lose' : '') : '') + (i === s.you ? ' me' : '');
      plates.push(`<div class="cplate${cls}${lobby && p.lready ? ' win' : ''}" data-seat="${i}"><b>${p.id === s.host ? '👑 ' : ''}${esc(p.name)}${p.bot ? ' 🤖' : ''}</b><small>💰 ${p.chips}</small><i>${esc(st)}</i></div>`);
    });
    if (this.game === 'xidach' && s.dealer && !s.youDealer) {
      const d = s.dealer;
      let st = d.result ? (d.result.delta > 0 ? `+${d.result.delta}` : d.result.delta < 0 ? `${d.result.delta}` : 'Hoà') + ' · ' : '';
      st += d.cards.length ? (d.kind && d.kind !== 'normal' ? XD_KIND[d.kind] + ' · ' : '') + `${d.score}đ` : lobby ? (d.human ? 'Chủ phòng' : 'Máy') : `🂠 ${d.n}`;
      const cls = (s.phase === 'dealer' ? ' turn' : '') + (d.result ? (d.result.r > 0 ? ' win' : d.result.r < 0 ? ' lose' : '') : '');
      plates.push(`<div class="cplate dealer${cls}" data-seat="dealer"><b>🎩 ${esc(d.name)}${d.human ? '' : ' 🤖'}</b>${d.human ? `<small>💰 ${d.chips}</small>` : ''}<i>${esc(st)}</i></div>`);
    }
    $('cPlates').innerHTML = plates.join('');
    // khu vực của mình
    const acts = [], info = [];
    if (lobby) {
      // phòng chờ: người chơi bấm Sẵn sàng, chủ phòng bấm Bắt đầu (và chọn ai làm nhà cái)
      const sd = s.youDealer ? s.dealer : null;
      if (me) info.push(`💰 ${me.chips} xu`);
      if (sd) info.push(`🎩 Bạn làm nhà cái · 💰 ${sd.chips} xu`);
      if (isHost) {
        info.push(s.block ? `⚠ ${esc(s.block)}` : 'Mọi người đã sẵn sàng');
        acts.push(`<button class="btn primary" data-a="start"${s.block ? ` disabled title="${esc(s.block)}"` : ''}>▶ Bắt đầu</button>`);
        if (this.game === 'xidach') acts.push(`<button class="btn${s.hostDealer ? ' on' : ''}" data-a="dealer">${s.hostDealer ? '🤖 Để máy làm nhà cái' : '🎩 Mình làm nhà cái'}</button>`);
      } else if (me) {
        info.push(me.lready ? 'Chờ chủ phòng bắt đầu…' : 'Bấm Sẵn sàng khi muốn chơi');
        acts.push(`<button class="btn${me.lready ? '' : ' primary'}" data-a="ready">${me.lready ? 'Huỷ sẵn sàng' : '✔ Sẵn sàng'}</button>`);
      } else info.push('Bàn đã đủ người — bạn đang xem');
    } else if (s.youDealer) {
      // mình làm nhà cái: xem bài của mình, tự rút / dằn khi tới lượt nhà cái
      const d = s.dealer;
      info.push(`🎩 Nhà cái · 💰 ${d.chips} xu`);
      if (d.cards.length) info.push(`<b>${d.score} điểm</b>${d.kind && d.kind !== 'normal' ? ' · ' + XD_KIND[d.kind] : ''}`);
      if (s.phase === 'bet') info.push('Chờ người chơi đặt cược…');
      else if (s.phase === 'play') info.push('Người chơi đang rút bài…');
      else if (s.phase === 'dealer' && !d.auto) {
        acts.push(`<button class="btn primary" data-a="hit"${d.n >= XD.maxCards || d.score >= 21 ? ' disabled' : ''}>🂠 Rút bài</button>`);
        acts.push(`<button class="btn" data-a="stand"${d.score < XD.dealerMin ? ` disabled title="Chưa đủ ${XD.dealerMin} điểm"` : ''}>✋ Dằn</button>`);
        if (d.score < XD.dealerMin) info.push(`Nhà cái cần ít nhất ${XD.dealerMin} điểm mới được dằn`);
      } else if (s.phase === 'dealer') info.push('Máy đang đánh thay nhà cái…');
      if (d.result) info.push(d.result.delta > 0 ? `🎉 Nhà cái ăn ${d.result.delta} xu` : d.result.delta < 0 ? `Nhà cái chung ${-d.result.delta} xu` : 'Hoà cả bàn');
    } else if (me) info.push(`💰 ${me.chips} xu${this.game === 'xidach' && s.phase !== 'result' ? ` · cược ${me.bet}` : ''}`);
    if (lobby || s.youDealer) { /* đã xử lý ở trên */ }
    else if (!me) info.push('Bạn đang xem — sẽ vào bàn ở ván sau');
    else if (this.game === 'xidach') {
      if (me.cards.length) info.push(`<b>${me.score} điểm</b>${me.kind && me.kind !== 'normal' ? ' · ' + XD_KIND[me.kind] : ''}`);
      if (s.phase === 'bet') {
        for (const b of XD.bets) acts.push(`<button class="btn small${me.bet === b ? ' on' : ''}" data-a="bet" data-v="${b}">Cược ${b}</button>`);
        acts.push(`<button class="btn primary" data-a="ready"${me.ready ? ' disabled' : ''}>${me.ready ? 'Đã sẵn sàng' : 'Sẵn sàng ▶'}</button>`);
      } else if (s.phase === 'play' && s.turn === s.you) {
        acts.push(`<button class="btn primary" data-a="hit"${me.n >= XD.maxCards || me.score >= 21 ? ' disabled' : ''}>🂠 Rút bài</button>`);
        acts.push(`<button class="btn" data-a="stand"${me.score < XD.minStand ? ' disabled title="Chưa đủ 16 điểm"' : ''}>✋ Dằn</button>`);
        if (me.score < XD.minStand) info.push(`Cần ít nhất ${XD.minStand} điểm mới được dằn`);
      } else if (s.phase === 'play' || s.phase === 'dealer') info.push(me.done ? 'Chờ nhà cái…' : 'Chờ tới lượt…');
      if (me.result) info.push(me.result.r > 0 ? `🎉 Thắng ${me.result.delta} xu` : me.result.r < 0 ? `Thua ${-me.result.delta} xu` : 'Hoà');
    } else {
      const hand = me.cards;
      const selArr = [...this.sel], combo = selArr.length ? tlCombo(selArr) : null;
      const myTurn = s.phase === 'play' && s.turn === s.you, cur = s.trick ? tlCombo(s.trick.cards) : null;
      const canPlay = myTurn && combo && tlBeats(combo, cur) && (s.must < 0 || this.sel.has(s.must));
      $('cHand').innerHTML = hand.map(id => `<div class="hcard${isRed(id) ? ' red' : ''}${this.sel.has(id) ? ' sel' : ''}" data-id="${id}"><b>${RANKS[cardRank(id)]}</b><span>${SUITS[cardSuit(id)]}</span></div>`).join('');
      for (const c of $('cHand').children) c.onclick = () => { const id = +c.dataset.id; this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); sfx('ui'); this.renderUi(); };
      if (s.trick) info.push(`Trên bàn: <b>${TL_NAME[s.trick.type]}</b> của ${esc(s.seats[s.trick.by]?.name || '')}`);
      if (selArr.length) info.push(combo ? `Đang chọn: ${TL_NAME[combo.type]}${cur && !tlBeats(combo, cur) ? ' (không chặn được)' : ''}` : 'Đang chọn: không thành bộ');
      if (s.must >= 0 && myTurn) info.push(`Lượt đầu phải có lá ${cardLabel(s.must)}`);
      if (myTurn) {
        acts.push(`<button class="btn primary" data-a="play"${canPlay ? '' : ' disabled'}>Đánh ▶</button>`);
        acts.push(`<button class="btn" data-a="pass"${s.trick && s.trick.by !== s.you ? '' : ' disabled'}>Bỏ lượt</button>`);
        acts.push(`<button class="btn small" data-a="hint">💡 Gợi ý</button>`);
      } else if (s.phase === 'play') info.push('Chờ tới lượt…');
      if (selArr.length) acts.push(`<button class="btn small" data-a="clear">Bỏ chọn</button>`);
      if (me.result) info.push(me.result.r > 0 ? `🏆 Bạn ${me.result.instant ? 'tới trắng (' + me.result.instant + ')' : 'về nhất'}, nhận ${me.result.delta} xu`
        : `Hạng ${me.result.rank}: trả ${-me.result.delta} xu${me.result.burn ? ' (cháy bài ×2)' : ''}${me.result.heo ? ` (thối ${me.result.heo} heo)` : ''}`);
    }
    if (this.game === 'xidach' || lobby) $('cHand').innerHTML = '';
    $('cInfo').innerHTML = info.join(' · ');
    $('cActs').innerHTML = acts.join('');
    for (const b of $('cActs').querySelectorAll('button')) b.onclick = () => this.act(b.dataset.a, +b.dataset.v);
  }

  act(a, v) {
    const s = this.st;
    sfx('ui');
    switch (a) {
      case 'bet': this.net.send({ t: 'cbet', v }); break;
      case 'ready': this.net.send({ t: 'cready' }); break;
      case 'start': this.net.send({ t: 'cstart' }); break;
      case 'dealer': this.net.send({ t: 'cdealer' }); break;
      case 'hit': this.net.send({ t: 'chit' }); break;
      case 'stand': this.net.send({ t: 'cstand' }); break;
      case 'play': this.net.send({ t: 'cplay', cards: [...this.sel] }); this.sel.clear(); break;
      case 'pass': this.net.send({ t: 'cpass' }); this.sel.clear(); break;
      case 'clear': this.sel.clear(); this.renderUi(); break;
      case 'hint': {
        const mv = tlSuggest(s.seats[s.you].cards, s.trick ? tlCombo(s.trick.cards) : null, s.must);
        this.sel = new Set(mv || []);
        if (!mv) this.hud.toast('Không có bộ nào chặn được — bỏ lượt', 1200);
        this.renderUi();
        break;
      }
    }
  }

  // ======================= Vòng lặp =======================
  loop() {
    requestAnimationFrame(this.loop);
    const t = now(), dt = Math.min(0.05, t - this.lastT);
    this.lastT = t;
    if (!this.active && !this.menuBg) return;
    // camera: ngồi sau lưng ghế của mình nhìn xuống bàn; nền menu thì bay vòng
    if (this.active) {
      const portrait = this.camera.aspect < 1;
      for (const m of this.lampParts) m.visible = !portrait;   // màn dọc: camera cao hơn, chụp đèn sẽ che bàn
      this.camera.position.set(0, portrait ? 9.5 : 7.4, portrait ? 8.2 : 7.6);
      this.camera.lookAt(0, 0.6, portrait ? 0.6 : 0.4);
    } else {
      const a = t * 0.08;
      for (const m of this.lampParts) m.visible = true;
      this.camera.position.set(Math.sin(a) * 9, 5.5, Math.cos(a) * 9);
      this.camera.lookAt(0, 1, 0);
    }
    // lá bài bay / lật
    for (const c of this.cards.values()) {
      const tw = c.tw;
      if (tw) {
        const k = (t - tw.t0) / tw.dur;
        if (k >= 0) c.mesh.visible = true;
        if (k >= 0) {
          const e = Math.min(1, k), ease = 1 - Math.pow(1 - e, 3);
          c.mesh.position.lerpVectors(tw.from, tw.to, ease);
          c.mesh.position.y += Math.sin(Math.PI * e) * tw.lift;
          c.mesh.rotation.y = tw.r0 + (tw.r1 - tw.r0) * ease;
          if (k >= 1) { c.tw = null; if (tw.lift > 0.3) sfx('clink'); }
        }
      }
      const f = c.flip;
      if (f && t >= f.t0) {
        const k = Math.min(1, (t - f.t0) / 0.3);
        c.mesh.scale.x = Math.abs(Math.cos(Math.PI * k)) * (c.mesh.scale.y || 1);
        if (k >= 0.5 && c.face !== f.to) { c.face = f.to; c.mesh.material.map = cardTex(f.to); c.mesh.material.needsUpdate = true; }
        if (k >= 1) { c.flip = null; c.mesh.scale.x = c.mesh.scale.y; }
      }
    }
    // nhân vật: thở, nhìn vào bàn
    for (const a of this.avatars.values()) a.model.update(dt, ANIM.idle, 0);
    // vòng sáng dưới người đang tới lượt + đồng hồ
    if (this.active && this.st) {
      const s = this.st, turnSeat = s.phase === 'play' ? s.turn : s.phase === 'dealer' ? 'dealer' : null;
      if (turnSeat != null && (turnSeat === 'dealer' || s.seats[turnSeat])) {
        const ang = turnSeat === 'dealer' ? this.dealerAngle() : this.seatAngle(turnSeat), d = this.dirOf(ang);
        this.turnRing.visible = true;
        this.turnRing.position.set(d.x * (ZONE_R + 0.1), TABLE_Y + 0.008, d.z * (ZONE_R + 0.1));
        this.turnRing.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
      } else this.turnRing.visible = false;
      const left = Math.max(0, this.deadline - t);
      const who = turnSeat === 'dealer' ? 'Nhà cái' : turnSeat != null ? s.seats[turnSeat]?.name : null;
      $('cTimer').textContent = s.phase === 'lobby' ? '⏳ Phòng chờ' : s.phase === 'bet' ? `Đặt cược · ${Math.ceil(left)}s` : s.phase === 'result' ? `Ván mới sau ${Math.ceil(left)}s` : who ? `Lượt: ${who} · ${Math.ceil(left)}s` : '';
      $('cTimer').classList.toggle('urgent', (turnSeat === s.you || (turnSeat === 'dealer' && s.youDealer)) && left < 6);
      // bảng tên bám theo đầu nhân vật
      const w = innerWidth, h = innerHeight, v = new THREE.Vector3();
      for (const el of $('cPlates').children) {
        const key = el.dataset.seat === 'dealer' ? 'dealer' : 's' + el.dataset.seat;
        const a = this.avatars.get(key);
        if (!a) continue;
        v.copy(a.model.root.position); v.y += 2.6;
        v.project(this.camera);
        // không để bảng tên đè lên đồng hồ / tràn khỏi màn hình
        const px = Math.max(70, Math.min(w - 70, (v.x + 1) / 2 * w)), py = Math.max(118, (1 - v.y) / 2 * h);
        el.style.transform = `translate(-50%, -100%) translate(${px.toFixed(0)}px, ${py.toFixed(0)}px)`;
      }
    } else this.turnRing.visible = false;
    // chồng bài ở giữa: xì dách là "hộp bài" của nhà cái; tiến lên thì giữa bàn dành cho bộ bài vừa đánh
    this.deck.visible = this.game !== 'tienlen' && (!this.st || this.st.phase !== 'result');
    this.fx.update(dt);
    const r = this.renderer;
    r.autoClear = true;
    r.render(this.scene, this.camera);
  }
}
