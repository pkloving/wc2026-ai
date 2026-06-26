# 计划：2026 世界杯完赛场次赔率-结果分析与建模

## 1. Summary（做什么）

针对 `data/matches_status.json` 中**已完赛**的世界杯/热身赛小组比赛，提取赔率特征（spf + 让球 handicap + rqspf）与实际比分，半自动地：

1. **胜平负三选一预测模型**：从 spf 赔率反推市场隐含概率 P0，用样本校准 P0 → P 的偏移，作为推荐档位（⭐-⭐⭐⭐）。
2. **让球盘路倾向分析**：按 handicap 档位（让-1 / 让-2 / 让-3 / 让+1 / 让+2）分组统计实际胜率，给后续"该不该追让球盘"提供经验倾向。
3. **比分概率分布**：用 Poisson 简化模型（独立同分布进球率），从赔率反推 λ_home、λ_away，输出 Top-3 比分概率。

三套产物均以 **JSON 模型参数** 落盘，**Node 脚本** 可在赛前对 `matches_status.json` 中尚未开赛的 19+ 场比赛跑出推荐。完全契合项目现有 Vite + 原生 JS 栈，不引入新依赖。

**目录原则**（用户硬要求）：
- `modeling/data/`  ← 建模前提炼的**数据**（原始 + 特征 + 统计）
- `modeling/artifacts/` ← 建模后**产物**（模型参数 + 对未开赛场次的推荐）

## 2. Current State Analysis（已摸清的事实）

- **数据现状**
  - `data/matches_status.json` 32 场比赛，**finished 11 场 + in_progress 1 场 + 未开赛 20 场**（含 3 场国际赛热身 2040145-2040147 + 8 场"世界杯"标签 6-12 起）
  - 完赛结果在 `data/results/<mid>.json`（per-mid 拆分，Vite glob 读）
  - `data/matches.json` 104 场世界杯正赛模板（M001-M104），目前全 `scheduled`
  - **样本量 11 场**（如剔除 3 场国际赛剩 8 场）—— 统计意义极弱，模型只能给"参考倾向"，README 必须醒目说明
- **技术栈**
  - Vite 6 + 原生 JS（多页静态站）
  - `scripts/*.js` 已统一 ESM 风格（`import fs/path from 'node:fs'`）
  - 无 Python / 无 sklearn
  - `chart.js` 已在前端（统计页用过），可视化能力具备
- **既有约定**
  - mid 编码：sporttery 用 `2040xxx`，项目用 `M001-M104`，两者一一对应（已交叉验证：M001=MEX vs RSA=2040162）
  - 数据更新走 `scripts/update-result.js`（半场比分 + 进球者必填红线）
  - 风控/凯利思路已在 `每日执行.md` §0 沉淀
- **关键不变量**
  - `predict_unplayed.json` 的 mid 必须能在 `matches_status.json` 找到，避免幻觉
  - 模型 JSON 必须是 deterministic（无随机种子漂移），CI 可复跑
  - 不可破坏 `data/results/` 已有 11 场数据

## 3. Proposed Changes（具体改动）

### 3.1 目录骨架（一次性创建）

```
modeling/
├── data/                       # 建模前提炼数据（用户硬要求 1）
│   ├── 01_matches_with_odds.json   # 11 场 finished 比赛 = status 字段 + 赔率 + 结果 合并
│   ├── 02_feature_records.json     # 机器可读特征（每场 → 25+ 维）
│   ├── 03_implied_probability.json # 赔率 → P0 反推（含 vig 去除）
│   └── 04_handicap_table.json      # 按 handicap 分组的实际盘路结算表
├── artifacts/                  # 建模后产物（用户硬要求 2）
│   ├── win_model.json             # 胜平负模型参数
│   ├── handicap_model.json        # 让球盘路倾向参数
│   ├── score_model.json           # 比分 Poisson 模型参数
│   └── predict_unplayed.json      # 19 场未开赛场次的推荐（主入口产物）
├── scripts/                    # 5 个顺序执行脚本
│   ├── 01_prepare_data.js
│   ├── 02_train_win_model.js
│   ├── 03_train_handicap_model.js
│   ├── 04_train_score_model.js
│   └── 05_predict_unplayed.js
└── README.md                   # 输入/输出/调用方式/局限性
```

外加 `package.json` 新增 4 个 npm scripts（与现有 `update:result` / `update:prediction` 风格一致）：

```jsonc
"modeling:prepare":   "node modeling/scripts/01_prepare_data.js",
"modeling:train":     "node modeling/scripts/02_train_win_model.js && node modeling/scripts/03_train_handicap_model.js && node modeling/scripts/04_train_score_model.js",
"modeling:predict":   "node modeling/scripts/05_predict_unplayed.js",
"modeling:all":       "npm run modeling:prepare && npm run modeling:train && npm run modeling:predict"
```

### 3.2 `scripts/01_prepare_data.js`（前提炼）

**输入**：`data/matches_status.json` + `data/results/*.json`（Vite glob 静态 import 不便，用 `fs.readdirSync` 读）

**逻辑**：
1. 过滤 `matches_status.json.matches` 保留 `status === "finished"`
2. 跨联赛过滤：默认只取 `league === "世界杯"`，但把 3 场国际赛也保留为 `international_warmup.json`（独立文件，不进主建模）
3. 合并 `data/results/<mid>.json` → 加 `final_score` 字段（已有 `homeScore` / `awayScore`）
4. 解析 `kickoff` 时间 → ISO 标准化
5. 计算衍生特征：
   - `spf_implied`：1/odds 三个方向，vig 归一化后 `p0_home / p0_draw / p0_away`
   - `rqspf_implied`：让球后同上
   - `actual_winner`：home/away/draw
   - `actual_handicap_result`：让球后主队（赢/走/输）
   - `score_diff`、`total_goals`
   - `odds_movement`：暂用 `scraped_at` 单点（无 history 文件时，置 `null`）

**输出 4 个文件**到 `modeling/data/`：
- `01_matches_with_odds.json`：11 场完整记录（id, code, league, home, away, kickoff, handicap, spf, rqspf, final, derived）
- `02_feature_records.json`：11 场特征向量（每场 25+ 维，便于人工 review）
- `03_implied_probability.json`：每场 P0 三方向 + vig% + 实际命中
- `04_handicap_table.json`：按 handicap 分组聚合（让-1 / 让-2 / 让-3 / 让+1 / 让+2）

### 3.3 `scripts/02_train_win_model.js`（胜平负模型）

**输入**：`modeling/data/03_implied_probability.json`

**逻辑**（极简 + 可解释）：
1. 对每场：把 spf 的 `p0_home` / `p0_draw` / `p0_away` 与 `actual_winner` 对照
2. 算"赔率最高赔率方向"的命中率（市场热门 vs 实际）
3. 算"赔率第二高赔率方向"的命中率
4. 用样本校准每方向的"赔率隐含概率"→"实际频率"偏差：
   - 11 场太少不拟合缩放系数，改用**软阈值 + 信心度**（⭐-⭐⭐⭐）
5. 模型公式（落盘）：
   ```json
   {
     "model_type": "rule_based_with_confidence",
     "rules": {
       "fav_threshold": 1.5,        // 最低赔率 < 1.5 视为大热门
       "dog_threshold": 4.0,        // 最高赔率 > 4 视为大冷门
       "draw_threshold": 3.3        // 平局赔率 < 3.3 不推荐平
     },
     "calibration": {
       "home_fav_hit_rate": 0.85,   // 11 场样本统计
       "draw_hit_rate": 0.25,
       "away_dog_hit_rate": 0.10
     },
     "confidence_mapping": {
       "strong_fav": 3,             // ⭐⭐⭐
       "moderate": 2,               // ⭐⭐
       "long_shot": 1               // ⭐
     }
   }
   ```

**输出**：`modeling/artifacts/win_model.json`

### 3.4 `scripts/03_train_handicap_model.js`（让球盘路）

**输入**：`modeling/data/04_handicap_table.json`

**逻辑**：
1. 按 handicap 值分组（-3 / -2 / -1 / 0 / +1 / +2 / +3）
2. 每组统计：
   - 样本数
   - 让球后主队胜率（actual_handicap_result = "home_win" 的占比）
   - 让球后走盘率
   - 让球后主队输率
3. 落盘：
   ```json
   {
     "by_handicap": {
       "-1": { "n": 7, "home_win_rate": 0.43, "draw_rate": 0.14, "home_lose_rate": 0.43 },
       "+1": { "n": 3, "home_win_rate": 0.67, "draw_rate": 0.00, "home_lose_rate": 0.33 }
       // ... 其他档位样本不足置 null
     },
     "rule_of_thumb": "让-1 在 11 场样本中主胜 43%，低于 P0 隐含的 60%+，样本提示让-1 偏深"
   }
   ```

**输出**：`modeling/artifacts/handicap_model.json`

### 3.5 `scripts/04_train_score_model.js`（比分 Poisson）

**输入**：`modeling/data/01_matches_with_odds.json` + `data/results/`

**逻辑**（独立同分布 Poisson，简化版）：
1. 聚合 11 场进球数：home_goals_total / n、away_goals_total / n
2. 估算全局 λ_home_avg、λ_away_avg
3. 按"赔率热门"加权：
   - 强队（p0_home > 0.6）λ_home *= 1.3, λ_away *= 0.8
   - 弱队（p0_home < 0.3）λ_home *= 0.8, λ_away *= 1.2
   - 均衡（0.3-0.6）保持 λ
4. 落盘参数：
   ```json
   {
     "model_type": "poisson_independent",
     "global_lambda_home": 2.0,
     "global_lambda_away": 1.1,
     "tier_adjustment": {
       "strong_fav": { "home_mult": 1.3, "away_mult": 0.8 },
       "balanced":   { "home_mult": 1.0, "away_mult": 1.0 },
       "weak_fav":   { "home_mult": 0.8, "away_mult": 1.2 }
     },
     "score_grid_max": 5
   }
   ```
5. **可选**：落 `top3_per_match.json` 辅助表（每场 Top-3 比分概率，赛后比对用）

**输出**：`modeling/artifacts/score_model.json` + `modeling/artifacts/score_top3_sample.json`（11 场样本上的回放）

### 3.6 `scripts/05_predict_unplayed.js`（对未开赛场次出推荐）

**输入**：
- `modeling/artifacts/{win_model,handicap_model,score_model}.json`
- `data/matches_status.json` 过滤 `status !== "finished"` 的场次（19+ 场）

**逻辑**（每场未开赛做三件事）：
1. **胜平负推荐**：用 win_model 规则打分 → 输出 1 个主推方向 + 信心度
2. **让球盘路推荐**：查 handicap_model 同档位历史命中率 → 输出"追/不追"建议
3. **比分 Top-3**：用 score_model Poisson 算前 3 高概率比分

**输出**：`modeling/artifacts/predict_unplayed.json`
```json
{
  "generated_at": "ISO",
  "input_count": 19,
  "predictions": [
    {
      "mid": "2040192",
      "code": "周一014",
      "home": "比利时",
      "away": "埃及",
      "handicap": -1,
      "recommendations": {
        "win": { "pick": "home", "confidence": 3, "rationale": "主胜赔率 1.42 远低于 1.5 大热门线" },
        "handicap": { "verdict": "skip", "reason": "让-1 在 7 场样本中主胜率 43% 偏低" },
        "score_top3": [
          { "score": "2-0", "prob": 0.142 },
          { "score": "1-0", "prob": 0.118 },
          { "score": "2-1", "prob": 0.097 }
        ]
      }
    }
    // ... 共 19 场
  ]
}
```

### 3.7 `modeling/README.md`

包含：输入数据源、4 步流水线说明、模型局限性（11 场样本警告）、如何调用 npm scripts、如何对 `predict_unplayed.json` 做赛后回填（结果出来后追加到 `modeling/data/backtest.json`）。

## 4. Assumptions & Decisions（关键决策点）

1. **样本量诚实标注**：11 场不足以做严格统计建模，README 必须顶部警告，模型仅作"参考倾向"非"投资决策"。
2. **剔除国际赛**：3 场 `league=国际赛` 不进主模型（避免"热身赛节奏"污染世界杯特征），但保留为 `data/international_warmup.json` 留档。
3. **无 ML 库**：纯规则 + 统计，不引入 `ml.js` 等第三方（保持 0 新依赖）。
4. **确定性输出**：所有脚本无随机过程，`predict_unplayed.json` 可逐字节复跑。
5. **不破坏现有**：不修改 `data/matches.json` / `data/matches_status.json` / `data/results/`，**只读**。
6. **不接入 Vite 站**：`predict_unplayed.json` 是独立产物，不进 `js/data.js` 的 import 流（避免污染前端构建）。后续如需前端展示可另开任务。
7. **赛后回填通道**：README 写明"当一场未开赛变 finished 后，重新跑 `npm run modeling:all` 即可自然把该场纳入下版本训练"。

## 5. Verification Steps（怎么验证）

执行顺序：
1. `npm run modeling:prepare` → 检查 `modeling/data/` 4 个 JSON 都有，且条数 = 11
2. `npm run modeling:train` → 检查 `modeling/artifacts/win_model.json` 等 3 个产物存在
3. `npm run modeling:predict` → 检查 `modeling/artifacts/predict_unplayed.json` 存在，`predictions.length >= 19`，每条 `mid` 都能在 `matches_status.json` 找到
4. **自检**：
   - 跑 `node -e "JSON.parse(require('fs').readFileSync('modeling/artifacts/predict_unplayed.json'))"` 不报错
   - 抽 3 场人工核对：spf 1.42 主胜 + 让-1 + Poisson 2-0 是否合理
   - 把 11 场 finished 喂回 `predict_unplayed`（加状态反转测试），看胜平负命中率是否在 70%+
5. **回归**：重跑 3 遍 `modeling:all` 产物必须完全一致（确定性强校验）

## 6. Out of Scope（明确不做）

- 不引入 Python / sklearn
- 不训练神经网络/集成树
- 不接入站点前端（`predict_unplayed.json` 是离线产物）
- 不做赔率历史时序（`odds_history/<mid>.json` 当前没数据，等未来累积再做）
- 不做交叉验证（11 场无 fold 意义）
- 不做 ROI 回测（需要 `bets.json` 与 `predict_unplayed.json` 时间对齐，复杂度高，留待未来）
