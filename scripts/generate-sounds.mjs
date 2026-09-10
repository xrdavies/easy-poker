import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sounds");
mkdirSync(dir, { recursive: true });

function wav(samples, sampleRate = 22050) {
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

function render(seconds, fn, sampleRate = 22050) {
  const n = Math.floor(seconds * sampleRate);
  const samples = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, i / 180) * Math.min(1, (n - i) / (sampleRate * 0.04));
    samples[i] = Math.max(-1, Math.min(1, fn(t, i / n))) * env * 0.7 * 32767;
  }
  return wav(samples, sampleRate);
}

const files = {
  fold: render(0.28, (t) => Math.sin(2 * Math.PI * (320 - t * 420) * t) * (1 - t)),
  check: render(0.12, (t) => Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 28) + Math.sin(2 * Math.PI * 1320 * t) * 0.2 * Math.exp(-t * 40)),
  raise: render(0.32, (t) => Math.sin(2 * Math.PI * (420 + t * 780) * t) + 0.3 * Math.sin(2 * Math.PI * 210 * t)),
  deal: render(0.09, (t) => Math.sin(2 * Math.PI * 1560 * t) * Math.exp(-t * 50) + Math.sin(2 * Math.PI * 2400 * t) * 0.15),
  settle: render(0.55, (t) => {
    const a = Math.sin(2 * Math.PI * 523.25 * t);
    const b = Math.sin(2 * Math.PI * 659.25 * t);
    const c = Math.sin(2 * Math.PI * 783.99 * t);
    return (a + b + c) / 3;
  }),
};

for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(dir, `${name}.wav`), buf);
  console.log("wrote", name, buf.length);
}
