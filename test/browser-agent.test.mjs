import assert from "node:assert/strict";
import { test } from "node:test";
import { apiUrl, gameWsUrl, legalMove, modelTransport } from "../public/js/agent-core.js";

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
