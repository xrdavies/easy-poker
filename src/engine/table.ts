import { cryptoRandom, freshDeck, isSevenDeuceOffsuit, shuffle } from "./cards.ts";
import { generatePassword, generateTableNumber, normalizeConfig } from "./config.ts";
import { buildSidePots, splitOddChips } from "./pots.ts";
import { compareHand, evaluateBest, rankName, type HandValue } from "./rank.ts";
import {
  ACTION_MS,
  HAND_PAUSE_MS,
  MAX_SEATS,
  PokerError,
  RUNOUT_VOTE_MS,
  type ActionType,
  type Card,
  type CreateTableInput,
  type GameEvent,
  type HandState,
  type LegalActions,
  type PlayerState,
  type RuntimeOpts,
  type RunoutVote,
  type Settlement,
  type SquidState,
  type Street,
  type TableConfig,
  type TableStatus,
} from "./types.ts";

export interface TableJSON {
  tableNumber: string;
  password: string;
  config: TableConfig;
  status: TableStatus;
  seats: (string | null)[];
  players: PlayerState[];
  buttonSeat: number | null;
  firstDealAt: number | null;
  endsAt: number | null;
  hand: HandState | null;
  squid: SquidState | null;
  settlement: Settlement | null;
  events: GameEvent[];
  lastResult: LastResult | null;
  closing: boolean;
  nextHandNumber: number;
  bountyPaid: string[];
  nextHandAt: number | null;
  runoutVote: RunoutVote | null;
}

export interface LastResult {
  handNumber: number;
  board: Card[];
  shown: Record<string, Card[]>;
  winners: { id: string; amount: number; handName?: string }[];
  pot: number;
  uncontested: boolean;
  foldedIds: string[];
  timeoutIds: string[];
  runs: { board: Card[]; winners: { id: string; amount: number; handName?: string }[] }[];
}

export interface SeatView {
  playerId: string;
  nickname: string;
  chips: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  sitting: boolean;
  holeCards?: Card[];
  isButton: boolean;
  isSb: boolean;
  isBb: boolean;
  isStraddle: boolean;
  hasSquid: boolean;
  acting: boolean;
  inHand: boolean;
  pendingChips: number;
}

export interface ClientSnapshot {
  tableNumber: string;
  password: string;
  config: TableConfig;
  status: TableStatus;
  now: number;
  endsAt: number | null;
  remainingMs: number | null;
  seats: (SeatView | null)[];
  spectators: { id: string; nickname: string }[];
  board: Card[];
  pot: number;
  street: Street | null;
  actingPlayerId: string | null;
  actionDeadline: number | null;
  legal: LegalActions | null;
  me: {
    id: string;
    nickname: string;
    seat: number | null;
    chips: number;
    buyinCount: number;
    holeCards?: Card[];
    sitting: boolean;
    pendingChips: number;
  } | null;
  handNumber: number;
  buttonSeat: number | null;
  sbSeat: number | null;
  bbSeat: number | null;
  straddleSeat: number | null;
  squid: SquidState | null;
  settlement: Settlement | null;
  events: GameEvent[];
  lastResult: LastResult | null;
  nextHandAt: number | null;
  invitePath: string;
  runoutVote: RunoutVote | null;
}

export interface StartHandOpts {
  deck?: Card[];
  straddle?: boolean;
}

export interface ActionInput {
  type: ActionType;
  amount?: number;
}

function defaultRandom(): number {
  return cryptoRandom();
}

function emptyPlayer(id: string, nickname: string): PlayerState {
  return {
    id,
    nickname,
    seat: null,
    sitting: false,
    chips: 0,
    buyinCount: 0,
    buyinChips: 0,
    holeCards: null,
    folded: false,
    allIn: false,
    inHand: false,
    betThisStreet: 0,
    committed: 0,
    actedThisStreet: false,
    shown: false,
    autoStraddle: false,
    pendingBuyinChips: 0,
  };
}

export class Table {
  tableNumber: string;
  password: string;
  config: TableConfig;
  status: TableStatus = "waiting";
  seats: (string | null)[] = Array.from({ length: MAX_SEATS }, () => null);
  players = new Map<string, PlayerState>();
  buttonSeat: number | null = null;
  firstDealAt: number | null = null;
  endsAt: number | null = null;
  hand: HandState | null = null;
  squid: SquidState | null = null;
  settlement: Settlement | null = null;
  events: GameEvent[] = [];
  lastResult: LastResult | null = null;
  closing = false;
  nextHandNumber = 1;
  nextHandAt: number | null = null;
  bountyPaid = new Set<string>();
  runoutVote: RunoutVote | null = null;
  lastTimeoutIds: string[] = [];
  now: () => number;
  random: () => number;

  constructor(init: { tableNumber: string; password: string; config: TableConfig }, runtime?: RuntimeOpts) {
    this.tableNumber = init.tableNumber;
    this.password = init.password;
    this.config = init.config;
    this.now = runtime?.now ?? Date.now;
    this.random = runtime?.random ?? defaultRandom;
  }

  static fromJSON(data: TableJSON, runtime?: RuntimeOpts): Table {
    const t = new Table(
      { tableNumber: data.tableNumber, password: data.password, config: data.config },
      runtime,
    );
    t.status = data.status;
    t.seats = data.seats.slice();
    t.players = new Map(
      data.players.map((p) => [
        p.id,
        { ...p, holeCards: p.holeCards ? p.holeCards.slice() : null, pendingBuyinChips: p.pendingBuyinChips ?? 0 },
      ]),
    );
    t.buttonSeat = data.buttonSeat;
    t.firstDealAt = data.firstDealAt;
    t.endsAt = data.endsAt;
    t.hand = data.hand
      ? {
          ...data.hand,
          deck: data.hand.deck.slice(),
          board: data.hand.board.slice(),
          pots: data.hand.pots.map((p) => ({ ...p, eligible: p.eligible.slice() })),
        }
      : null;
    t.squid = data.squid
      ? { participants: data.squid.participants.slice(), holders: data.squid.holders.slice() }
      : null;
    t.settlement = data.settlement;
    t.events = data.events.slice();
    t.lastResult = data.lastResult
      ? {
          ...data.lastResult,
          board: data.lastResult.board.slice(),
          winners: data.lastResult.winners.slice(),
          shown: { ...data.lastResult.shown },
          uncontested: data.lastResult.uncontested ?? Object.keys(data.lastResult.shown ?? {}).length === 0,
          foldedIds: data.lastResult.foldedIds?.slice() ?? [],
          timeoutIds: data.lastResult.timeoutIds?.slice() ?? [],
          runs: (data.lastResult.runs ?? [{ board: data.lastResult.board, winners: data.lastResult.winners }]).map(
            (r) => ({ board: r.board.slice(), winners: r.winners.slice() }),
          ),
        }
      : null;
    t.closing = data.closing;
    t.nextHandNumber = data.nextHandNumber;
    t.nextHandAt = data.nextHandAt ?? null;
    t.bountyPaid = new Set(data.bountyPaid ?? []);
    t.runoutVote = data.runoutVote
      ? { deadline: data.runoutVote.deadline, choices: { ...data.runoutVote.choices } }
      : null;
    t.lastTimeoutIds = [];
    return t;
  }

  toJSON(): TableJSON {
    return {
      tableNumber: this.tableNumber,
      password: this.password,
      config: this.config,
      status: this.status,
      seats: this.seats.slice(),
      players: [...this.players.values()].map((p) => ({
        ...p,
        holeCards: p.holeCards ? p.holeCards.slice() : null,
      })),
      buttonSeat: this.buttonSeat,
      firstDealAt: this.firstDealAt,
      endsAt: this.endsAt,
      hand: this.hand
        ? {
            ...this.hand,
            deck: this.hand.deck.slice(),
            board: this.hand.board.slice(),
            pots: this.hand.pots.map((p) => ({ ...p, eligible: p.eligible.slice() })),
          }
        : null,
      squid: this.squid
        ? { participants: this.squid.participants.slice(), holders: this.squid.holders.slice() }
        : null,
      settlement: this.settlement,
      events: this.events.slice(),
      lastResult: this.lastResult,
      closing: this.closing,
      nextHandNumber: this.nextHandNumber,
      nextHandAt: this.nextHandAt,
      bountyPaid: [...this.bountyPaid],
      runoutVote: this.runoutVote ? { deadline: this.runoutVote.deadline, choices: { ...this.runoutVote.choices } } : null,
    };
  }

  getInvite(): { tableNumber: string; password: string; path: string } {
    return {
      tableNumber: this.tableNumber,
      password: this.password,
      path: `/?t=${this.tableNumber}&p=${this.password}`,
    };
  }

  buyinChipsFor(n: number): number {
    return n * 100 * this.config.bigBlind;
  }

  addPlayer(playerId: string, nickname: string, password: string): PlayerState {
    if (this.status === "finished") {
      if (password !== this.password) throw new PokerError("wrong_password", "密码错误");
      return this.ensurePlayer(playerId, nickname);
    }
    if (password !== this.password) throw new PokerError("wrong_password", "密码错误");
    return this.ensurePlayer(playerId, nickname);
  }

  private ensurePlayer(playerId: string, nickname: string): PlayerState {
    const existing = this.players.get(playerId);
    if (existing) {
      if (nickname) existing.nickname = nickname;
      return existing;
    }
    const p = emptyPlayer(playerId, nickname);
    this.players.set(playerId, p);
    return p;
  }

  sit(playerId: string, buyinCount = 0): number {
    this.assertNotFinished();
    const p = this.requirePlayer(playerId);
    if (p.sitting) throw new PokerError("already_seated", "已经坐下");
    const empty = this.emptySeats();
    if (empty.length === 0) throw new PokerError("table_full", "游戏桌已满 8 人");
    const n = Math.floor(buyinCount);
    if (p.chips <= 0) {
      if (!Number.isInteger(n) || n < 1) throw new PokerError("invalid_buyin", "坐下时需要至少 1 次 buyin");
      this.applyBuyin(p, n, "now");
    } else if (n > 0) {
      this.applyBuyin(p, n, "now");
    }
    const seat = empty[Math.floor(this.random() * empty.length)]!;
    p.seat = seat;
    p.sitting = true;
    this.seats[seat] = p.id;
    this.maybeJoinSquid(p.id);
    this.maybeScheduleNextHand();
    return seat;
  }

  stand(playerId: string): void {
    this.assertNotFinished();
    const p = this.requirePlayer(playerId);
    if (!p.sitting || p.seat === null) throw new PokerError("not_seated", "未坐下");
    if (p.inHand && this.hand) {
      if (this.hand.actingPlayerId === p.id) {
        this.applyAction(p.id, { type: "fold" });
      } else if (!p.folded) {
        p.folded = true;
        p.actedThisStreet = true;
        this.events.push({ type: "fold", playerId: p.id });
        if (this.livePlayers().length <= 1) this.awardUncontested();
      }
    }
    if (this.config.squidEnabled && this.squid) {
      this.onLeaveSquid(p.id);
    }
    this.seats[p.seat] = null;
    p.sitting = false;
    p.seat = null;
    p.inHand = false;
    if (!this.canStartHand()) this.nextHandAt = null;
  }

  rebuy(playerId: string, n: number): void {
    this.assertNotFinished();
    const p = this.requirePlayer(playerId);
    if (!p.sitting) throw new PokerError("not_seated", "未坐下");
    this.applyBuyin(p, n, "next");
    this.maybeScheduleNextHand();
  }

  setAutoStraddle(playerId: string, on: boolean): void {
    this.requirePlayer(playerId).autoStraddle = on;
  }

  showCards(playerId: string): void {
    const p = this.requirePlayer(playerId);
    if (!p.holeCards) throw new PokerError("no_cards", "没有手牌可展示");
    p.shown = true;
    if (this.lastResult) this.lastResult.shown[p.id] = p.holeCards.slice();
    this.maybePayBounty(p, this.potWinnersThisHand(p.id));
  }

  startHand(opts: StartHandOpts = {}): void {
    this.assertNotFinished();
    if (this.hand) throw new PokerError("hand_in_progress", "当前手牌尚未结束");
    if (this.closing || (this.endsAt !== null && this.now() >= this.endsAt)) {
      this.settle("duration");
      throw new PokerError("table_finished", "游戏桌已结束");
    }
    this.applyPendingBuyins();
    const eligible = this.seated().filter((p) => p.chips > 0);
    if (eligible.length < 2) throw new PokerError("need_two_players", "至少两名有筹码的玩家才能发牌");

    this.events = [];
    this.lastResult = null;
    this.lastTimeoutIds = [];
    this.runoutVote = null;
    this.nextHandAt = null;
    this.bountyPaid = new Set();
    this.advanceButton(eligible);
    const participants = this.seated().filter((p) => p.chips > 0);
    for (const p of this.players.values()) {
      p.holeCards = null;
      p.folded = false;
      p.allIn = false;
      p.inHand = false;
      p.betThisStreet = 0;
      p.committed = 0;
      p.actedThisStreet = false;
      p.shown = false;
    }

    const button = this.buttonSeat!;
    const sbSeat = participants.length === 2 ? button : this.nextOccupied(button, participants)!;
    const bbSeat = this.nextOccupied(sbSeat, participants)!;

    for (const p of participants) {
      p.inHand = true;
    }

    const deck = opts.deck ? opts.deck.slice() : shuffle(freshDeck(), this.random);
    if (new Set(deck).size !== deck.length) throw new PokerError("invalid_deck", "牌组有重复");
    if (!opts.deck && deck.length !== 52) throw new PokerError("invalid_deck", "必须使用 52 张长牌");

    this.hand = {
      handNumber: this.nextHandNumber++,
      deck,
      board: [],
      street: "preflop",
      buttonSeat: button,
      sbSeat,
      bbSeat,
      straddleSeat: null,
      actorSeat: null,
      actingPlayerId: null,
      actionDeadline: null,
      currentBet: 0,
      minRaise: this.config.bigBlind,
      lastFullRaise: this.config.bigBlind,
      pots: [],
      streetPot: 0,
    };

    if (this.firstDealAt === null) {
      this.firstDealAt = this.now();
      this.endsAt = this.firstDealAt + this.config.durationMinutes * 60 * 1000;
      this.status = "playing";
    }

    this.postBlind(sbSeat, this.config.smallBlind);
    this.postBlind(bbSeat, this.config.bigBlind);
    this.hand.currentBet = this.config.bigBlind;
    this.hand.minRaise = this.config.bigBlind;
    this.hand.lastFullRaise = this.config.bigBlind;

    const utgSeat = this.nextOccupied(bbSeat, participants);
    const wantStraddle =
      this.config.straddleAllowed &&
      participants.length >= 3 &&
      utgSeat !== null &&
      opts.straddle !== false;
    if (wantStraddle && utgSeat !== null) {
      const utg = this.playerAt(utgSeat)!;
      const amt = this.config.bigBlind * 2;
      if (utg.chips + utg.betThisStreet >= amt || utg.chips > 0) {
        this.postBlind(utgSeat, amt - utg.betThisStreet);
        this.hand.straddleSeat = utgSeat;
        this.hand.currentBet = Math.max(this.hand.currentBet, utg.betThisStreet);
        this.hand.minRaise = this.config.bigBlind * 2;
        this.hand.lastFullRaise = this.config.bigBlind * 2;
      }
    }

    this.dealHole(participants);
    this.events.push({ type: "deal" });
    this.ensureSquidRound();
    this.beginBetting();
  }

  canStartHand(): boolean {
    if (this.status === "finished") return false;
    if (this.hand) return false;
    if (this.closing) return false;
    if (this.endsAt !== null && this.now() >= this.endsAt) return false;
    return this.seatedWithChips().length >= 2;
  }

  private seatedWithChips(): PlayerState[] {
    return this.seated().filter((p) => p.chips + (p.pendingBuyinChips ?? 0) > 0);
  }

  /** Next Durable Object alarm: action clock, showdown pause, 时长 end, or the inter-hand pause. */
  nextWakeAt(nextHandDelayMs: number): number | null {
    if (this.status === "finished") return null;
    const due: number[] = [];
    if (this.runoutVote) due.push(this.runoutVote.deadline);
    else if (this.hand?.actionDeadline != null) due.push(this.hand.actionDeadline);
    if (!this.hand && this.nextHandAt != null && this.canStartHand()) due.push(this.nextHandAt);
    if (!this.hand && this.endsAt != null) due.push(this.endsAt);
    if (!this.hand && this.nextHandAt == null && this.canStartHand()) due.push(this.now() + nextHandDelayMs);
    return due.length ? Math.min(...due) : null;
  }

  action(playerId: string, input: ActionInput): void {
    this.assertNotFinished();
    if (!this.hand) throw new PokerError("no_hand", "还没有发牌");
    if (this.hand.actingPlayerId !== playerId) throw new PokerError("not_your_turn", "还没轮到你");
    this.events = [];
    this.applyAction(playerId, input);
  }

  tick(): void {
    if (this.status === "finished") return;
    if (this.runoutVote && this.now() >= this.runoutVote.deadline) {
      this.resolveRunoutVote();
    }
    if (this.hand?.actingPlayerId && this.hand.actionDeadline !== null && this.now() >= this.hand.actionDeadline) {
      const id = this.hand.actingPlayerId;
      const p = this.players.get(id);
      this.events = [];
      this.events.push({ type: "timeout", playerId: id });
      this.lastTimeoutIds = [id];
      if (p && !p.folded) this.applyAction(id, { type: "fold" });
      else this.progressHand();
      if (this.hand?.actingPlayerId === id) this.progressHand();
    }
    if (this.hand && !this.hand.actingPlayerId && !this.runoutVote) this.progressHand();
    if (!this.hand && this.endsAt !== null && this.now() >= this.endsAt) {
      this.settle("duration");
      return;
    }
    if (!this.hand && this.nextHandAt != null && this.now() >= this.nextHandAt && this.canStartHand()) {
      this.startHand();
    }
  }

  forceEnd(): void {
    if (this.status === "finished") return;
    if (this.hand) this.abortHandRefund();
    this.settle("forced");
  }

  snapshot(viewerId: string | null): ClientSnapshot {
    this.tick();
    const hand = this.hand;
    const viewer = viewerId ? this.players.get(viewerId) ?? null : null;
    const board = hand ? hand.board.slice() : (this.lastResult?.board ?? []);
    const pot = this.displayedPot();
    const seats: (SeatView | null)[] = this.seats.map((pid, seat) => {
      if (!pid) return null;
      const p = this.players.get(pid);
      if (!p) return null;
      const showHoles = this.shouldShowHoles(p, viewerId);
      return {
        playerId: p.id,
        nickname: p.nickname,
        chips: p.chips,
        bet: p.betThisStreet,
        folded: p.folded,
        allIn: p.allIn,
        sitting: p.sitting,
        holeCards: showHoles && p.holeCards ? p.holeCards.slice() : undefined,
        isButton: (hand?.buttonSeat ?? this.buttonSeat) === seat,
        isSb: hand?.sbSeat === seat,
        isBb: hand?.bbSeat === seat,
        isStraddle: hand?.straddleSeat === seat,
        hasSquid: this.squid?.holders.includes(p.id) === true,
        acting: hand?.actingPlayerId === p.id,
        inHand: p.inHand,
        pendingChips: p.pendingBuyinChips ?? 0,
      };
    });
    const spectators = [...this.players.values()]
      .filter((p) => !p.sitting)
      .map((p) => ({ id: p.id, nickname: p.nickname }));
    let holeCards: Card[] | undefined;
    if (viewer?.holeCards) holeCards = viewer.holeCards.slice();
    else if (viewer && this.lastResult?.shown[viewer.id]) holeCards = this.lastResult.shown[viewer.id]!.slice();

    return {
      tableNumber: this.tableNumber,
      password: this.password,
      config: this.config,
      status: this.status,
      now: this.now(),
      endsAt: this.endsAt,
      remainingMs: this.endsAt === null ? null : Math.max(0, this.endsAt - this.now()),
      seats,
      spectators,
      board,
      pot,
      street: hand?.street ?? null,
      actingPlayerId: hand?.actingPlayerId ?? null,
      actionDeadline: hand?.actionDeadline ?? null,
      legal: viewer && hand?.actingPlayerId === viewer.id ? this.legalActions(viewer.id) : null,
      me: viewer
        ? {
            id: viewer.id,
            nickname: viewer.nickname,
            seat: viewer.seat,
            chips: viewer.chips,
            buyinCount: viewer.buyinCount,
            holeCards,
            sitting: viewer.sitting,
            pendingChips: viewer.pendingBuyinChips ?? 0,
          }
        : null,
      handNumber: hand?.handNumber ?? this.nextHandNumber - 1,
      buttonSeat: hand?.buttonSeat ?? this.buttonSeat,
      sbSeat: hand?.sbSeat ?? null,
      bbSeat: hand?.bbSeat ?? null,
      straddleSeat: hand?.straddleSeat ?? null,
      squid: this.squid ? { participants: this.squid.participants.slice(), holders: this.squid.holders.slice() } : null,
      settlement: this.settlement,
      events: this.events.slice(),
      lastResult: this.lastResult
        ? {
            handNumber: this.lastResult.handNumber,
            board: this.lastResult.board.slice(),
            winners: this.lastResult.winners.slice(),
            pot: this.lastResult.pot,
            shown: { ...this.lastResult.shown },
            uncontested: this.lastResult.uncontested,
            foldedIds: this.lastResult.foldedIds.slice(),
            timeoutIds: this.lastResult.timeoutIds.slice(),
            runs: this.lastResult.runs.map((r) => ({
              board: r.board.slice(),
              winners: r.winners.slice(),
            })),
          }
        : null,
      nextHandAt: this.nextHandAt,
      invitePath: this.getInvite().path,
      runoutVote: this.runoutVote
        ? { deadline: this.runoutVote.deadline, choices: { ...this.runoutVote.choices } }
        : null,
    };
  }

  legalActions(playerId: string): LegalActions | null {
    const hand = this.hand;
    const p = this.players.get(playerId);
    if (!hand || !p || hand.actingPlayerId !== playerId) return null;
    const toCall = Math.max(0, hand.currentBet - p.betThisStreet);
    const maxRaiseTo = p.chips + p.betThisStreet;
    const minRaiseTo = hand.currentBet + hand.minRaise;
    const canCheck = toCall === 0;
    const canCall = toCall > 0 && p.chips > 0;
    const canBet = hand.currentBet === 0 && p.chips > 0;
    const canRaise = hand.currentBet > 0 && p.chips > toCall;
    return {
      canFold: true,
      canCheck,
      canCall,
      callAmount: Math.min(toCall, p.chips),
      canBet,
      minBet: Math.min(this.config.bigBlind, p.chips),
      canRaise,
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
      maxRaiseTo,
      canAllIn: p.chips > 0,
      toCall,
    };
  }

  private shouldShowHoles(p: PlayerState, viewerId: string | null): boolean {
    if (p.id === viewerId && p.holeCards) return true;
    if (p.shown && p.holeCards) return true;
    if (this.lastResult?.shown[p.id]) return true;
    return false;
  }

  private displayedPot(): number {
    if (this.lastResult && !this.hand) return this.lastResult.pot;
    let total = 0;
    for (const p of this.players.values()) total += p.committed;
    return total;
  }

  private applyBuyin(p: PlayerState, n: number, when: "now" | "next"): void {
    if (!Number.isInteger(n) || n < 1) throw new PokerError("invalid_buyin", "buyin 次数必须是正整数");
    if (!this.config.unlimitedBuyin && p.buyinCount + n > this.config.maxBuyins) {
      throw new PokerError("buyin_limit", "超过最大 buyin 次数");
    }
    const chips = this.buyinChipsFor(n);
    p.buyinCount += n;
    p.buyinChips += chips;
    if (when === "now") p.chips += chips;
    else p.pendingBuyinChips = (p.pendingBuyinChips ?? 0) + chips;
  }

  private applyPendingBuyins(): void {
    for (const p of this.players.values()) {
      if (p.pendingBuyinChips > 0) {
        p.chips += p.pendingBuyinChips;
        p.pendingBuyinChips = 0;
      }
    }
  }

  chooseRunout(playerId: string, choice: "once" | "twice"): void {
    if (!this.runoutVote || !this.hand) throw new PokerError("no_runout_vote", "现在不能选择发牌次数");
    const live = this.livePlayers();
    if (!live.some((p) => p.id === playerId)) throw new PokerError("not_in_hand", "只有摊牌玩家可以选");
    if (choice !== "once" && choice !== "twice") throw new PokerError("illegal_action", "无效选择");
    this.runoutVote.choices[playerId] = choice;
    if (choice === "once" || live.every((p) => this.runoutVote!.choices[p.id])) this.resolveRunoutVote();
  }

  private requirePlayer(id: string): PlayerState {
    const p = this.players.get(id);
    if (!p) throw new PokerError("not_joined", "尚未加入游戏桌");
    return p;
  }

  private assertNotFinished(): void {
    if (this.status === "finished") throw new PokerError("table_finished", "游戏桌已结束，不能再开局");
  }

  private emptySeats(): number[] {
    const out: number[] = [];
    for (let i = 0; i < MAX_SEATS; i++) if (!this.seats[i]) out.push(i);
    return out;
  }

  seated(): PlayerState[] {
    const out: PlayerState[] = [];
    for (let i = 0; i < MAX_SEATS; i++) {
      const id = this.seats[i];
      if (!id) continue;
      const p = this.players.get(id);
      if (p?.sitting) out.push(p);
    }
    return out;
  }

  private playerAt(seat: number): PlayerState | null {
    const id = this.seats[seat];
    return id ? this.players.get(id) ?? null : null;
  }

  private advanceButton(eligible: PlayerState[]): void {
    const seats = eligible.map((p) => p.seat!).sort((a, b) => a - b);
    if (this.buttonSeat === null) {
      this.buttonSeat = seats[Math.floor(this.random() * seats.length)]!;
      return;
    }
    const next = this.nextOccupied(this.buttonSeat, eligible);
    this.buttonSeat = next ?? seats[0]!;
  }

  private nextOccupied(fromSeat: number, among: PlayerState[]): number | null {
    const set = new Set(among.map((p) => p.seat));
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (fromSeat + i) % MAX_SEATS;
      if (set.has(s)) return s;
    }
    return null;
  }

  private postBlind(seat: number, amount: number): void {
    const p = this.playerAt(seat);
    if (!p) return;
    const pay = Math.min(p.chips, amount);
    p.chips -= pay;
    p.betThisStreet += pay;
    p.committed += pay;
    if (p.chips === 0) p.allIn = true;
  }

  private dealHole(participants: PlayerState[]): void {
    const hand = this.hand!;
    const order: PlayerState[] = [];
    let seat = hand.sbSeat;
    for (let n = 0; n < participants.length; n++) {
      order.push(this.playerAt(seat)!);
      seat = this.nextOccupied(seat, participants)!;
    }
    for (let round = 0; round < 2; round++) {
      for (const p of order) {
        const card = hand.deck.shift();
        if (!card) throw new PokerError("deck_empty", "牌组不足");
        if (!p.holeCards) p.holeCards = [];
        p.holeCards.push(card);
      }
    }
  }

  private livePlayers(): PlayerState[] {
    return this.seated().filter((p) => p.inHand && !p.folded);
  }

  private playersWhoNeedAct(): PlayerState[] {
    const hand = this.hand!;
    return this.livePlayers().filter((p) => {
      if (p.allIn || p.chips === 0) return false;
      if (!p.actedThisStreet) return true;
      return p.betThisStreet < hand.currentBet;
    });
  }

  private beginBetting(): void {
    const hand = this.hand!;
    const live = this.livePlayers();
    if (live.length <= 1) {
      this.awardUncontested();
      return;
    }
    if (this.playersWhoNeedAct().length === 0) {
      this.advanceStreetOrShowdown();
      return;
    }
    const startFrom =
      hand.street === "preflop"
        ? (hand.straddleSeat ?? hand.bbSeat)
        : hand.buttonSeat;
    const actor = this.nextActor(startFrom);
    if (!actor) {
      this.advanceStreetOrShowdown();
      return;
    }
    this.setActor(actor);
  }

  private nextActor(fromSeat: number): PlayerState | null {
    const need = new Set(this.playersWhoNeedAct().map((p) => p.id));
    if (need.size === 0) return null;
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (fromSeat + i) % MAX_SEATS;
      const p = this.playerAt(s);
      if (p && need.has(p.id)) return p;
    }
    return null;
  }

  private setActor(p: PlayerState | null): void {
    const hand = this.hand!;
    if (!p) {
      hand.actorSeat = null;
      hand.actingPlayerId = null;
      hand.actionDeadline = null;
      return;
    }
    hand.actorSeat = p.seat;
    hand.actingPlayerId = p.id;
    hand.actionDeadline = this.now() + ACTION_MS;
  }

  private applyAction(playerId: string, input: ActionInput): void {
    const hand = this.hand;
    if (!hand) return;
    const p = this.requirePlayer(playerId);
    const type = input.type;
    const toCall = Math.max(0, hand.currentBet - p.betThisStreet);

    if (type === "fold") {
      p.folded = true;
      p.actedThisStreet = true;
      p.inHand = p.inHand;
      this.events.push({ type: "fold", playerId });
      this.afterAction();
      return;
    }

    if (type === "check") {
      if (toCall > 0) throw new PokerError("illegal_action", "面对下注不能过牌");
      p.actedThisStreet = true;
      this.events.push({ type: "check", playerId });
      this.afterAction();
      return;
    }

    if (type === "call") {
      if (toCall <= 0) throw new PokerError("illegal_action", "没有需要跟注的筹码");
      this.putChips(p, Math.min(toCall, p.chips));
      p.actedThisStreet = true;
      this.events.push({ type: "call", playerId, amount: p.betThisStreet });
      this.afterAction();
      return;
    }

    if (type === "allin") {
      const put = p.chips;
      const newBet = p.betThisStreet + put;
      this.putChips(p, put);
      this.registerBet(p, newBet, true);
      this.events.push({ type: "allin", playerId, amount: newBet });
      this.afterAction();
      return;
    }

    if (type === "bet") {
      if (hand.currentBet > 0) throw new PokerError("illegal_action", "已有下注，请加注");
      const to = input.amount ?? this.config.bigBlind;
      this.raiseTo(p, to);
      this.events.push({ type: "bet", playerId, amount: to });
      this.afterAction();
      return;
    }

    if (type === "raise") {
      if (hand.currentBet <= 0) throw new PokerError("illegal_action", "无人下注时请用 bet");
      const to = input.amount;
      if (to === undefined) throw new PokerError("illegal_action", "加注需要金额");
      this.raiseTo(p, to);
      this.events.push({ type: "raise", playerId, amount: to });
      this.afterAction();
      return;
    }

    throw new PokerError("illegal_action", "未知动作");
  }

  private raiseTo(p: PlayerState, to: number): void {
    const hand = this.hand!;
    if (!Number.isFinite(to) || to <= 0) throw new PokerError("illegal_action", "无效金额");
    const maxTo = p.chips + p.betThisStreet;
    if (to > maxTo) throw new PokerError("illegal_action", "超过筹码");
    const minTo =
      hand.currentBet === 0 ? Math.min(this.config.bigBlind, maxTo) : Math.min(hand.currentBet + hand.minRaise, maxTo);
    if (to < minTo && to < maxTo) throw new PokerError("illegal_action", "未达到最小加注");
    const add = to - p.betThisStreet;
    if (add <= 0) throw new PokerError("illegal_action", "加注必须增加筹码");
    this.putChips(p, add);
    this.registerBet(p, to, to >= maxTo);
  }

  private putChips(p: PlayerState, amount: number): void {
    const pay = Math.min(p.chips, Math.max(0, amount));
    p.chips -= pay;
    p.betThisStreet += pay;
    p.committed += pay;
    if (p.chips === 0) p.allIn = true;
  }

  private registerBet(p: PlayerState, newBet: number, isAllIn: boolean): void {
    const hand = this.hand!;
    const raiseSize = newBet - hand.currentBet;
    p.actedThisStreet = true;
    if (newBet > hand.currentBet) {
      const full = raiseSize >= hand.minRaise;
      if (full) {
        hand.minRaise = raiseSize;
        hand.lastFullRaise = raiseSize;
        for (const o of this.livePlayers()) {
          if (o.id !== p.id && !o.allIn) o.actedThisStreet = false;
        }
      } else if (!isAllIn) {
        throw new PokerError("illegal_action", "加注不足");
      }
      hand.currentBet = newBet;
    }
  }

  private afterAction(): void {
    const live = this.livePlayers();
    if (live.length <= 1) {
      this.awardUncontested();
      return;
    }
    if (this.playersWhoNeedAct().length === 0) {
      this.advanceStreetOrShowdown();
      return;
    }
    const from = this.hand!.actorSeat ?? this.hand!.buttonSeat;
    const next = this.nextActor(from);
    if (!next) {
      this.advanceStreetOrShowdown();
      return;
    }
    this.setActor(next);
  }

  private progressHand(): void {
    if (!this.hand) return;
    const live = this.livePlayers();
    if (live.length <= 1) {
      this.awardUncontested();
      return;
    }
    if (this.playersWhoNeedAct().length === 0) {
      this.advanceStreetOrShowdown();
      return;
    }
    const from = this.hand.actorSeat ?? this.hand.buttonSeat;
    const next = this.nextActor(from);
    if (next) this.setActor(next);
    else this.advanceStreetOrShowdown();
  }

  private resetStreetBets(): void {
    for (const p of this.players.values()) {
      p.betThisStreet = 0;
      p.actedThisStreet = false;
    }
    const hand = this.hand!;
    hand.currentBet = 0;
    hand.minRaise = this.config.bigBlind;
    hand.lastFullRaise = this.config.bigBlind;
  }

  private dealBoard(n: number): void {
    const hand = this.hand!;
    for (let i = 0; i < n; i++) {
      const c = hand.deck.shift();
      if (!c) throw new PokerError("deck_empty", "牌组不足");
      hand.board.push(c);
    }
    this.events.push({ type: "street", message: hand.street });
    this.events.push({ type: "deal" });
  }

  private shouldOfferRunoutVote(): boolean {
    if (this.runoutVote) return false;
    const hand = this.hand;
    if (!hand || hand.board.length >= 5) return false;
    const live = this.livePlayers();
    if (live.length !== 2) return false;
    if (this.playersWhoNeedAct().length > 0) return false;
    return live.some((p) => p.allIn || p.chips === 0);
  }

  private beginRunoutVote(): void {
    const hand = this.hand;
    if (!hand) return;
    this.setActor(null);
    this.runoutVote = { deadline: this.now() + RUNOUT_VOTE_MS, choices: {} };
  }

  private resolveRunoutVote(): void {
    const vote = this.runoutVote;
    this.runoutVote = null;
    if (!this.hand) return;
    const live = this.livePlayers();
    const twice = Boolean(
      vote && live.length === 2 && live.every((p) => vote.choices[p.id] === "twice"),
    );
    this.runoutAndShowdown(twice ? 2 : 1);
  }

  private advanceStreetOrShowdown(): void {
    const hand = this.hand!;
    const live = this.livePlayers();
    if (live.length <= 1) {
      this.awardUncontested();
      return;
    }
    if (this.shouldOfferRunoutVote()) {
      this.beginRunoutVote();
      return;
    }
    const moreBetting = live.filter((p) => p.chips > 0 && !p.allIn).length >= 2;
    if (hand.street === "preflop") {
      hand.street = "flop";
      this.dealBoard(3);
      this.resetStreetBets();
      if (moreBetting) this.beginBetting();
      else this.runoutAndShowdown(1);
      return;
    }
    if (hand.street === "flop") {
      hand.street = "turn";
      this.dealBoard(1);
      this.resetStreetBets();
      if (moreBetting) this.beginBetting();
      else this.runoutAndShowdown(1);
      return;
    }
    if (hand.street === "turn") {
      hand.street = "river";
      this.dealBoard(1);
      this.resetStreetBets();
      if (moreBetting) this.beginBetting();
      else this.showdownRuns(1);
      return;
    }
    this.showdownRuns(1);
  }

  private runoutAndShowdown(times: number): void {
    const hand = this.hand!;
    const shared = hand.board.slice();
    const runs: Card[][] = [];
    const n = times < 2 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      hand.board = shared.slice();
      while (hand.board.length < 5) {
        if (hand.board.length === 0) {
          hand.street = "flop";
          this.dealBoard(3);
        } else if (hand.board.length === 3) {
          hand.street = "turn";
          this.dealBoard(1);
        } else {
          hand.street = "river";
          this.dealBoard(1);
        }
      }
      runs.push(hand.board.slice());
    }
    this.showdownRuns(n, runs);
  }

  private awardUncontested(): void {
    const live = this.livePlayers();
    const winner = live[0];
    const committed = new Map<string, number>();
    for (const p of this.players.values()) {
      if (p.committed > 0) committed.set(p.id, p.committed);
    }
    const folded = new Set(
      [...this.players.values()].filter((p) => !winner || p.id !== winner.id).map((p) => p.id),
    );
    const { refunds, pots } = buildSidePots(committed, folded);
    this.applyRefunds(refunds);
    const awards = new Map<string, number>();
    let potTotal = 0;
    for (const pot of pots) {
      potTotal += pot.amount;
      const id = pot.eligible[0] ?? winner?.id;
      if (id) awards.set(id, (awards.get(id) ?? 0) + pot.amount);
    }
    this.payAwards(awards);
    if (winner) {
      this.events.push({ type: "win", playerId: winner.id, amount: awards.get(winner.id) ?? 0 });
      this.applySquid(winner.id);
      if (winner.shown) this.maybePayBounty(winner, true);
    }
    this.finishHand(awards, potTotal, false);
  }

  private showdownRuns(times: number, boards?: Card[][]): void {
    const hand = this.hand!;
    const live = this.livePlayers();
    for (const p of live) p.shown = true;
    const committed = new Map<string, number>();
    for (const p of this.players.values()) {
      if (p.committed > 0) committed.set(p.id, p.committed);
    }
    const folded = new Set([...this.players.values()].filter((p) => p.folded || !p.inHand).map((p) => p.id));
    const { refunds, pots } = buildSidePots(committed, folded);
    this.applyRefunds(refunds);
    const runBoards = boards && boards.length > 0 ? boards : [hand.board.slice()];
    const runCount = Math.max(1, times, runBoards.length);
    const order = this.orderFromButton();
    const combined = new Map<string, number>();
    let lastValues = new Map<string, HandValue>();
    const runs: LastResult["runs"] = [];
    let potTotal = 0;
    const mainAwardedTo = new Set<string>();

    for (let ri = 0; ri < runBoards.length; ri++) {
      const board = runBoards[ri]!;
      const values = new Map<string, HandValue>();
      for (const p of live) {
        values.set(p.id, evaluateBest([...(p.holeCards ?? []), ...board]));
      }
      lastValues = values;
      const runAwards = new Map<string, number>();
      pots.forEach((pot, idx) => {
        const base = Math.floor(pot.amount / runCount);
        const extra = ri === 0 ? pot.amount % runCount : 0;
        const amt = base + extra;
        if (ri === 0) potTotal += pot.amount;
        const contenders = pot.eligible.filter((id) => values.has(id));
        if (contenders.length === 0) return;
        let best = values.get(contenders[0]!)!;
        for (const id of contenders) {
          const v = values.get(id)!;
          if (compareHand(v, best) > 0) best = v;
        }
        const winners = contenders.filter((id) => compareHand(values.get(id)!, best) === 0);
        const split = splitOddChips(amt, winners, order);
        for (const [id, a] of split) {
          runAwards.set(id, (runAwards.get(id) ?? 0) + a);
          combined.set(id, (combined.get(id) ?? 0) + a);
        }
        if (idx === 0 && winners.length === 1) mainAwardedTo.add(winners[0]!);
      });
      runs.push({
        board: board.slice(),
        winners: [...runAwards.entries()].map(([id, amount]) => ({
          id,
          amount,
          handName: values.get(id) ? rankName(values.get(id)!) : undefined,
        })),
      });
    }

    this.hand!.board = runBoards[runBoards.length - 1]!.slice();
    this.payAwards(combined);
    for (const [id, amt] of combined) {
      const v = lastValues.get(id);
      this.events.push({
        type: "win",
        playerId: id,
        amount: amt,
        message: v ? rankName(v) : undefined,
      });
    }
    if (runBoards.length === 1 && mainAwardedTo.size === 1) {
      this.applySquid([...mainAwardedTo][0]!);
    }
    for (const p of live) {
      if (p.shown && (combined.get(p.id) ?? 0) > 0) this.maybePayBounty(p, true);
    }
    this.finishHand(combined, potTotal, true, lastValues, runs);
  }

  private orderFromButton(): string[] {
    const button = this.hand?.buttonSeat ?? this.buttonSeat ?? 0;
    const ids: string[] = [];
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (button + i) % MAX_SEATS;
      const p = this.playerAt(s);
      if (p) ids.push(p.id);
    }
    return ids;
  }

  private applyRefunds(refunds: Map<string, number>): void {
    for (const [id, amt] of refunds) {
      const p = this.players.get(id);
      if (!p || amt <= 0) continue;
      p.chips += amt;
      p.committed -= amt;
      if (p.betThisStreet >= amt) p.betThisStreet -= amt;
    }
  }

  private payAwards(awards: Map<string, number>): void {
    for (const [id, amt] of awards) {
      const p = this.players.get(id);
      if (p) p.chips += amt;
    }
  }

  private potWinnersThisHand(playerId: string): boolean {
    return this.lastResult?.winners.some((w) => w.id === playerId && w.amount > 0) === true;
  }

  private maybePayBounty(p: PlayerState, wonPot: boolean): void {
    if (!this.config.bounty27Enabled) return;
    if (!wonPot) return;
    if (!p.shown) return;
    if (this.bountyPaid.has(p.id)) return;
    if (!isSevenDeuceOffsuit(p.holeCards)) return;
    this.bountyPaid.add(p.id);
    const bb = this.config.bigBlind;
    const others = this.seated().filter((o) => o.id !== p.id);
    let total = 0;
    for (const o of others) {
      const pay = Math.min(o.chips, bb);
      o.chips -= pay;
      p.chips += pay;
      total += pay;
    }
    if (total > 0) this.events.push({ type: "bounty", playerId: p.id, amount: total, message: "27杂色奖励" });
  }

  private ensureSquidRound(): void {
    if (!this.config.squidEnabled) return;
    const ids = this.seated().map((p) => p.id);
    if (ids.length < 2) return;
    if (!this.squid) {
      this.squid = { participants: ids.slice(), holders: [] };
      return;
    }
    for (const id of ids) {
      if (!this.squid.participants.includes(id)) this.squid.participants.push(id);
    }
  }

  private maybeJoinSquid(playerId: string): void {
    if (!this.config.squidEnabled || !this.squid) return;
    if (!this.squid.participants.includes(playerId)) this.squid.participants.push(playerId);
  }

  private onLeaveSquid(playerId: string): void {
    if (!this.squid) return;
    const had = this.squid.holders.includes(playerId);
    if (!this.squid.participants.includes(playerId)) return;
    if (!had) {
      this.penalizeSquidLoser(playerId);
      return;
    }
    this.squid.holders = this.squid.holders.filter((id) => id !== playerId);
    this.squid.participants = this.squid.participants.filter((id) => id !== playerId);
    this.checkSquidComplete();
  }

  private applySquid(winnerId: string): void {
    if (!this.config.squidEnabled || !this.squid) return;
    if (!this.squid.participants.includes(winnerId)) return;
    if (this.squid.holders.includes(winnerId)) return;
    this.squid.holders.push(winnerId);
    this.events.push({ type: "squid", playerId: winnerId, message: "获得鱿鱼" });
    this.checkSquidComplete();
  }

  private checkSquidComplete(): void {
    if (!this.squid) return;
    const parts = this.squid.participants.filter((id) => this.players.get(id)?.sitting);
    this.squid.participants = parts;
    this.squid.holders = this.squid.holders.filter((id) => parts.includes(id));
    if (parts.length < 2) {
      this.squid = null;
      return;
    }
    const missing = parts.filter((id) => !this.squid!.holders.includes(id));
    if (missing.length === 1) this.penalizeSquidLoser(missing[0]!);
  }

  private penalizeSquidLoser(loserId: string): void {
    if (!this.squid) return;
    const others = this.squid.participants.filter((id) => id !== loserId && this.players.get(id)?.sitting);
    const unit = this.config.bigBlind * 2;
    const loser = this.players.get(loserId);
    if (loser && others.length > 0) {
      for (const id of others) {
        const pay = Math.min(loser.chips, unit);
        loser.chips -= pay;
        const o = this.players.get(id);
        if (o) o.chips += pay;
      }
      this.events.push({ type: "squid", playerId: loserId, message: "鱿鱼惩罚" });
    }
    const seatedIds = this.seated().map((p) => p.id);
    this.squid = seatedIds.length >= 2 ? { participants: seatedIds, holders: [] } : null;
  }

  private finishHand(
    awards: Map<string, number>,
    potTotal: number,
    revealed: boolean,
    values?: Map<string, HandValue>,
    runs?: LastResult["runs"],
  ): void {
    const shown: Record<string, Card[]> = {};
    if (revealed) {
      for (const p of this.players.values()) {
        if (p.shown && p.holeCards) shown[p.id] = p.holeCards.slice();
      }
    }
    const foldedIds = [...this.players.values()].filter((p) => p.folded).map((p) => p.id);
    const winners = [...awards.entries()].map(([id, amount]) => ({
      id,
      amount,
      handName: values?.get(id) ? rankName(values.get(id)!) : undefined,
    }));
    const board = this.hand?.board.slice() ?? [];
    const runList =
      runs && runs.length
        ? runs
        : [{ board: board.slice(), winners: winners.map((w) => ({ ...w })) }];
    this.lastResult = {
      handNumber: this.nextHandNumber - 1,
      board,
      shown,
      winners,
      pot: potTotal,
      uncontested: !revealed,
      foldedIds,
      timeoutIds: this.lastTimeoutIds.slice(),
      runs: runList,
    };
    this.lastTimeoutIds = [];
    this.runoutVote = null;
    this.events.push({ type: "settle" });
    for (const p of this.players.values()) {
      p.inHand = false;
      p.betThisStreet = 0;
      p.committed = 0;
      p.folded = false;
      p.allIn = false;
      p.actedThisStreet = false;
    }
    this.hand = null;
    if (this.closing || (this.endsAt !== null && this.now() >= this.endsAt)) {
      this.nextHandAt = null;
      this.settle("duration");
      return;
    }
    this.maybeScheduleNextHand();
  }

  private maybeScheduleNextHand(): void {
    if (this.status === "finished" || this.hand) return;
    if (this.seatedWithChips().length < 2) {
      this.nextHandAt = null;
      return;
    }
    if (this.nextHandAt == null) this.nextHandAt = this.now() + HAND_PAUSE_MS;
  }

  private abortHandRefund(): void {
    for (const p of this.players.values()) {
      if (p.committed > 0) p.chips += p.committed;
      p.committed = 0;
      p.betThisStreet = 0;
      p.inHand = false;
      p.folded = false;
      p.allIn = false;
      p.holeCards = null;
      p.actedThisStreet = false;
      p.shown = false;
    }
    this.hand = null;
  }

  private settle(reason: Settlement["reason"]): void {
    this.applyPendingBuyins();
    const players = [...this.players.values()]
      .filter((p) => p.buyinChips > 0 || p.chips > 0)
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        buyinChips: p.buyinChips,
        stack: p.chips,
        net: p.chips - p.buyinChips,
      }));
    this.settlement = { players, endedAt: this.now(), reason };
    this.status = "finished";
    this.hand = null;
    this.nextHandAt = null;
    this.closing = true;
  }
}

export function createTable(input: CreateTableInput, runtime?: RuntimeOpts): Table {
  const config = normalizeConfig(input);
  const random = runtime?.random ?? defaultRandom;
  const tableNumber = input.tableNumber ?? generateTableNumber(random);
  const password = input.password ?? generatePassword(random);
  return new Table({ tableNumber, password, config }, runtime);
}

export { randomNickname } from "./names.ts";
export { newPlayerId } from "./names.ts";
export { evaluate7, evaluateBest, compareHand, rankName, CATEGORY } from "./rank.ts";
export { freshDeck, parseCard, parseCards, shuffle, isSevenDeuceOffsuit } from "./cards.ts";
export { ACTION_MS, DURATION_MINUTES, HAND_PAUSE_MS, PokerError, RUNOUT_VOTE_MS } from "./types.ts";
