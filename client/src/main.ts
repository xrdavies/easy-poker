import {
  Engine,
  Renderer2D,
  UIBridge,
} from "@xrdavies/2d-engine";
import { PokerNet } from "./net.ts";
import { PokerScene } from "./scene.ts";
import { PokerSession, SEATS, actionMsLeft, inviteUrl, isPortraitTable } from "./session.ts";
import { PokerSfx, SFX_IDS, SFX_POOL } from "./sfx.ts";

export { Engine, Renderer2D, UIBridge };
export { SEATS, actionMsLeft, inviteUrl, isPortraitTable };
export { SFX_IDS, SFX_POOL };
export { PokerSession, PokerScene };

declare global {
  interface Window {
    __easyPokerEngine?: Engine | null;
    __easyPokerSession?: PokerSession;
    __EASY_POKER_USES_2D_ENGINE?: boolean;
  }
}

window.__EASY_POKER_USES_2D_ENGINE = true;

export function attachTableUiBridge(canvas: HTMLCanvasElement, root?: HTMLElement): UIBridge {
  return root ? new UIBridge(canvas, root) : new UIBridge(canvas);
}

function field(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`missing ${id}`);
  return el;
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
  const imeRoot = document.getElementById("ime-root");
  if (!canvas || !imeRoot) throw new Error("Easy Poker shell is incomplete");

  const fields = {
    nick: field("ime-nick"),
    table: field("ime-table"),
    pass: field("ime-pass"),
    buyin: field("ime-buyin"),
  };

  const sfx = new PokerSfx();
  const net = new PokerNet();
  const session = new PokerSession(net, sfx);
  void sfx.preload();

  const bridge = attachTableUiBridge(canvas, imeRoot);
  bridge.setInputCaptured(false);

  fields.nick.value = session.nickname;
  fields.nick.addEventListener("input", () => {
    session.nickname = fields.nick.value;
  });
  fields.table.addEventListener("input", () => {
    session.joinNumber = fields.table.value;
  });
  fields.pass.addEventListener("input", () => {
    session.joinPassword = fields.pass.value;
  });
  fields.buyin.addEventListener("input", () => {
    session.buyinN = Math.min(Number(fields.buyin.max) || 99, Math.max(1, Number(fields.buyin.value) || 1));
  });

  const unlockAudio = () => void sfx.unlock();
  document.body.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
  document.body.addEventListener("keydown", unlockAudio, { once: true, capture: true });

  try {
    const engine = await Engine.create({ canvas, autoStart: true, input: true });
    const renderer = new Renderer2D(engine.gpu, {
      clearColor: { r: 0.027, g: 0.063, b: 0.094, a: 1 },
      maxInstances: 2048,
    });
    const scene = new PokerScene(engine, renderer, session, bridge, fields);
    engine.addSystem(scene);
    window.__easyPokerEngine = engine;
    window.__easyPokerSession = session;
    document.body.classList.add("engine-gpu");
    session.onChange = () => {
      const lobby = session.screen === "lobby";
      const changed = document.body.classList.contains("lobby-screen") !== lobby;
      document.body.classList.toggle("lobby-screen", lobby);
      if (changed) engine.resize();
    };
    session.start();
    canvas.focus();
  } catch (error) {
    window.__easyPokerEngine = null;
    document.body.classList.add("engine-fallback");
    console.warn("2d-engine WebGPU init failed", error);
    imeRoot.textContent = "需要 WebGPU 才能运行 Easy Poker";
  }
}

void boot();
