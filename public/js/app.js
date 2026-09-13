const $ = (id) => document.getElementById(id);
const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
const SEATS = 8;
const EMOJI = ["😡", "😤", "😫", "😄", "😂", "🥳", "😅", "🙃", "😏", "😜", "🤔", "😭"];
const state = {
  playerId: localStorage.getItem("ep.id") || crypto.randomUUID(),
  nickname: localStorage.getItem("ep.nick") || "",
  tableNumber: "",
  password: "",
  snapshot: null,
  ws: null,
  lastEvents: "",
  recvAt: 0,
  visualKey: "",
  dealHand: null,
  shownHoles: [],
  shownBoard: [],
  dealQueue: [],
  dealBusy: false,
  showdownHand: null,
  apiOrigin: "",
  wsConnecting: false,
  actionLock: false,
  raiseOpen: false,
  lastTickSec: null,
  emoteTimer: null,
};

localStorage.setItem("ep.id", state.playerId);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

const SFX_POOL = {
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

function play(name) {
  const pool = SFX_POOL[name] || [name];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const el = $(`sfx-${pick}`);
  if (!el) return;
  try {
    const node = el.cloneNode(true);
    node.currentTime = 0;
    void node.play().catch(() => {});
  } catch {
    /* autoplay may block until a gesture */
  }
}

function cardHTML(card, extra = "") {
  if (!card) return `<div class="card back ${extra}"></div>`;
  const red = card[1] === "h" || card[1] === "d" ? "red" : "black";
  const rank = card[0] === "T" ? "10" : card[0];
  return `<div class="card ${red} ${extra}"><span class="r">${rank}</span><span class="s">${SUIT[card[1]] ?? ""}</span></div>`;
}

function fmtChips(n) {
  return `${n.toLocaleString("zh-CN")}`;
}

function fmtMs(ms) {
  if (ms == null) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function paintRemain(ms) {
  const el = $("table-remain");
  if (el) el.textContent = ms != null ? `剩余 ${fmtMs(ms)}` : "等待开局";
}

function isPortraitTable() {
  return window.matchMedia("(orientation: portrait), (max-width: 820px)").matches;
}

const PORTRAIT_SEATS = [
  { x: 50, y: 91 },
  { x: 11, y: 73 },
  { x: 7, y: 48 },
  { x: 11, y: 24 },
  { x: 50, y: 8 },
  { x: 89, y: 24 },
  { x: 93, y: 48 },
  { x: 89, y: 73 },
];

const LANDSCAPE_SEATS = [
  { x: 50, y: 92 },
  { x: 14, y: 86 },
  { x: 4, y: 50 },
  { x: 14, y: 14 },
  { x: 50, y: 8 },
  { x: 86, y: 14 },
  { x: 96, y: 50 },
  { x: 86, y: 86 },
];

function seatPos(i) {
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

function chipStackHTML(amount) {
  if (!amount) return "";
  let left = Math.max(0, Math.floor(amount));
  const pieces = [];
  for (const d of CHIP_DENOMS) {
    const n = Math.min(7, Math.floor(left / d.v));
    left -= n * d.v;
    for (let i = 0; i < n; i++) pieces.push(`<i class="pchip ${d.cls}"></i>`);
  }
  if (!pieces.length && amount > 0) pieces.push(`<i class="pchip c1"></i>`);
  return `<div class="chip-stack" title="${fmtChips(amount)}">${pieces.slice(0, 14).join("")}<span class="chip-amt">${fmtChips(amount)}</span></div>`;
}

function inferApiOrigin() {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return `${location.protocol}//${host}:8789`;
  // if (host.endsWith(".workers.dev") && host.startsWith("easy-poker.")) {
  if (host.startsWith("easy-poker.")) {
    return `${location.protocol}//${host.replace(/^easy-poker\./, "easy-poker-api.")}`;
  }
  return location.origin;
}

let apiOriginPromise = null;

async function getApiOrigin() {
  if (state.apiOrigin) return state.apiOrigin;
  if (!apiOriginPromise) {
    apiOriginPromise = (async () => {
      try {
        const r = await fetch("/config.json", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (j && typeof j.apiOrigin === "string" && j.apiOrigin) return j.apiOrigin.replace(/\/$/, "");
        }
      } catch {
        /* fall through to convention */
      }
      return inferApiOrigin();
    })();
  }
  state.apiOrigin = await apiOriginPromise;
  return state.apiOrigin;
}

async function api(path, body) {
  const origin = await getApiOrigin();
  const res = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "请求失败"), data);
  return data;
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

function applySnapshot(snap) {
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
  clearTimeout(state.emoteTimer);
  const nextExpiry = Math.min(...snap.seats.map((s) => s?.reaction?.until ?? Infinity));
  if (Number.isFinite(nextExpiry)) state.emoteTimer = setTimeout(() => renderTable(state.snapshot), Math.max(0, nextExpiry - Date.now() + 25));
  playEvents(snap.events);
}

function playEvents(events = []) {
  const key = JSON.stringify(events);
  if (key === state.lastEvents) return;
  state.lastEvents = key;
  if (!events.length) return;
  const played = new Set();
  const once = (name) => {
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

function visualKey(snap) {
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
    seats: snap.seats.map((s) =>
      s
        ? [s.playerId, s.chips, s.pendingChips, s.bet, s.folded, s.acting, s.holeCards, s.isButton, s.isSb, s.isBb, s.sitting, s.reaction?.until > Date.now() ? s.reaction : null]
        : null,
    ),
  });
}

function renderTable(snap) {
  $("table-id").textContent = `${snap.tableNumber}/${snap.password}`;
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
    const bannerBits = [];
    if (snap.lastResult?.winners?.length && !snap.street) {
      bannerBits.push(
        snap.lastResult.winners
          .filter((w) => w.amount > 0)
          .map((w) => `${nameOf(snap, w.id)} 赢得 ${fmtChips(w.amount)}${w.handName ? " · " + w.handName : ""}`)
          .join("　"),
      );
      if (snap.me?.sitting && snap.me.chips === 0) bannerBits.push("筹码为 0，补码后从下一手参与");
    }
    $("banner").textContent = bannerBits.join(" · ");
    const flags = [snap.config.shortDeck ? "短牌 6-A · 同花>葫芦" : "长牌 2-A"];
    if (snap.config.straddleAllowed) flags.push("Straddle");
    if (snap.config.squidEnabled) flags.push("鱿鱼");
    if (snap.config.bounty27Enabled) flags.push("27杂色·翻牌后逼退·5BB/人");
    flags.push(snap.config.unlimitedBuyin ? "无限买入" : `最多${snap.config.maxBuyins}次买入`);
    const flagsEl = $("table-rule-flags");
    if (flagsEl) flagsEl.textContent = flags.join(" · ");
    renderActions(snap);
    queueDeals(snap);
  }
  renderShowdown(snap);
  updateCountdown(snap);
}

function renderSeats(snap) {
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
    const el = root.children[seat];
    el.style.left = `${pos.x}%`;
    el.style.top = `${pos.y}%`;
    for (let v = 0; v < SEATS; v++) el.classList.toggle(`vis-${v}`, v === vis);
    const s = snap.seats[seat];
    const key = s
      ? `${s.playerId}|${s.chips}|${s.pendingChips}|${s.bet}|${s.folded}|${s.acting}|${(s.holeCards || []).join("")}|${s.isButton}|${s.isSb}|${s.isBb}|${s.reaction?.until > Date.now() ? s.reaction.until : ""}`
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
      s.holeCards && s.playerId !== snap.me?.id ? s.holeCards.map((c) => cardHTML(c, "tiny")).join("") : "";
    const pending = s.pendingChips ? ` <span class="pending">+${fmtChips(s.pendingChips)}</span>` : "";
    const broke = s.sitting && s.chips === 0 && !s.pendingChips ? " · 待补码" : "";
    el.innerHTML = `
        <div class="avatar" ${s.playerId === snap.me?.id ? 'role="button" tabindex="0" aria-label="选择表情"' : ""}>${s.acting ? '<i class="timer-ring"></i>' : ""}<span class="seat-initial">${escapeHtml(s.nickname.slice(0, 1))}</span><b class="seat-cd"></b>${badges}${s.reaction?.until > Date.now() ? `<span class="emote-bubble">${s.reaction.emoji}</span>` : ""}</div>
        <div class="name">${escapeHtml(s.nickname)}${squid}</div>
        <div class="stack">${fmtChips(s.chips)}${pending}${broke}</div>
        <div class="bet">${s.bet ? chipStackHTML(s.bet) : ""}</div>
        <div class="seat-cards">${holes}</div>`;
  }
}

function queuedCount(where) {
  return state.dealQueue.filter((x) => x.where === where).length;
}

function queueDeals(snap) {
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

function renderShowdown(snap) {
  const box = $("showdown");
  if (!box) return;
  if (!snap.lastResult || snap.street) {
    box.classList.add("hidden");
    if (snap.street) state.showdownHand = null;
    return;
  }
  box.classList.remove("hidden");
  const hn = snap.lastResult.handNumber;
  const firstRender = state.showdownHand !== hn;
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
    .map((run, i) => {
      const label = runs.length > 1 ? `<div class="sd-run-label">第 ${i + 1} 次</div>` : "";
      const cards = (run.board || []).map((c) => cardHTML(c)).join("");
      return `<div class="sd-run">${label}<div class="board">${cards}</div></div>`;
    })
    .join("");
  const winIds = new Set(lr.winners.filter((w) => w.amount > 0).map((w) => w.id));
  const ids = new Set([
    ...Object.keys(lr.shown || {}),
    ...lr.winners.map((w) => w.id),
    ...(lr.foldedIds || []),
  ]);
  $("sd-players").innerHTML = [...ids]
    .map((id) => {
      const win = winIds.has(id);
      const folded = (lr.foldedIds || []).includes(id);
      const timed = (lr.timeoutIds || []).includes(id);
      const cards = lr.shown?.[id] || [];
      const hn2 = lr.winners.find((w) => w.id === id)?.handName || "";
      const tag = timed ? " · 超时弃牌" : folded && !win ? " · 弃牌" : hn2 ? " · " + hn2 : "";
      const holes = cards.length ? cards.map((c) => cardHTML(c, "tiny")).join("") : "";
      return `<div class="sd-row ${win ? "winner" : ""}"><div class="name">${escapeHtml(nameOf(snap, id))}${tag}</div><div class="sd-holes">${holes}</div></div>`;
    })
    .join("");
  const resultText = lr.winners
    .filter((w) => w.amount > 0)
    .map((w) => `${nameOf(snap, w.id)} 赢得 ${fmtChips(w.amount)}${w.handName ? " · " + w.handName : ""}`)
    .join("　") || "本手结束";
  const bounty = snap.events.find((e) => e.type === "bounty");
  $("sd-win").textContent = `${resultText}${bounty ? `　${nameOf(snap, bounty.playerId)} 获得 27 杂色奖励 ${fmtChips(bounty.amount)}` : ""}`;
  box.classList.remove("hidden");
  const won = Boolean(me && lr.winners.some((w) => w.id === me && w.amount > 0));
  const shown = Boolean(me && lr.shown?.[me]);
  const timedOut = Boolean(me && (lr.timeoutIds || []).includes(me));
  if (firstRender) {
    if (won) play("win");
    else if (shown || timedOut) play("lose");
  }
}

function actionMsLeft(snap) {
  if (!snap?.actingPlayerId || snap.actionDeadline == null || snap.now == null) return null;
  const elapsed = Date.now() - (state.recvAt || Date.now());
  return Math.max(0, snap.actionDeadline - snap.now - elapsed);
}

function voteMsLeft(snap) {
  if (!snap?.runoutVote?.deadline || snap.now == null) return null;
  const elapsed = Date.now() - (state.recvAt || Date.now());
  return Math.max(0, snap.runoutVote.deadline - snap.now - elapsed);
}

function updateCountdown(snap) {
  const el = $("countdown");
  const seatCd = document.querySelector(".seat.acting .seat-cd");
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

function nameOf(snap, id) {
  const s = snap.seats.find((x) => x?.playerId === id);
  return s?.nickname ?? id.slice(0, 4);
}

function bindRaiseSlider() {
  const sl = $("raise-amt");
  const lab = $("raise-val");
  const btn = document.querySelector("#actions button[data-act='bet'], #actions button[data-act='raise']");
  if (!sl || !lab || !btn) return;
  const paint = () => {
    const n = Number(sl.value);
    const allIn = n === Number(sl.max);
    lab.textContent = fmtChips(n);
    const amount = btn.querySelector("[data-submit-amount]");
    const label = btn.querySelector("[data-submit-label]");
    if (amount && label) {
      amount.textContent = fmtChips(n);
      label.textContent = allIn ? "All-in" : btn.dataset.act === "raise" ? "加注" : "下注";
      btn.setAttribute("aria-label", `${label.textContent} ${fmtChips(n)}`);
    } else {
      btn.textContent = `${isPortraitTable() ? "确认" : ""}${btn.dataset.act === "raise" ? "加注至" : "下注"} ${fmtChips(n)}${allIn ? " · All-in" : ""}`;
    }
  };
  sl.addEventListener("input", () => {
    document.querySelectorAll("#actions [data-preset]").forEach((button) => button.classList.remove("selected"));
    paint();
  });
  paint();
}

function renderActions(snap) {
  const box = $("actions");
  const vote = snap.runoutVote;
  const meLive =
    vote &&
    snap.me &&
    snap.seats.some((s) => s && s.playerId === snap.me.id && s.inHand && !s.folded);
  if (vote && meLive) {
    state.raiseOpen = false;
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
    state.raiseOpen = false;
    const extras = [];
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
  const act = legal.canBet ? "bet" : legal.canRaise ? "raise" : "";
  const min = legal.canBet ? legal.minBet : legal.minRaiseTo;
  const mobile = isPortraitTable();
  const mobileAmountOpen = Boolean(act && mobile && state.raiseOpen);
  const showAmount = Boolean(act && (!mobile || state.raiseOpen));
  if (!act) state.raiseOpen = false;
  const amountControls = showAmount
    ? `<div class="amount-controls">
        <div class="raise-presets"><button type="button" data-preset="0.333333">1/3</button><button type="button" data-preset="0.5">1/2</button><button type="button" data-preset="1">满池</button>${legal.canAllIn ? '<button type="button" data-preset="allin">All-in</button>' : ""}</div>
        <label class="raise-ctl"><input type="range" id="raise-amt" aria-label="下注额" min="${min}" max="${legal.maxRaiseTo}" value="${min}" /><output id="raise-val">${fmtChips(min)}</output></label>
      </div>`
    : "";
  const amount = amountControls && !mobile
    ? `<div class="amount-panel">${amountControls}<button type="button" data-act="${act}" class="${act} amount-submit"><strong data-submit-amount>${fmtChips(min)}</strong><span data-submit-label>${act === "raise" ? "加注" : "下注"}</span></button></div>`
    : amountControls;
  const actions = [];
  if (mobileAmountOpen) actions.push(`<button type="button" data-close-amount class="ghost">取消</button>`);
  else {
    if (legal.canFold) actions.push(`<button type="button" data-act="fold" class="fold">弃牌</button>`);
    if (legal.canCheck) actions.push(`<button type="button" data-act="check" class="check">过牌</button>`);
    if (legal.canCall) actions.push(`<button type="button" data-act="call" class="call">跟注 ${fmtChips(legal.callAmount)}</button>`);
  }
  if (mobile && legal.canBet) actions.push(`<button type="button" data-act="bet" class="bet">${mobileAmountOpen ? "确认下注 " + fmtChips(min) : "下注"}</button>`);
  else if (mobile && legal.canRaise) actions.push(`<button type="button" data-act="raise" class="raise">${mobileAmountOpen ? "确认加注至 " + fmtChips(min) : "加注"}</button>`);
  else if (!act && legal.canAllIn) actions.push(`<button type="button" data-act="allin" class="allin">All-in</button>`);
  box.innerHTML = `${amount}<div class="action-row">${actions.join("")}</div>`;
  bindRaiseSlider();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function cmd(payload) {
  if (payload.type === "action" || payload.type === "runout") {
    if (state.actionLock) return;
    state.actionLock = true;
    setTimeout(() => {
      state.actionLock = false;
    }, 800);
  }
  const body = { ...payload, playerId: state.playerId, tableNumber: state.tableNumber, nickname: state.nickname };
  try {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(body));
      return;
    }
    const data = await api("/api/cmd", body);
    applySnapshot(data.snapshot);
  } catch (err) {
    if (err?.code === "not_your_turn") return;
    toast(err.message || "请求失败");
  }
}

async function connectWs() {
  if (!state.tableNumber) return;
  if (state.wsConnecting) return;
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
  state.wsConnecting = true;
  try {
    const origin = await getApiOrigin();
    if (!state.tableNumber) return;
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    const u = new URL(origin);
    const proto = u.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${u.host}/ws?table=${encodeURIComponent(state.tableNumber)}&playerId=${encodeURIComponent(state.playerId)}`,
    );
    state.ws = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "state") applySnapshot(msg.snapshot);
      if (msg.type === "error") {
        if (msg.code === "not_your_turn" || msg.message === "还没轮到你") return;
        toast(msg.message || msg.code);
      }
    };
    ws.onclose = () => {
      if (!state.tableNumber) return;
      setTimeout(() => void connectWs(), 1200);
    };
  } finally {
    state.wsConnecting = false;
  }
}

function showLobby() {
  $("table-screen").classList.add("hidden");
  $("settle-screen").classList.add("hidden");
  $("gate").classList.remove("hidden");
  if (state.nickname) $("nickname").value = state.nickname;
}

async function leaveTable() {
  const sitting = Boolean(state.snapshot?.me?.sitting);
  const finished = state.snapshot?.status === "finished";
  const tableNumber = state.tableNumber;
  if (sitting && !finished && tableNumber) {
    try {
      await api("/api/cmd", {
        type: "stand",
        playerId: state.playerId,
        tableNumber,
        nickname: state.nickname,
      });
    } catch {
      /* still leave the UI */
    }
  }
  state.tableNumber = "";
  state.password = "";
  state.snapshot = null;
  state.lastEvents = "";
  if (state.ws) {
    const ws = state.ws;
    state.ws = null;
    ws.onclose = null;
    ws.close();
  }
  clearTableSession();
  showLobby();
}

function showSettle(snap) {
  $("gate").classList.add("hidden");
  $("table-screen").classList.add("hidden");
  $("settle-screen").classList.remove("hidden");
  const rows = (snap.settlement?.players ?? [])
    .slice()
    .sort((a, b) => b.net - a.net)
    .map(
      (p) => `<tr><td>${escapeHtml(p.nickname)}</td><td>${fmtChips(p.buyinChips)}</td><td>${fmtChips(p.stack)}</td><td class="${p.net >= 0 ? "pos" : "neg"}">${p.net >= 0 ? "+" : ""}${fmtChips(p.net)}</td></tr>`,
    )
    .join("");
  $("settle-table").innerHTML = `<table class="settle-table"><thead><tr><th>玩家</th><th>买入</th><th>筹码</th><th>净胜负</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function inviteUrl() {
  const u = new URL(location.href);
  u.search = "";
  u.searchParams.set("t", state.tableNumber);
  u.searchParams.set("p", state.password);
  return u.toString();
}

async function copy(text, ok) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast(text);
  }
}

function needNick() {
  state.nickname = $("nickname").value.trim();
  if (!state.nickname) {
    toast("请先取一个昵称");
    return false;
  }
  localStorage.setItem("ep.nick", state.nickname);
  return true;
}

$("random-name").onclick = async () => {
  try {
    const data = await api("/api/names");
    $("nickname").value = data.nickname;
  } catch {
    $("nickname").value = `玩家${Math.floor(10 + Math.random() * 89)}`;
  }
};

document.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b === btn));
    $("create-form").classList.toggle("hidden", btn.dataset.tab !== "create");
    $("join-form").classList.toggle("hidden", btn.dataset.tab !== "join");
  };
});

$("unlimited").onchange = () => {
  $("max-buyin-field").classList.toggle("hidden", $("unlimited").checked);
};

$("create-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!needNick()) return;
  const data = await api("/api/tables", {
    playerId: state.playerId,
    nickname: state.nickname,
    durationMinutes: Number($("duration").value),
    shortDeck: $("short-deck").checked,
    unlimitedBuyin: $("unlimited").checked,
    maxBuyins: Number($("max-buyins").value || 10),
    straddleAllowed: $("straddle").checked,
    squidEnabled: $("squid").checked,
    bounty27Enabled: $("bounty").checked,
  });
  applySnapshot(data.snapshot);
  connectWs();
};

$("join-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!needNick()) return;
  await join($("join-number").value.trim().toUpperCase(), $("join-password").value.trim());
};

async function join(tableNumber, password) {
  const data = await api("/api/join", {
    type: "join",
    tableNumber,
    password,
    playerId: state.playerId,
    nickname: state.nickname,
  });
  applySnapshot(data.snapshot);
  connectWs();
}

$("btn-copy-link").onclick = () => copy(inviteUrl(), "邀请链接已复制");
$("btn-copy-link-2").onclick = () => copy(inviteUrl(), "邀请链接已复制");
$("btn-leave").onclick = () => void leaveTable();
$("btn-leave-2").onclick = () => void leaveTable();

function openBuyin(okLabel) {
  const snap = state.snapshot;
  const max = snap?.config.unlimitedBuyin ? 99 : Math.max(1, (snap?.config.maxBuyins ?? 10) - (snap?.me?.buyinCount ?? 0));
  $("buyin-n").value = "1";
  $("buyin-n").max = String(max);
  const when = snap?.me?.sitting ? "将在下一手开始时到账" : "坐下后立即到账";
  $("buyin-hint").textContent = `每次 ${100 * (snap?.config.bigBlind ?? 2)} 筹码；还可买入 ${snap?.config.unlimitedBuyin ? "无限" : max} 次。${when}`;
  $("buyin-ok").textContent = okLabel || "坐下";
  $("modal").classList.remove("hidden");
}

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
  const n = Number($("buyin-n").value || 1);
  if (state.snapshot?.me?.sitting) void cmd({ type: "rebuy", buyinCount: n });
  else void cmd({ type: "sit", buyinCount: n });
};
$("btn-stand").onclick = () => void cmd({ type: "stand" });

$("btn-rebuy-top").onclick = () => openBuyin("补码");
$("emote-picker").innerHTML = EMOJI.map((emoji) => `<button type="button" aria-label="发送 ${emoji}" data-emoji="${emoji}">${emoji}</button>`).join("");
$("seats").onclick = (e) => {
  const avatar = e.target.closest(".seat.me .avatar");
  if (!avatar) return;
  const picker = $("emote-picker");
  const rect = avatar.getBoundingClientRect();
  picker.style.left = `${Math.max(8, Math.min(window.innerWidth - 216, rect.left + rect.width / 2 - 104))}px`;
  picker.style.top = `${Math.max(8, rect.top - 170)}px`;
  picker.classList.toggle("hidden");
};
$("seats").onkeydown = (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".seat.me .avatar")) {
    e.preventDefault(); e.target.click();
  }
};
$("emote-picker").onclick = (e) => {
  const button = e.target.closest("button[data-emoji]");
  if (!button) return;
  $("emote-picker").classList.add("hidden");
  void cmd({ type: "emote", emoji: button.dataset.emoji });
};
$("actions").onclick = (e) => {
  const closeAmount = e.target.closest("button[data-close-amount]");
  if (closeAmount) {
    state.raiseOpen = false;
    renderActions(state.snapshot);
    return;
  }
  const preset = e.target.closest("button[data-preset]");
  if (preset) {
    const slider = $("raise-amt");
    const legal = state.snapshot?.legal;
    if (!slider || !legal) return;
    if (preset.dataset.preset === "allin") slider.value = slider.max;
    else {
      const currentBet = Math.max(0, ...state.snapshot.seats.map((s) => s?.bet ?? 0));
      const target = currentBet + (state.snapshot.pot + legal.toCall) * Number(preset.dataset.preset);
      slider.value = String(Math.min(Number(slider.max), Math.max(Number(slider.min), Math.round(target))));
    }
    slider.dispatchEvent(new Event("input"));
    preset.classList.add("selected");
    return;
  }
  const runout = e.target.closest("button[data-runout]");
  if (runout) {
    void cmd({ type: "runout", choice: runout.dataset.runout });
    return;
  }
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "show") {
    void cmd({ type: "show" });
    return;
  }
  const amount = Number($("raise-amt")?.value);
  if (isPortraitTable() && (act === "bet" || act === "raise") && !state.raiseOpen) {
    state.raiseOpen = true;
    renderActions(state.snapshot);
    return;
  }
  state.raiseOpen = false;
  void cmd({ type: "action", action: act, amount: Number.isFinite(amount) ? amount : undefined });
};

setInterval(() => {
  if (!state.snapshot || state.snapshot.status === "finished") return;
  if (state.snapshot.remainingMs != null) {
    state.snapshot.remainingMs = Math.max(0, state.snapshot.remainingMs - 250);
    paintRemain(state.snapshot.remainingMs);
  }
  updateCountdown(state.snapshot);
  const wsOpen = state.ws && state.ws.readyState === WebSocket.OPEN;
  const left = actionMsLeft(state.snapshot);
  if (state.tableNumber && (!wsOpen || left === 0)) void cmd({ type: "snapshot" });
}, 250);

$("nickname").value = state.nickname;

window.addEventListener("resize", () => {
  if (state.snapshot && !$("table-screen").classList.contains("hidden")) renderTable(state.snapshot);
});

const params = new URLSearchParams(location.search);
let storedTable = null;
try {
  storedTable = JSON.parse(localStorage.getItem("ep.table") || "null");
} catch {
  storedTable = null;
}
const restoreT = params.get("t") || storedTable?.tableNumber || "";
const restoreP = params.get("p") || storedTable?.password || "";
if (restoreT) $("join-number").value = restoreT;
if (restoreP) $("join-password").value = restoreP;
if (restoreT && restoreP && state.nickname) {
  void join(restoreT, restoreP).catch((err) => {
    clearTableSession();
    toast(err.message || "无法回到游戏桌");
  });
} else if (restoreT && restoreP) {
  document.querySelector('.tab[data-tab="join"]').click();
}
