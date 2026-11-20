// Giao diện HUD bằng DOM (nhẹ, sắc nét, dễ chỉnh CSS).
import * as THREE from 'three';
import { GAME, AWAKEN } from '/shared/config.js';

const $ = id => document.getElementById(id);
const hex = c => '#' + c.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export { $, hex, esc };

const COMBO_KEYS = { J: 'J', K: 'K', L: 'L' };

export class HUD {
  constructor() {
    this.el = $('hud');
    this.hpFill = $('hpFill'); this.hpGhost = $('hpGhost'); this.hpText = $('hpText');
    this.mpFill = $('mpFill'); this.mpText = $('mpText');
    this.awkBar = $('awkBar'); this.awkFill = $('awkFill'); this.awkText = $('awkText');
    this.skillbar = $('skillbar');
    this.feed = $('killfeed');
    this.plates = $('plates');
    this.nums = $('dmgnums');
    this.comboEl = $('combo');
    this.ghostHp = GAME.maxHp;
    this.slots = [];
    this.plateMap = new Map();
    this.tmp = new THREE.Vector3();
  }

  show(on) { this.el.hidden = !on; this.plates.hidden = !on; this.nums.hidden = !on; }

  setRoom(name) { $('roomName').textContent = name; }

  // skills: bộ chiêu đang dùng; off: độ lệch chỉ số hồi chiêu (dị biến +10); aw: dữ liệu dị biến khi đang biến hình
  buildSkillbar(char, skills = char.skills, off = 0, aw = null) {
    const look = aw ? { ...char.look, ...aw.look } : char.look;
    $('portrait').style.background = `radial-gradient(circle at 40% 35%, ${hex(look.hair)}, ${hex(look.outfit)})`;
    $('portrait').classList.toggle('aw', !!aw);
    $('portrait').style.setProperty('--c', hex(aw ? aw.color : char.look.hair));
    $('portraitName').textContent = aw ? `⚡ ${aw.name}` : char.name;
    this.skillbar.innerHTML = '';
    this.skillbar.classList.toggle('aw', !!aw);
    this.slots = skills.map((s, i) => {
      const d = document.createElement('div');
      d.className = 'slot' + (s.combo.length === 3 ? ' ult' : '') + (aw ? ' aw' : '');
      d.style.setProperty('--c', hex(s.fx.color));
      d.innerHTML = `<div class="keys">${[...s.combo].map(k => `<kbd>${COMBO_KEYS[k]}</kbd>`).join('')}</div>
        <div class="sname">${esc(s.name)}</div><div class="cost">${s.mana ? s.mana + ' MP' : 'Free'}</div>
        <div class="cd"></div><div class="cdt"></div>`;
      this.skillbar.appendChild(d);
      return { d, cd: d.querySelector('.cd'), cdt: d.querySelector('.cdt'), s, i: i + off };
    });
    // các phím chung
    const extra = [
      { k: 'H', n: 'Hồi Máu', c: 0x7dff9b, cost: GAME.heal.mana + ' MP', id: 'heal' },
      { k: 'U', n: 'Vận Khí (giữ)', c: 0xffe066, cost: '+MP', id: 'charge' },
      { k: '⇧', n: 'Lướt/Chạy', c: 0xffffff, cost: '', id: 'dash' },
    ];
    for (const x of extra) {
      const d = document.createElement('div');
      d.className = 'slot util';
      d.style.setProperty('--c', hex(x.c));
      d.innerHTML = `<div class="keys"><kbd>${x.k}</kbd></div><div class="sname">${x.n}</div><div class="cost">${x.cost}</div><div class="cd"></div><div class="cdt"></div>`;
      this.skillbar.appendChild(d);
      this.slots.push({ d, cd: d.querySelector('.cd'), cdt: d.querySelector('.cdt'), util: x.id });
    }
  }

  // cds: mảng thời điểm hồi chiêu xong; now: thời gian hiện tại
  updateBars(hp, maxHp, mp, now, cds, healCd, dashCd, mana, charging) {
    const hpP = Math.max(0, hp / maxHp);
    this.hpFill.style.width = hpP * 100 + '%';
    this.ghostHp += (hp - this.ghostHp) * 0.05;
    if (hp > this.ghostHp) this.ghostHp = hp;
    this.hpGhost.style.width = Math.max(0, this.ghostHp / maxHp) * 100 + '%';
    this.hpText.textContent = `${Math.ceil(hp)} / ${maxHp}`;
    this.hpFill.classList.toggle('low', hpP < 0.3);
    this.mpFill.style.width = Math.max(0, mp / GAME.maxMana) * 100 + '%';
    this.mpText.textContent = `${Math.floor(mp)} / ${GAME.maxMana}`;
    for (const sl of this.slots) {
      let rem = 0, total = 1, noMana = false, active = false;
      if (sl.s) {
        rem = (cds[sl.i] || 0) - now; total = sl.s.cd; noMana = mana < sl.s.mana;
      } else if (sl.util === 'heal') { rem = healCd - now; total = GAME.heal.cd; noMana = mana < GAME.heal.mana; }
      else if (sl.util === 'dash') { rem = dashCd - now; total = 0.75; }
      else if (sl.util === 'charge') active = charging;
      const p = rem > 0 ? rem / total : 0;
      sl.cd.style.height = p * 100 + '%';
      sl.cdt.textContent = rem > 0.25 ? rem.toFixed(rem < 3 ? 1 : 0) : '';
      sl.d.classList.toggle('nomana', noMana);
      sl.d.classList.toggle('ready', rem <= 0 && !noMana);
      sl.d.classList.toggle('active', active);
    }
  }

  // Thanh dị biến của mình: tích dần → đầy (bấm L L) → đang dị biến (đếm ngược)
  updateAwaken(me, now) {
    const A = me.char.awaken;
    let p, txt, cls;
    if (me.aw && now < me.awUntil) {
      const left = me.awUntil - now;
      p = Math.min(1, left / AWAKEN.dur); txt = `⚡ ${A.name} · ${left.toFixed(left < 5 ? 1 : 0)}s`; cls = 'on';
    } else if (now < me.tiredUntil) {
      p = 0; txt = 'Kiệt sức…'; cls = 'tired';
    } else {
      const v = Math.floor(me.awk || 0);
      p = v / AWAKEN.max;
      cls = v >= AWAKEN.max ? 'full' : '';
      txt = cls ? (document.body.classList.contains('touch') ? '⚡ ĐẦY! Bấm nút ⚡' : '⚡ ĐẦY! Bấm L L') : `Dị biến ${v}%`;
    }
    const key = cls + '|' + txt + '|' + Math.round(p * 200);
    if (key === this.awKey) return;
    this.awKey = key;
    this.awkFill.style.width = p * 100 + '%';
    this.awkText.textContent = txt;
    this.awkBar.className = 'bar awk ' + cls;
    this.awkBar.style.setProperty('--c', hex(A.color));
  }

  flashSlot(i) {
    const sl = this.slots[i];
    if (!sl) return;
    sl.d.classList.remove('fire'); void sl.d.offsetWidth; sl.d.classList.add('fire');
  }
  denySlot(i) {
    const sl = this.slots[i];
    if (!sl) return;
    sl.d.classList.remove('deny'); void sl.d.offsetWidth; sl.d.classList.add('deny');
  }

  showCombo(keys) {
    this.comboEl.innerHTML = keys.map(k => `<kbd>${k}</kbd>`).join('');
    this.comboEl.classList.remove('fade'); void this.comboEl.offsetWidth; this.comboEl.classList.add('fade');
  }

  // ---------- Bảng tên trên đầu ----------
  plate(av) {
    let p = this.plateMap.get(av.id);
    if (!p) {
      const d = document.createElement('div');
      d.className = 'plate' + (av.isMe ? ' me' : '');
      d.innerHTML = `<div class="pn">${esc(av.name)}</div><div class="pb"><i></i></div><div class="pa"><i></i></div>`;
      this.plates.appendChild(d);
      p = { d, bar: d.querySelector('.pb i'), awk: d.querySelector('.pa i'), name: d.querySelector('.pn') };
      this.plateMap.set(av.id, p);
    }
    return p;
  }
  removePlate(id) {
    const p = this.plateMap.get(id);
    if (p) { p.d.remove(); this.plateMap.delete(id); }
  }
  updatePlates(avatars, camera, w, h) {
    for (const av of avatars) {
      const p = this.plate(av);
      const v = this.tmp.copy(av.pos);
      v.y += 2.55;
      v.project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && !av.dead && !av.hidden;
      if (!vis) { p.d.style.display = 'none'; continue; }
      p.d.style.display = '';
      const dist = camera.position.distanceTo(av.pos);
      const sc = Math.max(0.55, Math.min(1, 14 / dist));
      p.d.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%,-100%) scale(${sc})`;
      p.bar.style.width = Math.max(0, av.hp / (av.char.hp || GAME.maxHp)) * 100 + '%';
      p.d.classList.toggle('target', !!av.targeted);
      p.d.classList.toggle('buffed', !!(av.buff && av.buff.kind === 'stoneSkin'));
      // thanh dị biến dưới thanh máu: ai sắp biến hình thì đối thủ đều thấy
      const aw = av.aw, full = (av.awk || 0) >= AWAKEN.max;
      p.awk.style.width = (aw ? 100 : Math.min(100, (av.awk || 0) / AWAKEN.max * 100)) + '%';
      p.d.classList.toggle('awfull', full && !aw);
      p.d.classList.toggle('awon', !!aw);
      if (p.d.dataset.team !== (av.team || '')) p.d.dataset.team = av.team || '';
    }
  }

  // ---------- Số sát thương ----------
  dmgNumber(pos, text, cls, camera, w, h) {
    const v = this.tmp.copy(pos).project(camera);
    if (v.z > 1) return;
    const d = document.createElement('div');
    d.className = 'dnum ' + cls;
    d.textContent = text;
    d.style.left = (v.x * 0.5 + 0.5) * w + (Math.random() - 0.5) * 40 + 'px';
    d.style.top = (-v.y * 0.5 + 0.5) * h + 'px';
    this.nums.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  // ---------- Thông báo hạ gục ----------
  killfeed(killer, victim, color) {
    const d = document.createElement('div');
    d.className = 'kf';
    d.innerHTML = killer
      ? `<b style="color:${hex(color || 0xffffff)}">${esc(killer)}</b> <span>⚔</span> ${esc(victim)}`
      : `${esc(victim)} <span>☠</span>`;
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 5000);
    setTimeout(() => d.remove(), 5600);
  }

  toast(msg, ms = 2000) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- Bảng điểm ----------
  // teamScore: { A, B } khi đấu đội
  scoreboard(avatars, show, teamScore) {
    const sb = $('scoreboard');
    sb.hidden = !show;
    if (!show) return;
    let rows = [...avatars].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    if (teamScore) {
      // đấu đội: chia theo đội, mỗi đội xếp theo số mạng hạ
      const part = t => rows.filter(a => a.team === t);
      const head = (t, name) => `<tr class="thead t${t}"><td colspan="5">${name} · ${teamScore[t]} điểm</td></tr>`;
      const A = part('A'), B = part('B');
      $('sbBody').innerHTML = head('A', '🔵 Đội Xanh') + this.sbRows(A) + head('B', '🔴 Đội Đỏ') + this.sbRows(B);
      return;
    }
    $('sbBody').innerHTML = this.sbRows(rows);
  }

  sbRows(rows) {
    return rows.map((a, i) => `<tr class="${a.isMe ? 'me' : ''}${a.team ? ' t' + a.team : ''}"><td>${i + 1}</td>
      <td><span class="dot" style="background:${hex(a.char.look.hair)}"></span>${esc(a.name)}</td>
      <td>${esc(a.char.name)}</td><td>${a.kills}</td><td>${a.deaths}</td></tr>`).join('');
  }

  // ---------- Chat ----------
  chat(name, msg, sys = false) {
    const log = $('chatlog');
    const d = document.createElement('div');
    d.className = sys ? 'sys' : '';
    d.innerHTML = sys ? esc(msg) : `<b>${esc(name)}:</b> ${esc(msg)}`;
    log.appendChild(d);
    while (log.children.length > 30) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    d.classList.add('new');
    setTimeout(() => d.classList.remove('new'), 8000);
  }

  death(show, killer, secs) {
    const d = $('death');
    d.hidden = !show;
    if (show) {
      $('deathBy').textContent = killer ? `Bị hạ bởi ${killer}` : 'Bạn đã gục ngã';
      $('deathT').textContent = Math.max(0, secs).toFixed(1);
    }
  }
}

// Khoá chuột vào canvas (bỏ qua lỗi khi trình duyệt từ chối)
export function lockPointer() {
  try {
    const p = document.getElementById('game').requestPointerLock?.();
    p?.catch?.(() => {});
  } catch { /* bỏ qua */ }
}
