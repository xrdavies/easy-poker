import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const url = (p: string) => new URL(p, import.meta.url);
const read = (p: string) => readFileSync(url(p), "utf8");

describe("client UI source (shipped public assets)", () => {
  it("has desktop landscape and mobile portrait layouts", () => {
    const css = read("../public/css/app.css");
    assert.match(css, /orientation:\s*portrait/);
    assert.match(css, /orientation:\s*landscape/);
    assert.match(css, /max-width:\s*820px/);
    assert.match(css, /\.felt/);
    assert.match(css, /aspect-ratio:\s*2\.2\s*\/\s*1/);
    assert.match(css, /aspect-ratio:\s*1\s*\/\s*1\.75/);
    assert.match(css, /border-radius:\s*999px/);
    assert.match(css, /\.seat/);
    assert.match(css, /\.pchip/);
    assert.match(css, /@keyframes dealIn/);
    assert.match(css, /@keyframes pulse/);
    assert.match(css, /@keyframes sdIn/);
    assert.match(css, /\.deal-anim/);
  });

  it("has invite copy, action controls, and is not Node-only", () => {
    const js = read("../public/js/app.js");
    const html = read("../public/index.html");
    assert.match(html, /复制邀请链接/);
    assert.match(html, /复制号码\+密码/);
    assert.match(js, /clipboard\.writeText/);
    assert.match(js, /inviteUrl/);
    assert.match(js, /data-act="fold"/);
    assert.match(js, /data-act="raise"/);
    assert.doesNotMatch(js, /\brequire\s*\(/);
    assert.doesNotMatch(js, /\bmodule\.exports\b/);
    assert.match(js, /new WebSocket/);
    assert.match(js, /document\.getElementById/);
    assert.match(js, /chipStackHTML/);
    assert.match(html, /Easy Poker/);
    assert.match(html, /退出游戏桌/);
    assert.match(js, /leaveTable/);
    assert.match(js, /ep\.table/);
    assert.match(js, /ep\.nick/);
    assert.match(js, /isPortraitTable/);
    assert.match(js, /queueDeals/);
    assert.match(js, /renderShowdown/);
    assert.match(js, /visualKey/);
    assert.match(html, /本手结算/);
    assert.match(js, /SEATS = 8/);
  });

  it("Worker config hosts both UI assets and the game server", () => {
    const toml = read("../wrangler.toml");
    assert.match(toml, /\[assets\]/);
    assert.match(toml, /directory = "\.\/public"/);
    assert.match(toml, /class_name = "TableDO"/);
    const index = read("../src/index.ts");
    assert.match(index, /env\.ASSETS\.fetch/);
    assert.match(index, /\/ws/);
    assert.match(index, /\/api\/tables/);
    const docs = [read("../README.md"), read("../docs/architecture.md"), read("../docs/deploy.md")].join("\n");
    assert.match(docs, /wrangler/i);
    assert.match(docs, /Durable Object/);
  });

  it("ships distinct 音效 for check / raise / fold / 发牌 / 结算", () => {
    const html = read("../public/index.html");
    for (const name of ["fold", "check", "raise", "deal", "settle"]) {
      assert.match(html, new RegExp(`/sounds/${name}\\.wav`));
      assert.equal(existsSync(fileURLToPath(url(`../public/sounds/${name}.wav`))), true);
    }
    const js = read("../public/js/app.js");
    assert.match(js, /play\("fold"\)/);
    assert.match(js, /play\("check"\)/);
    assert.match(js, /play\("raise"\)/);
    assert.match(js, /play\("deal"\)/);
    assert.match(js, /play\("settle"\)/);
  });
});
