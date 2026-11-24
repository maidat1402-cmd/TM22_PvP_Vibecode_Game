import { cardRank, cardSuit } from './cards.js';

export const POKER = Object.freeze({ seats: 6, startChips: 1000, small: 5, big: 10, turnTime: 25 });
export const POKER_STREETS = ['Preflop', 'Flop', 'Turn', 'River'];
export const POKER_HANDS = ['Mậu thầu', 'Một đôi', 'Hai đôi', 'Sám', 'Sảnh', 'Thùng', 'Cù lũ', 'Tứ quý', 'Thùng phá sảnh'];
const CATEGORY = 15 ** 5;

// Hạng Tiến lên trong id lá dùng 2 cao nhất. Đổi sang 2 thấp, A cao cho Poker.
export const pokerValue = id => cardRank(id) === 12 ? 2 : cardRank(id) + 3;

function scoreFive(cards) {
  const ranks = cards.map(pokerValue).sort((a, b) => b - a);
  const flush = cards.every(c => cardSuit(c) === cardSuit(cards[0]));
  const counts = new Map();
  for (const v of ranks) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [first, second] = groups;
  const run = groups.length === 5 && ranks[0] - ranks[4] === 4 ? ranks[0]
    : ranks.join(',') === '14,5,4,3,2' ? 5 : 0;
  let category = 0, tie = ranks;
  if (run && flush) { category = 8; tie = [run]; }
  else if (first[1] === 4) { category = 7; tie = [first[0], second[0]]; }
  else if (first[1] === 3 && second[1] === 2) { category = 6; tie = [first[0], second[0]]; }
  else if (flush) category = 5;
  else if (run) { category = 4; tie = [run]; }
  else if (first[1] === 3) { category = 3; tie = groups.map(group => group[0]); }
  else if (second[1] === 2) { category = 2; tie = groups.map(group => group[0]); }
  else if (first[1] === 2) { category = 1; tie = groups.map(group => group[0]); }
  // Mã cơ số 15 so hạng trước rồi lần lượt so các lá phụ.
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (tie[i] ?? 0);
  return score;
}

export function pokerScore(cards) {
  let best = 0;
  if (cards.length === 5) return scoreFive(cards);
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++)
            best = Math.max(best, scoreFive([cards[a], cards[b], cards[c], cards[d], cards[e]]));
  return best;
}

export const pokerCategory = score => Math.floor(score / CATEGORY);
