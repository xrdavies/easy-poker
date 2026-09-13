import assert from "node:assert/strict";
import { test } from "node:test";
import { modelProxy, modelProxyUrl } from "../src/index.ts";

test("model proxy accepts any HTTPS host but only model response endpoints", () => {
  assert.equal(modelProxyUrl("https://models.example/v1/responses").hostname, "models.example");
  assert.equal(modelProxyUrl("https://another.example/openai/v1/chat/completions").hostname, "another.example");
  assert.throws(() => modelProxyUrl("http://models.example/v1/responses"), /只支持 HTTPS/);
  assert.throws(() => modelProxyUrl("https://models.example/v1/models"), /只支持 HTTPS/);
});

test("model proxy uses Worker-compatible redirect handling", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302 });
  }) as typeof fetch;
  try {
    const response = await modelProxy(new Request("https://poker.example/api/model-proxy", {
      method: "POST",
      headers: { authorization: "Bearer test", "content-type": "application/json" },
      body: JSON.stringify({ url: "https://models.example/v1/responses", body: { model: "test" } }),
    }));
    assert.equal(response.status, 400);
    assert.match(await response.text(), /不允许重定向/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
