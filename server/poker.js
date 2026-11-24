import { randomInt } from 'node:crypto';
import { CardRoom } from './cards.js';
import { newDeck } from '../shared/cards.js';
import { POKER, pokerValue, pokerScore, pokerCategory } from '../shared/poker.js';

export class PokerRoom extends CardRoom {
  constructor(id, name, hub) {
    super(id, name, hub, 'poker', POKER);
    this.blinds = { small: POKER.small, big: POKER.big };
    this.button = -1;
    this.board = [];
    this.pokerSeats = new Map();
  }

  configureRules(m, chips) {
    const blinds = m.blinds === undefined ? this.blinds : m.blinds;
    if (!blinds || !Number.isInteger(blinds.small) || !Number.isInteger(blinds.big) ||
        blinds.small < 1 || blinds.small >= blinds.big || blinds.big > chips) {
      return 'Mù nhỏ phải nhỏ hơn mù lớn. Mù lớn phải trong mức vốn ban đầu.';
    }
    this.blinds = { small: blinds.small, big: blinds.big };
  }

  canChangeBots() { return this.phase === 'lobby'; }

  toLobby() {
    this.board = [];
    this.pokerSeats.clear();
    super.toLobby();
  }

  // Tìm ghế theo chiều đánh, từ ghế kế tiếp và đi tối đa một vòng.
  nextPokerSeat(from, predicate = () => true) {
    for (let step = 1; step <= this.seatCount; step++) {
      const seat = (from + step) % this.seatCount, state = this.pokerSeats.get(seat);
      if (state && predicate(state)) return seat;
    }
    return -1;
  }

  startRound() {
    this.rebalance();
    const players = this.seated();
    if (players.length < 2) return this.toLobby();
    this.games++;
    this.board = [];
    this.showdown = false;
    this.street = 0;
    this.phase = 'play';
    this.deck = newDeck(() => randomInt(2 ** 32) / (2 ** 32));
    this.pokerSeats = new Map(players.map(p => [p.seat, {
      seat: p.seat, folded: false, streetBet: 0, total: 0, actedAt: null,
    }]));
    this.button = this.nextPokerSeat(this.button);
    this.smallSeat = players.length === 2 ? this.button : this.nextPokerSeat(this.button);
    this.bigSeat = this.nextPokerSeat(this.smallSeat);
    for (const p of players) {
      this.refillChips(p, 1);
      p.hand = this.deck.splice(0, 2);
      p.result = null;
      p.think = 0;
    }
    this.currentBet = this.minRaise = this.blinds.big;
    this.addBet(this.pokerSeats.get(this.smallSeat), this.blinds.small);
    this.addBet(this.pokerSeats.get(this.bigSeat), this.blinds.big);
    this.msg = 'Preflop · Đã đặt tiền mù';
    this.advance(this.bigSeat);
  }

  addBet(state, amount) {
    const player = this.bySeat(state.seat);
    const paid = Math.min(amount, player.chips);
    player.chips -= paid;
    state.streetBet += paid;
    state.total += paid;
  }

  activeSeats() { return [...this.pokerSeats.values()].filter(state => !state.folded); }

  actionOptions(state, active = this.activeSeats()) {
    const player = this.bySeat(state.seat);
    const canContest = active.some(other => other !== state && this.bySeat(other.seat).chips > 0);
    // Một mình còn xu chỉ cần theo bằng khoản đã đặt của các ghế tất tay.
    const target = canContest ? this.currentBet : Math.max(0, ...active.filter(other => other !== state).map(other => other.streetBet));
    const owed = Math.max(0, target - state.streetBet);
    const maxTo = state.streetBet + player.chips;
    const minTo = this.currentBet + this.minRaise;
    const reopened = state.actedAt === null || this.currentBet - state.actedAt >= this.minRaise;
    const mayRaise = canContest && reopened && maxTo > this.currentBet;
    return { owed, call: Math.min(owed, player.chips), minTo, maxTo, canRaise: mayRaise && maxTo >= minTo,
      canAllIn: player.chips > 0 && (player.chips <= owed || mayRaise), pending: Boolean(owed || (canContest && state.actedAt === null)) };
  }

  onMessage(id, m) {
    if (m.t !== 'cpoker') return super.onMessage(id, m);
    const p = this.players.get(id);
    if (p?.seat >= 0) this.playPoker(p, m.action, m.to);
  }

  playPoker(p, action, amount) {
    if (this.phase !== 'play' || this.turn !== p.seat) return;
    const state = this.pokerSeats.get(p.seat);
    if (!state || state.folded || !p.chips) return;
    const options = this.actionOptions(state);
    const reject = msg => this.send(p, { t: 'cno', msg });
    if (action === 'fold') state.folded = true;
    else if (action === 'check') {
      if (options.owed) return reject('Bạn cần theo cược hoặc bỏ bài.');
    } else if (action === 'call') {
      if (!options.owed) return reject('Chưa có khoản cược để theo.');
      this.addBet(state, options.call);
    } else if (action === 'raise' || action === 'allin') {
      const allIn = action === 'allin';
      const to = allIn ? options.maxTo : amount;
      if (allIn ? !options.canAllIn : !options.canRaise || !Number.isSafeInteger(to) || to < options.minTo || to > options.maxTo) {
        return reject('Mức tố không hợp lệ hoặc chưa được mở quyền tố lại.');
      }
      this.addBet(state, to - state.streetBet);
      const raised = to - this.currentBet;
      if (raised > 0) {
        if (raised >= this.minRaise) this.minRaise = raised;
        this.currentBet = to;
      }
    } else return reject('Hành động Poker không hợp lệ.');
    state.actedAt = this.currentBet;
    const labels = { fold: 'bỏ bài', check: 'qua', call: 'theo', raise: 'tố', allin: 'tất tay' };
    this.msg = p.name + ' ' + labels[action] + (action === 'raise' ? ' lên ' + state.streetBet + ' xu' : '');
    this.advance(p.seat);
  }

  advance(from) {
    while (true) {
      const active = this.activeSeats();
      if (active.length === 1) return this.finishPoker(active);
      this.turn = this.nextPokerSeat(from, state => !state.folded && this.bySeat(state.seat).chips > 0 && this.actionOptions(state, active).pending);
      if (this.turn >= 0) {
        this.setTurnDeadline(this.turnTime);
        this.sendState();
        return;
      }
      if (this.street === 3) return this.finishPoker(active);
      this.street++;
      this.deck.pop(); // Bỏ một lá trước khi mở mỗi vòng.
      this.board.push(...this.deck.splice(0, this.street === 1 ? 3 : 1));
      for (const state of this.pokerSeats.values()) Object.assign(state, { streetBet: 0, actedAt: null });
      this.currentBet = 0;
      this.minRaise = this.blinds.big;
      this.msg = 'Đã mở bài chung';
      from = this.button;
    }
  }

  finishPoker(active) {
    this.showdown = active.length > 1;
    const scores = new Map(this.showdown ? active.map(state => [state.seat, pokerScore([...this.bySeat(state.seat).hand, ...this.board])]) : []);
    const seats = [...this.pokerSeats.values()];
    const shares = new Map(seats.map(state => [state.seat, { payout: 0, refund: 0 }]));
    const levels = [...new Set(seats.map(state => state.total).filter(Boolean))].sort((a, b) => a - b);
    let previous = 0;
    for (const level of levels) {
      const contributors = seats.filter(state => state.total >= level);
      const pot = (level - previous) * contributors.length;
      previous = level;
      if (contributors.length === 1) {
        shares.get(contributors[0].seat).refund += pot;
        continue;
      }
      const eligible = contributors.filter(state => !state.folded);
      const best = Math.max(...eligible.map(state => scores.get(state.seat) ?? 0));
      const winners = eligible.filter(state => (scores.get(state.seat) ?? 0) === best);
      // Xu lẻ khi hòa đi theo chiều từ ghế bên trái nút chia.
      let extra = pot % winners.length;
      let seat = this.button;
      for (let i = 0; i < winners.length; i++) {
        seat = this.nextPokerSeat(seat, state => winners.includes(state));
        shares.get(seat).payout += Math.floor(pot / winners.length) + (extra-- > 0 ? 1 : 0);
      }
    }
    for (const state of seats) {
      const p = this.bySeat(state.seat), { payout, refund } = shares.get(state.seat);
      const delta = payout + refund - state.total;
      p.chips += payout + refund;
      p.result = { r: Math.sign(delta), delta, payout, refund, hand: scores.has(p.seat) ? pokerCategory(scores.get(p.seat)) : null };
    }
    this.turn = -1;
    this.phase = 'result';
    this.msg = this.showdown ? 'So bài và chia hũ' : 'Các ghế khác đã bỏ bài';
    this.deadline = performance.now() / 1000 + 8;
    this.sendState();
  }

  playTimeout() {
    const player = this.bySeat(this.turn);
    if (!player) return;
    this.playPoker(player, this.actionOptions(this.pokerSeats.get(player.seat)).owed ? 'fold' : 'check');
  }

  botPlay(p) {
    const options = this.actionOptions(this.pokerSeats.get(p.seat));
    const [a, b] = p.hand.map(pokerValue);
    const strong = this.street ? pokerCategory(pokerScore([...p.hand, ...this.board])) >= 2
      : a === b || Math.min(a, b) >= 11;
    if (strong && options.canRaise && p.chips > options.call + this.blinds.big) return this.playPoker(p, 'raise', options.minTo);
    if (!options.owed) return this.playPoker(p, 'check');
    const pot = [...this.pokerSeats.values()].reduce((sum, state) => sum + state.total, 0);
    this.playPoker(p, strong || options.call <= Math.max(this.blinds.big, pot / 5) ? 'call' : 'fold');
  }

  canSeeHand(p, viewer) {
    return p === viewer || (this.phase === 'result' && this.showdown && this.pokerSeats.get(p.seat)?.folded === false);
  }

  view(viewer) {
    const view = super.view(viewer);
    view.rules.blinds = this.blinds;
    const betting = this.phase === 'play', hand = this.phase !== 'lobby';
    const pot = betting ? [...this.pokerSeats.values()].reduce((sum, state) => sum + state.total, 0)
      : hand ? this.seated().reduce((sum, player) => sum + (player.result?.payout ?? 0), 0) : 0;
    const state = this.pokerSeats.get(viewer.seat);
    view.poker = {
      board: this.board, pot, street: this.street ?? 0, button: hand ? this.button : -1,
      smallSeat: hand ? this.smallSeat : -1, bigSeat: hand ? this.bigSeat : -1,
      options: betting && state && this.turn === viewer.seat ? this.actionOptions(state) : null,
    };
    if (hand) for (const p of view.seats) {
      const seat = p && this.pokerSeats.get(p.seat);
      if (seat) Object.assign(p, { folded: seat.folded, allIn: betting && !seat.folded && !p.chips, streetBet: seat.streetBet });
    }
    return view;
  }
}
