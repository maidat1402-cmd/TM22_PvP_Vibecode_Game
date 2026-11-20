// Điều hướng chiêu cuối theo tâm ngắm — dùng chung cho server (tính sát thương) và client (hiệu ứng).
// Cấu hình nằm ở skill.steer (shared/characters.js):
//   follow: vùng chiêu (lốc xoáy, mưa băng) trôi về điểm tâm trên mặt đất với tốc độ giới hạn
//   homing: đạn (cầu năng lượng) bẻ hướng 3D về điểm tâm với tốc độ quay giới hạn
//   turn  : chiêu lao tới (phượng hoàng) bẻ hướng lao trên mặt phẳng ngang; có fly {max, rate} thì lái cả độ cao (st.y)
//   aim   : tia chưởng (beam) xoay hướng 3D về điểm tâm, gốc tia đứng yên ở ngực người ra chiêu
// st.aim do người ra chiêu cập nhật liên tục (client gửi 'steer' ~15 lần/giây).

export const STEER_SEND_HZ = 15;

export function initSteer(s, p, d, h) {
  const g = s.steer;
  if (!g) return null;
  const st = { mode: g.mode, aim: null, o: [p[0], p[2]] };
  if (g.mode === 'follow') {
    const off = s.offset || 0;
    st.c = [p[0] + h[0] * off, 0, p[2] + h[1] * off];
  } else if (g.mode === 'homing') {
    st.d = [d[0], d[1], d[2]];
  } else if (g.mode === 'aim') {
    st.d = [d[0], d[1], d[2]];
    st.p = [p[0], p[1] + 0.85, p[2]];
  } else if (g.mode === 'turn') {
    st.h = [h[0], h[1]];
    st.pos = [p[0], p[2]];
    if (g.fly) st.y = p[1];   // lái cả độ cao (rồng lốc dị biến của Kaze)
  }
  return st;
}

// Tiến 1 bước. el: thời gian kể từ lúc ra chiêu. pos (homing): vị trí hiện tại của đạn.
export function steerStep(st, s, dt, el, pos) {
  if (!st) return;
  const g = s.steer, a = st.aim;
  if (st.mode === 'follow') {
    if (a) {
      let vx = a[0] - st.c[0], vz = a[2] - st.c[2];
      const L = Math.hypot(vx, vz), step = g.speed * dt;
      if (L > 0.05) { const k = Math.min(1, step / L); st.c[0] += vx * k; st.c[2] += vz * k; }
    }
    // không cho trôi quá xa vị trí ra chiêu
    const ox = st.c[0] - st.o[0], oz = st.c[2] - st.o[1], R = Math.hypot(ox, oz);
    if (R > g.range) { st.c[0] = st.o[0] + ox / R * g.range; st.c[2] = st.o[1] + oz / R * g.range; }
  } else if (st.mode === 'homing') {
    if (a && pos) {
      const wx = a[0] - pos[0], wy = a[1] - pos[1], wz = a[2] - pos[2];
      const L = Math.hypot(wx, wy, wz);
      if (L > 0.5) turn3(st.d, [wx / L, wy / L, wz / L], g.turn * dt);
    }
  } else if (st.mode === 'aim') {
    if (a) {
      const wx = a[0] - st.p[0], wy = a[1] - st.p[1], wz = a[2] - st.p[2];
      const L = Math.hypot(wx, wy, wz);
      if (L > 1) turn3(st.d, [wx / L, wy / L, wz / L], g.turn * dt);
    }
  } else if (st.mode === 'turn') {
    // client truyền vị trí thật của nhân vật; server tự tích phân đường lao
    if (pos) { st.pos[0] = pos[0]; st.pos[1] = pos[2]; }
    // chỉ bẻ hướng tới khi lao xong
    if (a && el <= s.delay + s.dur) {
      const wx = a[0] - st.pos[0], wz = a[2] - st.pos[1];
      if (Math.hypot(wx, wz) > 1) {
        const want = Math.atan2(wx, wz), cur = Math.atan2(st.h[0], st.h[1]);
        let da = want - cur;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const max = g.turn * dt, na = cur + Math.max(-max, Math.min(max, da));
        st.h[0] = Math.sin(na); st.h[1] = Math.cos(na);
      }
    }
    // fly: độ cao trôi dần về độ cao điểm tâm (ngẩng camera lên trời để bay lên, nhìn xuống đất để bổ nhào)
    if (g.fly && a && el >= s.delay && el <= s.delay + s.dur) {
      const ty = Math.max(0, Math.min(g.fly.max, a[1])), dy = ty - st.y, step = g.fly.rate * dt;
      st.y += Math.max(-step, Math.min(step, dy));
    }
    const run = Math.min(el, s.delay + s.dur) - Math.max(el - dt, s.delay);   // phần dt nằm trong lúc lao
    if (!pos && run > 0) {
      const v = s.dist / s.dur;
      st.pos[0] += st.h[0] * v * run; st.pos[1] += st.h[1] * v * run;
    }
  }
}

// Quay vector đơn vị d về phía w (đơn vị) tối đa maxAng radian.
function turn3(d, w, maxAng) {
  const dot = Math.max(-1, Math.min(1, d[0] * w[0] + d[1] * w[1] + d[2] * w[2]));
  const ang = Math.acos(dot);
  if (ang < 1e-4) return;
  const k = Math.min(1, maxAng / ang);
  // nội suy cầu (slerp) từ d sang w theo tỉ lệ k
  const s0 = Math.sin(ang);
  if (s0 < 1e-4) { // ngược chiều: quay quanh trục Y
    const c = Math.cos(maxAng), sn = Math.sin(maxAng), x = d[0], z = d[2];
    d[0] = x * c - z * sn; d[2] = x * sn + z * c; return;
  }
  const a = Math.sin((1 - k) * ang) / s0, b = Math.sin(k * ang) / s0;
  d[0] = d[0] * a + w[0] * b; d[1] = d[1] * a + w[1] * b; d[2] = d[2] * a + w[2] * b;
  // không cho cắm quá dốc
  d[1] = Math.max(-0.85, Math.min(0.85, d[1]));
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  d[0] /= L; d[1] /= L; d[2] /= L;
}

export function validAim(a) {
  return Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? a.map(v => Math.max(-200, Math.min(200, v))) : null;
}
