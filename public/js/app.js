const $ = (id) => document.getElementById(id);
const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
const STREET = { preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌" };

const SEATS = 8;
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
};

localStorage.setItem("ep.id", state.playerId);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

function play(name) {
  const el = $(`sfx-${name}`);
  if (!el) return;
  try {
    el.currentTime = 0;
    void el.play();
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

function isPortraitTable() {
  return window.matchMedia("(orientation: portrait), (max-width: 820px)").matches;
}

function seatPos(i) {
  const theta = Math.PI / 2 + i * ((2 * Math.PI) / SEATS);
  if (isPortraitTable()) return { x: 50 + 34 * Math.cos(theta), y: 50 + 40 * Math.sin(theta) };
  return { x: 50 + 42 * Math.cos(theta), y: 50 + 28 * Math.sin(theta) };
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
  if (host.endsWith(".workers.dev") && host.startsWith("easy-poker.")) {
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
  playEvents(snap.events);
}

function playEvents(events = []) {
  const key = JSON.stringify(events);
  if (key === state.lastEvents) return;
  state.lastEvents = key;
  if (!events.length) return;
  for (const e of events) {
    if (e.type === "fold" || e.type === "timeout") play("fold");
    else if (e.type === "check" || e.type === "call") play("check");
    else if (e.type === "raise" || e.type === "bet" || e.type === "allin") play("raise");
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
    seats: snap.seats.map((s) =>
      s
        ? [s.playerId, s.chips, s.bet, s.folded, s.acting, s.holeCards, s.isButton, s.isSb, s.isBb, s.sitting]
        : null,
    ),
  });
}

function renderTable(snap) {
  $("table-id").textContent = `${snap.tableNumber} · ${snap.password}`;
  $("table-clock").textContent = snap.remainingMs != null ? `剩余 ${fmtMs(snap.remainingMs)}` : "等待开局";
  const sitting = Boolean(snap.me?.sitting);
  $("btn-sit").classList.toggle("hidden", sitting);
  $("btn-stand").classList.toggle("hidden", !sitting);
  updateCountdown(snap);
  const key = visualKey(snap);
  if (key === state.visualKey) return;
  state.visualKey = key;

  renderSeats(snap);
  $("felt").classList.toggle("is-showdown", Boolean(snap.lastResult && !snap.street));
  $("street-label").textContent = snap.lastResult && !snap.street ? "摊牌" : STREET[snap.street] || (snap.status === "waiting" ? "等待玩家" : "");
  $("pot").innerHTML = snap.pot ? chipStackHTML(snap.pot) : `<span class="chip-amt">底池 0</span>`;
  const bannerBits = [];
  if (snap.lastResult?.winners?.length && !snap.street) {
    bannerBits.push(
      snap.lastResult.winners
        .filter((w) => w.amount > 0)
        .map((w) => `${nameOf(snap, w.id)} 赢得 ${fmtChips(w.amount)}${w.handName ? " · " + w.handName : ""}`)
        .join("　"),
    );
    if (snap.me?.sitting && snap.me.chips === 0) bannerBits.push("筹码为 0，请补码后继续");
  }
  $("banner").textContent = bannerBits.join(" · ");
  const info = [];
  if (snap.me) info.push(`${escapeHtml(snap.me.nickname)} · ${fmtChips(snap.me.chips)} · buy-in ${snap.me.buyinCount}`);
  if (snap.config.straddleAllowed) info.push("Straddle");
  if (snap.config.squidEnabled) info.push("鱿鱼");
  if (snap.config.bounty27Enabled) info.push("27杂色");
  info.push(snap.config.unlimitedBuyin ? "无限买入" : `最多${snap.config.maxBuyins}次买入`);
  $("meta").innerHTML = info.map((t) => `<span class="chip">${t}</span>`).join(" ");
  renderActions(snap);
  queueDeals(snap);
  renderShowdown(snap);
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
    const s = snap.seats[seat];
    const key = s
      ? `${s.playerId}|${s.chips}|${s.bet}|${s.folded}|${s.acting}|${(s.holeCards || []).join("")}|${s.isButton}`
      : "empty";
    if (el.dataset.key === key) continue;
    el.dataset.key = key;
    el.className =
      "seat" + (s?.acting ? " acting" : "") + (s?.folded ? " folded" : "") + (s?.playerId === snap.me?.id ? " me" : "");
    if (!s) {
      el.innerHTML = `<div class="avatar">空</div><div class="name">空位</div>`;
      continue;
    }
    const tags = [s.isButton ? "D" : "", s.isSb ? "SB" : "", s.isBb ? "BB" : "", s.isStraddle ? "STR" : "", s.hasSquid ? "🦑" : ""]
      .filter(Boolean)
      .join(" ");
    const holes =
      s.holeCards && s.playerId !== snap.me?.id ? s.holeCards.map((c) => cardHTML(c, "tiny")).join("") : "";
    el.innerHTML = `
        <div class="avatar">${s.acting ? '<i class="timer-ring"></i>' : ""}${escapeHtml(s.nickname.slice(0, 1))}${s.isButton ? '<i class="dealer">D</i>' : ""}</div>
        <div class="name">${escapeHtml(s.nickname)}</div>
        <div class="stack">${fmtChips(s.chips)}</div>
        <div class="bet">${s.bet ? chipStackHTML(s.bet) : ""}</div>
        <div class="tags">${tags}</div>
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
  }, 160);
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
  if (state.showdownHand === hn) return;
  state.showdownHand = hn;
  const lr = snap.lastResult;
  $("sd-board").innerHTML = lr.board.map((c) => cardHTML(c)).join("");
  const winIds = new Set(lr.winners.filter((w) => w.amount > 0).map((w) => w.id));
  $("sd-players").innerHTML = Object.entries(lr.shown)
    .map(([id, cards]) => {
      const win = winIds.has(id);
      const nm = nameOf(snap, id);
      const hn2 = lr.winners.find((w) => w.id === id)?.handName || "";
      return `<div class="sd-row ${win ? "winner" : ""}"><div class="name">${escapeHtml(nm)}${hn2 ? " · " + hn2 : ""}</div><div class="sd-holes">${cards.map((c) => cardHTML(c, "tiny")).join("")}</div></div>`;
    })
    .join("");
  $("sd-win").textContent = lr.winners
    .filter((w) => w.amount > 0)
    .map((w) => `${nameOf(snap, w.id)} 赢得 ${fmtChips(w.amount)}${w.handName ? " · " + w.handName : ""}`)
    .join("　");
  box.classList.remove("hidden");
  play("settle");
}

function actionMsLeft(snap) {
  if (!snap?.actingPlayerId || snap.actionDeadline == null || snap.now == null) return null;
  const elapsed = Date.now() - (state.recvAt || Date.now());
  return Math.max(0, snap.actionDeadline - snap.now - elapsed);
}

function updateCountdown(snap) {
  const el = $("countdown");
  if (!el) return;
  const left = actionMsLeft(snap);
  if (left != null) {
    el.textContent = `行动倒计时 ${Math.ceil(left / 1000)}s`;
  } else if (snap.nextHandAt && !snap.street) {
    el.textContent = `下一手 ${Math.max(0, Math.ceil((snap.nextHandAt - Date.now()) / 1000))}s`;
  } else {
    el.textContent = "";
  }
}

function nameOf(snap, id) {
  const s = snap.seats.find((x) => x?.playerId === id);
  return s?.nickname ?? id.slice(0, 4);
}

function renderActions(snap) {
  const box = $("actions");
  const legal = snap.legal;
  if (!legal) {
    const extras = [];
    if (snap.me?.holeCards && snap.lastResult && !snap.street && !snap.lastResult.shown?.[snap.me.id]) {
      extras.push(`<button type="button" data-act="show" class="ghost">亮牌</button>`);
    }
    if (snap.me?.sitting && snap.me.chips === 0) {
      extras.push(`<button type="button" id="btn-rebuy" class="primary sm">补码</button>`);
    }
    const waitText = snap.lastResult && !snap.street ? "摊牌结算中" : snap.me?.sitting ? "等待行动" : "观战中，坐下后可参与下一手";
    box.innerHTML = extras.join("") || `<span class="muted">${waitText}</span>`;
    return;
  }
  const parts = [];
  if (legal.canFold) parts.push(`<button type="button" data-act="fold" class="fold">弃牌</button>`);
  if (legal.canCheck) parts.push(`<button type="button" data-act="check" class="check">过牌</button>`);
  if (legal.canCall) parts.push(`<button type="button" data-act="call" class="call">跟注 ${fmtChips(legal.callAmount)}</button>`);
  if (legal.canBet) {
    parts.push(`<input type="range" id="raise-amt" min="${legal.minBet}" max="${legal.maxRaiseTo}" value="${legal.minBet}" />`);
    parts.push(`<button type="button" data-act="bet" class="bet">下注</button>`);
  }
  if (legal.canRaise) {
    parts.push(`<input type="range" id="raise-amt" min="${legal.minRaiseTo}" max="${legal.maxRaiseTo}" value="${legal.minRaiseTo}" />`);
    parts.push(`<button type="button" data-act="raise" class="raise">加注</button>`);
  }
  if (legal.canAllIn) parts.push(`<button type="button" data-act="allin" class="allin">全下</button>`);
  box.innerHTML = parts.join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function cmd(payload) {
  const body = { ...payload, playerId: state.playerId, tableNumber: state.tableNumber, nickname: state.nickname };
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(body));
    return;
  }
  const data = await api("/api/cmd", body);
  applySnapshot(data.snapshot);
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
      if (msg.type === "error") toast(msg.message || msg.code);
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
$("btn-copy-code").onclick = () => copy(`游戏桌 ${state.tableNumber} 密码 ${state.password}`, "号码和密码已复制");
$("btn-copy-link-2").onclick = () => copy(inviteUrl(), "邀请链接已复制");
$("btn-leave").onclick = () => void leaveTable();
$("btn-leave-2").onclick = () => void leaveTable();

function openBuyin(okLabel) {
  const snap = state.snapshot;
  const max = snap?.config.unlimitedBuyin ? 99 : Math.max(1, (snap?.config.maxBuyins ?? 10) - (snap?.me?.buyinCount ?? 0));
  $("buyin-n").value = "1";
  $("buyin-n").max = String(max);
  $("buyin-hint").textContent = `每次 ${100 * (snap?.config.bigBlind ?? 2)} 筹码；还可买入 ${snap?.config.unlimitedBuyin ? "无限" : max} 次`;
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

$("actions").onclick = (e) => {
  if (e.target.closest("#btn-rebuy")) {
    openBuyin("补码");
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
  void cmd({ type: "action", action: act, amount: Number.isFinite(amount) ? amount : undefined });
};

setInterval(() => {
  if (!state.snapshot || state.snapshot.status === "finished") return;
  if (state.snapshot.remainingMs != null) {
    state.snapshot.remainingMs = Math.max(0, state.snapshot.remainingMs - 250);
    $("table-clock").textContent = `剩余 ${fmtMs(state.snapshot.remainingMs)}`;
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
