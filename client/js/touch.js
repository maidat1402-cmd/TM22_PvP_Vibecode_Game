// Điều khiển cảm ứng cho điện thoại / máy tính bảng:
//  - Nửa trái: joystick ảo (đặt ngón tay ở đâu, joystick hiện ở đó)
//  - Nửa phải: vuốt để xoay camera
//  - Các nút: định nghĩa bởi từng chế độ chơi (setButtons)
const JOY_R = 56;

export function isTouchDevice() {
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export class TouchControls {
  constructor() {
    this.el = document.getElementById('touch');
    this.joyBase = document.getElementById('joyBase');
    this.joyKnob = document.getElementById('joyKnob');
    this.btnBox = document.getElementById('tbtns');
    this.move = { x: 0, y: 0 };
    this.lookAcc = { dx: 0, dy: 0 };
    this.enabled = false;
    this.joyId = null;
    this.lookIds = new Map();   // pointerId -> {x, y}
    this.buttons = new Map();   // id -> def

    const el = this.el;
    el.addEventListener('pointerdown', e => this.onDown(e));
    el.addEventListener('pointermove', e => this.onMove(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, e => this.onUp(e));
    el.addEventListener('contextmenu', e => e.preventDefault());

    // Chặn trình duyệt tự zoom khi chạm đúp / chụm 2 ngón (đặc biệt Safari trên iPhone
    // bỏ qua user-scalable=no). Chặn ở sự kiện touch không ảnh hưởng pointer event ở trên.
    const block = e => { if (this.enabled) e.preventDefault(); };
    for (const ev of ['touchstart', 'touchmove', 'touchend']) el.addEventListener(ev, block, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener('touchend', e => {
      const t = Date.now();
      if (document.body.classList.contains('ingame') && t - lastTouchEnd < 350 && !e.target.closest('input, textarea, select')) e.preventDefault();
      lastTouchEnd = t;
    }, { passive: false });
    document.addEventListener('dblclick', e => { if (document.body.classList.contains('ingame')) e.preventDefault(); }, { passive: false });
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  }

  setEnabled(on) {
    this.enabled = on;
    this.el.hidden = !on;
    document.body.classList.toggle('touch', on);
    if (!on) this.reset();
  }

  reset() {
    this.move.x = this.move.y = 0;
    this.joyId = null;
    this.joyBase.hidden = true;
    for (const [, d] of this.buttons) if (d.pressed) { d.pressed = false; d.el.classList.remove('on'); d.up?.(); }
    this.lookIds.clear();
  }

  // defs: [{ id, label, hold?, look?, cls?, down(), up() }]
  setButtons(defs, layout) {
    this.reset();
    this.btnBox.innerHTML = '';
    this.btnBox.dataset.layout = layout || '';
    this.buttons.clear();
    for (const d of defs) {
      const b = document.createElement('div');
      b.className = 'tbtn ' + (d.cls || '');
      b.dataset.id = d.id;
      b.innerHTML = `<span>${d.label}</span><i class="tcd"></i>`;
      this.btnBox.appendChild(b);
      this.buttons.set(d.id, { ...d, el: b, cd: b.querySelector('.tcd'), pressed: false });
    }
  }

  setCooldown(id, frac, dim) {
    const b = this.buttons.get(id);
    if (!b) return;
    b.cd.style.height = Math.max(0, Math.min(1, frac)) * 100 + '%';
    b.el.classList.toggle('dim', !!dim);
  }
  setActive(id, on) { this.buttons.get(id)?.el.classList.toggle('active', !!on); }
  setLabel(id, html) { const b = this.buttons.get(id); if (b) b.el.querySelector('span').innerHTML = html; }

  onDown(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const btnEl = e.target.closest('.tbtn');
    if (btnEl) {
      const d = this.buttons.get(btnEl.dataset.id);
      if (!d) return;
      this.el.setPointerCapture?.(e.pointerId);
      d.pressed = e.pointerId;
      btnEl.classList.add('on');
      d.down?.();
      if (d.look) this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* */ }
      return;
    }
    if (e.target.closest('.tskip')) return;
    this.el.setPointerCapture?.(e.pointerId);
    if (e.clientX < innerWidth * 0.42 && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.hidden = false;
      this.joyBase.style.left = e.clientX + 'px';
      this.joyBase.style.top = e.clientY + 'px';
      this.joyKnob.style.transform = 'translate(-50%,-50%)';
    } else {
      this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  onMove(e) {
    if (!this.enabled) return;
    if (e.pointerId === this.joyId) {
      let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
      const L = Math.hypot(dx, dy);
      if (L > JOY_R) { dx *= JOY_R / L; dy *= JOY_R / L; }
      this.move.x = dx / JOY_R; this.move.y = dy / JOY_R;
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const l = this.lookIds.get(e.pointerId);
    if (l) {
      this.lookAcc.dx += e.clientX - l.x;   // độ nhạy do từng chế độ nhân (nhân thêm ở đây là bình phương độ nhạy)
      this.lookAcc.dy += e.clientY - l.y;
      l.x = e.clientX; l.y = e.clientY;
    }
  }

  onUp(e) {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.move.x = this.move.y = 0;
      this.joyBase.hidden = true;
    }
    this.lookIds.delete(e.pointerId);
    for (const [, d] of this.buttons) {
      if (d.pressed === e.pointerId) { d.pressed = false; d.el.classList.remove('on'); d.up?.(); }
    }
  }

  takeLook() {
    const r = { dx: this.lookAcc.dx, dy: this.lookAcc.dy };
    this.lookAcc.dx = this.lookAcc.dy = 0;
    return r;
  }
}
