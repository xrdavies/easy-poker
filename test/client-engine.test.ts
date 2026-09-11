import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SFX_IDS, SFX_POOL } from "../client/src/sfx.ts";
// shipped entry is public/js/game.js after vite build

const url = (p: string) => new URL(p, import.meta.url);
const read = (p: string) => readFileSync(url(p), "utf8");
describe("2d-engine backed client", () => {
  it("exports the runtime SFX ids from the shipped SFX module", () => {
    assert.deepEqual(SFX_POOL.bet, ["bet-1", "bet-2", "bet-3"]);
    assert.deepEqual(SFX_POOL.shuffle, ["shuffle-1", "shuffle-2", "shuffle-3", "shuffle-4", "shuffle-5"]);
    for (const id of ["fold", "check", "allin", "deal", "tick", "win", "lose", "bet-1", "shuffle-1"]) {
      assert.ok(SFX_IDS.includes(id as (typeof SFX_IDS)[number]));
    }
  });

  it("ships an engine-backed entry, not the standalone public/js/app.js renderer", () => {
    const main = read("../client/src/main.ts");
    const overlay = read("../client/src/overlay.ts");
    const sfx = read("../client/src/sfx.ts");
    const html = read("../client/index.html");
    const builtHtml = read("../public/index.html");
    const gameJs = read("../public/js/game.js");

    assert.match(main, /from "@xrdavies\/2d-engine"/);
    assert.match(main, /Engine\.create/);
    assert.match(main, /UIBridge/);
    assert.match(main, /Renderer2D/);
    assert.match(main, /new PokerSfx/);
    assert.match(sfx, /AudioManager/);
    assert.match(sfx, /audio\.load/);
    assert.match(overlay, /PokerNet/);
    assert.match(read("../client/src/net.ts"), /WebSocketTransport/);
    assert.match(read("../client/src/net.ts"), /HttpClient/);
    assert.match(overlay, /SEATS = 8/);
    assert.match(overlay, /data-act="fold"/);
    assert.match(overlay, /data-act="check"/);
    assert.match(overlay, /data-act="call"/);
    assert.match(overlay, /data-act="bet"/);
    assert.match(overlay, /data-act="raise"/);
    assert.match(overlay, /data-act="allin"/);
    assert.match(overlay, /本手结算/);
    assert.match(overlay, /inviteUrl/);
    assert.match(overlay, /clipboard\.writeText/);
    assert.doesNotMatch(overlay, /\brequire\s*\(/);
    assert.doesNotMatch(overlay, /\bmodule\.exports\b/);
    assert.doesNotMatch(main, /\brequire\s*\(/);
    assert.doesNotMatch(main, /\bmodule\.exports\b/);

    assert.match(html, /id="game-canvas"/);
    assert.match(html, /src="\/src\/main\.ts"/);
    assert.doesNotMatch(html, /\/js\/app\.js/);
    assert.match(builtHtml, /Easy Poker/);
    assert.match(builtHtml, /js\/game\.js/);
    assert.doesNotMatch(builtHtml, /\/js\/app\.js/);
    assert.match(gameJs, /WebGPU|__easyPokerEngine|decodeAudioData/);
    assert.equal(existsSync(fileURLToPath(url("../public/js/app.js"))), false);

    for (const id of ["bet-1", "bet-2", "bet-3", "shuffle-1", "shuffle-2", "shuffle-3", "shuffle-4", "shuffle-5"]) {
      assert.match(sfx, new RegExp(`"${id}"`));
      assert.equal(existsSync(fileURLToPath(url(`../public/sounds/${id}.m4a`))), true);
    }
    for (const id of ["fold", "check", "allin", "deal", "tick", "win", "lose"]) {
      assert.match(sfx, new RegExp(`"${id}"`));
      assert.equal(existsSync(fileURLToPath(url(`../public/sounds/${id}.m4a`))), true);
    }
  });

  it("keeps player-facing chrome: invite, 8 seats, showdown overlay", () => {
    const overlay = read("../client/src/overlay.ts");
    const html = read("../client/index.html");
    assert.match(html, /复制邀请链接/);
    assert.match(html, /本手结算/);
    assert.match(html, /id="btn-leave"/);
    assert.match(overlay, /PORTRAIT_SEATS/);
    assert.match(overlay, /LANDSCAPE_SEATS/);
    assert.match(overlay, /renderShowdown/);
    assert.match(overlay, /actionMsLeft/);
    assert.match(overlay, /left === 0/);
    assert.match(overlay, /ep\.table/);
    assert.match(overlay, /ep\.nick/);
    assert.match(overlay, /play\("shuffle"\)/);
    assert.match(overlay, /play\("deal"\)/);
    assert.match(overlay, /play\("tick"\)/);
    assert.match(overlay, /play\("win"\)/);
    assert.match(overlay, /play\("lose"\)/);
    assert.match(overlay, /actingPlayerId === snap\.me\?\.id/);
    assert.doesNotMatch(html, /复制号码\+密码/);
  });
});


