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
//
// combo: chuỗi phím J/K/L bấm liên tiếp (trong ~0.5s). Chuỗi dài hơn được ưu tiên.
// Các trường fx.* chỉ dùng cho hiệu ứng hình ảnh phía client.

export const CHARACTERS = [
  {
    id: 'kaze',
    name: 'Kaze',
    title: 'Phong Nhẫn Giả',
    desc: 'Ninja gió nhanh nhẹn, giỏi ám khí và lốc xoáy.',
    speedMul: 1.08,
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
        type: 'projectile', speed: 30, radius: 0.45, range: 30, dmg: 8, kb: 3, count: 3, spread: 0.22, delay: 0.1, pose: 'throw',
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
    ],
  },
  {
    id: 'raiga',
    name: 'Raiga',
    title: 'Khí Công Quyền Vương',
    desc: 'Võ sĩ tóc vàng, bắn khí đạn và chưởng phong ba cực mạnh.',
    speedMul: 1.0,
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
    ],
  },
  {
    id: 'homura',
    name: 'Homura',
    title: 'Hỏa Kiếm Cơ',
    desc: 'Nữ kiếm sĩ lửa, chém sóng lửa và hóa phượng hoàng.',
    speedMul: 1.03,
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
    ],
  },
  {
    id: 'yuki',
    name: 'Yuki',
    title: 'Băng Tuyết Pháp Sư',
    desc: 'Pháp sư băng, khống chế làm chậm/đóng băng và mưa băng diện rộng.',
    speedMul: 0.97,
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
        type: 'projectile', speed: 28, radius: 0.4, range: 24, dmg: 4, kb: 1.5, count: 5, spread: 0.45, delay: 0.1, pose: 'push',
        slow: { mul: 0.75, dur: 1 },
        fx: { color: 0x90e0ef, core: 0xffffff, kind: 'iceShard' } },
      { id: 'yk_spikes', name: 'Băng Phong Lộ', combo: 'JK', mana: 18, cd: 3.5, lock: 0.55, root: true,
        type: 'line', start: 2, spacing: 1.9, count: 7, interval: 0.06, radius: 1.3, dmg: 15, kb: 1, kbUp: 6, delay: 0.15, pose: 'slam',
        slow: { mul: 0.55, dur: 1.6 },
        fx: { color: 0x7fd8ff, core: 0xe9fbff, kind: 'iceSpike' } },
      { id: 'yk_nova', name: 'Hàn Băng Kết Giới', combo: 'KL', mana: 32, cd: 8, lock: 0.7, root: true,
        type: 'aoe', at: 'self', radius: 5.5, dmg: 16, kb: 6, kbUp: 2, ticks: 1, tickInt: 0, delay: 0.35, pose: 'raise',
        stun: 1.3,
        fx: { color: 0x9bf6ff, core: 0xffffff, kind: 'frostNova' } },
      { id: 'yk_blizzard', name: 'Thiên Băng Vũ', combo: 'JKL', mana: 70, cd: 14, lock: 1.2, root: true,
        type: 'rain', offset: 8, area: 6.5, count: 22, interval: 0.11, radius: 1.7, dmg: 7, kb: 2, kbUp: 2, delay: 0.5, fall: 0.45, pose: 'raise',
        slow: { mul: 0.6, dur: 1.2 },
        steer: { mode: 'follow', speed: 5, range: 16 },   // vùng mưa băng di chuyển theo tâm
        fx: { color: 0x8ecae6, core: 0xffffff, kind: 'icicleRain' } },
    ],
  },
  {
    id: 'shiden',
    name: 'Shiden',
    title: 'Lôi Thương Kỵ Sĩ',
    desc: 'Kỵ sĩ cầm thương sét: đâm xa, lôi tiễn xuyên thấu và gọi sấm sét từ trời.',
    speedMul: 1.0,
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
        fx: { color: 0xd0a8ff, core: 0xffffff, kind: 'dashPunch' } },
      { id: 'sd_ring', name: 'Lôi Võng Trận', combo: 'KL', mana: 30, cd: 7.5, lock: 0.8, root: true,
        type: 'aoe', at: 'self', radius: 4.8, dmg: 8, kb: 3, kbUp: 2, ticks: 3, tickInt: 0.3, delay: 0.3, pose: 'raise',
        stun: 0.5,
        fx: { color: 0xb388ff, core: 0xfff3a0, kind: 'thunderRing' } },
      { id: 'sd_storm', name: 'Thiên Lôi Giáng', combo: 'JKL', mana: 70, cd: 14, lock: 1.1, root: true,
        type: 'rain', offset: 9, area: 6, count: 14, interval: 0.16, radius: 2.0, dmg: 11, kb: 3, kbUp: 4, delay: 0.6, fall: 0.05, pose: 'raise',
        steer: { mode: 'follow', speed: 6, range: 18 },   // đám mây sấm trôi theo tâm
        fx: { color: 0xc77dff, core: 0xfff7c2, kind: 'lightning' } },
    ],
  },
  {
    id: 'midori',
    name: 'Midori',
    title: 'Mộc Linh Sư',
    desc: 'Pháp sư cây cỏ: dây leo trói chân, gai độc làm chậm và hoa nở hồi máu cho bản thân.',
    speedMul: 0.98,
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
        type: 'projectile', speed: 30, radius: 0.4, range: 26, dmg: 5, kb: 1.5, count: 3, spread: 0.18, delay: 0.1, pose: 'push',
        slow: { mul: 0.8, dur: 0.8 },
        fx: { color: 0x57cc99, core: 0xc7f9cc, kind: 'thorn' } },
      { id: 'md_roots', name: 'Rễ Thần Trói Buộc', combo: 'JK', mana: 22, cd: 5, lock: 0.55, root: true,
        type: 'line', start: 2, spacing: 2.0, count: 7, interval: 0.07, radius: 1.3, dmg: 12, kb: 1, kbUp: 3, delay: 0.15, pose: 'slam',
        stun: 0.8,
        fx: { color: 0x6a994e, core: 0xb5e48c, kind: 'vineSpike', spike: 0x588157, spikeGlow: 0x1b4332 } },
      { id: 'md_bloom', name: 'Bách Hoa Hồi Xuân', combo: 'KL', mana: 34, cd: 9, lock: 0.7, root: true,
        type: 'aoe', at: 'self', radius: 4.5, dmg: 10, kb: 5, kbUp: 3, ticks: 1, tickInt: 0, delay: 0.3, pose: 'raise',
        healSelf: 30,                                   // hoa nở: hồi 30 máu cho bản thân
        fx: { color: 0xff8fab, core: 0xffffff, kind: 'bloom', crystal: 0xffafcc, crystalGlow: 0x9d4edd } },
      { id: 'md_petals', name: 'Vạn Hoa Kiếm Vũ', combo: 'JKL', mana: 65, cd: 13, lock: 1.1, root: true,
        type: 'rain', offset: 8, area: 6.5, count: 26, interval: 0.1, radius: 1.6, dmg: 6, kb: 2, kbUp: 2, delay: 0.5, fall: 0.6, pose: 'raise',
        slow: { mul: 0.7, dur: 1 },
        steer: { mode: 'follow', speed: 5.5, range: 16 }, // cơn mưa cánh hoa trôi theo tâm
        fx: { color: 0xff8fab, core: 0xc7f9cc, kind: 'petalRain' } },
    ],
  },
  {
    id: 'gantetsu',
    name: 'Gantetsu',
    title: 'Thiết Quyền Hộ Vệ',
    desc: 'Võ sĩ đá to con: chậm nhưng đấm rất nặng, ném đá tảng, động đất làm choáng.',
    speedMul: 0.92,
    look: {
      skin: 0xe0a979, hair: 0x3d2b1f, hairStyle: 'mohawk', eye: 0x8d5524,
      outfit: 0x6b705c, outfit2: 0x3f4238, accessory: 'belt', accColor: 0xbc6c25,
      weapon: 'gauntlet', scale: 1.12,
    },
    skills: [
      { id: 'gt_punch', name: 'Thiết Quyền', combo: 'J', mana: 0, cd: 0.45, lock: 0.36, instant: true,
        type: 'melee', range: 2.3, arc: 1.0, dmg: 9, kb: 6, delay: 0.12, lunge: 3, pose: 'punch',
        fx: { color: 0xe9c46a, kind: 'impact' } },
      { id: 'gt_rock', name: 'Phi Thạch', combo: 'K', mana: 12, cd: 1.2, lock: 0.4,
        type: 'projectile', speed: 22, radius: 0.9, range: 26, dmg: 12, kb: 7, count: 1, spread: 0, delay: 0.2, pose: 'throw',
        explode: { radius: 2.6, dmg: 6, kb: 6, kbUp: 4 },
        fx: { color: 0xa47148, core: 0xe9c46a, kind: 'rock' } },
      { id: 'gt_charge', name: 'Thiết Kiên Xung', combo: 'JK', mana: 20, cd: 4, lock: 0.5, root: true,
        type: 'dash', dist: 7, dur: 0.35, radius: 1.6, dmg: 20, kb: 15, kbUp: 4, delay: 0.12, pose: 'thrust', invuln: true,
        fx: { color: 0xf4a261, core: 0xffffff, kind: 'dashPunch' } },
      { id: 'gt_quake', name: 'Địa Chấn Quyền', combo: 'KL', mana: 34, cd: 9, lock: 0.9, root: true,
        type: 'aoe', at: 'self', radius: 6, dmg: 14, kb: 4, kbUp: 6, ticks: 1, tickInt: 0, delay: 0.4, pose: 'slam',
        stun: 0.9,
        fx: { color: 0xd4a373, core: 0xfefae0, kind: 'quake', crystal: 0x9c6644, crystalGlow: 0x3b2414, noCircle: true } },
      { id: 'gt_meteor', name: 'Thiên Thạch Giáng', combo: 'JKL', mana: 70, cd: 15, lock: 1.2, root: true,
        type: 'rain', offset: 9, area: 6, count: 9, interval: 0.26, radius: 2.6, dmg: 18, kb: 7, kbUp: 6, delay: 0.6, fall: 0.7, pose: 'raise',
        steer: { mode: 'follow', speed: 5, range: 16 },   // vùng thiên thạch rơi trôi theo tâm
        fx: { color: 0xff7b00, core: 0xffd166, kind: 'meteor' } },
    ],
  },
  {
    id: 'kage',
    name: 'Kage',
    title: 'Ảnh Sát Thủ',
    desc: 'Sát thủ bóng tối nhanh nhất: lướt xa, phi đao, màn sương làm chậm và vòng xoáy hắc đao.',
    speedMul: 1.12,
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
        type: 'projectile', speed: 36, radius: 0.35, range: 26, dmg: 7, kb: 2, count: 2, spread: 0.12, delay: 0.06, pose: 'throw',
        fx: { color: 0x7b2cbf, core: 0xe0aaff, kind: 'shuriken' } },
      { id: 'kg_blink', name: 'Thuấn Ảnh Bộ', combo: 'JK', mana: 16, cd: 2.6, lock: 0.32,
        type: 'dash', dist: 12, dur: 0.14, radius: 1.2, dmg: 15, kb: 6, kbUp: 2, delay: 0.05, pose: 'thrust', invuln: true,
        fx: { color: 0x5a189a, core: 0xe0aaff, kind: 'dashPunch' } },
      { id: 'kg_mist', name: 'Hắc Vụ Mê Trận', combo: 'KL', mana: 26, cd: 8, lock: 0.5,
        type: 'aoe', at: 'self', radius: 4.2, dmg: 4, kb: 1, ticks: 6, tickInt: 0.3, delay: 0.15, pose: 'spin',
        slow: { mul: 0.6, dur: 0.8 },
        fx: { color: 0x3c096c, core: 0xc77dff, kind: 'shadowMist' } },
      { id: 'kg_lotus', name: 'Hắc Liên Loạn Trảm', combo: 'JKL', mana: 62, cd: 12, lock: 0.9, root: true,
        type: 'aoe', at: 'front', offset: 6, radius: 4, dmg: 7, kb: 2, pull: 3, ticks: 10, tickInt: 0.2, delay: 0.35, pose: 'spin',
        steer: { mode: 'follow', speed: 8, range: 18 },   // vòng xoáy hắc đao lao theo tâm
        fx: { color: 0xb5179e, core: 0xf0c3ff, kind: 'bladeStorm' } },
    ],
  },
];

export const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));

export function getChar(id) {
  return CHAR_BY_ID[id] || CHARACTERS[0];
}

// Tổng thời gian một entity chiêu thức tồn tại (server dùng để dọn dẹp)
export function skillLifetime(s) {
  switch (s.type) {
    case 'melee': return s.delay + 0.05;
    case 'projectile': return s.delay + s.range / s.speed + 0.1;
    case 'dash': return s.delay + s.dur + 0.1;
    case 'beam': return s.delay + s.dur + 0.05;
    case 'aoe': return s.delay + (s.ticks - 1) * s.tickInt + 0.05;
    case 'line': return s.delay + s.count * s.interval + 0.05;
    case 'rain': return s.delay + s.count * s.interval + (s.fall || 0) + 0.05;
    default: return 2;
  }
}
