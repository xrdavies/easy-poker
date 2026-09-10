import type { SidePot } from "./types.ts";

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((id) => sb.has(id));
}

export function buildSidePots(
  committed: Map<string, number>,
  folded: Set<string>,
): { refunds: Map<string, number>; pots: SidePot[] } {
  const refunds = new Map<string, number>();
  const amounts = new Map(committed);
  const ids = [...amounts.keys()].filter((id) => (amounts.get(id) ?? 0) > 0);
  if (ids.length === 0) return { refunds, pots: [] };

  const sorted = ids.slice().sort((a, b) => (amounts.get(a) ?? 0) - (amounts.get(b) ?? 0));
  const maxId = sorted[sorted.length - 1]!;
  const maxAmt = amounts.get(maxId) ?? 0;
  const second = sorted.length >= 2 ? (amounts.get(sorted[sorted.length - 2]!) ?? 0) : 0;
  if (maxAmt > second) {
    refunds.set(maxId, maxAmt - second);
    amounts.set(maxId, second);
  }

  const levels = [...new Set([...amounts.values()].filter((v) => v > 0))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let prev = 0;
  for (const level of levels) {
    const contributors = ids.filter((id) => (amounts.get(id) ?? 0) >= level);
    const amount = (level - prev) * contributors.length;
    const eligible = contributors.filter((id) => !folded.has(id));
    if (amount > 0) {
      pots.push({ amount, eligible });
    }
    prev = level;
  }

  const merged: SidePot[] = [];
  for (const p of pots) {
    const last = merged[merged.length - 1];
    if (last && sameIds(last.eligible, p.eligible)) last.amount += p.amount;
    else merged.push({ amount: p.amount, eligible: p.eligible.slice() });
  }
  return { refunds, pots: merged };
}

export function splitOddChips(
  amount: number,
  winners: string[],
  orderFromButton: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (winners.length === 0 || amount <= 0) return out;
  const share = Math.floor(amount / winners.length);
  let rem = amount - share * winners.length;
  for (const id of winners) out.set(id, share);
  for (const id of orderFromButton) {
    if (rem <= 0) break;
    if (out.has(id)) {
      out.set(id, (out.get(id) ?? 0) + 1);
      rem -= 1;
    }
  }
  return out;
}
