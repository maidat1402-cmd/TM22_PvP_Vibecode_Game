// Luật chơi bài dùng chung cho server (quyết định) và trình duyệt (hiện điểm, kiểm tra bài chọn, gợi ý).
// Lá bài là số 0..51: id = hạng * 4 + chất. Hạng theo thứ tự Tiến lên (3 nhỏ nhất ... A, 2 lớn nhất),
// chất theo thứ tự ♠ < ♣ < ♦ < ♥ (bích < chuồn < rô < cơ). Nhờ vậy so 2 lá trong Tiến lên chỉ cần so id.

export const SUITS = ['♠', '♣', '♦', '♥'];
export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const RANK_TWO = 12;
export const cardRank = id => id >> 2;
export const cardSuit = id => id & 3;
export const cardLabel = id => RANKS[cardRank(id)] + SUITS[cardSuit(id)];
export const isRed = id => cardSuit(id) >= 2;
export const CARD_GAMES = { xidach: 'Xì dách', tienlen: 'Tiến lên' };
export const CARD_REJOIN_SECONDS = 60;
export const CARD_CONFIG = { maxChips: 1_000_000, maxBets: 5 };

// Bộ bài đã xáo (rng: hàm trả 0..1)
export function newDeck(rng = Math.random) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

// ======================= Xì dách =======================
// 2..10 theo số, J Q K = 10, A = 1, 10 hoặc 11 (tự chọn cách tính tốt nhất không quá 21).
// Bài đặc biệt (chỉ tính với 2 lá đầu): Xì bàng (2 lá A) > Xì dách (A + lá 10 điểm). Ngũ linh: 5 lá không quá 21.
// Quắc: quá 21. Người chơi phải đủ 16 điểm mới được dằn (dừng); nhà cái rút tới khi đủ 15.
export const XD = { seats: 8, minStand: 16, dealerMin: 15, maxCards: 5, penaltyScore: 28, bets: [50, 100, 200], startChips: 1000 };
export const XD_KIND = { xibang: 'Xì bàng', xidach: 'Xì dách', ngulinh: 'Ngũ linh', quac: 'Quắc', normal: '' };
export const XD_PAY = { xibang: 3, xidach: 2, ngulinh: 2, normal: 1 };   // hệ số tiền thắng theo bài của người thắng

function xdBase(id) {
  const r = RANKS[cardRank(id)];
  if (r === 'A') return 0;
  if (r === 'J' || r === 'Q' || r === 'K') return 10;
  return +r;
}
export function xdScore(cards) {
  let sum = 0, aces = 0;
  for (const c of cards) { const v = xdBase(c); if (v) sum += v; else aces++; }
  // thử mọi cách tính A (1 / 10 / 11), lấy tổng lớn nhất không quá 21, không có thì lấy tổng nhỏ nhất
  let best = -1, min = Infinity;
  const rec = (i, s) => {
    if (i === aces) { if (s <= 21 && s > best) best = s; if (s < min) min = s; return; }
    for (const v of [1, 10, 11]) rec(i + 1, s + v);
  };
  rec(0, sum);
  return best >= 0 ? best : min;
}
export function xdKind(cards) {
  if (cards.length === 2) {
    const a = cards.filter(c => RANKS[cardRank(c)] === 'A').length;
    if (a === 2) return 'xibang';
    if (a === 1 && xdBase(cards.find(c => RANKS[cardRank(c)] !== 'A')) === 10) return 'xidach';
  }
  const s = xdScore(cards);
  if (s > 21) return 'quac';
  if (cards.length >= 5) return 'ngulinh';
  return 'normal';
}
const XD_ORDER = { xibang: 4, xidach: 3, ngulinh: 2, normal: 1, quac: 0 };
// Kết quả của người chơi so với nhà cái: 1 thắng, 0 hoà, -1 thua; mult: hệ số tiền
export function xdCompare(p, d) {
  const kp = xdKind(p), kd = xdKind(d);
  if (kp === 'quac' && kd === 'quac') return { r: 0, mult: 0 };
  if (kp === 'quac') return { r: -1, mult: 1 };
  if (kd === 'quac') return { r: 1, mult: XD_PAY[kp] };
  if (XD_ORDER[kp] !== XD_ORDER[kd]) return XD_ORDER[kp] > XD_ORDER[kd] ? { r: 1, mult: XD_PAY[kp] } : { r: -1, mult: XD_PAY[kd] };
  if (kp !== 'normal') return { r: 0, mult: 0 };
  const sp = xdScore(p), sd = xdScore(d);
  return sp === sd ? { r: 0, mult: 0 } : sp > sd ? { r: 1, mult: 1 } : { r: -1, mult: 1 };
}

// ======================= Tiến lên (miền Nam) =======================
// Bộ bài đánh ra: rác (1 lá), đôi, sám (3 lá cùng hạng), tứ quý (4 lá), sảnh (từ 3 lá liên tiếp, không có 2),
// đôi thông (từ 3 đôi liên tiếp, không có 2). Chặn được khi cùng loại, cùng số lá và lá cao nhất lớn hơn.
// Chặt heo: 3 đôi thông chặt 1 lá 2; tứ quý chặt 1 lá 2, đôi 2, 3 đôi thông; 4 đôi thông chặt 1 lá 2, đôi 2, 3 đôi thông, tứ quý.
export const TL = { handSize: 13, seats: 4, turnTime: 25, payPerCard: 10, startChips: 1000 };
export const TL_NAME = { single: 'Rác', pair: 'Đôi', triple: 'Sám', quad: 'Tứ quý', straight: 'Sảnh', pairs: 'Đôi thông' };

export function tlCombo(ids) {
  const c = [...ids].sort((a, b) => a - b), n = c.length;
  if (!n || n > 13 || new Set(c).size !== n) return null;
  const r = c.map(cardRank), top = c[n - 1];
  const same = r.every(x => x === r[0]);
  if (n === 1) return { type: 'single', len: 1, top };
  if (same && n === 2) return { type: 'pair', len: 2, top };
  if (same && n === 3) return { type: 'triple', len: 3, top };
  if (same && n === 4) return { type: 'quad', len: 4, top };
  if (n >= 3 && r[n - 1] !== RANK_TWO && r.every((x, i) => i === 0 || x === r[i - 1] + 1)) return { type: 'straight', len: n, top };
  if (n >= 6 && n % 2 === 0 && r[n - 1] !== RANK_TWO) {
    let ok = true;
    for (let i = 0; i < n; i += 2) if (r[i] !== r[i + 1] || (i && r[i] !== r[i - 2] + 1)) { ok = false; break; }
    if (ok) return { type: 'pairs', len: n, top };
  }
  return null;
}
// combo c có chặn được bộ đang trên bàn cur không (cur = null: đang được đánh tự do)
export function tlBeats(c, cur) {
  if (!c) return false;
  if (!cur) return true;
  if (c.type === cur.type && c.len === cur.len) return c.top > cur.top;
  const two = cardRank(cur.top) === RANK_TWO;
  const p3 = c.type === 'pairs' && c.len === 6, p4 = c.type === 'pairs' && c.len === 8, quad = c.type === 'quad';
  if (cur.type === 'single' && two) return p3 || quad || p4;
  if (cur.type === 'pair' && two) return quad || p4;
  if (cur.type === 'pairs' && cur.len === 6) return quad || p4;
  if (cur.type === 'quad') return p4;
  return false;
}
export const isBomb = c => c && (c.type === 'quad' || (c.type === 'pairs' && c.len >= 6));

// Mọi bộ có thể tạo từ bài trên tay (để gợi ý và cho bot chơi)
export function tlAllCombos(hand) {
  const h = [...hand].sort((a, b) => a - b), byRank = new Map(), out = [];
  for (const c of h) { const r = cardRank(c); if (!byRank.has(r)) byRank.set(r, []); byRank.get(r).push(c); }
  for (const c of h) out.push([c]);
  for (const cs of byRank.values()) {
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) out.push([cs[i], cs[j]]);
    if (cs.length === 3) out.push([...cs]);
    if (cs.length === 4) { for (let i = 0; i < 4; i++) out.push(cs.filter((_, k) => k !== i)); out.push([...cs]); }
  }
  // sảnh: với mỗi hạng bắt đầu, nối dài tới hết; mỗi hạng lấy lá chất cao nhất (giữ lá nhỏ cho bộ khác), lá cuối thử mọi chất
  for (let start = 0; start < RANK_TWO; start++) {
    if (!byRank.has(start)) continue;
    const seq = [];
    for (let r = start; r < RANK_TWO && byRank.has(r); r++) {
      seq.push(r);
      if (seq.length >= 3) {
        const base = seq.slice(0, -1).map(x => byRank.get(x)[0]);
        for (const last of byRank.get(r)) out.push([...base, last]);
      }
    }
  }
  // đôi thông
  for (let start = 0; start < RANK_TWO; start++) {
    const pr = [];
    for (let r = start; r < RANK_TWO && (byRank.get(r)?.length || 0) >= 2; r++) {
      pr.push(r);
      if (pr.length >= 3) out.push(pr.flatMap(x => byRank.get(x).slice(-2)));
    }
  }
  return out.map(cs => ({ cards: cs, combo: tlCombo(cs) })).filter(x => x.combo);
}

// Gợi ý nước đi: đang đánh tự do thì đánh bộ chứa lá nhỏ nhất (ưu tiên sảnh dài, rồi đôi / sám), lượt đầu ván đầu phải có 3♠;
// đang chặn thì chọn bộ nhỏ nhất chặn được (chỉ dùng hàng chặt khi bàn đang là heo). Không có thì trả null (bỏ lượt).
export function tlSuggest(hand, cur, mustHave = -1) {
  if (!hand.length) return null;
  const all = tlAllCombos(hand);
  if (!cur) {
    const low = mustHave >= 0 ? mustHave : Math.min(...hand);
    const withLow = all.filter(x => x.cards.includes(low) && !isBomb(x.combo));
    const pick = (t) => withLow.filter(x => x.combo.type === t).sort((a, b) => b.combo.len - a.combo.len || a.combo.top - b.combo.top)[0];
    const s = pick('straight'), tr = pick('triple'), p = pick('pair');
    return (s && s.combo.len >= 3 ? s : tr || p || withLow.find(x => x.combo.type === 'single') || all[0]).cards;
  }
  const curTwo = cardRank(cur.top) === RANK_TWO;
  const ok = all.filter(x => tlBeats(x.combo, cur) && (curTwo || !isBomb(x.combo) || isBomb(cur)));
  if (!ok.length) return null;
  ok.sort((a, b) => (isBomb(a.combo) - isBomb(b.combo)) || a.combo.top - b.combo.top);
  return ok[0].cards;
}

// Tới trắng: thắng ngay khi vừa chia bài (chưa ai đánh). Trả tên kiểu tới trắng, không có thì null.
//   tứ quý heo (4 lá 2) · sảnh rồng (đủ 12 hạng 3 → A) · 6 đôi (tứ quý tính 2 đôi) · 5 đôi thông
export function tlInstantWin(hand) {
  if (hand.length !== TL.handSize) return null;
  const cnt = new Array(13).fill(0);
  for (const c of hand) cnt[cardRank(c)]++;
  if (cnt[RANK_TWO] === 4) return 'Tứ quý heo';
  if (cnt.slice(0, RANK_TWO).every(n => n >= 1)) return 'Sảnh rồng';
  if (cnt.reduce((a, n) => a + Math.floor(n / 2), 0) >= 6) return '6 đôi';
  let run = 0;
  for (let r = 0; r < RANK_TWO; r++) { run = cnt[r] >= 2 ? run + 1 : 0; if (run >= 5) return '5 đôi thông'; }
  return null;
}
// Thối heo: người thua còn heo (lá 2) khi hết ván bị phạt thêm, trả cho người thắng.
export const TL_HEO_FINE = { black: 20, red: 40 };   // heo ♠ ♣ / heo ♦ ♥, mỗi lá
export function tlHeoFine(hand) {
  let n = 0, xu = 0;
  for (const c of hand) if (cardRank(c) === RANK_TWO) { n++; xu += isRed(c) ? TL_HEO_FINE.red : TL_HEO_FINE.black; }
  return { n, xu };
}
