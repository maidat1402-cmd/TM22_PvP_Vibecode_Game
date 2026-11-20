// Vũ khí cho chế độ bắn súng (tên + thông số nguyên bản, mô phỏng cơ chế game bắn súng chiến thuật).
// slot: 1 súng chính, 2 súng lục, 3 dao
// dmg: sát thương gốc/viên · head: hệ số headshot · range: hệ số giảm sát thương mỗi 10m
// rpm: tốc độ bắn · mag/reserve: băng đạn/dự trữ · spread: độ tản cơ bản (radian)
// moveSpread: tản thêm khi chạy hết tốc (xem shotSpread) · kick: độ giật mỗi phát · speed: hệ số tốc độ chạy
// armorPen: tỉ lệ sát thương xuyên giáp · reward: tiền thưởng khi hạ địch

export const WEAPONS = {
  knife: { id: 'knife', name: 'Dao Găm', slot: 3, price: 0, dmg: 45, head: 1.5, range: 1, rpm: 110, mag: 0, reserve: 0,
    spread: 0, moveSpread: 0, kick: 0, speed: 1.08, armorPen: 0.85, reward: 1500, melee: true, reach: 2.3, sound: 'knife' },
  pistol: { id: 'pistol', name: 'P9 Lục Tiêu', slot: 2, price: 200, dmg: 30, head: 3.6, range: 0.88, rpm: 380, mag: 12, reserve: 48,
    spread: 0.012, moveSpread: 0.035, kick: 0.018, speed: 1.0, armorPen: 0.5, reward: 300, reload: 2.1, sound: 'pistol' },
  eagle: { id: 'eagle', name: 'Đại Bàng .50', slot: 2, price: 700, dmg: 58, head: 3.8, range: 0.92, rpm: 160, mag: 7, reserve: 35,
    spread: 0.008, moveSpread: 0.06, kick: 0.07, speed: 0.98, armorPen: 0.9, reward: 300, reload: 2.2, sound: 'heavy' },
  smg: { id: 'smg', name: 'Ong Vò Vẽ', slot: 1, price: 1250, dmg: 25, head: 3.2, range: 0.82, rpm: 800, mag: 30, reserve: 120,
    spread: 0.016, moveSpread: 0.02, kick: 0.012, speed: 1.04, armorPen: 0.6, reward: 600, reload: 2.4, auto: true, sound: 'smg' },
  shotgun: { id: 'shotgun', name: 'Sấm Sét 12', slot: 1, price: 1100, dmg: 22, head: 2.2, range: 0.6, rpm: 70, mag: 7, reserve: 28,
    spread: 0.075, moveSpread: 0.02, kick: 0.09, speed: 0.96, armorPen: 0.6, reward: 900, reload: 3.0, pellets: 8, sound: 'shotgun' },
  rifle: { id: 'rifle', name: 'Hổ Vằn AR', slot: 1, price: 2700, dmg: 34, head: 4, range: 0.97, rpm: 600, mag: 30, reserve: 90,
    spread: 0.004, moveSpread: 0.065, kick: 0.016, speed: 0.92, armorPen: 0.78, reward: 300, reload: 2.5, auto: true, sound: 'rifle' },
  carbine: { id: 'carbine', name: 'Rồng Xanh K4', slot: 1, price: 3100, dmg: 31, head: 4, range: 0.98, rpm: 666, mag: 25, reserve: 75,
    spread: 0.0035, moveSpread: 0.06, kick: 0.013, speed: 0.93, armorPen: 0.7, reward: 300, reload: 3.0, auto: true, sound: 'rifle2' },
  sniper: { id: 'sniper', name: 'Diều Hâu SR', slot: 1, price: 4750, dmg: 112, head: 4, range: 0.99, rpm: 41, mag: 5, reserve: 30,
    spread: 0.0, unscoped: 0.12, moveSpread: 0.16, kick: 0.08, speed: 0.82, armorPen: 0.97, reward: 100, reload: 3.6, scope: 22, sound: 'sniper' },
};

export const WEAPON_LIST = Object.keys(WEAPONS);           // dùng chỉ số để nén dữ liệu mạng
export const weaponIndex = id => Math.max(0, WEAPON_LIST.indexOf(id));

export const EQUIPMENT = {
  armor: { id: 'armor', name: 'Giáp + Mũ', price: 1000 },
  kit: { id: 'kit', name: 'Bộ Gỡ Bom', price: 400, team: 'CT' },
};

// Lựu đạn (ô số 4). fuse: thời gian nổ sau khi ném
export const GRENADES = {
  he: { id: 'he', name: 'Lựu Đạn Nổ', icon: '💥', price: 300, max: 1, fuse: 1.6, radius: 7, dmg: 98, color: 0x3a5a40 },
  flash: { id: 'flash', name: 'Lựu Đạn Choáng', icon: '⚡', price: 200, max: 2, fuse: 1.4, radius: 28, blind: 3.6, color: 0xdddddd },
  smoke: { id: 'smoke', name: 'Lựu Đạn Khói', icon: '☁', price: 300, max: 1, fuse: 1.8, radius: 4.6, time: 15, color: 0x8d99ae },
};
export const NADE_LIST = Object.keys(GRENADES);
export const THROW_SPEED = 17;

// Tra thông tin món hàng bất kỳ trong menu mua
export function itemInfo(id) { return WEAPONS[id] || GRENADES[id] || EQUIPMENT[id]; }

// Danh mục trong menu mua
export const BUY_MENU = [
  { cat: 'Súng lục', items: ['pistol', 'eagle'] },
  { cat: 'Tiểu liên / Shotgun', items: ['smg', 'shotgun'] },
  { cat: 'Súng trường', items: ['rifle', 'carbine', 'sniper'] },
  { cat: 'Lựu đạn', items: ['he', 'flash', 'smoke'] },
  { cat: 'Trang bị', items: ['armor', 'kit'] },
];

export const TEAMS = {
  T: { name: 'Hắc Long', role: 'Công', color: 0xe76f51, css: '#f4a261' },
  CT: { name: 'Thiên Ưng', role: 'Thủ', color: 0x4895ef, css: '#7cc4ff' },
};

export const SHOOTER = {
  maxHp: 100,
  // Đặt bom
  freezeTime: 6,
  buyTime: 20,          // tính từ đầu vòng (cả thời gian đóng băng)
  roundTime: 115,
  bombTime: 40,
  plantTime: 3.2,
  defuseTime: 8,
  defuseKitTime: 4,
  roundEndTime: 5,
  halfRounds: 6,        // đổi phe sau 6 vòng
  winRounds: 7,         // thắng 7 vòng là thắng trận
  startMoney: 800,
  maxMoney: 16000,
  winMoney: 3250,
  bombWinMoney: 3500,
  lossMoney: 1400,
  lossBonus: 500,       // cộng thêm mỗi vòng thua liên tiếp (tối đa 4 lần)
  plantMoney: 300,
  plantLossBonus: 800,  // phe công thua nhưng đã cài bom
  bombRadius: 16,
  bombDamage: 220,
  // Sinh tử
  dmKills: 30,
  dmTime: 600,
  dmRespawn: 2.2,
  spawnProtect: 1.5,
  // Di chuyển
  runSpeed: 6.2,
  walkMul: 0.52,
  crouchMul: 0.36,
  jump: 6.8,
  gravity: 20,
};

// Tốc độ chạy tối đa khi cầm vũ khí (dùng để tính độ tản đạn)
export function moveSpeedFor(wid) {
  return SHOOTER.runSpeed * (WEAPONS[wid]?.speed ?? 1);
}

// Độ tản đạn khi di chuyển:
// - Dưới MOVE_FREE × tốc độ chạy (đi bộ Shift, ngồi, ngắm scope đi chậm) gần như không bị phạt.
// - Trên ngưỡng đó, phạt tăng theo bình phương: đi nhanh vừa thì lệch ít, chạy hết tốc mới lệch nhiều.
export const MOVE_FREE = 0.35;
export const SCOPED_SPREAD = 0.0005;   // tản khi đang ngắm scope, đứng yên
export const AIR_SPREAD = 0.09;        // cộng thêm khi đang nhảy / rơi
export const PUNCH_SPREAD = 0.35;      // phần độ giật cộng vào độ tản

// Độ tản (radian, bán kính nón) của phát bắn kế tiếp.
// st: { speed: tốc độ ngang m/s, grounded, crouch, scoped, punch: độ giật hiện tại (radian) }
export function shotSpread(w, st) {
  let s = w.scope ? (st.scoped ? SCOPED_SPREAD : w.unscoped) : w.spread;
  const k = Math.max(0, Math.min(1, (st.speed / moveSpeedFor(w.id) - MOVE_FREE) / (1 - MOVE_FREE)));
  s += w.moveSpread * k * k;
  if (!st.grounded) s += AIR_SPREAD;
  if (st.crouch && st.grounded) s *= 0.7;
  s += (st.punch || 0) * PUNCH_SPREAD;
  return s;
}
