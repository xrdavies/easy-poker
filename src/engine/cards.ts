import { RANK_CHARS, SUITS, type Card, type RankChar, type Suit } from "./types.ts";

const RANK_VALUE: Record<RankChar, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function rankValue(card: Card): number {
  return RANK_VALUE[card[0] as RankChar];
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

export function parseCard(text: string): Card {
  const t = text.trim();
  const rank = (t.length === 3 && t.startsWith("10") ? "T" : t[0].toUpperCase()) as RankChar;
  const suit = t[t.length - 1].toLowerCase() as Suit;
  const card = `${rank}${suit}` as Card;
  if (!RANK_CHARS.includes(rank) || !SUITS.includes(suit)) {
    throw new Error(`invalid_card:${text}`);
  }
  return card;
}

export function parseCards(text: string): Card[] {
  return text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(parseCard);
}

export function freshDeck(): Card[] {
  const cards: Card[] = [];
  for (const s of SUITS) {
    for (const r of RANK_CHARS) {
      cards.push(`${r}${s}` as Card);
    }
  }
  return cards;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

export function isOffsuit(a: Card, b: Card): boolean {
  return suitOf(a) !== suitOf(b);
}

export function isSevenDeuceOffsuit(cards: Card[] | null | undefined): boolean {
  if (!cards || cards.length !== 2) return false;
  const ranks = [rankValue(cards[0]!), rankValue(cards[1]!)].sort((x, y) => x - y);
  return ranks[0] === 2 && ranks[1] === 7 && isOffsuit(cards[0]!, cards[1]!);
}

export function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}
