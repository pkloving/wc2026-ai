
---
## 调优日志 - 2026/6/15 18:00:39

### 抽样比赛
- **海地 vs 苏格兰** (周六007)
- 开赛时间: 2026-06-14 09:00
- 让球: +1

### 实际结果
- 比分: **0-1**
- 胜负: 客胜
- 让球盘: 走盘
- 总进球: 1

### 预测对比

| 预测项 | 预测结果 | 实际结果 | 命中 |
|--------|----------|----------|------|
| 胜负预测 | N/A | 客胜 | ❌ |
| 让球盘 | 主胜 | 走盘 | ❌ |
| 比分TOP3 | 2-0、1-0、2-1 | 0-1 | ❌ |

### 调优建议

1. **handicap_prediction** - sample_overfitted
   - 小样本(3场)可能导致主胜率被高估
2. **score_prediction** - poisson_lambda_mismatch
   - 实际比分排第11位，需调整lambda参数
3. **pipeline** - error_propagation
   - 主要误差来自: 比分

### 赔率信息
- 让球胜: 7.4 | 让球平: 4.12 | 让球负: 1.33


---
## 调优日志 - 2026/6/15 19:03:22

### 抽样比赛
- **瑞典 vs 突尼斯** (周日012)
- 开赛时间: 2026-06-15 10:00
- 让球: -1

### 实际结果
- 比分: **5-1**
- 胜负: 主胜
- 让球盘: 主胜
- 总进球: 6

### 预测对比

| 预测项 | 预测结果 | 实际结果 | 命中 |
|--------|----------|----------|------|
| 胜负预测 | 胜 ⭐⭐ | 主胜 | ✅ |
| 让球盘 | 主负 | 主胜 | ❌ |
| 比分预测 | 2-0 (11.48%) | 5-1 (排名#15) | ❌ |

### 调优建议

**让球盘优化方向**: 考虑引入赔率走势或市场情绪特征
**比分预测优化方向**: 实际比分排名15/36，模型偏差较大，建议：(1)增大强队λ系数 (2)引入历史对战数据
**分步预测误差传递**: 胜负预测→进球数预测→比分预测，每步都会放大误差，建议建立联合概率模型

### 赔率信息
- 胜平负: 胜=1.67 | 平=3.35 | 负=4.3
- 让球胜平负: 胜=2.85 | 平=3.2 | 负=2.1

---
## 调优日志 - 2026/6/16 08:21:02

### 抽样比赛（前三场验证）
- **西班牙 vs 佛得角** (周一013) — 实际 0-0
- **比利时 vs 埃及** (周一014) — 实际 1-1
- **沙特阿拉伯 vs 乌拉圭** (周一015) — 实际 1-1

### 预测 vs 实际对比

| 比赛 | 胜负预测 | 命中 | 比分预测 | 命中 | 备注 |
|------|----------|------|----------|------|------|
| 西班牙 vs 佛得角 | 无推荐（spf未开售） | N/A | 2-0 / 1-0 / 2-1 | ❌ | 实际0-0，Top3均未命中 |
| 比利时 vs 埃及 | 主胜（大热门） | ❌ | 2-0 / 3-0 / 1-0 | ❌ | 实际1-1平局，胜负和比分均未命中 |
| 沙特 vs 乌拉圭 | 客胜（大热门） | ❌ | 0-2 / 0-3 / 0-1 | ❌ | 实际1-1平局，强弱对话再次爆冷 |

### 模型参数更新
- 完赛样本：12 场（世界杯正赛）
- λ_total = 3.167
- λ_home = 2.333
- λ_away = 0.833

### 调优建议
1. **胜负预测**：三场全部未命中（或无法推荐），大热门策略在小组赛首轮表现不佳，实际赛果偏向低进球平局，建议引入“小组赛首轮冷门因子”或降低热门队λ预期。
2. **比分预测**：三场实际比分（0-0、1-1、1-1）均未出现在Top3中，模型严重高估强队进球能力，建议：
   - 下调 λ_total 基线（当前3.17偏高，三场实际场均仅0.67球）
   - 对让球-2及以上深盘增加“低进球”惩罚项
   - 引入半场数据或实时状态修正
3. **让球盘**：西班牙让-2无样本；比利时让-1样本主胜率43% < 55%已跳过；沙特让+1样本主胜率67%但赛果为走盘，让球经验法则仍需更多样本校准。
4. **总体方向**：当前12场样本中Top-1比分命中率仅17%，Top-3命中率25%，模型对小组赛首轮的进球期望系统性偏高，建议下一轮预测前对 λ_total 做动态衰减或分阶段校准。

---
## 调优日志 - 2026/6/16 12:00:00

### 抽样比赛
- **巴西 vs 摩洛哥** (周六006 · mid=2040167)
- 开赛时间: 2026-06-14 06:00
- 让球: -1

### 实际结果
- 比分: **1-1**（半场 1-1）
- 胜负: 平
- 让球盘: 主负
- 总进球: 2

### 预测 vs 实际对比

| 预测项 | 预测 | 实际 | 命中 |
|--------|------|------|------|
| 胜负 | 主胜 ⭐⭐（spf 1.5, p0_home 0.59） | 平 | ❌ |
| 让球盘 | skip（让-1 主胜率 43% < 55%） | 主负 | ✅ 决策正确（未出手）|
| 比分 | 2-0 (15.5%) | 1-1 (模型概率 8.6%，未入 Top-3) | ❌ |

### 实际赔率
- 胜平负: 胜=1.5 | 平=3.6 | 负=5.4
- 让球胜平负: 胜=2.8 | 平=3.26 | 负=2.15（让球客胜 p0 0.41 是 3 项最高）
- 隐含 p0: 主 0.59 / 平 0.25 / 客 0.16
- 让球隐含 p0: 主 0.32 / 平 0.27 / 客 0.41

### 根因分析
1. **比分模型 v2 把巴西 λ_home 拉到 2.07**（= 2.633 × 0.59 / 0.75），但实际巴西只进 1 球。赔率加权放大了"热门溢价"，让模型过度自信地预测主队赢球。
2. **Top-3 全是主队赢球比分**（2-0 / 1-0 / 3-0），没有 1-1 或客胜比分。模型对摩洛哥 λ_away=0.57 偏低，客胜比分概率全部 < 5%，结构性忽视平局/冷门。
3. **win_model 选主胜**也错。p0_home=0.59 落在"适中"档，但样本里这个区间（p0 0.55-0.65）热门翻车率高（前几轮已观测到）。
4. **让球盘决策正确**：让-1 样本主胜率 43% < 55% → skip，未下注避开了这场大热门翻车。

### 改了什么（**why + diff**）

#### why
> 比分模型 score_model.json artifact 是 v2 概率加权公式，但训练脚本 04 和预测脚本 05 仍写 v1 tier 调整逻辑。**artifact 和 code 严重脱节**：重跑训练会覆盖 artifact 回 v1；现在重跑预测会直接 crash（`tier_adjustment` / `tier_thresholds` 字段在 artifact 里不存在）。**修这个一致性 bug 是本次调优最高优先级**。

#### 改的文件

**1. `modeling/scripts/04_train_score_model.js`**

old_string (v1 tier 调整):
```js
const tierAdjust = {
  strong_fav: { home_mult: 1.3, away_mult: 0.8 },
  balanced:   { home_mult: 1.0, away_mult: 1.0 },
  weak_fav:   { home_mult: 0.8, away_mult: 1.2 },
};
const model = {
  model_type: 'poisson_independent',
  global_lambda_home: round(lambdaHome),
  global_lambda_away: round(lambdaAway),
  tier_adjustment: { strong_fav: {...}, balanced: {...}, weak_fav: {...} },
  tier_thresholds: { strong_fav_p0: 0.6, weak_fav_p0: 0.3 },
  score_grid_max: 5,
  formula: 'P(h,a) = Poisson(h; λ_h) * Poisson(a; λ_a) ; h,a ∈ [0,5]',
};
```

new_string (v2 概率加权):
```js
// v2 公式：赔率概率加权分配总进球期望到主/客
function lambdasFor(p0Home, p0Away) {
  if (p0Home === null || p0Away === null || p0Home + p0Away <= 0) {
    return { lh: lambdaHome, la: lambdaAway };
  }
  const denom = p0Home + p0Away;
  return { lh: lambdaTotal * (p0Home / denom), la: lambdaTotal * (p0Away / denom) };
}
const model = {
  model_type: 'poisson_probability_weighted',
  global_lambda_total: round(lambdaTotal),
  global_lambda_home: round(lambdaHome),
  global_lambda_away: round(lambdaAway),
  score_grid_max: 5,
  formula: 'λ_home = λ_total × p0_home / (p0_home + p0_away)；λ_away = λ_total × p0_away / (p0_home + p0_away)',
  note: 'v2: 用赔率概率比例分配进球期望...',
};
// 旧 v1 tierAdjust 保留为注释以便回滚
```

**2. `modeling/scripts/05_predict_unplayed.js`**

old_string (v1 tier 调整 + 读不存在的字段):
```js
function predictScore(m) {
  const p0 = m.spf ? impliedProbs(m.spf).p0_home : null;
  let tier = 'balanced';
  if (p0 > scoreModel.tier_thresholds.strong_fav_p0) tier = 'strong_fav';
  else if (p0 < scoreModel.tier_thresholds.weak_fav_p0) tier = 'weak_fav';
  const adj = scoreModel.tier_adjustment[tier];  // ← artifact 不存在，crash
  const lh = scoreModel.global_lambda_home * adj.home_mult;
  const la = scoreModel.global_lambda_away * adj.away_mult;
  ...
}
```

new_string (v2 概率加权):
```js
function predictScore(m) {
  const imp = m.spf ? impliedProbs(m.spf) : null;
  const p0Home = imp?.p0_home ?? null;
  const p0Away = imp?.p0_away ?? null;
  let lh, la;
  if (p0Home === null || p0Away === null || p0Home + p0Away <= 0) {
    lh = scoreModel.global_lambda_home;
    la = scoreModel.global_lambda_away;
  } else {
    const denom = p0Home + p0Away;
    lh = scoreModel.global_lambda_total * (p0Home / denom);
    la = scoreModel.global_lambda_total * (p0Away / denom);
  }
  ...
}
// score_meta 同步移除 tier 字段
```

### 验证
- `node --check` 两脚本通过
- `score_model.json` 仍合法：`type=poisson_probability_weighted` / `n=60` / `lh=1.533` / `la=1.1` / `lt=2.633` / `has_tier_adjustment=false`
- 修复后 predict_unplayed.json 重跑不会再 crash

### 进一步调优建议（**未改，留给下一轮**）
1. **比分模型对 p0_home ∈ [0.55, 0.65] 区间引入"热门翻车折扣"**：当 p0_home 接近 0.6 边界时，对 λ_home 乘 0.85 衰减系数（基于前几轮观测 0.55-0.65 区间热门命中率明显偏低）。
2. **Top-3 比分强制至少 1 个平局或客胜候选**：当 p0_draw + p0_away > 0.35 时，从 Top-K=10 候选中保证至少 1 个非主胜比分入 Top-3。
3. **win_model 加 0.55-0.65 中度热门档**：当前只有 strong_fav (< 1.5) / moderate (1.5-2.5) / long_shot (>= 2.5) 三档，建议在 0.55 ≤ p0_home < 0.65 区间降 1 档信心（⭐ → ⭐ 或 ⭐⭐ → ⭐）。
4. **样本量仍是核心瓶颈**：当前 12 场世界杯正赛 + 48 场 2022 历史共 60 场，但训练只吸收"世界杯"标签 12 场。下次有 >5 场新完赛时再 retrain。

---
## 调优日志 - 2026/6/16 12:30:00 (R-010 新算法首推)

### 触发
用户反馈："模型推荐要考虑2个方向，单关爆冷比分 / 比分的2串1（一个高倍率+一个低倍率） & 胜负（包括让球）/进球数3串1，要求整体倍率大于8。以这个前提来调优算法"

### 触犯的场景
6-15 抽样 2040167 巴西 vs 摩洛哥后，6-16 records/2026-06-16.md 沿用 R-007 §1 "K≥0.10 决策顺序" + R-008 "串关为底/单关为顶"：
- 6-17 4 场建模 K 全部 < 0.10（FRA +0.030 / ARG +0.052 / AUT +0.045）
- 全部让球 verdict=skip（让-1 样本主胜率 43% < 55%）
- 全场不推单关 → 段一全玩法预测表全部 ✗
- 但 R-008 又要求"默认配 4 注 × 2 元 = 8 元串关试水" → 矛盾
- 6-16 推荐 4 场 4 注 × 2 元 = 8 元 (3 场 spf 串关 2×1+3×1)，全部 spf 大热门乘积 1.998×2=3.99 ✗ < 8 整体倍率

### why 一句话
R-007 K≥0.10 决策顺序 + R-008 串关为底 互相冲突 + 没有整体倍率约束 + bf/zjq 玩法被浪费 → 引入 R-010 全新推荐算法（两方向 + 整体 > 8）。

### 改了什么

#### 1. 新增 `modeling/scripts/06_recommend_parlays.js`（284 行）
**why**：新推荐算法需要从 predict_unplayed.json + data/odds/<mid>.json 取输入（spf/rqspf/bf/zjq 4 玩法），输出双方向候选。

**核心 TUNING 常量**（算法调优改这里）：
```js
const TUNING = {
  VIG: 0.13,
  MIN_OVERALL_ODDS: 8,           // 整体倍率硬规则
  NEXT_DAY: '2026-06-17',
  MAX_PICK_ODDS: 35,             // 避免 7+球 50x 污染
  ZJQ_MAX_GOALS: 5,              // 6+球不参与
  ZJQ_MIN_PROB: 0.15,            // 0 球/4+球不参与 (避免 3 场 0 球配 0 球极端)
  SINGLE_OUTSIDER_MIN_ODDS: 12,
  SINGLE_OUTSIDER_PROB_RANGE: [0.04, 0.12],
  PAIR_HIGH_ODDS: 12,
  PAIR_LOW_ODDS: [5, 12],
  PARLAY3_REQUIRE_SPF_OR_RQSPF: true,
  PARLAY3_REQUIRE_ZJQ: true,
};
```

**算法步骤**：
1. NEXT_DAY 过滤（保留 6-17 4 场，跳过 6-16 4 场 + 6-18 4 场）
2. 收集每场 picks: spf (argmax p0) / rqspf (argmax p0) / bf 全 30+ 比分 / zjq 全 0-5 球
3. 方向 A 单关爆冷: bf pick, odds > 12, prob 4-12% → top 5
4. 方向 A 2串1 高+低: 2 场不同 mid, 1 高 (odds>12) + 1 低 (5-12), total > 8 → top 5
5. 方向 B 3串1: 3 场不同 mid, 至少 1 spf/rqspf + 至少 1 zjq, total > 8 → top 8
6. 整体倍率校验: A min + B min 都 > 8

#### 2. 新增 `modeling/artifacts/recommend_parlays.json`（自动生成，92 行）
**why**：算法输出存档，6-17 完赛可对照"算法推荐 vs 实际"。

**首推结果**（6-17 4 场 6 月 17 日 6-17 03:00-12:00 北京时间）：
- 方向 A 单关爆冷 top 1: bf 4:1 @ 22 (ARG vs DZA, prob 4.0%)
- 方向 A 2串1 高+低 top 1: bf 1:5@28 (IRQ) × bf 0:0@11 (ARG) = 308
- 方向 B 3串1 top 1: rqspf 主胜 2.16 (IRQ) × zjq 4球 5.8 (FRA) × zjq 4球 5.5 (ARG) = 68.9
- 整体倍率校验: pass=true (A min=19, B min=57.1, 阈值=8)

#### 3. 重写 `records/2026-06-16.md`（R-010 模板）
**why**：6-17 推荐从 4 注 8 元 → 3 注 6 元（方向 A 单关 2 + 方向 A 2串1 2 + 方向 B 3串1 2），整体 > 8 全部满足。

**段一改两段式**：
- 段一: 推荐算法说明 (R-010 新规则) - 替换原 P0 vs P vs K 对照表
- 段二: 原推荐 (方向 A 单关 + 方向 A 2串1 + 方向 B 3串1 top 1) - 替换原 1.1/1.2/1.3 spf 决策

**段二实际下注**：
```json
[
  { "id": "dirA-single-2040180-bf-4-1-22", "stake": 2, "odds": 22 },
  { "id": "dirA-parlay2-1x5-0x0-308", "stake": 2, "totalOdds": 308 },
  { "id": "dirB-parlay3-rqspf-zjq4-zjq4-68.9", "stake": 2, "totalOdds": 68.9 }
]
```

#### 4. 追加 `records/reflections.md` 的 R-010
**why**：R-007 §1 K≥0.10 决策顺序 + R-008 串关为底 已撤回 → 正式归档，列出 R-010 全部规则、TUNING 常量、已知局限。

### 验证
- `node --check modeling/scripts/06_recommend_parlays.js` ✅
- `node modeling/scripts/06_recommend_parlays.js` 输出 4 场 6-17 比赛 → 5 单关 + 5 2串1 + 8 3串1 候选
- `recommend_parlays.json` 合法：direction_a.singles=5, direction_a.pairs_2x1=5, direction_b.parlays_3x1=8
- `overall_check.pass=true`, A min=19, B min=57.1 (均 > 8)
- records/2026-06-16.md 段二 cost = 6 元 = 3 注 × 2 元 (2+2+2)

### git diff 摘要
```
modeling/scripts/06_recommend_parlays.js  | +284 (新增, R-010 算法)
modeling/artifacts/recommend_parlays.json  | +92  (新增, 算法输出)
records/reflections.md                    | +90  (R-010 段)
records/2026-06-16.md                     | 重写 (R-010 模板, 段一/段二/段三都改)
4 files changed, 0 deletions(-)
```

### 已知 bug fix (调试中遇到)
1. **NEXT_DAY 过滤未生效**：第一次跑用 `matches.flatMap` 引用了未过滤的 matches 列表 → 改为 `matchesFinal.flatMap` 修
2. **方向 B 3串1 选中 0 球配 0 球**：0 球赔率 11-19x, 3 场 0 球同时中概率 0.1% × 5000x = fair bet 但实际是赌博型 → 加 `ZJQ_MIN_PROB=0.15` 限制
3. **zjq 7+球 50x 污染方向 B**：7+球赔率 30, 单场 7+球概率 < 5%, 拖高 3串1 总赔率到 4700+ → 加 `MAX_PICK_ODDS=35` + `ZJQ_MAX_GOALS=5` 限制

### 建议的 commit message
```
feat(modeling): add R-010 two-direction parlay recommender

User feedback (2026-06-16 12:30): drop R-007 K≥0.10 decision order
and R-008 "parlay-first/single-top" structure. New algorithm has two
directions:
  - Direction A (比分玩法): single outsider bet (odds>12) / 2-leg parlay
    (one high+one low, total>8)
  - Direction B (胜负+让球/进球数 3-leg parlay): 3 distinct matches,
    ≥1 spf/rqspf + ≥1 zjq, total>8
Hard rule: all recommendations must have combined odds > 8.

New artifacts:
  - modeling/scripts/06_recommend_parlays.js (TUNING-driven, 284 lines)
  - modeling/artifacts/recommend_parlays.json (algorithm output)

records/2026-06-16.md rewritten with R-010 template:
  - 段一 = R-010 algorithm spec
  - 段二 = 3 bets × 2元 = 6元 (dirA single + dirA 2-leg + dirB 3-leg)
  - 段三 = full-method verdict for R-010 first run

records/reflections.md: R-010 added, R-007 §1/§2 + R-008 marked retracted.

Bugs fixed during dev:
  - NEXT_DAY filter used unfiltered `matches` list, included 6-16/6-18
  - 3-leg parlay picked 3×0-goal (zjq 0球) combos, fair bet but gambling
  - zjq 7+球 @50x polluted 3-leg total to 4700+

TUNING constants (top of 06_recommend_parlays.js):
  MIN_OVERALL_ODDS=8 / MAX_PICK_ODDS=35 / ZJQ_MAX_GOALS=5 / ZJQ_MIN_PROB=0.15
```

### 进一步调优建议 (R-010 局限)
1. **加 MIN_EV 过滤**：当前偏向"找高赔率组合", 6-17 全部 EV < 1 (反价值) → 后续可加 `MIN_EV=1.0` 只推正价值
2. **加 MAX_PAIR_ODDS=200 限制**：方向 A 2串1 308x 是 fair bet 赌博型
3. **bqc 半全场数据补**：当前 bqc 全空, 等数据补上后扩展玩法
4. **加 "价值 bet" 识别**: 6-17 4:1 @ 22 实际概率可能 6-8% (modeling 估 4%) → 配 04_train_win.js 加 0.55-0.65 区间降档 (上轮已提)

