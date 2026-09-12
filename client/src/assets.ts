import {
  AssetManager,
  createSolidTexture,
  type TextureRegion,
} from "@xrdavies/2d-engine";

export const CARD_W = 70;
export const CARD_H = 98;
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["s", "h", "d", "c"];
type Corner = "tl" | "tr" | "bl" | "br";

const CORNER_UV: Record<Corner, TextureRegion> = {
  tl: { x: 0, y: 0, width: 0.5, height: 0.5 },
  tr: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
  bl: { x: 0, y: 0.5, width: 0.5, height: 0.5 },
  br: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
};

function cardRegions(): Map<string, TextureRegion> {
  const uv = new Map<string, TextureRegion>();
  const width = (RANKS.length + 1) * CARD_W;
  const height = SUITS.length * CARD_H;
  for (let si = 0; si < SUITS.length; si += 1) {
    for (let ri = 0; ri < RANKS.length; ri += 1) {
      uv.set(`${RANKS[ri]}${SUITS[si]}`, {
        x: (ri * CARD_W) / width,
        y: (si * CARD_H) / height,
        width: CARD_W / width,
        height: CARD_H / height,
      });
    }
    uv.set(`back-${si}`, {
      x: (RANKS.length * CARD_W) / width,
      y: (si * CARD_H) / height,
      width: CARD_W / width,
      height: CARD_H / height,
    });
  }
  uv.set("back", uv.get("back-0")!);
  return uv;
}

export function stadiumRect(w: number, h: number, portrait: boolean, viewportHeight = h) {
  if (portrait) {
    const tw = Math.min(w * 0.96, Math.min(viewportHeight * 0.62, 640) / 1.65);
    const th = tw * 1.65;
    return { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
  }
  const tw = Math.min(w * 0.94, 1100 * (w / Math.max(w, 1100)), Math.min(viewportHeight * 0.64, 560) * 2.25);
  const th = tw / 2.25;
  return { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
}

export class GpuAssets {
  readonly white: GPUTexture;
  readonly circle: GPUTexture;
  readonly cards: GPUTexture;
  readonly feltLandscape: GPUTexture;
  readonly feltPortrait: GPUTexture;
  readonly background: GPUTexture;
  readonly corners: GPUTexture;
  readonly cardUv = cardRegions();

  private constructor(
    private readonly manager: AssetManager,
    device: GPUDevice,
    textures: Record<"circle" | "cards" | "feltLandscape" | "feltPortrait" | "background" | "corners", GPUTexture>,
  ) {
    this.white = createSolidTexture(device);
    this.circle = textures.circle;
    this.cards = textures.cards;
    this.feltLandscape = textures.feltLandscape;
    this.feltPortrait = textures.feltPortrait;
    this.background = textures.background;
    this.corners = textures.corners;
  }

  static async load(device: GPUDevice): Promise<GpuAssets> {
    const manager = new AssetManager();
    try {
      const images = await Promise.all([
        ["circle", "/assets/circle.png"],
        ["cards", "/assets/cards.png"],
        ["felt-landscape", "/assets/felt-landscape.png"],
        ["felt-portrait", "/assets/felt-portrait.png"],
        ["background", "/assets/background.png"],
        ["corners", "/assets/corners.png"],
      ].map(async ([key, url]) => [key, await manager.loadImage(url)] as const));
      const textures = Object.fromEntries(await Promise.all(images.map(async ([key, image]) => [key, await manager.uploadImage(key, image, device)] as const))) as Record<string, GPUTexture>;
      return new GpuAssets(manager, device, {
        circle: textures.circle!,
        cards: textures.cards!,
        feltLandscape: textures["felt-landscape"]!,
        feltPortrait: textures["felt-portrait"]!,
        background: textures.background!,
        corners: textures.corners!,
      });
    } catch (error) {
      manager.clear();
      throw error;
    }
  }

  cardRegion(code: string): TextureRegion {
    return this.cardUv.get(code) ?? this.cardUv.get("back")!;
  }

  cornerRegion(corner: Corner): TextureRegion {
    return CORNER_UV[corner];
  }

  feltTexture(_pixelWidth = 0, _pixelHeight = 0, portrait = false, _viewportHeight = 0): GPUTexture {
    return portrait ? this.feltPortrait : this.feltLandscape;
  }

  backgroundTexture(_pixelWidth = 0, _pixelHeight = 0): GPUTexture {
    return this.background;
  }

  dispose() {
    this.white.destroy();
    this.manager.clear();
  }
}
