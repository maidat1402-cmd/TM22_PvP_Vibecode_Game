// Kết nối WebSocket tới server (cùng host/port với trang web).
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.ping = 0;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      // rời/tải lại trang: đóng kết nối ngay để server xoá nhân vật khỏi phòng
      addEventListener('pagehide', () => { try { ws.close(); } catch { /* bỏ qua */ } }, { once: true });
      ws.onopen = () => {
        this.connected = true;
        this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
        resolve();
      };
      ws.onerror = e => reject(e);
      ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        this.emit('close', {});
      };
      ws.onmessage = ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'pong') { this.ping = Math.round(performance.now() - m.c); return; }
        this.emit(m.t, m);
      };
    });
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, m) { for (const fn of this.handlers[type] || []) fn(m); }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
}
