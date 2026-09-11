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
    assert.match(css, /is-showdown \.center-stack/);
    assert.match(css, /\.sd-holes/);
    assert.match(css, /\.showdown\s*\{[^}]*position:\s*fixed/s);
    assert.match(css, /\.showdown\s*\{[^}]*place-items:\s*center/s);
    assert.match(css, /\.seat-cd/);
    const js = read("../public/js/app.js");
    assert.match(js, /seat-cd/);
    assert.doesNotMatch(js, /行动倒计时/);
    assert.match(css, /orientation:\s*portrait[\s\S]*\.showdown\s*\{[\s\S]*position:\s*fixed/);
    const html = read("../public/index.html");
    assert.match(html, /<footer class="dock">[\s\S]*id="showdown"/);
    assert.doesNotMatch(html, /id="felt"[\s\S]*id="showdown"[\s\S]*class="dock"/);
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
    assert.match(js, /getApiOrigin/);
    assert.match(js, /config\.json/);
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
    assert.match(js, /actionMsLeft/);
    assert.match(js, /left === 0/);
  });

  it("splits UI and API across two Workers", () => {
    const apiToml = read("../wrangler.toml");
    const webToml = read("../wrangler.web.toml");
    assert.match(apiToml, /name = "easy-poker-api"/);
    assert.match(apiToml, /class_name = "TableDO"/);
    assert.doesNotMatch(apiToml, /\[assets\]/);
    assert.match(webToml, /name = "easy-poker"/);
    assert.match(webToml, /\[assets\]/);
    assert.match(webToml, /directory = "\.\/public"/);
    const index = read("../src/index.ts");
    assert.doesNotMatch(index, /env\.ASSETS/);
    assert.match(index, /Access-Control-Allow-Origin/);
    assert.match(index, /\/ws/);
    assert.match(index, /\/api\/tables/);
    const web = read("../src/web.ts");
    assert.match(web, /ASSETS\.fetch/);
    assert.match(web, /config\.json/);
    assert.match(web, /wrong_worker/);
    const docs = [read("../README.md"), read("../docs/architecture.md"), read("../docs/deploy.md")].join("\n");
    assert.match(docs, /wrangler/i);
    assert.match(docs, /Durable Object/);
    assert.match(docs, /easy-poker-api/);
    assert.match(docs, /两个 Worker/);
  });

  it("ships distinct 音效 for check / raise / fold / 发牌 / 结算", () => {
    const html = read("../public/index.html");
    for (const name of ["fold", "check", "bet", "bet-2", "bet-3", "allin", "deal", "shuffle", "tick", "win", "lose"]) {
      assert.match(html, new RegExp(`/sounds/${name}\\.m4a`));
      assert.equal(existsSync(fileURLToPath(url(`../public/sounds/${name}.m4a`))), true);
    }
    const js = read("../public/js/app.js");
    assert.match(js, /once\("fold"\)/);
    assert.match(js, /once\("check"\)/);
    assert.match(js, /once\("bet"\)/);
    assert.match(js, /once\("raise"\)/);
    assert.match(js, /once\("allin"\)/);
    assert.match(js, /play\("deal"\)/);
    assert.match(js, /play\("shuffle"\)/);
    assert.match(js, /play\("tick"\)/);
    assert.match(js, /actingPlayerId === snap\.me\?\.id/);
    assert.match(js, /play\("win"\)/);
    assert.match(js, /play\("lose"\)/);
    assert.match(js, /SFX_POOL/);
    assert.match(js, /raise-val/);
    assert.match(js, /data-runout/);
    assert.match(js, /actionLock/);
  });
});
