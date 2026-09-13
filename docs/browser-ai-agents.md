# 浏览器端 AI Agent 方案

## 目标

房主创建游戏桌后，可在桌面版牌局页面添加多个 AI 玩家。AI Agent 运行在房主浏览器中，通过现有游戏 API/WebSocket 加入牌桌、接收自己的牌局状态、调用所选大模型并提交行动。

本功能面向朋友间内部使用，不在服务器运行模型调用，也不要求房主每次打开页面时重新输入模型配置。

## 已确认范围

- 仅在 Desktop 布局提供 AI 管理入口，手机端不显示。
- 支持同时添加多个 AI，最多受牌桌 8 个座位限制。
- 每个 AI 是独立玩家，拥有固定 `playerId` 和独立游戏 WebSocket。
- 每个 AI 可选择不同的 API Key、Base URL、Model 和水平，用于不同模型之间对局。
- 模型配置与 AI 玩家分开保存，同一份模型配置可被多个 AI 复用。
- AI 只与游戏服务器 API/WebSocket 和模型 API 交互，不点击或复用房主页面的行动按钮。
- AI 管理只提供“添加”和“移除”，不提供暂停、恢复或手动接管。
- AI 详情只展示基本配置和运行状态，不展示手牌、公共牌、行动、决策、提示词、模型响应或调用日志。
- 只要 AI 没有被房主移除，页面刷新后就自动恢复。AI 因连续超时被强制起身时，也会自动重新坐下。
- 已移除的 AI 从管理列表和本地牌桌配置中彻底删除，刷新后不再恢复。

## 页面结构

桌面版牌局顶部增加“AI 玩家（N）”入口。面板中列出当前牌桌仍受本浏览器管理的 AI：

```text
AI-小王
experienced · deepseek-chat · KEY-01
状态：运行中
[查看信息] [移除]

AI-小李
pro · gpt-4o · KEY-02
状态：连接异常
[查看信息] [移除]

[添加 AI] [管理模型配置]
```

AI 详情仅显示：

- 昵称；
- 水平：`beginner`、`experienced` 或 `pro`；
- Model；
- API Key 编号，例如 `KEY-01`；
- 状态。

状态限定为：

- 连接中；
- 运行中；
- 等待空位；
- 连接异常。

错误状态可以显示简短原因，例如“模型请求失败”或“游戏连接失败”，但不得显示 API Key、请求内容、牌局私有数据或模型响应。

## 模型配置与 AI 玩家

模型配置独立管理，避免添加每个 AI 时重复输入密钥：

```js
{
  id: "profile-uuid",
  keyLabel: "KEY-01",
  name: "DeepSeek",
  baseUrl: "https://api.example.com/v1",
  model: "deepseek-chat",
  apiKeyCiphertext: "...",
  iv: "..."
}
```

AI 玩家只保存关联关系：

```js
{
  botId: "bot-uuid",
  playerId: "stable-player-uuid",
  nickname: "AI-小王",
  level: "experienced",
  profileId: "profile-uuid",
  buyinCount: 1
}
```

规则：

- `playerId` 创建后保持不变，刷新后服务器才能识别为原玩家。
- API Key 编号只用于界面识别，不包含密钥片段。
- 删除 AI 不删除其模型配置，因为该配置可能仍被其他 AI 使用。
- 删除仍被 AI 引用的模型配置前必须阻止操作并提示先移除或改配相关 AI。

## 本地存储

使用浏览器原生能力，不增加依赖：

- `localStorage` 保存模型配置元数据、加密后的 API Key，以及按桌号划分的 AI 玩家配置。
- `IndexedDB` 保存由 Web Crypto 生成的不可导出 AES-GCM 密钥。
- API Key 仅在模型调用前解密到内存，不写入游戏服务器、URL、日志、snapshot 或 WebSocket 消息。

建议存储键：

```text
easy-poker.ai.profiles.v1
easy-poker.ai.tables.v1
```

牌桌配置按 `tableNumber` 分组，避免不同牌桌间误恢复 AI。表结构必须带 `version`，以后变更时可迁移或清理旧数据。

这种加密可以避免在 `localStorage` 中直接看到明文，但不能防御同源 XSS、恶意浏览器扩展或房主主动调试。该安全边界符合当前内部使用场景。

## Agent 运行方式

每个 AI 都有独立的浏览器运行实例：

```js
{
  botId,
  playerId,
  socket,
  snapshot,
  busy,
  lastTurn,
  status,
  abortController
}
```

运行流程：

1. 使用固定 `playerId` 和牌桌密码调用现有 `join`。
2. 如果 AI 尚未坐下：有筹码时以 `buyinCount: 0` 坐下；无筹码时按保存的买入次数坐下。
3. 建立属于该 AI 的游戏 WebSocket。
4. 收到 AI 自己的 snapshot 后，仅在 `actingPlayerId === playerId` 且存在 `legal` 时调用模型。
5. 使用该 AI 关联的模型配置调用 Responses API；不支持时按现有 Agent 行为回退 Chat Completions。
6. 使用现有 `legalMove` 约束模型输出，模型失败时执行安全行动。
7. 再次确认仍是同一手、同一街道和同一行动截止时间，然后通过现有 `action` API 提交。

每个 AI 使用独立的 `busy` 和 `lastTurn`，避免 WebSocket 重复消息触发多次模型调用。模型请求设置 8 秒超时；移除 AI 时通过 `AbortController` 取消未完成请求。

两人 All-in 的发牌次数选择沿用现有 Agent 行为，默认选择一次。

## 刷新与自动恢复

房主页面恢复当前牌桌后：

1. 读取该 `tableNumber` 下的全部 AI 配置。
2. 解密每个 AI 对应的模型配置。
3. 使用原 `playerId` 重新 `join`。
4. 已坐下的 AI 直接重连 WebSocket。
5. 未坐下的 AI 自动执行 `sit`；因此连续三次超时被强制起身后会自动重新加入，刷新后也能恢复。
6. 牌桌已满时保留本地配置并显示“等待空位”，后续状态变化时再次尝试坐下。
7. 游戏桌结束后停止运行实例，但保留模型配置；该桌 AI 不再发起重连。

“是否自动恢复”只由当前桌的本地 AI 配置是否存在决定。服务器中是否仍保留同一玩家记录不影响恢复。

为避免房主同时打开多个标签页并重复控制同一个 AI，使用 `navigator.locks` 按 `tableNumber + botId` 获取独占锁。未获得锁的标签页只展示 AI 列表，不启动对应 Agent。

## 添加与移除

添加 AI：

1. 选择已有模型配置，或先创建模型配置。
2. 输入昵称、水平和买入次数。
3. 生成 `botId`、固定 `playerId` 并立即保存本地配置。
4. 调用 `join`、`sit`，然后连接 AI WebSocket。
5. 没有空位时显示“等待空位”，本地配置仍然保留。

移除 AI：

1. 取消该 AI 尚未完成的模型请求。
2. 断开该 AI 的 WebSocket。
3. AI 仍坐着时调用现有 `stand`；牌局中移除按服务器当前起身/弃牌规则处理。
4. 从当前桌的本地 AI 配置和内存运行实例中删除。
5. 立即从 AI 管理列表消失，刷新后不再恢复。

## 房主范围

第一版不增加服务器端房主权限系统。只有创建牌桌的浏览器在本地记录该桌由自己创建，并显示 Desktop AI 管理入口。这是界面级限制，不是安全授权，适用于当前朋友间内部使用。

AI 本身仍使用现有桌号和密码加入，游戏服务器将其视为普通玩家。以后若开放给不可信用户，再增加服务端 `ownerToken`，不需要修改浏览器 Agent 的核心运行逻辑。

## 限制

- 房主页面必须保持打开；浏览器关闭期间 AI 无法行动并可能超时。
- 模型服务必须允许浏览器跨域请求；CORS、认证或模型配置错误会在 AI 基础状态中显示为“连接异常”。
- 浏览器刷新期间恰好轮到 AI 时，AI 仍可能超时。
- 后台标签页可能被浏览器限速；本功能只保证房主页面正常打开时运行。
- Base URL 只发送到房主选择的模型服务，不经过游戏服务器。

## 代码落点

实施时保持最小拆分：

- 保持 `scripts/agent.mjs` 原样，浏览器 AI 使用独立的最小决策模块，避免影响现有命令行用户。
- 浏览器端新增 AI 配置存储和 Agent 管理模块。
- `public/index.html` 增加 Desktop AI 管理入口及配置弹窗。
- `public/js/app.js` 只负责界面接线，AI 不接入房主的行动区域和点击事件。
- 游戏引擎和 Durable Object 原则上无需修改；只有实际开发发现现有 `join`、`sit`、`stand` 接口不足时再做最小调整。

## 验收标准

- 同一桌可添加多个 AI，并分别选择不同模型配置。
- 同一模型配置可供多个 AI 使用，添加 AI 时无需重复输入 API Key。
- AI 只通过自己的游戏 API/WebSocket 行动，不操作房主界面。
- 刷新后未移除的 AI 使用原身份自动恢复；不在座位时自动重新坐下。
- 已移除 AI 不再出现在列表，也不会刷新恢复。
- AI 详情不泄露手牌、决策、提示词、模型响应或 API Key。
- 多标签页不会同时控制同一个 AI。
- 手机端不显示 AI 管理功能。
