# 部署说明

前端和游戏 API 是**两个 Worker**，不要把它们合成一个，也不要把 UI 单独放到 Pages。

| Worker | 配置 | 职责 | 本地端口 |
| --- | --- | --- | --- |
| `easy-poker` | `wrangler.web.toml` | 页面、样式、脚本、音效、`/config.json` | 8787 |
| `easy-poker-api` | `wrangler.toml` | `/api/*`、`/ws`、Durable Object `TableDO` | 8789 |

玩家打开**前端**地址。浏览器再向 API 发 HTTP 和 WebSocket。邀请链接用前端域名。

## 准备

1. Node.js 22+
2. Cloudflare 账号
3. 安装依赖并登录 Wrangler

```bash
npm install
npx wrangler login
```

## 本地

```bash
npm test
npm run dev
```

会同时拉起：

- 前端 `http://localhost:8787`
- API `http://127.0.0.1:8789`

浏览器只开 `http://localhost:8787`。`/config.json` 在本地返回 `{ "apiOrigin": "http://127.0.0.1:8789" }`。

也可分开启动：`npm run dev:web` 与 `npm run dev:api`。

## 生产部署

```bash
npm run deploy
```

等价于先部署 API、再部署前端：

```bash
npm run deploy:api
npm run deploy:web
```

成功后 Wrangler 会打印两个 `*.workers.dev` 地址，例如：

- 前端：`https://easy-poker.<account>.workers.dev` ← 把这个发给玩家
- API：`https://easy-poker-api.<account>.workers.dev`

前端 Worker 在生产环境若仍带着本地 `API_ORIGIN`，会按主机名推断 API：把 `easy-poker.` 换成 `easy-poker-api.`。自定义域名时显式传入 API 地址：

```bash
npx wrangler deploy --config wrangler.web.toml --var API_ORIGIN:https://easy-poker-api.<account>.workers.dev
```

若以前把「单体 Worker」（页面+API）以 `easy-poker` 之名部署过，先在 Dashboard 删除该 Worker，再执行上面的两次部署。Durable Object 类 `TableDO` 现在只挂在 `easy-poker-api` 上。

## 验证

```bash
curl -sS https://easy-poker-api.<account>.workers.dev/api/health
curl -sS https://easy-poker.<account>.workers.dev/health
curl -sS https://easy-poker.<account>.workers.dev/config.json
curl -sS https://easy-poker.<account>.workers.dev/ | head
```

- API `/api/health` → `{"ok":true,"service":"easy-poker-api"}`
- 前端 `/health` → `{"ok":true,"service":"easy-poker-web"}`
- 前端 `/config.json` → 含非空 `apiOrigin`
- 前端 `/` → HTML 页面

## 更新

改代码后再次 `npm run deploy`。若修改了 Durable Object 类名或存储模式，需要在 `wrangler.toml` 增加新的 `[[migrations]]` 条目，不要改写已经发布的 migration tag。
