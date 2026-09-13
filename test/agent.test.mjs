import assert from "node:assert/strict";
import { test } from "node:test";
import { apiUrl, legalMove, wsUrl } from "../scripts/agent.mjs";

test("AI output cannot send an illegal action or out-of-range raise", () => {
  const legal = { canFold: true, canCheck: false, canCall: true, canBet: false, canRaise: true, canAllIn: true, minRaiseTo: 8, maxRaiseTo: 100 };
  assert.deepEqual(legalMove('{"action":"check"}', legal), { action: "call" });
  assert.deepEqual(legalMove('{"action":"raise","amount":999}', legal), { action: "raise", amount: 100 });
  assert.deepEqual(legalMove('{"action":"raise","amount":1}', legal), { action: "raise", amount: 8 });
});

test("model base URL accepts host, /v1, or endpoint forms", () => {
  assert.equal(apiUrl("https://api.example.com", "responses"), "https://api.example.com/v1/responses");
  assert.equal(apiUrl("https://api.example.com/v1", "chat/completions"), "https://api.example.com/v1/chat/completions");
  assert.equal(apiUrl("https://api.example.com/v1/responses", "responses"), "https://api.example.com/v1/responses");
});

test("game WebSocket URL uses ws(s) and carries table identity", () => {
  assert.equal(wsUrl("http://127.0.0.1:8790", "ABC123", "player-1"), "ws://127.0.0.1:8790/ws?table=ABC123&playerId=player-1");
  assert.equal(wsUrl("https://poker.example", "ABC123", "player-1"), "wss://poker.example/ws?table=ABC123&playerId=player-1");
});
