import {
  Camera2D,
  Engine,
  Image2D,
  Renderer2D,
  type EngineSystem,
} from "@xrdavies/2d-engine";

/** Draws the racetrack table into a GPU quad each frame via 2d-engine Renderer2D. */
export class TableSurface implements EngineSystem {
  private texture: GPUTexture | null = null;
  private image: Image2D | null = null;
  private camera = new Camera2D();
  private lastKey = "";
  private readonly scene = document.createElement("canvas");

  constructor(
    private readonly engine: Engine,
    private readonly renderer: Renderer2D,
  ) {}

  render(): void {
    const { width, height, pixelWidth, pixelHeight } = this.engine.viewport;
    if (width < 2 || height < 2) return;
    const portrait = window.matchMedia("(orientation: portrait), (max-width: 820px)").matches;
    const key = `${pixelWidth}x${pixelHeight}:${portrait ? "p" : "l"}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.rebuild(pixelWidth, pixelHeight, portrait);
    }
    if (!this.image || !this.texture) return;
    this.camera.position = { x: width / 2, y: height / 2 };
    this.camera.setViewport(width, height);
    this.image.position = { x: width / 2, y: height / 2 };
    this.image.size = { x: width, y: height };
    this.renderer.render([this.image], this.camera);
  }

  dispose(): void {
    this.texture?.destroy();
    this.texture = null;
  }

  private rebuild(pw: number, ph: number, portrait: boolean): void {
    this.texture?.destroy();
    const w = Math.max(64, pw);
    const h = Math.max(64, ph);
    this.scene.width = w;
    this.scene.height = h;
    const ctx = this.scene.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const table = stadiumRect(w, h, portrait);
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

    const texture = this.engine.gpu.device.createTexture({
      size: { width: w, height: h },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.engine.gpu.device.queue.copyExternalImageToTexture(
      { source: this.scene },
      { texture },
      { width: w, height: h },
    );
    this.texture = texture;
    this.image = new Image2D({
      texture,
      position: { x: w / 2, y: h / 2 },
      size: { x: w, y: h },
      layer: 0,
    });
  }
}

function stadiumRect(w: number, h: number, portrait: boolean) {
  if (portrait) {
    const tw = Math.min(w * 0.96, (h * 0.62) / 1.65);
    const th = tw * 1.65;
    return { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
  }
  const tw = Math.min(w * 0.94, 1100 * (w / Math.max(w, 1100)), (h * 0.6) * 2.2);
  const th = tw / 2.2;
  return { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
}

function roundStadium(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const r = Math.min(w, h) / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
