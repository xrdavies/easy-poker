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
for (let si = 0; si < suits.length; si += 1) {
  const [, glyph, ink] = suits[si];
  for (let ri = 0; ri < ranks.length; ri += 1) {
    const x = ri * cardW;
    const y = si * cardH;
    const rank = ranks[ri] === "T" ? "10" : ranks[ri];
    cardParts.push(`<rect x="${x + 2}" y="${y + 2}" width="66" height="94" rx="8" fill="#f8f4ec" stroke="#000" stroke-opacity=".18"/>`);
    cardParts.push(`<text x="${x + 8}" y="${y + 29}" fill="${ink}" font-family="PingFang SC,Hiragino Sans GB,Noto Sans SC,sans-serif" font-size="22" font-weight="700">${rank}</text>`);
    cardParts.push(`<text x="${x + 42}" y="${y + 89}" fill="${ink}" font-family="serif" font-size="26">${glyph}</text>`);
  }
  const x = 13 * cardW;
  const y = si * cardH;
  cardParts.push(`<rect x="${x + 2}" y="${y + 2}" width="66" height="94" rx="8" fill="#1e3a5f" stroke="#e2c078" stroke-width="2"/>`);
  for (let i = -cardH; i < cardW + cardH; i += 12) cardParts.push(`<path d="M ${x + i} ${y + cardH} L ${x + i + cardH} ${y}" stroke="#5082be" stroke-opacity=".45" stroke-width="3"/>`);
  cardParts.push(`<text x="${x + 35}" y="${y + 61}" text-anchor="middle" fill="#e2c078" fill-opacity=".35" font-family="serif" font-size="28">♠</text>`);
}
cardParts.push("</svg>");
await save("cards", cardParts.join(""));

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
