# 技术架构

易扑克是一个部署在 Cloudflare Workers 上的全栈应用：同一个 Worker 既托管浏览器 UI（静态资源），也托管游戏 API / WebSocket。每张游戏桌对应一个 Durable Object 实例，作为该桌的唯一权威。

## 组件

```
浏览器
  └─ public/（HTML/CSS/JS/音效）  ← Worker ASSETS 绑定
  └─ WebSocket / HTTPS
        └─ Worker (src/index.ts)
              ├─ POST /api/tables  创建桌，idFromName(桌号) 路由到 DO
              ├─ POST /api/join    号码+密码加入
              ├─ POST /api/cmd     坐下 / 行动 / 起身 …
              ├─ GET  /api/table/:id
              └─ GET  /ws          Upgrade 转发到同一 DO
                    └─ TableDO (src/table-do.ts)
                          └─ src/engine/*  纯牌局引擎
```

## 纯引擎（`src/engine`）

牌组、摊牌比较、边池、街机状态、买入、随机空位、straddle / 鱿鱼 / 27 杂色、10 秒行动钟（注入 `now()`）都在引擎里，不依赖 Worker 或 DOM。

- 服务端是唯一发牌方。客户端只发送行动，不发送也不接收未公开的底牌。
- `Table.snapshot(viewerId)` 是唯一的对外视图：本人手牌可见；他人手牌仅在亮牌/摊牌后出现；未发出的牌与剩余牌组从不进入快照。测试与 WebSocket 都走这个函数。

## 实时与时钟

Durable Object 用 `storage.put("table", table.toJSON())` 持久化。行动截止时间通过 `setAlarm` 唤醒，超时由引擎 `tick()` 判为 fold。一手结束后约 2.8 秒再发下一手。桌时长从第一手发牌起算，当前手打完后进入结算，之后拒绝 `startHand`。

## 身份与筹码

玩家 ID 在浏览器用 `crypto.randomUUID()` 生成并写入 `localStorage`，不注册账号。同一 ID 在不同 DO（不同桌）上的筹码互相独立。坐下时买入 `N × 100 大盲`；起身只离开座位，筹码仍记在本桌的玩家记录上。

## 前端

`public/` 为单页：大厅（昵称 / 创建 / 加入）→ 牌桌 → 结算。CSS 用横屏桌面与竖屏手机两套布局。音效为 `public/sounds/*.wav`（弃牌 / 过牌 / 加注 / 发牌 / 结算）。发牌与座位高亮使用 CSS 动画。

## 非目标（刻意不做）

短牌、锦标赛、账户体系、大厅匹配、把 UI 单独放到 Pages 而 Worker 只做 API。
