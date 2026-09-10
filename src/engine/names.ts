const ADJ = [
  "幸运",
  "冷静",
  "神秘",
  "金牌",
  "沉默",
  "午夜",
  "极速",
  "王者",
  "闪光",
  "冷静",
  "狂野",
  "悠闲",
  "锋利",
  "隐蔽",
  "炽热",
  "冰蓝",
  "金色",
  "银色",
  "幽暗",
  "晴朗",
];

const NOUN = [
  "水手",
  "骑士",
  "猎手",
  "浪人",
  "鲨鱼",
  "狐狸",
  "熊猫",
  "幽灵",
  "船长",
  "旅人",
  "玩家",
  "河豚",
  "猛虎",
  "飞龙",
  "猎豹",
  "海鸥",
  "橡树",
  "流星",
  "灯塔",
  "棋手",
];

export function randomNickname(random: () => number = Math.random): string {
  const a = ADJ[Math.floor(random() * ADJ.length)] ?? "幸运";
  const b = NOUN[Math.floor(random() * NOUN.length)] ?? "玩家";
  const n = Math.floor(random() * 90) + 10;
  return `${a}${b}${n}`;
}

export function newPlayerId(): string {
  return crypto.randomUUID();
}
