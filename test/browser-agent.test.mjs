import assert from "node:assert/strict";
import { test } from "node:test";
import { agentContext, apiUrl, gameWsUrl, legalMove, modelTransport, PROMPTS } from "../public/js/agent-core.js";

test("browser AI clamps model output to the legal action", () => {
  const legal = { canFold: true, canCheck: false, canCall: true, canBet: false, canRaise: true, canAllIn: true, minRaiseTo: 8, maxRaiseTo: 100 };
  assert.deepEqual(legalMove('{"action":"check"}', legal), { action: "call" });
  assert.deepEqual(legalMove('{"action":"raise","amount":999}', legal), { action: "raise", amount: 100 });
});

test("browser AI builds model and game WebSocket URLs", () => {
  assert.equal(apiUrl("https://api.example.com/v1", "responses"), "https://api.example.com/v1/responses");
  assert.equal(gameWsUrl("https://poker.example", "ABC123", "bot-1"), "wss://poker.example/ws?table=ABC123&playerId=bot-1");
});

test("browser AI can route a model request through the game proxy", () => {
  const body = { model: "model-a", input: "hello" };
  assert.deepEqual(modelTransport("https://models.example/v1/responses", body, { useProxy: false }), {
    url: "https://models.example/v1/responses", body,
  });
  assert.deepEqual(modelTransport("https://models.example/v1/responses", body, { useProxy: true, proxyOrigin: "https://poker.example/" }), {
    url: "https://poker.example/api/model-proxy",
    body: { url: "https://models.example/v1/responses", body },
  });
});

test("browser AI receives factual position, stack, player count, and street action context", () => {
  const seat = (playerId, chips, flags = {}) => ({ playerId, nickname: playerId, chips, bet: 0, folded: false, allIn: false, inHand: true, ...flags });
  const seats = [seat("hero", 200, { isButton: true }), seat("sb", 100, { isSb: true }), seat("bb", 400, { isBb: true }), seat("utg", 300), seat("co", 80), null, null, null];
  const context = agentContext({
    config: { smallBlind: 1, bigBlind: 2, shortDeck: false },
    me: { id: "hero", holeCards: ["As", "Kd"] },
    seats,
    street: "preflop",
    board: [],
    pot: 3,
    streetActions: [{ playerId: "sb", type: "call", amount: 2 }],
    legal: { canFold: true, canCall: true },
  });
  assert.equal(context.hero.position, "BTN");
  assert.equal(context.players.find((player) => player.playerId === "utg").position, "UTG");
  assert.equal(context.players.find((player) => player.playerId === "co").position, "CO");
  assert.equal(context.hero.stackBB, 100);
  assert.equal(context.activePlayerCount, 5);
  assert.deepEqual(context.effectiveStacksBB.map((item) => item.value), [50, 100, 100, 40]);
  assert.equal(context.streetActions[0].amountBB, 1);
  assert.ok(PROMPTS.tom_dwan && PROMPTS.tan_xuan);
});
