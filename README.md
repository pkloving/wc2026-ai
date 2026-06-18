# 2026 世界杯 + AI 预测 静态网页

> 静态站点：聚合 2026 美加墨世界杯赛程、比分、积分榜，以及**多 AI 大模型预测与命中统计**。

## 🎯 项目目标

- 展示 2026 世界杯全部 104 场比赛的赛程、比分、积分榜
- 记录我**事先**用 GPT-4o / Claude / Gemini / DeepSeek 等大模型对每场比赛的预测
- 每场比赛结束后 5 分钟内更新比分 + 命中情况
- 通过累计数据，看哪个 AI 最会押比分

## 🛠 技术栈

- **Vite** + 原生 HTML/CSS/JS（多页面）
- **Tailwind CSS** 主题色统一
- **Chart.js** 统计页图表
- 纯静态，**可直接部署到 GitHub Pages / Vercel / Netlify**

## 📁 目录结构

```
wc2026-ai/
├─ index.html / schedule.html / standings.html / results.html
├─ predictions.html / stats.html / teams.html / about.html
├─ match.html?id=Mxxx  (单场详情)
├─ data/             # matches / results / predictions / teams / groups (源数据)
├─ public/assets/predictions/<matchId>/  # AI
├─ js/               # 组件、数据、渲染逻辑
├─ css/main.css      # Tailwind 入口
├─ scripts/          # 数据维护脚本
│  ├─ generate-matches.js   # 一次性：生成 104 场 matches.json
│  ├─ update-result.js      # 更新比赛结果
│  └─ add-prediction.js     # 新增 AI 预测
└─ README.md         # 本文件
```

## 🚀 本地开发

```bash
npm install
npm run dev    # http://localhost:5173/
```

## 📦 部署

```bash
npm run build  # 产物在 dist/
```

把 `dist/` 目录上传到任何静态托管即可。

## 🗓 比赛数据更新流程

> 5 分钟内搞定一场比赛。

### 1. 比赛结束后，录入比分

```bash
node scripts/update-result.js M002 1 1 \
  --scorer=KOR:Son:45:goal \
  --scorer=DEN:Hojlund:78:goal
```

淘汰赛加时 / 点球：

```bash
node scripts/update-result.js M088 1 1 --penalties=4:3
```

### 2. 录入 AI 预测

把AI预测放到 `public/assets/predictions/<matchId>/`

或用脚本自动复制：

```bash
node scripts/add-prediction.js M002 \
  --model=Claude --home=1 --away=1 --winner=draw \
  --prompt="Predict KOR vs DEN" \
```

### 3. 同步到 `predictions.json` 关联

用 `add-prediction.js` 时会自动追加到 `data/predictions.json`。
也可以直接编辑 `data/predictions.json`：

```json
{
  "matchId": "M002",
  "models": [
    {
      "model": "GPT-4o",
      "predictedHome": 2,
      "predictedAway": 0,
      "predictedWinner": "home",
      "screenshots": ["assets/predictions/M002/gpt-1.png"],
      "note": "AI 觉得丹麦边路有伤"
    }
  ]
}
```

### 4. 提交 & 部署

```bash
git add . && git commit -m "update: M002 result" && git push
# 触发 Vercel/GitHub Pages 自动部署
```

## 🧮 命中判定规则

| 情况                            | 标记                |
| ------------------------------- | ------------------- |
| 预测比分 == 实际比分（90 分钟） | ✅ 比分命中（绿色） |
| 胜负方向一致 + 比分不一致       | ⚠️ 胜负命中（金色） |
| 胜负方向不一致                  | ❌ 未中（红色）     |
| 比赛未开赛                      | 灰色 chip           |

淘汰赛以 90 分钟比分判定；点球大战单独展示。

## 🗂 关键数据文件

- `data/matches.json` — 全部 104 场比赛元信息
- `data/results/<matchId>.json` — 比赛结果（比分、半场、进球者、点球），per-mid 单一来源
- `data/predictions.json` — 每场比赛 × 每模型的预测
- `data/teams.json` — 48 队信息（含旗帜、所属足联）
- `data/groups.json` — 12 个小组配置

> 💡 Vite 在构建时会把这 5 个 JSON 直接打包进 JS；`data/results/*.json` 走 `import.meta.glob` 全部打包。**改 data/ 后 Vite 会自动热更新**。

## 🎨 主题色

- 深蓝 `#0B1F3A`（夜场感）
- 金色 `#D4AF37`（冠军）
- 红色 `#E63946`（赛况）
- 绿色 `#0E7C3A`（命中）

## 🐛 已知问题 / 后续优化

- 淘汰赛占位队伍（如 `TBD_R32_1_W`）需在小组赛结束后手动替换为实际晋级队伍
- 球队旗帜用 emoji（受字体影响，少数环境可能显示为方块），后续可换成 SVG
- 当前未做暗色模式（Tailwind dark 变体已就位，一行代码即可开启）

---

## 🤖 站点 AI 助手（v0.1 demo）

站点右下角的 ⚽ 浮窗 = WC2026 AI 预测助手。基于：

- **DeepSeek** 作为主对话模型（可换 V3 / R1）
- **bge-m3**（硅基流动）做 RAG 向量检索，覆盖全部赔率 / 完赛 / 球队 / 建模推荐
- **博查 AI Search** 做联网搜索（伤停 / 首发 / 突发新闻触发）
- 无登录、无计费、demo 阶段

### 1) 配置环境变量

复制 `.env.example` → `.env`，填入三个 key（**不要提交到 git**）：

```bash
cp .env.example .env
# 编辑 .env
DEEPSEEK_API_KEY=sk-...
SILICONFLOW_API_KEY=sk-...
BOCHA_API_KEY=...
```

### 2) 生成 RAG 索引

```bash
npm run embeddings:build
# 产物：data/embeddings/index.json（约 5–10 MB）
```

赔率 / 推荐有更新时重新跑一次。生产环境可挂 Vercel Cron 每天凌晨重建。

### 3) 本地启动

```bash
npm install
npm run chat:dev   # vercel dev，会同时跑前端 + /api/* serverless
# 浏览器打开 http://localhost:3000/
```

> 纯前端用 `npm run dev`（vite）也能跑，但 `/api/chat` 不可用；本地联调必须 `vercel dev`。

### 4) 部署到 Vercel

1. 推到 GitHub，在 Vercel 后台导入项目
2. Settings → Environment Variables，加 3 个 key
3. Build Command 用 `npm run build`（默认），不需要额外配置
4. 部署后访问 `/api/health` 验证三个 key 都识别到

### 5) 架构

```
前端 chatbot.js (SSE 流式) ──POST /api/chat──> Vercel Serverless
                                                  │
                            ┌─────────────────────┼──────────────────────┐
                            ▼                     ▼                      ▼
                  lib/siliconflow.js     lib/rag.js (top-K)     lib/search_decide.js
                  (bge-m3 embedding)     data/embeddings/        lib/bocha.js
                                        index.json (cosine)      (联网搜索触发)
                                                  │
                                                  ▼
                                          lib/deepseek.js
                                          (SSE 流式返回)
```

### 6) 数据流

每次对话：
1. 把用户最后一条问题 embed → 在 `data/embeddings/index.json` 里 cosine 检索 top-6 相关 chunk
2. 关键词检测是否需要联网（伤停/首发/突发/今天/最新…），需要就调博查
3. 把 RAG chunks + 联网结果拼进 system prompt
4. 流式调 DeepSeek → SSE 推回前端 → 边打字边渲染

### 7) 后续变现路线

- v0.1：免费 demo，验证产品 ✅
- v0.2（当前）：**邮箱 OTP 登录 + 按次计费 + 手动发 license key** ✅
- v0.3：跨设备对话同步 + 支付自动化（Creem / Z-pay / 微信）

---

## 💰 v0.2 登录 + 计费 + 限流

### 计费模型（按次，适合短周期事件）

| 套餐 | 价格 | 积分数 | 单价 |
|---|---|---|---|
| 注册即送 | ¥0 | 10 问（首次） | — |
| 体验包 | ¥9.9 | 50 问 | 0.20/问 |
| 标准包 | ¥19.9 | 150 问 | 0.13/问 |
| 进阶包 | ¥49.9 | 500 问 | 0.10/问 |
| 畅聊包 | ¥99 | 1500 问 | 0.066/问 |

- **每条用户消息扣 1 积分**
- **触发联网搜索额外扣 1 积分**（成本高：博查调用 + DeepSeek 上下文增大）
- 余额不足时自动退弹「兑换 license key」面板
- 错误时自动退款（DeepSeek 失败、博查失败等都退）

### 登录流程（OTP，密码都不要）

1. 用户输入邮箱 → POST `/api/auth/send-otp` → Resend 发 6 位验证码
2. 用户输入验证码 → POST `/api/auth/verify-otp` → 自动建账号（首次送 3 问）+ set HTTPOnly cookie
3. 后续请求自动带 cookie 走 session（30 天 TTL）
4. 退出 → POST `/api/auth/logout` → 清 cookie + Redis session

**开发模式**：没配 `RESEND_API_KEY` 时验证码会直接打印到 server 控制台 + 在弹窗里显示出来（不用真发邮件）。

### 限流

- 每用户 **10 条/分钟**（Redis INCR + 60s TTL）
- 全局 **50 并发/秒**
- 超限返回 429

### 支付流程（手动发 key）

1. 用户加你微信 → 转账（¥9.9 / ¥19.9 / ¥49.9 / ¥99 任选）
2. 你在 `/admin.html` 输入 `ADMIN_KEY` 登录后台
3. 后台选「生成 license key」→ 系统生成 `WC26-XXXXXXXXXXXXXXXX`
4. 你把这个 key 发给用户
5. 用户在前端「兑换 license key」输入 → 自动加积分

**或更省事**：直接用后台的「+50」「+100」按钮给指定邮箱充值（不走 key 流程）。

### 配置新增的 4 个 env

```bash
# Resend 邮件（OTP 验证码）
RESEND_API_KEY=re_...

# Upstash Redis（用户/积分/session/限流/license key）
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...

# Admin 后台密码
ADMIN_KEY=任意强密码串
```

Vercel 部署推荐用 Vercel Marketplace 里的 Upstash 集成，自动注入前两个 env。

### Admin 后台

访问 `/admin.html` → 输入 `ADMIN_KEY` → 进入：

- 顶部 4 个统计卡片：总用户 / 7 日活跃 / 总余额 / key 状态
- 用户列表（每行：邮箱 / 余额 / 已用 / 累计充值 / 注册时间 / 最后活跃 + 快捷 +50 / 生成 key 按钮）
- 快速充值：邮箱 + 积分数 → 一键直充
- License key 发放：选积分 → 生成 → 复制给用户
- API 状态：实时显示 `upstash_ok`、所有 key 配置情况

### 出今日推荐单（10 积分/次）

Chatbot 输入框上方有一个金色按钮「📊 出今日推荐（10 积分）」，点一下扣 10 积分让 AI 解读当天 modeling 出的推荐单。

**数据流（Vercel 不跑 modeling）**：
1. 你每天本地跑 `node modeling/scripts/31_tight_anti_value.js <YYYY-MM-DD> --predict`
2. 再跑 `node scripts/build_chat_predict.js <YYYY-MM-DD>` 产出精简版
3. `git add modeling/artifacts/predict_<date>.json modeling/artifacts/chat_predict_<date>.json`
4. `git commit && git push` → Vercel 自动部署
5. 用户点按钮 → `/api/chat` 带 `mode: 'recommend'` → 扣 10 积分 → 读最新 `chat_predict_*.json` → DeepSeek 解读

**为什么不在 Vercel 上跑 modeling**：serverless 没持久文件系统、不能 spawn 长任务、maxDuration 10s；modeling 要写 `artifacts/*.json` + 跑 5-30s。

**daily 流程接入**（`modeling/scripts/run_r013_full.js` 末尾加）：

```js
import { spawnSync } from 'node:child_process';
spawnSync('node', ['scripts/build_chat_predict.js', TODAY], { cwd: PROJECT_ROOT, stdio: 'inherit' });
```

**找不到推荐单时的提示**：API 端返回 404 + 多行友好提示（推荐单通常 17:00 更新 / 可能是当日无未完赛比赛 / 联系站长），**不扣积分**。

**`chat_predict_<date>.json` 结构**（精简后约 1-2KB/4场）：

```json
{
  "date": "2026-06-18",
  "match_count": 4,
  "matches": [{ "code", "home", "away", "kickoff", "handicap", "spf", "rqspf",
                 "picks": [{"play":"比分","pick":"3:0","odds":5.25,"tier":"低赔"}],
                 "reason", "rqspf_direction" }],
  "parlays_3x1": [...],
  "pairs_2x1": [...]
}
```

**`.gitignore` 约定**：`modeling/artifacts/*` 全 ignore，但 `predict_*.json` 和 `chat_predict_*.json` 白名单进 git。其余 `backtest_*` / `*_model.json` / `roi_insights.json` 现场跑就行。

### Redis key 约定（方便排查）

```
user:{email}                    JSON {email, createdAt, lastSeenAt, totalSpent, totalGranted}
credits:{email}                 int 余额
used:{email}                    int 累计消耗
freebie_granted:{email}         "1"
otp:{email}                     JSON {code, expiresAt, attempts}    TTL 5min
session:{token}                 JSON {email, createdAt, lastSeenAt}  TTL 30d
lic:{key}                       JSON {credits, used, usedBy, ...}    TTL 180d
rl:u:{email}:{minute}           int 限流计数                         TTL 60s
rl:g:{second}                   int 全局限流                         TTL 1s
```

### 本地测试 v0.2

```bash
# 1. 填 .env（4 个新 key）
cp .env.example .env
# 编辑填入 RESEND_API_KEY / UPSTASH / ADMIN_KEY

# 2. 起服务
npm run chat:dev

# 3. 浏览器
# 普通用户：http://localhost:3000 → 点 ⚽ → 邮箱登录
# 管理后台：http://localhost:3000/admin.html → 输入 ADMIN_KEY
# 健康检查：http://localhost:3000/api/health
```

---

本项目是个人非商业兴趣项目，仅作为 2026 世界杯期间的学习与娱乐记录。
