# Easy Poker × 2d-engine 交接

给后续在 ChatGPT / 其他助手上继续优化用。读完应能独立改前端和引擎，不必翻旧对话。

## 先分清：两个 git 仓库，两条功能分支

Easy Poker **游戏产品** 和 **2d-engine 引擎** 不是同一个仓库。

| | Easy Poker | 2d-engine |
|---|---|---|
| 路径 | `/Users/r001/projects/easy-poker` | `/Users/r001/projects/engine` |
| 磁盘别名 | — | `/Users/r001/projects/2d-engine` → 上面这个目录的 **symlink** |
| npm 名 | `easy-poker` | `@xrdavies/2d-engine` |
| **当前工作分支** | **`feat/2d-engine-frontend`** | **`feat/scene-ui`** |
| `main` 上最后一笔扑克提交 | `2426866` 把 `shuffle.m4a` 改名为 `shuffle-1.m4a` | 引擎 `main` 不含本次 UI 原语 |

Easy Poker 的 `package.json` 依赖是 `"@xrdavies/2d-engine": "file:../2d-engine"`。Vite 同样 alias 到 `../2d-engine`。所以：

- **扑克画面、规则对接、音效表、大厅/牌桌逻辑** → 只改 `easy-poker` 的 `feat/2d-engine-frontend`
- **引擎缺能力**（新图元、缓动、点击、文本、音频 API）→ 改 `engine` 的 `feat/scene-ui`，然后在引擎目录 `npm test && npm run build`，扑克这边才会吃到 `dist/`

不要把引擎改动提交进 easy-poker 仓库，也不要把扑克改动提交进 engine 仓库。

## 产品与本次目标

Easy Poker：Cloudflare Workers 上的 8 人长牌德州现金桌。权威在 API Worker + Durable Object，**不要把 `src/engine` / `TableDO` 改写成前端**。

本次（已落地的方向，后续优化沿这条走）：

1. 浏览器里玩家看见的游戏画面用自研 **2d-engine** 画（大厅、牌桌、座位、牌、行动栏、摊牌、结算、补码弹层）。
2. 音效、发牌缩放等动画走引擎（`AudioManager`、`tweenValue` / `easeOutBack`）。
3. 引擎缺什么就在 **引擎仓库新分支** 补，不要在扑克里再造一套渲染器。
4. 行为对齐替换前的 HTML 版：昵称门、创建/加入（桌号+密码或 `?t=&p=`）、8 座、合法行动、本手结算（含超时弃牌）、邀请复制、横屏桌面 + 竖屏手机、现有 SFX 文件名。

像素级复刻旧 CSS **不是** 目标。

## 当前状态（2026-09-13）

### 已经做到

- 扑克分支基线：`3394f75 feat: draw the whole table in 2d-engine`（本次资源迁移仍在工作树）
- 引擎分支 HEAD：`b00c137 feat: add retained UI primitives and image upload usage`
- 页面几乎只有一块全屏 `#game-canvas`。大厅/牌桌/结算都是 `PokerScene` 每帧用 `Renderer2D` 画 textured quad。
- 旧 HTML 渲染器已删：`client/src/overlay.ts`、`table-surface.ts`、`table-engine.ts`、独立 `public/js/app.js`。
- 音效：`PokerSfx` → `AudioManager.load('/sounds/*.m4a')`。文件在 `public/sounds/`。洗牌是 `shuffle-1` … `shuffle-5`，没有 `shuffle.m4a`；可预生成的 UI/牌桌美术在 `public/assets/*.png`，由 `npm run art` 从 SVG 源生成。
- 网络：`HttpClient` + `WebSocketTransport`（`client/src/net.ts`）。
- 本地 `npm test`：扑克 40、引擎 80（引擎改过后要再跑引擎测试）。

### 故意留下的 DOM

中文 IME 不能靠 WebGPU 自己做。`#ime-root` 里四个原生 `<input>`，由 `UIBridge` 对齐到引擎画的输入框：

- `#ime-nick` 昵称
- `#ime-table` 桌号
- `#ime-pass` 密码
- `#ime-buyin` 买入次数

按钮、座位、牌、标签 **不是** HTML。不要为了「更好看」把座位/行动栏加回 DOM。

无 WebGPU 时 `body.engine-fallback`，`#ime-root` 显示「需要 WebGPU 才能运行 Easy Poker」。没有 Canvas2D 整桌回退。

### 引擎这次补了什么

都在 `engine` 的 `feat/scene-ui`：

| API | 文件 | 用途 |
|---|---|---|
| `createSolidTexture` / `solidTextureBytes` / `AssetManager.uploadImage` | `src/render2d/texture.ts` / `src/assets/manager.ts` | 1×1 白贴图、预生成图片上传 |
| `Shape2D` | `src/render2d/shape.ts` | 染色方块（白贴图 × color） |
| `Tween` / `TweenPlayer` / `tweenValue` / `easeOut*` | `src/animation/tween.ts` | 发牌缩放等 |
| `hitTest` / `rectContains` / `HitRect` | `src/ui/hit.ts` | 点按钮 |
| `canvasCssSize` | `src/core/engine.ts` | 隐藏 canvas 不要用 drawing buffer 尺寸（避免 1280×720 swapchain 盖住页面） |

`GPUTextureUsage` 不能写在模块顶层：Node 单测环境没有该全局，要放进函数里。

改引擎后 **必须** `cd /Users/r001/projects/engine && npm run build`。Vite 走 package `exports` → `dist/index.js`，只改 `src/` 扑克构建吃不到。

## 路径与数据流

```
浏览器
  client/index.html          全屏 canvas + ime-root
  client/src/main.ts         Engine.create → PokerScene + PokerSession
  client/src/scene.ts        每帧绘制 + hitTest 点击
  client/src/session.ts      快照、WS、SFX、发牌队列（无 DOM）
  client/src/painter.ts      rect / disc / label / button / card
  client/src/assets.ts       预生成图片资源、牌图集 UV、绒面几何布局
  client/src/sfx.ts          AudioManager
  client/src/net.ts          /config.json → apiOrigin；HTTP/WS
        │
        ▼ vite build → public/index.html + public/js/game.js
        │
  前端 Worker easy-poker     wrangler.web.toml  :8787  ASSETS=./public
        GET /config.json → { apiOrigin: http://127.0.0.1:8789 }
        │
  API Worker easy-poker-api  wrangler.toml      :8789  TableDO
        POST /api/tables | /api/join | /api/cmd
        GET  /ws  → 同一 DO
        └─ src/table-do.ts → src/engine/*   ← 牌局权威，前端只发行动
```

邀请链接永远是 **前端域名** `/?t=桌号&p=密码`。

玩家 id：`localStorage ep.id`（uuid）。昵称 `ep.nick`。当前桌 `ep.table`。

## 前端模块怎么分工

- **`PokerSession`**：屏幕 `lobby | table | settle`；创建/加入/坐下/行动/补码/离开；`applySnapshot`；发牌队列 220ms；超时 tick SFX（仅自己行动且 ≤5s）；摊牌 win/lose。
- **`PokerScene`**：`EngineSystem`。`update` 里脉冲；`render` 里按 session 重画；`engine.input.onInput` 做 pointer hit。点击 id：`tab:*` `dur:*` `toggle:*` `btn:*` `act:*` `runout:*` `buyin:*` `slider` `maxbuyin:+/-`。
- **座位**：`PORTRAIT_SEATS` / `LANDSCAPE_SEATS` 是相对绒面的百分比。自己坐下后座位旋转，自己在 vis=0（底边）。
- **牌**：`scripts/generate-art.mjs` 预生成 52 张 + 牌背图集 PNG，`assets.ts` 只维护 UV。`shownHoles` / `shownBoard` 带 `at` 时间戳，缩放 `tweenValue(0.65|0.7, 1, t, easeOutBack)`。
- **绒面**：按像素尺寸 + 横竖屏烘焙一张 GPU 贴图，不是 CSS。

调试：`window.__EASY_POKER_USES_2D_ENGINE`、`window.__easyPokerEngine`、`window.__easyPokerSession`。

## 怎么跑

需要 Node 22+。

```bash
# 扑克
cd /Users/r001/projects/easy-poker
git checkout feat/2d-engine-frontend
npm install          # 依赖 file:../2d-engine
npm test             # 先 vite build，再 node --experimental-strip-types --test test/*.test.ts
npm run dev          # vite --watch + wrangler web :8787 + api :8789
# 打开 http://127.0.0.1:8787

# 引擎（改了 src/ 才需要）
cd /Users/r001/projects/engine
git checkout feat/scene-ui
npm test             # vitest，80+ 条
npm run build        # 写出 dist/，扑克才能用到
```

`npm run dev` 被 10h 上限杀掉后，`.wrangler/state/**/*.sqlite-wal|shm` 可能留下 `SQLITE_BUSY_RECOVERY`。删掉 `*-wal`/`*-shm`（不要删 `.sqlite` 本体）再启。

健康检查：`GET :8787/health` → `easy-poker-web`；`GET :8789/api/health` → `easy-poker-api`；`GET :8787/config.json` → `{ apiOrigin }`。

Node 测试是 **strip-types only**：class 构造器不要写 `constructor(readonly x: T)`，会直接 SyntaxError。改成先声明字段再赋值（见 `session.ts`）。

根目录那些未跟踪的 `page-*.png` / `*-desktop.png` 是旧 QA 截图，**不要提交**。

## 不要动

- `src/engine/*`、`src/table-do.ts` 的规则、超时、边池、run-it-twice、补码到账时机。前端只消费 `snapshot`。
- 把 UI 迁去 Cloudflare Pages。
- 为「引擎化」再写一套脱离 `@xrdavies/2d-engine` 的 WebGL/Canvas 渲染器。
- 恢复 `overlay.ts` 那种座位/牌 DOM。

## 已知缺口（优先优化这些）

按手感，不是按文件名：

1. **点击仍需真机复核**
   引擎按钮靠 canvas `pointerdown` + `hitTest`，按钮命中有 3px 容错，滑条使用 pointer capture，canvas 关闭浏览器 touch gesture。仍建议在真实触屏设备复核创建、标签页和滑条。

2. **动画仍可增强**
   已有发牌缩放、筹码飞向底池、行动按钮按压和座位 acting 光圈；摊牌面板目前直接出现，后续若需要入场动画应继续使用引擎 `Tween` / `TweenPlayer`，不要加回 CSS `@keyframes`。

3. **视觉仍需浏览器复核**
   当前已补齐花色颜色、圆角/描边控件、预生成背景/绒面/牌图集、桌面/手机比例、摊牌遮罩与牌背纹理；中文 `Text2D` 清晰度和移动端文案仍可能需要真机微调。旧参考在未提交的 QA 图和（仍存在的）`public/css/app.css`——那份 CSS **已不挂到页面上**，只当视觉备忘。

5. **无 WebGPU**  
   现在只有一行字。要不要 Canvas2D 降级由产品定；不要 silently 画一套 DOM 牌桌。

6. **引擎 UI 基础层已补齐**
   `UIRoot` / `UIContainer` / `UILabel` / `UIImage` / `UIButton` 位于 `engine/src/ui/components.ts`，通过 `UIRenderer` 适配器交给 Renderer2D/Text2D；按钮支持 disabled、pressed、pointer cancel 和 click。复杂布局/主题仍由产品层决定。

## 测试约定

扑克：

- `test/engine.test.ts`：服务端牌局，import 真正的 `src/engine`。改前端一般不用动。
- `test/client-engine.test.ts` / `test/ui-source.test.ts`：断言 **没有** `overlay.ts`，HTML **没有** `#gate` / `.dock` / `#seats`，scene 里有 `hitTest` / `tweenValue` / `act:fold` 等。改绘制时同步这些断言，不要为了过测把 overlay 加回去。

引擎：`npm test`（vitest）。改了 `src/` 再 `npm run build`。

## 规则速查（前端必须遵守的行为）

- 最多 8 座；2 人坐下开局。
- SB=1，BB=2；买入 `N × 100 BB`。
- 行动钟 10s：能 check 就 check，否则 fold；自己行动最后 5s 播 `tick`。
- 补码记 pending，下一手开始到账；筹码 0 且未补码不发牌。
- 两人 all-in 且公共牌未发完：5s 投票发一次/两次，默认一次。
- 摊牌文案「本手结算」；超时走 `lastResult.timeoutIds`。
- SFX 文件名：`fold` `check` `bet-1..3` `allin` `deal` `shuffle-1..5` `tick` `win` `lose`。

HTTP/WS 形状以 `src/index.ts` + `src/table-do.ts` 为准，不要臆造字段。
