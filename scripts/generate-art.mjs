import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const out = new URL("../public/assets/", import.meta.url);
await mkdir(out, { recursive: true });
const save = async (name, svg) => {
  await writeFile(new URL(`${name}.svg`, out), svg);
  await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL(`${name}.png`, out)));
};

const esc = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const suits = [
  ["s", "♠", "#1a1a1a"],
  ["h", "♥", "#c0392b"],
  ["d", "♦", "#c0392b"],
  ["c", "♣", "#1a1a1a"],
];
const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const cardW = 70;
const cardH = 98;
const cardParts = [`<svg xmlns="http://www.w3.org/2000/svg" width="980" height="392" viewBox="0 0 980 392">`];
const court = (x, y, rank, ink) => {
  const crown = rank === "K"
    ? `<path d="M ${x + 19} ${y + 40} l 7 -12 9 10 9 -10 7 12 -4 6 h-24 z" fill="${ink}" fill-opacity=".82"/>`
    : rank === "Q"
      ? `<path d="M ${x + 21} ${y + 38} q 14 -13 28 0 l -3 6 h-22 z" fill="${ink}" fill-opacity=".82"/><circle cx="${x + 35}" cy="${y + 28}" r="4" fill="#e2c078"/>`
      : `<path d="M ${x + 18} ${y + 40} q 17 -15 34 0 l -4 7 h-26 z" fill="${ink}" fill-opacity=".82"/>`;
  return `<g><rect x="${x + 14}" y="${y + 20}" width="42" height="62" rx="7" fill="#fff8e8" fill-opacity=".62" stroke="${ink}" stroke-opacity=".36"/><path d="M ${x + 20} ${y + 53} q 15 -18 30 0 v22 h-30 z" fill="${ink}" fill-opacity=".72"/><circle cx="${x + 35}" cy="${y + 47}" r="8" fill="#e2c078" stroke="${ink}" stroke-opacity=".6"/>${crown}<path d="M ${x + 21} ${y + 78} q 14 -9 28 0" fill="none" stroke="${ink}" stroke-opacity=".7" stroke-width="3"/></g>`;
};
for (let si = 0; si < suits.length; si += 1) {
  const [, glyph, ink] = suits[si];
  for (let ri = 0; ri < ranks.length; ri += 1) {
    const x = ri * cardW;
    const y = si * cardH;
    const rank = ranks[ri] === "T" ? "10" : ranks[ri];
    cardParts.push(`<rect x="${x + 2}" y="${y + 2}" width="66" height="94" rx="8" fill="#f8f4ec" stroke="#000" stroke-opacity=".18"/>`);
    cardParts.push(`<text x="${x + 8}" y="${y + 29}" fill="${ink}" font-family="PingFang SC,Hiragino Sans GB,Noto Sans SC,sans-serif" font-size="22" font-weight="700">${rank}</text>`);
    cardParts.push(`<text x="${x + 42}" y="${y + 89}" fill="${ink}" font-family="serif" font-size="26">${glyph}</text>`);
    if (["K", "Q", "J"].includes(ranks[ri])) cardParts.push(court(x, y, ranks[ri], ink));
  }
  const x = 13 * cardW;
  const y = si * cardH;
  cardParts.push(`<rect x="${x + 2}" y="${y + 2}" width="66" height="94" rx="8" fill="#1e3a5f" stroke="#e2c078" stroke-width="2"/>`);
  cardParts.push(`<text x="${x + 35}" y="${y + 61}" text-anchor="middle" fill="#e2c078" fill-opacity=".35" font-family="serif" font-size="28">♠</text>`);
}
cardParts.push("</svg>");
await save("cards", cardParts.join(""));

const chipValues = [
  [500, "#7b1fa2", "#ce93d8"],
  [100, "#202124", "#9aa0a6"],
  [25, "#1b5e20", "#66bb6a"],
  [5, "#b71c1c", "#ef5350"],
  [1, "#d7cfc1", "#fffdf7"],
];
const chipParts = [`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="64" viewBox="0 0 320 64">`];
for (const [i, [value, fill, edge]] of chipValues.entries()) {
  const cx = i * 64 + 32;
  chipParts.push(`<g><circle cx="${cx}" cy="32" r="29" fill="${fill}" stroke="#17120f" stroke-width="2"/><circle cx="${cx}" cy="32" r="22" fill="none" stroke="${edge}" stroke-width="4" stroke-dasharray="4 5"/><circle cx="${cx}" cy="32" r="14" fill="${fill}" stroke="${edge}" stroke-width="1.5"/><text x="${cx}" y="37" text-anchor="middle" fill="${edge === "#fffdf7" ? "#4e4438" : "#fff8e8"}" font-family="Arial,sans-serif" font-size="12" font-weight="700">${value}</text></g>`);
}
chipParts.push("</svg>");
await save("chips", chipParts.join(""));

await save("background", `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900" viewBox="0 0 1280 900"><defs><radialGradient id="bg" cx="50%" cy="18%" r="95%"><stop offset="0" stop-color="#163247"/><stop offset=".55" stop-color="#0c1a24"/><stop offset="1" stop-color="#071018"/></radialGradient></defs><rect width="1280" height="900" fill="url(#bg)"/></svg>`);

const felt = (portrait) => {
  const width = portrait ? 400 : 900;
  const height = portrait ? 660 : 400;
  const rail = portrait ? 14 : 16;
  const inset = rail + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#8a5528"/><stop offset="1" stop-color="#2a160a"/></linearGradient><radialGradient id="green" cx="50%" cy="42%" r="65%"><stop stop-color="#14945c"/><stop offset=".46" stop-color="#0b5a38"/><stop offset="1" stop-color="#063d26"/></radialGradient></defs><rect x="5" y="5" width="${width - 10}" height="${height - 10}" rx="${Math.min(width, height) / 2 - 5}" fill="url(#wood)" stroke="#2b160b" stroke-width="10"/><rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${Math.min(width, height) / 2 - inset}" fill="url(#green)" stroke="#e2c078" stroke-opacity=".45" stroke-width="3"/></svg>`;
};
await save("felt-landscape", felt(false));
await save("felt-portrait", felt(true));

await save("circle", `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#fff"/></svg>`);

const corner = (transform) => `<path d="M 0 128 A 128 128 0 0 1 128 0 L 128 128 Z" fill="#fff" transform="${transform}"/>`;
await save("corners", `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${corner("translate(0 0)")}${corner("translate(256 0) scale(-1 1)")}${corner("translate(0 256) scale(1 -1)")}${corner("translate(256 256) scale(-1 -1)")}</svg>`);
