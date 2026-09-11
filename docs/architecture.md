# 技术架构

易扑克是一个部署在 Cloudflare Workers 上的全栈应用：**前端 Worker** 托管浏览器 UI，**API Worker** 托管游戏 HTTP / WebSocket。每张游戏桌对应 API Worker 上的一个 Durable Object 实例，作为该桌的唯一权威。

## 组件

```
浏览器
  └─ public/（HTML/CSS/JS/音效）  ← 前端 Worker easy-poker（wrangler.web.toml）
        GET /config.json          → { apiOrigin }
        GET /                     → 页面
  └─ HTTPS / WebSocket（跨域）
        └─ API Worker easy-poker-api（wrangler.toml）
              ├─ POST /api/tables  创建桌，idFromName(桌号) 路由到 DO
              ├─ POST /api/join    号码+密码加入
              ├─ POST /api/cmd     坐下 / 行动 / 起身 …
              ├─ GET  /api/table/:id
              └─ GET  /ws          Upgrade 转发到同一 DO
                    └─ TableDO (src/table-do.ts)
                          └─ src/engine/*  纯牌局引擎
```

两个 Worker 分开部署。浏览器打开前端地址；接口和实时连接打到 API 地址。API 对前端 Origin 返回 CORS 头。邀请链接始终用前端域名生成 `/?t=桌号&p=密码`。

## 纯引擎（`src/engine`）

牌组、摊牌比较、边池、街机状态、买入、随机空位、straddle / 鱿鱼 / 27 杂色、10 秒行动钟（注入 `now()`）都在引擎里，不依赖 Worker 或 DOM。补码记入 pending，下一手 `startHand` 时到账。两人 All-in 且公共牌未发完时进入 5 秒发牌协商（默认发一次，双方都选发两次才跑两次）。超时默认过牌，不能过则弃牌并写入 lastResult 展示结算。

- 服务端是唯一发牌方。客户端只发送行动，不发送也不接收未公开的底牌。
- `Table.snapshot(viewerId)` 是唯一的对外视图：本人手牌可见；他人手牌仅在亮牌/摊牌后出现；未发出的牌与剩余牌组从不进入快照。测试与 WebSocket 都走这个函数。

## 实时与时钟

Durable Object 用 `storage.put("table", table.toJSON())` 持久化。行动截止时间通过 `setAlarm` 唤醒，超时由引擎 `tick()` 判为 fold。一手结束后约 2.8 秒再发下一手。桌时长从第一手发牌起算，当前手打完后进入结算，之后拒绝 `startHand`。

## 身份与筹码

玩家 ID 在浏览器用 `crypto.randomUUID()` 生成并写入 `localStorage`，不注册账号。同一 ID 在不同 DO（不同桌）上的筹码互相独立。坐下时买入 `N × 100 大盲`；起身只离开座位，筹码仍记在本桌的玩家记录上。

## 前端

`public/` 为单页：大厅（昵称 / 创建 / 加入）→ 牌桌 → 结算。启动时请求 `/config.json` 得到 `apiOrigin`，随后 HTTP 与 WebSocket 都打到 API Worker。CSS 用横屏桌面与竖屏手机两套布局。音效为 `public/sounds/*.wav`（弃牌 / 过牌 / 加注 / 发牌 / 结算）。发牌与座位高亮使用 CSS 动画。

## 非目标（刻意不做）

短牌、锦标赛、账户体系、大厅匹配、把 UI 放到 Cloudflare Pages。
