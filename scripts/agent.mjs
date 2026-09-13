import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const PROMPTS = {
  beginner: "你是新手德州扑克陪练，倾向过牌/跟注，强牌才加注。偶尔可以犯保守错误。",
  experienced: "你是经验丰富的德州扑克玩家。考虑位置、公共牌、赔率和对手下注，价值下注，适度诈唬。",
  pro: "你是职业德州扑克玩家。综合范围、位置、底池赔率、有效筹码、阻断牌和下注尺度，平衡价值与诈唬。",
};

export function legalMove(reply, legal) {
  const move = typeof reply === "string" ? JSON.parse(reply.match(/\{[^{}]*\}/)?.[0] ?? "{}") : reply;
  const type = move?.action;
  const allowed = { fold: legal.canFold, check: legal.canCheck, call: legal.canCall, bet: legal.canBet, raise: legal.canRaise, allin: legal.canAllIn };
  if (!allowed[type]) return { action: legal.canCheck ? "check" : legal.canCall ? "call" : "fold" };
  if (type !== "bet" && type !== "raise") return { action: type };
  const min = type === "bet" ? legal.minBet : legal.minRaiseTo;
  const amount = Math.round(Number(move.amount));
  return { action: type, amount: Number.isFinite(amount) ? Math.min(legal.maxRaiseTo, Math.max(min, amount)) : min };
}

export function apiUrl(base, endpoint) {
  const root = base.replace(/\/(v1\/)?(responses|chat\/completions)\/?$/, "").replace(/\/$/, "");
  return `${root.endsWith("/v1") ? root : `${root}/v1`}/${endpoint}`;
}

export function wsUrl(base, tableNumber, playerId) {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = new URLSearchParams({ table: tableNumber, playerId }).toString();
  return url.toString();
}

async function request(url, body, key, timeout = 8000) {
  const res = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw Object.assign(new Error(`模型 API 返回非 JSON（HTTP ${res.status}）`), { status: res.status }); }
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

export async function decide(snapshot, level) {
  const { API_KEY, BASE_URL, MODEL } = process.env;
  if (!API_KEY || !BASE_URL || !MODEL) throw new Error("需要 API_KEY、BASE_URL、MODEL 环境变量");
  const input = JSON.stringify({ holeCards: snapshot.me.holeCards, board: snapshot.board, pot: snapshot.pot,
    street: snapshot.street, seats: snapshot.seats.map((s) => s && ({ nickname: s.nickname, chips: s.chips, bet: s.bet, folded: s.folded, me: s.playerId === snapshot.me.id })), legal: snapshot.legal,
    shortDeck: snapshot.config.shortDeck });
  const instruction = `${PROMPTS[level]}只依据可见信息决策。只输出 JSON，例如 {"action":"call"} 或 {"action":"raise","amount":10}。amount 是本轮总下注额，必须遵循 legal。`;
  let result;
  try {
    const data = await request(apiUrl(BASE_URL, "responses"), { model: MODEL, instructions: instruction, input: [{ role: "user", content: input }] }, API_KEY);
    result = data.output_text ?? data.output?.flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("");
  } catch (err) {
    if (![400, 404, 405, 501].includes(err.status)) throw err;
    const data = await request(apiUrl(BASE_URL, "chat/completions"), { model: MODEL, messages: [{ role: "system", content: instruction }, { role: "user", content: input }] }, API_KEY);
    result = data.choices?.[0]?.message?.content;
  }
  return legalMove(result, snapshot.legal);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || (!args.includes("--create") && !args.includes("--invite") && args.length < 2)) {
    console.log("用法: source .env; node scripts/agent.mjs 桌号 密码 [--level beginner|experienced|pro] [--name 昵称] [--api URL]");
    console.log("房主: node scripts/agent.mjs --create [--web URL]；邀请加入: node scripts/agent.mjs --invite 'http://web/?t=桌号&p=密码'");
    return;
  }
  const flag = (name, fallback) => args[args.indexOf(name) + 1] && args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const level = flag("--level", "experienced");
  if (!PROMPTS[level]) throw new Error("level 必须是 beginner、experienced 或 pro");
  const base = flag("--api", process.env.GAME_API_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("需要 GAME_API_URL 或 --api URL");
  const playerId = randomUUID();
  const nickname = flag("--name", `AI-${level}`);
  const api = async (path, body) => {
    const url = new URL(path, `${base}/`);
    const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, tableNumber, playerId, nickname }) } : { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `游戏 API ${res.status}`);
    return data.snapshot;
  };
  let tableNumber = args[0], password = args[1], snap;
  if (args.includes("--invite")) {
    const invite = new URL(flag("--invite", ""));
    tableNumber = invite.searchParams.get("t") ?? "";
    password = invite.searchParams.get("p") ?? "";
    if (!tableNumber || !password) throw new Error("邀请链接缺少 t/p 参数");
  }
  if (args.includes("--create")) {
    const res = await fetch(new URL("api/tables", `${base}/`), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, nickname, durationMinutes: Number(flag("--duration", "30")), shortDeck: args.includes("--short-deck") }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? `创建游戏桌失败（HTTP ${res.status}）`);
    snap = data.snapshot;
    tableNumber = snap.tableNumber;
    password = snap.password;
    const web = flag("--web", process.env.GAME_WEB_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
    console.log(`房主邀请链接: ${web}${data.invite?.path ?? `/?t=${tableNumber}&p=${password}`}`);
  } else {
    if (!tableNumber || !password) throw new Error("需要桌号+密码，或 --invite 邀请链接");
    snap = await api("api/cmd", { type: "join", password });
  }
  if (!snap.me.sitting) snap = await api("api/cmd", { type: "sit", buyinCount: snap.me.chips ? 0 : 1 });
  console.log(`${nickname} 已坐下：${tableNumber}，${level}`);
  let lastTurn = "";
  let busy = false;
  let finished = false;
  let wsReady = false;
  let polling = false;

  async function handleSnapshot(next) {
    snap = next;
    if (snap.status === "finished") {
      finished = true;
      return;
    }
    if (snap.runoutVote && snap.me?.holeCards && !snap.runoutVote.choices?.[playerId]) {
      snap = await api("api/cmd", { type: "runout", choice: "once" });
    }
    if (snap.me.sitting && !snap.me.chips && !snap.me.pendingChips) {
      snap = await api("api/cmd", { type: "rebuy", buyinCount: 1 });
    }
    const turn = `${snap.handNumber}:${snap.street}:${snap.actionDeadline}`;
    if (!snap.legal || snap.actingPlayerId !== playerId || turn === lastTurn || busy) return;
    lastTurn = turn;
    busy = true;
    try {
      let move;
      try { move = await decide(snap, level); }
      catch (err) { console.error(`模型调用失败，使用安全行动：${err.message}`); move = legalMove({}, snap.legal); }
      console.log(`第 ${snap.handNumber} 手 ${snap.street}: ${move.action}${move.amount ? ` ${move.amount}` : ""}`);
      snap = await api("api/cmd", { type: "action", ...move });
    } catch (err) {
      lastTurn = "";
      console.error(`行动失败：${err.message}`);
    } finally {
      busy = false;
    }
  }

  async function pollUntilWs() {
    if (polling) return;
    polling = true;
    try {
      while (!finished && !wsReady) {
        try { await handleSnapshot(await api(`api/table/${encodeURIComponent(tableNumber)}?playerId=${encodeURIComponent(playerId)}`)); }
        catch (err) { console.error(`状态请求失败：${err.message}`); }
        if (!wsReady) await new Promise((resolve) => setTimeout(resolve, 700));
      }
    } finally {
      polling = false;
    }
  }

  if (typeof WebSocket === "function") {
    try {
      const ws = new WebSocket(wsUrl(base, tableNumber, playerId));
      ws.onopen = () => { wsReady = true; console.log("游戏 WebSocket 已连接"); void handleSnapshot(snap); };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "state" && message.snapshot) void handleSnapshot(message.snapshot);
          if (message.type === "error" && message.message) console.error(`WebSocket：${message.message}`);
        } catch (err) { console.error(`WebSocket 消息无效：${err.message}`); }
      };
      ws.onerror = () => { wsReady = false; };
      ws.onclose = () => { wsReady = false; console.log("游戏 WebSocket 已断开，回退轮询"); void pollUntilWs(); };
    } catch {
      void pollUntilWs();
    }
  } else {
    void pollUntilWs();
  }
  while (!finished) await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log("游戏桌已结束");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err.message); process.exitCode = 1; });
