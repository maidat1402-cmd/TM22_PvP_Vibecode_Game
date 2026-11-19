// Vòng lặp tick theo lịch cố định.
// setInterval trên Windows chỉ chính xác ~15,6 ms nên 33 ms thường thành 47 ms (≈21 Hz).
// Ở đây mỗi lần hẹn giờ nhắm vào mốc kế tiếp của lịch, phần trễ được bù ở lần sau,
// nên nhịp trung bình luôn đúng rate dù từng khoảng lệch vài ms.
export function startLoop(rate, fn) {
  const step = 1000 / rate;
  let next = performance.now() + step, timer = null, stopped = false;
  const run = () => {
    if (stopped) return;
    try { fn(); } catch (e) { console.error('[tick]', e); }
    const t = performance.now();
    next += step;
    if (t - next > step * 4) next = t + step;   // máy bị treo lâu: không dồn tick bù
    timer = setTimeout(run, Math.max(0, next - t));
  };
  timer = setTimeout(run, step);
  return () => { stopped = true; clearTimeout(timer); };
}
