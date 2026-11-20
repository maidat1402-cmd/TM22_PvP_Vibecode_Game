// Các map của chế độ đối kháng. Tất cả là địa điểm tự thiết kế.
//   obstacles: trụ [x, z, bán kính, cao]
//   boxes:     hộp thẳng trục [x, z, nửa rộng X, nửa rộng Z, cao] (đứng được trên nóc)
//   spawns:    điểm hồi sinh [x, z]
// Giao diện từng theme: client/js/world.js
import { ARENA } from './config.js';

export const ARENAS = {
  shrine: ARENA,

  // Đảo giữa biển, sàn đấu lát đá rộng, khán đài xung quanh — sân thoáng hợp đấu chưởng
  tournament: {
    id: 'tournament', name: 'Đảo Đại Hội Võ Thuật', icon: '🥋', theme: 'tournament',
    radius: 36,
    obstacles: [
      [20, 20, 1.3, 3.6], [-20, 20, 1.3, 3.6], [20, -20, 1.3, 3.6], [-20, -20, 1.3, 3.6],   // đèn đá 4 góc
    ],
    boxes: [
      [0, 0, 5, 5, 0.9],            // bục cao giữa sàn
      [0, 22, 4, 0.8, 1.4], [0, -22, 4, 0.8, 1.4],
      [22, 0, 0.8, 4, 1.4], [-22, 0, 0.8, 4, 1.4],
    ],
    spawns: [[0, 30], [0, -30], [30, 0], [-30, 0], [12, 12], [-12, -12], [12, -12], [-12, 12]],
  },

  // Hoang mạc đá đỏ với các cột đá cao vút — bay lên nóc cột để phục kích
  wasteland: {
    id: 'wasteland', name: 'Hoang Mạc Đá Đỏ', icon: '🏜', theme: 'wasteland',
    radius: 44,
    obstacles: [
      [0, 0, 3.2, 12], [16, 10, 2.4, 9], [-15, 12, 2.8, 14], [12, -17, 2.2, 8], [-18, -14, 3.0, 11],
      [30, -8, 2.0, 7], [-30, 4, 2.2, 8], [6, 30, 2.6, 10], [-8, -31, 2.4, 9], [26, 24, 1.8, 6], [-26, -28, 1.8, 6],
      // đá tảng thấp
      [8, 8, 1.4, 1.4], [-7, -6, 1.6, 1.8], [22, -26, 1.6, 1.5], [-24, 22, 1.5, 1.6], [34, 12, 1.3, 1.2],
    ],
    boxes: [],
    spawns: [[0, 38], [0, -38], [38, 0], [-38, 0], [28, 28], [-28, 28], [28, -28], [-32, -20]],
  },

  // Làng ninja giữa rừng trúc: nhảy lên mái nhà, đánh quanh tháp nước và bãi tập
  village: {
    id: 'village', name: 'Làng Ninja Rừng Trúc', icon: '🍃', theme: 'village',
    radius: 40,
    obstacles: [
      [2, 22, 2.0, 6.5],                                   // tháp nước
      [4, 2, 0.4, 1.6], [6.5, 4, 0.4, 1.3], [2, 5, 0.4, 1.8],  // cọc gỗ bãi tập
      [-3, -5, 1.3, 1.0],                                  // giếng đá
    ],
    boxes: [
      [-14, -8, 5, 4, 4.2], [14, -10, 4.5, 5, 3.6], [-12, 14, 4, 4.5, 3.8], [15, 13, 5, 3.5, 4.6],
      [0, -24, 6, 3.5, 3.4], [-26, 0, 3, 5, 3.2], [26, 2, 3, 4, 3.0],
    ],
    spawns: [[0, 34], [0, -34], [34, 0], [-34, 0], [24, 26], [-24, 26], [24, -26], [-24, -26]],
  },
};

export const ARENA_LIST = Object.values(ARENAS);
Object.setPrototypeOf(ARENAS, null);   // id map từ gói tin như "constructor" không được tra ra hàm của Object

export function getArena(id) {
  return ARENAS[id] || ARENA;
}
