import { HttpClient, WebSocketTransport } from "@xrdavies/2d-engine";

export function inferApiOrigin(): string {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return `${location.protocol}//${host}:8789`;
  if (host.endsWith(".workers.dev") && host.startsWith("easy-poker.")) {
    return `${location.protocol}//${host.replace(/^easy-poker\./, "easy-poker-api.")}`;
  }
  return location.origin;
}

export class PokerNet {
  readonly http = new HttpClient();
  origin = "";
  transport: WebSocketTransport | null = null;

  async resolveOrigin(): Promise<string> {
    if (this.origin) return this.origin;
    try {
      const cfg = await this.http.json<{ apiOrigin?: string }>("/config.json", { cache: "no-store" as RequestCache });
      if (cfg?.apiOrigin) {
        this.origin = cfg.apiOrigin.replace(/\/$/, "");
        return this.origin;
      }
    } catch {
      /* convention */
    }
    this.origin = inferApiOrigin();
    return this.origin;
  }

  async api(path: string, body?: unknown): Promise<any> {
    const origin = await this.resolveOrigin();
    const headers: Record<string, string> = {};
    if (body) headers["content-type"] = "application/json";
    try {
      return await this.http.json(`${origin}${path}`, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err: any) {
      const nested = err?.body;
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), nested || {});
    }
  }

  connectWs(url: string, onMessage: (msg: any) => void, onClose: () => void): WebSocketTransport {
    this.transport?.close();
    const transport = new WebSocketTransport(url, { reconnect: true, reconnectDelay: 1200, connectTimeout: 8000 });
    this.transport = transport;
    transport.onMessage((data) => {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      try {
        onMessage(JSON.parse(text));
      } catch {
        /* ignore */
      }
    });
    void transport.connect().catch(() => onClose());
    return transport;
  }
}
