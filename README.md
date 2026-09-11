# Easy Poker

多人在线德州扑克（长牌现金桌）。**前端 Worker** 托管页面，**API Worker** 托管游戏权威服务和 WebSocket，用 Durable Object 作为每一张游戏桌的实时房间。两个 Worker 分开部署。

## 功能

- 最多 8 人，两人坐下即可开局，结束前可随时观战或坐下
- 创建桌时可设时长（30 分钟 / 1 小时 / 2 小时 / 4 小时 / 8 小时）、无限或有限 buy-in、是否允许 straddle、鱿鱼游戏、27 杂色奖励
- 用邀请链接或「桌号 + 密码」拉人
- 无需注册：本地生成唯一玩家标识，昵称可点「随机名」
- 标准德州长牌：翻牌前 / 翻牌 / 转牌 / 河牌，边池，10 秒超时视为弃牌（最后 5 秒滴答提示）
- 筹码只在本桌有效；起身再坐下筹码保留。补码随时可点，下一手开始时到账；输光的玩家不参与下一手直到补码
- 两人 All-in 时可协商发一次或发两次公共牌（默认发一次）
- 桌局结束后只展示结算，不能重开
- 横屏桌面与竖屏手机两套布局，发牌/行动动画与音效

## 本地运行

需要 Node.js 22+。

```bash
npm install
npm test
npm run dev
```

浏览器打开 `http://localhost:8787`（前端）。API 在 `http://127.0.0.1:8789`。

## 测试

```bash
npm test
```

测试直接 `import` `src/engine` 里上线用的牌局引擎（不是拷贝或 mock）。

## 部署

两个 Worker：`easy-poker`（前端）和 `easy-poker-api`（API + 牌桌）。见 [docs/deploy.md](docs/deploy.md)。架构见 [docs/architecture.md](docs/architecture.md)。

远程仓库：`git@github.com:xrdavies/easy-poker.git`
