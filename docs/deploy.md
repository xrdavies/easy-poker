# 部署说明

前端静态资源和游戏服务部署在**同一个 Cloudflare Worker** 中，不要把 UI 单独放到 Pages。

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
npx wrangler dev
```

默认监听 `http://localhost:8787`。Worker 会：

- 用 `ASSETS` 绑定提供 `public/` 下的页面、样式、脚本和音效
- 把 `/api/*` 与 `/ws` 交给 `src/index.ts`
- 用 Durable Object 类 `TableDO` 保存每一桌

## 生产部署

```bash
npx wrangler deploy
```

`wrangler.toml` 中：

- `main = "src/index.ts"`：Worker 入口
- `[assets] directory = "./public"`：UI
- `[durable_objects]` + `[[migrations]]`：`TableDO`（SQLite 存储）

部署成功后，Wrangler 会打印 `*.workers.dev` 地址。把该地址发给玩家即可；邀请链接由客户端用当前域名生成 `/?t=桌号&p=密码`。

## 验证

```bash
curl -sS https://<your-worker>.workers.dev/api/health
curl -sS https://<your-worker>.workers.dev/ | head
```

`/api/health` 应返回 `{"ok":true,"service":"easy-poker"}`，`/` 应返回 HTML 页面。

## 更新

改代码后再次 `npx wrangler deploy`。若修改了 Durable Object 类名或存储模式，需要在 `wrangler.toml` 增加新的 `[[migrations]]` 条目，不要改写已经发布的 migration tag。
