# 世界杯赔率策略建模（31 号策略 + 持续拟合）

> 目的：基于已完赛的世界杯正赛，提炼"赛前即可调用"的轻量**赔率策略**，对未开赛场次出推荐（主池比分 + 单关 + 让球胜平负/总进球/半全场跟投 + 2串1/3串1 组合）。
>
> 当前主模型 = **31 号策略**（F4 混合主池 + 反方向单关 + RQSPF/ZJQ/BQC 赔率纠偏）。策略阈值不再人肉硬编码，而是由 `33_fit_strategy.js` 用全量回测**持续拟合**。

## ⚠️ 局限性

- **样本极少**：当前约 **24 场**世界杯正赛完赛样本（`data/settled_matches.json`，`league === "世界杯"`）。国际赛热身剔除、留档在 `modeling/data/international_warmup.json`。
- 样本不足以做严格统计建模，所有命中率/ROI **仅作参考倾向**；拟合用收缩 + 接受阈值抗过拟合，但仍需人工复核小样本桶。
- **范围硬限制**：只吸收"世界杯正赛"完赛样本，只对"世界杯正赛"未完赛场次（M001-M104）出推荐；国际赛热身盘一律忽略。
- 随小组赛继续完赛，重跑 `npm run modeling:all` 自然扩展样本并重拟合。

## 📁 目录结构

```
modeling/
├── data/
│   └── international_warmup.json        # 国际赛热身留档（不参与训练）
├── artifacts/                           # 产物
│   ├── strategy_params.json             # 33_fit 拟合出的策略参数（31 启动加载）
│   ├── roi_insights.json                # 32 提炼的分桶 ROI 规律
│   ├── predict_31_<日期>.json           # 31 预测主产物
│   ├── chat_predict_<日期>.json         # 喂 DeepSeek 的精简版（scripts/build_chat_predict.js 产）
│   └── tuning_log.md                    # 历史调参记录
├── scripts/
│   ├── strategy_core.js                 # 单一源：参数 + 搜索空间 + 全部策略函数 + 球队/样本加载
│   ├── 31_tight_anti_value.js           # 主模型：predict / backtest
│   ├── 32_roi_insights.js               # 分桶 ROI 规律提炼（31 启动时自动跑）
│   └── 33_fit_strategy.js               # 持续拟合：坐标下降扫参数 → strategy_params.json
└── README.md
```

> 旧 ML 管线（01_prepare_data / 02-04_train_* / 05_predict_unplayed / 06_recommend_parlays / 07_backtest）及 09-30 的一次性实验脚本、r013 已于 2026-06-18 清理，不再使用。

## 🚀 一键跑

```bash
# 全流程：拟合策略参数 → 对未开赛出推荐
npm run modeling:all          # = 33_fit_strategy.js && 31_tight_anti_value.js --predict

# 分步
npm run modeling:fit          # 拟合，写 strategy_params.json（--dry-run 只看不写）
npm run modeling:predict      # 加载参数，对未开赛出推荐
npm run modeling:fit:backtest # 用当前参数跑历史回测看 ROI
```

> ⚠️ `npm run` 在本机会走 WSL 报错，直接 `node modeling/scripts/33_fit_strategy.js && node modeling/scripts/31_tight_anti_value.js --predict`。

零新依赖（只用 Node 内置 `fs` / `path` + ESM）。

## 🔍 输入 / 输出

### 输入（只读）

- `data/odds/<mid>.json` — 各玩法最新赔率（spf/rqspf/bf/zjq/bqc + handicap）
- `data/results/<mid>.json` — per-mid 完赛结果（含 halfTime，BQC 用）
- `data/settled_matches.json` — 完赛汇总（31/32/33 启动前由 `scripts/build_settled.js --incremental` 增量刷新）
- `data/teams/_index.json` + `data/teams/<CODE>.json` — 球队分层 + 射手星（`strategy_core.createTeamCtx` 加载）

### 产物

| 文件 | 产出者 | 说明 |
| --- | --- | --- |
| `artifacts/strategy_params.json` | 33_fit | 拟合后的策略参数 + 基线/拟合 ROI 对比 + `component_breakdown`（各桶样本量，看 n<5 ⚠️） |
| `artifacts/roi_insights.json` | 32 | 按玩法/赔率区间/handicap/漂移分桶的命中率 + ROI |
| `artifacts/predict_31_<日期>.json` | 31 | 每场 `mainPicks`(主池3比分) + `singleBets` + `rqspf/zjq/bqc_follow` + `combos`(2串1/3串1) |
| `artifacts/chat_predict_<日期>.json` | build_chat_predict | 精简喂 AI 版（<2KB/4场，去概率/内部标签） |

## 🧠 31 号策略一览

策略函数全部在 `strategy_core.js`，签名 `(m, ctx)`，`ctx = { params, getTeamTier, hasScorerStar }`：

- **比赛分类** `classifyMatch`：BIG_BALL（强强/大让球带射手星）/ WEAK_MATCH（弱弱）/ NORMAL。
- **F4 主池** `f4Strategy`：按分类出 3 个比分。BIG_BALL 走大球三档；WEAK 走中赔 core + 高赔 upset；NORMAL 平局保底 + 方向爆冷。
- **单关** `singleBetStrategy`：BIG_BALL 反方向高赔、WEAK 高赔比分，取数（1/2）由拟合定。
- **跟投纠偏** `rqspfStrategy` / `zjqStrategy` / `bqcStrategy`：让球胜平负 / 总进球 / 半全场，各带主流盘纠偏规则。
- **串关组合** `generateCombos`：用低赔腿（命中率高）+ 总赔率带过滤 + band 内最可能优先（**设计修正，不进 fit**——combo 命中需多腿同时中，历史命中≈0，按 ROI 拟合是噪声）。

## 🔧 持续拟合（33_fit_strategy.js）

把以往"人肉改阈值 → 跑回测 → 再改 v2/v3/v4"自动化：

1. 加载全量已完赛回测样本（`loadBacktestMatches`）。
2. 从 `DEFAULT_PARAMS`（值 = 重构前硬编码）出发，对 `SEARCH_SPACE` 里每个旋钮做**坐标下降**。
3. 目标 = 组合 ROI 的**收缩值**（`LAMBDA=30` 伪投入压小样本），只有提升 ≥ `EPS=1pt` 才接受改动（抗噪）。
4. 写 `strategy_params.json`，31 启动时 `mergeParams(DEFAULT_PARAMS, …)` 加载；无产物时回落默认 = 旧硬编码行为。

**调参纪律**：要动任何策略阈值，改 `strategy_core.js` 的 `DEFAULT_PARAMS` 或扩 `SEARCH_SPACE`，**不要再往策略函数里塞硬编码数字**。

## 🔄 赛后回填（持续扩展）

`data/results/` 新增一场完赛后：重跑 `npm run modeling:all` 即可——`build_settled` 增量刷样本 → 32 重算规律 → 33 重拟合参数 → 31 用新参数出推荐。建议每天 18:00 跑一次拿最新推荐。
