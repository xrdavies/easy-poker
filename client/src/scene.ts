import {
  Camera2D,
  Engine,
  Renderer2D,
  easeOutBack,
  hitTest,
  tweenValue,
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
  { v: 500, c: rgb(156, 39, 176) },
  { v: 100, c: rgb(30, 30, 30) },
  { v: 25, c: rgb(46, 125, 50) },
  { v: 5, c: rgb(183, 28, 28) },
  { v: 1, c: rgb(230, 220, 200) },
];

export class PokerScene implements EngineSystem {
  readonly camera = new Camera2D();
  ime: ImeLayout = {};
  private assets: GpuAssets | null = null;
  private painter: Painter | null = null;
  private slider: { min: number; max: number; x: number; w: number } | null = null;
  private dragging = false;
  private pulse = 0;

  constructor(
    private readonly engine: Engine,
    private readonly renderer: Renderer2D,
    readonly session: PokerSession,
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

  render(): void {
    const { width, height, pixelWidth, pixelHeight } = this.engine.viewport;
    if (width < 2 || height < 2) return;
    this.camera.position = { x: width / 2, y: height / 2 };
    this.camera.setViewport(width, height);
    if (!this.assets) {
      this.assets = new GpuAssets(this.engine.gpu.device);
      this.painter = new Painter(this.engine.gpu.device, this.assets);
    }
    const p = this.painter!;
    p.reset();
    this.ime = {};
    p.rect(0, 0, width, height, P.bg, 0);

    if (this.session.screen === "lobby") this.drawLobby(p, width, height);
    else if (this.session.screen === "settle") this.drawSettle(p, width, height);
    else this.drawTable(p, width, height, pixelWidth, pixelHeight);

    if (this.session.buyinOpen) this.drawBuyin(p, width, height);
    if (this.session.toast) this.drawToast(p, width, height);
    this.syncIme();
    this.renderer.render(p.items, this.camera);
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
      f.buyin.value = String(this.session.buyinN);
    }
  }

  onInput(event: NormalizedInputEvent): void {
    if (event.kind !== "pointer") return;
    const x = event.coordinates.viewport.x;
    const y = event.coordinates.viewport.y;
    if (event.type === "pointerdown") {
      const hit = hitTest(this.painter?.hits ?? [], x, y);
      if (hit) this.click(hit.id, x);
    } else if (event.type === "pointermove" && this.dragging && this.slider) {
      this.setSlider(x);
    } else if (event.type === "pointerup" || event.type === "pointercancel") {
      this.dragging = false;
    }
  }

  private setSlider(x: number) {
    const s = this.slider;
    if (!s) return;
    const t = Math.min(1, Math.max(0, (x - s.x) / Math.max(1, s.w)));
    this.session.raiseTo = Math.round(s.min + t * (s.max - s.min));
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
    p.rect(cardX, y, cardW, Math.min(height - y - 24, 640), P.panel, 2);
    y += 22;
    p.labelCenter("♠  ♥  ♣  ♦", cardX + cardW / 2, y + 10, {
      font: "20px serif",
      fill: P.gold,
      layer: 4,
    });
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
    this.ime.nick = { x: cardX + 24, y, w: nickW, h: fieldH };
    p.rect(cardX + 24, y, nickW, fieldH, P.field, 3);
    p.button("btn:random", cardX + 24 + nickW + 8, y, randW, fieldH, "随机名", {
      fill: P.dim,
      ink: P.ink,
    });
    y += fieldH + 16;
    const tabW = (cardW - 48 - 6) / 2;
    p.button("tab:create", cardX + 24, y, tabW, 40, "创建游戏桌", {
      fill: s.tab === "create" ? P.gold : P.dim,
      ink: s.tab === "create" ? rgb(26, 18, 8) : P.muted,
    });
    p.button("tab:join", cardX + 24 + tabW + 6, y, tabW, 40, "加入游戏桌", {
      fill: s.tab === "join" ? P.gold : P.dim,
      ink: s.tab === "join" ? rgb(26, 18, 8) : P.muted,
    });
    y += 56;
    if (s.tab === "create") {
      p.label("游戏时长", cardX + 24, y, { fill: P.muted, layer: 4, font: "13px 'PingFang SC', sans-serif" });
      y += 22;
      const dw = (cardW - 48 - 16) / 5;
      for (let i = 0; i < DURATION_OPTIONS.length; i++) {
        const opt = DURATION_OPTIONS[i]!;
        const on = s.durationMinutes === opt.minutes;
        p.button(`dur:${opt.minutes}`, cardX + 24 + i * (dw + 4), y, dw, 32, opt.label.replace(" 分钟", "分").replace(" 小时", "时"), {
          fill: on ? P.gold : P.dim,
          ink: on ? rgb(26, 18, 8) : P.muted,
        });
      }
      y += 44;
      this.toggle(p, "toggle:unlimited", cardX + 24, y, s.unlimited, "无限 buy-in");
      y += 32;
      if (!s.unlimited) {
        p.label(`最大 buy-in 次数  ${s.maxBuyins}`, cardX + 24, y + 6, { fill: P.muted, layer: 4 });
        p.button("maxbuyin:-", cardX + cardW - 24 - 80, y, 36, 28, "−", { fill: P.dim, ink: P.ink });
        p.button("maxbuyin:+", cardX + cardW - 24 - 40, y, 36, 28, "+", { fill: P.dim, ink: P.ink });
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
      this.ime.table = { x: cardX + 24, y, w: cardW - 48, h: fieldH };
      p.rect(cardX + 24, y, cardW - 48, fieldH, P.field, 3);
      y += fieldH + 12;
      p.label("密码", cardX + 24, y, { fill: P.muted, layer: 4, font: "13px 'PingFang SC', sans-serif" });
      y += 22;
      this.ime.pass = { x: cardX + 24, y, w: cardW - 48, h: fieldH };
      p.rect(cardX + 24, y, cardW - 48, fieldH, P.field, 3);
      y += fieldH + 16;
      p.button("btn:join", cardX + 24, y, cardW - 48, 44, "加入游戏桌");
    }
  }

  private toggle(p: Painter, id: string, x: number, y: number, on: boolean, label: string) {
    p.rect(x, y, 18, 18, on ? P.gold : P.dim, 4);
    if (on) p.label("✓", x + 2, y - 1, { fill: rgb(26, 18, 8), layer: 5, font: "14px sans-serif" });
    p.label(label, x + 26, y, { layer: 5 });
    p.hit(id, x, y, 280, 22, 6);
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
    const top = 48;
    const dock = Math.min(120, height * 0.18);
    const feltH = height - top - dock;
    const portrait = isPortraitTable(width, height);
    const feltTex = this.assets!.feltTexture(pixelWidth, Math.round(pixelHeight * (feltH / height)), portrait);
    const compact = width < 820;
    p.rect(0, 0, width, top, rgb(5, 12, 18, 0.86), 2);
    p.label(compact ? "Easy" : "Easy Poker", 12, 14, { fill: P.gold, font: "16px 'PingFang SC', sans-serif", layer: 5 });
    if (snap && !compact) {
      p.label(`${snap.tableNumber} · ${snap.password}`, 130, 16, {
        fill: P.muted,
        font: "13px ui-monospace, monospace",
        layer: 5,
      });
    }
    const sitting = Boolean(snap?.me?.sitting);
    let bx = width - 8;
    const btn = (id: string, label: string, fill: Color, w = 72) => {
      bx -= w + 6;
      p.button(id, bx, 8, w, 32, label, { fill, ink: fill === P.gold ? rgb(26, 18, 8) : P.ink });
    };
    btn("btn:leave", "退出", P.dim, compact ? 44 : 56);
    if (sitting) {
      btn("btn:stand", "起身", P.dim, compact ? 44 : 56);
      btn("btn:rebuy", "补码", P.dim, compact ? 44 : 56);
    } else {
      btn("btn:sit", "坐下", P.gold, compact ? 48 : 64);
    }
    btn("btn:copy", compact ? "邀请" : "复制邀请链接", P.dim, compact ? 44 : 120);

    p.felt(0, top, width, feltH, feltTex, 1);
    const table = stadiumRect(width, feltH, portrait);
    table.y += top;
    this.drawSeats(p, snap, table, portrait, sitting);
    this.drawCenter(p, snap, table);
    this.drawDock(p, snap, width, height, dock, top + feltH);
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
      const cy = table.y + (pos.y / 100) * table.h;
      const s = snap.seats[seat];
      const acting = Boolean(s?.acting);
      const pulse = acting ? 0.55 + 0.45 * Math.abs(Math.sin(this.pulse * 4)) : 1;
      p.disc(cx, cy - 10, 24, acting ? rgb(226, 192, 120, pulse) : rgb(19, 32, 43), 8);
      p.disc(cx, cy - 10, 20, rgb(19, 32, 43), 9);
      const initial = s ? s.nickname.slice(0, 1) : "空";
      p.labelCenter(initial, cx, cy - 10, { font: "16px 'PingFang SC', sans-serif", layer: 11 });
      if (acting && left != null) {
        p.labelCenter(String(Math.max(0, Math.ceil(left / 1000))), cx, cy - 10, {
          font: "bold 16px sans-serif",
          fill: left <= 5000 ? P.danger : P.gold,
          layer: 12,
        });
      }
      const name = s ? s.nickname : "空位";
      p.labelCenter(name, cx, cy + 18, { font: "12px 'PingFang SC', sans-serif", fill: P.ink, layer: 11, maxWidth: 110 });
      if (s) {
        const pending = s.pendingChips ? ` +${fmtChips(s.pendingChips)}` : "";
        const broke = s.sitting && s.chips === 0 && !s.pendingChips ? " · 待补码" : "";
        p.labelCenter(`${fmtChips(s.chips)}${pending}${broke}`, cx, cy + 34, {
          font: "11px 'PingFang SC', sans-serif",
          fill: P.muted,
          layer: 11,
        });
        let badgeX = cx - 36;
        const badge = (t: string, c: Color) => {
          p.disc(badgeX, cy - 28, 9, c, 12);
          p.labelCenter(t, badgeX, cy - 28, { font: "9px sans-serif", fill: P.ink, layer: 13 });
          badgeX += 16;
        };
        if (s.isButton) badge("D", rgb(40, 40, 40));
        if (s.isSb) badge("SB", rgb(40, 90, 160));
        if (s.isBb) badge("BB", rgb(160, 90, 40));
        if (s.isStraddle) badge("STR", rgb(90, 40, 120));
        if (s.bet) this.drawChips(p, cx, cy + (vis === 0 ? -52 : 50), s.bet, 14);
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
    const cx = table.x + table.w / 2;
    const cy = table.y + table.h / 2;
    const pot = snap.pot ? `底池 ${fmtChips(snap.pot)}` : "底池 0";
    p.labelCenter(pot, cx, cy - 36, { fill: P.gold, font: "16px 'PingFang SC', sans-serif", layer: 10 });
    const board = this.session.shownBoard;
    const bw = 52;
    const start = cx - ((board.length - 1) * (bw + 8)) / 2;
    board.forEach((item, i) => {
      const t = Math.min(1, (Date.now() - item.at) / 220);
      const sc = tweenValue(0.7, 1, t, easeOutBack);
      p.card(item.card, start + i * (bw + 8), cy + 8, bw, 74, 10, sc);
    });
    const flags: string[] = [];
    if (snap.remainingMs != null) flags.push(`剩余 ${fmtMs(snap.remainingMs)}`);
    else flags.push("等待开局");
    if (snap.config.straddleAllowed) flags.push("Straddle");
    if (snap.config.squidEnabled) flags.push("鱿鱼");
    if (snap.config.bounty27Enabled) flags.push("27杂色");
    flags.push(snap.config.unlimitedBuyin ? "无限买入" : `最多${snap.config.maxBuyins}次买入`);
    p.labelCenter(flags.join(" · "), cx, cy + 58, {
      fill: rgb(200, 200, 200, 0.55),
      font: "12px 'PingFang SC', sans-serif",
      layer: 10,
      maxWidth: table.w * 0.7,
    });
    if (snap.lastResult && !snap.street) this.drawShowdown(p, snap, table);
  }

  private drawShowdown(p: Painter, snap: any, table: { x: number; y: number; w: number; h: number }) {
    const lr = snap.lastResult;
    const w = Math.min(520, table.w * 0.86);
    const x = table.x + (table.w - w) / 2;
    const y = table.y + table.h * 0.18;
    p.rect(x, y, w, Math.min(320, table.h * 0.64), rgb(8, 16, 24, 0.94), 40);
    const kicker = (lr.timeoutIds || []).length
      ? "超时弃牌 · 本手结算"
      : lr.uncontested
        ? "对手弃牌 · 本手结算"
        : "本手结算";
    p.labelCenter(kicker, x + w / 2, y + 22, { fill: P.gold, layer: 42, font: "16px 'PingFang SC', sans-serif" });
    const runs = lr.runs?.length ? lr.runs : [{ board: lr.board || [], winners: lr.winners || [] }];
    let yy = y + 48;
    runs.forEach((run: any, i: number) => {
      if (runs.length > 1) {
        p.labelCenter(`第 ${i + 1} 次`, x + w / 2, yy, { fill: P.muted, layer: 42, font: "12px sans-serif" });
        yy += 16;
      }
      const cards: string[] = run.board || [];
      const start = x + w / 2 - ((cards.length - 1) * 40) / 2;
      cards.forEach((c, ci) => p.card(c, start + ci * 40, yy + 28, 36, 50, 42));
      yy += 70;
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
      cards.forEach((c, i) => p.card(c, x + w - 70 + i * 26, yy + 10, 24, 34, 42));
      yy += 36;
    }
    const winLine =
      lr.winners
        .filter((w: any) => w.amount > 0)
        .map((w: any) => `${nameOf(snap, w.id)} 赢得 ${fmtChips(w.amount)}${w.handName ? " · " + w.handName : ""}`)
        .join("　") || "本手结束";
    p.labelCenter(winLine, x + w / 2, yy + 8, { fill: P.gold, layer: 42, maxWidth: w - 24 });
  }

  private drawDock(p: Painter, snap: any, width: number, height: number, dock: number, y: number) {
    p.rect(0, y, width, dock, rgb(5, 12, 18, 0.9), 20);
    const holes = this.session.shownHoles;
    holes.forEach((item, i) => {
      const t = Math.min(1, (Date.now() - item.at) / 220);
      const sc = tweenValue(0.65, 1, t, easeOutBack);
      p.card(item.card, 48 + i * 58, y + dock / 2, 54, 76, 22, sc);
    });
    if (!snap) return;
    const vote = snap.runoutVote;
    const meLive =
      vote && snap.me && snap.seats.some((seat: any) => seat && seat.playerId === snap.me.id && seat.inHand && !seat.folded);
    let ax = width - 16;
    const add = (id: string, label: string, fill: Color, w: number) => {
      ax -= w + 8;
      p.button(id, ax, y + 16, w, 40, label, { fill, ink: fill === P.gold || fill === P.bet ? rgb(26, 18, 8) : P.ink, layer: 24 });
    };
    if (vote && meLive) {
      const picked = vote.choices?.[snap.me.id];
      add("runout:twice", "发两次", P.bet, 88);
      add("runout:once", "发一次", P.dim, 88);
      p.label("All-in 发几次公共牌？", 140, y + 26, { fill: P.muted, layer: 24 });
      if (picked) {
        /* buttons still shown; session ignores extra clicks via lock */
      }
      return;
    }
    const legal = snap.legal;
    if (!legal) {
      if (snap.me?.holeCards && snap.lastResult && !snap.street && !snap.lastResult.shown?.[snap.me.id]) {
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
      p.label(waitText, 140, y + 28, { fill: P.muted, layer: 24 });
      return;
    }
    if (legal.canAllIn) add("act:allin", "全下", P.allin, 72);
    if (legal.canBet || legal.canRaise) {
      const min = legal.canBet ? legal.minBet : legal.minRaiseTo;
      const max = legal.maxRaiseTo;
      const label = legal.canRaise ? `加注 ${fmtChips(this.session.raiseTo)}` : `下注 ${fmtChips(this.session.raiseTo)}`;
      add(legal.canRaise ? "act:raise" : "act:bet", label, P.bet, 120);
      const slW = 120;
      ax -= slW + 8;
      const slX = ax;
      const slY = y + 28;
      p.rect(slX, slY, slW, 8, P.dim, 24);
      const t = (this.session.raiseTo - min) / Math.max(1, max - min);
      p.disc(slX + t * slW, slY + 4, 8, P.gold, 25);
      this.slider = { min, max, x: slX, w: slW };
      p.hit("slider", slX, slY - 12, slW, 32, 26);
    }
    if (legal.canCall) add("act:call", `跟注 ${fmtChips(legal.callAmount)}`, P.call, 100);
    if (legal.canCheck) add("act:check", "过牌", P.check, 72);
    if (legal.canFold) add("act:fold", "弃牌", P.fold, 72);
  }

  private drawChips(p: Painter, cx: number, cy: number, amount: number, layer: number) {
    let left = Math.max(0, Math.floor(amount));
    let i = 0;
    for (const d of CHIP) {
      const n = Math.min(4, Math.floor(left / d.v));
      left -= n * d.v;
      for (let k = 0; k < n; k++) {
        p.disc(cx - 16 + (i % 6) * 7, cy - Math.floor(i / 6) * 5, 7, d.c, layer);
        i += 1;
      }
    }
    p.labelCenter(fmtChips(amount), cx, cy + 14, { font: "11px sans-serif", fill: P.ink, layer: layer + 1 });
  }

  private drawSettle(p: Painter, width: number, height: number) {
    const snap = this.session.snapshot;
    const cardW = Math.min(520, width - 32);
    const x = (width - cardW) / 2;
    let y = height * 0.1;
    p.rect(x, y, cardW, height * 0.7, P.panel, 2);
    p.labelCenter("游戏桌已结束", x + cardW / 2, y + 28, { font: "22px 'PingFang SC', sans-serif", layer: 4 });
    p.labelCenter("该桌不能重新开启，以下为结算", x + cardW / 2, y + 52, { fill: P.muted, layer: 4 });
    y += 80;
    p.label("玩家", x + 24, y, { fill: P.muted, layer: 4 });
    p.label("买入", x + cardW * 0.42, y, { fill: P.muted, layer: 4 });
    p.label("筹码", x + cardW * 0.62, y, { fill: P.muted, layer: 4 });
    p.label("净胜负", x + cardW * 0.8, y, { fill: P.muted, layer: 4 });
    y += 28;
    const rows = (snap?.settlement?.players ?? [])
      .slice()
      .sort((a: any, b: any) => b.net - a.net);
    for (const row of rows) {
      p.label(row.nickname, x + 24, y, { layer: 4 });
      p.label(fmtChips(row.buyinChips), x + cardW * 0.42, y, { layer: 4 });
      p.label(fmtChips(row.stack), x + cardW * 0.62, y, { layer: 4 });
      p.label(`${row.net >= 0 ? "+" : ""}${fmtChips(row.net)}`, x + cardW * 0.8, y, {
        fill: row.net >= 0 ? P.ok : P.danger,
        layer: 4,
      });
      y += 28;
    }
    p.button("btn:copy", x + 24, height * 0.72, 140, 40, "复制邀请链接", { fill: P.dim, ink: P.ink });
    p.button("btn:leave", x + cardW - 164, height * 0.72, 140, 40, "退出游戏桌");
  }

  private drawBuyin(p: Painter, width: number, height: number) {
    p.rect(0, 0, width, height, rgb(0, 0, 0, 0.55), 50);
    const w = Math.min(400, width - 40);
    const h = 260;
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    p.rect(x, y, w, h, P.panel, 51);
    p.labelCenter("补充筹码", x + w / 2, y + 28, { font: "20px 'PingFang SC', sans-serif", layer: 52 });
    const snap = this.session.snapshot;
    const bb = 100 * (snap?.config.bigBlind ?? 2);
    p.label(`每次 buy-in = ${bb}。补码在下一手到账。`, x + 24, y + 56, {
      fill: P.muted,
      layer: 52,
      maxWidth: w - 48,
    });
    this.ime.buyin = { x: x + 24, y: y + 100, w: w - 48, h: 40 };
    p.rect(x + 24, y + 100, w - 48, 40, P.field, 52);
    p.button("buyin:cancel", x + 24, y + h - 56, (w - 56) / 2, 40, "取消", { fill: P.dim, ink: P.ink, layer: 53 });
    p.button("buyin:ok", x + 32 + (w - 56) / 2, y + h - 56, (w - 56) / 2, 40, snap?.me?.sitting ? "补码" : "坐下", {
      layer: 53,
    });
  }

  private drawToast(p: Painter, width: number, height: number) {
    const msg = this.session.toast;
    const w = Math.min(360, width - 40);
    p.rect((width - w) / 2, height - 64, w, 36, rgb(20, 20, 20, 0.9), 60);
    p.labelCenter(msg, width / 2, height - 46, { layer: 61, font: "13px 'PingFang SC', sans-serif" });
  }
}


