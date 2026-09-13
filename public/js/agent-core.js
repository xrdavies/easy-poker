export const PROMPTS = {
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

export function gameWsUrl(base, tableNumber, playerId) {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = new URLSearchParams({ table: tableNumber, playerId }).toString();
  return url.toString();
}

export function modelTransport(url, body, config) {
  if (!config.useProxy) return { url, body };
  return { url: `${config.proxyOrigin.replace(/\/$/, "")}/api/model-proxy`, body: { url, body } };
}

async function request(url, body, config, signal) {
  const transport = modelTransport(url, body, config);
  const res = await fetch(transport.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(transport.body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw Object.assign(new Error(`模型 API 返回非 JSON（HTTP ${res.status}）`), { status: res.status }); }
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

export async function decide(snapshot, level, config, signal) {
  const { apiKey, baseUrl, model } = config;
  if (!apiKey || !baseUrl || !model) throw new Error("需要 API Key、Base URL 和 Model");
  const input = JSON.stringify({
    holeCards: snapshot.me.holeCards,
    board: snapshot.board,
    pot: snapshot.pot,
    street: snapshot.street,
    seats: snapshot.seats.map((s) => s && ({ nickname: s.nickname, chips: s.chips, bet: s.bet, folded: s.folded, me: s.playerId === snapshot.me.id })),
    legal: snapshot.legal,
    shortDeck: snapshot.config.shortDeck,
  });
  const instruction = `${PROMPTS[level]}只依据可见信息决策。只输出 JSON，例如 {"action":"call"} 或 {"action":"raise","amount":10}。amount 是本轮总下注额，必须遵循 legal。`;
  let result;
  try {
    const data = await request(apiUrl(baseUrl, "responses"), { model, instructions: instruction, input: [{ role: "user", content: input }] }, config, signal);
    result = data.output_text ?? data.output?.flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("");
  } catch (err) {
    if (![400, 404, 405, 501].includes(err.status)) throw err;
    const data = await request(apiUrl(baseUrl, "chat/completions"), { model, messages: [{ role: "system", content: instruction }, { role: "user", content: input }] }, config, signal);
    result = data.choices?.[0]?.message?.content;
  }
  return legalMove(result, snapshot.legal);
}
