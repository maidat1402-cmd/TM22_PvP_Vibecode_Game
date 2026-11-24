// Kết nối WebSocket tới server (cùng host/port với trang web).
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.ping = 0;
    this.connected = false;
    this.snapshotAckAt = -Infinity;
    this.snapshotAckTimer = null;
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
        clearTimeout(this.snapshotAckTimer);
        this.snapshotAckTimer = null;
        this.snapshotAckAt = -Infinity;
        this.emit('close', {});
      };
      ws.onmessage = ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'pong') { this.ping = Math.round(performance.now() - m.c); return; }
        this.emit(m.t, m);
        if ((m.t === 'snap' || m.t === 'ss') && Number.isSafeInteger(m.seq)) this.ackSnapshot(m);
      };
    });
  }

  ackSnapshot(frame) {
    this.pendingAck = { t: 'snapAck', room: frame.room, seq: frame.seq };
    if (this.snapshotAckTimer !== null) return;
    const flush = () => {
      this.snapshotAckTimer = null;
      this.snapshotAckAt = performance.now();
      this.send(this.pendingAck);
      this.pendingAck = null;
    };
    // Vẫn gửi ACK cuối sau một đợt snapshot đến dồn, kể cả lúc server đang chờ ACK để gửi tiếp.
    const delay = this.snapshotAckAt + 95 - performance.now();
    if (delay <= 0) flush();
    else this.snapshotAckTimer = setTimeout(flush, delay);
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, m) { for (const fn of this.handlers[type] || []) fn(m); }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
}
