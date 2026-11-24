// Chỉ áp dụng cho snapshot vị trí đầy đủ. Sự kiện vẫn đi qua đường gửi tin thường.
import { NET } from '../shared/config.js';

const SLOW_RATE = 20;
const RECOVER_AFTER = 3;
const SOCKET_HIGH_WATER = 2048; // Chừa chỗ cho tin sự kiện nhỏ đang ghi ra socket.
const counts = { sent: 0, socketBlocked: 0, ackBlocked: 0, throttled: 0, downshifts: 0, recoveries: 0,
  maxBufferedBytes: 0, maxAckMs: 0, maxPending: 0 };

export function snapshotRate(ws, room) {
  return ws.snapshotFlow?.room === room && ws.snapshotFlow.slow ? SLOW_RATE : NET.snapRate;
}

export function acknowledgeSnapshot(ws, room, seq, t = performance.now() / 1000) {
  const flow = ws.snapshotFlow;
  if (!flow || flow.room !== room || !Number.isSafeInteger(seq)) return;
  // Chỉ ACK số thứ tự đã thực sự gửi trên kết nối đó.
  const index = flow.pending.findIndex(frame => frame.seq === seq);
  if (index < 0) return;
  const rtt = t - flow.pending[index].t;
  flow.baseline = Math.min(flow.baseline ?? Infinity, rtt);
  counts.maxAckMs = Math.max(counts.maxAckMs, Math.round(rtt * 1000));
  flow.pending.splice(0, index + 1);
}

export function sendSnapshot(room, type, ps, t) {
  const seq = room.snapshotSeq = (room.snapshotSeq ?? 0) + 1;
  let data;
  for (const { ws } of room.players.values()) {
    if (ws.readyState !== 1) continue;
    const queued = ws.bufferedAmount || 0;
    counts.maxBufferedBytes = Math.max(counts.maxBufferedBytes, queued);

    if (!room.hub.legacySnapshots) {
      if (ws.snapshotFlow?.room !== room.id) ws.snapshotFlow = {
        room: room.id, pending: [], slow: false, pressure: 0, clearSince: null, baseline: null,
      };
      const flow = ws.snapshotFlow;
      // Chừa biên độ RTT và ACK định kỳ. Cửa sổ vẫn hữu hạn khi proxy đọc nhanh nhưng client nhận chậm.
      // RTT đã dồn hàng không được nới cửa sổ khi có mẫu RTT thấp hơn.
      const rtt = Math.min(flow.baseline ?? Infinity, ws.rttMin ?? ws.rtt ?? Infinity);
      const baseline = Number.isFinite(rtt) ? rtt : 0.2;
      const credit = Math.max(8, Math.min(48, Math.ceil(NET.snapRate * (baseline + 0.25))));
      const socketBlocked = queued >= SOCKET_HIGH_WATER;
      const ackBlocked = ws.wantsSnapAck && flow.pending.length >= credit;
      if (socketBlocked || ackBlocked) {
        if (socketBlocked) counts.socketBlocked++;
        if (ackBlocked) counts.ackBlocked++;
        flow.clearSince = null;
        flow.pressure = Math.min(12, flow.pressure + 2);
        if (!flow.slow && flow.pressure >= 10) {
          flow.slow = true;
          counts.downshifts++;
        }
        continue;
      }
      flow.pressure = Math.max(0, flow.pressure - 1);
      flow.clearSince ??= t;
      if (flow.slow && t - flow.clearSince >= RECOVER_AFTER) {
        flow.slow = false;
        counts.recoveries++;
      }
      // Trên nhịp 30 Hz: bỏ 1 trong 3 lượt gửi để còn 20 Hz, không dồn gửi bù.
      if (flow.slow && seq % 3 === 0) {
        counts.throttled++;
        continue;
      }
      if (ws.wantsSnapAck) {
        flow.pending.push({ seq, t });
        counts.maxPending = Math.max(counts.maxPending, flow.pending.length);
      }
    }

    data ??= JSON.stringify({ t: type, room: room.id, seq, at: Date.now(), ps });
    ws.send(data);
    counts.sent++;
  }
}

export function snapshotStats() {
  const stats = { ...counts };
  for (const key of Object.keys(counts)) counts[key] = 0;
  return stats;
}
