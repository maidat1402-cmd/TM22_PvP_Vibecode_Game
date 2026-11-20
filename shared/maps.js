// Map cho chế độ bắn súng + hàm va chạm / raycast dùng chung (client & server).
// Mỗi khối: { x, z (tâm), w (rộng theo X), d (sâu theo Z), h (cao), y (đáy, mặc định 0), k (loại để vẽ) }

const WALL_H = 8;

export const MAPS = {
  lantern: {
    id: 'lantern',
    name: 'Phố Lồng Đèn',
    theme: 'lantern',
    bounds: { x: 42, z: 32 },
    boxes: [
      // Tường bao
      { x: 0, z: -32.5, w: 86, d: 1, h: WALL_H, k: 'wall' },
      { x: 0, z: 32.5, w: 86, d: 1, h: WALL_H, k: 'wall' },
      { x: -42.5, z: 0, w: 1, d: 66, h: WALL_H, k: 'wall' },
      { x: 42.5, z: 0, w: 1, d: 66, h: WALL_H, k: 'wall' },
      // Hai dãy nhà giữa chia 3 đường
      { x: -14.5, z: -8, w: 13, d: 24, h: 7, k: 'house' },
      { x: 14.5, z: -8, w: 13, d: 24, h: 7, k: 'house' },
      // Nhà trong đường hai bên
      { x: -33, z: -8, w: 10, d: 10, h: 6, k: 'house' },
      { x: 33, z: -8, w: 10, d: 10, h: 6, k: 'house' },
      // Cửa giữa
      { x: -4.75, z: 5, w: 6.5, d: 1, h: 5, k: 'wall' },
      { x: 4.75, z: 5, w: 6.5, d: 1, h: 5, k: 'wall' },
      // Vách ngăn khu thủ (có cửa)
      { x: -12, z: 15.5, w: 1.5, d: 7, h: 6, k: 'wall' },
      { x: -12, z: 27.5, w: 1.5, d: 9, h: 6, k: 'wall' },
      { x: 12, z: 15.5, w: 1.5, d: 7, h: 6, k: 'wall' },
      { x: 12, z: 27.5, w: 1.5, d: 9, h: 6, k: 'wall' },
      // Giữa map
      { x: 0, z: -10, w: 2.4, d: 2.4, h: 2.4, k: 'crate' },
      { x: -2.4, z: -11, w: 1.3, d: 1.3, h: 1.0, k: 'crate' },
      { x: 2, z: 12, w: 2.2, d: 2.2, h: 1.1, k: 'crate' },
      // Khu xuất phát phe công
      { x: -6, z: -24, w: 2, d: 2, h: 1.2, k: 'crate' },
      { x: 7, z: -25, w: 2.2, d: 2.2, h: 2.2, k: 'crate' },
      // Đường hai bên
      { x: -24.5, z: -20, w: 2, d: 2, h: 1.1, k: 'crate' },
      { x: 24.5, z: -18, w: 2, d: 2, h: 1.1, k: 'crate' },
      { x: -25, z: 2, w: 2.4, d: 2.4, h: 2.4, k: 'crate' },
      { x: 26, z: 1, w: 2.4, d: 2.4, h: 2.4, k: 'crate' },
      // ĐIỂM B
      { x: -32, z: 20, w: 3, d: 3, h: 2.6, k: 'crate' },
      { x: -32, z: 20, w: 1.6, d: 1.6, h: 1.3, y: 2.6, k: 'crate' },
      { x: -26, z: 26, w: 2, d: 2, h: 1.1, k: 'crate' },
      { x: -37, z: 13, w: 4, d: 1.5, h: 1.2, k: 'crate' },
      { x: -20, z: 14, w: 2, d: 2, h: 5, k: 'pillar' },
      { x: -36, z: 29, w: 8, d: 3, h: 3, k: 'house' },
      // ĐIỂM A
      { x: 30, z: 22, w: 4, d: 2.5, h: 2.2, k: 'crate' },
      { x: 24, z: 15, w: 2, d: 2, h: 1.1, k: 'crate' },
      { x: 37, z: 27, w: 2.5, d: 2.5, h: 2.5, k: 'crate' },
      { x: 37, z: 12, w: 2, d: 4, h: 1.2, k: 'crate' },
      { x: 20, z: 24, w: 2, d: 2, h: 5, k: 'pillar' },
      { x: 30, z: 30.5, w: 8, d: 3, h: 3, k: 'house' },
    ],
    spawns: {
      T: [-7.5, -5, -2.5, 0, 2.5, 5, -7.5, -5, -2.5, 0, 2.5, 5].map((x, i) => [x + (i >= 6 ? 1.25 : 0), i < 6 ? -28 : -30.5]),
      CT: [-7.5, -5, -2.5, 0, 2.5, 5, -7.5, -5, -2.5, 0, 2.5, 5].map((x, i) => [x + (i >= 6 ? 1.25 : 0), i < 6 ? 25 : 28.5]),
    },
    dmSpawns: [
      [-36, -26], [36, -26], [0, -27], [-25, -12], [25, -12], [-31, 2], [31, 4], [0, 0],
      [0, 14], [-18, 9], [18, 9], [-30, 25], [26, 20], [0, 27], [-39, -18], [39, -18],
    ],
    sites: {
      A: { x0: 20, x1: 41.5, z0: 10, z1: 31.5, cx: 30, cz: 18 },
      B: { x0: -41.5, x1: -20, z0: 10, z1: 31.5, cx: -29, cz: 17 },
    },
    buyZones: { T: { x: 0, z: -27, r: 11 }, CT: { x: 0, z: 26, r: 11 } },
  },

  // ---------- Map 2: đền trên núi tuyết, sân giữa có bệ cao + bậc thang ----------
  temple: {
    id: 'temple',
    name: 'Đền Tuyết Sơn',
    theme: 'snow',
    bounds: { x: 38, z: 38 },
    boxes: [
      // tường bao
      { x: 0, z: -38.5, w: 78, d: 1, h: WALL_H, k: 'wall' },
      { x: 0, z: 38.5, w: 78, d: 1, h: WALL_H, k: 'wall' },
      { x: -38.5, z: 0, w: 1, d: 78, h: WALL_H, k: 'wall' },
      { x: 38.5, z: 0, w: 1, d: 78, h: WALL_H, k: 'wall' },
      // tường thành chia nam / bắc với 3 cổng
      { x: -32, z: -8, w: 12, d: 1.2, h: 5, k: 'wall' },
      { x: -11.5, z: -8, w: 17, d: 1.2, h: 5, k: 'wall' },
      { x: 11.5, z: -8, w: 17, d: 1.2, h: 5, k: 'wall' },
      { x: 32, z: -8, w: 12, d: 1.2, h: 5, k: 'wall' },
      // nhà phía nam
      { x: -28, z: -22, w: 9, d: 8, h: 6, k: 'house' },
      { x: 28, z: -24, w: 9, d: 6, h: 6, k: 'house' },
      { x: -12, z: -26, w: 2.2, d: 2.2, h: 2.2, k: 'crate' },
      { x: 12, z: -20, w: 2.2, d: 2.2, h: 1.1, k: 'crate' },
      { x: 0, z: -16, w: 3, d: 1.2, h: 1.2, k: 'crate' },
      // bệ đá giữa sân + bậc thang hai phía + tháp chuông
      { x: 0, z: 0.55, w: 10, d: 9.6, h: 1.6, k: 'stone' },
      { x: 0, z: -4.55, w: 4, d: 0.6, h: 1.2, k: 'stone' },
      { x: 0, z: -5.15, w: 4, d: 0.6, h: 0.8, k: 'stone' },
      { x: 0, z: -5.75, w: 4, d: 0.6, h: 0.4, k: 'stone' },
      { x: 0, z: 5.65, w: 4, d: 0.6, h: 1.2, k: 'stone' },
      { x: 0, z: 6.25, w: 4, d: 0.6, h: 0.8, k: 'stone' },
      { x: 0, z: 6.85, w: 4, d: 0.6, h: 0.4, k: 'stone' },
      { x: 0, z: 1, w: 2, d: 2, h: 4.2, y: 1.6, k: 'pillar' },
      { x: 3.2, z: 3.4, w: 1.2, d: 1.2, h: 1.0, y: 1.6, k: 'crate' },
      { x: -3.2, z: -2, w: 1.2, d: 1.2, h: 1.0, y: 1.6, k: 'crate' },
      // vật che sân giữa
      { x: -15, z: -1, w: 1.4, d: 1.4, h: 2.6, k: 'pillar' },
      { x: 15, z: 3, w: 1.4, d: 1.4, h: 2.6, k: 'pillar' },
      { x: -27, z: 1, w: 2.4, d: 2.4, h: 1.2, k: 'crate' },
      { x: 26, z: -2, w: 2.4, d: 2.4, h: 2.4, k: 'crate' },
      { x: -24, z: 10, w: 8, d: 0.8, h: 1.2, k: 'stone' },
      { x: 24, z: 10, w: 8, d: 0.8, h: 1.2, k: 'stone' },
      // vách khu phe thủ (có cửa)
      { x: -12, z: 18, w: 1.4, d: 8, h: 5, k: 'wall' },
      { x: -12, z: 32.5, w: 1.4, d: 11, h: 5, k: 'wall' },
      { x: 12, z: 18, w: 1.4, d: 8, h: 5, k: 'wall' },
      { x: 12, z: 32.5, w: 1.4, d: 11, h: 5, k: 'wall' },
      // ĐIỂM A (đông bắc): chùa nhỏ + thùng
      { x: 29, z: 29, w: 6, d: 5, h: 4, k: 'house' },
      { x: 20, z: 19, w: 2.2, d: 2.2, h: 1.1, k: 'crate' },
      { x: 31, z: 16, w: 3, d: 2, h: 2.2, k: 'crate' },
      { x: 22, z: 30, w: 1.2, d: 1.2, h: 3, k: 'pillar' },
      // ĐIỂM B (tây bắc): đèn đá + thùng
      { x: -29, z: 27, w: 7, d: 3, h: 3, k: 'house' },
      { x: -21, z: 23, w: 2.4, d: 2.4, h: 2.4, k: 'crate' },
      { x: -21, z: 23, w: 1.2, d: 1.2, h: 1.0, y: 2.4, k: 'crate' },
      { x: -32, z: 16, w: 2, d: 2, h: 1.1, k: 'crate' },
      { x: -17, z: 32, w: 1.2, d: 1.2, h: 3, k: 'pillar' },
    ],
    spawns: {
      T: [-7.5, -5, -2.5, 0, 2.5, 5, -7.5, -5, -2.5, 0, 2.5, 5].map((x, i) => [x + (i >= 6 ? 1.25 : 0), i < 6 ? -32 : -35]),
      CT: [-7.5, -5, -2.5, 0, 2.5, 5, -7.5, -5, -2.5, 0, 2.5, 5].map((x, i) => [x + (i >= 6 ? 1.25 : 0), i < 6 ? 31 : 34.5]),
    },
    dmSpawns: [
      [-33, -33], [33, -33], [0, -33], [-20, -14], [20, -14], [-22, 3], [21, 5], [8, -5],
      [-8, 9], [32, 6], [-34, 5], [-25, 32], [24, 34], [0, 30], [-18, 19], [17, 24],
    ],
    sites: {
      A: { x0: 14, x1: 37.5, z0: 12, z1: 37.5, cx: 25, cz: 22 },
      B: { x0: -37.5, x1: -14, z0: 12, z1: 37.5, cx: -27, cz: 19 },
    },
    buyZones: { T: { x: 0, z: -33, r: 10 }, CT: { x: 0, z: 32, r: 10 } },
  },
};

export const MAP_LIST = Object.keys(MAPS);
Object.setPrototypeOf(MAPS, null);   // id map từ gói tin như "constructor" không được tra ra hàm của Object
export function getMap(id) { return MAPS[id] || MAPS.lantern; }

// Tính sẵn min/max cho từng khối
for (const m of Object.values(MAPS)) {
  for (const b of m.boxes) {
    b.y ??= 0;
    b.minX = b.x - b.w / 2; b.maxX = b.x + b.w / 2;
    b.minZ = b.z - b.d / 2; b.maxZ = b.z + b.d / 2;
    b.minY = b.y; b.maxY = b.y + b.h;
  }
}

export const PLAYER = { radius: 0.4, height: 1.8, crouchHeight: 1.3, eye: 1.55, crouchEye: 1.1, step: 0.45 };

// ---------- Di chuyển + va chạm (nhân vật là hình trụ đứng) ----------
// pos/vel: {x,y,z}; trả về true nếu đang đứng trên mặt đất
export function moveAndCollide(pos, vel, dt, boxes, height = PLAYER.height, wasGrounded = false) {
  const r = PLAYER.radius;
  const overlapXZ = (b, px, pz) => px > b.minX - r && px < b.maxX + r && pz > b.minZ - r && pz < b.maxZ + r;
  const overlapY = (b, py) => py < b.maxY - 0.001 && py + height > b.minY + 0.001;

  // trục X rồi Z, có hỗ trợ bước lên bậc thấp
  for (const axis of ['x', 'z']) {
    pos[axis] += vel[axis] * dt;
    for (const b of boxes) {
      if (!overlapXZ(b, pos.x, pos.z) || !overlapY(b, pos.y)) continue;
      const stepUp = b.maxY - pos.y;
      if (wasGrounded && stepUp > 0 && stepUp <= PLAYER.step && !blockedAbove(boxes, pos, b.maxY, height, r)) {
        pos.y = b.maxY;
        continue;
      }
      if (axis === 'x') pos.x = vel.x > 0 ? b.minX - r - 0.001 : vel.x < 0 ? b.maxX + r + 0.001 : pushOut(b, pos, 'x', r);
      else pos.z = vel.z > 0 ? b.minZ - r - 0.001 : vel.z < 0 ? b.maxZ + r + 0.001 : pushOut(b, pos, 'z', r);
      vel[axis] = 0;
    }
  }

  // trục Y
  const prevY = pos.y;
  pos.y += vel.y * dt;
  let grounded = false;
  if (pos.y <= 0) { pos.y = 0; vel.y = Math.max(0, vel.y); grounded = true; }
  for (const b of boxes) {
    if (!overlapXZ(b, pos.x, pos.z)) continue;
    if (vel.y <= 0 && prevY >= b.maxY - 0.05 && pos.y < b.maxY) { pos.y = b.maxY; vel.y = 0; grounded = true; }
    else if (vel.y > 0 && prevY + height <= b.minY + 0.05 && pos.y + height > b.minY) { pos.y = b.minY - height; vel.y = 0; }
  }
  // kiểm tra đang đứng trên mặt khối (khi vận tốc = 0)
  if (!grounded) {
    for (const b of boxes) if (overlapXZ(b, pos.x, pos.z) && Math.abs(pos.y - b.maxY) < 0.02 && vel.y <= 0) grounded = true;
  }
  return grounded;
}

function pushOut(b, pos, axis, r) {
  if (axis === 'x') return pos.x < b.x ? b.minX - r - 0.001 : b.maxX + r + 0.001;
  return pos.z < b.z ? b.minZ - r - 0.001 : b.maxZ + r + 0.001;
}

function blockedAbove(boxes, pos, y, height, r) {
  for (const b of boxes) {
    if (pos.x > b.minX - r && pos.x < b.maxX + r && pos.z > b.minZ - r && pos.z < b.maxZ + r &&
      y < b.maxY - 0.001 && y + height > b.minY + 0.001) return true;
  }
  return false;
}

// ---------- Raycast ----------
// Tia (o + d*t) với hộp AABB, trả về t hoặc Infinity
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  const axes = [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]];
  let nAxis = -1;
  for (let i = 0; i < 3; i++) {
    const [o, d, lo, hi] = axes[i];
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return { t: Infinity }; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) { tmin = t1; nAxis = i; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return { t: Infinity };
  }
  if (tmax < 0) return { t: Infinity };
  const n = [0, 0, 0];
  if (nAxis >= 0) n[nAxis] = -Math.sign(axes[nAxis][1]);
  return { t: Math.max(0, tmin), n };
}

// Tia với toàn bộ map (cả mặt đất y=0). Trả về { t, n }
export function rayMap(o, d, maxDist, boxes) {
  let best = { t: maxDist, n: null };
  if (d[1] < -1e-6) {
    const tg = -o[1] / d[1];
    if (tg >= 0 && tg < best.t) best = { t: tg, n: [0, 1, 0] };
  }
  for (const b of boxes) {
    const r = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
    if (r.t < best.t) best = r;
  }
  return best;
}

// Tia với một quả cầu
export function raySphere(o, d, cx, cy, cz, r) {
  const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : (c < 0 ? 0 : Infinity);
}

// Hitbox chibi: đầu to (dễ headshot hơn một chút!), thân, chân
export function hitboxes(x, y, z, crouch) {
  const headY = crouch ? 1.0 : 1.38;
  const top = crouch ? 0.72 : 1.0;
  return {
    head: [x, y + headY, z, 0.42],
    body: [x - 0.36, y + 0.42, z - 0.36, x + 0.36, y + top, z + 0.36],
    legs: [x - 0.3, y, z - 0.3, x + 0.3, y + 0.42, z + 0.3],
  };
}

// Tia với người chơi: trả về { t, zone } (zone: 1 đầu, 2 thân, 3 chân)
export function rayPlayer(o, d, x, y, z, crouch) {
  const hb = hitboxes(x, y, z, crouch);
  let best = { t: Infinity, zone: 0 };
  const th = raySphere(o, d, ...hb.head);
  if (th < best.t) best = { t: th, zone: 1 };
  const tb = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], ...hb.body).t;
  if (tb < best.t) best = { t: tb, zone: 2 };
  const tl = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], ...hb.legs).t;
  if (tl < best.t) best = { t: tl, zone: 3 };
  return best;
}

export function inRect(r, x, z) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }

// ---------- Lựu đạn: mô phỏng bước cố định, server và client chạy y hệt nhau ----------
export const NADE_STEP = 1 / 60;
const NADE_G = 16, NADE_R = 0.09;

export function newNade(o, v) { return { p: [o[0], o[1], o[2]], v: [v[0], v[1], v[2]], rest: false, t: 0, bounces: 0 }; }

// Tiến 1 bước; trả về true nếu vừa nảy (để phát tiếng "cạch")
export function stepNade(s, map) {
  s.t += NADE_STEP;
  if (s.rest) return false;
  const v = s.v, p = s.p;
  v[1] -= NADE_G * NADE_STEP;
  const len = Math.hypot(v[0], v[1], v[2]) * NADE_STEP;
  if (len < 1e-6) return false;
  const d = [v[0] * NADE_STEP / len, v[1] * NADE_STEP / len, v[2] * NADE_STEP / len];
  const hit = rayMap(p, d, len + NADE_R, map.boxes);
  if (hit.n && hit.t < len + NADE_R) {
    const go = Math.max(0, hit.t - NADE_R);
    p[0] += d[0] * go; p[1] += d[1] * go; p[2] += d[2] * go;
    const n = hit.n;
    const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    // phản xạ + mất năng lượng
    for (let i = 0; i < 3; i++) v[i] = (v[i] - 2 * vn * n[i]) * 0.72;
    for (let i = 0; i < 3; i++) v[i] -= n[i] * (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) * 0.4;
    s.bounces++;
    if (n[1] > 0.7 && Math.hypot(v[0], v[1], v[2]) < 1.2) { v[0] = v[1] = v[2] = 0; s.rest = true; }
    return true;
  }
  p[0] += v[0] * NADE_STEP; p[1] += v[1] * NADE_STEP; p[2] += v[2] * NADE_STEP;
  const B = map.bounds;
  p[0] = Math.max(-B.x, Math.min(B.x, p[0]));
  p[2] = Math.max(-B.z, Math.min(B.z, p[2]));
  if (p[1] < 0) { p[1] = 0; s.rest = true; }
  return false;
}

// Có đường nhìn thẳng giữa 2 điểm không (tường chắn)
export function lineOfSight(a, b, map) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-3) return true;
  return rayMap(a, [dx / L, dy / L, dz / L], L, map.boxes).t >= L - 0.2;
}
