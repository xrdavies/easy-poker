import { decide, gameWsUrl, legalMove, PROMPTS, PROMPT_LABELS } from "./agent-core.js";

const PROFILES_KEY = "easy-poker.ai.profiles.v1";
const TABLES_KEY = "easy-poker.ai.tables.v1";
const DB_NAME = "easy-poker-ai";
const DB_STORE = "keys";

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function bytesToBase64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function base64ToBytes(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function encryptionKey() {
  const db = await openKeyDb();
  const current = await new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE).objectStore(DB_STORE).get("aes");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (current) return current;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(key, "aes");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return key;
}

async function encryptSecret(secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(secret));
  return { apiKeyCiphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

async function decryptSecret(profile) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(profile.iv) },
    await encryptionKey(),
    base64ToBytes(profile.apiKeyCiphertext),
  );
  return new TextDecoder().decode(plain);
}

export class BrowserAiAgents {
  constructor(getApiOrigin, onChange = () => {}) {
    this.getApiOrigin = getApiOrigin;
    this.onChange = onChange;
    this.tableNumber = "";
    this.password = "";
    this.profiles = [];
    this.bots = [];
    this.runtimes = new Map();
  }

  async attach(tableNumber, password) {
    if (this.tableNumber === tableNumber) return;
    this.detach();
    this.tableNumber = tableNumber;
    this.password = password;
    const stored = readJson(PROFILES_KEY, { version: 1, profiles: [] }).profiles ?? [];
    this.profiles = await Promise.all(stored.map(async (profile) => {
      try { return { ...profile, apiKey: await decryptSecret(profile) }; }
      catch { return { ...profile, apiKey: "", decryptError: true }; }
    }));
    const tables = readJson(TABLES_KEY, { version: 1, tables: {} }).tables ?? {};
    this.bots = tables[tableNumber] ?? [];
    this.onChange();
    for (const bot of this.bots) this.start(bot);
  }

  detach() {
    for (const runtime of this.runtimes.values()) this.stop(runtime);
    this.runtimes.clear();
    this.tableNumber = "";
    this.password = "";
    this.bots = [];
  }

  getProfiles() {
    return this.profiles.map(({ apiKey, apiKeyCiphertext, iv, ...profile }) => profile);
  }

  getBots() {
    return this.bots.map((bot) => {
      const profile = this.profiles.find((item) => item.id === bot.profileId);
      const runtime = this.runtimes.get(bot.botId);
      return {
        ...bot,
        levelName: PROMPT_LABELS[bot.level] ?? bot.level,
        model: profile?.model ?? "模型配置已删除",
        keyLabel: profile?.keyLabel ?? "—",
        status: runtime?.status ?? "连接中",
        error: runtime?.error ?? "",
      };
    });
  }

  async saveProfile(input) {
    const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
    const parsed = new URL(baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Base URL 必须使用 HTTP 或 HTTPS");
    if (!input.name.trim() || !input.model.trim()) throw new Error("请填写配置名称和 Model");
    const existing = this.profiles.find((profile) => profile.id === input.id);
    if (!existing && !input.apiKey) throw new Error("请填写 API Key");
    const secret = input.apiKey ? await encryptSecret(input.apiKey) : existing;
    const profile = {
      id: existing?.id ?? crypto.randomUUID(),
      keyLabel: existing?.keyLabel ?? this.nextKeyLabel(),
      name: input.name.trim(),
      baseUrl,
      model: input.model.trim(),
      useProxy: Boolean(input.useProxy),
      apiKeyCiphertext: secret.apiKeyCiphertext,
      iv: secret.iv,
      apiKey: input.apiKey || existing.apiKey,
    };
    this.profiles = existing
      ? this.profiles.map((item) => item.id === profile.id ? profile : item)
      : [...this.profiles, profile];
    this.persistProfiles();
    this.onChange();
    return profile.id;
  }

  removeProfile(id) {
    const tables = readJson(TABLES_KEY, { version: 1, tables: {} }).tables ?? {};
    if (Object.values(tables).some((bots) => bots.some((bot) => bot.profileId === id))) {
      throw new Error("该模型配置仍被 AI 玩家使用");
    }
    this.profiles = this.profiles.filter((profile) => profile.id !== id);
    this.persistProfiles();
    this.onChange();
  }

  addBot(input) {
    if (!this.tableNumber) throw new Error("尚未进入牌桌");
    if (!this.profiles.some((profile) => profile.id === input.profileId)) throw new Error("请选择模型配置");
    if (!input.nickname.trim()) throw new Error("请填写 AI 昵称");
    if (!PROMPTS[input.level]) throw new Error("无效的 AI 水平");
    const bot = {
      botId: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      nickname: input.nickname.trim().slice(0, 16),
      level: input.level,
      profileId: input.profileId,
      buyinCount: Math.max(1, Math.floor(Number(input.buyinCount) || 1)),
    };
    this.bots.push(bot);
    this.persistBots();
    this.onChange();
    this.start(bot);
  }

  async removeBot(botId) {
    const bot = this.bots.find((item) => item.botId === botId);
    if (!bot) return;
    const runtime = this.runtimes.get(botId);
    if (runtime) this.stop(runtime);
    this.runtimes.delete(botId);
    this.bots = this.bots.filter((item) => item.botId !== botId);
    this.persistBots();
    this.onChange();
    try {
      await this.gameApi("/api/cmd", { type: "stand", tableNumber: this.tableNumber, playerId: bot.playerId, nickname: bot.nickname });
    } catch {
      /* local removal must still complete */
    }
  }

  nextKeyLabel() {
    const max = Math.max(0, ...this.profiles.map((profile) => Number(profile.keyLabel?.match(/\d+/)?.[0]) || 0));
    return `KEY-${String(max + 1).padStart(2, "0")}`;
  }

  persistProfiles() {
    const profiles = this.profiles.map(({ apiKey, decryptError, ...profile }) => profile);
    writeJson(PROFILES_KEY, { version: 1, profiles });
  }

  persistBots() {
    const store = readJson(TABLES_KEY, { version: 1, tables: {} });
    store.version = 1;
    store.tables ??= {};
    store.tables[this.tableNumber] = this.bots;
    writeJson(TABLES_KEY, store);
  }

  start(bot) {
    if (this.runtimes.has(bot.botId)) return;
    const runtime = { bot, status: "连接中", error: "", stopped: false, socket: null, snapshot: null, busy: false, lastTurn: "", retryAt: 0, abortController: null, lifecycleController: new AbortController(), reconnectTimer: null, releaseLock: null };
    this.runtimes.set(bot.botId, runtime);
    const run = async () => {
      const hold = new Promise((resolve) => { runtime.releaseLock = resolve; });
      if (runtime.stopped) return;
      await this.connect(runtime);
      await hold;
    };
    if (navigator.locks) {
      void navigator.locks.request(`easy-poker-ai:${this.tableNumber}:${bot.botId}`, { ifAvailable: true }, async (lock) => {
        if (!lock) return this.setStatus(runtime, "其他标签页运行");
        await run();
      }).catch(() => this.setStatus(runtime, "连接异常", "无法获取运行锁"));
    } else {
      void run();
    }
  }

  stop(runtime) {
    runtime.stopped = true;
    runtime.lifecycleController.abort();
    runtime.abortController?.abort();
    clearTimeout(runtime.reconnectTimer);
    if (runtime.socket) {
      runtime.socket.onclose = null;
      runtime.socket.close();
    }
    runtime.releaseLock?.();
  }

  async connect(runtime) {
    try {
      const data = await this.gameApi("/api/join", {
        type: "join",
        tableNumber: this.tableNumber,
        password: this.password,
        playerId: runtime.bot.playerId,
        nickname: runtime.bot.nickname,
      }, runtime.lifecycleController.signal);
      if (runtime.stopped) return;
      runtime.snapshot = data.snapshot;
      await this.ensureSeated(runtime);
      if (!runtime.stopped) this.openSocket(runtime);
    } catch (err) {
      if (runtime.stopped) return;
      this.setStatus(runtime, "连接异常", this.safeError(err, "游戏连接失败"));
      runtime.reconnectTimer = setTimeout(() => this.connect(runtime), 3000);
    }
  }

  openSocket(runtime) {
    void this.getApiOrigin().then((origin) => {
      if (runtime.stopped) return;
      this.setStatus(runtime, "连接中");
      const ws = new WebSocket(gameWsUrl(origin, this.tableNumber, runtime.bot.playerId));
      runtime.socket = ws;
      ws.onopen = () => this.setStatus(runtime, runtime.snapshot?.me?.sitting ? "运行中" : "等待空位");
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "state" && message.snapshot) void this.handleSnapshot(runtime, message.snapshot);
          if (message.type === "error") this.setStatus(runtime, "连接异常", "游戏连接失败");
        } catch {
          this.setStatus(runtime, "连接异常", "游戏消息无效");
        }
      };
      ws.onerror = () => this.setStatus(runtime, "连接异常", "游戏连接失败");
      ws.onclose = () => {
        if (runtime.stopped) return;
        this.setStatus(runtime, "连接中");
        runtime.reconnectTimer = setTimeout(() => this.openSocket(runtime), 1200);
      };
    }).catch((err) => this.setStatus(runtime, "连接异常", this.safeError(err, "游戏连接失败")));
  }

  async ensureSeated(runtime) {
    const snap = runtime.snapshot;
    if (runtime.stopped || !snap || snap.status === "finished" || snap.me?.sitting || runtime.seating || Date.now() < runtime.retryAt) return;
    runtime.seating = true;
    runtime.retryAt = Date.now() + 3000;
    try {
      const data = await this.gameApi("/api/cmd", {
        type: "sit",
        tableNumber: this.tableNumber,
        playerId: runtime.bot.playerId,
        nickname: runtime.bot.nickname,
        buyinCount: snap.me?.chips ? 0 : runtime.bot.buyinCount,
      }, runtime.lifecycleController.signal);
      runtime.snapshot = data.snapshot;
      this.setStatus(runtime, "运行中");
    } catch (err) {
      if (err.code === "table_full") this.setStatus(runtime, "等待空位");
      else if (err.code === "already_seated") this.setStatus(runtime, "运行中");
      else this.setStatus(runtime, "连接异常", this.safeError(err, "无法坐下"));
    } finally {
      runtime.seating = false;
    }
  }

  async handleSnapshot(runtime, snapshot) {
    runtime.snapshot = snapshot;
    if (runtime.stopped || snapshot.status === "finished") return;
    if (snapshot.me?.chips || snapshot.me?.pendingChips) runtime.rebuying = false;
    if (!snapshot.me?.sitting) {
      await this.ensureSeated(runtime);
      if (!runtime.snapshot?.me?.sitting) return;
      snapshot = runtime.snapshot;
    }
    if (!snapshot.me.chips && !snapshot.me.pendingChips && !runtime.rebuying) {
      runtime.rebuying = true;
      try {
        const data = await this.gameApi("/api/cmd", { type: "rebuy", tableNumber: this.tableNumber, playerId: runtime.bot.playerId, nickname: runtime.bot.nickname, buyinCount: runtime.bot.buyinCount }, runtime.lifecycleController.signal);
        runtime.snapshot = data.snapshot;
      } catch (err) {
        runtime.rebuying = false;
        this.setStatus(runtime, "连接异常", this.safeError(err, "补码失败"));
      }
    }
    if (snapshot.runoutVote && snapshot.me?.holeCards && !snapshot.runoutVote.choices?.[runtime.bot.playerId]) {
      try { await this.gameApi("/api/cmd", { type: "runout", choice: "once", tableNumber: this.tableNumber, playerId: runtime.bot.playerId, nickname: runtime.bot.nickname }, runtime.lifecycleController.signal); }
      catch { /* server timeout will choose once */ }
      return;
    }
    const turn = `${snapshot.handNumber}:${snapshot.street}:${snapshot.actionDeadline}`;
    if (!snapshot.legal || snapshot.actingPlayerId !== runtime.bot.playerId || runtime.busy || runtime.lastTurn === turn) return;
    runtime.busy = true;
    runtime.lastTurn = turn;
    runtime.abortController = new AbortController();
    const profile = this.profiles.find((item) => item.id === runtime.bot.profileId);
    let move;
    let modelError = false;
    try {
      if (!profile?.apiKey) throw new Error("模型配置无法解密");
      const config = profile.useProxy ? { ...profile, proxyOrigin: await this.getApiOrigin() } : profile;
      move = await decide(snapshot, runtime.bot.level, config, runtime.abortController.signal);
    } catch (err) {
      if (runtime.stopped || err.name === "AbortError") return;
      modelError = true;
      move = legalMove({}, snapshot.legal);
      this.setStatus(runtime, "连接异常", "模型请求失败");
    } finally {
      runtime.abortController = null;
    }
    try {
      const current = runtime.snapshot;
      const currentTurn = `${current?.handNumber}:${current?.street}:${current?.actionDeadline}`;
      if (runtime.stopped || currentTurn !== turn || current?.actingPlayerId !== runtime.bot.playerId) return;
      const data = await this.gameApi("/api/cmd", { type: "action", ...move, tableNumber: this.tableNumber, playerId: runtime.bot.playerId, nickname: runtime.bot.nickname }, runtime.lifecycleController.signal);
      runtime.snapshot = data.snapshot;
      if (!modelError) this.setStatus(runtime, "运行中");
    } catch (err) {
      runtime.lastTurn = "";
      this.setStatus(runtime, "连接异常", this.safeError(err, "行动提交失败"));
    } finally {
      runtime.busy = false;
    }
  }

  async gameApi(path, body, signal) {
    const origin = await this.getApiOrigin();
    const res = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || "请求失败"), data);
    return data;
  }

  setStatus(runtime, status, error = "") {
    runtime.status = status;
    runtime.error = error;
    this.onChange();
  }

  safeError(err, fallback) {
    return ["table_full", "buyin_limit"].includes(err?.code) ? err.message : fallback;
  }
}
