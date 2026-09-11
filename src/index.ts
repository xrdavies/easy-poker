import { generatePassword, generateTableNumber } from "./engine/config.ts";
import { cryptoRandom } from "./engine/cards.ts";
import { TableDO, type Env } from "./table-do.ts";

export { TableDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    const res = await handle(request, env);
    return withCors(request, res);
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/health") {
    return Response.json({ ok: true, service: "easy-poker-api" });
  }
  if (url.pathname === "/api/names" && request.method === "GET") {
    const { randomNickname } = await import("./engine/names.ts");
    return Response.json({ nickname: randomNickname() });
  }
  if (url.pathname === "/api/tables" && request.method === "POST") {
    return createTable(request, env);
  }
  if (url.pathname === "/api/join" && request.method === "POST") {
    return forward(request, env, await request.json());
  }
  if (url.pathname === "/api/cmd" && request.method === "POST") {
    return forward(request, env, await request.json());
  }
  if (url.pathname.startsWith("/api/table/") && request.method === "GET") {
    const tableNumber = url.pathname.slice("/api/table/".length);
    const playerId = url.searchParams.get("playerId") ?? "";
    const stub = env.TABLE.get(env.TABLE.idFromName(tableNumber));
    return stub.fetch(new Request(`https://table/snapshot?playerId=${encodeURIComponent(playerId)}`));
  }
  if (url.pathname === "/ws") {
    const tableNumber = url.searchParams.get("table") ?? "";
    if (!tableNumber) return new Response("missing table", { status: 400 });
    const stub = env.TABLE.get(env.TABLE.idFromName(tableNumber));
    return stub.fetch(request);
  }
  return Response.json({ error: "not_found" }, { status: 404 });
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCors(request: Request, res: Response): Response {
  if (res.status === 101) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function createTable(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  for (let i = 0; i < 8; i++) {
    const tableNumber = String(body.tableNumber ?? generateTableNumber(cryptoRandom));
    const password = String(body.password ?? generatePassword(cryptoRandom));
    const stub = env.TABLE.get(env.TABLE.idFromName(tableNumber));
    const res = await stub.fetch(
      new Request("https://table/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, tableNumber, password }),
      }),
    );
    if (res.status !== 409) return res;
    if (body.tableNumber) return res;
  }
  return Response.json({ error: "could_not_allocate" }, { status: 503 });
}

async function forward(request: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const tableNumber = String(body.tableNumber ?? "");
  if (!tableNumber) return Response.json({ error: "missing_table" }, { status: 400 });
  const stub = env.TABLE.get(env.TABLE.idFromName(tableNumber));
  return stub.fetch(
    new Request("https://table/cmd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
