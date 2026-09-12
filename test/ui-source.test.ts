import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const url = (p: string) => new URL(p, import.meta.url);
const read = (p: string) => readFileSync(url(p), "utf8");

describe("client UI source (shipped public assets)", () => {
  it("has desktop landscape and mobile portrait layouts in the engine scene", () => {
    const session = read("../client/src/session.ts");
    const scene = read("../client/src/scene.ts");
    const assets = read("../client/src/assets.ts");
    assert.match(session, /PORTRAIT_SEATS/);
    assert.match(session, /LANDSCAPE_SEATS/);
    assert.match(session, /isPortraitTable/);
    assert.match(scene, /isPortraitTable\(width, height\)/);
    assert.match(assets, /aspect|1\.65|2\.2/);
    assert.match(assets, /roundStadium|stadiumRect/);
    assert.match(assets, /AssetManager/);
    assert.doesNotMatch(assets, /createElement\(["']canvas/);
    for (const art of ["background", "cards", "chips", "circle", "corners", "felt-landscape", "felt-portrait"]) {
      assert.equal(existsSync(fileURLToPath(url(`../public/assets/${art}.png`))), true);
    }
    const artScript = read("../scripts/generate-art.mjs");
    assert.doesNotMatch(artScript, /court/);
    assert.doesNotMatch(artScript, /#5082be/);
    assert.match(scene, /shownHoles/);
    assert.match(scene, /drawShowdown/);
    assert.equal(existsSync(fileURLToPath(url("../client/src/overlay.ts"))), false);
  });

  it("has invite copy, action controls, and is not Node-only", () => {
    const session = read("../client/src/session.ts");
    const scene = read("../client/src/scene.ts");
    const net = read("../client/src/net.ts");
    const html = read("../client/index.html");
    assert.match(scene, /复制邀请链接/);
    assert.doesNotMatch(html, /复制号码\+密码/);
    assert.match(scene, /btn:leave/);
    assert.match(session, /clipboard\.writeText/);
    assert.match(session, /inviteUrl/);
    assert.match(scene, /act:fold/);
    assert.match(scene, /act:raise/);
    assert.doesNotMatch(session, /\brequire\s*\(/);
    assert.doesNotMatch(session, /\bmodule\.exports\b/);
    assert.match(net, /WebSocketTransport/);
    assert.match(net, /resolveOrigin|getApiOrigin/);
    assert.match(net, /config\.json/);
    assert.match(html, /Easy Poker/);
    assert.match(scene, /退出游戏桌|btn:leave/);
    assert.match(session, /leaveTable/);
    assert.match(session, /ep\.table/);
    assert.match(session, /ep\.nick/);
    assert.match(session, /isPortraitTable/);
    assert.match(session, /queueDeals/);
    assert.match(session, /SEATS = 8/);
    assert.match(session, /actionMsLeft/);
    assert.match(session, /left === 0/);
    assert.match(html, /id="game-canvas"/);
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
    const sfx = read("../client/src/sfx.ts");
    for (const name of ["fold", "check", "bet-1", "bet-2", "bet-3", "allin", "deal", "shuffle-1", "tick", "win", "lose"]) {
      assert.match(sfx, new RegExp(`"${name}"`));
      assert.equal(existsSync(fileURLToPath(url(`../public/sounds/${name}.m4a`))), true);
    }
    const js = read("../client/src/session.ts");
    assert.match(js, /e\.type === "fold"/);
    assert.match(js, /once\("fold"\)/);
    assert.match(js, /once\("check"\)/);
    assert.match(js, /e\.type === "call"/);
    assert.match(sfx, /bet-1/);
    assert.match(js, /once\("allin"\)/);
    assert.match(js, /play\("deal"\)/);
    assert.match(js, /play\("shuffle"\)/);
    assert.match(js, /play\("tick"\)/);
    assert.match(js, /actingPlayerId === snap\.me\?\.id/);
    assert.match(js, /play\("win"\)/);
    assert.match(js, /play\("lose"\)/);
    assert.match(sfx, /SFX_POOL/);
    assert.match(read("../client/src/scene.ts"), /raiseTo/);
    assert.match(read("../client/src/scene.ts"), /runout:/);
    assert.match(js, /actionLock/);
  });
});
