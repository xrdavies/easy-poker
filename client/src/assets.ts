import {
  createSolidTexture,
  uploadCanvasTexture,
  type TextureRegion,
} from "@xrdavies/2d-engine";

const SUIT_GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["s", "h", "d", "c"];
export const CARD_W = 70;
export const CARD_H = 98;

function paintCircle(size = 64): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  return canvas;
}

function paintCards(): { canvas: HTMLCanvasElement; uv: Map<string, TextureRegion> } {
  const cols = RANKS.length + 1;
  const canvas = document.createElement("canvas");
  canvas.width = cols * CARD_W;
  canvas.height = SUITS.length * CARD_H;
  const ctx = canvas.getContext("2d")!;
  const uv = new Map<string, TextureRegion>();
  const tw = canvas.width;
  const th = canvas.height;

  const drawFace = (x: number, y: number, rank: string, suit: string) => {
    const red = suit === "h" || suit === "d";
    roundRect(ctx, x + 2, y + 2, CARD_W - 4, CARD_H - 4, 8);
    ctx.fillStyle = "#f8f4ec";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = red ? "#c0392b" : "#1a1a1a";
    ctx.font = "bold 22px 'PingFang SC', sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(rank === "T" ? "10" : rank, x + 8, y + 8);
    ctx.font = "26px 'PingFang SC', sans-serif";
    ctx.textBaseline = "bottom";
    ctx.fillText(SUIT_GLYPH[suit] ?? "", x + CARD_W - 28, y + CARD_H - 8);
  };

  const drawBack = (x: number, y: number) => {
    roundRect(ctx, x + 2, y + 2, CARD_W - 4, CARD_H - 4, 8);
    ctx.fillStyle = "#1e3a5f";
    ctx.fill();
    ctx.strokeStyle = "#e2c078";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(226,192,120,0.35)";
    ctx.font = "28px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♠", x + CARD_W / 2, y + CARD_H / 2);
    ctx.textAlign = "start";
  };

  for (let s = 0; s < SUITS.length; s++) {
    for (let r = 0; r < RANKS.length; r++) {
      const x = r * CARD_W;
      const y = s * CARD_H;
      const code = `${RANKS[r]}${SUITS[s]}`;
      drawFace(x, y, RANKS[r]!, SUITS[s]!);
      uv.set(code, { x: x / tw, y: y / th, width: CARD_W / tw, height: CARD_H / th });
    }
    const bx = RANKS.length * CARD_W;
    const by = s * CARD_H;
    drawBack(bx, by);
    uv.set(`back-${s}`, { x: bx / tw, y: by / th, width: CARD_W / tw, height: CARD_H / th });
  }
  uv.set("back", uv.get("back-0")!);
  return { canvas, uv };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function paintFelt(w: number, h: number, portrait: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(64, w);
  canvas.height = Math.max(64, h);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const table = stadiumRect(canvas.width, canvas.height, portrait);
  const rail = Math.max(10, Math.round(Math.min(table.w, table.h) * 0.035));
  roundStadium(ctx, table.x, table.y, table.w, table.h);
  const wood = ctx.createLinearGradient(0, table.y, 0, table.y + table.h);
  wood.addColorStop(0, "#8a5528");
  wood.addColorStop(1, "#2a160a");
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#2b160b";
  ctx.stroke();
  roundStadium(ctx, table.x + rail, table.y + rail, table.w - rail * 2, table.h - rail * 2);
  const felt = ctx.createRadialGradient(
    table.x + table.w * 0.5,
    table.y + table.h * 0.42,
    8,
    table.x + table.w * 0.5,
    table.y + table.h * 0.5,
    Math.max(table.w, table.h) * 0.55,
  );
  felt.addColorStop(0, "#14945c");
  felt.addColorStop(0.46, "#0b5a38");
  felt.addColorStop(1, "#063d26");
  ctx.fillStyle = felt;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(226, 192, 120, 0.45)";
  ctx.stroke();
  return canvas;
}

export function stadiumRect(w: number, h: number, portrait: boolean) {
  if (portrait) {
    const tw = Math.min(w * 0.96, (h * 0.62) / 1.65);
    const th = tw * 1.65;
    return { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
  }
  const tw = Math.min(w * 0.94, 1100 * (w / Math.max(w, 1100)), h * 0.6 * 2.2);
  const th = tw / 2.2;
  return { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
}

function roundStadium(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const r = Math.min(w, h) / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class GpuAssets {
  readonly white: GPUTexture;
  readonly circle: GPUTexture;
  readonly cards: GPUTexture;
  readonly cardUv: Map<string, TextureRegion>;
  private felt: GPUTexture | null = null;
  private feltKey = "";

  constructor(private readonly device: GPUDevice) {
    this.white = createSolidTexture(device);
    this.circle = uploadCanvasTexture(device, paintCircle(64), "circle");
    const atlas = paintCards();
    this.cards = uploadCanvasTexture(device, atlas.canvas, "cards");
    this.cardUv = atlas.uv;
  }

  cardRegion(code: string): TextureRegion {
    return this.cardUv.get(code) ?? this.cardUv.get("back")!;
  }

  feltTexture(pixelWidth: number, pixelHeight: number, portrait: boolean): GPUTexture {
    const key = `${pixelWidth}x${pixelHeight}:${portrait ? "p" : "l"}`;
    if (this.felt && this.feltKey === key) return this.felt;
    this.felt?.destroy();
    this.felt = uploadCanvasTexture(
      this.device,
      paintFelt(pixelWidth, pixelHeight, portrait),
      "felt",
    );
    this.feltKey = key;
    return this.felt;
  }
}
