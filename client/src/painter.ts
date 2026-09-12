import {
  Image2D,
  Shape2D,
  Text2D,
  type HitRect,
  type TextQuad,
  type TexturedQuad,
  type UIInput,
  type UIBridgeControl,
  type UISlider,
} from "@xrdavies/2d-engine";
import { CARD_H, CARD_W, type GpuAssets } from "./assets.ts";

export type Color = [number, number, number, number];

export const P = {
  bg: rgb(7, 16, 24),
  panel: rgb(20, 36, 48, 0.96),
  gold: rgb(226, 192, 120),
  gold2: rgb(180, 138, 60),
  ink: rgb(244, 239, 228),
  muted: rgb(154, 167, 181),
  danger: rgb(212, 82, 78),
  ok: rgb(62, 207, 142),
  call: rgb(61, 139, 253),
  card: rgb(248, 244, 236),
  fold: rgb(120, 40, 40),
  check: rgb(40, 90, 70),
  bet: rgb(180, 140, 50),
  allin: rgb(140, 40, 90),
  dim: rgb(19, 32, 43),
  field: rgb(11, 21, 29),
};

export function rgb(r: number, g: number, b: number, a = 1): Color {
  return [r / 255, g / 255, b / 255, a];
}

export function cssColor(c: Color) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;
}

class TextCache {
  private readonly map = new Map<string, { quad: TextQuad; texture: GPUTexture }>();

  constructor(private readonly device: GPUDevice) {}

  quad(
    text: string,
    font: string,
    color: string,
    x: number,
    y: number,
    layer: number,
    maxWidth = 4096,
  ): TextQuad {
    const key = `${text}|${font}|${color}|${maxWidth}`;
    let entry = this.map.get(key);
    if (!entry) {
      const run = new Text2D({ text, font, color, maxWidth, lineHeight: 22, position: { x: 0, y: 0 } });
      const texture = run.createTexture(this.device);
      const quad = run.toQuad(texture);
      entry = { quad, texture };
      this.map.set(key, entry);
    }
    const copy = { ...entry.quad, position: { x, y }, layer, dispose: entry.quad.dispose };
    return copy;
  }

  dispose() {
    const textures = new Set<GPUTexture>();
    for (const entry of this.map.values()) textures.add(entry.texture);
    for (const texture of textures) texture.destroy();
    this.map.clear();
  }
}

export class Painter {
  items: TexturedQuad[] = [];
  hits: HitRect[] = [];
  controls: UIBridgeControl[] = [];
  pressedId = "";
  private readonly text: TextCache;

  constructor(
    device: GPUDevice,
    readonly assets: GpuAssets,
  ) {
    this.text = new TextCache(device);
  }

  reset() {
    this.items = [];
    this.hits = [];
    this.controls = [];
  }

  dispose() {
    this.text.dispose();
  }

  rect(x: number, y: number, w: number, h: number, color: Color, layer: number) {
    this.items.push(
      new Shape2D({
        texture: this.assets.white,
        position: { x: x + w / 2, y: y + h / 2 },
        size: { x: w, y: h },
        color,
        layer,
      }),
    );
  }

  roundRect(x: number, y: number, w: number, h: number, color: Color, layer: number, radius = 10) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    if (r < 1) return this.rect(x, y, w, h, color, layer);
    this.rect(x + r, y, w - 2 * r, h, color, layer);
    this.rect(x, y + r, r, h - 2 * r, color, layer);
    this.rect(x + w - r, y + r, r, h - 2 * r, color, layer);
    for (const [corner, cx, cy] of [
      ["tl", x, y],
      ["tr", x + w - r, y],
      ["bl", x, y + h - r],
      ["br", x + w - r, y + h - r],
    ] as const) {
      this.items.push(new Image2D({ texture: this.assets.corners, uv: this.assets.cornerRegion(corner), position: { x: cx + r / 2, y: cy + r / 2 }, size: { x: r, y: r }, color, layer }));
    }
  }

  disc(cx: number, cy: number, r: number, color: Color, layer: number) {
    this.items.push(
      new Image2D({
        texture: this.assets.circle,
        position: { x: cx, y: cy },
        size: { x: r * 2, y: r * 2 },
        color,
        layer,
      }),
    );
  }

  chip(value: number, cx: number, cy: number, r: number, layer: number) {
    this.items.push(
      new Image2D({
        texture: this.assets.chips,
        uv: this.assets.chipRegion(value),
        position: { x: cx, y: cy },
        size: { x: r * 2, y: r * 2 },
        layer,
      }),
    );
  }

  input(node: UIInput, layer = node.layer) {
    this.roundRect(node.rect.x, node.rect.y, node.rect.width, node.rect.height, P.field, layer, 8);
  }

  slider(node: UISlider, layer = node.layer, label = node.id) {
    const { x, y, width, height } = node.rect;
    this.rect(x, y + (height - 8) / 2, width, 8, P.dim, layer);
    const t = (node.value - node.min) / Math.max(1, node.max - node.min);
    this.disc(x + t * width, y + height / 2, Math.min(10, height / 2), P.gold, layer + 1);
    this.controls.push({
      kind: "slider",
      id: node.id,
      label,
      rect: node.rect,
      min: node.min,
      max: node.max,
      value: node.value,
      step: node.step,
      disabled: node.disabled,
    });
  }

  label(
    text: string,
    x: number,
    y: number,
    opts: { font?: string; fill?: Color; layer?: number; maxWidth?: number } = {},
  ) {
    const font = opts.font ?? "14px 'PingFang SC', sans-serif";
    const fill = opts.fill ?? P.ink;
    this.items.push(
      this.text.quad(text, font, cssColor(fill), x, y, opts.layer ?? 20, opts.maxWidth),
    );
  }

  labelCenter(
    text: string,
    cx: number,
    cy: number,
    opts: { font?: string; fill?: Color; layer?: number; maxWidth?: number } = {},
  ) {
    const font = opts.font ?? "14px 'PingFang SC', sans-serif";
    const fill = opts.fill ?? P.ink;
    const quad = this.text.quad(text, font, cssColor(fill), 0, 0, opts.layer ?? 20, opts.maxWidth);
    quad.position = { x: cx - quad.size.x / 2, y: cy - quad.size.y / 2 };
    this.items.push(quad);
    return quad;
  }

  card(code: string, cx: number, cy: number, w: number, h: number, layer: number, scale = 1) {
    const region = this.assets.cardRegion(code || "back");
    this.items.push(
      new Image2D({
        texture: this.assets.cards,
        position: { x: cx, y: cy },
        size: { x: w * scale, y: h * scale },
        uv: region,
        layer,
      }),
    );
  }

  felt(x: number, y: number, w: number, h: number, texture: GPUTexture, layer: number) {
    this.items.push(
      new Image2D({
        texture,
        position: { x: x + w / 2, y: y + h / 2 },
        size: { x: w, y: h },
        layer,
      }),
    );
  }

  button(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    opts: { fill?: Color; ink?: Color; layer?: number; disabled?: boolean; selected?: boolean; accessibilityLabel?: string } = {},
  ) {
    const fill = opts.fill ?? P.gold;
    const ink = opts.ink ?? rgb(26, 18, 8);
    const layer = opts.layer ?? 30;
    const pressed = this.pressedId === id && !opts.disabled;
    const color = opts.disabled ? rgb(80, 80, 80, 0.45) : pressed ? rgb(fill[0] * 255 * 0.82, fill[1] * 255 * 0.82, fill[2] * 255 * 0.82, fill[3]) : fill;
    const radius = Math.min(10, h / 2);
    if (fill === P.dim && !opts.disabled) {
      this.roundRect(x, y, w, h, rgb(58, 81, 99), layer, radius);
      this.roundRect(x + 1, y + 1, w - 2, h - 2, color, layer, Math.max(1, radius - 1));
    } else {
      this.roundRect(x, y, w, h, color, layer, radius);
    }
    this.labelCenter(title, x + w / 2, y + h / 2, { fill: opts.disabled ? P.muted : ink, layer: layer + 1, font: "14px 'PingFang SC', sans-serif" });
    this.hits.push({ id, x: x - 3, y: y - 3, width: w + 6, height: h + 6, layer, disabled: opts.disabled });
    this.controls.push({ kind: "button", id, label: opts.accessibilityLabel ?? title, rect: { x, y, width: w, height: h }, disabled: opts.disabled, pressed: opts.selected });
  }

  hit(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    layer = 30,
    accessibility?: { label: string; pressed?: boolean },
  ) {
    this.hits.push({ id, x, y, width: w, height: h, layer });
    if (accessibility) {
      this.controls.push({
        kind: "button",
        id,
        label: accessibility.label,
        rect: { x, y, width: w, height: h },
        pressed: accessibility.pressed,
      });
    }
  }
}

export { CARD_H, CARD_W };
