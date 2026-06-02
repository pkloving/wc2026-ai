# 2026 世界杯 + AI 预测 静态网页

> 静态站点：聚合 2026 美加墨世界杯赛程、比分、积分榜，以及**多 AI 大模型预测聊天记录**的留档与命中统计。

## 🎯 项目目标

- 展示 2026 世界杯全部 104 场比赛的赛程、比分、积分榜
- 记录我**事先**用 GPT-4o / Claude / Gemini / DeepSeek 等大模型对每场比赛的预测（包括聊天截图）
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
├─ public/assets/predictions/<matchId>/  # AI 聊天截图（手工上传）
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

### 2. 上传 AI 预测截图

把聊天记录截图放到 `public/assets/predictions/<matchId>/`，例如：

```
public/assets/predictions/M002/
├─ gpt-1.png
├─ claude-1.png
└─ deepseek-1.png
```

或用脚本自动复制：
```bash
node scripts/add-prediction.js M002 \
  --model=Claude --home=1 --away=1 --winner=draw \
  --prompt="Predict KOR vs DEN" \
  --shot=~/Desktop/screenshots/claude-kor-den.png
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
      "prompt": "请预测韩国 vs 丹麦",
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

| 情况 | 标记 |
|---|---|
| 预测比分 == 实际比分（90 分钟） | ✅ 比分命中（绿色） |
| 胜负方向一致 + 比分不一致 | ⚠️ 胜负命中（金色） |
| 胜负方向不一致 | ❌ 未中（红色） |
| 比赛未开赛 | 灰色 chip |

淘汰赛以 90 分钟比分判定；点球大战单独展示。

## 🗂 关键数据文件

- `data/matches.json` — 全部 104 场比赛元信息
- `data/results.json` — 比赛结果（比分、进球者、点球）
- `data/predictions.json` — 每场比赛 × 每模型的预测 + 截图路径
- `data/teams.json` — 48 队信息（含旗帜、所属足联）
- `data/groups.json` — 12 个小组配置

> 💡 Vite 在构建时会把这 5 个 JSON 直接打包进 JS，所以**改 data/ 后 Vite 会自动热更新**。

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

本项目是个人非商业兴趣项目，仅作为 2026 世界杯期间的学习与娱乐记录。
