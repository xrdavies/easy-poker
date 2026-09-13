import assert from "node:assert/strict";
import { test } from "node:test";
import { modelProxyUrl } from "../src/index.ts";

test("model proxy accepts any HTTPS host but only model response endpoints", () => {
  assert.equal(modelProxyUrl("https://models.example/v1/responses").hostname, "models.example");
  assert.equal(modelProxyUrl("https://another.example/openai/v1/chat/completions").hostname, "another.example");
  assert.throws(() => modelProxyUrl("http://models.example/v1/responses"), /只支持 HTTPS/);
  assert.throws(() => modelProxyUrl("https://models.example/v1/models"), /只支持 HTTPS/);
});
