import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTION_MS,
  CATEGORY,
  compareHand,
  createTable,
  evaluate7,
  freshDeck,
  HAND_PAUSE_MS,
  newPlayerId,
  parseCards,
  PokerError,
  randomNickname,
  rankName,
  Table,
  type ActionInput,
  type Card,
  type CreateTableInput,
} from "../src/engine/index.ts";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    add(ms: number) {
      now += ms;
    },
    set(ms: number) {
      now = ms;
    },
  };
}

function open(over: Partial<CreateTableInput> = {}, random: () => number = () => 0) {
  const clk = clock();
  const table = createTable(
    { durationMinutes: 30, tableNumber: "TABL01", password: "1234", ...over },
    { now: clk.now, random },
  );
  return { table, clk };
}

function joinSit(table: Table, id: string, nick: string, buyins = 1): number {
  table.addPlayer(id, nick, table.password);
  return table.sit(id, buyins);
}

function actor(table: Table): string {
  const id = table.hand?.actingPlayerId;
  assert.ok(id, "expected a player to act");
  return id;
}

function drive(table: Table, pick: (id: string) => ActionInput): void {
  let guard = 0;
  while (table.hand?.actingPlayerId) {
    if (++guard > 200) throw new Error("action loop");
    const id = table.hand.actingPlayerId;
    table.action(id, pick(id));
  }
}

function checkCall(table: Table): void {
  drive(table, (id) => {
    const legal = table.legalActions(id)!;
    if (legal.canCheck) return { type: "check" };
    if (legal.canCall) return { type: "call" };
    return { type: "fold" };
  });
}

function allInEveryone(table: Table): void {
  drive(table, () => ({ type: "allin" }));
}

describe("shipped 长牌 ranking", () => {
  it("orders royal flush > straight flush > quads > boat > flush > straight > trips > two pair > pair > high", () => {
    const royal = evaluate7(parseCards("Ah Kh Qh Jh Th 2c 3d"));
    const sf = evaluate7(parseCards("9h 8h 7h 6h 5h 2c 3d"));
    const quads = evaluate7(parseCards("Ah Ad Ac As 9c 2d 3h"));
    const boat = evaluate7(parseCards("Ah Ad Ac 9s 9c 2d 3h"));
    const flush = evaluate7(parseCards("Ah 9h 7h 4h 2h Kc 3d"));
    const straight = evaluate7(parseCards("9c 8d 7h 6s 5c 2d 3h"));
    const trips = evaluate7(parseCards("Ah Ad Ac 9s 8c 2d 3h"));
    const two = evaluate7(parseCards("Ah Ad 9c 9s 8c 2d 3h"));
    const pair = evaluate7(parseCards("Ah Ad 9c 8s 7c 2d 3h"));
    const high = evaluate7(parseCards("Ah Kd 9c 8s 7c 2d 3h"));
    assert.equal(royal.category, CATEGORY.royalFlush);
    assert.equal(sf.category, CATEGORY.straightFlush);
    assert.ok(compareHand(royal, sf) > 0);
    assert.ok(compareHand(sf, quads) > 0);
    assert.ok(compareHand(quads, boat) > 0);
    assert.ok(compareHand(boat, flush) > 0);
    assert.ok(compareHand(flush, straight) > 0);
    assert.ok(compareHand(straight, trips) > 0);
    assert.ok(compareHand(trips, two) > 0);
    assert.ok(compareHand(two, pair) > 0);
    assert.ok(compareHand(pair, high) > 0);
    assert.equal(rankName(royal), "皇家同花顺");
  });

  it("treats A-2-3-4-5 as the lowest straight", () => {
    const wheel = evaluate7(parseCards("Ah 2c 3d 4s 5h 9c Kd"));
    const sixHigh = evaluate7(parseCards("6h 2c 3d 4s 5h 9c Kd"));
    assert.equal(wheel.category, CATEGORY.straight);
    assert.equal(wheel.ranks[0], 5);
    assert.ok(compareHand(sixHigh, wheel) > 0);
  });

  it("identical five-card hands compare equal (sixth card does not play)", () => {
    const a = evaluate7(parseCards("Ah Kh Qd Jc 9s 2c 3d"));
    const b = evaluate7(parseCards("Ah Kh Qd Jc 9s 8c 7d"));
    assert.equal(compareHand(a, b), 0);
  });
});

describe("table create / invite / seats / 结算", () => {
  it("rejects durations other than the five allowed values and records defaults", () => {
    for (const bad of [0, 15, 45, 90, 180, 360, 24 * 60]) {
      assert.throws(() => createTable({ durationMinutes: bad }), (err: unknown) => {
        assert.ok(err instanceof PokerError);
        assert.equal(err.code, "invalid_duration");
        return true;
      });
    }
    const t = createTable({ durationMinutes: 60, tableNumber: "AAAAAA", password: "9999" });
    assert.equal(t.config.durationMinutes, 60);
    assert.equal(t.config.unlimitedBuyin, false);
    assert.equal(t.config.maxBuyins, 10);
    assert.equal(t.config.straddleAllowed, false);
    assert.equal(t.config.squidEnabled, false);
    assert.equal(t.config.bounty27Enabled, true);
    for (const d of [30, 60, 120, 240, 480]) {
      assert.equal(createTable({ durationMinutes: d }).config.durationMinutes, d);
    }
  });

  it("invite by link and by 号码+密码 join the same table", () => {
    const { table } = open();
    const invite = table.getInvite();
    assert.equal(invite.tableNumber, "TABL01");
    assert.equal(invite.password, "1234");
    assert.ok(invite.path.includes("TABL01"));
    assert.ok(invite.path.includes("1234"));
    table.addPlayer("host", "房主", invite.password);
    const viaLink = table.addPlayer("p2", "链接客", invite.password);
    const viaCode = table.addPlayer("p3", "口令客", table.password);
    assert.equal(viaLink.id, "p2");
    assert.equal(viaCode.id, "p3");
    assert.equal(table.players.size, 3);
    assert.throws(() => table.addPlayer("x", "错", "0000"), (err: unknown) => {
      assert.ok(err instanceof PokerError);
      assert.equal(err.code, "wrong_password");
      return true;
    });
  });

  it("rejects the 9th sitter and does not move occupied seats", () => {
    const { table } = open();
    const seats: number[] = [];
    for (let i = 0; i < 8; i++) seats.push(joinSit(table, `p${i}`, `玩家${i}`));
    assert.deepEqual(seats.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
    const occupied = table.seats.slice();
    assert.throws(() => joinSit(table, "p8", "旁观转坐"), (err: unknown) => {
      assert.ok(err instanceof PokerError);
      assert.equal(err.code, "table_full");
      return true;
    });
    assert.deepEqual(table.seats, occupied);
  });

  it("assigns a random empty seat without moving seated players", () => {
    const { table } = open({}, () => 0);
    const s0 = joinSit(table, "a", "A");
    const s1 = joinSit(table, "b", "B");
    const s2 = joinSit(table, "c", "C");
    assert.deepEqual([s0, s1, s2], [0, 1, 2]);
    const before = { a: s0, b: s1, c: s2 };
    const s3 = joinSit(table, "d", "D");
    assert.equal(s3, 3);
    assert.equal(table.players.get("a")!.seat, before.a);
    assert.equal(table.players.get("b")!.seat, before.b);
    assert.equal(table.players.get("c")!.seat, before.c);

    const { table: t2 } = open({ tableNumber: "TABL02" }, () => 0.999);
    const last = joinSit(t2, "z", "Z");
    assert.equal(last, 7);
  });

  it("after force end, start/deal is rejected and state is 结算", () => {
    const { table } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B", 2);
    table.forceEnd();
    assert.equal(table.status, "finished");
    assert.ok(table.settlement);
    const nets = table.settlement!.players;
    assert.ok(nets.find((p) => p.id === "a"));
    assert.equal(nets.find((p) => p.id === "a")!.buyinChips, 200);
    assert.equal(nets.find((p) => p.id === "a")!.stack, 200);
    assert.equal(nets.find((p) => p.id === "a")!.net, 0);
    assert.equal(nets.find((p) => p.id === "b")!.buyinChips, 400);
    assert.throws(() => table.startHand(), (err: unknown) => {
      assert.ok(err instanceof PokerError);
      assert.equal(err.code, "table_finished");
      return true;
    });
    const snap = table.snapshot("a");
    assert.equal(snap.status, "finished");
    assert.ok(snap.settlement);
    assert.ok(snap.settlement!.players.some((p) => p.id === "a" && p.net === 0));
  });

  it("时长 expiry settles on snapshot without another command", () => {
    const { table, clk } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand({ deck: parseCards("As Kh Ad Kd 2c 3d 4h 5s 6c") });
    table.action("a", { type: "fold" });
    assert.equal(table.status, "playing");
    assert.ok(table.endsAt);
    table.stand("b");
    assert.equal(table.canStartHand(), false);
    assert.equal(table.nextWakeAt(2800), table.endsAt);
    clk.set(table.endsAt!);
    const snap = table.snapshot("a");
    assert.equal(snap.status, "finished");
    assert.ok(snap.settlement);
    assert.equal(snap.settlement!.reason, "duration");
    assert.ok(snap.settlement!.players.some((p) => p.id === "a"));
    assert.throws(() => table.startHand(), (err: unknown) => {
      assert.ok(err instanceof PokerError);
      assert.equal(err.code, "table_finished");
      return true;
    });
  });

  it("last hand past 时长 still wakes on actionDeadline, not a past endsAt", () => {
    const { table, clk } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand({ deck: parseCards("As Kh Ad Kd 2c 3d 4h 5s 6c") });
    table.action("a", { type: "fold" });
    clk.set(table.endsAt! - 100);
    table.startHand({ deck: parseCards("2c 3d 4h 5s 6c 7d 8h 9s Tc") });
    assert.ok(table.hand?.actingPlayerId);
    const deadline = table.hand!.actionDeadline!;
    clk.set(table.endsAt! + 1);
    assert.equal(table.status, "playing");
    assert.ok(table.hand);
    const wake = table.nextWakeAt(2800);
    assert.equal(wake, deadline);
    assert.ok(wake! >= clk.now());
  });
});

describe("identities / 昵称 / buy-in / privacy", () => {
  it("随机名 produces a name and two identities do not collide", () => {
    const n1 = randomNickname(() => 0.1);
    const n2 = randomNickname(() => 0.8);
    assert.ok(n1.length >= 2);
    assert.ok(n2.length >= 2);
    const a = newPlayerId();
    const b = newPlayerId();
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f-]{36}$/i);
  });

  it("sit debit is N×100 BB and is refused past max buy-ins unless 无限", () => {
    const { table } = open();
    joinSit(table, "a", "A", 1);
    assert.equal(table.players.get("a")!.chips, 100 * table.config.bigBlind);
    assert.equal(table.players.get("a")!.buyinCount, 1);
    assert.throws(() => table.rebuy("a", 10), (err: unknown) => {
      assert.ok(err instanceof PokerError);
      assert.equal(err.code, "buyin_limit");
      return true;
    });
    table.rebuy("a", 9);
    assert.equal(table.players.get("a")!.buyinCount, 10);
    assert.throws(() => table.rebuy("a", 1), (err: unknown) => {
      assert.ok(err instanceof PokerError);
      assert.equal(err.code, "buyin_limit");
      return true;
    });

    const { table: inf } = open({ tableNumber: "UNLIM1", unlimitedBuyin: true });
    joinSit(inf, "a", "A", 11);
    assert.equal(inf.players.get("a")!.buyinCount, 11);
    inf.rebuy("a", 5);
    assert.equal(inf.players.get("a")!.buyinCount, 16);
  });

  it("stand then sit restores chips; a second table does not see the first table’s chips", () => {
    const { table } = open();
    joinSit(table, "a", "A", 2);
    joinSit(table, "b", "B", 1);
    const chips = table.players.get("a")!.chips;
    table.stand("a");
    assert.equal(table.players.get("a")!.sitting, false);
    assert.equal(table.players.get("a")!.chips, chips);
    assert.equal(table.players.get("a")!.seat, null);
    const seat = table.sit("a");
    assert.ok(seat !== null);
    assert.equal(table.players.get("a")!.chips, chips);

    const { table: other } = open({ tableNumber: "OTHER1" });
    other.addPlayer("a", "A", other.password);
    assert.equal(other.players.get("a")!.chips, 0);
    joinSit(other, "a", "A", 1);
    assert.equal(other.players.get("a")!.chips, 200);
    assert.equal(table.players.get("a")!.chips, chips);
  });

  it("public snapshot omits others’ hole cards and undealt cards; owner sees 手牌", () => {
    const { table } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    const deck = parseCards("Kc 2h Ac Kd 3h Ad 7c 8d 9s 4c 5d 6h");
    table.startHand({ deck });
    const own = table.snapshot("a");
    const other = table.snapshot("b");
    assert.equal(own.me?.holeCards?.length, 2);
    assert.ok(!("deck" in other));
    assert.equal(other.board.length, 0);
    const aSeat = table.players.get("a")!.seat!;
    const bViewOfA = other.seats[aSeat];
    assert.ok(bViewOfA);
    assert.equal(bViewOfA!.holeCards, undefined);
    const raw = JSON.stringify(other);
    for (const c of own.me!.holeCards!) {
      assert.equal(bViewOfA!.holeCards, undefined);
      const leakedAsField = other.seats.some((s) => s?.playerId === "a" && s.holeCards?.includes(c));
      assert.equal(leakedAsField, false);
      void raw;
    }
    const json = table.toJSON();
    assert.ok(json.hand?.deck);
    assert.ok(!JSON.parse(JSON.stringify(other)).hand);
    assert.ok(!("deck" in JSON.parse(JSON.stringify(other))));
  });
});

describe("hand / street / pots / timeout", () => {
  it("deals a 52-card 长牌 deck with unique cards", () => {
    const { table } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand();
    const json = table.toJSON();
    const holes = [...table.players.values()].flatMap((p) => p.holeCards ?? []);
    const dealt = [...holes, ...(json.hand?.deck ?? [])];
    assert.equal(holes.length, 4);
    assert.equal(dealt.length, 52);
    assert.equal(new Set(dealt).size, 52);
    const full = new Set(freshDeck());
    for (const c of dealt) assert.ok(full.has(c as Card));
  });

  it("heads-up deals from the button/SB, not the BB", () => {
    const { table } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand({ deck: parseCards("As Kh Ad Kd 2c 3d 4h 5s 6c") });
    assert.equal(table.hand!.sbSeat, 0);
    assert.equal(table.hand!.bbSeat, 1);
    assert.deepEqual(table.players.get("a")!.holeCards, parseCards("As Ad"));
    assert.deepEqual(table.players.get("b")!.holeCards, parseCards("Kh Kd"));
  });

  it("heads-up: button posts SB and acts first preflop, last postflop", () => {
    const { table } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand({ deck: parseCards("Kc Ac Kd Ad 2c 3d 4h 5s 6c 7d 8h") });
    assert.equal(table.hand!.buttonSeat, 0);
    assert.equal(table.hand!.sbSeat, 0);
    assert.equal(table.hand!.bbSeat, 1);
    assert.deepEqual(table.players.get("a")!.holeCards, parseCards("Kc Kd"));
    assert.deepEqual(table.players.get("b")!.holeCards, parseCards("Ac Ad"));
    assert.equal(table.hand!.actingPlayerId, "a");
    table.action("a", { type: "call" });
    assert.equal(table.hand!.actingPlayerId, "b");
    table.action("b", { type: "check" });
    assert.equal(table.hand!.street, "flop");
    assert.equal(table.hand!.board.length, 3);
    assert.equal(table.hand!.actingPlayerId, "b");
    table.action("b", { type: "check" });
    assert.equal(table.hand!.actingPlayerId, "a");
  });

  it("3-player button/SB/BB and UTG acts first preflop", () => {
    const { table } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    joinSit(table, "c", "C");
    table.startHand({ deck: parseCards("2c 3d 4h 5s 6c 7d 8h 9s Tc Jd Qh Kc As") });
    assert.equal(table.hand!.buttonSeat, 0);
    assert.equal(table.hand!.sbSeat, 1);
    assert.equal(table.hand!.bbSeat, 2);
    assert.equal(table.hand!.actingPlayerId, "a");
  });

  it("fold wins the pot without showing", () => {
    const { table } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand({ deck: parseCards("Kc Ac Kd Ad 2c 3d 4h 5s 6c") });
    const bBefore = table.players.get("b")!.chips;
    table.action("a", { type: "fold" });
    assert.equal(table.hand, null);
    const bSnap = table.snapshot("b");
    const aSeat = 0;
    assert.equal(bSnap.seats[aSeat]?.holeCards, undefined);
    assert.ok(table.players.get("b")!.chips > bBefore);
    assert.ok(table.lastResult);
    assert.equal(Object.keys(table.lastResult!.shown).length, 0);
  });

  it("showdown: stronger ranking wins; a true tie splits", () => {
    const { table } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand({
      deck: parseCards("Ac 5c Ad 5d 2c 3d 8h 9s Kd"),
    });
    checkCall(table);
    assert.equal(table.hand, null);
    const aw = table.lastResult!.winners.find((w) => w.id === "a");
    const bw = table.lastResult!.winners.find((w) => w.id === "b");
    assert.ok(aw && aw.amount > 0);
    assert.ok(!bw || bw.amount === 0);

    const { table: tie } = open({ tableNumber: "TIE001" });
    joinSit(tie, "a", "A");
    joinSit(tie, "b", "B");
    tie.startHand({
      deck: parseCards("7d 7h 8h 8s 2c 3d 4h 9s Tc"),
    });
    checkCall(tie);
    const wa = tie.lastResult!.winners.find((w) => w.id === "a")?.amount ?? 0;
    const wb = tie.lastResult!.winners.find((w) => w.id === "b")?.amount ?? 0;
    assert.ok(wa > 0 && wb > 0);
    assert.equal(wa + wb, 4);
  });

  it("heads-up both all-in runs the board, shows both hands, then tick starts the next hand", () => {
    const { table, clk } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand({
      deck: parseCards("Ac 5c Ad 5d 2c 3d 8h 9s Kd"),
    });
    allInEveryone(table);
    assert.equal(table.hand, null);
    assert.ok(table.lastResult);
    assert.ok(table.lastResult!.winners.some((w) => w.amount > 0));
    assert.ok(table.lastResult!.shown.a?.length === 2);
    assert.ok(table.lastResult!.shown.b?.length === 2);
    assert.ok(table.lastResult!.board.length === 5);
    assert.ok(table.lastResult!.winners.some((w) => w.handName));
    const snap = table.snapshot("a");
    assert.equal(snap.street, null);
    assert.ok(snap.lastResult?.shown.b);
    assert.equal(table.players.get("b")!.chips, 0);
    assert.equal(table.nextHandAt, null);
    table.rebuy("b", 1);
    assert.ok(table.nextHandAt);
    assert.equal(table.nextHandAt, clk.now() + HAND_PAUSE_MS);
    clk.add(HAND_PAUSE_MS - 1);
    table.tick();
    assert.equal(table.hand, null);
    clk.add(1);
    table.tick();
    assert.ok(table.hand);
    assert.equal(table.hand!.street, "preflop");
  });

  it("all-in short stack wins only the main pot, not the side pot", () => {
    const { table } = open();
    joinSit(table, "a", "A", 1);
    joinSit(table, "b", "B", 2);
    joinSit(table, "c", "C", 2);
    assert.equal(table.players.get("a")!.chips, 200);
    assert.equal(table.players.get("b")!.chips, 400);
    table.startHand({
      deck: parseCards("Kc 2h Ac Kd 3h Ad 7c 8d 9s 4c 5d"),
    });
    allInEveryone(table);
    assert.equal(table.hand, null);
    assert.equal(table.players.get("a")!.chips, 600);
    assert.equal(table.players.get("b")!.chips, 400);
    assert.equal(table.players.get("c")!.chips, 0);
  });

  it("10s timeout with injected clock folds", () => {
    const { table, clk } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    table.startHand({ deck: parseCards("Kc Ac Kd Ad 2c 3d 4h 5s 6c") });
    assert.equal(actor(table), "a");
    const deadline = table.hand!.actionDeadline!;
    assert.equal(deadline, clk.now() + ACTION_MS);
    clk.add(ACTION_MS - 1);
    table.tick();
    assert.equal(table.hand?.actingPlayerId, "a");
    clk.add(1);
    table.tick();
    assert.equal(table.players.get("a")!.sitting, true);
    assert.equal(table.hand, null);
    assert.ok(table.events.some((e) => e.type === "timeout" && e.playerId === "a"));
    assert.ok(table.players.get("b")!.chips > 200 - 2);
  });

  it("timeout folds that player once and passes action to the next player", () => {
    const { table, clk } = open();
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    joinSit(table, "c", "C");
    table.startHand({ deck: parseCards("2c 3d 4h 5s 6c 7d 8h 9s Tc Jd Qh") });
    assert.equal(actor(table), "a");
    clk.add(ACTION_MS);
    table.tick();
    assert.equal(table.players.get("a")!.folded, true);
    assert.ok(table.hand);
    assert.notEqual(table.hand!.actingPlayerId, "a");
    assert.equal(table.hand!.actingPlayerId, "b");
    assert.ok(table.hand!.actionDeadline! > clk.now());
    clk.add(ACTION_MS - 1);
    table.tick();
    assert.equal(table.hand!.actingPlayerId, "b");
    assert.equal(table.players.get("b")!.folded, false);
    table.tick();
    table.tick();
    assert.equal(table.hand!.actingPlayerId, "b");
    assert.equal(table.players.get("a")!.folded, true);
  });
});

describe("straddle / 鱿鱼 / 27杂色", () => {
  it("straddleAllowed posts a live UTG 2×BB straddle on startHand() with no opts.straddle", () => {
    const { table } = open({ straddleAllowed: true });
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    joinSit(table, "c", "C");
    joinSit(table, "d", "D");
    table.startHand({
      deck: parseCards("2c 3d 4h 5s 6c 7d 8h 9s Tc Jd Qh Kc"),
    });
    assert.equal(table.hand!.bbSeat, 2);
    assert.equal(table.hand!.straddleSeat, 3);
    assert.equal(table.players.get("d")!.betThisStreet, 4);
    assert.equal(table.hand!.currentBet, 4);
    assert.equal(table.hand!.actingPlayerId, "a");
  });

  it("main-pot winner receives a squid; last without one is penalized; split/side-pot-only do not award", () => {
    const { table } = open({ squidEnabled: true, bounty27Enabled: false });
    joinSit(table, "a", "A", 1);
    joinSit(table, "b", "B", 2);
    joinSit(table, "c", "C", 2);

    table.startHand({
      deck: parseCards("Kc 2h Ac Kd 3h Ad 7c 8d 9s 4c 5d"),
    });
    allInEveryone(table);
    assert.ok(table.squid);
    assert.ok(table.squid!.holders.includes("a"));
    assert.equal(table.squid!.holders.includes("b"), false);

    const { table: splitT } = open({ tableNumber: "SQUID2", squidEnabled: true, bounty27Enabled: false });
    joinSit(splitT, "a", "A");
    joinSit(splitT, "b", "B");
    joinSit(splitT, "c", "C");
    splitT.startHand({
      deck: parseCards("2c 3d 4h 2d 3h 4s 5c 6d 7h 8s 9c"),
    });
    checkCall(splitT);
    assert.ok(splitT.squid);
    assert.equal(splitT.squid!.holders.length, 0);

    const { table: three } = open({ tableNumber: "SQUID3", squidEnabled: true, bounty27Enabled: false });
    joinSit(three, "a", "A", 3);
    joinSit(three, "b", "B", 3);
    joinSit(three, "c", "C", 3);
    three.startHand({
      deck: parseCards("Kc 2h Ac Kd 3h Ad 7c 8d 9s 4c 5d"),
    });
    drive(three, (id) => (id === "a" ? { type: "allin" } : { type: "fold" }));
    assert.ok(three.squid!.holders.includes("a"));
    three.startHand({
      deck: parseCards("2c Ac 3d Ad 4h Kd 7c 8d 9s 5c 6d"),
    });
    drive(three, (id) => (id === "b" ? { type: "allin" } : { type: "fold" }));
    assert.ok(three.events.some((e) => e.type === "squid" && e.message === "鱿鱼惩罚"));

    const { table: mid } = open({ tableNumber: "SQUID4", squidEnabled: true, bounty27Enabled: false });
    joinSit(mid, "a", "A", 2);
    joinSit(mid, "b", "B", 2);
    joinSit(mid, "c", "C", 2);
    mid.startHand({
      deck: parseCards("Kc 2h Ac Kd 3h Ad 7c 8d 9s 4c 5d"),
    });
    drive(mid, (id) => (id === "a" ? { type: "allin" } : { type: "fold" }));
    assert.ok(mid.squid!.holders.includes("a"));
    assert.equal(mid.squid!.holders.length, 1);
    joinSit(mid, "d", "D", 1);
    assert.ok(mid.squid!.participants.includes("d"));
    assert.equal(mid.squid!.holders.includes("d"), false);
    mid.stand("d");
    assert.ok(mid.events.some((e) => e.type === "squid" && e.playerId === "d" && e.message === "鱿鱼惩罚"));
  });

  it("shown 72o winner is paid 27杂色 bounty; unshown or suited 72 is not", () => {
    const { table } = open({ bounty27Enabled: true });
    joinSit(table, "a", "A");
    joinSit(table, "b", "B");
    joinSit(table, "c", "C");
    table.startHand({
      deck: parseCards("9h 8s 7c Td 3c 2d 7h 7s 2s 4c 5d"),
    });
    checkCall(table);
    assert.ok(table.events.some((e) => e.type === "bounty" && e.playerId === "a"));
    assert.equal(table.players.get("a")!.chips, 208);
    assert.equal(table.players.get("b")!.chips, 196);
    assert.equal(table.players.get("c")!.chips, 196);

    const { table: suited } = open({ tableNumber: "SUITED", bounty27Enabled: true });
    joinSit(suited, "a", "A");
    joinSit(suited, "b", "B");
    suited.startHand({
      deck: parseCards("7c 9h 2c 8s 3d Td 7h 7s 4c 5d 6h"),
    });
    checkCall(suited);
    assert.equal(
      suited.events.some((e) => e.type === "bounty"),
      false,
    );

    const { table: hide } = open({ tableNumber: "HIDDEN", bounty27Enabled: true });
    joinSit(hide, "a", "A");
    joinSit(hide, "b", "B");
    hide.startHand({
      deck: parseCards("9h 7c 8s 2d 3c Td 7h 7s 2s 4c 5d"),
    });
    hide.action("a", { type: "fold" });
    assert.equal(
      hide.events.some((e) => e.type === "bounty"),
      false,
    );
    hide.showCards("b");
    assert.ok(hide.events.some((e) => e.type === "bounty" && e.playerId === "b"));
  });

  it("defaults remain straddle off, squid off, 27 on", () => {
    const t = createTable({ durationMinutes: 30 });
    assert.equal(t.config.straddleAllowed, false);
    assert.equal(t.config.squidEnabled, false);
    assert.equal(t.config.bounty27Enabled, true);
  });
});
