import {
  DURATION_MINUTES,
  PokerError,
  type CreateTableInput,
  type DurationMinutes,
  type TableConfig,
} from "./types.ts";

export function normalizeConfig(input: CreateTableInput): TableConfig {
  if (!DURATION_MINUTES.includes(input.durationMinutes as DurationMinutes)) {
    throw new PokerError("invalid_duration", "时长必须是 30分钟、1小时、2小时、4小时或 8小时");
  }
  const unlimitedBuyin = input.unlimitedBuyin === true;
  const maxBuyins = input.maxBuyins === undefined ? 10 : input.maxBuyins;
  if (!Number.isInteger(maxBuyins) || maxBuyins < 1) {
    throw new PokerError("invalid_max_buyins", "最大 buyin 次数至少为 1");
  }
  const smallBlind = input.smallBlind ?? 1;
  const bigBlind = input.bigBlind ?? 2;
  if (!Number.isInteger(smallBlind) || smallBlind < 1 || bigBlind !== smallBlind * 2) {
    throw new PokerError("invalid_blinds", "大盲必须是小盲的两倍");
  }
  return {
    durationMinutes: input.durationMinutes as DurationMinutes,
    shortDeck: input.shortDeck === true,
    unlimitedBuyin,
    maxBuyins,
    straddleAllowed: input.straddleAllowed === true,
    squidEnabled: input.squidEnabled === true,
    bounty27Enabled: input.bounty27Enabled !== false,
    smallBlind,
    bigBlind,
  };
}

export const TABLE_NUMBER_ALPH = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateTableNumber(random: () => number): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += TABLE_NUMBER_ALPH[Math.floor(random() * TABLE_NUMBER_ALPH.length)];
  }
  return s;
}

export function generatePassword(random: () => number): string {
  return String(1000 + Math.floor(random() * 9000));
}
