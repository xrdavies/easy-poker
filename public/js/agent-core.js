export const PROMPTS = {
  beginner: "你是新手德州扑克陪练，倾向过牌/跟注，强牌才加注。偶尔可以犯保守错误。",
  experienced: "你是经验丰富的德州扑克玩家。考虑位置、公共牌、赔率和对手下注，价值下注，适度诈唬。",
  pro: "你是职业德州扑克玩家。综合范围、位置、底池赔率、有效筹码、阻断牌和下注尺度，平衡价值与诈唬。",
  tom_dwan: "模拟 Tom Dwan 的松凶施压牌风：深筹码和后位扩大入池与再加注范围，善用位置、范围优势、阻断牌、半诈唬、check-raise 和多街施压；在合理时采用极化尺度，但多人底池、浅筹码或缺少诈唬依据时降低激进程度，不要为了模仿而无脑诈唬。",
  tan_xuan: "模拟谭轩的高波动进攻牌风：敢于用较宽范围争夺底池，偏好主动加注、大尺度下注和极化策略，强听牌与关键阻断牌保持进攻性，也愿意扩大 bluff-catch；高波动不等于随机行动，没有合理依据时仍应控制风险。",
  phil_ivey: "模拟 Phil Ivey 冷静、全面且高度适应的牌风：以严谨范围和读牌为基础，根据位置、筹码深度和本街行动灵活切换节奏；选择恰当时机施压、薄价值、bluff-catch 或纪律性弃牌，不固定松紧，也不为了模仿而强行做花哨行动。",
  alan_keating: "模拟 Alan Keating 的超松凶高压牌风：显著扩大入池、跟注与再加注范围，主动制造大底池，敢于使用大尺度诈唬、半诈唬和较宽的 bluff-catch；保持高方差和娱乐性，但仍需有赔率、阻断牌或行动线路依据，不能随机送出筹码。",
  aaron_zang: "模拟臧书奴（Aaron Zang）冷静、重视数学与长期优势的牌风：耐心评估赔率、位置和有效筹码，减少边缘负期望行动；优势明确时果断施压并争取最大价值，信息不足或风险回报不佳时控制底池，保持沉着而不做情绪化决定。",
};

export const PROMPT_LABELS = {
  beginner: "新手",
  experienced: "有经验",
  pro: "职业",
  tom_dwan: "Tom Dwan",
  tan_xuan: "谭轩",
  phil_ivey: "Phil Ivey",
  alan_keating: "Alan Keating",
  aaron_zang: "臧书奴（Aaron Zang）",
};

function playerPositions(seats) {
  const players = seats.map((player, seat) => player?.inHand ? { ...player, seat } : null).filter(Boolean);
  const positions = new Map(players.map((player) => [player.playerId,
    player.isButton && player.isSb ? "BTN/SB" : player.isButton ? "BTN" : player.isSb ? "SB" : player.isBb ? "BB" : "",
  ]));
  const bb = players.find((player) => player.isBb);
  const button = players.find((player) => player.isButton);
  if (!bb || !button) return positions;
  const middle = [];
  for (let offset = 1; offset <= seats.length; offset++) {
    const seat = (bb.seat + offset) % seats.length;
    if (seat === button.seat) break;
    const player = players.find((item) => item.seat === seat);
    if (player && !positions.get(player.playerId)) middle.push(player);
  }
  const labels = {
    1: ["UTG"],
    2: ["UTG", "CO"],
    3: ["UTG", "HJ", "CO"],
    4: ["UTG", "LJ", "HJ", "CO"],
    5: ["UTG", "UTG+1", "LJ", "HJ", "CO"],
  }[middle.length] ?? [];
  middle.forEach((player, index) => positions.set(player.playerId, `${labels[index] ?? `Seat ${player.seat}`}${player.isStraddle ? "/STR" : ""}`));
  return positions;
}

export function agentContext(snapshot) {
  const bigBlind = Math.max(1, Number(snapshot.config.bigBlind));
  const inBB = (chips) => Math.round(chips / bigBlind * 100) / 100;
  const positions = playerPositions(snapshot.seats);
  const players = snapshot.seats.map((player, seat) => player?.inHand ? {
    playerId: player.playerId,
    nickname: player.nickname,
    seat,
    position: positions.get(player.playerId),
    stack: player.chips,
    stackBB: inBB(player.chips),
    bet: player.bet,
    betBB: inBB(player.bet),
    folded: player.folded,
    allIn: player.allIn,
    me: player.playerId === snapshot.me.id,
  } : null).filter(Boolean);
  const hero = players.find((player) => player.me);
  const activeOpponents = players.filter((player) => !player.me && !player.folded);
  return {
    street: snapshot.street,
    blinds: { small: snapshot.config.smallBlind, big: bigBlind },
    shortDeck: snapshot.config.shortDeck,
    holeCards: snapshot.me.holeCards,
    board: snapshot.board,
    pot: snapshot.pot,
    potBB: inBB(snapshot.pot),
    hero,
    effectiveStacksBB: activeOpponents.map((player) => ({ playerId: player.playerId, value: inBB(Math.min(hero?.stack ?? 0, player.stack)) })),
    dealtPlayerCount: players.length,
    activePlayerCount: players.filter((player) => !player.folded).length,
    players,
    streetActions: (snapshot.streetActions ?? []).map((action) => ({ ...action, amountBB: action.amount === undefined ? undefined : inBB(action.amount) })),
    legal: snapshot.legal,
  };
}

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
  const input = JSON.stringify(agentContext(snapshot));
  const instruction = `${PROMPTS[level] ?? PROMPTS.experienced}只依据提供的牌局事实决策，不假设对手风格或不可见信息。只输出 JSON，例如 {"action":"call"} 或 {"action":"raise","amount":10}。amount 是本轮总下注额，必须遵循 legal。`;
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
