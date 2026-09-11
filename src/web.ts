export interface WebEnv {
  ASSETS: Fetcher;
  API_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: WebEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/config.json") {
      return Response.json(
        { apiOrigin: resolveApiOrigin(url, env.API_ORIGIN ?? "") },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "easy-poker-web" });
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return Response.json({ error: "wrong_worker", service: "easy-poker-web" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};

function resolveApiOrigin(page: URL, configured: string): string {
  const host = page.hostname;
  const pageLocal = host === "localhost" || host === "127.0.0.1";
  const cfg = configured.replace(/\/$/, "");
  const cfgLocal = !cfg || /localhost|127\.0\.0\.1/.test(cfg);
  if (cfg && (pageLocal || !cfgLocal)) return cfg;
  // if (host.endsWith(".workers.dev") && host.startsWith("easy-poker.")) {
  if (host.startsWith("easy-poker.")) {
    return `${page.protocol}//${host.replace(/^easy-poker\./, "easy-poker-api.")}`;
  }
  return cfg;
}
