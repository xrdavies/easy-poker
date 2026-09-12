import { AudioManager } from "@xrdavies/2d-engine";

export const SFX_POOL: Record<string, string[]> = {
  fold: ["fold"],
  check: ["check"],
  bet: ["bet-1", "bet-2", "bet-3"],
  call: ["bet-1", "bet-2", "bet-3"],
  raise: ["bet-1", "bet-2", "bet-3"],
  allin: ["allin"],
  deal: ["deal"],
  shuffle: ["shuffle-1", "shuffle-2", "shuffle-3", "shuffle-4", "shuffle-5"],
  tick: ["tick"],
  win: ["win"],
  lose: ["lose"],
};

export const SFX_IDS = [
  "fold",
  "check",
  "bet-1",
  "bet-2",
  "bet-3",
  "allin",
  "deal",
  "shuffle-1",
  "shuffle-2",
  "shuffle-3",
  "shuffle-4",
  "shuffle-5",
  "tick",
  "win",
  "lose",
] as const;

export class PokerSfx {
  private audio: AudioManager | null = null;
  private readonly data = new Map<string, ArrayBuffer>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private ready: Promise<void> | null = null;

  async preload(): Promise<void> {
    this.loading ??= Promise.all(
      SFX_IDS.map(async (id) => {
        try {
          const response = await fetch(`/sounds/${id}.m4a`);
          if (response.ok) this.data.set(id, await response.arrayBuffer());
        } catch {
          /* missing clip is non-fatal */
        }
      }),
    ).then(() => undefined);
    await this.loading;
  }

  async unlock(): Promise<void> {
    this.ready ??= this.startAudio();
    await this.ready;
  }

  play(name: string): void {
    if (!this.ready) return;
    void this.ready.then(() => this.playReady(name));
  }

  private async startAudio(): Promise<void> {
    const audio = new AudioManager();
    this.audio = audio;
    await audio.unlock();
    await this.preload();
    await Promise.all([...this.data].map(async ([id, data]) => {
      try {
        this.buffers.set(id, await audio.context.decodeAudioData(data.slice(0)));
      } catch {
        /* invalid clip is non-fatal */
      }
    }));
  }

  private playReady(name: string): void {
    const pool = SFX_POOL[name] || [name];
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const buffer = this.buffers.get(pick);
    if (!buffer || !this.audio) return;
    try {
      this.audio.play(buffer, { bus: "sfx" });
    } catch {
      /* autoplay may block until a gesture */
    }
  }
}
