export const MAX_SEATS = 10;
export const ACTION_MS = 10_000;
export const DURATION_MINUTES = [30, 60, 120, 240, 480] as const;
export type DurationMinutes = (typeof DURATION_MINUTES)[number];

export const RANK_CHARS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["c", "d", "h", "s"] as const;

export type RankChar = (typeof RANK_CHARS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${RankChar}${Suit}`;

export type TableStatus = "waiting" | "playing" | "finished";
export type Street = "preflop" | "flop" | "turn" | "river";
export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin";

export interface TableConfig {
  durationMinutes: DurationMinutes;
  unlimitedBuyin: boolean;
  maxBuyins: number;
  straddleAllowed: boolean;
  squidEnabled: boolean;
  bounty27Enabled: boolean;
  smallBlind: number;
  bigBlind: number;
}

export interface CreateTableInput {
  durationMinutes: number;
  unlimitedBuyin?: boolean;
  maxBuyins?: number;
  straddleAllowed?: boolean;
  squidEnabled?: boolean;
  bounty27Enabled?: boolean;
  smallBlind?: number;
  bigBlind?: number;
  tableNumber?: string;
  password?: string;
}

export interface PlayerState {
  id: string;
  nickname: string;
  seat: number | null;
  sitting: boolean;
  chips: number;
  buyinCount: number;
  buyinChips: number;
  holeCards: Card[] | null;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  betThisStreet: number;
  committed: number;
  actedThisStreet: boolean;
  shown: boolean;
  autoStraddle: boolean;
}

export interface SidePot {
  amount: number;
  eligible: string[];
}

export interface HandState {
  handNumber: number;
  deck: Card[];
  board: Card[];
  street: Street;
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  straddleSeat: number | null;
  actorSeat: number | null;
  actingPlayerId: string | null;
  actionDeadline: number | null;
  currentBet: number;
  minRaise: number;
  lastFullRaise: number;
  pots: SidePot[];
  streetPot: number;
}

export interface SquidState {
  participants: string[];
  holders: string[];
}

export interface SettlementPlayer {
  id: string;
  nickname: string;
  buyinChips: number;
  stack: number;
  net: number;
}

export interface Settlement {
  players: SettlementPlayer[];
  endedAt: number;
  reason: "duration" | "forced" | "no_players";
}

export interface GameEvent {
  type:
    | "fold"
    | "check"
    | "call"
    | "bet"
    | "raise"
    | "allin"
    | "deal"
    | "street"
    | "settle"
    | "timeout"
    | "win"
    | "bounty"
    | "squid";
  playerId?: string;
  amount?: number;
  message?: string;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  minBet: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  canAllIn: boolean;
  toCall: number;
}

export interface RuntimeOpts {
  now?: () => number;
  random?: () => number;
}

export class PokerError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "PokerError";
    this.code = code;
  }
}
