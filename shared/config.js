// Cấu hình gameplay dùng chung cho cả server và client.
// Chỉnh số ở đây để cân bằng game.

// Nhịp mạng dùng chung cho cả 2 chế độ chơi.
export const NET = {
  tickRate: 30,          // server tick / giây
  snapRate: 30,          // server gửi snapshot / giây
  sendRate: 30,          // client gửi vị trí của mình / giây
  interp: 0.07,          // nội suy người chơi khác trễ 70ms (≈ 2 snapshot)
};

// Bộ đếm nhịp: trả true khi đến lượt gửi. Trừ dần thay vì xoá về 0 để timer lệch
// vài ms không làm rơi mất một lượt (trước đây snapshot có lúc tụt còn 10–15 Hz).
export class Ticker {
  constructor(rate) { this.step = 1 / rate; this.acc = 0; }
  due(dt) {
    this.acc += dt;
    if (this.acc < this.step - 0.004) return false;
    this.acc = Math.min(this.acc - this.step, this.step * 0.5);
    return true;
  }
}

export const GAME = {
  maxHp: 150,
  maxMana: 100,
  // Hồi phục
  hpRegen: 1.5,          // HP/giây (thụ động, chậm)
  hpRegenDelay: 5,       // giây sau lần bị đánh cuối mới bắt đầu hồi máu
  manaRegen: 5,          // mana/giây (thụ động)
  chargeManaRate: 40,    // mana/giây khi giữ phím vận khí (nhanh hơn hồi máu rất nhiều)
  manaOnHitRatio: 0.35,  // đánh trúng nhận lại mana = sát thương * hệ số
  // Chiêu hồi máu (dùng chung cho mọi nhân vật)
  heal: { mana: 35, cd: 8, amount: 30, dur: 2.5 },
  respawnTime: 4,
  // Thân người chơi (để tính va chạm)
  bodyRadius: 0.6,
  bodyHeight: 1.6,
};

export const MOVE = {
  walk: 7,
  sprint: 11.5,
  gravity: 28,
  jump: 10,
  doubleJump: 9,
  dashSpeed: 26,
  dashTime: 0.2,
  dashCd: 0.75,
  dashInvuln: 0.28,
  flyManaPerSec: 10,     // giữ Space trên không sau khi nhảy đôi = bay lượn
  flyRise: 3.5,
  flyMaxHeight: 14,
};

// Đấu trường: mặt sàn tròn + chướng ngại vật hình trụ
export const ARENA = {
  radius: 40,
  obstacles: [
    // [x, z, bán kính, chiều cao]
    [0, 0, 2.2, 3.2],
    [14, 6, 1.4, 5],
    [-13, 9, 1.6, 4],
    [10, -14, 1.3, 6],
    [-11, -12, 2.0, 2.4],
    [24, -4, 2.5, 1.6],
    [-24, 2, 2.5, 1.6],
    [3, 25, 1.5, 4.5],
    [-4, -26, 1.5, 4.5],
    [22, 20, 1.8, 3],
    [-21, -21, 1.8, 3],
    [-20, 22, 1.2, 7],
    [20, -24, 1.2, 7],
  ],
  spawns: [
    [0, 30], [0, -30], [30, 0], [-30, 0],
    [21, 21], [-21, -21], [21, -21], [-21, 21],
  ],
};

// PRNG có seed – để server và client sinh cùng vị trí (vd: mưa băng)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sinh danh sách điểm rơi cho chiêu kiểu "rain"
export function rainPoints(skill, seed) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < skill.count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * skill.area;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

// Đạn có chạm đất / chướng ngại vật / ra khỏi đấu trường không
export function hitsObstacle(x, y, z, r = 0) {
  if (y <= 0.05) return true;
  for (const [ox, oz, or, oh] of ARENA.obstacles) {
    if (y < oh && Math.hypot(x - ox, z - oz) < or + r * 0.5) return true;
  }
  return Math.hypot(x, z) > ARENA.radius + 6;
}
