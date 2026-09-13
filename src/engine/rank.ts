import { rankValue, suitOf } from "./cards.ts";
import type { Card } from "./types.ts";

export const CATEGORY = {
  highCard: 0,
  pair: 1,
  twoPair: 2,
  trips: 3,
  straight: 4,
  flush: 5,
  fullHouse: 6,
  quads: 7,
  straightFlush: 8,
  royalFlush: 9,
} as const;

export const CATEGORY_NAMES: Record<number, string> = {
  0: "高牌",
  1: "一对",
  2: "两对",
  3: "三条",
  4: "顺子",
  5: "同花",
  6: "葫芦",
  7: "四条",
  8: "同花顺",
  9: "皇家同花顺",
};

export interface HandValue {
  category: number;
  ranks: number[];
  cards: Card[];
}

export function compareHand(a: HandValue, b: HandValue, shortDeck = false): number {
  const strength = (v: HandValue) => shortDeck && v.category === CATEGORY.flush ? 6.5 : v.category;
  if (a.category !== b.category) return strength(a) - strength(b);
  const n = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < n; i++) {
    const d = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function combinations(cards: Card[], k: number): Card[][] {
  const out: Card[][] = [];
  const combo: Card[] = [];
  const rec = (start: number) => {
    if (combo.length === k) {
      out.push(combo.slice());
      return;
    }
    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]!);
      rec(i + 1);
      combo.pop();
    }
  };
  rec(0);
  return out;
}

function straightHigh(uniqueDesc: number[], shortDeck: boolean): number | null {
  if (uniqueDesc.length < 5) return null;
  for (let i = 0; i <= uniqueDesc.length - 5; i++) {
    const hi = uniqueDesc[i]!;
    if (
      uniqueDesc[i + 1] === hi - 1 &&
      uniqueDesc[i + 2] === hi - 2 &&
      uniqueDesc[i + 3] === hi - 3 &&
      uniqueDesc[i + 4] === hi - 4
    ) {
      return hi;
    }
  }
  const set = new Set(uniqueDesc);
  if (shortDeck && [14, 9, 8, 7, 6].every((r) => set.has(r))) return 9;
  if (!shortDeck && set.has(14) && set.has(5) && set.has(4) && set.has(3) && set.has(2)) {
    return 5;
  }
  return null;
}

export function evaluate5(cards: Card[], shortDeck = false): HandValue {
  if (cards.length !== 5) throw new Error("evaluate5_requires_5");
  const byRank = cards.slice().sort((a, b) => rankValue(b) - rankValue(a));
  const ranks = byRank.map(rankValue);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const unique = [...new Set(ranks)];
  const sHigh = straightHigh(unique, shortDeck);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  if (flush && sHigh === 14) {
    return { category: CATEGORY.royalFlush, ranks: [14], cards: byRank };
  }
  if (flush && sHigh !== null) {
    return { category: CATEGORY.straightFlush, ranks: [sHigh], cards: byRank };
  }
  if (groups[0]?.[1] === 4) {
    return {
      category: CATEGORY.quads,
      ranks: [groups[0][0], groups[1]![0]],
      cards: byRank,
    };
  }
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
    return {
      category: CATEGORY.fullHouse,
      ranks: [groups[0][0], groups[1][0]],
      cards: byRank,
    };
  }
  if (flush) {
    return { category: CATEGORY.flush, ranks, cards: byRank };
  }
  if (sHigh !== null) {
    return { category: CATEGORY.straight, ranks: [sHigh], cards: byRank };
  }
  if (groups[0]?.[1] === 3) {
    const kickers = groups.slice(1).map((g) => g[0]);
    return { category: CATEGORY.trips, ranks: [groups[0][0], ...kickers], cards: byRank };
  }
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const kicker = groups[2]![0];
    return {
      category: CATEGORY.twoPair,
      ranks: [groups[0][0], groups[1][0], kicker],
      cards: byRank,
    };
  }
  if (groups[0]?.[1] === 2) {
    const kickers = groups.slice(1).map((g) => g[0]);
    return { category: CATEGORY.pair, ranks: [groups[0][0], ...kickers], cards: byRank };
  }
  return { category: CATEGORY.highCard, ranks, cards: byRank };
}

export function evaluateBest(cards: Card[], shortDeck = false): HandValue {
  if (cards.length < 5) {
    const padded = cards.slice();
    return {
      category: CATEGORY.highCard,
      ranks: padded.map(rankValue).sort((a, b) => b - a),
      cards: padded,
    };
  }
  if (cards.length === 5) return evaluate5(cards, shortDeck);
  let best: HandValue | null = null;
  for (const five of combinations(cards, 5)) {
    const v = evaluate5(five, shortDeck);
    if (!best || compareHand(v, best, shortDeck) > 0) best = v;
  }
  return best!;
}

export function evaluate7(cards: Card[], shortDeck = false): HandValue {
  return evaluateBest(cards, shortDeck);
}

export function rankName(value: HandValue): string {
  return CATEGORY_NAMES[value.category] ?? "未知";
}
