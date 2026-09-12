import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SFX_IDS, SFX_POOL } from "../client/src/sfx.ts";
import {
  SEATS,
  actionMsLeft,
  fmtChips,
  isPortraitTable,
} from "../client/src/session.ts";

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

  it("ships an engine-drawn table, not an HTML overlay renderer", () => {
    const main = read("../client/src/main.ts");
    const scene = read("../client/src/scene.ts");
    const session = read("../client/src/session.ts");
    const sfx = read("../client/src/sfx.ts");
    const html = read("../client/index.html");
    const builtHtml = read("../public/index.html");
    const gameJs = read("../public/js/game.js");

    assert.match(main, /from "@xrdavies\/2d-engine"/);
    assert.match(main, /Engine\.create/);
    assert.match(main, /Renderer2D/);
    assert.match(main, /PokerScene/);
    assert.match(scene, /Shape2D|Painter/);
    assert.match(scene, /hitTest/);
    assert.match(scene, /tweenValue/);
    assert.match(scene, /easeOutBack/);
    assert.match(sfx, /AudioManager/);
    assert.match(session, /this\.play\("shuffle"\)/);
    assert.match(read("../client/src/net.ts"), /WebSocketTransport/);
    assert.match(read("../client/src/net.ts"), /HttpClient/);
    assert.equal(SEATS, 8);
    assert.match(session, /SEATS = 8/);
    assert.match(scene, /act:fold/);
    assert.match(scene, /act:check/);
    assert.match(scene, /act:call/);
    assert.match(scene, /act:bet/);
    assert.match(scene, /act:raise/);
    assert.match(scene, /act:allin/);
    assert.match(scene, /本手结算/);
    assert.match(session, /inviteUrl/);
    assert.match(session, /clipboard\.writeText/);
    assert.doesNotMatch(scene, /\brequire\s*\(/);
    assert.doesNotMatch(main, /\bmodule\.exports\b/);
    assert.equal(existsSync(fileURLToPath(url("../client/src/overlay.ts"))), false);

    assert.match(html, /id="game-canvas"/);
    assert.match(html, /id="ime-root"/);
    assert.doesNotMatch(html, /id="gate"/);
    assert.doesNotMatch(html, /class="gate-card"/);
    assert.doesNotMatch(html, /id="table-screen"/);
    assert.doesNotMatch(html, /class="dock"/);
    assert.doesNotMatch(html, /\/js\/app\.js/);
    assert.match(builtHtml, /Easy Poker/);
    assert.match(builtHtml, /js\/game\.js/);
    assert.doesNotMatch(builtHtml, /id="seats"/);
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

  it("keeps native IME inputs on UIBridge, not HTML seats or actions", () => {
    const main = read("../client/src/main.ts");
    const html = read("../client/index.html");
    const css = read("../public/css/engine.css");
    assert.match(main, /export function attachTableUiBridge/);
    assert.match(main, /new UIBridge\(\s*canvas/);
    assert.match(html, /id="ime-nick"/);
    assert.match(html, /id="ime-table"/);
    assert.match(html, /id="ime-pass"/);
    assert.match(css, /#game-canvas/);
    assert.doesNotMatch(html, /id="actions"/);
    assert.doesNotMatch(html, /id="felt"/);
  });

  it("computes portrait layout and action timeout from shipped session helpers", () => {
    assert.equal(isPortraitTable(390, 844), true);
    assert.equal(isPortraitTable(1280, 720), false);
    assert.equal(fmtChips(1200), "1,200");
    const snap = {
      actingPlayerId: "a",
      actionDeadline: 10_000,
      now: 10_000,
    };
    assert.equal(actionMsLeft(snap, Date.now()), 0);
    assert.equal(actionMsLeft({ ...snap, actionDeadline: Date.now() + 50_000, now: Date.now() - 100 }, Date.now())! > 0, true);
  });

  it("keeps player-facing chrome: invite, 8 seats, showdown, SFX", () => {
    const scene = read("../client/src/scene.ts");
    const session = read("../client/src/session.ts");
    assert.match(scene, /复制邀请链接/);
    assert.match(scene, /本手结算/);
    assert.match(scene, /btn:leave/);
    assert.match(session, /PORTRAIT_SEATS/);
    assert.match(session, /LANDSCAPE_SEATS/);
    assert.match(session, /renderShowdown/);
    assert.match(session, /actionMsLeft/);
    assert.match(session, /left === 0/);
    assert.match(session, /ep\.table/);
    assert.match(session, /ep\.nick/);
    assert.match(session, /play\("shuffle"\)/);
    assert.match(session, /play\("deal"\)/);
    assert.match(session, /play\("tick"\)/);
    assert.match(session, /play\("win"\)/);
    assert.match(session, /play\("lose"\)/);
    assert.match(session, /actingPlayerId === snap\.me\?\.id/);
    assert.doesNotMatch(read("../client/index.html"), /复制号码\+密码/);
  });
});
