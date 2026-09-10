import { cryptoRandom } from "./engine/cards.ts";
import { createTable, Table, type ActionInput, type TableJSON } from "./engine/table.ts";
import type { CreateTableInput } from "./engine/types.ts";

export interface Env {
  TABLE: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const NEXT_HAND_MS = 2800;

export class TableDO {
  ctx: DurableObjectState;
  env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const playerId = url.searchParams.get("playerId") ?? "";
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ playerId });
      const table = await this.load();
      if (table && playerId) {
        pair[1].send(JSON.stringify({ type: "state", snapshot: table.snapshot(playerId) }));
      } else if (!table) {
        pair[1].send(JSON.stringify({ type: "error", code: "not_found", message: "游戏桌不存在" }));
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    try {
      if (request.method === "POST" && url.pathname.endsWith("/init")) {
        return await this.init(await request.json());
      }
      if (request.method === "POST" && url.pathname.endsWith("/cmd")) {
        return await this.cmd(await request.json());
      }
      if (request.method === "GET") {
        const playerId = url.searchParams.get("playerId");
        const table = await this.load();
        if (!table) return json({ error: "not_found" }, 404);
        return json({ snapshot: table.snapshot(playerId) });
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      return errorResponse(err);
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "无效消息" }));
      return;
    }
    const att = (ws.deserializeAttachment() ?? {}) as { playerId?: string };
    if (!body.playerId && att.playerId) body.playerId = att.playerId;
    try {
      const snapshot = await this.apply(body);
      if (body.playerId) ws.serializeAttachment({ playerId: String(body.playerId) });
      void snapshot;
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", ...errorBody(err) }));
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close();
  }

  async alarm(): Promise<void> {
    const table = await this.load();
    if (!table) return;
    table.tick();
    if (!table.hand && table.canStartHand()) {
      table.startHand();
    }
    await this.save(table);
    this.broadcast();
    await this.schedule(table);
  }

  private async init(body: CreateTableInput & { playerId: string; nickname: string; password?: string }): Promise<Response> {
    const existing = await this.load();
    if (existing) return json({ error: "exists", snapshot: existing.snapshot(body.playerId) }, 409);
    const table = createTable(
      {
        durationMinutes: body.durationMinutes,
        unlimitedBuyin: body.unlimitedBuyin,
        maxBuyins: body.maxBuyins,
        straddleAllowed: body.straddleAllowed,
        squidEnabled: body.squidEnabled,
        bounty27Enabled: body.bounty27Enabled,
        tableNumber: body.tableNumber,
        password: body.password,
      },
      { now: Date.now, random: cryptoRandom },
    );
    table.addPlayer(body.playerId, body.nickname, table.password);
    await this.save(table);
    return json({ snapshot: table.snapshot(body.playerId), invite: table.getInvite() });
  }

  private async cmd(body: Record<string, unknown>): Promise<Response> {
    const snapshot = await this.apply(body);
    return json({ snapshot });
  }

  private async apply(body: Record<string, unknown>): Promise<ReturnType<Table["snapshot"]> | null> {
    const table = await this.load();
    if (!table) throw Object.assign(new Error("游戏桌不存在"), { code: "not_found" });
    table.tick();
    const type = String(body.type ?? "");
    const playerId = String(body.playerId ?? "");
    const nickname = String(body.nickname ?? "");

    switch (type) {
      case "join":
        table.addPlayer(playerId, nickname, String(body.password ?? ""));
        break;
      case "sit":
        table.sit(playerId, Number(body.buyinCount ?? 0));
        break;
      case "stand":
        table.stand(playerId);
        break;
      case "rebuy":
        table.rebuy(playerId, Number(body.buyinCount ?? 1));
        break;
      case "action":
        table.action(playerId, {
          type: body.action as ActionInput["type"],
          amount: body.amount === undefined ? undefined : Number(body.amount),
        });
        break;
      case "show":
        table.showCards(playerId);
        break;
      case "autoStraddle":
        table.setAutoStraddle(playerId, Boolean(body.on));
        break;
      case "snapshot":
        break;
      default:
        throw Object.assign(new Error("未知命令"), { code: "unknown_cmd" });
    }

    if (!table.hand && table.canStartHand() && table.nextHandNumber === 1) {
      table.startHand();
    }
    await this.save(table);
    this.broadcast();
    await this.schedule(table);
    return table.snapshot(playerId || null);
  }

  private async load(): Promise<Table | null> {
    const data = await this.ctx.storage.get<TableJSON>("table");
    if (!data) return null;
    return Table.fromJSON(data, { now: Date.now, random: cryptoRandom });
  }

  private async save(table: Table): Promise<void> {
    await this.ctx.storage.put("table", table.toJSON());
  }

  private broadcast(): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    void this.load().then((table) => {
      if (!table) return;
      for (const ws of sockets) {
        const att = (ws.deserializeAttachment() ?? {}) as { playerId?: string };
        try {
          ws.send(JSON.stringify({ type: "state", snapshot: table.snapshot(att.playerId ?? null) }));
        } catch {
          /* closed */
        }
      }
    });
  }

  private async schedule(table: Table): Promise<void> {
    if (table.status === "finished") {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (table.hand?.actionDeadline) {
      await this.ctx.storage.setAlarm(table.hand.actionDeadline);
      return;
    }
    if (table.canStartHand()) {
      await this.ctx.storage.setAlarm(Date.now() + NEXT_HAND_MS);
    }
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function errorBody(err: unknown): { code: string; message: string } {
  const e = err as { code?: string; message?: string };
  return { code: e.code ?? "error", message: e.message ?? "服务器错误" };
}

function errorResponse(err: unknown): Response {
  const body = errorBody(err);
  const status = body.code === "not_found" ? 404 : body.code === "wrong_password" ? 403 : 400;
  return json({ error: body.code, ...body }, status);
}
