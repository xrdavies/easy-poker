import { PokerNet } from "./net.ts";
import { PokerSfx } from "./sfx.ts";

export const SEATS = 8;

export const PORTRAIT_SEATS = [
  { x: 50, y: 91 },
  { x: 11, y: 73 },
  { x: 7, y: 48 },
  { x: 11, y: 24 },
  { x: 50, y: 8 },
  { x: 89, y: 24 },
  { x: 93, y: 48 },
  { x: 89, y: 73 },
];

export const LANDSCAPE_SEATS = [
  { x: 50, y: 92 },
  { x: 14, y: 86 },
  { x: 4, y: 50 },
  { x: 14, y: 14 },
  { x: 50, y: 8 },
  { x: 86, y: 14 },
  { x: 96, y: 50 },
  { x: 86, y: 86 },
];

export const DURATION_OPTIONS = [
  { minutes: 30, label: "30 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 120, label: "2 小时" },
  { minutes: 240, label: "4 小时" },
  { minutes: 480, label: "8 小时" },
];

export type ScreenId = "lobby" | "table" | "settle";
export type LobbyTab = "create" | "join";

export function isPortraitTable(width = 0, height = 0) {
  if (width > 0 && height > 0) return height >= width || width <= 820;
  return window.matchMedia("(orientation: portrait), (max-width: 820px)").matches;
}

export function fmtChips(n: number) {
  return `${n.toLocaleString("zh-CN")}`;
}

export function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function actionMsLeft(snap: any, recvAt: number) {
  if (!snap?.actingPlayerId || snap.actionDeadline == null || snap.now == null) return null;
  const elapsed = Date.now() - (recvAt || Date.now());
  return Math.max(0, snap.actionDeadline - snap.now - elapsed);
}

export function voteMsLeft(snap: any, recvAt: number) {
  if (!snap?.runoutVote?.deadline || snap.now == null) return null;
  const elapsed = Date.now() - (recvAt || Date.now());
  return Math.max(0, snap.runoutVote.deadline - snap.now - elapsed);
}

export function nameOf(snap: any, id: string) {
  const s = snap.seats.find((x: any) => x?.playerId === id);
  return s?.nickname ?? id.slice(0, 4);
}

export function renderShowdown(snap: any) {
  return Boolean(snap?.lastResult && !snap.street);
}

export function inviteUrl(tableNumber: string, password: string) {
  const u = new URL(location.href);
  u.search = "";
  u.searchParams.set("t", tableNumber);
  u.searchParams.set("p", password);
  return u.toString();
}

type DealItem = { where: "hole" | "board"; card: string; at: number };

export class PokerSession {
  readonly net: PokerNet;
  readonly sfx: PokerSfx;
  readonly playerId: string;
  nickname = "";
  tableNumber = "";
  password = "";
  snapshot: any = null;
  screen: ScreenId = "lobby";
  tab: LobbyTab = "create";
  toast = "";
  raiseTo = 0;
  buyinOpen = false;
  buyinN = 1;
  durationMinutes = 30;
  unlimited = false;
  maxBuyins = 10;
  straddle = false;
  squid = false;
  bounty = true;
  joinNumber = "";
  joinPassword = "";
  recvAt = 0;
  lastEvents = "";
  lastTickSec: number | null = null;
  showdownHand: number | null = null;
  dealHand: number | null = null;
  shownHoles: DealItem[] = [];
  shownBoard: DealItem[] = [];
  dealQueue: Array<{ where: "hole" | "board"; card: string }> = [];
  dealBusy = false;
  actionLock = false;
  wsConnecting = false;
  transport: any = null;
  onChange: (() => void) | null = null;

  constructor(net: PokerNet, sfx: PokerSfx) {
    this.net = net;
    this.sfx = sfx;
    this.playerId = localStorage.getItem("ep.id") || crypto.randomUUID();
    localStorage.setItem("ep.id", this.playerId);
    this.nickname = localStorage.getItem("ep.nick") || "";
  }

  emit() {
    this.onChange?.();
  }

  play(name: string) {
    this.sfx.play(name);
  }

  toastMsg(msg: string) {
    this.toast = msg;
    this.emit();
    window.setTimeout(() => {
      if (this.toast === msg) {
        this.toast = "";
        this.emit();
      }
    }, 2200);
  }

  start() {
    const params = new URLSearchParams(location.search);
    const t = params.get("t");
    const p = params.get("p");
    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem("ep.table") || "null");
      } catch {
        return null;
      }
    })();
    if (t && p && this.nickname) void this.join(t, p);
    else if (saved?.tableNumber && saved?.password && this.nickname) {
      void this.join(saved.tableNumber, saved.password);
    }

    window.setInterval(() => {
      if (!this.snapshot || this.snapshot.status === "finished") return;
      if (this.snapshot.remainingMs != null) {
        this.snapshot.remainingMs = Math.max(0, this.snapshot.remainingMs - 250);
      }
      const left = actionMsLeft(this.snapshot, this.recvAt);
      this.tickSfx(this.snapshot);
      const wsOpen = Boolean(this.transport);
      if (this.tableNumber && (!wsOpen || left === 0)) void this.cmd({ type: "snapshot" });
      this.emit();
    }, 250);
  }

  tickSfx(snap: any) {
    const voteLeft = voteMsLeft(snap, this.recvAt);
    if (voteLeft != null) {
      this.lastTickSec = null;
      return;
    }
    const left = actionMsLeft(snap, this.recvAt);
    if (left != null && left > 0 && left <= 5000 && snap.actingPlayerId === snap.me?.id) {
      const sec = Math.max(0, Math.ceil(left / 1000));
      if (this.lastTickSec !== sec) {
        this.lastTickSec = sec;
        this.play("tick");
      }
      return;
    }
    this.lastTickSec = null;
  }

  applySnapshot(snap: any) {
    if (!snap) return;
    this.snapshot = snap;
    this.recvAt = Date.now();
    this.tableNumber = snap.tableNumber;
    this.password = snap.password;
    this.saveTableSession();
    if (snap.status === "finished") {
      this.screen = "settle";
      this.playEvents(snap.events);
      this.emit();
      return;
    }
    this.screen = "table";
    this.buyinOpen = false;
    const legal = snap.legal;
    if (legal?.canBet) this.raiseTo = legal.minBet;
    else if (legal?.canRaise) this.raiseTo = legal.minRaiseTo;
    this.playEvents(snap.events);
    this.queueDeals(snap);
    this.playShowdownSfx(snap);
    this.emit();
  }

  playEvents(events: any[] = []) {
    const key = JSON.stringify(events);
    if (key === this.lastEvents) return;
    this.lastEvents = key;
    if (!events.length) return;
    const played = new Set<string>();
    const once = (name: string) => {
      if (played.has(name)) return;
      played.add(name);
      this.play(name);
    };
    for (const e of events) {
      if (e.type === "fold") once("fold");
      else if (e.type === "check") once("check");
      else if (e.type === "call" || e.type === "bet" || e.type === "raise") this.play("bet");
      else if (e.type === "allin") once("allin");
    }
  }

  playShowdownSfx(snap: any) {
    if (!snap.lastResult || snap.street) {
      if (snap.street) this.showdownHand = null;
      return;
    }
    const hn = snap.lastResult.handNumber;
    if (this.showdownHand === hn) return;
    this.showdownHand = hn;
    const lr = snap.lastResult;
    const me = snap.me?.id;
    const won = Boolean(me && lr.winners.some((w: any) => w.id === me && w.amount > 0));
    const shown = Boolean(me && lr.shown?.[me]);
    const timedOut = Boolean(me && (lr.timeoutIds || []).includes(me));
    if (won) this.play("win");
    else if (shown || timedOut) this.play("lose");
  }

  queueDeals(snap: any) {
    const holes = snap.me?.holeCards ?? [];
    const board = snap.board ?? [];
    const hn = snap.handNumber;
    if (hn !== this.dealHand || board.length < this.shownBoard.length) {
      if (hn !== this.dealHand && (holes.length || board.length)) this.play("shuffle");
      this.dealHand = hn;
      this.shownHoles = [];
      this.shownBoard = [];
      this.dealQueue = [];
    }
    const queued = (where: string) => this.dealQueue.filter((x) => x.where === where).length;
    for (let i = this.shownHoles.length + queued("hole"); i < holes.length; i++) {
      this.dealQueue.push({ where: "hole", card: holes[i] });
    }
    for (let i = this.shownBoard.length + queued("board"); i < board.length; i++) {
      this.dealQueue.push({ where: "board", card: board[i] });
    }
    this.pumpDeal();
  }

  pumpDeal() {
    if (this.dealBusy) return;
    const item = this.dealQueue.shift();
    if (!item) return;
    this.dealBusy = true;
    this.play("deal");
    const rec: DealItem = { where: item.where, card: item.card, at: Date.now() };
    if (item.where === "hole") this.shownHoles.push(rec);
    else this.shownBoard.push(rec);
    this.emit();
    window.setTimeout(() => {
      this.dealBusy = false;
      this.pumpDeal();
      this.emit();
    }, 220);
  }

  saveTableSession() {
    if (!this.tableNumber || !this.password) return;
    localStorage.setItem(
      "ep.table",
      JSON.stringify({ tableNumber: this.tableNumber, password: this.password }),
    );
    const u = new URL(location.href);
    u.searchParams.set("t", this.tableNumber);
    u.searchParams.set("p", this.password);
    history.replaceState(null, "", u.pathname + u.search);
  }

  clearTableSession() {
    localStorage.removeItem("ep.table");
    const u = new URL(location.href);
    u.search = "";
    history.replaceState(null, "", u.pathname);
  }

  needNick() {
    this.nickname = this.nickname.trim();
    if (!this.nickname) {
      this.toastMsg("请先取一个昵称");
      return false;
    }
    localStorage.setItem("ep.nick", this.nickname);
    return true;
  }

  async randomName() {
    try {
      const data = await this.net.api("/api/names");
      this.nickname = data.nickname;
    } catch {
      this.nickname = `玩家${Math.floor(10 + Math.random() * 89)}`;
    }
    this.emit();
  }

  async createTable() {
    if (!this.needNick()) return;
    void this.sfx.unlock();
    try {
    const data = await this.net.api("/api/tables", {
      playerId: this.playerId,
      nickname: this.nickname,
      durationMinutes: this.durationMinutes,
      unlimitedBuyin: this.unlimited,
      maxBuyins: this.maxBuyins,
      straddleAllowed: this.straddle,
      squidEnabled: this.squid,
      bounty27Enabled: this.bounty,
    });
    this.applySnapshot(data.snapshot);
    void this.connectWs();
    } catch (err: any) {
      this.toastMsg(err.message || "创建失败");
    }
  }

  async join(tableNumber: string, password: string) {
    if (!this.needNick()) return;
    void this.sfx.unlock();
    try {
    const data = await this.net.api("/api/join", {
      type: "join",
      tableNumber,
      password,
      playerId: this.playerId,
      nickname: this.nickname,
    });
    this.applySnapshot(data.snapshot);
    void this.connectWs();
    } catch (err: any) {
      this.toastMsg(err.message || "加入失败");
    }
  }

  async cmd(payload: any) {
    if (payload.type === "action" || payload.type === "runout") {
      if (this.actionLock) return;
      this.actionLock = true;
      window.setTimeout(() => {
        this.actionLock = false;
      }, 800);
    }
    const body = {
      ...payload,
      playerId: this.playerId,
      tableNumber: this.tableNumber,
      nickname: this.nickname,
    };
    try {
      if (this.transport?.state === "open") {
        this.transport.send(JSON.stringify(body));
        return;
      }
      const data = await this.net.api("/api/cmd", body);
      this.applySnapshot(data.snapshot);
    } catch (err: any) {
      if (err?.code === "not_your_turn" || err?.error === "not_your_turn") return;
      this.toastMsg(err.message || "请求失败");
    }
  }

  async connectWs() {
    if (!this.tableNumber || this.wsConnecting) return;
    this.wsConnecting = true;
    try {
      const origin = await this.net.resolveOrigin();
      if (!this.tableNumber) return;
      const u = new URL(origin);
      const proto = u.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${u.host}/ws?table=${encodeURIComponent(this.tableNumber)}&playerId=${encodeURIComponent(this.playerId)}`;
      const transport = this.net.connectWs(
        url,
        (msg) => {
          if (msg.type === "state") this.applySnapshot(msg.snapshot);
          if (msg.type === "error") {
            if (msg.code === "not_your_turn" || msg.message === "还没轮到你") return;
            this.toastMsg(msg.message || msg.code);
          }
        },
        () => {
          if (this.transport === transport) this.transport = null;
          if (!this.tableNumber) return;
          window.setTimeout(() => void this.connectWs(), 1200);
        },
      );
      this.transport = transport;
    } finally {
      this.wsConnecting = false;
    }
  }

  async leaveTable() {
    const sitting = Boolean(this.snapshot?.me?.sitting);
    const finished = this.snapshot?.status === "finished";
    const tableNumber = this.tableNumber;
    if (sitting && !finished && tableNumber) {
      try {
        await this.net.api("/api/cmd", {
          type: "stand",
          playerId: this.playerId,
          tableNumber,
          nickname: this.nickname,
        });
      } catch {
        /* still leave */
      }
    }
    this.tableNumber = "";
    this.password = "";
    this.snapshot = null;
    this.lastEvents = "";
    if (this.transport) {
      const t = this.transport;
      this.transport = null;
      t.close();
    }
    this.clearTableSession();
    this.screen = "lobby";
    this.buyinOpen = false;
    this.emit();
  }

  async copyInvite() {
    const text = inviteUrl(this.tableNumber, this.password);
    try {
      await navigator.clipboard.writeText(text);
      this.toastMsg("邀请链接已复制");
    } catch {
      this.toastMsg(text);
    }
  }

  openBuyin() {
    this.buyinN = 1;
    this.buyinOpen = true;
    this.emit();
  }

  confirmBuyin() {
    this.buyinOpen = false;
    if (this.snapshot?.me?.sitting) void this.cmd({ type: "rebuy", buyinCount: this.buyinN });
    else void this.cmd({ type: "sit", buyinCount: this.buyinN });
    this.emit();
  }

  sitOrBuyin() {
    const snap = this.snapshot;
    if (snap?.me?.chips > 0) {
      void this.cmd({ type: "sit", buyinCount: 0 });
      return;
    }
    this.openBuyin();
  }
}
