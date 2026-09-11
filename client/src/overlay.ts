import { PokerNet } from "./net.ts";
import { PokerSfx } from "./sfx.ts";

export const SEATS = 8;
const $ = (id: string) => document.getElementById(id)!;
const SUIT: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };

type OverlayOpts = { net: PokerNet; sfx: PokerSfx };

const state: any = {
  playerId: localStorage.getItem("ep.id") || crypto.randomUUID(),
  nickname: localStorage.getItem("ep.nick") || "",
  tableNumber: "",
  password: "",
  snapshot: null,
  lastEvents: "",
  recvAt: 0,
  visualKey: "",
  dealHand: null,
  shownHoles: [],
  shownBoard: [],
  dealQueue: [],
  dealBusy: false,
  showdownHand: null,
  wsConnecting: false,
  actionLock: false,
  lastTickSec: null,
  transport: null as any,
};

localStorage.setItem("ep.id", state.playerId);

let net: PokerNet;
let sfx: PokerSfx;

function toast(msg: string) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout((toast as any)._t);
  (toast as any)._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

function play(name: string) {
  sfx.play(name);
}

function cardHTML(card: string, extra = "") {
  if (!card) return `<div class="card back ${extra}"></div>`;
  const red = card[1] === "h" || card[1] === "d" ? "red" : "black";
  const rank = card[0] === "T" ? "10" : card[0];
  return `<div class="card ${red} ${extra}"><span class="r">${rank}</span><span class="s">${SUIT[card[1]] ?? ""}</span></div>`;
}

function fmtChips(n: number) {
  return `${n.toLocaleString("zh-CN")}`;
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function paintRemain(ms: number | null | undefined) {
  const el = $("table-remain");
  if (el) el.textContent = ms != null ? `剩余 ${fmtMs(ms)}` : "等待开局";
}

export function isPortraitTable() {
  return window.matchMedia("(orientation: portrait), (max-width: 820px)").matches;
}

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

function seatPos(i: number) {
  const ring = isPortraitTable() ? PORTRAIT_SEATS : LANDSCAPE_SEATS;
  return ring[i] || { x: 50, y: 50 };
}

const CHIP_DENOMS = [
  { v: 500, cls: "c500" },
  { v: 100, cls: "c100" },
  { v: 25, cls: "c25" },
  { v: 5, cls: "c5" },
  { v: 1, cls: "c1" },
];

function chipStackHTML(amount: number) {
  if (!amount) return "";
  let left = Math.max(0, Math.floor(amount));
  const pieces: string[] = [];
  for (const d of CHIP_DENOMS) {
    const n = Math.min(7, Math.floor(left / d.v));
    left -= n * d.v;
    for (let i = 0; i < n; i++) pieces.push(`<i class="pchip ${d.cls}"></i>`);
  }
  if (!pieces.length && amount > 0) pieces.push(`<i class="pchip c1"></i>`);
  return `<div class="chip-stack" title="${fmtChips(amount)}">${pieces.slice(0, 14).join("")}<span class="chip-amt">${fmtChips(amount)}</span></div>`;
}

function saveTableSession() {
  if (!state.tableNumber || !state.password) return;
  localStorage.setItem("ep.table", JSON.stringify({ tableNumber: state.tableNumber, password: state.password }));
  const u = new URL(location.href);
  u.searchParams.set("t", state.tableNumber);
  u.searchParams.set("p", state.password);
  history.replaceState(null, "", u.pathname + u.search);
}

function clearTableSession() {
  localStorage.removeItem("ep.table");
  const u = new URL(location.href);
  u.search = "";
  history.replaceState(null, "", u.pathname);
}

function applySnapshot(snap: any) {
  if (!snap) return;
  state.snapshot = snap;
  state.recvAt = Date.now();
  state.tableNumber = snap.tableNumber;
  state.password = snap.password;
  saveTableSession();
  if (snap.status === "finished") {
    showSettle(snap);
    playEvents(snap.events);
    return;
  }
  $("gate").classList.add("hidden");
  $("settle-screen").classList.add("hidden");
  $("table-screen").classList.remove("hidden");
  renderTable(snap);
  playEvents(snap.events);
  window.dispatchEvent(new Event("resize"));
}

function playEvents(events: any[] = []) {
  const key = JSON.stringify(events);
  if (key === state.lastEvents) return;
  state.lastEvents = key;
  if (!events.length) return;
  const played = new Set<string>();
  const once = (name: string) => {
    if (played.has(name)) return;
    played.add(name);
    play(name);
  };
  for (const e of events) {
    if (e.type === "fold") once("fold");
    else if (e.type === "check") once("check");
    else if (e.type === "call" || e.type === "bet" || e.type === "raise") play("bet");
    else if (e.type === "allin") once("allin");
  }
}

function visualKey(snap: any) {
  return JSON.stringify({
    h: snap.handNumber,
    street: snap.street,
    board: snap.board,
    holes: snap.me?.holeCards,
    acting: snap.actingPlayerId,
    pot: snap.pot,
    legal: snap.legal,
    last: snap.lastResult,
    vote: snap.runoutVote,
    portrait: isPortraitTable(),
    seats: snap.seats.map((s: any) =>
      s
        ? [s.playerId, s.chips, s.pendingChips, s.bet, s.folded, s.acting, s.holeCards, s.isButton, s.isSb, s.isBb, s.sitting]
        : null,
    ),
  });
}

function renderTable(snap: any) {
  $("table-id").textContent = `${snap.tableNumber} · ${snap.password}`;
  paintRemain(snap.remainingMs);
  const sitting = Boolean(snap.me?.sitting);
  $("btn-sit").classList.toggle("hidden", sitting);
  $("btn-stand").classList.toggle("hidden", !sitting);
  $("btn-rebuy-top").classList.toggle("hidden", !sitting);
  const key = visualKey(snap);
  if (key !== state.visualKey) {
    state.visualKey = key;
    renderSeats(snap);
    $("felt").classList.toggle("is-showdown", Boolean(snap.lastResult && !snap.street));
    $("street-label").textContent = !snap.street && snap.status === "waiting" ? "等待玩家" : "";
    $("pot").innerHTML = snap.pot ? chipStackHTML(snap.pot) : `<span class="chip-amt">底池 0</span>`;
    const bannerBits: string[] = [];
    if (snap.lastResult?.winners?.length && !snap.street) {
      bannerBits.push(
        snap.lastResult.winners
          .filter((w: any) => w.amount > 0)
          .map((w: any) => `${nameOf(snap, w.id)} 赢得 ${fmtChips(w.amount)}${w.handName ? " · " + w.handName : ""}`)
          .join("　"),
      );
      if (snap.me?.sitting && snap.me.chips === 0) bannerBits.push("筹码为 0，补码后从下一手参与");
    }
    $("banner").textContent = bannerBits.join(" · ");
    const flags: string[] = [];
    if (snap.config.straddleAllowed) flags.push("Straddle");
    if (snap.config.squidEnabled) flags.push("鱿鱼");
    if (snap.config.bounty27Enabled) flags.push("27杂色");
    flags.push(snap.config.unlimitedBuyin ? "无限买入" : `最多${snap.config.maxBuyins}次买入`);
    const flagsEl = $("table-rule-flags");
    if (flagsEl) flagsEl.textContent = flags.join(" · ");
    renderActions(snap);
    queueDeals(snap);
    renderShowdown(snap);
  }
  updateCountdown(snap);
}

function renderSeats(snap: any) {
  const root = $("seats");
  const meSeat = snap.me?.seat ?? 0;
  const sitting = Boolean(snap.me?.sitting);
  if (root.children.length !== SEATS) {
    root.innerHTML = "";
    for (let i = 0; i < SEATS; i++) {
      const d = document.createElement("div");
      d.className = "seat";
      d.dataset.i = String(i);
      root.appendChild(d);
    }
  }
  for (let seat = 0; seat < SEATS; seat++) {
    const vis = sitting ? (seat - meSeat + SEATS) % SEATS : seat;
    const pos = seatPos(vis);
    const el = root.children[seat] as HTMLElement;
    el.style.left = `${pos.x}%`;
    el.style.top = `${pos.y}%`;
    for (let v = 0; v < SEATS; v++) el.classList.toggle(`vis-${v}`, v === vis);
    const s = snap.seats[seat];
    const key = s
      ? `${s.playerId}|${s.chips}|${s.pendingChips}|${s.bet}|${s.folded}|${s.acting}|${(s.holeCards || []).join("")}|${s.isButton}|${s.isSb}|${s.isBb}`
      : "empty";
    if (el.dataset.key === key) continue;
    el.dataset.key = key;
    el.className =
      `seat vis-${vis}` +
      (s?.acting ? " acting" : "") +
      (s?.folded ? " folded" : "") +
      (s?.chips === 0 && s?.sitting ? " busted" : "") +
      (s?.playerId === snap.me?.id ? " me" : "");
    if (!s) {
      el.innerHTML = `<div class="avatar">空</div><div class="name">空位</div>`;
      continue;
    }
    const badges = [
      s.isButton ? '<i class="role-badge dealer">D</i>' : "",
      s.isSb ? '<i class="role-badge sb">SB</i>' : "",
      s.isBb ? '<i class="role-badge bb">BB</i>' : "",
      s.isStraddle ? '<i class="role-badge str">STR</i>' : "",
    ].join("");
    const squid = s.hasSquid ? "🦑" : "";
    const holes =
      s.holeCards && s.playerId !== snap.me?.id ? s.holeCards.map((c: string) => cardHTML(c, "tiny")).join("") : "";
    const pending = s.pendingChips ? ` <span class="pending">+${fmtChips(s.pendingChips)}</span>` : "";
    const broke = s.sitting && s.chips === 0 && !s.pendingChips ? " · 待补码" : "";
    el.innerHTML = `
        <div class="avatar">${s.acting ? '<i class="timer-ring"></i>' : ""}<span class="seat-initial">${escapeHtml(s.nickname.slice(0, 1))}</span><b class="seat-cd"></b>${badges}</div>
        <div class="name">${escapeHtml(s.nickname)}${squid}</div>
        <div class="stack">${fmtChips(s.chips)}${pending}${broke}</div>
        <div class="bet">${s.bet ? chipStackHTML(s.bet) : ""}</div>
        <div class="seat-cards">${holes}</div>`;
  }
}

function queuedCount(where: string) {
  return state.dealQueue.filter((x: any) => x.where === where).length;
}

function queueDeals(snap: any) {
  const holes = snap.me?.holeCards ?? [];
  const board = snap.board ?? [];
  const hn = snap.handNumber;
  if (hn !== state.dealHand || board.length < state.shownBoard.length) {
    if (hn !== state.dealHand && (holes.length || board.length)) play("shuffle");
    state.dealHand = hn;
    state.shownHoles = [];
    state.shownBoard = [];
    state.dealQueue = [];
    $("hole").innerHTML = "";
    $("board").innerHTML = "";
  }
  for (let i = state.shownHoles.length + queuedCount("hole"); i < holes.length; i++) {
    state.dealQueue.push({ where: "hole", card: holes[i] });
  }
  for (let i = state.shownBoard.length + queuedCount("board"); i < board.length; i++) {
    state.dealQueue.push({ where: "board", card: board[i] });
  }
  pumpDeal();
}

function pumpDeal() {
  if (state.dealBusy) return;
  const item = state.dealQueue.shift();
  if (!item) return;
  state.dealBusy = true;
  play("deal");
  const wrap = item.where === "hole" ? $("hole") : $("board");
  wrap.insertAdjacentHTML("beforeend", cardHTML(item.card, "deal-anim"));
  if (item.where === "hole") state.shownHoles.push(item.card);
  else state.shownBoard.push(item.card);
  setTimeout(() => {
    state.dealBusy = false;
    pumpDeal();
  }, 220);
}

export function renderShowdown(snap: any) {
  const box = $("showdown");
  if (!box) return;
  if (!snap.lastResult || snap.street) {
    box.classList.add("hidden");
    if (snap.street) state.showdownHand = null;
    return;
  }
  box.classList.remove("hidden");
  const hn = snap.lastResult.handNumber;
  if (state.showdownHand === hn) return;
  state.showdownHand = hn;
  const lr = snap.lastResult;
  const me = snap.me?.id;
  $("sd-kicker").textContent = (lr.timeoutIds || []).length
    ? "超时弃牌 · 本手结算"
    : lr.uncontested
      ? "对手弃牌 · 本手结算"
      : "本手结算";
  const runs = lr.runs?.length ? lr.runs : [{ board: lr.board || [], winners: lr.winners || [] }];
  $("sd-board").innerHTML = runs
    .map((run: any, i: number) => {
      const label = runs.length > 1 ? `<div class="sd-run-label">第 ${i + 1} 次</div>` : "";
      const cards = (run.board || []).map((c: string) => cardHTML(c)).join("");
      return `<div class="sd-run">${label}<div class="board">${cards}</div></div>`;
    })
    .join("");
  const winIds = new Set(lr.winners.filter((w: any) => w.amount > 0).map((w: any) => w.id));
  const ids = new Set([
    ...Object.keys(lr.shown || {}),
    ...lr.winners.map((w: any) => w.id),
    ...(lr.foldedIds || []),
  ]);
  $("sd-players").innerHTML = [...ids]
    .map((id) => {
      const win = winIds.has(id);
      const folded = (lr.foldedIds || []).includes(id);
      const timed = (lr.timeoutIds || []).includes(id);
      const cards = lr.shown?.[id] || [];
      const hn2 = lr.winners.find((w: any) => w.id === id)?.handName || "";
      const tag = timed ? " · 超时弃牌" : folded && !win ? " · 弃牌" : hn2 ? " · " + hn2 : "";
      const holes = cards.length ? cards.map((c: string) => cardHTML(c, "tiny")).join("") : "";
      return `<div class="sd-row ${win ? "winner" : ""}"><div class="name">${escapeHtml(nameOf(snap, id))}${tag}</div><div class="sd-holes">${holes}</div></div>`;
    })
    .join("");
  $("sd-win").textContent =
    lr.winners
      .filter((w: any) => w.amount > 0)
      .map((w: any) => `${nameOf(snap, w.id)} 赢得 ${fmtChips(w.amount)}${w.handName ? " · " + w.handName : ""}`)
      .join("　") || "本手结束";
  box.classList.remove("hidden");
  const won = Boolean(me && lr.winners.some((w: any) => w.id === me && w.amount > 0));
  const shown = Boolean(me && lr.shown?.[me]);
  const timedOut = Boolean(me && (lr.timeoutIds || []).includes(me));
  if (won) play("win");
  else if (shown || timedOut) play("lose");
}

export function actionMsLeft(snap: any) {
  if (!snap?.actingPlayerId || snap.actionDeadline == null || snap.now == null) return null;
  const elapsed = Date.now() - (state.recvAt || Date.now());
  return Math.max(0, snap.actionDeadline - snap.now - elapsed);
}

function voteMsLeft(snap: any) {
  if (!snap?.runoutVote?.deadline || snap.now == null) return null;
  const elapsed = Date.now() - (state.recvAt || Date.now());
  return Math.max(0, snap.runoutVote.deadline - snap.now - elapsed);
}

function updateCountdown(snap: any) {
  const el = $("countdown");
  const seatCd = document.querySelector(".seat.acting .seat-cd") as HTMLElement | null;
  const actingSeat = document.querySelector(".seat.acting");
  actingSeat?.classList.remove("cd-urgent");

  const voteLeft = voteMsLeft(snap);
  if (voteLeft != null) {
    if (el) el.textContent = `发牌协商 ${Math.ceil(voteLeft / 1000)}s`;
    if (seatCd) seatCd.textContent = "";
    state.lastTickSec = null;
    return;
  }

  const left = actionMsLeft(snap);
  if (left != null) {
    const sec = Math.max(0, Math.ceil(left / 1000));
    if (el) el.textContent = "";
    if (seatCd) seatCd.textContent = String(sec);
    if (left > 0 && left <= 5000) {
      actingSeat?.classList.add("cd-urgent");
      if (snap.actingPlayerId === snap.me?.id && state.lastTickSec !== sec) {
        state.lastTickSec = sec;
        play("tick");
      }
    } else {
      state.lastTickSec = null;
    }
    return;
  }

  if (seatCd) seatCd.textContent = "";
  state.lastTickSec = null;
  if (!el) return;
  if (snap.nextHandAt && !snap.street) {
    el.textContent = `下一手 ${Math.max(0, Math.ceil((snap.nextHandAt - Date.now()) / 1000))}s`;
  } else {
    el.textContent = "";
  }
}

function nameOf(snap: any, id: string) {
  const s = snap.seats.find((x: any) => x?.playerId === id);
  return s?.nickname ?? id.slice(0, 4);
}

function bindRaiseSlider() {
  const sl = $("raise-amt") as HTMLInputElement | null;
  const lab = $("raise-val");
  const btn = document.querySelector("#actions button[data-act='bet'], #actions button[data-act='raise']") as HTMLElement | null;
  if (!sl || !lab || !btn) return;
  const paint = () => {
    const n = Number(sl.value);
    lab.textContent = fmtChips(n);
    btn.textContent = `${btn.dataset.act === "raise" ? "加注" : "下注"} ${fmtChips(n)}`;
  };
  sl.addEventListener("input", paint);
  paint();
}

function renderActions(snap: any) {
  const box = $("actions");
  const vote = snap.runoutVote;
  const meLive =
    vote &&
    snap.me &&
    snap.seats.some((s: any) => s && s.playerId === snap.me.id && s.inHand && !s.folded);
  if (vote && meLive) {
    const picked = vote.choices?.[snap.me.id];
    box.innerHTML = `<div class="runout-bar">
      <span class="muted">All-in 发几次公共牌？</span>
      <button type="button" data-runout="once" class="ghost" ${picked ? "disabled" : ""}>发一次</button>
      <button type="button" data-runout="twice" class="raise" ${picked ? "disabled" : ""}>发两次</button>
    </div>`;
    return;
  }
  const legal = snap.legal;
  if (!legal) {
    const extras: string[] = [];
    if (snap.me?.holeCards && snap.lastResult && !snap.street && !snap.lastResult.shown?.[snap.me.id]) {
      extras.push(`<button type="button" data-act="show" class="ghost">亮牌</button>`);
    }
    const waitText =
      snap.lastResult && !snap.street
        ? "摊牌结算中"
        : snap.me?.sitting && snap.me.chips === 0
          ? "未补码，不参与下一手"
          : snap.me?.sitting
            ? "等待行动"
            : "观战中，坐下后可参与下一手";
    box.innerHTML = extras.join("") || `<span class="muted">${waitText}</span>`;
    return;
  }
  const parts: string[] = [];
  if (legal.canFold) parts.push(`<button type="button" data-act="fold" class="fold">弃牌</button>`);
  if (legal.canCheck) parts.push(`<button type="button" data-act="check" class="check">过牌</button>`);
  if (legal.canCall) parts.push(`<button type="button" data-act="call" class="call">跟注 ${fmtChips(legal.callAmount)}</button>`);
  if (legal.canBet) {
    parts.push(
      `<label class="raise-ctl"><input type="range" id="raise-amt" min="${legal.minBet}" max="${legal.maxRaiseTo}" value="${legal.minBet}" /><output id="raise-val">${fmtChips(legal.minBet)}</output></label>`,
    );
    parts.push(`<button type="button" data-act="bet" class="bet">下注 ${fmtChips(legal.minBet)}</button>`);
  }
  if (legal.canRaise) {
    parts.push(
      `<label class="raise-ctl"><input type="range" id="raise-amt" min="${legal.minRaiseTo}" max="${legal.maxRaiseTo}" value="${legal.minRaiseTo}" /><output id="raise-val">${fmtChips(legal.minRaiseTo)}</output></label>`,
    );
    parts.push(`<button type="button" data-act="raise" class="raise">加注 ${fmtChips(legal.minRaiseTo)}</button>`);
  }
  if (legal.canAllIn) parts.push(`<button type="button" data-act="allin" class="allin">全下</button>`);
  box.innerHTML = parts.join("");
  bindRaiseSlider();
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function cmd(payload: any) {
  if (payload.type === "action" || payload.type === "runout") {
    if (state.actionLock) return;
    state.actionLock = true;
    setTimeout(() => {
      state.actionLock = false;
    }, 800);
  }
  const body = { ...payload, playerId: state.playerId, tableNumber: state.tableNumber, nickname: state.nickname };
  try {
    if (state.transport?.state === "open") {
      state.transport.send(JSON.stringify(body));
      return;
    }
    const data = await net.api("/api/cmd", body);
    applySnapshot(data.snapshot);
  } catch (err: any) {
    if (err?.code === "not_your_turn" || err?.error === "not_your_turn") return;
    toast(err.message || "请求失败");
  }
}

async function connectWs() {
  if (!state.tableNumber) return;
  if (state.wsConnecting) return;
  state.wsConnecting = true;
  try {
    const origin = await net.resolveOrigin();
    if (!state.tableNumber) return;
    const u = new URL(origin);
    const proto = u.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${u.host}/ws?table=${encodeURIComponent(state.tableNumber)}&playerId=${encodeURIComponent(state.playerId)}`;
    const transport = net.connectWs(
      url,
      (msg) => {
        if (msg.type === "state") applySnapshot(msg.snapshot);
        if (msg.type === "error") {
          if (msg.code === "not_your_turn" || msg.message === "还没轮到你") return;
          toast(msg.message || msg.code);
        }
      },
      () => {
        if (state.transport === transport) state.transport = null;
        if (!state.tableNumber) return;
        setTimeout(() => void connectWs(), 1200);
      },
    );
    state.transport = transport;
  } finally {
    state.wsConnecting = false;
  }
}

function showLobby() {
  $("table-screen").classList.add("hidden");
  $("settle-screen").classList.add("hidden");
  $("gate").classList.remove("hidden");
  if (state.nickname) ($("nickname") as HTMLInputElement).value = state.nickname;
}

export async function leaveTable() {
  const sitting = Boolean(state.snapshot?.me?.sitting);
  const finished = state.snapshot?.status === "finished";
  const tableNumber = state.tableNumber;
  if (sitting && !finished && tableNumber) {
    try {
      await net.api("/api/cmd", {
        type: "stand",
        playerId: state.playerId,
        tableNumber,
        nickname: state.nickname,
      });
    } catch {
      /* still leave */
    }
  }
  state.tableNumber = "";
  state.password = "";
  state.snapshot = null;
  state.lastEvents = "";
  if (state.transport) {
    const t = state.transport;
    state.transport = null;
    t.close();
  }
  clearTableSession();
  showLobby();
}

function showSettle(snap: any) {
  $("gate").classList.add("hidden");
  $("table-screen").classList.add("hidden");
  $("settle-screen").classList.remove("hidden");
  const rows = (snap.settlement?.players ?? [])
    .slice()
    .sort((a: any, b: any) => b.net - a.net)
    .map(
      (p: any) =>
        `<tr><td>${escapeHtml(p.nickname)}</td><td>${fmtChips(p.buyinChips)}</td><td>${fmtChips(p.stack)}</td><td class="${p.net >= 0 ? "pos" : "neg"}">${p.net >= 0 ? "+" : ""}${fmtChips(p.net)}</td></tr>`,
    )
    .join("");
  $("settle-table").innerHTML = `<table class="settle-table"><thead><tr><th>玩家</th><th>买入</th><th>筹码</th><th>净胜负</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function inviteUrl() {
  const u = new URL(location.href);
  u.search = "";
  u.searchParams.set("t", state.tableNumber);
  u.searchParams.set("p", state.password);
  return u.toString();
}

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast(text);
  }
}

function needNick() {
  state.nickname = ($("nickname") as HTMLInputElement).value.trim();
  if (!state.nickname) {
    toast("请先取一个昵称");
    return false;
  }
  localStorage.setItem("ep.nick", state.nickname);
  return true;
}

export function startOverlay(opts: OverlayOpts) {
  net = opts.net;
  sfx = opts.sfx;
  if (state.nickname) ($("nickname") as HTMLInputElement).value = state.nickname;

  $("random-name").onclick = async () => {
    try {
      const data = await net.api("/api/names");
      ($("nickname") as HTMLInputElement).value = data.nickname;
    } catch {
      ($("nickname") as HTMLInputElement).value = `玩家${Math.floor(10 + Math.random() * 89)}`;
    }
  };

  document.querySelectorAll(".tab").forEach((btn) => {
    (btn as HTMLElement).onclick = () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b === btn));
      $("create-form").classList.toggle("hidden", (btn as HTMLElement).dataset.tab !== "create");
      $("join-form").classList.toggle("hidden", (btn as HTMLElement).dataset.tab !== "join");
    };
  });

  $("unlimited").onchange = () => {
    $("max-buyin-field").classList.toggle("hidden", ($("unlimited") as HTMLInputElement).checked);
  };

  $("create-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!needNick()) return;
    void sfx.unlock();
    const data = await net.api("/api/tables", {
      playerId: state.playerId,
      nickname: state.nickname,
      durationMinutes: Number(($("duration") as HTMLSelectElement).value),
      unlimitedBuyin: ($("unlimited") as HTMLInputElement).checked,
      maxBuyins: Number(($("max-buyins") as HTMLInputElement).value || 10),
      straddleAllowed: ($("straddle") as HTMLInputElement).checked,
      squidEnabled: ($("squid") as HTMLInputElement).checked,
      bounty27Enabled: ($("bounty") as HTMLInputElement).checked,
    });
    applySnapshot(data.snapshot);
    connectWs();
  };

  $("join-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!needNick()) return;
    void sfx.unlock();
    await join(($("join-number") as HTMLInputElement).value.trim().toUpperCase(), ($("join-password") as HTMLInputElement).value.trim());
  };

  $("btn-copy-link").onclick = () => copy(inviteUrl(), "邀请链接已复制");
  $("btn-copy-link-2").onclick = () => copy(inviteUrl(), "邀请链接已复制");
  $("btn-leave").onclick = () => void leaveTable();
  $("btn-leave-2").onclick = () => void leaveTable();

  $("btn-sit").onclick = () => {
    const snap = state.snapshot;
    if (snap?.me?.chips > 0) {
      void cmd({ type: "sit", buyinCount: 0 });
      return;
    }
    openBuyin("坐下");
  };
  $("buyin-cancel").onclick = () => $("modal").classList.add("hidden");
  $("buyin-ok").onclick = () => {
    $("modal").classList.add("hidden");
    const n = Number(($("buyin-n") as HTMLInputElement).value || 1);
    if (state.snapshot?.me?.sitting) void cmd({ type: "rebuy", buyinCount: n });
    else void cmd({ type: "sit", buyinCount: n });
  };
  $("btn-stand").onclick = () => void cmd({ type: "stand" });
  $("btn-rebuy-top").onclick = () => openBuyin("补码");
  $("actions").onclick = (e) => {
    const runout = (e.target as HTMLElement).closest("button[data-runout]") as HTMLElement | null;
    if (runout) {
      void cmd({ type: "runout", choice: runout.dataset.runout });
      return;
    }
    const btn = (e.target as HTMLElement).closest("button[data-act]") as HTMLElement | null;
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "show") {
      void cmd({ type: "show" });
      return;
    }
    const amount = Number(($("raise-amt") as HTMLInputElement | null)?.value);
    void cmd({ type: "action", action: act, amount: Number.isFinite(amount) ? amount : undefined });
  };

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
  if (t && p && state.nickname) void join(t, p);
  else if (saved?.tableNumber && saved?.password && state.nickname) void join(saved.tableNumber, saved.password);

  setInterval(() => {
    if (!state.snapshot || state.snapshot.status === "finished") return;
    if (state.snapshot.remainingMs != null) {
      state.snapshot.remainingMs = Math.max(0, state.snapshot.remainingMs - 250);
      paintRemain(state.snapshot.remainingMs);
    }
    updateCountdown(state.snapshot);
    const left = actionMsLeft(state.snapshot);
    const wsOpen = Boolean(state.transport);
    if (state.tableNumber && (!wsOpen || left === 0)) void cmd({ type: "snapshot" });
  }, 250);

  window.addEventListener("resize", () => {
    if (state.snapshot && state.snapshot.status !== "finished") {
      state.visualKey = "";
      renderTable(state.snapshot);
    }
  });
}

async function join(tableNumber: string, password: string) {
  const data = await net.api("/api/join", {
    type: "join",
    tableNumber,
    password,
    playerId: state.playerId,
    nickname: state.nickname,
  });
  applySnapshot(data.snapshot);
  connectWs();
}

function openBuyin(okLabel: string) {
  const snap = state.snapshot;
  const max = snap?.config.unlimitedBuyin ? 99 : Math.max(1, (snap?.config.maxBuyins ?? 10) - (snap?.me?.buyinCount ?? 0));
  ($("buyin-n") as HTMLInputElement).value = "1";
  ($("buyin-n") as HTMLInputElement).max = String(max);
  const when = snap?.me?.sitting ? "将在下一手开始时到账" : "坐下后立即到账";
  $("buyin-hint").textContent = `每次 ${100 * (snap?.config.bigBlind ?? 2)} 筹码；还可买入 ${snap?.config.unlimitedBuyin ? "无限" : max} 次。${when}`;
  $("buyin-ok").textContent = okLabel || "坐下";
  $("modal").classList.remove("hidden");
}
