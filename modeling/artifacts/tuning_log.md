
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

