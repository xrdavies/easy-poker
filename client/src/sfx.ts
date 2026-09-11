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
  readonly audio = new AudioManager();
  private readonly buffers = new Map<string, AudioBuffer>();

  async preload(): Promise<void> {
    await Promise.all(
      SFX_IDS.map(async (id) => {
        try {
          const buf = await this.audio.load(`/sounds/${id}.m4a`);
          this.buffers.set(id, buf);
        } catch {
          /* missing clip is non-fatal */
        }
      }),
    );
  }

  async unlock(): Promise<void> {
    await this.audio.unlock();
  }

  play(name: string): void {
    const pool = SFX_POOL[name] || [name];
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const buffer = this.buffers.get(pick);
    if (!buffer) return;
    void this.unlock();
    try {
      this.audio.play(buffer, { bus: "sfx" });
    } catch {
      /* autoplay may block until a gesture */
    }
  }
}
