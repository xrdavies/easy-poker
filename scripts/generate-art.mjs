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
  const palette = {
    K: ["#24508b", "#c83e39", "#e2b64d"],
    Q: ["#a52e55", "#2f689a", "#e2b64d"],
    J: ["#2d775d", "#c7862f", "#d84a42"],
  }[rank];
  const [coat, trim, metal] = palette;
  const crown = rank === "K"
    ? `<path d="M-15 -24 l5 -9 5 7 5 -10 5 10 5 -7 5 9 -3 6 h-24z" fill="${metal}" stroke="${ink}" stroke-width="1"/><path d="M-14 -17 h28" stroke="${ink}" stroke-width="2"/>`
    : rank === "Q"
      ? `<path d="M-14 -22 q14 -13 28 0 l-3 5 h-22z" fill="${metal}" stroke="${ink}" stroke-width="1"/><circle cy="-23" r="3" fill="${trim}" stroke="${ink}" stroke-width="1"/>`
      : `<path d="M-15 -22 q11 -14 24 -4 l6 8 -7 3 h-24z" fill="${trim}" stroke="${ink}" stroke-width="1"/><path d="M8 -24 q10 -7 13 -1" fill="none" stroke="${metal}" stroke-width="3"/>`;
  const figure = `<path d="M-20 27 Q-18 12 -8 8 L-5 1 H5 L8 8 Q18 12 20 27Z" fill="${coat}" stroke="${ink}" stroke-width="1.4"/><path d="M-8 9 L0 17 8 9 5 5 H-5Z" fill="${trim}" stroke="${ink}" stroke-width="1"/><path d="M-4 3 h8 v7 h-8z" fill="#e2b889" stroke="${ink}" stroke-width=".8"/><circle cy="-9" r="8" fill="#e2b889" stroke="${ink}" stroke-width="1"/><path d="M-8 -12 q8 -9 16 0 v4 h-16z" fill="#4a2e2b"/><path d="M-4 -6 q4 3 8 0" fill="none" stroke="${ink}" stroke-width=".9"/><path d="M-2 -1 h4" stroke="${ink}" stroke-width="1"/>${crown}<path d="M-14 22 h28" stroke="${metal}" stroke-width="2"/><text y="25" text-anchor="middle" fill="${metal}" font-family="serif" font-size="8" font-weight="700">${rank}</text>`;
  return `<g transform="translate(${x + 35} ${y + 51})"><rect x="-22" y="-31" width="44" height="62" rx="7" fill="#fff8e8" stroke="${ink}" stroke-opacity=".42"/><path d="M-21 0 H21" stroke="${metal}" stroke-width="1.5"/><g>${figure}</g><g transform="rotate(180)">${figure}</g><circle cy="0" r="2.5" fill="${metal}" stroke="${ink}" stroke-width=".8"/></g>`;
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
