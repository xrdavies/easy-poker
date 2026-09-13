import assert from "node:assert/strict";
import { test } from "node:test";
import { apiUrl, gameWsUrl, legalMove } from "../public/js/agent-core.js";

test("browser AI clamps model output to the legal action", () => {
  const legal = { canFold: true, canCheck: false, canCall: true, canBet: false, canRaise: true, canAllIn: true, minRaiseTo: 8, maxRaiseTo: 100 };
  assert.deepEqual(legalMove('{"action":"check"}', legal), { action: "call" });
  assert.deepEqual(legalMove('{"action":"raise","amount":999}', legal), { action: "raise", amount: 100 });
});

test("browser AI builds model and game WebSocket URLs", () => {
  assert.equal(apiUrl("https://api.example.com/v1", "responses"), "https://api.example.com/v1/responses");
  assert.equal(gameWsUrl("https://poker.example", "ABC123", "bot-1"), "wss://poker.example/ws?table=ABC123&playerId=bot-1");
});
