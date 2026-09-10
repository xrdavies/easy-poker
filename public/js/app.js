const $ = (id) => document.getElementById(id);
const SUIT = { c: "♣", d: "♦", h: "♥", s: "♠" };
const STREET = { preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌" };

const state = {
  playerId: localStorage.getItem("ep.id") || crypto.randomUUID(),
  nickname: localStorage.getItem("ep.nick") || "",
  tableNumber: "",
  password: "",
  snapshot: null,
  ws: null,
  lastEvents: "",
  lastBoard: 0,
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

function seatPos(i) {
  const theta = Math.PI / 2 + i * ((2 * Math.PI) / 10);
  return { x: 50 + 42 * Math.cos(theta), y: 50 + 36 * Math.sin(theta) };
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || "请求失败"), data);
  return data;
}

function applySnapshot(snap) {
  if (!snap) return;
  state.snapshot = snap;
  state.tableNumber = snap.tableNumber;
  state.password = snap.password;
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
  for (const e of events) {
    if (e.type === "fold" || e.type === "timeout") play("fold");
    else if (e.type === "check" || e.type === "call") play("check");
    else if (e.type === "raise" || e.type === "bet" || e.type === "allin") play("raise");
    else if (e.type === "deal" || e.type === "street") play("deal");
    else if (e.type === "settle" || e.type === "win") play("settle");
  }
}

function renderTable(snap) {
  $("table-id").textContent = `${snap.tableNumber} · ${snap.password}`;
  $("table-clock").textContent = snap.remainingMs != null ? `剩余 ${fmtMs(snap.remainingMs)}` : "等待开局";
  const meSeat = snap.me?.seat ?? 0;
  const sitting = Boolean(snap.me?.sitting);
  $("btn-sit").classList.toggle("hidden", sitting);
  $("btn-stand").classList.toggle("hidden", !sitting);

  const seatsEl = $("seats");
  seatsEl.innerHTML = "";
  for (let seat = 0; seat < 10; seat++) {
    const vis = sitting ? (seat - meSeat + 10) % 10 : seat;
    const pos = seatPos(vis);
    const s = snap.seats[seat];
    const div = document.createElement("div");
    div.className = "seat" + (s?.acting ? " acting" : "") + (s?.folded ? " folded" : "") + (s?.playerId === snap.me?.id ? " me" : "");
    div.style.left = `${pos.x}%`;
    div.style.top = `${pos.y}%`;
    if (!s) {
      div.innerHTML = `<div class="avatar">空</div><div class="name">空位</div>`;
    } else {
      const tags = [
        s.isButton ? "D" : "",
        s.isSb ? "SB" : "",
        s.isBb ? "BB" : "",
        s.isStraddle ? "STR" : "",
        s.hasSquid ? "🦑" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const holes = s.holeCards?.map((c) => cardHTML(c, "tiny")).join("") ?? "";
      div.innerHTML = `
        <div class="avatar">${s.acting ? '<i class="timer-ring"></i>' : ""}${s.nickname.slice(0, 1)}${s.isButton ? '<i class="dealer">D</i>' : ""}</div>
        <div class="name">${escapeHtml(s.nickname)}</div>
        <div class="stack">${fmtChips(s.chips)}</div>
        <div class="bet">${s.bet ? `下注 ${fmtChips(s.bet)}` : ""}</div>
        <div class="tags">${tags}</div>
        <div class="seat-cards">${holes}</div>`;
    }
    seatsEl.appendChild(div);
  }

  $("street-label").textContent = STREET[snap.street] || (snap.status === "waiting" ? "等待玩家" : "");
  $("pot").textContent = `底池 ${fmtChips(snap.pot || 0)}`;
  const board = $("board");
  board.innerHTML = snap.board.map((c) => cardHTML(c)).join("");
  if (snap.board.length !== state.lastBoard) {
    state.lastBoard = snap.board.length;
  }
  const bannerBits = [];
  if (snap.actingPlayerId && snap.actionDeadline) {
    const left = Math.max(0, snap.actionDeadline - snap.now);
    bannerBits.push(`行动倒计时 ${Math.ceil(left / 1000)}s`);
  }
  if (snap.lastResult?.winners?.length && !snap.street) {
    bannerBits.push(snap.lastResult.winners.map((w) => `${nameOf(snap, w.id)} +${w.amount}${w.handName ? " · " + w.handName : ""}`).join("　"));
  }
  $("banner").textContent = bannerBits.join(" · ");

  const hole = $("hole");
  hole.innerHTML = (snap.me?.holeCards ?? []).map((c) => cardHTML(c)).join("");
  const info = [];
  if (snap.me) info.push(`${escapeHtml(snap.me.nickname)} · ${fmtChips(snap.me.chips)} · buy-in ${snap.me.buyinCount}`);
  if (snap.config.straddleAllowed) info.push("Straddle");
  if (snap.config.squidEnabled) info.push("鱿鱼");
  if (snap.config.bounty27Enabled) info.push("27杂色");
  info.push(snap.config.unlimitedBuyin ? "无限买入" : `最多${snap.config.maxBuyins}次买入`);
  $("meta").innerHTML = info.map((t) => `<span class="chip">${t}</span>`).join(" ");
  renderActions(snap);
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
    if (snap.me?.holeCards && snap.lastResult && !snap.street) {
      extras.push(`<button type="button" data-act="show" class="ghost">亮牌</button>`);
    }
    box.innerHTML = extras.join("") || `<span class="muted">${snap.me?.sitting ? "等待行动" : "观战中，坐下后可参与下一手"}</span>`;
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

function connectWs() {
  if (!state.tableNumber) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?table=${encodeURIComponent(state.tableNumber)}&playerId=${encodeURIComponent(state.playerId)}`);
  state.ws = ws;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state") applySnapshot(msg.snapshot);
    if (msg.type === "error") toast(msg.message || msg.code);
  };
  ws.onclose = () => {
    setTimeout(connectWs, 1200);
  };
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

$("btn-sit").onclick = () => {
  const snap = state.snapshot;
  if (snap?.me?.chips > 0) {
    void cmd({ type: "sit", buyinCount: 0 });
    return;
  }
  const max = snap?.config.unlimitedBuyin ? 99 : Math.max(1, (snap?.config.maxBuyins ?? 10) - (snap?.me?.buyinCount ?? 0));
  $("buyin-n").value = "1";
  $("buyin-n").max = String(max);
  $("buyin-hint").textContent = `每次 ${100 * (snap?.config.bigBlind ?? 2)} 筹码；还可买入 ${snap?.config.unlimitedBuyin ? "无限" : max} 次`;
  $("modal").classList.remove("hidden");
};
$("buyin-cancel").onclick = () => $("modal").classList.add("hidden");
$("buyin-ok").onclick = () => {
  $("modal").classList.add("hidden");
  void cmd({ type: "sit", buyinCount: Number($("buyin-n").value || 1) });
};
$("btn-stand").onclick = () => void cmd({ type: "stand" });

$("actions").onclick = (e) => {
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
  if (state.snapshot.actingPlayerId && state.snapshot.actionDeadline) {
    const left = Math.max(0, state.snapshot.actionDeadline - Date.now());
    const bits = [`行动倒计时 ${Math.ceil(left / 1000)}s`];
    if (state.snapshot.lastResult?.winners?.length && !state.snapshot.street) {
      /* keep */
    }
    $("banner").textContent = bits[0];
  }
}, 250);

$("nickname").value = state.nickname;

const params = new URLSearchParams(location.search);
if (params.get("t")) $("join-number").value = params.get("t");
if (params.get("p")) $("join-password").value = params.get("p");
if (params.get("t") && params.get("p")) {
  document.querySelector('.tab[data-tab="join"]').click();
  if (state.nickname) {
    void join(params.get("t"), params.get("p")).catch((err) => toast(err.message || "加入失败"));
  }
}

if (!state.nickname) {
  api("/api/names")
    .then((d) => {
      if (!$("nickname").value) $("nickname").value = d.nickname;
    })
    .catch(() => {});
}
