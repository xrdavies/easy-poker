import {
  Engine,
  Renderer2D,
  UIBridge,
} from "@xrdavies/2d-engine";
import { PokerNet } from "./net.ts";
import { startOverlay } from "./overlay.ts";
import { PokerSfx } from "./sfx.ts";
import { TableSurface } from "./table-surface.ts";

export { Engine, Renderer2D, UIBridge };
export { SEATS, inviteUrl, isPortraitTable, renderShowdown, actionMsLeft } from "./overlay.ts";
export { SFX_IDS, SFX_POOL } from "./sfx.ts";

declare global {
  interface Window {
    __easyPokerEngine?: Engine | null;
    __EASY_POKER_USES_2D_ENGINE?: boolean;
  }
}

window.__EASY_POKER_USES_2D_ENGINE = true;

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (!canvas || !uiRoot) throw new Error("Easy Poker shell is incomplete");

  const sfx = new PokerSfx();
  const net = new PokerNet();
  void sfx.preload();

  const bridge = new UIBridge(canvas, uiRoot);
  bridge.setInputCaptured(true);

  try {
    const engine = await Engine.create({ canvas, autoStart: true, input: true });
    const renderer = new Renderer2D(engine.gpu, {
      clearColor: { r: 0.027, g: 0.063, b: 0.094, a: 1 },
    });
    engine.addSystem(new TableSurface(engine, renderer));
    window.__easyPokerEngine = engine;
    document.body.classList.add("engine-gpu");
  } catch (error) {
    window.__easyPokerEngine = null;
    document.body.classList.add("engine-fallback");
    console.warn("2d-engine WebGPU init failed; overlay chrome still runs", error);
  }

  startOverlay({ net, sfx });
  document.body.addEventListener("pointerdown", () => void sfx.unlock(), { once: true });
}

void boot();
