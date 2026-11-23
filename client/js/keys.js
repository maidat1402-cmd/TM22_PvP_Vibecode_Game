// Gán phím: người chơi đổi phím cho từng hành động (mỗi hành động 2 phím: chính + phụ).
// Logic game vẫn dùng "phím chuẩn" (code mặc định: KeyJ, Space...). Lớp này dịch phím thật người chơi bấm
// sang phím chuẩn trước khi đưa vào game, nên combo, nút cảm ứng, giữ phím tụ lực... không phải sửa.
// Chuột cũng gán được: 'Mouse0' (trái), 'Mouse1' (giữa), 'Mouse2' (phải).

// Phím hệ thống, không cho gán: bảng điểm, chat, menu, hướng dẫn
export const SYSTEM_KEYS = new Set(['Tab', 'Enter', 'NumpadEnter', 'Escape', 'F1']);

// code: phím chuẩn mà logic game đọc; def: phím mặc định
export const ACTIONS = {
  brawl: [
    { id: 'up', label: 'Đi tới', code: 'KeyW', def: ['KeyW', 'ArrowUp'] },
    { id: 'down', label: 'Đi lùi', code: 'KeyS', def: ['KeyS', 'ArrowDown'] },
    { id: 'left', label: 'Sang trái', code: 'KeyA', def: ['KeyA', 'ArrowLeft'] },
    { id: 'right', label: 'Sang phải', code: 'KeyD', def: ['KeyD', 'ArrowRight'] },
    { id: 'jump', label: 'Nhảy / bay (giữ)', code: 'Space', def: ['Space'] },
    { id: 'dash', label: 'Lướt né / chạy nhanh (giữ)', code: 'ShiftLeft', def: ['ShiftLeft', 'ShiftRight'] },
    { id: 'atk', label: 'Đánh thường (phím J của combo)', code: 'KeyJ', def: ['KeyJ', 'Mouse0'] },
    { id: 's1', label: 'Chiêu 1 (phím K của combo)', code: 'KeyK', def: ['KeyK', 'Mouse2'] },
    { id: 's3', label: 'Phím L của combo (L L = dị biến)', code: 'KeyL', def: ['KeyL'] },
    { id: 'heal', label: 'Hồi máu', code: 'KeyH', def: ['KeyH'] },
    { id: 'charge', label: 'Vận khí (giữ)', code: 'KeyU', def: ['KeyU'] },
    { id: 'fill', label: 'Nạp đầy thanh dị biến (đấu tập)', code: 'KeyP', def: ['KeyP'] },
    { id: 'lobby', label: 'Mở / đóng phòng chờ (đấu đội)', code: 'KeyT', def: ['KeyT'] },
  ],
  shooter: [
    { id: 'up', label: 'Đi tới', code: 'KeyW', def: ['KeyW', 'ArrowUp'] },
    { id: 'down', label: 'Đi lùi', code: 'KeyS', def: ['KeyS', 'ArrowDown'] },
    { id: 'left', label: 'Sang trái', code: 'KeyA', def: ['KeyA', 'ArrowLeft'] },
    { id: 'right', label: 'Sang phải', code: 'KeyD', def: ['KeyD', 'ArrowRight'] },
    { id: 'jump', label: 'Nhảy', code: 'Space', def: ['Space'] },
    { id: 'walk', label: 'Đi chậm, không tiếng bước chân (giữ)', code: 'ShiftLeft', def: ['ShiftLeft'] },
    { id: 'crouch', label: 'Ngồi (giữ)', code: 'ControlLeft', def: ['ControlLeft', 'KeyC'] },
    { id: 'slot1', label: 'Súng chính', code: 'Digit1', def: ['Digit1'] },
    { id: 'slot2', label: 'Súng lục', code: 'Digit2', def: ['Digit2'] },
    { id: 'slot3', label: 'Dao', code: 'Digit3', def: ['Digit3'] },
    { id: 'nade', label: 'Lựu đạn (bấm tiếp đổi loại)', code: 'Digit4', def: ['Digit4'] },
    { id: 'prev', label: 'Súng vừa cầm', code: 'KeyQ', def: ['KeyQ'] },
    { id: 'reload', label: 'Nạp đạn', code: 'KeyR', def: ['KeyR'] },
    { id: 'use', label: 'Cài / gỡ bom (giữ)', code: 'KeyE', def: ['KeyE'] },
    { id: 'pickup', label: 'Nhặt súng', code: 'KeyF', def: ['KeyF'] },
    { id: 'drop', label: 'Vứt súng', code: 'KeyG', def: ['KeyG'] },
    { id: 'buy', label: 'Mua đồ / chọn súng', code: 'KeyB', def: ['KeyB'] },
  ],
};
export const MODE_NAMES = { brawl: 'Đối kháng', shooter: 'Bắn súng' };

let user = {};        // { brawl: { id: [chính, phụ] }, shooter: {...} } — chỉ lưu hành động đã đổi
const maps = {};      // phím thật -> phím chuẩn, dựng lại mỗi lần đổi

export function bindingsOf(mode) {
  const out = {};
  for (const a of ACTIONS[mode]) out[a.id] = (user[mode]?.[a.id] || a.def).slice(0, 2);
  return out;
}

function rebuild() {
  for (const mode of Object.keys(ACTIONS)) {
    const m = new Map(), b = bindingsOf(mode);
    for (const a of ACTIONS[mode]) for (const c of b[a.id]) if (c && !m.has(c)) m.set(c, a.code);
    maps[mode] = m;
  }
}

// nạp từ cài đặt đã lưu (bỏ qua dữ liệu hỏng)
export function loadBindings(obj) {
  user = {};
  if (obj && typeof obj === 'object') {
    for (const mode of Object.keys(ACTIONS)) {
      const src = obj[mode];
      if (!src || typeof src !== 'object') continue;
      for (const a of ACTIONS[mode]) {
        const v = src[a.id];
        if (Array.isArray(v)) (user[mode] ||= {})[a.id] = v.slice(0, 2).map(c => (typeof c === 'string' && c.length < 24 && !SYSTEM_KEYS.has(c) ? c : ''));
      }
    }
  }
  rebuild();
}
export const saveBindings = () => JSON.parse(JSON.stringify(user));

// phím thật -> phím chuẩn. Phím hệ thống giữ nguyên; phím chưa gán cho hành động nào trả về null (bỏ qua)
export function translate(mode, code) {
  if (SYSTEM_KEYS.has(code)) return code;
  return maps[mode]?.get(code) || null;
}

// Gán phím code cho ô slot (0 chính, 1 phụ) của hành động id. Phím đó đang dùng ở hành động khác (cùng chế độ)
// thì bị gỡ khỏi hành động kia; trả về tên hành động bị gỡ (để báo cho người chơi), hoặc null.
export function setBinding(mode, id, slot, code) {
  if (SYSTEM_KEYS.has(code)) return null;
  const b = bindingsOf(mode);
  let moved = null;
  if (code) for (const a of ACTIONS[mode]) {
    if (a.id === id) continue;
    const i = b[a.id].indexOf(code);
    if (i >= 0) { b[a.id][i] = ''; moved = a.label; (user[mode] ||= {})[a.id] = b[a.id]; }
  }
  const cur = b[id];
  while (cur.length < 2) cur.push('');
  if (code && cur[1 - slot] === code) cur[1 - slot] = '';
  cur[slot] = code || '';
  (user[mode] ||= {})[id] = cur;
  rebuild();
  return moved;
}

export function resetBindings(mode) {
  if (mode) delete user[mode]; else user = {};
  rebuild();
}

// Tên phím để hiện cho người chơi
const NAMES = {
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift phải', ControlLeft: 'Ctrl', ControlRight: 'Ctrl phải', AltLeft: 'Alt', AltRight: 'Alt phải',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', CapsLock: 'Caps', Backspace: '⌫', Delete: 'Del', Insert: 'Ins',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', MetaLeft: 'Win', MetaRight: 'Win', ContextMenu: 'Menu',
  Mouse0: 'Chuột trái', Mouse1: 'Chuột giữa', Mouse2: 'Chuột phải', Mouse3: 'Chuột 4', Mouse4: 'Chuột 5',
};
export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code;
}
// tên phím chính của một hành động (ví dụ hiện trên thanh chiêu); không có phím chính thì lấy phím phụ
export function actionKey(mode, id) {
  const b = bindingsOf(mode)[id] || [];
  return keyName(b.find(c => c) || '');
}
// tên phím chính và phím phụ của một hành động
export function actionKeys(mode, id) { return (bindingsOf(mode)[id] || []).map(c => (c ? keyName(c) : '')); }
// phím của 3 chữ trong combo (J K L)
const COMBO_ACT = { J: 'atk', K: 's1', L: 's3' };
export const comboKey = letter => actionKey('brawl', COMBO_ACT[letter] || 'atk');

rebuild();
