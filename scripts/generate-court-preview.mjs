import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const out = new URL("../docs/court-preview/", import.meta.url);
await mkdir(out, { recursive: true });

const esc = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const cards = [
  { rank: "K", suit: "♠", ink: "#18263e", coat: "#244f8a", trim: "#bd3b3d", metal: "#e2b84e" },
  { rank: "Q", suit: "♥", ink: "#9e2f3e", coat: "#b92e4b", trim: "#2d5f98", metal: "#e2b84e" },
  { rank: "J", suit: "♦", ink: "#a33a28", coat: "#d08b2f", trim: "#286b5a", metal: "#e2b84e" },
];
const cardW = 180;
const cardH = 252;

const figure = (card) => {
  const { ink, coat, trim, metal, rank } = card;
  const headwear = rank === "K"
    ? `<path d="M-26 -84 l8 -17 18 13 18 -13 8 17 -4 9 h-44z" fill="${metal}" stroke="${ink}" stroke-width="3"/><path d="M-25 -75 h50" stroke="${ink}" stroke-width="4"/><circle cx="0" cy="-89" r="4" fill="${trim}"/>`
    : rank === "Q"
      ? `<path d="M-28 -83 q11 -25 28 -21 q17 -4 28 21 l-7 10 h-42z" fill="${metal}" stroke="${ink}" stroke-width="3"/><path d="M-24 -75 q24 -9 48 0" fill="none" stroke="${trim}" stroke-width="5"/><circle cx="0" cy="-91" r="5" fill="${trim}" stroke="${ink}" stroke-width="2"/>`
      : `<path d="M-28 -81 q11 -26 28 -29 q18 2 29 23 l-7 16 h-50z" fill="${trim}" stroke="${ink}" stroke-width="3"/><path d="M17 -98 q22 -15 35 4 q-16 -3 -28 13" fill="${metal}" stroke="${ink}" stroke-width="3"/>`;
  const ornament = rank === "K"
    ? `<path d="M-55 -4 q14 -20 29 -3 l-9 11 h-27z M55 -4 q-14 -20 -29 -3 l9 11 h27z" fill="${metal}" stroke="${ink}" stroke-width="3"/>`
    : rank === "Q"
      ? `<path d="M-55 -5 q14 -22 29 -2 l-9 12 h-27z M55 -5 q-14 -22 -29 -2 l9 12 h27z" fill="${trim}" stroke="${ink}" stroke-width="3"/><circle cy="-1" r="7" fill="${metal}" stroke="${ink}" stroke-width="2"/>`
      : `<path d="M-55 -4 q15 -20 29 -2 l-8 12 h-28z M55 -4 q-15 -20 -29 -2 l8 12 h28z" fill="${metal}" stroke="${ink}" stroke-width="3"/>`;
  return `<g stroke-linejoin="round"><path d="M-71 6 Q-67 -17 -42 -24 L-22 -31 H22 L42 -24 Q67 -17 71 6Z" fill="${coat}" stroke="${ink}" stroke-width="4"/><path d="M-23 -29 L0 -8 23 -29 14 -38 H-14Z" fill="${trim}" stroke="${ink}" stroke-width="3"/><path d="M-11 -41 h22 v18 h-22z" fill="#d8a87d" stroke="${ink}" stroke-width="3"/><ellipse cy="-62" rx="21" ry="24" fill="#d8a87d" stroke="${ink}" stroke-width="3"/><path d="M-21 -71 q21 -27 42 0 v10 h-42z" fill="#422d32" stroke="${ink}" stroke-width="3"/><path d="M-13 -65 q4 -4 8 0 M5 -65 q4 -4 8 0 M-2 -54 l-3 6 7 1 M-9 -43 q9 7 18 0" fill="none" stroke="${ink}" stroke-width="2.5"/>${headwear}${ornament}<path d="M-53 -1 Q-39 -12 -25 -3 L-35 7 -62 4Z M53 -1 Q39 -12 25 -3 L35 7 62 4Z" fill="${trim}" stroke="${ink}" stroke-width="3"/><circle cx="-41" cy="0" r="5" fill="#d8a87d" stroke="${ink}" stroke-width="2"/><circle cx="41" cy="0" r="5" fill="#d8a87d" stroke="${ink}" stroke-width="2"/><path d="M-48 9 H48" stroke="${metal}" stroke-width="4"/><text y="6" text-anchor="middle" fill="${ink}" font-family="Georgia,serif" font-size="18" font-weight="700">${rank}</text></g>`;
};

const renderCard = (card, index) => {
  const x = index * cardW;
  const centerX = x + cardW / 2;
  const centerY = cardH / 2 + 13;
  const inset = 10;
  return `<g><rect x="${x + 3}" y="3" width="174" height="246" rx="14" fill="#0b1020" fill-opacity=".45"/><rect x="${x + inset}" y="${inset}" width="160" height="232" rx="11" fill="#f7f0df" stroke="#c6bba6" stroke-width="2"/><text x="${x + 23}" y="${inset + 30}" fill="${card.ink}" font-family="Georgia,serif" font-size="27" font-weight="700">${card.rank}</text><text x="${x + 22}" y="${inset + 56}" fill="${card.ink}" font-family="Georgia,serif" font-size="28">${card.suit}</text><g transform="translate(${centerX} ${centerY}) scale(.82)"><rect x="-87" y="-111" width="174" height="222" rx="10" fill="#fff8e8" stroke="${card.ink}" stroke-opacity=".34" stroke-width="3"/><path d="M-84 0 H84" stroke="${card.metal}" stroke-width="3"/><g>${figure(card)}</g><g transform="rotate(180)">${figure(card)}</g><circle cy="0" r="7" fill="${card.metal}" stroke="${card.ink}" stroke-width="2"/></g><g transform="translate(${x + 157} ${cardH - 18}) rotate(180)"><text fill="${card.ink}" font-family="Georgia,serif" font-size="27" font-weight="700">${card.rank}</text><text y="27" fill="${card.ink}" font-family="Georgia,serif" font-size="28">${card.suit}</text></g></g>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW * cards.length}" height="${cardH}" viewBox="0 0 ${cardW * cards.length} ${cardH}"><defs><radialGradient id="bg" cx="50%" cy="0%" r="100%"><stop stop-color="#403653"/><stop offset="1" stop-color="#171426"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/>${cards.map(renderCard).join("")}</svg>`;
await writeFile(new URL("court-preview.svg", out), svg);
await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL("court-preview.png", out)));
