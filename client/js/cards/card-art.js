// Mặt bài dùng chung cho bàn 3D, bài trên tay và hình xem trước trong cài đặt.
import { RANKS, cardRank, cardSuit, isRed, DEFAULT_CARD_STYLE } from '/shared/cards.js';

const WIDTH = 128, HEIGHT = 180;
const ART_SCALE = 1.5;
const GOLD = '#b48638';
const RED = '#ac1c27', BLACK = '#191821';
const STYLES = {
  classic: { paper: ['#fdf6e5', '#ede1c5'], line: '#9a8970', back: '#751a32', trim: '#ecd28d' },
  chibi: { paper: ['#fffaf0', '#f1e4c7'], line: '#263956', back: '#253858', trim: '#e5ba68' },
};
const PIP_PATHS = [
  'M0 -10 C-3 -6 -10 -2 -10 3 C-10 8 -4 10 -1 6 C-1 8 -3 11 -5 11 H5 C3 11 1 8 1 6 C4 10 10 8 10 3 C10 -2 3 -6 0 -10 Z',
  'M0 -10 A5 5 0 0 1 4.5 -3 A5 5 0 1 1 1.5 5 C2 8 3 10 5 11 H-5 C-3 10 -2 8 -1.5 5 A5 5 0 1 1 -4.5 -3 A5 5 0 0 1 0 -10 Z',
  'M0 -11 Q4 -5 9.5 0 Q4 5 0 11 Q-4 5 -9.5 0 Q-4 -5 0 -11 Z',
  'M0 10 C-2 7 -10 1 -10 -4 A5.7 5.7 0 0 1 0 -8 A5.7 5.7 0 0 1 10 -4 C10 1 2 7 0 10 Z',
].map(path => new Path2D(path));

// Tọa độ dọc tính từ tâm lá. Mỗi hàng bên có một dấu ở cả bên trái và phải.
const LAYOUTS = {
  2: { middle: [-46, 46] },
  3: { middle: [-46, 0, 46] },
  4: { sides: [-46, 46] },
  5: { sides: [-46, 46], middle: [0] },
  6: { sides: [-46, 0, 46] },
  7: { sides: [-46, 0, 46], middle: [-23] },
  8: { sides: [-46, 0, 46], middle: [-23, 23] },
  9: { sides: [-48, -16, 16, 48], middle: [0] },
  10: { sides: [-48, -16, 16, 48], middle: [-32, 32] },
};

const COURTS = {
  J: { cloth: '#336657', shadow: '#24463f', hair: '#3b2e29', classic: '#426c78' },
  Q: { cloth: '#5474ad', shadow: '#364c82', hair: '#c7cbe4', classic: '#b64444' },
  K: { cloth: '#aa4136', shadow: '#762c2f', hair: '#7a352d', classic: '#b48a40' },
};
const ART = new Map();

function pip(g, suit, x, y, size, color, upsideDown = false) {
  g.save();
  g.translate(x, y);
  const scale = size / 22 * (upsideDown ? -1 : 1);
  g.scale(scale, scale);
  g.fillStyle = color;
  g.fill(PIP_PATHS[suit]);
  g.restore();
}

function shape(g, outline, fill, stroke, width = 1.1) {
  const path = new Path2D(outline);
  if (fill) { g.fillStyle = fill; g.fill(path); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(path); }
}

function oval(g, x, y, rx, ry, fill) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

function rounded(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawBack(g, style) {
  const { back, trim } = style;
  g.fillStyle = back;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.save();
  rounded(g, 10, 10, 108, 160, 7);
  g.strokeStyle = trim;
  g.lineWidth = 2;
  g.stroke();
  g.clip();
  g.strokeStyle = trim;
  g.globalAlpha = 0.38;
  g.lineWidth = 1;
  g.beginPath();
  for (let x = -160; x < WIDTH + 160; x += 15) {
    g.moveTo(x, 10); g.lineTo(x + 160, 170);
    g.moveTo(x, 10); g.lineTo(x - 160, 170);
  }
  g.stroke();
  g.restore();
  g.save();
  g.translate(64, 90);
  shape(g, 'M0 -31 L27 0 L0 31 L-27 0 Z', back, trim, 1.6);
  g.fillStyle = trim;
  g.font = 'bold 19px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CC', 0, 1);
  g.restore();
}

function drawFrame(g, style, chibi) {
  const paper = g.createLinearGradient(24, 0, 108, HEIGHT);
  paper.addColorStop(0, style.paper[0]);
  paper.addColorStop(1, style.paper[1]);
  g.fillStyle = paper;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  rounded(g, 4, 4, 120, 172, 6);
  g.strokeStyle = style.line;
  g.lineWidth = chibi ? 1.35 : 0.65;
  g.stroke();
  if (chibi) {
    for (const y of [5, 175]) {
      g.save();
      g.translate(64, y);
      shape(g, 'M0 -4 L5 0 L0 4 L-5 0 Z', GOLD);
      g.restore();
    }
    for (const [x, y] of [[5, 5], [123, 5], [5, 175], [123, 175]]) oval(g, x, y, 2.1, 2.1, GOLD);
  }
}

function drawIndex(g, rank, suit, ink) {
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${rank === '10' ? 17 : 22}px Georgia, serif`;
  g.fillText(rank, 16, 18);
  pip(g, suit, 16, 34, 12, ink);
}

function drawPips(g, rank, suit, ink) {
  if (rank === 'A') {
    pip(g, suit, 64, 90, 51, ink);
    return;
  }
  const { sides = [], middle = [] } = LAYOUTS[rank];
  const size = Number(rank) >= 9 ? 22 : 25;
  for (const y of sides) {
    pip(g, suit, 45, 90 + y, size, ink, y > 0);
    pip(g, suit, 83, 90 + y, size, ink, y > 0);
  }
  for (const y of middle) pip(g, suit, 64, 90 + y, size, ink, y > 0);
}

function drawHead(g, rank, court, chibi) {
  const outline = '#382c38';
  g.save();
  g.translate(chibi ? -1 : -4, -37);
  g.scale(chibi ? 1.12 : 0.82, chibi ? 1 : 1.02);
  if (rank === 'Q') {
    shape(g, 'M-15 14 Q-22 1 -16 -13 Q0 -27 15 -13 Q23 0 17 15 L10 9 H-8 Z', court.cloth, outline);
  }
  shape(g, 'M-15 1 Q-17 -14 -6 -17 Q7 -21 14 -12 Q18 -7 15 5 L10 12 H-9 Z', court.hair, outline);
  shape(g, 'M-13 -4 Q-8 -5 -6 -11 Q1 -4 12 -6 L13 2 Q12 11 2 13 Q-9 13 -13 5 Z', '#f4caa5', outline);
  if (chibi) {
    oval(g, -5.7, 1, 2.8, 4.1, outline);
    oval(g, 6.1, 1, 2.8, 4.1, outline);
    oval(g, -6.4, -0.4, 0.8, 1, '#fff7df');
    oval(g, 5.4, -0.4, 0.8, 1, '#fff7df');
    oval(g, -10.4, 5.6, 2.2, 1.15, '#df9380');
    oval(g, 10.3, 5.6, 2.2, 1.15, '#df9380');
    shape(g, 'M-1.6 7 Q0.4 9 2.5 7', null, outline, 0.75);
  } else {
    shape(g, 'M-9 -2 Q-6 -4 -3 -2 M3 -2 Q6 -4 9 -2 M1 0 L2 4 H0 M-2 7 Q1 8 4 7', null, outline, 0.85);
    oval(g, -6, -0.3, 0.9, 1, outline);
    oval(g, 6, -0.3, 0.9, 1, outline);
    if (rank === 'K') shape(g, 'M-10 5 Q-5 13 0 9 Q5 13 11 5 Q10 14 1 16 Q-8 15 -10 5 Z', court.hair, outline);
  }
  if (rank === 'J') {
    shape(g, 'M-17 -11 Q-19 -22 -5 -24 Q8 -25 15 -14 L19 -12 Q6 -9 -17 -11 Z', court.cloth, outline);
    shape(g, 'M6 -17 Q16 -30 21 -22 Q19 -16 6 -17 Z', '#fff0cb', outline);
    shape(g, 'M-16 -12 Q-1 -13 12 -14', null, GOLD, 1.8);
  } else {
    const crown = rank === 'K'
      ? 'M-15 -13 L-17 -24 L-7 -20 L0 -27 L7 -20 L17 -24 L15 -13 Z'
      : 'M-14 -13 L-15 -20 L-7 -17 L0 -24 L7 -17 L15 -20 L14 -13 Z';
    shape(g, crown, '#eac16b', outline);
    oval(g, 0, -17.6, 1.65, 2, court.shadow);
  }
  g.restore();
}

function drawHalfCourt(g, rank, suit, court, ink, chibi) {
  const outline = '#382c38';
  g.save();
  g.beginPath();
  g.rect(-31, -65, 62, 65);
  g.clip();
  const cloth = chibi ? court.cloth : court.classic;
  shape(g, 'M-31 0 Q-30 -18 -18 -24 L-8 -28 H8 L18 -23 Q29 -17 31 0 Z', cloth, outline);
  shape(g, 'M-28 0 Q-25 -15 -16 -20 L-12 -15 L-17 0 Z M14 0 L10 -16 L17 -21 Q27 -13 28 0 Z', court.shadow);
  shape(g, 'M-11 -23 L-6 -31 H7 L12 -24 L7 -17 H-6 Z', '#f4caa5', outline);
  const collar = chibi
    ? 'M-19 -24 Q-13 -19 0 -18 Q13 -19 19 -24 L17 -17 Q4 -10 0 -14 Q-4 -10 -17 -17 Z'
    : 'M-18 -25 L0 -18 L18 -25 L13 -15 L0 -11 L-13 -15 Z';
  shape(g, collar, '#f5e7c7', outline);
  // Dải áo và huy hiệu lấy cùng màu với dấu chất của lá bài.
  shape(g, 'M-20 -15 L-14 -17 L17 0 H3 Z', ink, '#eac16b', 1);
  oval(g, 4, -7, 5.2, 5.2, '#f8e8c4');
  pip(g, suit, 4, -7, 7.5, ink);
  drawHead(g, rank, court, chibi);
  // Vật cầm tay giúp phân biệt bồi, đầm và già ngay từ xa.
  if (rank === 'J') {
    shape(g, 'M18 -6 L21 -37 L25 -42 L25 -33 L21 -6 Z', '#d9e2df', outline);
    shape(g, 'M16 -17 L25 -16 M18 -7 L22 -7', null, '#ebc779', 2);
  } else if (rank === 'Q') {
    shape(g, 'M22 -7 L23 -30 M23 -18 L28 -22', null, '#497459', 1.8);
    shape(g, 'M23 -39 L25 -34 L29 -35 L27 -30 L29 -27 L25 -27 L23 -23 L21 -27 L17 -27 L19 -30 L17 -35 L21 -34 Z', '#bed9ee', court.shadow, 0.8);
  } else {
    shape(g, 'M21 -7 L22 -34', null, '#ebc779', 3);
    shape(g, 'M23 -45 L25 -40 L30 -38 L26 -35 L25 -30 L22 -34 L17 -34 L19 -38 L18 -42 L22 -41 Z', '#f1c36a', outline);
  }
  g.restore();
}

function drawCourt(g, rank, suit, ink, style, chibi) {
  const court = COURTS[rank];
  g.save();
  g.translate(64, 90);
  rounded(g, -31, -65, 62, 130, chibi ? 8 : 2);
  g.fillStyle = chibi ? '#e9e0c9' : '#f1ead5';
  g.fill();
  g.save();
  g.clip();
  if (!chibi) {
    g.strokeStyle = '#d0c3a7';
    g.lineWidth = 0.45;
    g.beginPath();
    for (let x = -90; x < 55; x += 5) { g.moveTo(x, -65); g.lineTo(x + 100, 65); }
    g.stroke();
  }
  drawHalfCourt(g, rank, suit, court, ink, chibi);
  g.rotate(Math.PI);
  drawHalfCourt(g, rank, suit, court, ink, chibi);
  g.restore();
  rounded(g, -31, -65, 62, 130, chibi ? 8 : 2);
  g.strokeStyle = chibi ? GOLD : style.line;
  g.lineWidth = 1.1;
  g.stroke();
  g.restore();
}

export function cardCanvas(id, styleId = DEFAULT_CARD_STYLE) {
  const key = styleId + ':' + id;
  if (ART.has(key)) return ART.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * ART_SCALE;
  canvas.height = HEIGHT * ART_SCALE;
  const g = canvas.getContext('2d');
  g.scale(ART_SCALE, ART_SCALE);
  const chibi = styleId === 'chibi', style = STYLES[styleId];
  rounded(g, 1, 1, WIDTH - 2, HEIGHT - 2, 8);
  g.clip();
  if (id < 0) drawBack(g, style);
  else {
    const rank = RANKS[cardRank(id)], suit = cardSuit(id), ink = isRed(id) ? RED : BLACK;
    drawFrame(g, style, chibi);
    if (Object.hasOwn(COURTS, rank)) drawCourt(g, rank, suit, ink, style, chibi);
    else drawPips(g, rank, suit, ink);
    drawIndex(g, rank, suit, ink);
    g.translate(WIDTH, HEIGHT);
    g.rotate(Math.PI);
    drawIndex(g, rank, suit, ink);
  }
  ART.set(key, canvas);
  return canvas;
}

export function paintCard(canvas, id, style) {
  canvas.getContext('2d').drawImage(cardCanvas(id, style), 0, 0, canvas.width, canvas.height);
}
