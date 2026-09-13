# Easy Poker

多人在线德州扑克（长牌/短牌现金桌）。**前端 Worker** 托管页面，**API Worker** 托管游戏权威服务和 WebSocket，用 Durable Object 作为每一张游戏桌的实时房间。两个 Worker 分开部署。

## 功能

- 最多 8 人，两人坐下即可开局，结束前可随时观战或坐下
- 创建桌时可设时长（30 分钟 / 1 小时 / 2 小时 / 4 小时 / 8 小时）、无限或有限 buy-in、是否允许 straddle、鱿鱼游戏、27 杂色奖励（翻牌后用 72 杂色逼退所有对手时自动亮牌，其他在座玩家各支付 5BB）
- 创建桌时可选择标准短牌（6-A，同花大于葫芦），默认长牌
- 点击自己的头像发送 12 种固定表情，其他玩家会看到头像上方的气泡
- 用邀请链接或「桌号 + 密码」拉人
- 无需注册：本地生成唯一玩家标识，昵称可点「随机名」
- 标准德州长牌：翻牌前 / 翻牌 / 转牌 / 河牌，边池，10 秒超时默认过牌，不能过则弃牌（最后 5 秒滴答提示）
- 筹码只在本桌有效；起身再坐下筹码保留。补码随时可点，下一手开始时到账；输光的玩家不参与下一手直到补码
- 两人 All-in 时可协商发一次或发两次公共牌（默认发一次）
- 桌局结束后只展示结算，不能重开
- 横屏桌面与竖屏手机两套布局，发牌/行动动画与音效
- 房主可在 Desktop 牌桌顶部添加多个浏览器端 AI 玩家，并为不同 AI 选择不同的本地模型配置

## 本地运行

需要 Node.js 22+。

```bash
npm install
npm test
npm run dev
```

浏览器打开 `http://localhost:8787`（前端）。API 在 `http://127.0.0.1:8789`。

端口被其他开发会话占用时，`npm run dev` 会自动选择附近空闲端口；也可用 `EASY_POKER_API_PORT`、`EASY_POKER_WEB_PORT` 指定端口。

## Desktop 浏览器 AI 玩家

房主创建牌桌后，可在桌面版顶部点击「AI玩家」，直接从当前网页添加和管理多个 AI。每个 AI 可以使用不同的 API Key、Base URL、Model 和水平 / 牌手 Prompt。

使用步骤：

1. 打开「AI玩家 → 管理模型配置」，保存模型 API 配置；API Key 会加密保存在当前浏览器。
2. 模型 API 不支持浏览器 CORS 时，勾选「通过游戏代理访问模型 API」；请求会经过游戏 API Worker 转发，但不会保存 API Key。
3. 点击「添加 AI」，选择昵称、买入次数、模型配置以及水平 / 牌手 Prompt。
4. AI 会作为独立玩家加入牌桌。页面刷新后自动恢复；房主移除 AI 后不再恢复。

模型决策只使用可见牌局事实，包括按钮位、大小盲、当前位置、有效筹码、BB 深度、当前参与人数和本街行动历史，不会读取其他玩家手牌或假设对手风格。

### 牌手 Prompt

牌手 Prompt 是基于公开牌局特征的近似模拟，与「新手」「有经验」「职业」处于同一级选项：

| 牌手 | 模拟特征 |
| --- | --- |
| Tom Dwan | 松凶施压，深筹码和后位扩大范围，善用半诈唬、check-raise、多街施压和极化尺度 |
| 谭轩 | 高波动进攻，倾向主动加注和大尺度下注，强听牌与关键阻断牌保持压力 |
| Phil Ivey | 冷静全面，根据位置、筹码和行动线路灵活调整，兼顾薄价值、bluff-catch 与纪律性弃牌 |
| Alan Keating | 超松凶高压，扩大入池和再加注范围，主动制造大底池并接受较高方差 |
| 臧书奴 | 重视数学与长期优势，耐心控制边缘风险，优势明确时果断施压并争取最大价值 |

浏览器 AI 的完整设计和安全边界见 [docs/browser-ai-agents.md](docs/browser-ai-agents.md)。

## 命令行 AI Agent

先在 `.env` 中配置模型所需的 `API_KEY`、`BASE_URL` 和 `MODEL`，然后让 Agent 通过邀请链接加入已有牌桌：

```bash
source .env
node scripts/agent.mjs --invite '<邀请链接>' --name AI玩家 --level experienced --api '<游戏 API 地址>'
```

也可以使用桌号和密码加入，或由 Agent 创建新牌桌：

```bash
node scripts/agent.mjs '<桌号>' '<密码>' --name AI玩家 --level beginner --api '<游戏 API 地址>'
node scripts/agent.mjs --create --web '<游戏前端地址>' --api '<游戏 API 地址>'
```

`--level` 可选 `beginner`、`experienced`、`pro`；可用 `--api` 或 `GAME_API_URL` 指定游戏 API。AI 先请求 Responses，服务不支持时回退到 Chat Completions。

Agent 优先通过游戏 WebSocket 接收状态，断线时自动回退到轮询。

## 测试

```bash
npm test
```

测试直接 `import` `src/engine` 里上线用的牌局引擎（不是拷贝或 mock）。

## 部署

两个 Worker：`easy-poker`（前端）和 `easy-poker-api`（API + 牌桌）。见 [docs/deploy.md](docs/deploy.md)。架构见 [docs/architecture.md](docs/architecture.md)。

远程仓库：`git@github.com:xrdavies/easy-poker.git`
