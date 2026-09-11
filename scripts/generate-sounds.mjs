/** Sampled SFX live in scripts/sfx-src (free card/chip recordings).
 *  Mapping: place-cards → deal + fold bed; bet-1/2/3 → bet/call/raise;
 *  all-in is spoken "all in"; shuffle-cards-1/5 full, 2/3/4 trimmed to ~0.9s → shuffle pool.
 *  Output is 48 kbps mono AAC in public/sounds.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repo, "public", "sounds");
const srcDir = join(repo, "scripts", "sfx-src");
mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "ep-sfx-"));
const RATE = 22050;

function wavFromSamples(samples, sampleRate = RATE) {
  const data = new Int16Array(samples);
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(data[i], 44 + i * 2);
  return buf;
}

function parseWavPcm(buf) {
  let pos = 12;
  let rate = RATE;
  let pcm = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") rate = buf.readUInt32LE(pos + 12);
    if (id === "data") {
      pcm = new Int16Array(size / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readInt16LE(pos + 8 + i * 2);
      break;
    }
    pos += 8 + size + (size % 2);
  }
  if (!pcm) throw new Error("no pcm");
  if (rate === RATE) return Array.from(pcm);
  const n = Math.floor((pcm.length * RATE) / rate);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = (i * rate) / RATE;
    const j = Math.min(pcm.length - 1, Math.floor(src));
    out[i] = pcm[j];
  }
  return out;
}

function render(seconds, fn) {
  const n = Math.floor(seconds * RATE);
  const samples = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, i / 80) * Math.min(1, (n - i) / Math.max(40, RATE * 0.02));
    samples[i] = Math.max(-1, Math.min(1, fn(t))) * env * 0.78 * 32767;
  }
  return samples;
}

function mix(a, b, offset = 0) {
  const n = Math.max(a.length, offset + b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < a.length; i++) out[i] += a[i];
  for (let i = 0; i < b.length; i++) out[offset + i] += b[i];
  for (let i = 0; i < n; i++) out[i] = Math.max(-32767, Math.min(32767, out[i]));
  return out;
}

function noise(t, seed) {
  const x = Math.sin(t * 12497.3 + seed) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

function sayVoice(text, stem) {
  const aiff = join(tmp, `${stem}.aiff`);
  const wav = join(tmp, `${stem}-voice.wav`);
  execFileSync("say", ["-v", "Samantha", "-r", "175", "-o", aiff, text], { stdio: "pipe" });
  execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${RATE}`, "-c", "1", aiff, wav], { stdio: "pipe" });
  return parseWavPcm(readFileSync(wav));
}

function findSrc(name) {
  const local = join(srcDir, name);
  if (existsSync(local)) return local;
  const dl = join("/Users/r001/Downloads", name);
  if (existsSync(dl)) return dl;
  throw new Error(`missing sfx source ${name}`);
}

function loadSrc(name, { startSec = 0, durationSec = null } = {}) {
  const wav = join(tmp, `${name.replace(/\W+/g, "_")}.wav`);
  execFileSync(
    "afconvert",
    ["-f", "WAVE", "-d", `LEI16@${RATE}`, "-c", "1", findSrc(name), wav],
    { stdio: "pipe" },
  );
  let pcm = parseWavPcm(readFileSync(wav));
  const start = Math.floor(startSec * RATE);
  const end = durationSec == null ? pcm.length : Math.min(pcm.length, start + Math.floor(durationSec * RATE));
  return pcm.slice(start, end);
}

function writeM4a(stem, samples) {
  const wav = join(tmp, `${stem}.wav`);
  const m4a = join(outDir, `${stem}.m4a`);
  writeFileSync(wav, wavFromSamples(samples));
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "48000", "-c", "1", wav, m4a], { stdio: "pipe" });
  console.log("wrote", `${stem}.m4a`, readFileSync(m4a).length);
}

const slap = render(0.16, (t) => {
  const thump = Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 40);
  const paper = noise(t, 9) * Math.exp(-t * 70) * (t < 0.04 ? 1.6 : 0.3);
  return thump * 0.7 + paper;
});
const knock = render(0.22, (t) => {
  const hit1 = t < 0.05 ? (noise(t, 1) * 1.4 + Math.sin(2 * Math.PI * 190 * t) * 0.7) * Math.exp(-t * 55) : 0;
  const u = t - 0.09;
  const hit2 = u > 0 && u < 0.06 ? (noise(u, 2) * 1.2 + Math.sin(2 * Math.PI * 160 * u) * 0.8) * Math.exp(-u * 50) : 0;
  return hit1 + hit2;
});
const tick = render(0.07, (t) => Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 90) + noise(t, 4) * 0.35 * Math.exp(-t * 80));
const win = render(0.7, (t) => {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const i = Math.min(3, Math.floor(t / 0.14));
  return Math.sin(2 * Math.PI * notes[i] * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * notes[i] * 2 * t) * 0.15);
});
const lose = render(0.55, (t) => {
  const f = 392 - t * 220;
  return Math.sin(2 * Math.PI * f * t) * (1 - t) + 0.2 * Math.sin(2 * Math.PI * (f / 2) * t);
});

const place = loadSrc("place-cards.mp3");
writeM4a("fold", mix(place, sayVoice("fold", "fold"), Math.floor(RATE * 0.05)));
writeM4a("check", knock);
writeM4a("tick", tick);
writeM4a("win", win);
writeM4a("lose", lose);

writeM4a("deal", loadSrc("place-cards.mp3"));
writeM4a("allin", sayVoice("all in", "allin"));
writeM4a("bet-1", loadSrc("bet-1.mp3"));
writeM4a("bet-2", loadSrc("bet-2.mp3"));
writeM4a("bet-3", loadSrc("bet-3.mp3"));
writeM4a("shuffle", loadSrc("shuffle-cards-1.mp3"));
writeM4a("shuffle-2", loadSrc("shuffle-cards-5.mp3"));
writeM4a("shuffle-3", loadSrc("shuffle-cards-2.mp3", { durationSec: 0.85 }));
writeM4a("shuffle-4", loadSrc("shuffle-cards-3.mp3", { durationSec: 0.85 }));
writeM4a("shuffle-5", loadSrc("shuffle-cards-4.mp3", { durationSec: 0.9 }));
