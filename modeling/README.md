# 世界杯完赛场次赔率-结果分析 & 建模

> 目的：基于已完赛的世界杯小组比赛，分析 spf / 让球 / rqspf 赔率与实际结果的对应关系，沉淀出"赛前即可调用"的轻量模型，用来对未开赛场次给推荐（胜平负 + 让球盘路 + 比分 Top-3）。

## ⚠️ 局限性

- **样本极少**：当前仅 **12 场**世界杯正赛完赛样本（M001-M012，来自 `data/matches_status.json` 的 `league === "世界杯"` 标签）。3 场国际赛热身（2040145-2040147，6-09 友谊赛）剔除避免节奏污染，但留档在 `modeling/data/international_warmup.json`。
- 12 场不足以做严格统计建模，**所有"命中率""主胜率"仅作参考倾向**。
- 随着小组赛继续完赛，重跑 `npm run modeling:all` 即可自然扩展样本。
- 模型**不接入 Vite 站点前端**，`predict_unplayed.json` 是独立产物（避免污染构建）。
- **范围硬限制**：训练仅吸收"世界杯正赛"完赛样本（`league === "世界杯"`），预测仅对"世界杯正赛"未完赛场次（M001-M104）出推荐；竞彩开的国际赛热身盘（`league === "国际赛"`）一律忽略。

## 📁 目录结构

```
modeling/
├── data/                       # 建模前提炼数据（用户硬要求 1）
│   ├── 01_matches_with_odds.json
│   ├── 02_feature_records.json
│   ├── 03_implied_probability.json
│   ├── 04_handicap_table.json
│   └── international_warmup.json
├── artifacts/                  # 建模后产物（用户硬要求 2）
│   ├── win_model.json
│   ├── handicap_model.json
│   ├── score_model.json
│   ├── score_top3_sample.json
│   └── predict_unplayed.json
├── scripts/
│   ├── 01_prepare_data.js
│   ├── 02_train_win_model.js
│   ├── 03_train_handicap_model.js
│   ├── 04_train_score_model.js
│   └── 05_predict_unplayed.js
└── README.md                   # 本文件
```

## 🚀 一键跑

```bash
# 全流程：前提炼 → 训练 3 个模型 → 对未开赛出推荐
npm run modeling:all

# 分步
npm run modeling:prepare   # 1：前提炼
npm run modeling:train     # 2：训练 3 个模型
npm run modeling:predict   # 3：对未开赛出推荐
```

零新依赖（只用 Node 内置 `fs` / `path` + 现有 `package.json` 的 ESM）。

## 🔍 输入 / 输出

### 输入（只读）

- `data/matches_status.json` — 全部比赛状态 + 赔率
- `data/results/<mid>.json` — per-mid 完赛结果

### 产物（按 `modeling:all` 顺序产出）

| 文件                          | 类型     | 说明                                                   |
| ----------------------------- | -------- | ------------------------------------------------------ |
| `data/01_matches_with_odds.json` | 原始 + 衍生 | 完赛场次合并后完整记录（含 `derived.*` 衍生特征）      |
| `data/02_feature_records.json`   | 特征     | 25+ 维机器可读特征                                     |
| `data/03_implied_probability.json` | P0 反推 | 赔率 → 市场隐含概率（去 vig）+ 实际命中                 |
| `data/04_handicap_table.json`    | 分组统计 | 按 handicap 档位聚合的实际主胜/走/负率                  |
| `artifacts/win_model.json`       | 模型参数 | 胜平负规则阈值 + 校准命中率 + 信心度映射                |
| `artifacts/handicap_model.json`  | 模型参数 | 让球盘路倾向表 + chase/skip 判定阈值                    |
| `artifacts/score_model.json`     | 模型参数 | Poisson 全局 λ + 三档调系数                              |
| `artifacts/score_top3_sample.json` | 样本回放 | 每场完赛用模型反推的 Top-3 比分（赛后比对用）           |
| `artifacts/predict_unplayed.json` | 预测   | 全部**世界杯正赛**未开赛场次的胜平负 + 让球 + Top-3 比分推荐（国际赛热身忽略）|

## 🧠 模型一览

### 1. 胜平负模型（`win_model.json`）

- **策略**：用 spf 赔率反推市场隐含概率（P0 = 1/odds 归一化），选 p0 最高方向为推荐方向。
- **信心度**：按"赔率最低那个"分 3 档（< 1.5 ⭐⭐⭐ / 1.5-2.5 ⭐⭐ / ≥ 2.5 ⭐）。
- **平局抑制**：平局赔率 < 3.3 时一律不推荐平（样本提示低赔平局假信号多）。
- 规则写在 `win_model.decision_logic.confidence_rules`，predict 脚本直接照搬。

### 2. 让球盘路倾向（`handicap_model.json`）

- **策略**：按 handicap 档位（-3 / -2 / -1 / +1 / +2）查样本主胜率，**主胜率 ≥ 55% 且样本 ≥ 3 场才"chase"，否则 skip**。
- handicap = 0 → not_applicable（等同于 spf）。
- 经验法则字符串写在 `handicap_model.rule_of_thumb`，人工 review 直接看这段。

### 3. 比分 Poisson 模型（`score_model.json`）

- **简化假设**：主客进球独立同分布 Poisson。
- **参数**：
  - 全局 λ_home / λ_away 从 12 场样本均值估算
  - 三档调系数：强队（p0_home > 0.6）λ_home × 1.3 / λ_away × 0.8；弱队反向；均衡保持
- **输出**：跑 0-5 网格归一化，Top-3 高概率比分。

## ✅ 自检 / 验证

`modeling:predict` 跑完会做：
1. **mid 自检**：每条 `predictions[].mid` 必须在 `matches_status.json` 找得到，找不到立即 exit 1（避免幻觉 mid）。
2. **确定性**：3 个训练脚本无随机过程，重跑 `modeling:all` 产物应逐字节一致。

手动抽查：
```bash
# 看推荐 JSON
cat modeling/artifacts/predict_unplayed.json | head -60

# 校验 JSON
node -e "JSON.parse(require('fs').readFileSync('modeling/artifacts/predict_unplayed.json'))"
```

## 🔄 赛后回填（持续扩展）

当 `data/results/` 新增一场完赛结果时：
1. 重跑 `npm run modeling:all` 即可
2. 样本自动扩展，模型参数重新校准
3. `predict_unplayed.json` 自动剔除已开赛场次，只对真正的未开赛出推荐

## 📐 为什么不接 Vite 站点

- `predict_unplayed.json` 是离线分析产物，量级小（< 30 条记录）
- 接入 `js/data.js` 的 import 流会被 Vite 静态打包进前端，污染 dist
- 如果未来要在 `predictions.html` 上展示，把 `predict_unplayed.json` 复制为 `public/assets/predict_unplayed.json`，前端 `fetch` 即可（**不在当前任务范围**）

## 🧪 12 场样本回测基线（2026-06-15 截止）

> 用 `01_matches_with_odds.json` 的 12 场完赛样本 + 同一套 predict 函数做的自测，**只作"基线快照"**，不外推到 100% 命中率。

| 模型          | 命中率       | 样本           | 备注 |
| ------------- | ------------ | -------------- | ---- |
| 胜平负（spf_min_odds 方向）| 4/8 = **50%** | 8 场有 spf（4 场 spf=null 已 skip）| 与市场隐含持平 |
| 让球 chase  | 2/3 = **67%** | 3 场让+1（其他档位样本不足 skip）| 与 chase 阈值 55% 一致 |
| 比分 Top-1   | 2/12 = 17%  | 12 场 | 简版 Poisson 命中率有限，仅作"参考倾向" |
| 比分 Top-3   | 4/12 = 33%  | 12 场 | 同上 |

**重要发现**（样本内的反向价值信号，12 场）：

- 高赔平局（spf.draw ≥ 3.3）命中 3/5 = **60%** —— 平局赔率高时反而真平
- 低赔客胜（spf.away < 4）命中 0/4 = **0%** —— 市场被诱多
- 大热门主胜（spf.home < 1.5）1/1 = 100%（样本太小，参考有限）

这 3 条已写进 `win_model.json.decision_logic.confidence_rules` 与 `verdict_thresholds`。

- **赔率历史**：当前 `data/odds_history/<mid>.json` 没数据（`01_prepare_data` 不会读），所以赔率变动时序特征暂未引入。等 6-15 起有数据后再迭代。
- **跨日模型漂移**：每天赔率有变动，建议每天 18:00 跑一次 `modeling:all` 拿最新推荐。
- **正赛进度**：M001-M012 已完赛（6-11 ~ 6-15 北京时间），M013-M024 已在售未完赛（6-15 ~ 6-18），M025+ 仍未挂盘。当前 12 场样本均为小组赛首轮，淘汰赛风格未采样。
