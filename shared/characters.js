// Định nghĩa nhân vật + chiêu thức (data-driven).
// Thêm nhân vật mới: copy một object, đổi look + skills. Không cần sửa code engine
// miễn là dùng các "type" chiêu có sẵn:
//   melee      : chém/đấm cận chiến hình quạt trước mặt
//   projectile : bắn đạn (count, spread, pierce, explode)
//   dash       : lao tới gây sát thương dọc đường đi
//   beam       : tia năng lượng (charge rồi bắn, gây sát thương theo tick)
//   aoe        : vùng sát thương (at: 'self' | 'front'), có thể nhiều tick
//   line       : chuỗi vụ nổ nối tiếp theo một đường thẳng
//   rain       : mưa sát thương ngẫu nhiên (seed đồng bộ) trong một vùng
//   trap       : đặt bẫy tồn tại lâu, đối thủ giẫm vào thì kích hoạt
//   summon     : triệu hồi vật thể (cây) tồn tại dur giây: chắn đạn (obstacle), hồi máu xung quanh (aura)
//   leap       : nhảy tới điểm tâm ngắm rồi đập đất (walls: dựng cột đá tạm thời)
//   blink      : dịch chuyển tức thời (tới dấu phi đao nếu có), gây sát thương nơi tới
//   buff       : tăng chỉ số tạm thời cho bản thân (dmgTaken, noKb, stealth, nextHitMul)
// chain: true + combo 'JJJ' = đòn kết khi bấm J lần thứ 3 liên tiếp (không đi qua bảng combo)
//
// combo: chuỗi phím J/K/L bấm liên tiếp (trong ~0.5s). Chuỗi dài hơn được ưu tiên.
// hp: máu tối đa riêng của nhân vật (mặc định 150). Nhân vật to con nhiều máu, sát thủ ít máu.
// Các trường fx.* chỉ dùng cho hiệu ứng hình ảnh phía client.

export const CHARACTERS = [
  {
    id: 'kaze',
    name: 'Kaze',
    title: 'Phong Nhẫn Giả',
    desc: 'Ninja gió nhanh nhẹn, giỏi ám khí và lốc xoáy.',
    speedMul: 1.08,
    hp: 145,               // máu tối đa
    look: {
      skin: 0xffe0c4, hair: 0x2ec4b6, hairStyle: 'spiky', eye: 0x1b6f8a,
      outfit: 0x22304a, outfit2: 0xf26b38, accessory: 'scarf', accColor: 0xd7263d,
      headband: 0x9aa7b8, weapon: 'kunai',
    },
    skills: [
      { id: 'kz_slash', name: 'Kunai Liên Trảm', combo: 'J', mana: 0, cd: 0.32, lock: 0.28, instant: true,
        type: 'melee', range: 2.4, arc: 1.2, dmg: 6, kb: 3, delay: 0.1, lunge: 4, pose: 'slash',
        fx: { color: 0x9ff7ee, kind: 'slash' } },
      { id: 'kz_shuriken', name: 'Phi Tiêu Phong Ấn', combo: 'K', mana: 8, cd: 0.6, lock: 0.3,
        type: 'projectile', speed: 30, radius: 0.45, range: 30, dmg: 9, kb: 3, count: 3, spread: 0.22, delay: 0.1, pose: 'throw',
        fx: { color: 0x7fffe8, core: 0xffffff, kind: 'shuriken' } },
      { id: 'kz_orb', name: 'Phong Cầu Xoáy', combo: 'JK', mana: 22, cd: 3.5, lock: 0.55, root: true,
        type: 'dash', dist: 7, dur: 0.32, radius: 1.5, dmg: 24, kb: 11, kbUp: 5, delay: 0.15, pose: 'thrust', invuln: true,
        fx: { color: 0x66e0ff, core: 0xffffff, kind: 'spiralOrb' } },
      { id: 'kz_blades', name: 'Lốc Phong Đao', combo: 'KL', mana: 25, cd: 5, lock: 0.9, root: true,
        type: 'aoe', at: 'self', radius: 4, dmg: 6, kb: 2, ticks: 5, tickInt: 0.16, delay: 0.1, pose: 'spin',
        fx: { color: 0xa8fff2, kind: 'bladeStorm' } },
      { id: 'kz_tornado', name: 'Đại Phong Long Quyển', combo: 'JKL', mana: 60, cd: 12, lock: 1.0, root: true,
        type: 'aoe', at: 'front', offset: 7, radius: 4.8, dmg: 7, kb: 1, kbUp: 4, pull: 6, ticks: 9, tickInt: 0.25, delay: 0.5, pose: 'raise',
        steer: { mode: 'follow', speed: 7, range: 18 },   // lốc xoáy trôi theo tâm ngắm
        fx: { color: 0x7ff5e0, core: 0xe8fffb, kind: 'tornado' } },
      { id: 'kz_fin', name: 'Phi Kunai Tuyệt Ảnh', combo: 'JJJ', chain: true, mana: 0, cd: 1, lock: 0.4,
        type: 'projectile', speed: 42, radius: 0.45, range: 22, dmg: 11, kb: 5, count: 1, spread: 0, pierce: true, delay: 0.12, pose: 'throw',
        fx: { color: 0x9ff7ee, core: 0xffffff, kind: 'kunaiThrow' } },
    ],
  },
  {
    id: 'raiga',
    name: 'Raiga',
    title: 'Khí Công Quyền Vương',
    desc: 'Võ sĩ tóc vàng, bắn khí đạn và chưởng phong ba cực mạnh.',
    speedMul: 1.0,
    hp: 155,               // máu tối đa
    look: {
      skin: 0xffd9b8, hair: 0xffd23f, hairStyle: 'superSpiky', eye: 0x2a9d8f,
      outfit: 0xf77f00, outfit2: 0x1d3557, accessory: 'belt', accColor: 0x1d3557,
      weapon: 'none', aura: 0xffe066,
    },
    skills: [
      { id: 'rg_punch', name: 'Liên Hoàn Quyền', combo: 'J', mana: 0, cd: 0.3, lock: 0.26, instant: true,
        type: 'melee', range: 2.1, arc: 1.0, dmg: 6, kb: 3.5, delay: 0.08, lunge: 5, pose: 'punch',
        fx: { color: 0xffe066, kind: 'impact' } },
      { id: 'rg_ki', name: 'Khí Đạn', combo: 'K', mana: 6, cd: 0.28, lock: 0.2,
        type: 'projectile', speed: 34, radius: 0.5, range: 32, dmg: 7, kb: 2.5, count: 1, spread: 0, delay: 0.06, pose: 'push',
        fx: { color: 0xffd23f, core: 0xffffff, kind: 'kiBlast' } },
      { id: 'rg_dash', name: 'Thiểm Quang Quyền', combo: 'JK', mana: 18, cd: 3, lock: 0.45,
        type: 'dash', dist: 8, dur: 0.25, radius: 1.3, dmg: 18, kb: 14, kbUp: 3, delay: 0.08, pose: 'punch', invuln: true,
        fx: { color: 0xffbe0b, core: 0xffffff, kind: 'dashPunch' } },
      { id: 'rg_wave', name: 'Chưởng Phong Ba', combo: 'KL', mana: 38, cd: 7, lock: 1.9, root: true,
        type: 'beam', length: 26, width: 1.1, dmg: 5, tickInt: 0.12, dur: 1.15, kb: 4, delay: 0.7, pose: 'beam',
        fx: { color: 0x4cc9f0, core: 0xffffff, kind: 'beam' } },
      { id: 'rg_bomb', name: 'Tinh Cầu Hủy Diệt', combo: 'JKL', mana: 70, cd: 14, lock: 1.4, root: true,
        type: 'projectile', speed: 13, radius: 2.0, range: 34, dmg: 30, kb: 8, count: 1, spread: 0, delay: 0.9, pose: 'raise',
        explode: { radius: 6, dmg: 32, kb: 16, kbUp: 8 },
        steer: { mode: 'homing', turn: 2.4 },             // cầu năng lượng bẻ hướng theo tâm
        fx: { color: 0x3aa8ff, core: 0x9be7ff, kind: 'bigBomb' } },
      { id: 'rg_fin', name: 'Thăng Thiên Quyền', combo: 'JJJ', chain: true, mana: 0, cd: 1, lock: 0.45,
        type: 'melee', range: 2.3, arc: 1.1, dmg: 11, kb: 3, kbUp: 10, delay: 0.12, lunge: 3, pose: 'uppercut',
        fx: { color: 0xffd23f, kind: 'impact' } },
    ],
  },
  {
    id: 'homura',
    name: 'Homura',
    title: 'Hỏa Kiếm Cơ',
    desc: 'Nữ kiếm sĩ lửa, chém sóng lửa và hóa phượng hoàng.',
    speedMul: 1.03,
    hp: 150,               // máu tối đa
    look: {
      skin: 0xffe4cf, hair: 0xd62828, hairStyle: 'ponytail', eye: 0xb5179e,
      outfit: 0xf8f9fa, outfit2: 0x9d0208, accessory: 'sash', accColor: 0xffba08,
      weapon: 'katana',
    },
    skills: [
      { id: 'hm_slash', name: 'Viêm Kiếm Trảm', combo: 'J', mana: 0, cd: 0.36, lock: 0.3, instant: true,
        type: 'melee', range: 2.8, arc: 1.4, dmg: 7, kb: 3, delay: 0.1, lunge: 4, pose: 'slash',
        fx: { color: 0xff7b00, kind: 'slash' } },
      { id: 'hm_wave', name: 'Viêm Nguyệt Trảm', combo: 'K', mana: 10, cd: 0.9, lock: 0.35,
        type: 'projectile', speed: 24, radius: 1.1, range: 22, dmg: 11, kb: 4, count: 1, spread: 0, pierce: true, delay: 0.12, pose: 'slash',
        fx: { color: 0xff5400, core: 0xffd60a, kind: 'crescent' } },
      { id: 'hm_rise', name: 'Thăng Long Hỏa', combo: 'JK', mana: 20, cd: 4, lock: 0.6,
        type: 'aoe', at: 'self', radius: 2.8, dmg: 20, kb: 3, kbUp: 13, ticks: 1, tickInt: 0, delay: 0.1, pose: 'uppercut', leap: 11,
        fx: { color: 0xff6d00, core: 0xffea00, kind: 'flameRise' } },
      { id: 'hm_pillars', name: 'Hỏa Trụ Liên Hoàn', combo: 'KL', mana: 30, cd: 6, lock: 0.8, root: true,
        type: 'line', start: 2.5, spacing: 2.6, count: 6, interval: 0.11, radius: 1.8, dmg: 22, kb: 3, kbUp: 7, delay: 0.25, pose: 'slam',
        fx: { color: 0xff4800, core: 0xffd000, kind: 'firePillar' } },
      { id: 'hm_phoenix', name: 'Phượng Hoàng Giáng Thế', combo: 'JKL', mana: 65, cd: 13, lock: 1.1, root: true,
        type: 'dash', dist: 17, dur: 0.55, radius: 2.4, dmg: 34, kb: 12, kbUp: 6, delay: 0.4, pose: 'thrust', invuln: true,
        explode: { radius: 5, dmg: 20, kb: 12, kbUp: 8 },
        steer: { mode: 'turn', turn: 4 },                 // đường lao uốn theo tâm
        fx: { color: 0xff5400, core: 0xfff3b0, kind: 'phoenix' } },
      { id: 'hm_fin', name: 'Viêm Long Toàn Trảm', combo: 'JJJ', chain: true, mana: 0, cd: 1, lock: 0.45,
        type: 'aoe', at: 'self', radius: 3.2, dmg: 12, kb: 6, kbUp: 3, ticks: 1, tickInt: 0, delay: 0.12, pose: 'spin',
        fx: { color: 0xff7b00, core: 0xffd60a, kind: 'bladeStorm' } },
    ],
  },
  {
    id: 'yuki',
    name: 'Yuki',
    title: 'Băng Tuyết Pháp Sư',
    desc: 'Pháp sư băng, khống chế làm chậm/đóng băng và mưa băng diện rộng.',
    speedMul: 0.97,
    hp: 145,               // máu tối đa
    look: {
      skin: 0xfff0e6, hair: 0xdff3ff, hairStyle: 'long', eye: 0x3a86ff,
      outfit: 0x3a5a9a, outfit2: 0xbde0fe, accessory: 'hat', accColor: 0x283c6e,
      weapon: 'staff',
    },
    skills: [
      { id: 'yk_staff', name: 'Băng Trượng Kích', combo: 'J', mana: 0, cd: 0.38, lock: 0.3, instant: true,
        type: 'melee', range: 2.6, arc: 1.1, dmg: 6, kb: 4, delay: 0.12, lunge: 3, pose: 'slash',
        fx: { color: 0xa0e7ff, kind: 'slash' } },
      { id: 'yk_shards', name: 'Băng Tiễn Phong Bạo', combo: 'K', mana: 9, cd: 0.8, lock: 0.3,
        type: 'projectile', speed: 28, radius: 0.4, range: 24, dmg: 5, kb: 1.5, count: 5, spread: 0.45, delay: 0.1, pose: 'push',
        slow: { mul: 0.75, dur: 1 },
        fx: { color: 0x90e0ef, core: 0xffffff, kind: 'iceShard' } },
      { id: 'yk_spikes', name: 'Băng Phong Lộ', combo: 'JK', mana: 18, cd: 3.5, lock: 0.55, root: true,
        type: 'line', start: 2, spacing: 1.9, count: 7, interval: 0.06, radius: 1.3, dmg: 18, kb: 1, kbUp: 6, delay: 0.15, pose: 'slam',
        slow: { mul: 0.55, dur: 1.6 },
        fx: { color: 0x7fd8ff, core: 0xe9fbff, kind: 'iceSpike' } },
      { id: 'yk_nova', name: 'Hàn Băng Kết Giới', combo: 'KL', mana: 32, cd: 8, lock: 0.7, root: true,
        type: 'aoe', at: 'self', radius: 5.5, dmg: 20, kb: 6, kbUp: 2, ticks: 1, tickInt: 0, delay: 0.35, pose: 'raise',
        stun: 1.3,
        fx: { color: 0x9bf6ff, core: 0xffffff, kind: 'frostNova' } },
      { id: 'yk_blizzard', name: 'Thiên Băng Vũ', combo: 'JKL', mana: 60, cd: 14, lock: 1.2, root: true,
        type: 'rain', offset: 8, area: 6.5, count: 22, interval: 0.11, radius: 1.7, dmg: 8, kb: 2, kbUp: 2, delay: 0.5, fall: 0.45, pose: 'raise',
        slow: { mul: 0.6, dur: 1.2 },
        steer: { mode: 'follow', speed: 5, range: 16 },   // vùng mưa băng di chuyển theo tâm
        fx: { color: 0x8ecae6, core: 0xffffff, kind: 'icicleRain' } },
      { id: 'yk_fin', name: 'Băng Phong Kích', combo: 'JJJ', chain: true, mana: 0, cd: 1, lock: 0.45,
        type: 'melee', range: 2.8, arc: 1.4, dmg: 10, kb: 5, delay: 0.14, lunge: 2, pose: 'slam',
        slow: { mul: 0.5, dur: 1.2 },
        fx: { color: 0xa0e7ff, kind: 'slash' } },
    ],
  },
  {
    id: 'shiden',
    name: 'Shiden',
    title: 'Lôi Thương Kỵ Sĩ',
    desc: 'Kỵ sĩ cầm thương sét. Nội tại Tích Điện: đánh trúng 3 lần thì sét tự nảy sang các đối thủ gần đó. Tuyệt kỹ phóng thương rồi dịch chuyển tới chỗ thương cắm.',
    // nội tại: mỗi đòn trúng thêm 1 dấu điện (giữ 4 giây); đủ 3 dấu thì sét đánh mục tiêu (8) và nảy sang tối đa 2 đối thủ trong 7 m (6)
    passive: { kind: 'charge', stacks: 3, dur: 4, dmg: 8, jumpDmg: 6, jumps: 2, range: 7, stun: 0.3 },
    speedMul: 1.0,
    hp: 145,               // máu tối đa
    look: {
      skin: 0xffe2c8, hair: 0x5a4fcf, hairStyle: 'short', eye: 0xffd23f,
      outfit: 0x2b2d42, outfit2: 0x7b61ff, accessory: 'pauldrons', accColor: 0xd9d9e8,
      weapon: 'spear',
    },
    skills: [
      { id: 'sd_thrust', name: 'Lôi Thương Đâm', combo: 'J', mana: 0, cd: 0.38, lock: 0.3, instant: true,
        type: 'melee', range: 3.3, arc: 0.7, dmg: 7, kb: 4, delay: 0.1, lunge: 5, pose: 'thrust',
        fx: { color: 0xc77dff, kind: 'slash' } },
      { id: 'sd_bolt', name: 'Lôi Tiễn', combo: 'K', mana: 9, cd: 0.7, lock: 0.25,
        type: 'projectile', speed: 44, radius: 0.4, range: 30, dmg: 9, kb: 2.5, count: 1, spread: 0, pierce: true, delay: 0.08, pose: 'throw',
        fx: { color: 0xb388ff, core: 0xfff3a0, kind: 'bolt' } },
      { id: 'sd_flash', name: 'Lôi Ảnh Bộ', combo: 'JK', mana: 18, cd: 3.2, lock: 0.4,
        type: 'dash', dist: 10, dur: 0.18, radius: 1.3, dmg: 16, kb: 8, kbUp: 3, delay: 0.06, pose: 'thrust', invuln: true,
        fx: { color: 0xd0a8ff, core: 0xfff3a0, kind: 'thunderDash' } },
      { id: 'sd_ring', name: 'Lôi Võng Trận', combo: 'KL', mana: 30, cd: 7.5, lock: 0.8, root: true,
        type: 'aoe', at: 'self', radius: 4.8, dmg: 8, kb: 3, kbUp: 2, ticks: 3, tickInt: 0.3, delay: 0.3, pose: 'raise',
        stun: 0.5,
        fx: { color: 0xb388ff, core: 0xfff3a0, kind: 'thunderRing' } },
      { id: 'sd_spear', name: 'Lôi Long Xuyên', combo: 'JKL', mana: 65, cd: 13, lock: 0.8, root: true,
        type: 'projectile', speed: 40, radius: 0.8, range: 26, dmg: 18, kb: 5, count: 1, spread: 0, delay: 0.45, pose: 'throw',
        // thương sét cắm vào đối thủ đầu tiên (hoặc tường / hết tầm), Shiden dịch chuyển tới đó, nổ sét làm choáng
        teleport: { radius: 4.2, dmg: 22, kb: 10, kbUp: 6, stun: 0.6 },
        steer: { mode: 'homing', turn: 2.6 },
        fx: { color: 0xc77dff, core: 0xfff7c2, kind: 'bolt' } },
      { id: 'sd_fin', name: 'Lôi Thương Toàn Kích', combo: 'JJJ', chain: true, mana: 0, cd: 1, lock: 0.45,
        type: 'melee', range: 4.2, arc: 0.55, dmg: 11, kb: 6, delay: 0.14, lunge: 6, pose: 'thrust',
        marks: 2,                                         // thêm 2 dấu điện
        fx: { color: 0xc77dff, kind: 'slash' } },
    ],
  },
  {
    id: 'midori',
    name: 'Midori',
    title: 'Mộc Linh Sư',
    desc: 'Pháp sư cây cỏ: gai độc làm chậm, rễ cây và bẫy hạt giống trói chân, tuyệt kỹ mọc cây thần chắn đạn và hồi máu cho đồng đội.',
    speedMul: 0.98,
    hp: 145,               // máu tối đa
    look: {
      skin: 0xfff1e0, hair: 0x95d5b2, hairStyle: 'braids', eye: 0x2d6a4f,
      outfit: 0xf1faee, outfit2: 0x52b788, accessory: 'flowerCrown', accColor: 0xff8fab,
      weapon: 'branch',
    },
    skills: [
      { id: 'md_vine', name: 'Đằng Tiên Quất', combo: 'J', mana: 0, cd: 0.36, lock: 0.3, instant: true,
        type: 'melee', range: 3.0, arc: 1.0, dmg: 6, kb: 3, delay: 0.12, lunge: 2, pose: 'slash',
        fx: { color: 0x80ed99, kind: 'slash' } },
      { id: 'md_thorn', name: 'Gai Độc Phi Châm', combo: 'K', mana: 8, cd: 0.6, lock: 0.3,
        type: 'projectile', speed: 30, radius: 0.4, range: 26, dmg: 4, kb: 1.5, count: 3, spread: 0.1, delay: 0.1, pose: 'push',
        slow: { mul: 0.8, dur: 0.8 },
        fx: { color: 0x57cc99, core: 0xc7f9cc, kind: 'thorn' } },
      { id: 'md_roots', name: 'Rễ Thần Trói Buộc', combo: 'JK', mana: 22, cd: 5, lock: 0.55, root: true,
        type: 'line', start: 2, spacing: 2.0, count: 7, interval: 0.07, radius: 1.3, dmg: 12, kb: 1, kbUp: 3, delay: 0.15, pose: 'slam',
        stun: 0.8,
        fx: { color: 0x6a994e, core: 0xb5e48c, kind: 'vineSpike', spike: 0x588157, spikeGlow: 0x1b4332 } },
      { id: 'md_seed', name: 'Gieo Hạt Trói Thân', combo: 'KL', mana: 22, cd: 4, lock: 0.4,
        // bẫy hạt giống: tồn tại 15 giây, tối đa 3 bẫy; đối thủ giẫm vào bị trói (choáng) và mất máu
        type: 'trap', offset: 3.5, radius: 1.7, arm: 0.6, dur: 15, max: 3, dmg: 12, kb: 0, kbUp: 3, delay: 0.15, pose: 'slam',
        stun: 1.3,
        fx: { color: 0x80ed99, core: 0xffafcc, kind: 'seedTrap' } },
      { id: 'md_tree', name: 'Thần Mộc Giáng Thế', combo: 'JKL', mana: 65, cd: 15, lock: 0.9, root: true,
        // cây thần mọc lên hất tung đối thủ, đứng 9 giây: chắn đạn và hồi máu cho bạn + đồng đội đứng gần
        type: 'summon', offset: 6, radius: 3.5, dmg: 20, kb: 6, kbUp: 8, delay: 0.5, dur: 9, pose: 'raise',
        obstacle: { r: 1.8, h: 7 }, aura: { radius: 6, heal: 3, every: 0.5 },
        fx: { color: 0x52b788, core: 0xb7e4c7, kind: 'tree' } },
      { id: 'md_fin', name: 'Đằng Mạn Triền Thân', combo: 'JJJ', chain: true, mana: 0, cd: 1, lock: 0.45,
        type: 'melee', range: 3.4, arc: 1.2, dmg: 8, kb: 1, delay: 0.14, lunge: 2, pose: 'slash',
        stun: 0.5,
        fx: { color: 0x80ed99, kind: 'slash' } },
    ],
  },
  {
    id: 'gantetsu',
    name: 'Gantetsu',
    title: 'Thiết Quyền Hộ Vệ',
    desc: 'Võ sĩ đá to con nhiều máu: giáp đá giảm 40% sát thương, tuyệt kỹ nhảy tới chỗ tâm ngắm đập đất và dựng cột đá.',
    speedMul: 0.92,
    hp: 165,               // máu tối đa
    look: {
      skin: 0xe0a979, hair: 0x3d2b1f, hairStyle: 'mohawk', eye: 0x8d5524,
      outfit: 0x6b705c, outfit2: 0x3f4238, accessory: 'belt', accColor: 0xbc6c25,
      weapon: 'gauntlet', scale: 1.12,
    },
    skills: [
      { id: 'gt_punch', name: 'Thiết Quyền', combo: 'J', mana: 0, cd: 0.45, lock: 0.36, instant: true,
        type: 'melee', range: 2.3, arc: 1.0, dmg: 8, kb: 6, delay: 0.12, lunge: 3, pose: 'punch',
        fx: { color: 0xe9c46a, kind: 'impact' } },
      { id: 'gt_rock', name: 'Phi Thạch', combo: 'K', mana: 12, cd: 1.2, lock: 0.4,
        type: 'projectile', speed: 22, radius: 0.9, range: 26, dmg: 10, kb: 7, count: 1, spread: 0, delay: 0.2, pose: 'throw',
        explode: { radius: 2.6, dmg: 4, kb: 6, kbUp: 4 },
        fx: { color: 0xa47148, core: 0xe9c46a, kind: 'rock' } },
      { id: 'gt_charge', name: 'Thiết Kiên Xung', combo: 'JK', mana: 20, cd: 4, lock: 0.5, root: true,
        type: 'dash', dist: 7, dur: 0.35, radius: 1.6, dmg: 20, kb: 15, kbUp: 4, delay: 0.12, pose: 'thrust', invuln: true,
        fx: { color: 0xd4a373, core: 0xffd166, kind: 'rockRoll' } },
      { id: 'gt_skin', name: 'Thiết Bích Thân', combo: 'KL', mana: 26, cd: 12, lock: 0.35,
        // giáp đá: 4 giây giảm 40% sát thương nhận vào, không bị đẩy lùi, không bị choáng
        type: 'buff', dur: 4, dmgTaken: 0.6, noKb: true, delay: 0.1, pose: 'raise',
        fx: { color: 0xd4a373, core: 0xfefae0, kind: 'stoneSkin' } },
      { id: 'gt_leap', name: 'Sơn Băng Địa Liệt', combo: 'JKL', mana: 65, cd: 14, lock: 1.0, root: true,
        // nhảy vọt tới điểm tâm ngắm (tối đa 14 m), đáp xuống làm choáng và dựng vòng cột đá 6 giây
        type: 'leap', range: 14, dur: 0.7, delay: 0.25, radius: 5, dmg: 30, kb: 8, kbUp: 8, pose: 'raise',
        stun: 0.8,
        walls: { count: 6, ring: 5.2, r: 0.9, h: 2.6, dur: 6 },
        fx: { color: 0xd4a373, core: 0xffd166, kind: 'quakeLeap' } },
      { id: 'gt_fin', name: 'Địa Liệt Quyền', combo: 'JJJ', chain: true, mana: 0, cd: 1, lock: 0.5,
        type: 'aoe', at: 'self', radius: 3.2, dmg: 13, kb: 4, kbUp: 6, ticks: 1, tickInt: 0, delay: 0.2, pose: 'slam',
        fx: { color: 0xd4a373, core: 0xfefae0, kind: 'quake', crystal: 0x9c6644, crystalGlow: 0x3b2414, noCircle: true } },
    ],
  },
  {
    id: 'kage',
    name: 'Kage',
    title: 'Ảnh Sát Thủ',
    desc: 'Sát thủ bóng tối nhanh nhất, ít máu nhất: tàng hình, dịch chuyển tới chỗ phi đao cắm, đòn kết đâm sau lưng gây gấp đôi sát thương.',
    speedMul: 1.12,
    hp: 120,               // máu tối đa
    look: {
      skin: 0xf5d5c0, hair: 0x22223b, hairStyle: 'hooded', eye: 0xe0aaff,
      outfit: 0x1b1b2f, outfit2: 0x5a189a, accessory: 'mask', accColor: 0x2b2d42,
      weapon: 'dagger',
    },
    skills: [
      { id: 'kg_slash', name: 'Ảnh Trảm', combo: 'J', mana: 0, cd: 0.24, lock: 0.22, instant: true,
        type: 'melee', range: 2.3, arc: 1.3, dmg: 5, kb: 2.5, delay: 0.07, lunge: 5, pose: 'slash',
        fx: { color: 0x9d4edd, kind: 'slash' } },
      { id: 'kg_knives', name: 'Ảnh Phi Đao', combo: 'K', mana: 7, cd: 0.5, lock: 0.25,
        type: 'projectile', speed: 36, radius: 0.35, range: 26, dmg: 6, kb: 2, count: 2, spread: 0.12, delay: 0.06, pose: 'throw',
        mark: 4,                                          // phi đao để lại dấu bóng 4 giây (Thuấn Ảnh dịch chuyển tới đó)
        fx: { color: 0x7b2cbf, core: 0xe0aaff, kind: 'shuriken' } },
      { id: 'kg_blink', name: 'Thuấn Ảnh Bộ', combo: 'JK', mana: 16, cd: 3.2, lock: 0.3,
        // dịch chuyển tới dấu phi đao gần nhất (trong 24 m); không có dấu thì lướt bóng 8 m. Tới nơi chém quanh mình
        type: 'blink', dist: 8, markRange: 24, radius: 2.2, dmg: 14, kb: 6, kbUp: 2, delay: 0.08, pose: 'thrust',
        fx: { color: 0x5a189a, core: 0xe0aaff, kind: 'shadowStep' } },
      { id: 'kg_stealth', name: 'Ẩn Thân Thuật', combo: 'KL', mana: 24, cd: 10, lock: 0.25,
        // tàng hình 3.5 giây: đối thủ không thấy, không khoá mục tiêu được; đòn đầu tiên khi đang ẩn gây ×1.6
        type: 'buff', dur: 3.5, stealth: true, nextHitMul: 1.6, delay: 0.05, pose: 'spin',
        fx: { color: 0x3c096c, core: 0xc77dff, kind: 'stealth' } },
      { id: 'kg_lotus', name: 'Hắc Liên Loạn Trảm', combo: 'JKL', mana: 65, cd: 12, lock: 0.9, root: true,
        type: 'aoe', at: 'front', offset: 6, radius: 4, dmg: 6, kb: 2, pull: 3, ticks: 10, tickInt: 0.2, delay: 0.35, pose: 'spin',
        steer: { mode: 'follow', speed: 8, range: 18 },   // vòng xoáy hắc đao lao theo tâm
        fx: { color: 0xb5179e, core: 0xf0c3ff, kind: 'bladeStorm' } },
      { id: 'kg_fin', name: 'Bối Ảnh Thích', combo: 'JJJ', chain: true, mana: 0, cd: 1, lock: 0.4,
        type: 'melee', range: 2.4, arc: 1.0, dmg: 8, kb: 3, delay: 0.08, lunge: 6, pose: 'thrust',
        backstab: 2.2,                                    // đâm trúng sau lưng: ×2.2 sát thương
        fx: { color: 0x9d4edd, kind: 'slash' } },
    ],
  },
];

// ======================= Dị biến (trạng thái siêu cấp) =======================
// Thanh dị biến đầy (shared/config.js → AWAKEN) thì bấm L L để biến hình trong AWAKEN.dur giây.
// Khi biến hình cả 6 chiêu đổi sang bộ awaken.skills (cùng phím combo), có nội tại riêng (awaken.passive):
//   speed (hệ số tốc chạy thay cho AWAKEN.speedMul), dashCd (hồi lướt né), dmgTaken, noKb, noStun,
//   burn {dmg, every, dur} (đốt), frost {stacks, window, stun, immune} (đóng băng cộng dồn),
//   chargeStacks (số dấu điện cần), lifesteal (hút máu), backAll (mọi đòn sau lưng ×)
// Kiểu chiêu chỉ có ở dạng dị biến: wall (tường chắn đạn), smite (sét đánh mọi đối thủ trong tầm),
// multiblink (lướt chém lần lượt nhiều đối thủ), pillar (dựng cột đá), quake (động đất cả sân), decoy (phân thân mồi),
// icewall (tường băng vỡ được), timezone (vùng ngưng đọng), turret (cây bắn gai), pet (người cây Mộc Thần).
// Trường dị biến v2 đợt 2–3: fireZone / fireTrail / ignite / revive / boomerang (Homura), iceAt / iceTrail / iceSpeed (Yuki),
// hold (giữ phím tụ lực, holdSkill) / grab (túm ném) (Raiga), swap / dark (Kage).
// Công trình (server: room.props, client: game.props) là vật có máu, đối thủ đánh phá được: cọc sét (rod), cột đá (pillar).
// Trường dị biến v2: rod (đạn cắm thành cọc), toRod (blink tới cọc), rodPulse (aoe phóng thêm ở từng cọc),
// rodDmg/rodRange (smite có thêm tia từ cọc), rip (nhổ cột đá ném), free3d (lướt theo cả chiều dọc), clone (phân thân
// gió chém lại), lift (tường gió đẩy bay lên), steer.fly (lái cả độ cao). Thêm vào chiêu có sẵn: seek (đạn tự tìm), bounce (sét nảy),
// multi/multiInt (lướt đánh nhiều nhịp), echo (phân thân chém theo), follow (vùng bám theo người),
// walls (aoe dựng cột đá), height (độ cao cú nhảy), behind (dịch chuyển ra sau lưng), invuln (buff bất tử),
// bigCharge (tuyệt kỹ tụ lực lâu, hiệu ứng tích lũy lớn).
// Đòn kết JJJ khi dị biến: bản mạnh hơn của đòn kết thường.
function finA(c, over) {
  const b = c.skills.find(s => s.chain);
  return { ...b, ...over, id: b.id + '_a', name: b.name + ' · Cực', dmg: Math.round(b.dmg * 1.5), fx: { ...b.fx, ...(over.fx || {}) } };
}

const AWAKEN = {
  kaze: c => ({
    name: 'Phong Thần Hóa', form: 'windGod', color: 0x7fffe8, core: 0xffffff,
    desc: 'Khăn tách thành 4 dải gió. Bay tự do không tốn mana (giữ Space, cao tối đa 10 m, thả ra thì lượn chậm xuống), ra chiêu được giữa không trung. Chạy nhanh hơn 25%, lướt né hồi nhanh gấp đôi; đang ở trên không thì nhận thêm 15% sát thương.',
    look: { hair: 0xc8fff6, eye: 0x39ff9f, outfit: 0x1a3a4a },
    // freeFly: bay không tốn mana (max: độ cao tối đa, rise: tốc độ bay lên, glide: tốc độ rơi tối đa khi lượn)
    // airTaken: hệ số sát thương nhận vào khi đang ở trên không
    passive: { speed: 1.25, dashCd: 0.35, freeFly: { max: 10, rise: 6, glide: -2.5 }, airTaken: 1.15 },
    skills: [
      { id: 'kz_a_blade', name: 'Phong Nhận', combo: 'J', mana: 0, cd: 0.3, lock: 0.26, instant: true,
        type: 'projectile', speed: 36, radius: 0.6, range: 9, dmg: 7, kb: 3, count: 1, spread: 0, pierce: true, delay: 0.08, pose: 'slash',
        fx: { color: 0x9ff7ee, core: 0xffffff, kind: 'windBlade' } },
      { id: 'kz_a_fan', name: 'Bão Phi Tiêu', combo: 'K', mana: 10, cd: 0.7, lock: 0.3,
        type: 'projectile', speed: 32, radius: 0.45, range: 30, dmg: 5, kb: 3, count: 5, spread: 0.16, seek: 6, delay: 0.1, pose: 'throw',
        fx: { color: 0x7fffe8, core: 0xffffff, kind: 'shuriken' } },
      { id: 'kz_a_step', name: 'Phong Ảnh Bộ', combo: 'JK', mana: 18, cd: 2.6, lock: 0.4,
        // lướt 3 chiều theo hướng ngắm (lên trời, bổ xuống, chéo); lướt xuyên qua ai thì 0.4 giây sau phân thân gió chém thêm 1 nhát
        type: 'dash', free3d: true, dist: 12, dur: 0.3, radius: 1.8, dmg: 16, kb: 3, kbUp: 5, delay: 0.08, pose: 'thrust', invuln: true,
        clone: { delay: 0.4, radius: 2.8, dmg: 12, kb: 6, kbUp: 4 },
        fx: { color: 0x66e0ff, core: 0xffffff, kind: 'windDash' } },
      { id: 'kz_a_wall', name: 'Thiên Phong Bích', combo: 'KL', mana: 22, cd: 7, lock: 0.35,
        // tường gió 7 m trước mặt trong 4 giây: chặn đạn của đối thủ (đạn của mình bay xuyên), hất văng người đứng sát;
        // Kaze (và đồng đội) bước vào chân tường thì được luồng gió đẩy bay vọt lên (lift)
        type: 'wall', offset: 3, width: 7, height: 4.5, dur: 4, segs: 5, segR: 0.9, dmg: 10, kb: 11, kbUp: 4, delay: 0.12, pose: 'push', lift: 13,
        fx: { color: 0x9ff7ee, core: 0xffffff, kind: 'windWall' } },
      { id: 'kz_a_dragon', name: 'Phong Long Thiên Hành', combo: 'JKL', mana: 60, cd: 13, lock: 3.5, root: true, bigCharge: true,
        // tụ gió 1.3 giây rồi cưỡi rồng lốc lao đi 2.2 giây, lái theo tâm cả hướng lẫn độ cao (ngẩng camera để bay lên,
        // nhìn xuống đất để bổ nhào); cuốn mọi người trên đường đi nhiều nhịp
        type: 'dash', dist: 26, dur: 2.2, radius: 3.2, dmg: 12, kb: 3, kbUp: 7, multi: 6, multiInt: 0.3, delay: 1.3, pose: 'raise',
        steer: { mode: 'turn', turn: 3.2, fly: { max: 9, rate: 7 } },
        fx: { color: 0x7ff5e0, core: 0xe8fffb, kind: 'dragonTornado' } },
      finA(c, { speed: 50, fx: { color: 0xc8fff6 } }),
    ],
  }),
  raiga: c => ({
    name: 'Bạo Khí Thân', form: 'magma', color: 0xff7b00, core: 0xfff3b0,
    desc: 'Da nứt vân dung nham, hai tay bọc găng khí khổng lồ. Giữ phím K / K L để tụ khí: giữ càng lâu đạn và chưởng càng to, càng mạnh. J K lao tới túm đối thủ, nhấc lên quật xuống rồi ném đi. Không bị đẩy lùi, giảm 15% sát thương nhận vào.',
    look: { hair: 0x2b1d14, skin: 0xffb48a, outfit: 0x7a1f00, outfit2: 0x1a0a05, aura: 0xff7b00 },
    passive: { noKb: true, dmgTaken: 0.85 },
    skills: [
      { id: 'rg_a_fist', name: 'Khí Quyền', combo: 'J', mana: 0, cd: 0.28, lock: 0.24, instant: true,
        type: 'projectile', speed: 40, radius: 0.65, range: 7, dmg: 7, kb: 4, count: 1, spread: 0, delay: 0.06, pose: 'punch',
        fx: { color: 0xffa94d, core: 0xfff3b0, kind: 'kiFist' } },
      { id: 'rg_a_ki', name: 'Tụ Khí Đạn', combo: 'K', mana: 7, cd: 0.35, lock: 0.22,
        // chạm để bắn nhanh; giữ phím để tụ quả cầu lớn dần (tối đa 1.5 giây: sát thương ×2.2, to ×1.9, nổ rộng hơn)
        type: 'projectile', speed: 34, radius: 0.6, range: 30, dmg: 8, kb: 3, count: 1, spread: 0, delay: 0.06, pose: 'push',
        explode: { radius: 2.4, dmg: 5, kb: 5, kbUp: 3 },
        hold: { max: 1.5, dmg: 2.2, size: 1.9 },
        fx: { color: 0xff922b, core: 0xfff3b0, kind: 'kiBlast' } },
      { id: 'rg_a_grab', name: 'Bạo Trảo Quăng', combo: 'JK', mana: 18, cd: 3.5, lock: 0.5,
        // lao tới túm đối thủ đầu tiên trúng: nhấc lên, quật xuống đất (14 + choáng 0.6 giây) rồi ném văng theo hướng nhìn (12).
        // Không túm được người đang bất tử / không bị đẩy lùi
        type: 'dash', dist: 9, dur: 0.3, radius: 1.6, dmg: 6, kb: 0, kbUp: 0, delay: 0.06, pose: 'punch', invuln: true,
        grab: { dur: 0.9, slam: 0.45, slamDmg: 14, stun: 0.6, throwDmg: 12, kb: 22, kbUp: 9 },
        fx: { color: 0xff922b, core: 0xfff3b0, kind: 'flurry' } },
      { id: 'rg_a_wave', name: 'Bạo Long Chưởng', combo: 'KL', mana: 40, cd: 8, lock: 2.6, root: true,
        // chưởng dài 2 giây, xoay chuột để quét tia theo tâm ngắm
        type: 'beam', length: 30, width: 1.5, dmg: 4, tickInt: 0.12, dur: 2.0, kb: 3, delay: 0.55, pose: 'beam',
        steer: { mode: 'aim', turn: 1.4 },
        hold: { max: 1.2, dmg: 1.8, size: 1.8 },          // giữ L để tụ: tia to và mạnh hơn
        fx: { color: 0xff6b00, core: 0xfff3b0, kind: 'beam' } },
      { id: 'rg_a_burst', name: 'Bách Liệt Bạo Quyền', combo: 'JKL', mana: 65, cd: 13, lock: 2.0, root: true, bigCharge: true,
        // tụ khí 1.3 giây, lao chậm 7 m đấm loạn 5 nhịp rồi nổ khí tung đối thủ lên trời
        type: 'dash', dist: 7, dur: 0.6, radius: 2.2, dmg: 7, kb: 1, kbUp: 1, multi: 5, multiInt: 0.1, delay: 1.3, pose: 'punch',
        explode: { radius: 5, dmg: 34, kb: 10, kbUp: 18 },
        steer: { mode: 'turn', turn: 3 },
        fx: { color: 0xff7b00, core: 0xfff3b0, kind: 'flurry', big: true } },
      finA(c, { kbUp: 14, fx: { color: 0xff922b } }),
    ],
  }),
  homura: c => ({
    name: 'Viêm Hoàng Giáp', form: 'flameEmpress', color: 0xff5400, core: 0xffd60a,
    desc: 'Giáp lửa, đôi cánh lửa sau lưng. Mọi đòn đánh gây bỏng; bước chạy và đòn chém để lại vệt lửa trên sàn 3 giây (đối thủ đứng vào bị bỏng, Homura đứng trên lửa hồi mana nhanh). Gục khi đang biến hình thì hồi sinh 1 lần tại chỗ với 30% máu.',
    look: { hair: 0xff4d00, outfit: 0x3d0000, outfit2: 0xff7b00, accColor: 0xffd60a },
    // fireTrail: vệt lửa theo bước chạy (r bán kính, dur giây, gap khoảng cách giữa 2 vệt, mana: hồi thêm mỗi giây khi đứng trên lửa)
    // revive: gục khi đang dị biến thì sống lại với tỉ lệ máu này (hết dị biến)
    passive: { burn: { dmg: 2, every: 0.5, dur: 2 }, fireTrail: { r: 1.3, dur: 3, gap: 1.6, mana: 8 }, revive: 0.3 },
    skills: [
      { id: 'hm_a_slash', name: 'Viêm Hoàng Trảm', combo: 'J', mana: 0, cd: 0.34, lock: 0.28, instant: true,
        type: 'melee', range: 3.4, arc: 1.5, dmg: 8, kb: 3, delay: 0.1, lunge: 4, pose: 'slash',
        fireZone: { r: 1.7, dur: 3, off: 2.2 },          // vệt lửa nằm lại trên sàn theo cung chém
        fx: { color: 0xff7b00, core: 0xffd60a, kind: 'flameSlash' } },
      { id: 'hm_a_boomer', name: 'Hồi Nguyệt Viêm', combo: 'K', mana: 10, cd: 1.0, lock: 0.35,
        // trăng lửa bay đi 13 m rồi quay về tay Homura như boomerang, trúng được cả lượt đi lẫn lượt về
        type: 'projectile', speed: 24, radius: 1.0, range: 13, dmg: 9, kb: 3, count: 1, spread: 0, pierce: true, boomerang: true, delay: 0.12, pose: 'slash',
        fx: { color: 0xff5400, core: 0xffd60a, kind: 'crescent' } },
      { id: 'hm_a_dive', name: 'Viêm Long Trụy', combo: 'JK', mana: 20, cd: 4, lock: 0.7,
        // bay vọt lên rồi bổ xuống điểm tâm ngắm
        type: 'leap', range: 10, dur: 0.5, height: 4, delay: 0.12, radius: 3.2, dmg: 24, kb: 6, kbUp: 9, pose: 'slam',
        fireZone: { r: 4, dur: 3.5 },                    // chỗ đáp thành vũng lửa lớn
        fx: { color: 0xff6d00, core: 0xffea00, kind: 'flameDive' } },
      { id: 'hm_a_ring', name: 'Hỏa Luân Trận', combo: 'KL', mana: 28, cd: 7, lock: 0.5,
        // vòng lửa bám theo người 1.5 giây
        type: 'aoe', at: 'self', follow: true, radius: 4.2, dmg: 6, kb: 2, kbUp: 1, ticks: 6, tickInt: 0.25, delay: 0.2, pose: 'spin',
        fx: { color: 0xff5400, core: 0xffd60a, kind: 'flameRing' } },
      { id: 'hm_a_phoenix', name: 'Phượng Hoàng Niết Bàn', combo: 'JKL', mana: 65, cd: 13, lock: 2.3, root: true, bigCharge: true,
        // phượng hoàng lao theo tâm rồi nổ; mọi vệt lửa của Homura trên sàn cùng bùng thành cột lửa (ignite)
        type: 'dash', dist: 24, dur: 0.9, radius: 3, dmg: 32, kb: 12, kbUp: 7, delay: 1.3, pose: 'thrust',
        explode: { radius: 7, dmg: 22, kb: 14, kbUp: 9 },
        ignite: { dmg: 16, kb: 3, kbUp: 9 },
        steer: { mode: 'turn', turn: 4.5 },
        fx: { color: 0xff5400, core: 0xfff3b0, kind: 'phoenix', scale: 1.7 } },
      finA(c, { radius: 3.8, fx: { color: 0xff5400 } }),
    ],
  }),
  yuki: c => ({
    name: 'Băng Hậu', form: 'iceQueen', color: 0x8ecae6, core: 0xffffff,
    desc: 'Vương miện và áo choàng băng tinh. Chiêu đóng băng mặt sàn: đối thủ đứng trên băng bị trơn trượt, khó dừng và khó đổi hướng; Yuki trên băng chạy nhanh hơn 30%. Trúng đòn 3 lần trong 3 giây thì đối thủ bị đóng băng 1 giây.',
    look: { hair: 0xffffff, eye: 0x7df9ff, outfit: 0xbde0fe, outfit2: 0xe8f6ff, accColor: 0x90e0ef },
    // iceSpeed: hệ số tốc chạy của Yuki khi đứng trên băng của mình
    passive: { frost: { stacks: 3, window: 3, stun: 1.0, immune: 2.5 }, iceSpeed: 1.3 },
    skills: [
      { id: 'yk_a_bolt', name: 'Băng Tinh Đạn', combo: 'J', mana: 0, cd: 0.34, lock: 0.28, instant: true,
        type: 'projectile', speed: 34, radius: 0.45, range: 14, dmg: 7, kb: 2, count: 1, spread: 0, delay: 0.08, pose: 'slash',
        slow: { mul: 0.8, dur: 0.8 },
        iceAt: { r: 1.6, dur: 4 },                       // chỗ đạn trúng / rơi đóng băng sàn
        fx: { color: 0xa0e7ff, core: 0xffffff, kind: 'iceShard' } },
      { id: 'yk_a_lance', name: 'Băng Thương Xuyên', combo: 'K', mana: 10, cd: 0.85, lock: 0.3,
        type: 'projectile', speed: 34, radius: 0.55, range: 28, dmg: 9, kb: 2, count: 3, spread: 0.14, pierce: true, delay: 0.1, pose: 'push',
        slow: { mul: 0.7, dur: 1.2 },
        fx: { color: 0x90e0ef, core: 0xffffff, kind: 'iceLance' } },
      { id: 'yk_a_skate', name: 'Băng Hoạt Bộ', combo: 'JK', mana: 16, cd: 3, lock: 0.45,
        type: 'dash', dist: 10, dur: 0.35, radius: 1.7, dmg: 16, kb: 4, kbUp: 4, delay: 0.08, pose: 'thrust', invuln: true,
        slow: { mul: 0.55, dur: 1.6 },
        iceTrail: { r: 1.5, dur: 5, gap: 1.5 },          // đường trượt để lại vệt băng
        fx: { color: 0x9bf6ff, core: 0xffffff, kind: 'iceSkate' } },
      { id: 'yk_a_wall', name: 'Băng Tường', combo: 'KL', mana: 26, cd: 8, lock: 0.4,
        // tường băng cong 5 đoạn ở 4 m phía trước, 7 giây: chắn đường và chắn đạn của cả hai bên, đối thủ đứng sát bị hất ra.
        // Mỗi đoạn 25 máu: đối thủ đập vỡ thì mảnh băng bắn ra làm chậm người đứng gần
        type: 'icewall', offset: 4, width: 8, segs: 5, curve: 1.4, r: 0.95, h: 3, hp: 25, dur: 7, dmg: 8, kb: 6, kbUp: 3, delay: 0.25, pose: 'raise',
        shatter: { radius: 2.6, dmg: 6, slow: { mul: 0.5, dur: 1.5 } },
        fx: { color: 0x9bf6ff, core: 0xffffff, kind: 'iceWall' } },
      { id: 'yk_a_time', name: 'Thời Băng Giới', combo: 'JKL', mana: 60, cd: 14, lock: 1.6, root: true, bigCharge: true,
        // tụ băng 1.3 giây rồi đóng băng thời gian vùng 10 m quanh mình trong 4 giây: đối thủ và đạn của đối thủ
        // đi vào bị chậm 60%, sàn trong vùng thành băng, cứ 0.5 giây mất máu; hết giờ băng vỡ tung làm choáng
        type: 'timezone', radius: 10, dur: 4, tickInt: 0.5, dmg: 4, kb: 0, kbUp: 0.5, slowMul: 0.4, delay: 1.3, pose: 'raise',
        slow: { mul: 0.6, dur: 0.6 }, endDmg: 22, endStun: 0.8,
        fx: { color: 0x8ecae6, core: 0xffffff, kind: 'timeFreeze' } },
      finA(c, { fx: { color: 0xd8f6ff } }),
    ],
  }),
  shiden: c => ({
    name: 'Lôi Kỵ Thần', form: 'thunderGod', color: 0xc77dff, core: 0xfff3a0,
    desc: 'Giáp sáng điện, sét bám quanh người. Phóng thương cắm xuống đất thành cọc sét (tối đa 3), hai cọc gần nhau nối thành hàng rào điện; dịch chuyển tới cọc, tuyệt kỹ cho mọi cọc cùng phóng sét. Chỉ cần 2 dấu điện là sét nảy.',
    look: { hair: 0xe0d4ff, eye: 0xfff3a0, outfit: 0x3c1a78, accColor: 0xffe066 },
    passive: { chargeStacks: 2 },
    skills: [
      { id: 'sd_a_thrust', name: 'Lôi Thần Thương', combo: 'J', mana: 0, cd: 0.36, lock: 0.3, instant: true,
        type: 'melee', range: 4.6, arc: 0.6, dmg: 9, kb: 4, delay: 0.1, lunge: 5, pose: 'thrust',
        fx: { color: 0xd0a8ff, kind: 'slash' } },
      { id: 'sd_a_rod', name: 'Lôi Trụ Thương', combo: 'K', mana: 12, cd: 0.9, lock: 0.3,
        // phóng thương sét: trúng người thì gây sát thương, không trúng thì cắm xuống chỗ rơi thành cọc sét
        // (8 giây, 30 máu, tối đa 3 cọc). Hai cọc cách nhau dưới 10 m nối thành hàng rào điện:
        // đối thủ đi xuyên qua bị 8 sát thương + 1 dấu điện (mỗi 0.7 giây), nhảy qua thì né được
        type: 'projectile', speed: 42, radius: 0.5, range: 20, dmg: 13, kb: 3, count: 1, spread: 0, delay: 0.1, pose: 'throw',
        rod: { dur: 8, max: 3, hp: 30, fence: { range: 10, dmg: 8, cd: 0.7, w: 0.8, h: 2.2 } },
        fx: { color: 0xb388ff, core: 0xfff3a0, kind: 'spearRod' } },
      { id: 'sd_a_jump', name: 'Lôi Độn', combo: 'JK', mana: 14, cd: 1.6, lock: 0.3,
        // dịch chuyển tới cọc sét gần tâm ngắm nhất (trong 30 m); không có cọc thì dịch chuyển 10 m về phía trước.
        // Tới nơi sét giáng xuống quanh mình
        type: 'blink', toRod: 30, dist: 10, markRange: 0, radius: 3, dmg: 16, kb: 7, kbUp: 4, delay: 0.1, pose: 'thrust',
        stun: 0.3,
        fx: { color: 0xd0a8ff, core: 0xfff3a0, kind: 'thunderStep' } },
      { id: 'sd_a_net', name: 'Lôi Võng Thiên La', combo: 'KL', mana: 30, cd: 7.5, lock: 0.8, root: true,
        // lưới sét 6 m kéo đối thủ vào giữa; mọi cọc sét trong 16 m cũng phóng vòng sét 3.5 m kéo người về phía cọc
        type: 'aoe', at: 'self', radius: 6, dmg: 8, kb: 0, pull: 5, kbUp: 1, ticks: 3, tickInt: 0.3, delay: 0.3, pose: 'raise',
        stun: 0.5,
        rodPulse: { range: 16, radius: 3.5, pull: 3 },
        fx: { color: 0xb388ff, core: 0xfff3a0, kind: 'thunderRing' } },
      { id: 'sd_a_judge', name: 'Thiên Lôi Phán Quyết', combo: 'JKL', mana: 65, cd: 13, lock: 1.7, root: true, bigCharge: true,
        // tụ sét 1.4 giây rồi giáng sét xuống mọi đối thủ trong 22 m; mỗi dấu điện trên người thêm 10 sát thương.
        // Đồng thời mỗi cọc sét phóng thêm 1 tia (14 sát thương) vào đối thủ gần nó nhất trong 9 m
        type: 'smite', range: 22, delay: 1.4, dmg: 30, perMark: 10, kb: 2, kbUp: 6, stun: 0.8, pose: 'raise',
        rodDmg: 14, rodRange: 9,
        fx: { color: 0xc77dff, core: 0xfff7c2, kind: 'judgement' } },
      finA(c, { fx: { color: 0xe0c3ff } }),
    ],
  }),
  midori: c => ({
    name: 'Hồn Rừng', form: 'forestSoul', color: 0x52b788, core: 0xffafcc,
    desc: 'Hoa lá mọc khắp thân, sừng cành cây trên đầu. Sức mạnh nằm ở cây cối cô trồng ra: cây bắn gai tự động và người cây Mộc Thần đi theo đánh hộ. Hồi máu bằng 12% sát thương gây ra.',
    look: { hair: 0x74c69d, outfit: 0xd8f3dc, outfit2: 0x2d6a4f, accColor: 0xff4d8d },
    passive: { lifesteal: 0.12 },
    skills: [
      { id: 'md_a_whip', name: 'Gai Tiên Câu', combo: 'J', mana: 0, cd: 0.4, lock: 0.32, instant: true,
        // roi gai dài kéo đối thủ về phía mình
        type: 'melee', range: 4.8, arc: 0.55, dmg: 7, kb: 0, pull: 4, kbUp: 1, delay: 0.14, lunge: 1, pose: 'slash',
        fx: { color: 0x80ed99, kind: 'slash' } },
      { id: 'md_a_burst', name: 'Gai Hoa Nổ', combo: 'K', mana: 9, cd: 0.7, lock: 0.3,
        type: 'projectile', speed: 28, radius: 0.45, range: 26, dmg: 5, kb: 1.5, count: 3, spread: 0.14, delay: 0.1, pose: 'push',
        slow: { mul: 0.75, dur: 1 }, explode: { radius: 2.2, dmg: 4, kb: 3, kbUp: 2 },
        fx: { color: 0x57cc99, core: 0xffafcc, kind: 'thorn' } },
      { id: 'md_a_turret', name: 'Trồng Gai Đài', combo: 'JK', mana: 20, cd: 3, lock: 0.4,
        // trồng cây bắn gai ở 3 m phía trước (tối đa 2 cây, 10 giây, 40 máu): tự bắn gai làm chậm vào đối thủ gần nhất trong 12 m mỗi 0.9 giây
        type: 'turret', offset: 3, max: 2, dur: 10, hp: 40, range: 12, every: 0.9, delay: 0.3, pose: 'slam',
        shot: { id: 'md_a_tshot', name: 'Gai Đài', combo: '', mana: 0, cd: 0, lock: 0,
          type: 'projectile', speed: 30, radius: 0.4, range: 16, dmg: 5, kb: 1.5, count: 1, spread: 0, delay: 0, slow: { mul: 0.8, dur: 0.6 },
          fx: { color: 0x57cc99, core: 0xc7f9cc, kind: 'thorn' } },
        fx: { color: 0x52b788, core: 0xffafcc, kind: 'thornTurret' } },
      { id: 'md_a_garden', name: 'Hoa Viên Hồi Xuân', combo: 'KL', mana: 26, cd: 10, lock: 0.4,
        // thảm hoa nở quanh mình 5 giây: hất đối thủ, hồi máu cho bạn + đồng đội đứng trong
        type: 'summon', offset: 0, radius: 4.5, dmg: 10, kb: 3, kbUp: 4, delay: 0.3, dur: 5, pose: 'raise',
        aura: { radius: 5, heal: 3, every: 0.5 },
        fx: { color: 0xff8fab, core: 0xfff3b0, kind: 'flowerField' } },
      { id: 'md_a_treant', name: 'Mộc Thần Hộ Vệ', combo: 'JKL', mana: 65, cd: 15, lock: 1.6, root: true, bigCharge: true,
        // tụ lực 1.3 giây, người cây Mộc Thần cao 3 m trồi lên trước mặt (hất tung đối thủ quanh đó), đi theo Midori 10 giây,
        // tự đấm đối thủ gần và lấy thân chặn đạn. Đối thủ đánh gục được (130 máu)
        type: 'pet', pet: 'treant', offset: 2.5, dur: 10, radius: 4, dmg: 16, kb: 6, kbUp: 8, delay: 1.3, pose: 'raise',
        fx: { color: 0x40916c, core: 0xb7e4c7, kind: 'treantRise' } },
      finA(c, { stun: 0.7, fx: { color: 0x95d5b2 } }),
    ],
  }),
  gantetsu: c => ({
    name: 'Sơn Thần Giáp', form: 'mountain', color: 0xd4a373, core: 0xffd166,
    desc: 'Toàn thân phủ giáp đá, to lớn hơn. Dựng cột đá đứng lên được, nhổ cột đá lên ném, tuyệt kỹ động đất cả sân (ai đang đứng trên mặt đất đều bị choáng, nhảy lên kịp thì né được). Giảm 30% sát thương, không bị đẩy lùi, không bị choáng, nhưng không được tăng tốc chạy.',
    look: { skin: 0xb08968, outfit: 0x7f5539, outfit2: 0x4a3426, accColor: 0xffd166, scale: 1.3 },
    passive: { dmgTaken: 0.7, noKb: true, noStun: true, speed: 1.0 },
    skills: [
      { id: 'gt_a_quake', name: 'Chấn Sơn Quyền', combo: 'J', mana: 0, cd: 0.5, lock: 0.4, instant: true,
        // cú đấm tạo sóng chấn động hình nón
        type: 'melee', range: 4.2, arc: 0.75, dmg: 10, kb: 8, kbUp: 3, delay: 0.14, lunge: 2, pose: 'punch',
        fx: { color: 0xe9c46a, core: 0xfefae0, kind: 'quakePunch' } },
      { id: 'gt_a_boulder', name: 'Nhổ Sơn Thạch', combo: 'K', mana: 14, cd: 1.3, lock: 0.45,
        // có cột đá của mình trong 10 m: nhổ cột đó lên ném theo tâm (to, mạnh, nổ rộng hơn); không có thì ném cự thạch
        type: 'projectile', speed: 20, radius: 1.5, range: 26, dmg: 14, kb: 9, count: 1, spread: 0, delay: 0.25, pose: 'throw',
        explode: { radius: 4, dmg: 8, kb: 8, kbUp: 5 },
        rip: { range: 10, over: { radius: 1.9, dmg: 22, speed: 24, range: 28, explode: { radius: 5, dmg: 12, kb: 10, kbUp: 6 }, fx: { kind: 'pillarThrow' } } },
        fx: { color: 0xa47148, core: 0xe9c46a, kind: 'rock' } },
      { id: 'gt_a_roll', name: 'Sơn Thạch Cuộn', combo: 'JK', mana: 20, cd: 4, lock: 0.55, root: true,
        type: 'dash', dist: 11, dur: 0.4, radius: 2.0, dmg: 24, kb: 16, kbUp: 5, delay: 0.12, pose: 'thrust', invuln: true,
        fx: { color: 0xd4a373, core: 0xffd166, kind: 'rockRoll', scale: 1.45 } },
      { id: 'gt_a_pillar', name: 'Dựng Sơn Trụ', combo: 'KL', mana: 18, cd: 2.2, lock: 0.35,
        // cột đá cao 4 m trồi lên ở điểm tâm ngắm (tầm 14 m, tồn tại 10 giây, 60 máu, tối đa 3 cột):
        // chắn đường và chắn đạn, đứng lên nóc được; trồi ngay dưới chân đối thủ thì hất tung lên,
        // dưới chân mình (hoặc đồng đội) thì nâng lên nóc cột
        type: 'pillar', range: 14, delay: 0.25, r: 1.1, h: 4, dur: 10, max: 3, hp: 60, radius: 1.7, dmg: 12, kb: 2, kbUp: 14, pose: 'slam',
        fx: { color: 0xd4a373, core: 0xffd166, kind: 'stonePillar' } },
      { id: 'gt_a_world', name: 'Địa Chấn Toàn Sân', combo: 'JKL', mana: 65, cd: 14, lock: 1.9, root: true, bigCharge: true,
        // tụ lực 1.4 giây rồi dậm đất: mọi đối thủ đang đứng trên mặt đất trong 25 m bị choáng 1.2 giây và mất máu,
        // ai đang ở trên không (nhảy, bay, đứng trên cột đá) thì né được. Cột đá của Gantetsu vỡ tung bắn mảnh đá xung quanh
        type: 'quake', range: 25, delay: 1.4, dmg: 26, stun: 1.2, kb: 0, kbUp: 5, airTol: 0.5, pose: 'slam',
        shard: { radius: 3.5, dmg: 10, kb: 8, kbUp: 6 },
        fx: { color: 0xff8c42, core: 0xffd166, kind: 'groundQuake' } },
      finA(c, { radius: 4, fx: { color: 0xe9c46a } }),
    ],
  }),
  kage: c => ({
    name: 'Vạn Ảnh', form: 'thousandShadows', color: 0x9d4edd, core: 0xff4d6d,
    desc: 'Thân hóa bóng đen mắt đỏ, 2 phân thân bóng đi theo và chém cùng. Thả phân thân mồi giống hệt mình, đổi chỗ với phân thân, tuyệt kỹ phủ sương đêm: đối thủ chỉ thấy người trong 6 m. Mọi đòn đánh từ sau lưng gây ×1.5 sát thương.',
    look: { skin: 0x3c2a4d, hair: 0x10002b, eye: 0xff2d55, outfit: 0x0b0014, outfit2: 0x3c096c, accColor: 0x10002b },
    passive: { backAll: 1.5 },
    skills: [
      { id: 'kg_a_slash', name: 'Vạn Ảnh Trảm', combo: 'J', mana: 0, cd: 0.26, lock: 0.22, instant: true,
        // 2 phân thân chém theo sau mỗi nhát (50% sát thương)
        type: 'melee', range: 2.6, arc: 1.3, dmg: 5, kb: 2, delay: 0.07, lunge: 5, pose: 'slash',
        echo: { n: 2, gap: 0.1, mul: 0.5 },
        fx: { color: 0x9d4edd, kind: 'slash' } },
      { id: 'kg_a_knives', name: 'Ảnh Đao Vũ', combo: 'K', mana: 8, cd: 0.55, lock: 0.25,
        type: 'projectile', speed: 38, radius: 0.35, range: 26, dmg: 6, kb: 2, count: 5, spread: 0.12, delay: 0.06, pose: 'throw',
        mark: 4,
        fx: { color: 0x7b2cbf, core: 0xff4d6d, kind: 'shuriken' } },
      { id: 'kg_a_swap', name: 'Hoán Ảnh', combo: 'JK', mana: 14, cd: 2.6, lock: 0.3,
        // đổi chỗ với phân thân mồi gần tâm ngắm nhất (26 m); không có phân thân thì dịch chuyển ra sau lưng đối thủ gần tâm ngắm
        type: 'blink', swap: 26, behind: 16, dist: 8, markRange: 24, radius: 2.2, dmg: 18, kb: 6, kbUp: 2, delay: 0.08, pose: 'thrust',
        fx: { color: 0x5a189a, core: 0xff4d6d, kind: 'shadowStep' } },
      { id: 'kg_a_decoy', name: 'Phân Ảnh Mồi', combo: 'KL', mana: 22, cd: 8, lock: 0.2,
        // tàng hình 1 giây, đồng thời thả 2 phân thân giống hệt mình chạy chéo về phía trước (5 giây). Đối thủ nhìn như người thật,
        // chiêu tự khoá có thể nhắm nhầm. Trúng 1 đòn là tan, nổ bóng làm chậm đối thủ đứng gần
        type: 'decoy', count: 2, dur: 5, speed: 8, spread: 0.6, stealth: 1, nextHitMul: 1.5, delay: 0.05, pose: 'spin',
        pop: { radius: 3, dmg: 6, slow: { mul: 0.5, dur: 1.5 } },
        fx: { color: 0x3c096c, core: 0xff4d6d, kind: 'stealth' } },
      { id: 'kg_a_massacre', name: 'Vạn Ảnh Táng', combo: 'JKL', mana: 65, cd: 13, lock: 2.8, root: true, bigCharge: true,
        // tụ bóng 1.2 giây rồi lướt chém lần lượt 5 nhát vào các đối thủ trong 18 m (luân phiên nếu ít người)
        // kèm sương đêm: đối thủ trong 15 m chỉ nhìn thấy người (và tên) trong 6 m quanh mình suốt 4 giây
        type: 'multiblink', range: 18, strikes: 5, interval: 0.28, radius: 2.4, dmg: 11, kb: 4, kbUp: 4, delay: 1.2, pose: 'spin',
        dark: { range: 15, dur: 4, see: 6 },
        fx: { color: 0x9d4edd, core: 0xff4d6d, kind: 'shadowStep' } },
      finA(c, { fx: { color: 0xff4d6d } }),
    ],
  }),
};
for (const c of CHARACTERS) {
  c.awaken = AWAKEN[c.id](c);
  // chiêu có rip (nhổ cột đá ném): dựng sẵn bản chiêu khi nhổ được cột
  for (const s of c.awaken.skills) if (s.rip) s.ripSkill = { ...s, ...s.rip.over, id: s.id + '_rip', rip: undefined, fx: { ...s.fx, ...s.rip.over.fx } };
}

// Bộ chiêu đang dùng: dạng thường hoặc dạng dị biến
export function charSkills(c, aw) {
  return aw && c.awaken ? c.awaken.skills : c.skills;
}

// Vật triệu hồi điều khiển bởi server (không chọn được ở menu): dùng chung khung nhân vật để hiện như người chơi
export const SUMMONS = {
  treant: {
    id: 'treant', name: 'Mộc Thần', title: 'Người cây', hp: 130, speedMul: 1, speed: 5.5, summon: true,
    look: {
      skin: 0x7f5539, hair: 0x40916c, hairStyle: 'spiky', eye: 0xb7e4c7,
      outfit: 0x6b4f3a, outfit2: 0x40916c, accessory: 'flowerCrown', accColor: 0xff8fab,
      weapon: 'none', scale: 1.7, form: 'treant', formColor: 0x52b788, formCore: 0xffafcc,
    },
    skills: [
      { id: 'tr_punch', name: 'Mộc Quyền', combo: 'J', mana: 0, cd: 1.1, lock: 0.6,
        type: 'melee', range: 2.9, arc: 1.2, dmg: 10, kb: 7, kbUp: 4, delay: 0.25, lunge: 0, pose: 'punch',
        fx: { color: 0x6a994e, kind: 'impact' } },
    ],
  },
};

export const CHAR_BY_ID = Object.fromEntries([...CHARACTERS, ...Object.values(SUMMONS)].map(c => [c.id, c]));
Object.setPrototypeOf(CHAR_BY_ID, null);   // id từ gói tin như "constructor" không được tra ra hàm của Object

// Chiêu giữ phím tụ lực (hold): bản phóng to theo mức tụ k (0..1). Kết quả được lưu lại theo từng nấc 0.1
const HOLD_CACHE = new Map();
export function holdSkill(s, k) {
  if (!s.hold || !(k > 0)) return s;
  k = Math.min(1, Math.round(k * 10) / 10);
  if (!k) return s;
  const key = s.id + ':' + k;
  let r = HOLD_CACHE.get(key);
  if (r) return r;
  const H = s.hold, dm = 1 + (H.dmg - 1) * k, sz = 1 + (H.size - 1) * k;
  r = { ...s, hk: k, dmg: Math.round(s.dmg * dm), fx: { ...s.fx, scale: sz } };
  if (s.radius) r.radius = +(s.radius * sz).toFixed(2);
  if (s.width) r.width = +(s.width * sz).toFixed(2);
  if (s.length) r.length = Math.round(s.length * (1 + 0.3 * k));
  if (s.explode) r.explode = { ...s.explode, radius: +(s.explode.radius * sz).toFixed(2), dmg: Math.round(s.explode.dmg * dm) };
  HOLD_CACHE.set(key, r);
  return r;
}

export function getChar(id) {
  return CHAR_BY_ID[id] || CHARACTERS[0];
}

// Máu tối đa của nhân vật
export function charMaxHp(c) {
  return (typeof c === 'string' ? getChar(c) : c)?.hp || 150;
}

// Tổng thời gian một entity chiêu thức tồn tại (server dùng để dọn dẹp)
export function skillLifetime(s) {
  switch (s.type) {
    case 'melee': return s.delay + (s.echo ? s.echo.n * s.echo.gap : 0) + 0.05;
    case 'projectile': return s.delay + s.range * (s.boomerang ? 2.8 : 1) / s.speed + (s.seek ? 0.4 : 0) + 0.1;
    case 'decoy': case 'icewall': case 'turret': case 'pet': return s.delay + 0.2;
    case 'timezone': return s.delay + s.dur + 0.3;
    case 'wall': return s.delay + s.dur;
    case 'smite': return s.delay + 0.2;
    case 'multiblink': return s.delay + s.strikes * s.interval + 0.1;
    case 'dash': return s.delay + s.dur + 0.1 + (s.clone ? s.clone.delay + 0.15 : 0);
    case 'pillar': return s.delay + 0.2;
    case 'quake': return s.delay + 0.2;
    case 'beam': return s.delay + s.dur + 0.05;
    case 'aoe': return s.delay + (s.ticks - 1) * s.tickInt + 0.05;
    case 'line': return s.delay + s.count * s.interval + 0.05;
    case 'rain': return s.delay + s.count * s.interval + (s.fall || 0) + 0.05;
    case 'trap': case 'summon': return s.delay + s.dur;
    case 'leap': return s.delay + s.dur + 0.1;
    case 'blink': case 'buff': return s.delay + 0.1;
    default: return 2;
  }
}
