import {
  Camera2D,
  Engine,
  Renderer2D,
  easeOutBack,
  hitTest,
  tweenValue,
  UIBridge,
  UIInput,
  UISlider,
  type EngineSystem,
  type NormalizedInputEvent,
} from "@xrdavies/2d-engine";
import { GpuAssets, stadiumRect } from "./assets.ts";
import { P, Painter, rgb, type Color } from "./painter.ts";
import {
  DURATION_OPTIONS,
  LANDSCAPE_SEATS,
  PORTRAIT_SEATS,
  SEATS,
  actionMsLeft,
  fmtChips,
  fmtMs,
  isPortraitTable,
  nameOf,
  voteMsLeft,
  type PokerSession,
} from "./session.ts";

export type ImeBox = { x: number; y: number; w: number; h: number };
export type ImeLayout = {
  nick?: ImeBox | null;
  table?: ImeBox | null;
  pass?: ImeBox | null;
  buyin?: ImeBox | null;
};

const CHIP = [
  { v: 500 },
  { v: 100 },
  { v: 25 },
  { v: 5 },
  { v: 1 },
];

export class PokerScene implements EngineSystem {
  readonly camera = new Camera2D();
  ime: ImeLayout = {};
  private assets: GpuAssets | null = null;
  private painter: Painter | null = null;
  private assetsLoading: Promise<void> | null = null;
  private assetsError = false;
  private slider: UISlider | null = null;
  private readonly uiInputs = {
    nick: new UIInput("ime-nick", { x: 0, y: 0, width: 0, height: 0 }),
    table: new UIInput("ime-table", { x: 0, y: 0, width: 0, height: 0 }),
    pass: new UIInput("ime-pass", { x: 0, y: 0, width: 0, height: 0 }),
    buyin: new UIInput("ime-buyin", { x: 0, y: 0, width: 0, height: 0 }, "1", "", "number"),
  };
  private dragging = false;
  private pulse = 0;
  private pressedId = "";
  private pressedUntil = 0;
  private lastTable = "";
  private lastPot = 0;
  private potFlight: { x: number; y: number; at: number } | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly renderer: Renderer2D,
    readonly session: PokerSession,
    private readonly bridge: UIBridge,
    private readonly fields: {
      nick: HTMLInputElement;
      table: HTMLInputElement;
      pass: HTMLInputElement;
      buyin: HTMLInputElement;
    },
  ) {
    engine.input?.onInput((event) => this.onInput(event));
  }

  update(delta: number): void {
    this.pulse += delta;
  }

  dispose(): void {
    this.painter?.dispose();
    this.assets?.dispose();
  }

  render(): void {
    const { width, height, pixelWidth, pixelHeight } = this.engine.viewport;
    if (width < 2 || height < 2) return;
    this.camera.position = { x: width / 2, y: height / 2 };
    this.camera.setViewport(width, height);
    if (!this.assets) {
      if (this.assetsError) return;
      this.assetsLoading ??= GpuAssets.load(this.engine.gpu.device).then((assets) => {
        this.assets = assets;
        this.painter = new Painter(this.engine.gpu.device, assets);
      }).catch((error) => {
        this.assetsError = true;
        console.warn("2d-engine art assets failed to load", error);
      });
      return;
    }
    const p = this.painter!;
    p.reset();
    if (this.pressedId && performance.now() > this.pressedUntil) this.pressedId = "";
    p.pressedId = this.pressedId;
    this.ime = {};
    for (const input of Object.values(this.uiInputs)) input.visible = false;
    p.felt(0, 0, width, height, this.assets.backgroundTexture(pixelWidth, pixelHeight), 0);

    if (this.session.screen === "lobby") this.drawLobby(p, width, height);
    else if (this.session.screen === "settle") this.drawSettle(p, width, height);
    else this.drawTable(p, width, height, pixelWidth, pixelHeight);

    if (this.session.screen === "table" && this.session.snapshot?.lastResult && !this.session.snapshot.street) {
      p.rect(0, 0, width, height, rgb(0, 0, 0, 0.45), 39);
    }

    if (this.session.buyinOpen) {
      p.hits = [];
      p.controls = [];
      this.drawBuyin(p, width, height);
    }
    if (this.session.toast) this.drawToast(p, width, height);
    this.syncIme();
    this.bridge.describe(this.accessibleDescription());
    this.bridge.announce(this.session.toast);
    this.bridge.syncControls(p.controls, (control, value) => {
      if (control.kind === "slider" && value != null) {
        this.session.raiseTo = value;
        this.session.emit();
      } else {
        this.click(control.id, control.rect.x + control.rect.width / 2);
      }
    });
    this.renderer.render(p.items, this.camera);
  }

  private accessibleDescription(): string {
    const s = this.session;
    const snap = s.snapshot;
    if (s.buyinOpen) return "Easy Poker 补充筹码对话框";
    if (s.screen === "lobby") return `Easy Poker 大厅，${s.tab === "create" ? "创建游戏桌" : "加入游戏桌"}`;
    if (s.screen === "settle") return "Easy Poker 游戏桌结算";
    const state = snap?.street ? String(snap.street).toUpperCase() : snap?.status === "waiting" ? "等待玩家" : "本手结算";
    return `Easy Poker 游戏桌 ${snap?.tableNumber ?? ""}，${state}，底池 ${fmtChips(snap?.pot ?? 0)}`;
  }

  private placeIme(el: HTMLInputElement, box: ImeBox | null | undefined) {
    if (!box) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
  }

  private syncIme() {
    const f = this.fields;
    this.placeIme(f.nick, this.ime.nick);
    this.placeIme(f.table, this.ime.table);
    this.placeIme(f.pass, this.ime.pass);
    this.placeIme(f.buyin, this.ime.buyin);
    if (this.ime.nick && f.nick.value !== this.session.nickname && document.activeElement !== f.nick) {
      f.nick.value = this.session.nickname;
    }
    if (this.ime.buyin && document.activeElement !== f.buyin) {
      const snap = this.session.snapshot;
      f.buyin.max = String(snap?.config?.unlimitedBuyin
        ? 99
        : Math.max(1, (snap?.config?.maxBuyins ?? 10) - (snap?.me?.buyinCount ?? 0)));
      f.buyin.value = String(this.session.buyinN);
    }
  }

  private setInput(key: keyof typeof this.uiInputs, box: ImeBox): UIInput {
    const input = this.uiInputs[key];
    input.rect = { x: box.x, y: box.y, width: box.w, height: box.h };
    input.visible = true;
    this.ime[key] = box;
    return input;
  }

  onInput(event: NormalizedInputEvent): void {
    if (event.kind !== "pointer") return;
    const x = event.coordinates.viewport.x;
    const y = event.coordinates.viewport.y;
    if (event.type === "pointerdown") {
      if (this.slider && !this.slider.disabled && this.slider.contains(x, y)) {
        this.dragging = true;
        this.slider.dragging = true;
        this.setSlider(x);
        this.engine.input?.capturePointer(event.pointerId);
        return;
      }
      const hit = hitTest(this.painter?.hits ?? [], x, y);
      if (hit) {
        this.pressedId = hit.id;
        this.pressedUntil = performance.now() + 120;
        this.click(hit.id, x);
        if (hit.id === "slider") this.engine.input?.capturePointer(event.pointerId);
      }
    } else if (event.type === "pointermove" && this.dragging && this.slider) {
      this.setSlider(x);
    } else if (event.type === "pointerup" || event.type === "pointercancel") {
      this.dragging = false;
      if (this.slider) this.slider.dragging = false;
      this.pressedId = "";
      this.engine.input?.releasePointer(event.pointerId);
    }
  }

  private setSlider(x: number) {
    const s = this.slider;
    if (!s) return;
    s.setValue(s.valueAt(x));
    this.session.raiseTo = s.value;
    this.session.emit();
  }

  private click(id: string, x: number) {
    const s = this.session;
    if (id === "slider") {
      this.dragging = true;
      this.setSlider(x);
      return;
    }
    if (id.startsWith("tab:")) s.tab = id.slice(4) as "create" | "join";
    else if (id === "dur:prev" || id === "dur:next") {
      const index = DURATION_OPTIONS.findIndex((option) => option.minutes === s.durationMinutes);
      const step = id === "dur:next" ? 1 : -1;
      s.durationMinutes = DURATION_OPTIONS[(index + step + DURATION_OPTIONS.length) % DURATION_OPTIONS.length]!.minutes;
    }
    else if (id.startsWith("dur:")) s.durationMinutes = Number(id.slice(4));
    else if (id === "toggle:unlimited") s.unlimited = !s.unlimited;
    else if (id === "toggle:straddle") s.straddle = !s.straddle;
    else if (id === "toggle:squid") s.squid = !s.squid;
    else if (id === "toggle:bounty") s.bounty = !s.bounty;
    else if (id === "maxbuyin:+") s.maxBuyins = Math.min(99, s.maxBuyins + 1);
    else if (id === "maxbuyin:-") s.maxBuyins = Math.max(1, s.maxBuyins - 1);
    else if (id === "btn:random") void s.randomName();
    else if (id === "btn:create") void s.createTable();
    else if (id === "btn:join") void s.join(s.joinNumber.trim().toUpperCase(), s.joinPassword.trim());
    else if (id === "btn:copy") void s.copyInvite();
    else if (id === "btn:leave") void s.leaveTable();
    else if (id === "btn:sit") s.sitOrBuyin();
    else if (id === "btn:stand") void s.cmd({ type: "stand" });
    else if (id === "btn:rebuy") s.openBuyin();
    else if (id === "buyin:cancel") {
      s.buyinOpen = false;
    } else if (id === "buyin:ok") s.confirmBuyin();
    else if (id.startsWith("runout:")) void s.cmd({ type: "runout", choice: id.slice(7) });
    else if (id.startsWith("act:")) {
      const act = id.slice(4);
      if (act === "show") void s.cmd({ type: "show" });
      else void s.cmd({ type: "action", action: act, amount: s.raiseTo });
    }
    s.emit();
  }

  private drawLobby(p: Painter, width: number, height: number) {
    const cardW = Math.min(460, width - 32);
    const cardX = (width - cardW) / 2;
    let y = Math.max(24, height * 0.06);
    const s = this.session;
    const cardH = Math.min(height - y - 24, 640);
    p.roundRect(cardX + 4, y + 8, cardW, cardH, rgb(0, 0, 0, 0.32), 1, 18);
    p.roundRect(cardX, y, cardW, cardH, rgb(226, 192, 120, 0.28), 2, 18);
    p.roundRect(cardX + 1, y + 1, cardW - 2, cardH - 2, P.panel, 2, 17);
    y += 22;
    const suits = [
      { glyph: "♠", color: P.gold },
      { glyph: "♥", color: P.danger },
      { glyph: "♣", color: P.gold },
      { glyph: "♦", color: P.danger },
    ];
    const suitStart = cardX + cardW / 2 - 42;
    suits.forEach((suit, i) => p.labelCenter(suit.glyph, suitStart + i * 28, y + 10, { font: "20px serif", fill: suit.color, layer: 4 }));
    y += 28;
    p.labelCenter("Easy Poker", cardX + cardW / 2, y + 16, {
      font: "32px 'PingFang SC', sans-serif",
      layer: 4,
    });
    y += 36;
    p.labelCenter("Texas Hold’em · up to 8 players", cardX + cardW / 2, y + 8, {
      font: "13px 'PingFang SC', sans-serif",
      fill: P.muted,
      layer: 4,
    });
    y += 28;
    p.label("昵称", cardX + 24, y, { fill: P.muted, layer: 4, font: "13px 'PingFang SC', sans-serif" });
    y += 22;
    const fieldH = 40;
    const randW = 72;
    const nickW = cardW - 48 - randW - 8;
    const nickInput = this.setInput("nick", { x: cardX + 24, y, w: nickW, h: fieldH });
    nickInput.value = s.nickname;
    p.input(nickInput, 3);
    p.button("btn:random", cardX + 24 + nickW + 8, y, randW, fieldH, "随机名", {
      fill: P.dim,
      ink: P.ink,
    });
    y += fieldH + 16;
    const tabW = (cardW - 48 - 6) / 2;
    p.button("tab:create", cardX + 24, y, tabW, 40, "创建游戏桌", {
      fill: s.tab === "create" ? P.gold : P.dim,
      ink: s.tab === "create" ? rgb(26, 18, 8) : P.muted,
      selected: s.tab === "create",
    });
    p.button("tab:join", cardX + 24 + tabW + 6, y, tabW, 40, "加入游戏桌", {
      fill: s.tab === "join" ? P.gold : P.dim,
      ink: s.tab === "join" ? rgb(26, 18, 8) : P.muted,
      selected: s.tab === "join",
    });
    y += 56;
    if (s.tab === "create") {
      p.label("游戏时长", cardX + 24, y, { fill: P.muted, layer: 4, font: "13px 'PingFang SC', sans-serif" });
      y += 22;
      const durationW = cardW - 48;
      p.roundRect(cardX + 24, y, durationW, 40, P.field, 3, 8);
      const selected = DURATION_OPTIONS.find((option) => option.minutes === s.durationMinutes) ?? DURATION_OPTIONS[0]!;
      p.button("dur:prev", cardX + 24, y, 40, 40, "‹", { fill: P.dim, ink: P.ink, layer: 4, accessibilityLabel: "上一个游戏时长" });
      p.labelCenter(selected.label, cardX + cardW / 2, y + 20, { layer: 4 });
      p.button("dur:next", cardX + cardW - 64, y, 40, 40, "›", { fill: P.dim, ink: P.ink, layer: 4, accessibilityLabel: "下一个游戏时长" });
      y += 52;
      this.toggle(p, "toggle:unlimited", cardX + 24, y, s.unlimited, "无限 buy-in");
      y += 32;
      if (!s.unlimited) {
        p.label("最大 buy-in 次数", cardX + 24, y + 6, { fill: P.muted, layer: 4 });
        const controlsX = cardX + cardW - 134;
        p.button("maxbuyin:-", controlsX, y, 32, 28, "−", { fill: P.dim, ink: P.ink, accessibilityLabel: "减少最大买入次数" });
        p.labelCenter(String(s.maxBuyins), controlsX + 52, y + 14, { fill: P.muted, layer: 4 });
        p.button("maxbuyin:+", controlsX + 70, y, 32, 28, "+", { fill: P.dim, ink: P.ink, accessibilityLabel: "增加最大买入次数" });
        y += 36;
      }
      this.toggle(p, "toggle:straddle", cardX + 24, y, s.straddle, "允许 Straddle（默认关）");
      y += 32;
      this.toggle(p, "toggle:squid", cardX + 24, y, s.squid, "鱿鱼游戏（默认关）");
      y += 32;
      this.toggle(p, "toggle:bounty", cardX + 24, y, s.bounty, "27 杂色奖励（默认开）");
      y += 44;
      p.button("btn:create", cardX + 24, y, cardW - 48, 44, "创建并进入");
    } else {
      p.label("游戏桌号码", cardX + 24, y, { fill: P.muted, layer: 4, font: "13px 'PingFang SC', sans-serif" });
      y += 22;
      const tableInput = this.setInput("table", { x: cardX + 24, y, w: cardW - 48, h: fieldH });
      tableInput.value = s.joinNumber;
      p.input(tableInput, 3);
      y += fieldH + 12;
      p.label("密码", cardX + 24, y, { fill: P.muted, layer: 4, font: "13px 'PingFang SC', sans-serif" });
      y += 22;
      const passInput = this.setInput("pass", { x: cardX + 24, y, w: cardW - 48, h: fieldH });
      passInput.value = s.joinPassword;
      p.input(passInput, 3);
      y += fieldH + 16;
      p.button("btn:join", cardX + 24, y, cardW - 48, 44, "加入游戏桌");
    }
  }

  private toggle(p: Painter, id: string, x: number, y: number, on: boolean, label: string) {
    p.rect(x, y, 18, 18, on ? P.gold : rgb(58, 81, 99), 4);
    if (!on) p.rect(x + 2, y + 2, 14, 14, P.field, 5);
    if (on) p.label("✓", x + 2, y - 1, { fill: rgb(26, 18, 8), layer: 5, font: "14px sans-serif" });
    p.label(label, x + 26, y, { layer: 5 });
    p.hit(id, x, y, 280, 22, 6, { label, pressed: on });
  }

  private drawTable(
    p: Painter,
    width: number,
    height: number,
    pixelWidth: number,
    pixelHeight: number,
  ) {
    const s = this.session;
    const snap = s.snapshot;
    const compact = isPortraitTable(width, height);
    const shortLandscape = !compact && height < 500;
    const compactDock = compact || height < 500;
    const top = compact ? 84 : 54;
    const dock = shortLandscape
      ? 104
      : compactDock
      ? Math.min(148, height * (height < 500 ? 0.4 : 0.27))
      : width < 1100
        ? Math.min(148, height * 0.25)
        : Math.min(100, height * 0.16);
    const feltH = height - top - dock;
    const portrait = isPortraitTable(width, height);
    const table = shortLandscape
      ? { x: width * 0.03, y: top + feltH * 0.03, w: width * 0.94, h: feltH * 0.94 }
      : stadiumRect(width, feltH, portrait, height);
    if (!shortLandscape) table.y += top;
    p.rect(0, 0, width, top, rgb(5, 12, 18, 0.86), 2);
    p.label(compact ? "Easy" : "Easy Poker", 12, 14, { fill: P.gold, font: "16px 'PingFang SC', sans-serif", layer: 5 });
    if (snap) {
      p.label(`${snap.tableNumber} · ${snap.password}`, compact ? 70 : 130, 16, {
        fill: P.muted,
        font: "13px ui-monospace, monospace",
        layer: 5,
        maxWidth: compact ? Math.max(80, width - 82) : Math.max(90, width - 300),
      });
      if (!compact && snap.remainingMs != null) {
        p.label(`剩余 ${fmtMs(snap.remainingMs)}`, 270, 16, { fill: P.gold, font: "13px ui-monospace, monospace", layer: 5 });
      }
    }
    const sitting = Boolean(snap?.me?.sitting);
    let bx = width - 8;
    const btn = (id: string, label: string, fill: Color, w = 72, disabled = false) => {
      bx -= w + 6;
      p.button(id, bx, compact ? 46 : 8, w, 32, label, { fill, ink: fill === P.gold ? rgb(26, 18, 8) : P.ink, disabled });
    };
    if (!(snap?.lastResult && !snap.street && snap.nextHandAt != null)) {
      btn("btn:leave", "退出", P.dim, compact ? 44 : 56);
      if (sitting) {
        btn("btn:stand", "起身", P.dim, compact ? 44 : 56);
        const canRebuy = snap?.config.unlimitedBuyin || (snap?.me?.buyinCount ?? 0) < (snap?.config.maxBuyins ?? 10);
        btn("btn:rebuy", "补码", P.dim, compact ? 44 : 56, !canRebuy);
      } else {
        btn("btn:sit", "坐下", P.gold, compact ? 48 : 64);
      }
      btn("btn:copy", compact ? "邀请" : "复制邀请链接", P.dim, compact ? 44 : 120);
    }
    p.rect(0, top - 1, width, 1, rgb(226, 192, 120, 0.15), 3);

    p.felt(table.x, table.y, table.w, table.h, this.assets!.feltTexture(pixelWidth, pixelHeight, portrait, pixelHeight), 1);
    if (snap?.tableNumber !== this.lastTable) {
      this.lastTable = snap?.tableNumber ?? "";
      this.lastPot = 0;
      this.potFlight = null;
    }
    if (snap && Number(snap.pot ?? 0) > this.lastPot) {
      const source = snap.seats.find((seat: any) => seat?.bet > 0);
      if (source) {
        const seat = snap.seats.indexOf(source);
        const vis = sitting ? (seat - (snap.me?.seat ?? 0) + SEATS) % SEATS : seat;
        const pos = (portrait ? PORTRAIT_SEATS : LANDSCAPE_SEATS)[vis] ?? { x: 50, y: 50 };
        this.potFlight = { x: table.x + (pos.x / 100) * table.w, y: table.y + (pos.y / 100) * table.h, at: performance.now() };
      }
      this.lastPot = Number(snap.pot ?? 0);
    } else if (snap) {
      this.lastPot = Number(snap.pot ?? 0);
    }
    if (!(snap?.lastResult && !snap.street)) this.drawSeats(p, snap, table, portrait, sitting);
    this.drawCenter(p, snap, table);
    const dockY = compactDock ? table.y + table.h + 8 : top + feltH;
    this.drawDock(p, snap, width, height, dock, dockY);
  }

  private drawSeats(p: Painter, snap: any, table: { x: number; y: number; w: number; h: number }, portrait: boolean, sitting: boolean) {
    if (!snap) return;
    const ring = portrait ? PORTRAIT_SEATS : LANDSCAPE_SEATS;
    const meSeat = snap.me?.seat ?? 0;
    const left = actionMsLeft(snap, this.session.recvAt);
    for (let seat = 0; seat < SEATS; seat++) {
      const vis = sitting ? (seat - meSeat + SEATS) % SEATS : seat;
      const pos = ring[vis] || { x: 50, y: 50 };
      const cx = table.x + (pos.x / 100) * table.w;
      let cy = table.y + (pos.y / 100) * table.h;
      const compressed = !portrait && table.h < 260;
      if (compressed) cy = Math.min(table.y + table.h - 38, Math.max(table.y + 38, cy));
      const s = snap.seats[seat];
      if (!s && table.w < 260) continue;
      const acting = Boolean(s?.acting);
      const pulse = acting ? 0.55 + 0.45 * Math.abs(Math.sin(this.pulse * 4)) : 1;
      const alpha = s?.folded ? 0.45 : s?.sitting && s.chips === 0 ? 0.72 : 1;
      const urgent = left != null && left <= 5000;
      p.disc(cx, cy - 10, 24, acting ? rgb(urgent ? 212 : 226, urgent ? 82 : 192, urgent ? 78 : 120, pulse * alpha) : rgb(19, 32, 43, alpha), 8);
      p.disc(cx, cy - 10, 20, rgb(19, 32, 43, alpha), 9);
      const initial = s ? s.nickname.slice(0, 1) : "空";
      if (!acting || left == null) p.labelCenter(initial, cx, cy - 10, { font: "16px 'PingFang SC', sans-serif", fill: rgb(244, 239, 228, alpha), layer: 11 });
      if (acting && left != null) {
        p.labelCenter(String(Math.max(0, Math.ceil(left / 1000))), cx, cy - 10, {
          font: "bold 16px sans-serif",
          fill: left <= 5000 ? P.danger : P.gold,
          layer: 12,
        });
      }
      const name = s ? s.nickname : "空位";
      p.labelCenter(`${name}${s?.hasSquid ? " 🦑" : ""}`, cx, cy + 18, { font: "12px 'PingFang SC', sans-serif", fill: rgb(244, 239, 228, alpha), layer: 11, maxWidth: 110 });
      if (s) {
        const pending = s.pendingChips ? ` +${fmtChips(s.pendingChips)}` : "";
        const broke = s.sitting && s.chips === 0 && !s.pendingChips ? " · 待补码" : "";
        p.labelCenter(`${fmtChips(s.chips)}${pending}${broke}`, cx, cy + 34, {
          font: "11px 'PingFang SC', sans-serif",
          fill: rgb(P.muted[0] * 255, P.muted[1] * 255, P.muted[2] * 255, alpha),
          layer: 11,
        });
        const badges = [
          s.isButton ? ["D", rgb(40, 40, 40)] : null,
          s.isSb ? ["SB", rgb(40, 90, 160)] : null,
          s.isBb ? ["BB", rgb(160, 90, 40)] : null,
          s.isStraddle ? ["STR", rgb(90, 40, 120)] : null,
        ].filter(Boolean) as Array<[string, Color]>;
        let badgeX = compressed ? cx - 34 - (badges.length - 1) * 18 : cx - ((badges.length - 1) * 18) / 2;
        const badgeY = compressed ? cy - 10 : cy - 40;
        const badge = (t: string, c: Color) => {
          p.disc(badgeX, badgeY, 9, c, 12);
          p.labelCenter(t, badgeX, badgeY, { font: "9px sans-serif", fill: P.ink, layer: 13 });
          badgeX += 18;
        };
        badges.forEach(([text, color]) => badge(text, color));
        if (s.bet && compressed) {
          p.labelCenter(`下注 ${fmtChips(s.bet)}`, cx, cy < table.y + table.h / 2 ? cy + 34 : cy - 34, {
            font: "11px sans-serif",
            fill: P.gold,
            layer: 14,
          });
        } else if (s.bet) {
          this.drawChips(p, cx, cy + (vis === 0 ? -52 : 50), s.bet, 14);
        }
        if (s.holeCards && s.playerId !== snap.me?.id) {
          s.holeCards.forEach((c: string, i: number) => {
            p.card(c, cx - 16 + i * 22, cy - 48, 28, 40, 12);
          });
        }
      }
    }
  }

  private drawCenter(p: Painter, snap: any, table: { x: number; y: number; w: number; h: number }) {
    if (!snap) return;
    if (snap.lastResult && !snap.street) {
      p.labelCenter(`底池 ${fmtChips(snap.pot ?? 0)}`, table.x + table.w / 2, table.y + table.h * 0.25, {
        fill: P.gold,
        font: "16px 'PingFang SC', sans-serif",
        layer: 10,
      });
      this.drawShowdown(p, snap, table);
      return;
    }
    const cx = table.x + table.w / 2;
    const cy = table.y + table.h / 2;
    const narrow = table.w < 260;
    const compressed = table.h < 260;
    const pot = snap.pot ?? 0;
    const street = snap.street ? String(snap.street).toUpperCase() : snap.status === "waiting" ? "等待玩家" : "";
    const board = this.session.shownBoard;
    const bw = compressed || table.w < 300 ? 38 : 52;
    const bh = compressed || table.w < 300 ? 54 : 74;
    const gap = compressed || table.w < 300 ? 4 : 8;
    const boardSpan = board.length ? board.length * bw + (board.length - 1) * gap : 0;
    const potX = compressed ? Math.max(table.x + 60, cx - boardSpan / 2 - 60) : cx;
    const potY = compressed ? cy + 2 : cy - 42;
    this.drawChips(p, potX, potY, pot, 10);
    p.labelCenter(`${pot ? "底池" : "底池 0"}${street ? ` · ${street}` : ""}`, potX, cy - (compressed ? 28 : 68), {
      fill: P.gold,
      font: "16px 'PingFang SC', sans-serif",
      layer: 10,
    });
    if (this.potFlight) {
      const t = Math.min(1, (performance.now() - this.potFlight.at) / 360);
      if (t < 1) {
        const eased = tweenValue(0, 1, t, easeOutBack);
        p.chip(1, this.potFlight.x + (potX - this.potFlight.x) * eased, this.potFlight.y + (potY - this.potFlight.y) * eased, 7, 11);
      } else {
        this.potFlight = null;
      }
    }
    const start = cx - ((board.length - 1) * (bw + gap)) / 2;
    board.forEach((item, i) => {
      const t = Math.min(1, (Date.now() - item.at) / 220);
      const sc = tweenValue(0.7, 1, t, easeOutBack);
      p.card(item.card, start + i * (bw + gap), cy + (compressed ? 2 : 8), bw, bh, 10, sc);
    });
    const flags: string[] = [];
    if (snap.remainingMs != null) flags.push(`剩余 ${fmtMs(snap.remainingMs)}`);
    else flags.push("等待开局");
    if (snap.config.straddleAllowed) flags.push("Straddle");
    if (snap.config.squidEnabled) flags.push("鱿鱼");
    if (snap.config.bounty27Enabled) flags.push("27杂色");
    flags.push(snap.config.unlimitedBuyin ? "无限买入" : `最多${snap.config.maxBuyins}次买入`);
    const infoY = cy + bh / 2 + 30;
    if (!narrow && !compressed) {
      p.labelCenter(flags.join(" · "), cx, infoY, {
        fill: rgb(200, 200, 200, 0.55),
        font: "12px 'PingFang SC', sans-serif",
        layer: 10,
        maxWidth: table.w * 0.7,
      });
    }
    const timerY = !narrow && !compressed ? infoY + 22 : cy + (narrow ? 62 : 70);
    const voteLeft = voteMsLeft(snap, this.session.recvAt);
    const actionLeft = actionMsLeft(snap, this.session.recvAt);
    if (voteLeft != null && !compressed) {
      p.labelCenter(`发牌协商 ${Math.ceil(voteLeft / 1000)}s`, cx, timerY, { fill: P.gold, font: "13px sans-serif", layer: 10 });
    } else if (actionLeft != null && !compressed) {
      p.labelCenter(`行动倒计时 ${Math.max(0, Math.ceil(actionLeft / 1000))}s`, cx, timerY, {
        fill: actionLeft <= 5000 ? P.danger : P.gold,
        font: "13px sans-serif",
        layer: 10,
      });
    } else if (snap.nextHandAt && !snap.street && !compressed) {
      p.labelCenter(`下一手 ${Math.max(0, Math.ceil((snap.nextHandAt - Date.now()) / 1000))}s`, cx, timerY, { fill: P.gold, font: "13px sans-serif", layer: 10 });
    }
  }

  private drawShowdown(p: Painter, snap: any, table: { x: number; y: number; w: number; h: number }) {
    const lr = snap.lastResult;
    const viewport = this.engine.viewport;
    const portrait = isPortraitTable(viewport.width, viewport.height);
    const w = Math.min(portrait ? 340 : 520, viewport.width - 32);
    const x = (viewport.width - w) / 2;
    const multiRun = (lr.runs?.length ?? 0) > 1;
    const short = viewport.height < 500;
    const panelH = Math.min(multiRun ? 460 : 300, viewport.height - (short ? 48 : portrait ? 96 : 80));
    const y = Math.max(8, (this.engine.viewport.height - panelH) / 2);
    p.roundRect(x, y, w, panelH, rgb(8, 16, 24, 0.94), 40, 18);
    const kicker = (lr.timeoutIds || []).length
      ? "超时弃牌 · 本手结算"
      : lr.uncontested
        ? "对手弃牌 · 本手结算"
        : "本手结算";
    p.labelCenter(kicker, x + w / 2, y + 22, { fill: P.gold, layer: 42, font: "16px 'PingFang SC', sans-serif" });
    const runs = lr.runs?.length ? lr.runs : [{ board: lr.board || [], winners: lr.winners || [] }];
    const boardW = short ? 36 : portrait ? 42 : 60;
    const boardH = short ? 50 : portrait ? 60 : 84;
    let yy = y + 48;
    runs.forEach((run: any, i: number) => {
      if (runs.length > 1) {
        p.labelCenter(`第 ${i + 1} 次`, x + w / 2, yy, { fill: P.muted, layer: 42, font: "12px sans-serif" });
        yy += 16;
      }
      const cards: string[] = run.board || [];
      const gap = short ? 4 : portrait ? 6 : 8;
      const start = x + w / 2 - ((cards.length - 1) * (boardW + gap)) / 2;
      cards.forEach((c, ci) => p.card(c, start + ci * (boardW + gap), yy + boardH / 2 + 2, boardW, boardH, 42));
      yy += boardH + (short ? 12 : 20);
    });
    const winIds = new Set(lr.winners.filter((w: any) => w.amount > 0).map((w: any) => w.id));
    const ids = new Set([
      ...Object.keys(lr.shown || {}),
      ...lr.winners.map((w: any) => w.id),
      ...(lr.foldedIds || []),
    ]);
    for (const id of ids) {
      const win = winIds.has(id);
      const folded = (lr.foldedIds || []).includes(id);
      const timed = (lr.timeoutIds || []).includes(id);
      const hn2 = lr.winners.find((w: any) => w.id === id)?.handName || "";
      const tag = timed ? " · 超时弃牌" : folded && !win ? " · 弃牌" : hn2 ? " · " + hn2 : "";
      p.label(`${nameOf(snap, id)}${tag}`, x + 16, yy, {
        fill: win ? P.gold : P.ink,
        layer: 42,
        font: "13px 'PingFang SC', sans-serif",
      });
      const cards: string[] = lr.shown?.[id] || [];
      const cardW = short ? 24 : 28;
      const cardH = short ? 34 : 40;
      cards.forEach((c, i) => p.card(c, x + w - 76 + i * (cardW + 4), yy + cardH / 2, cardW, cardH, 42));
      yy += short ? 38 : 44;
    }
    const winLine =
      lr.winners
        .filter((w: any) => w.amount > 0)
        .map((w: any) => `${nameOf(snap, w.id)} 赢得 ${fmtChips(w.amount)}${w.handName ? " · " + w.handName : ""}`)
        .join("　") || "本手结束";
    p.labelCenter(winLine, x + w / 2, yy + (portrait ? 24 : 16), { fill: P.gold, layer: 42, maxWidth: w - 24 });
  }

  private drawDock(p: Painter, snap: any, width: number, height: number, dock: number, y: number) {
    this.slider = null;
    p.rect(0, y, width, dock, rgb(5, 12, 18, 0.9), 20);
    p.rect(0, y, width, 1, rgb(226, 192, 120, 0.10), 21);
    const holes = snap?.lastResult && !snap.street ? [] : this.session.shownHoles;
    const compact = isPortraitTable(width, height) || height < 500;
    const short = compact && height < 650;
    const stacked = !compact && width < 1100;
    const holeW = short ? 44 : compact ? 52 : 62;
    const holeGap = 8;
    const holeStart = (width - holes.length * holeW - Math.max(0, holes.length - 1) * holeGap) / 2 + holeW / 2;
    holes.forEach((item, i) => {
      const t = Math.min(1, (Date.now() - item.at) / 220);
      const sc = tweenValue(0.65, 1, t, easeOutBack);
      p.card(item.card, holeStart + i * (holeW + holeGap), short ? y + 27 : compact ? y + 31 : stacked ? y + 42 : y + dock / 2, holeW, short ? 62 : compact ? 74 : 88, 22, sc);
    });
    if (!snap) return;
    const vote = snap.runoutVote;
    const meLive =
      vote && snap.me && snap.seats.some((seat: any) => seat && seat.playerId === snap.me.id && seat.inHand && !seat.folded);
    let ax = width - 16;
    let compactRow = 0;
    const gap = compact ? 6 : 8;
    const actionY = short ? 62 : 76;
    const actionH = short ? 32 : 40;
    const rowStep = short ? 36 : 42;
    const add = (id: string, label: string, fill: Color, w: number, disabled = false) => {
      if (compact && ax - (w + gap) < 8) {
        compactRow += 1;
        ax = width - 16;
      }
      ax -= w + gap;
      p.button(id, ax, y + (compact ? actionY + compactRow * rowStep : stacked ? 100 : 16), w, compact ? actionH : 40, label, { fill, ink: fill === P.gold || fill === P.bet ? rgb(26, 18, 8) : P.ink, layer: 24, disabled });
    };
    if (vote && meLive) {
      const picked = vote.choices?.[snap.me.id];
      add("runout:twice", "发两次", P.bet, 88, Boolean(picked));
      add("runout:once", "发一次", P.dim, 88, Boolean(picked));
      if (!compact) p.label("All-in 发几次公共牌？", 140, y + 26, { fill: P.muted, layer: 24 });
      if (picked) {
        /* buttons still shown; session ignores extra clicks via lock */
      }
      return;
    }
    const legal = snap.legal;
    if (!legal) {
      const canShow = Boolean(snap.me?.holeCards && snap.lastResult && !snap.street && !snap.lastResult.shown?.[snap.me.id]);
      if (canShow) {
        add("act:show", "亮牌", P.dim, 72);
      }
      const waitText =
        snap.lastResult && !snap.street
          ? "摊牌结算中"
          : snap.me?.sitting && snap.me.chips === 0
            ? "未补码，不参与下一手"
            : snap.me?.sitting
              ? "等待行动"
            : "观战中，坐下后可参与下一手";
      if (compact && snap.me && !canShow) {
        const statusW = Math.min(width - 24, 230);
        p.roundRect((width - statusW) / 2, y + 81, statusW, 22, rgb(61, 107, 78, 0.85), 23, 11);
        p.roundRect((width - statusW) / 2 + 1, y + 82, statusW - 2, 20, rgb(26, 44, 34, 0.96), 23, 10);
        p.labelCenter(`${waitText} · 筹码 ${fmtChips(snap.me.chips)}`, width / 2, y + 92, {
          fill: P.muted,
          layer: 24,
          font: "11px 'PingFang SC', sans-serif",
          maxWidth: width - 24,
        });
      } else if (!compact) {
        p.label(waitText, 140, y + 28, { fill: P.muted, layer: 24 });
      }
      return;
    }
    if (legal.canAllIn) add("act:allin", "全下", P.allin, compact ? 64 : 72);
    if (legal.canBet || legal.canRaise) {
      const min = legal.canBet ? legal.minBet : legal.minRaiseTo;
      const max = legal.maxRaiseTo;
      const label = legal.canRaise ? `加注 ${fmtChips(this.session.raiseTo)}` : `下注 ${fmtChips(this.session.raiseTo)}`;
      add(legal.canRaise ? "act:raise" : "act:bet", label, P.bet, compact ? 104 : 120);
      const slW = compact ? 92 : 120;
      ax -= slW + gap;
      const slX = ax;
      const slY = y + (compact ? actionY + actionH / 2 : stacked ? 112 : 28);
      this.slider = new UISlider("slider", { x: slX, y: slY - 12, width: slW, height: 32 }, min, max, this.session.raiseTo);
      p.slider(this.slider, 24, "下注额");
      p.hit("slider", slX, slY - 12, slW, 32, 26);
    }
    if (compact && width < 430 && (legal.canBet || legal.canRaise)) {
      const commonWidth = (legal.canCall ? 90 + gap : 0) + (legal.canCheck ? 64 + gap : 0) + (legal.canFold ? 64 + gap : 0);
      compactRow += 1;
      ax = (width + commonWidth) / 2;
    }
    if (legal.canCall) add("act:call", `跟注 ${fmtChips(legal.callAmount)}`, P.call, compact ? 90 : 100);
    if (legal.canCheck) add("act:check", "过牌", P.check, compact ? 64 : 72);
    if (legal.canFold) add("act:fold", "弃牌", P.fold, compact ? 64 : 72);
  }

  private drawChips(p: Painter, cx: number, cy: number, amount: number, layer: number) {
    if (amount <= 0) return;
    let left = Math.max(0, Math.floor(amount));
    let i = 0;
    for (const d of CHIP) {
      const n = Math.min(4, Math.floor(left / d.v));
      left -= n * d.v;
      for (let k = 0; k < n; k++) {
        p.chip(d.v, cx - 16 + (i % 6) * 7, cy - Math.floor(i / 6) * 5, 7, layer);
        i += 1;
      }
    }
    p.labelCenter(fmtChips(amount), cx, cy + 14, { font: "11px sans-serif", fill: P.ink, layer: layer + 1 });
  }

  private drawSettle(p: Painter, width: number, height: number) {
    const snap = this.session.snapshot;
    const rows = (snap?.settlement?.players ?? [])
      .slice()
      .sort((a: any, b: any) => b.net - a.net);
    const cardW = Math.min(520, width - 32);
    const x = (width - cardW) / 2;
    let y = Math.max(24, height * 0.06);
    const cardH = height - y - 24;
    const buttonY = y + cardH - 56;
    p.roundRect(x + 4, y + 8, cardW, cardH, rgb(0, 0, 0, 0.32), 1, 18);
    p.roundRect(x, y, cardW, cardH, rgb(226, 192, 120, 0.28), 2, 18);
    p.roundRect(x + 1, y + 1, cardW - 2, cardH - 2, P.panel, 2, 17);
    p.labelCenter("游戏桌已结束", x + cardW / 2, y + 28, { font: "22px 'PingFang SC', sans-serif", layer: 4 });
    p.labelCenter("该桌不能重新开启，以下为结算", x + cardW / 2, y + 52, { fill: P.muted, layer: 4 });
    y += 80;
    p.label("玩家", x + 24, y, { fill: P.muted, layer: 4 });
    p.label("买入", x + cardW * 0.42, y, { fill: P.muted, layer: 4 });
    p.label("筹码", x + cardW * 0.62, y, { fill: P.muted, layer: 4 });
    p.label("净胜负", x + cardW * 0.8, y, { fill: P.muted, layer: 4 });
    y += 28;
    const rowGap = Math.min(28, Math.max(16, (buttonY - y - 8) / Math.max(1, rows.length)));
    const rowFont = cardW < 400 || rowGap < 22 ? "11px 'PingFang SC', sans-serif" : "14px 'PingFang SC', sans-serif";
    for (const row of rows) {
      p.label(row.nickname, x + 24, y, { layer: 4, font: rowFont, maxWidth: cardW * 0.34 });
      p.label(fmtChips(row.buyinChips), x + cardW * 0.42, y, { layer: 4, font: rowFont });
      p.label(fmtChips(row.stack), x + cardW * 0.62, y, { layer: 4, font: rowFont });
      p.label(`${row.net >= 0 ? "+" : ""}${fmtChips(row.net)}`, x + cardW * 0.8, y, {
        fill: row.net >= 0 ? P.ok : P.danger,
        layer: 4,
        font: rowFont,
      });
      y += rowGap;
    }
    const buttonW = (cardW - 56) / 2;
    p.button("btn:copy", x + 24, buttonY, buttonW, 40, "复制邀请链接", { fill: P.dim, ink: P.ink });
    p.button("btn:leave", x + 32 + buttonW, buttonY, buttonW, 40, "退出游戏桌");
  }

  private drawBuyin(p: Painter, width: number, height: number) {
    p.rect(0, 0, width, height, rgb(0, 0, 0, 0.55), 50);
    const w = Math.min(400, width - 40);
    const h = 260;
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    p.roundRect(x + 4, y + 8, w, h, rgb(0, 0, 0, 0.38), 50, 18);
    p.roundRect(x, y, w, h, rgb(226, 192, 120, 0.32), 51, 18);
    p.roundRect(x + 1, y + 1, w - 2, h - 2, P.panel, 51, 17);
    p.labelCenter("补充筹码", x + w / 2, y + 28, { font: "20px 'PingFang SC', sans-serif", layer: 52 });
    const snap = this.session.snapshot;
    const bb = 100 * (snap?.config.bigBlind ?? 2);
    const remaining = snap?.me?.buyinCount == null || snap?.config?.unlimitedBuyin
      ? "无限"
      : String(Math.max(0, snap.config.maxBuyins - snap.me.buyinCount));
    p.label(`每次 buy-in = ${bb}。还可买入 ${remaining} 次，下一手到账。`, x + 24, y + 56, {
      fill: P.muted,
      layer: 52,
      maxWidth: w - 48,
    });
    const buyinInput = this.setInput("buyin", { x: x + 24, y: y + 100, w: w - 48, h: 40 });
    buyinInput.value = String(this.session.buyinN);
    p.input(buyinInput, 52);
    p.button("buyin:cancel", x + 24, y + h - 56, (w - 56) / 2, 40, "取消", { fill: P.dim, ink: P.ink, layer: 53 });
    p.button("buyin:ok", x + 32 + (w - 56) / 2, y + h - 56, (w - 56) / 2, 40, snap?.me?.sitting ? "补码" : "坐下", {
      layer: 53,
      disabled: remaining === "0",
    });
  }

  private drawToast(p: Painter, width: number, height: number) {
    const msg = this.session.toast;
    const w = Math.min(360, width - 40);
    const y = Math.min(height - 64, window.scrollY + window.innerHeight - 64);
    p.rect((width - w) / 2, y, w, 36, rgb(20, 20, 20, 0.9), 60);
    p.labelCenter(msg, width / 2, y + 18, { layer: 61, font: "13px 'PingFang SC', sans-serif" });
  }
}
