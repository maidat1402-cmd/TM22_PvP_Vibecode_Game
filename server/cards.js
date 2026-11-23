// Phòng đánh bài quanh bàn tròn: Xì dách hoặc Tiến lên. Server quyết định toàn bộ (xáo bài, chia, lượt, tính tiền);
// client chỉ gửi hành động. Thiếu người thì bot tự ngồi vào ghế trống; người rời giữa ván Tiến lên thì bot chơi thay.
import { startLoop } from './loop.js';
import { CHARACTERS, getChar } from '../shared/characters.js';
import { newDeck, xdScore, xdKind, xdCompare, XD, XD_KIND, tlCombo, tlBeats, tlSuggest, TL, TL_NAME, cardLabel, CARD_GAMES } from '../shared/cards.js';

let nextId = 5000;      // id phòng bài (phòng đối kháng từ 1, bắn súng từ 1000)
let nextBotId = 80000;  // id bot ngồi bàn
const BOT_NAMES = ['Mèo Mun', 'Bác Ba', 'Cô Tư', 'Anh Hai', 'Bé Út', 'Ông Sáu', 'Chị Bảy', 'Cậu Tám'];
const now = () => performance.now() / 1000;
const pick = a => a[(Math.random() * a.length) | 0];

export class CardRoom {
  constructor(name, hub, game) {
    this.id = String(nextId++);
    this.name = name;
    this.hub = hub;
    this.game = game === 'tienlen' ? 'tienlen' : 'xidach';
    this.players = new Map();          // id -> người ngồi bàn (cả bot)
    this.seatCount = this.game === 'tienlen' ? TL.seats : 5;   // xì dách: 5 ghế người chơi + nhà cái
    this.seats = Array(this.seatCount).fill(null);   // id người ngồi từng ghế
    this.phase = 'wait';
    this.deadline = 0;
    this.turn = -1;                    // ghế đang tới lượt
    this.msg = '';                     // dòng thông báo ngắn trên bàn
    this.games = 0;
    if (this.game === 'xidach') this.dealer = { name: 'Nhà cái ' + pick(BOT_NAMES), char: pick(CHARACTERS).id, hand: [], open: false };
    this.stopLoop = startLoop(10, () => this.tick());
  }

  get count() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
  info() { return { id: this.id, name: this.name, count: this.count, mode: this.game, map: 'table', mapName: 'Bàn ' + CARD_GAMES[this.game] }; }
  destroy() { this.stopLoop(); }

  send(p, m) { if (!p.bot && p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); }
  broadcast(m) { const d = JSON.stringify(m); for (const p of this.players.values()) if (!p.bot && p.ws.readyState === 1) p.ws.send(d); }
  sys(msg) { this.broadcast({ t: 'sys', msg }); }

  // ================= Người chơi =================
  add(client) {
    const p = { id: client.id, ws: client.ws, name: client.name, char: getChar(client.char).id, bot: false, seat: -1,
      chips: this.game === 'xidach' ? XD.startChips : TL.startChips, hand: [], bet: 100, ready: false };
    this.players.set(p.id, p);
    client.room = this;
    // còn ghế trống và chưa có ván thì ngồi luôn; đang có ván thì chờ ván sau (bot nhường ghế)
    const free = this.seats.indexOf(null);
    const canSit = this.phase === 'wait' || this.phase === 'result' || (this.game === 'xidach' && this.phase === 'bet');
    if (free >= 0 && canSit) this.sit(p, free);
    this.send(p, { t: 'cj', you: p.id, room: { id: this.id, name: this.name, game: this.game } });
    this.sys(`${p.name} đã vào bàn`);
    if (p.seat < 0 && this.phase !== 'wait') this.send(p, { t: 'sys', msg: 'Ván đang chơi — bạn sẽ vào bàn ở ván sau.' });
    this.sendState();
    this.hub.roomsChanged();
  }

  sit(p, seat) { p.seat = seat; this.seats[seat] = p.id; }

  remove(clientId) {
    const p = this.players.get(clientId);
    if (!p) return;
    this.sys(`${p.name} đã rời bàn`);
    const inHand = p.seat >= 0 && p.hand.length && (this.phase === 'play' || this.phase === 'dealer');
    if (this.game === 'tienlen' && inHand) {
      // bot chơi thay phần bài còn lại
      const b = this.makeBot(p.seat);
      Object.assign(b, { hand: p.hand, chips: p.chips, played: p.played, name: p.name + ' (máy)' });
      this.players.delete(p.id);
      this.players.set(b.id, b);
      this.seats[p.seat] = b.id;
    } else {
      this.players.delete(p.id);
      if (p.seat >= 0) this.seats[p.seat] = null;
      if (this.game === 'xidach' && this.turn === p.seat && this.phase === 'play') this.nextTurn();
    }
    if (!this.count) { this.phase = 'wait'; this.seats.fill(null); for (const q of [...this.players.values()]) this.players.delete(q.id); }
    this.sendState();
    this.hub.roomsChanged();
  }

  makeBot(seat) {
    const used = new Set([...this.players.values()].map(q => q.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Máy ' + (nextBotId % 100);
    return { id: nextBotId++, ws: null, name, char: pick(CHARACTERS).id, bot: true, seat,
      chips: this.game === 'xidach' ? XD.startChips : TL.startChips, hand: [], bet: 100, ready: true, think: 0 };
  }

  // Đầu mỗi ván: người chờ được ngồi (bot nhường ghế), rồi lấp bot cho đủ bàn
  rebalance() {
    const humans = [...this.players.values()].filter(q => !q.bot);
    for (const h of humans) if (h.seat < 0) {
      let s = this.seats.indexOf(null);
      if (s < 0) { const bot = [...this.players.values()].find(q => q.bot && q.seat >= 0); if (bot) { s = bot.seat; this.players.delete(bot.id); this.seats[s] = null; } }
      if (s >= 0) this.sit(h, s);
    }
    const seatedHumans = humans.filter(h => h.seat >= 0).length;
    const want = this.game === 'tienlen' ? TL.seats - seatedHumans : Math.max(0, 3 - seatedHumans);   // xì dách: ít nhất 3 người chơi (thiếu thì lấp bot)
    let bots = [...this.players.values()].filter(q => q.bot);
    while (bots.length > want) { const b = bots.pop(); this.players.delete(b.id); this.seats[b.seat] = null; }
    while (bots.length < want) {
      const s = this.seats.indexOf(null);
      if (s < 0) break;
      const b = this.makeBot(s);
      this.players.set(b.id, b); this.seats[s] = b.id; bots.push(b);
    }
  }

  seated() { return this.seats.map(id => (id == null ? null : this.players.get(id))).filter(Boolean); }
  bySeat(s) { const id = this.seats[s]; return id == null ? null : this.players.get(id); }

  // ================= Tin nhắn =================
  onMessage(id, m) {
    const p = this.players.get(id);
    if (!p) return;
    switch (m.t) {
      case 'chat': { const msg = String(m.msg || '').slice(0, 140).trim(); if (msg) this.broadcast({ t: 'chat', id: p.id, name: p.name, msg }); return; }
      case 'char': p.char = getChar(m.char).id; this.sendState(); return;
      case 'cbet':
        if (this.game !== 'xidach' || this.phase !== 'bet' || p.seat < 0) return;
        if (XD.bets.includes(+m.v)) p.bet = Math.min(+m.v, Math.max(XD.bets[0], p.chips));
        this.sendState(); return;
      case 'cready':
        if (this.phase !== 'bet' || p.seat < 0) return;
        p.ready = true;
        if (this.seated().every(q => q.ready)) this.deadline = 0;
        this.sendState(); return;
      case 'chit': if (this.game === 'xidach') this.xdHit(p); return;
      case 'cstand': if (this.game === 'xidach') this.xdStand(p, false); return;
      case 'cplay': if (this.game === 'tienlen' && Array.isArray(m.cards)) this.tlPlay(p, m.cards.map(Number)); return;
      case 'cpass': if (this.game === 'tienlen') this.tlPass(p); return;
    }
  }

  // ================= Vòng lặp =================
  tick() {
    const t = now();
    if (!this.count) return;
    if (this.phase === 'wait') return this.startRound();
    if (t >= this.deadline) {
      if (this.phase === 'bet' || this.phase === 'result') return this.startRound(true);
      if (this.phase === 'play') return this.game === 'xidach' ? this.xdTimeout() : this.tlTimeout();
      if (this.phase === 'dealer') return this.xdDealerStep();
    }
    // bot tới lượt
    const cur = this.phase === 'play' ? this.bySeat(this.turn) : null;
    if (cur?.bot) {
      if (!cur.think) cur.think = t + 0.9 + Math.random() * 0.9;
      if (t >= cur.think) { cur.think = 0; this.game === 'xidach' ? this.xdBot(cur) : this.tlBot(cur); }
    }
  }

  startRound(fromTimer) {
    if (this.game === 'xidach') {
      // xì dách: giai đoạn đặt cược trước, hết giờ (hoặc mọi người sẵn sàng) mới chia
      if (this.phase !== 'bet') return this.xdBetPhase();
      return this.xdDeal();
    }
    return this.tlDeal();
  }

  // Trạng thái gửi cho từng người: chỉ thấy bài của mình (và bài đã lật)
  view(viewer) {
    const reveal = this.phase === 'result';
    const v = {
      t: 'cs', game: this.game, phase: this.phase, left: Math.max(0, +(this.deadline - now()).toFixed(1)), turn: this.turn, msg: this.msg,
      you: viewer.seat, games: this.games,
      seats: this.seats.map((id, i) => {
        const p = id == null ? null : this.players.get(id);
        if (!p) return null;
        const own = p === viewer, open = own || reveal || (this.game === 'xidach' && p.done && p.bust);
        const o = { seat: i, id: p.id, name: p.name, char: p.char, bot: p.bot, chips: p.chips, n: p.hand.length, cards: open ? p.hand : [] };
        if (this.game === 'xidach') Object.assign(o, { bet: p.bet, ready: p.ready, done: !!p.done });
        else Object.assign(o, { passed: !!this.passed?.has(i) });
        if (open && this.game === 'xidach' && p.hand.length) Object.assign(o, { score: xdScore(p.hand), kind: xdKind(p.hand) });
        if (p.result) o.result = p.result;
        return o;
      }),
    };
    if (this.game === 'xidach') {
      const d = this.dealer, open = d.open || reveal;
      v.dealer = { name: d.name, char: d.char, n: d.hand.length, cards: open ? d.hand : [] };
      if (open && d.hand.length) Object.assign(v.dealer, { score: xdScore(d.hand), kind: xdKind(d.hand) });
    } else {
      v.trick = this.trick ? { cards: this.trick.cards, by: this.trick.by, type: this.trick.combo.type } : null;
      v.must = this.mustHave ?? -1;
    }
    return v;
  }
  sendState() { for (const p of this.players.values()) if (!p.bot) this.send(p, this.view(p)); }

  // ================= Xì dách =================
  xdBetPhase() {
    this.rebalance();
    this.phase = 'bet';
    this.deadline = now() + 9;
    this.turn = -1;
    this.dealer.hand = []; this.dealer.open = false;
    for (const p of this.players.values()) {
      Object.assign(p, { hand: [], done: false, bust: false, result: null, ready: p.bot });
      if (p.chips < XD.bets[0]) { p.chips = XD.startChips; if (!p.bot) this.send(p, { t: 'sys', msg: `💰 Hết tiền — được cấp lại ${XD.startChips} xu` }); }
      p.bet = Math.min(p.bet || 100, p.chips);
    }
    this.msg = 'Đặt cược rồi bấm Sẵn sàng';
    this.sendState();
  }

  xdDeal() {
    const ps = this.seated();
    if (!ps.length) { this.phase = 'wait'; return; }
    this.games++;
    this.deck = newDeck();
    for (let r = 0; r < 2; r++) { for (const p of ps) p.hand.push(this.deck.pop()); this.dealer.hand.push(this.deck.pop()); }
    for (const p of ps) { const k = xdKind(p.hand); if (k === 'xibang' || k === 'xidach') p.done = true; }
    // nhà cái có xì bàng / xì dách: lật bài, tính tiền ngay
    const dk = xdKind(this.dealer.hand);
    if (dk === 'xibang' || dk === 'xidach') {
      this.dealer.open = true;
      this.msg = `Nhà cái có ${XD_KIND[dk]}!`;
      return this.xdSettle();
    }
    this.phase = 'play';
    this.turn = -1;
    this.msg = 'Đã chia bài';
    this.nextTurn();
  }

  // lượt người kế tiếp chưa dằn; hết người thì tới nhà cái
  nextTurn() {
    for (let s = this.turn + 1; s < this.seatCount; s++) {
      const p = this.bySeat(s);
      if (p && p.hand.length && !p.done) { this.turn = s; this.deadline = now() + 20; this.sendState(); return; }
    }
    this.phase = 'dealer';
    this.turn = -1;
    this.dealer.open = true;
    this.deadline = now() + 1.1;
    this.msg = 'Nhà cái lật bài';
    this.sendState();
  }

  xdHit(p) {
    if (this.phase !== 'play' || this.turn !== p.seat || p.done) return;
    if (p.hand.length >= XD.maxCards || xdScore(p.hand) >= 21) return;
    p.hand.push(this.deck.pop());
    const k = xdKind(p.hand), s = xdScore(p.hand);
    this.msg = `${p.name} rút bài`;
    if (k === 'quac') { p.done = true; p.bust = true; this.msg = `${p.name} quắc (${s} điểm)!`; return this.nextTurn(); }
    if (s === 21 || p.hand.length >= XD.maxCards) { p.done = true; return this.nextTurn(); }
    this.deadline = now() + 20;
    this.sendState();
  }

  xdStand(p, force) {
    if (this.phase !== 'play' || this.turn !== p.seat || p.done) return;
    if (!force && xdScore(p.hand) < XD.minStand) return this.send(p, { t: 'sys', msg: `Chưa đủ ${XD.minStand} điểm, phải rút thêm` });
    p.done = true;
    this.msg = `${p.name} dằn bài`;
    this.nextTurn();
  }

  xdTimeout() {
    const p = this.bySeat(this.turn);
    if (!p) return this.nextTurn();
    if (xdScore(p.hand) < XD.minStand && p.hand.length < XD.maxCards) this.xdHit(p); else this.xdStand(p, true);
  }

  xdBot(p) {
    const s = xdScore(p.hand);
    if (s < XD.minStand || (s < 18 && p.hand.length < XD.maxCards && Math.random() < 0.3)) this.xdHit(p);
    else this.xdStand(p, true);
  }

  // nhà cái rút từng lá (mỗi 0.9 giây) cho tới khi đủ tuổi
  xdDealerStep() {
    const d = this.dealer, s = xdScore(d.hand);
    const want = d.hand.length < XD.maxCards && (s < XD.dealerMin || (s < 17 && Math.random() < 0.5));
    if (want) {
      d.hand.push(this.deck.pop());
      this.msg = `Nhà cái rút bài (${xdScore(d.hand)} điểm)`;
      this.deadline = now() + 0.9;
      this.sendState();
      return;
    }
    this.xdSettle();
  }

  xdSettle() {
    const d = this.dealer.hand;
    for (const p of this.seated()) {
      if (!p.hand.length) continue;
      const c = xdCompare(p.hand, d), delta = c.r * p.bet * c.mult;
      p.chips += delta;
      p.result = { r: c.r, delta, kind: xdKind(p.hand) };
    }
    const dk = xdKind(d);
    this.msg = `Nhà cái: ${dk === 'normal' ? xdScore(d) + ' điểm' : XD_KIND[dk] + (dk === 'quac' ? ` (${xdScore(d)})` : '')}`;
    this.phase = 'result';
    this.turn = -1;
    this.deadline = now() + 6;
    this.sendState();
  }

  // ================= Tiến lên =================
  tlDeal() {
    this.rebalance();
    const ps = this.seated();
    if (ps.length < 2) { this.phase = 'wait'; return; }
    this.games++;
    this.deck = newDeck();
    for (const p of ps) { p.hand = this.deck.splice(0, TL.handSize).sort((a, b) => a - b); p.result = null; p.played = false; }
    // ván đầu: ai cầm 3♠ đánh trước và phải đánh lá đó; các ván sau: người thắng ván trước đánh trước
    const lastWin = this.lastWinner != null ? this.bySeat(this.lastWinner) : null;
    if (lastWin?.hand.length) { this.turn = this.lastWinner; this.mustHave = -1; }
    else {
      const holder = ps.reduce((a, b) => (Math.min(...a.hand) <= Math.min(...b.hand) ? a : b));
      this.turn = holder.seat; this.mustHave = Math.min(...holder.hand);
    }
    this.trick = null;
    this.passed = new Set();
    this.phase = 'play';
    this.deadline = now() + TL.turnTime;
    this.msg = `${this.bySeat(this.turn).name} đánh trước` + (this.mustHave >= 0 ? ` (phải có ${cardLabel(this.mustHave)})` : '');
    this.sendState();
  }

  tlPlay(p, cards) {
    if (this.phase !== 'play' || this.turn !== p.seat) return;
    const reject = why => this.send(p, { t: 'cno', msg: why });
    if (!cards.length || cards.some(c => !p.hand.includes(c))) return reject('Bài không hợp lệ');
    const combo = tlCombo(cards);
    if (!combo) return reject('Bộ bài không hợp lệ (rác, đôi, sám, tứ quý, sảnh, đôi thông)');
    if (this.mustHave >= 0 && !cards.includes(this.mustHave)) return reject(`Lượt đầu phải đánh lá ${cardLabel(this.mustHave)}`);
    if (!tlBeats(combo, this.trick?.combo)) return reject('Không chặn được bài trên bàn');
    const chop = this.trick && combo.type !== this.trick.combo.type;
    p.hand = p.hand.filter(c => !cards.includes(c));
    p.played = true;
    this.mustHave = -1;
    this.trick = { cards: [...cards].sort((a, b) => a - b), combo, by: p.seat };
    this.msg = `${p.name}: ${TL_NAME[combo.type]}${chop ? ' — CHẶT!' : ''}`;
    if (chop) this.sys(`💥 ${p.name} chặt bằng ${TL_NAME[combo.type]}!`);
    if (!p.hand.length) return this.tlFinish(p);
    this.tlNext();
  }

  tlPass(p) {
    if (this.phase !== 'play' || this.turn !== p.seat || !this.trick || this.trick.by === p.seat) return;
    this.passed.add(p.seat);
    this.msg = `${p.name} bỏ lượt`;
    this.tlNext();
  }

  // lượt kế tiếp theo chiều kim đồng hồ; mọi người khác đã bỏ thì người đánh cuối được đánh tự do
  tlNext() {
    for (let i = 1; i <= this.seatCount; i++) {
      const s = (this.turn + i) % this.seatCount, q = this.bySeat(s);
      if (!q || !q.hand.length) continue;
      if (this.trick && s === this.trick.by) { this.trick = null; this.passed.clear(); this.turn = s; this.msg = `${q.name} được đánh tự do`; break; }
      if (!this.passed.has(s)) { this.turn = s; break; }
    }
    this.deadline = now() + TL.turnTime;
    this.sendState();
  }

  tlTimeout() {
    const p = this.bySeat(this.turn);
    if (!p) return this.tlNext();
    const mv = !this.trick ? tlSuggest(p.hand, null, this.mustHave) : null;
    if (mv) this.tlPlay(p, mv); else this.tlPass(p);
  }

  tlBot(p) {
    const mv = tlSuggest(p.hand, this.trick?.combo || null, this.mustHave);
    if (mv) this.tlPlay(p, mv); else this.tlPass(p);
  }

  // Có người hết bài: thắng ván. Người còn bài trả tiền theo số lá còn lại (chưa đánh lá nào: "cháy", trả gấp đôi)
  tlFinish(w) {
    let total = 0;
    const rest = this.seated().filter(q => q !== w).sort((a, b) => a.hand.length - b.hand.length);
    for (const q of rest) {
      const burn = !q.played, pay = q.hand.length * TL.payPerCard * (burn ? 2 : 1);
      q.chips -= pay; total += pay;
      q.result = { r: -1, delta: -pay, left: q.hand.length, burn };
    }
    w.chips += total;
    w.result = { r: 1, delta: total, rank: 1 };
    rest.forEach((q, i) => { q.result.rank = i + 2; });
    for (const q of this.seated()) if (q.chips < 0) { q.chips = TL.startChips; if (!q.bot) this.send(q, { t: 'sys', msg: `💰 Hết tiền — được cấp lại ${TL.startChips} xu` }); }
    this.lastWinner = w.seat;
    this.msg = `🏆 ${w.name} về nhất!`;
    this.sys(`🏆 ${w.name} thắng ván, nhận ${total} xu`);
    this.phase = 'result';
    this.turn = -1;
    this.deadline = now() + 8;
    this.sendState();
  }
}
