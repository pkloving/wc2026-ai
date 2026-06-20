---
name: 'wc2026-daily'
description: "wc2026-ai 每日执行流程：拉完赛比分、重算积分、刷索引、抓赔率（仅世界杯正赛 M001-M104）、跑 modeling 出推荐（模拟单用户手动录入 data/bets.json）+ git commit/push。Invoke when user says '执行每日 prompt' / '跑每日流程' / '走一遍每日' / 'wc2026 daily'."
---

# WC2026 每日执行流程

> 项目根：`d:\project\github\wc2026-ai`
> 完整参考：`每日执行.md`（资金/Schema 变更时同步改那里）

---

## 0. 范围红线（先读再动）

- **关注范围 = 仅世界杯正赛**（`data/matches.json` 的 M001-M104）及其对应 `matches_status.json` 的 2040xxx 编码
- **国际赛 / 热身赛 / 其它友谊赛 → 不拉赔率、不出推荐、不录结果**
- 历史热身赛结果保留在 `modeling/data/international_warmup.json` 留档，**不参与 modeling 训练**
- 本金 1000 元起步，余额公式：
  ```
  balance = 1000 − Σ(bet.totalCost) + Σ(bet.actualReturn where result="won")
  ```
- 结算模型（R-005）：
  ```
  出票 / 确认 → -cost        ← 唯一扣钱点
  结算 won   → +actualReturn
  结算 lost  → 不动（cost 已扣过）
  ```

---

## 1. 一次性检查清单（先过一遍）

- [ ] `git status` 干净
- [ ] `data/matches_index.json` 最新日期是昨天
- [ ] `data/results/` 没有 >2 小时未录的已完赛正赛（**非正赛不录**）
- [ ] `modeling/artifacts/predict_31_<日期>.json` 已生成且 `matches` 数 = `matches_status.json` 中未开赛的世界杯正赛场次数（旧 `predict_unplayed.json` 已废弃）
- [ ] `modeling/data/01_matches_with_odds.json` 的 `total` = `data/results/` 里**世界杯标签**完赛数
- [ ] `records/` 目录无 >3 天未回填的赛果段
- [ ] `tmp/` 目录清空
- [ ] 余额与 `records/` 里累计盈亏对得上

---

## 2. 六步执行流程

> 多 LLM 比分预测（`data/predictions.json`）= **用户手动录入**，本流程不调用 `add-prediction.js`，统计页只读消费
> AI 模拟结算（bets.json 的 pending → won/lost）= **用户单独触发**，本流程不动

| Step | 任务                                                         | 子 agent         |
| ---- | ------------------------------------------------------------ | ---------------- |
| 1    | 拉完赛结果 + 更新比分（仅正赛）                              | ✅               |
| 2    | 重算积分（FIFA Standings）                                   | ❌               |
| 3    | 统计（build_index + AI 命中复盘）                            | ❌               |
| 4    | 拉未开赛已放出的赔率（仅正赛）                               | ❌（>10 场才开） |
| 5    | `npm run modeling:all`（拟合+预测）+ `build_chat_predict.js` | ❌               |
| 6    | 基于赔率-结果模型 + 赔率市场情绪给推荐（**不写 bets.json**） | ❌               |

---

### Step 1 · 拉完赛结果 + 更新比分

**触发**：正赛已开赛 >2 小时且 `data/results/<mid>.json` 缺该场结果（且 mid 属于 M001-M104）。

派一个 `general_purpose_task` 子 agent：

1. **数据源（双轨 · 2026-06-18 实测）**：
   - **sporttery `getMatchHeadV1.qry`**（拿全场比分）——最稳定
     - URL: `https://webapi.sporttery.cn/gateway/uniform/football/getMatchHeadV1.qry?source=web&sportteryMatchId={mid}`
     - 必带 `Referer: https://www.sporttery.cn/`（否则空响应）
     - 返回 `value.fullCourtGoal` = `"1:1"` / `"4:2"` / `"1:0"`（完赛后才有）
   - **FIFA v3 `/live/football/...`**（拿半场+进球+换人+黄牌）——最详细
     - URL: `https://api.fifa.com/api/v3/live/football/17/285023/289273/{idmatch}?language=en`
     - `17`=FIFA World Cup competitionId, `285023`=2026 美加墨世界杯 seasonId（**注意：255711 是 2022 卡塔尔，别用错**）, `289273`=First Stage stageId
     - `idmatch`（400021502 等）需要从 FIFA Match Centre 抓 URL 拿（`/en/match-centre/match/17/285023/289273/{idmatch}`）
     - 完赛判定：`Period == 10` 或 `MatchStatus == 0`
     - 半场比分 = `Goals[].Period == 3` 的累加（Period 3=上半场, 5=下半场, 4=加时, 6=点球）
     - Goals 数组含 `IdPlayer` + `Minute` + `Type`（1=乌龙, 2=普通, 3=点球），通过 IdPlayer 在 Players 列表中找名字
   - **chrome-devtools-mcp / 详情页 HTML** 已被实测证明**拿不到**详细数据：sporttery 详情页的"比分直播"tab 数据不通过公开 API 加载，前端 JS 直连第三方 WebSocket
2. **CLI**：`node scripts/update-result.js <matchId> <homeScore> <awayScore> --half-time=h:a --scorer=team:player:minute:type [...]`
   - 必传 `--half-time`（bqc 玩法结算需要半场比分）
   - 比分非 0:0 时 `--scorer` 至少 1 个
   - 走点球加 `--penalties=h:a`
3. **子 agent 报告**：今日新增了哪些 mid 的比分，**显式列出跳过的非正赛 mid**

数据 schema（results）：per-mid 拆分到 `data/results/<mid>.json`，前端用 Vite `import.meta.glob` 读。
至少含 `matchId / homeScore / awayScore / halfTime / scorers / wentToPenalties / penaltyScore`，其中 `halfTime` 和 `scorers` 是**必填**。

> Step 1 跑完后**必须**立刻跑 Step 2（`node scripts/update-groups-standings.js`）——只录比分不更新积分，groups.json 的 standings 还是 0 分，会误导下游 modeling、standings 页、推荐页。

---

### Step 2 · 重算积分（FIFA Standings）

**推荐路径（脚本化，幂等）**：
```
node scripts/update-groups-standings.js
```
- 会扫描 `data/results/*.json` 里**所有已完赛场次**，按 12 个小组重新累加胜/平/负、GF/GA/GD/Points，并按 pts→gd→gf 排序
- 同时把 `data/matches.json` 中对应比赛的 `status` 从 `scheduled` 翻成 `finished`
- 跑之前可以加 `--dry-run` 预览会更新哪些小组，确认无误再执行

**人工兜底路径（脚本无法用或 FIFA 积分有差异时）**：
1. 拉 [FIFA Standings · 世界杯 2026](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/standings) 12 个小组当前积分
2. 直接编辑 `data/groups.json`（12 个小组整组覆盖）
3. **校验**：每组 4 队 + 每队比赛场数 = 小组已完赛场数（错就标红停手）
4. 计分：胜 3 / 平 1 / 负 0；净胜球 = GF − GA

**Step 2 完成后必须顺手跑**：
```
node scripts/build_teams_data.js
```
（同步刷新 `data/teams/*.json` 里每队的 `standings` 与 matches 列表，避免推荐模型读到"已完赛但积分 0"的错误队伍画像）

---

### Step 3 · 统计

1. `node scripts/build_index.js` 刷新 `data/matches_index.json`
2. 看 `js/pages/stats.js` 的 dashboard（AI 模型准确率榜）— 自动从 `predictions.json` + `results/*.json` 算
3. 复盘：哪些 AI 命中 / 哪些未中，新发现写进 `records/reflections.md`

> 本步骤**不修改** `data/bets.json`，**不调用** `add-prediction.js`

---

### Step 4 · 拉未开赛已放出赔率（仅正赛 · **次日场也抓**）

**抓取范围重新定义**：
- **今日场**：`kickoff` 在今天 0:00 ~ 23:59 之间的世界杯正赛 —— 必须抓
- **次日场**：`kickoff` 在明天（D+1）全天的世界杯正赛 —— **也必须抓**（原规则遗漏，2026-06-19 修正）
- **D+2 及以后**：暂不抓（开盘赔率可能频繁变动，抓了也意义不大；从 D+1 开始每日 Step 4 抓一轮足以覆盖 48 小时赔率漂移）
- 示例：2026-06-19 跑 Step 4，应当抓 `kickoff` 在 2026-06-19（今日，含 in_progress）+ 2026-06-20（次日，周五029~周五032）的全部场次

**红线**：只拉 `data/matches.json` M001-M104 对应场次；**已完赛赔率最多拉一次**（首次覆盖 6-08 的旧值定格，标 is_finished_odds=true 后不再重抓，避免浪费 API）。

**完赛赔率标注规则**（R-014）：

- `data/odds/<mid>.json` 的 `basic` 段必须有 `is_finished_odds: boolean` 字段
  - `true` = 这是**完赛赔率**（比赛已开赛过且 `status=finished`，赔率定格不再抓）
  - `false` = 这是**未完赛赔率**（比赛尚未完赛，会继续抓赔率变化）
- `data/matches_status.json` 的每个 match 也要带 `is_finished_odds: boolean` 字段（与 `odds/<mid>.json` 保持同步）
- **判断逻辑**：
  - `status === 'finished'` 且 `data/results/<mid>.json` 存在 → 标 `true`
  - 其它 → 标 `false`
- **何时打标**：
  - scrape_fixed_bonus.js 写 `odds/<mid>.json` 时**拉完即标**（按当前 status 决定 true/false）
  - build_index.js 同步该字段进 `matches_index.json` 的 entry
  - update-result.js 标记完赛（写 `results/<mid>.json`）后，**立即**把对应 `odds/<mid>.json` 的 `is_finished_odds` 翻为 `true` 并同步 `matches_status.json`
- **抓取时序**（v2，修正"定格赔率停在旧值"问题）：
  1. **第一次拉**：所有 mid 都要拉一次最新赔率（已完赛也要拉 → 让"定格赔率"覆盖 6-08 的旧值）
  2. **拉完即标**：根据 `status` 决定 `is_finished_odds`，完赛 → true，未完赛 → false
  3. **后续每次跑**：先扫 `odds/<mid>.json` 拿 `is_finished_odds`，凡是 true 跳过（避免重复拉定格赔率）
  4. **每个 mid 最多拉 2 次**：完赛前 last update + 完赛后定格
- **兜底**：即便 status 字段被改回（如手动重置），`odds/<mid>.json` 的 `is_finished_odds=true` 仍会跳过该 mid

**两条抓取路径，按场景二选一**：

- **API 批量抓**（首选）：`node scripts/scrape_fixed_bonus.js`
  - 数据源 `getFixedBonusV1.qry`，输出 5 玩法全量（spf/rqspf/bf/zjqs/bqc）
  - 维护 `data/odds/<mid>.json`（latest + `is_finished_odds` 标记）+ `data/odds_history/<mid>.json`（变动序列）
  - **预过滤**：mid 列表里出现 `is_finished_odds=true` 的，直接从 `MATCHES` 里剔掉
- **chrome-devtools-mcp 抓**（API 受限兜底）：见下方步骤 1-7

用 chrome-devtools-mcp（**新开 isolated context 避免实例冲突**）：

1. 导航到 `https://www.sporttery.cn/jc/jsq/zqspf/`
2. 抓所有**在售** + **待开售**的世界杯正赛场次（基本/赔率/近期/伤停/赛程）
3. **过滤**：每个 mid 必须能映射回 `matches.json` 的 M-id（`scripts/scrape_match.js` 的 `MATCH_IDS` 列表已做这层映射）；**不映射的跳过**
4. 每场写到 `data/<今日>/<周X-NNN_主_vs_客>.json`（用 `Write` 工具，不要 cat）
5. **比分表定位**：动态按表头含 `"1:0"` 找表（让球调整后 `tables[3]` 不一定是比分表）
6. **待开售场次**：赔率全 `null`，但保留 mid/code/开售时间，建监控后续补抓
7. 重跑 `node scripts/build_index.js`（**会同步 is_finished_odds 字段**）

> 大批量（>10 场）才开子 agent

**`odds_history/<mid>.json` 写入五铁律**（`scrape_fixed_bonus.js` 实现）：

1. **只保留 [first, latest] 2 条快照**（每个玩法独立维护）：第 0 条 = 第一次抓到的赔率（永远不删，用作对比基准）；第 1 条 = 最新一次"与 first 不同"的赔率；中间过渡值直接丢掉
2. **后续未完赛每日抓一次**：开赛 >2h 但仍未完赛的场次，每日 Step 4 抓 5 玩法全量
3. **同场赔率相同不记录**：spf/rqspf 比较 `{home, draw, away}`；bf/zjq/bqc 比较完整 dict。与 first 相同 → 只保留 first；与 latest 相同 → 不改动
4. **已完赛不抓**：status=finished 跳过整个 mid
5. **is_finished_odds=true 永久跳过**：scrape_fixed_bonus.js 启动时先读 `odds/<mid>.json` 拿这个标记，凡是 `true` 一律不抓

**odds_history schema**：
```
{
  mid,
  spf_history:   [{time, home, draw, away}],        // 最多 2 条：[first, latest_if_different]
  rqspf_history: [{time, home, draw, away}],        // 最多 2 条
  bf_history:    [{time, odds: { "1:0": 5.8, ... }}],  // 最多 2 条（全部比分选项快照）
  zjq_history:   [{time, odds: { "0": 15, ... }}],      // 最多 2 条
  bqc_history:   [{time, odds: { "胜胜": 1.6, ... }}]   // 最多 2 条
}
```
**消费侧读取**：取第 0 条（first）和最后一条（latest）做差值比较即可；如果 `arr.length === 1` → 一直没变过。

消费侧（modeling）已在 [01_prepare_data.js 0 节](file:///d:/project/github/wc2026-ai/modeling/scripts/01_prepare_data.js) 算 `mov_*` 特征，等快照数提上来后自动激活。

---

### Step 5 · 跑 modeling（拟合 + 预测 + 喂 AI）

```bash
npm run modeling:all                              # = 33_fit_strategy.js && 31_tight_anti_value.js --predict
node scripts/build_chat_predict.js                # 推荐出来后, 生成喂 DeepSeek 的精简版 (默认今天, 可传 YYYY-MM-DD)
python3 data/strategy/daily_dual_report.py <今日>  # 31规则 + 新策略 合并出单 → modeling/artifacts/出单合并_<今日>.md
```

> 环境坑：`npm run` 在本机会走 WSL 报错，直接 `node modeling/scripts/33_fit_strategy.js && node modeling/scripts/31_tight_anti_value.js --predict` 跑。

`modeling:all` 两步：

1. `33_fit_strategy.js` — 用**全量已完赛回测**拟合 31 号策略参数（坐标下降 + 小样本收缩惩罚），写 `modeling/artifacts/strategy_params.json`。这就是"持续训练"：每天新赛果进来 → 重拟合阈值
2. `31_tight_anti_value.js --predict` — 加载 `strategy_params.json`，对未开赛世界杯正赛出推荐（无 fit 产物时回落默认参数 = 旧硬编码行为）

**主入口产物**：`modeling/artifacts/predict_31_<日期>.json` —— 每场含 `mainPicks`(主池3比分@赔率) + `singleBets` + `rqspf_follow`/`zjq_follow`/`bqc_follow`(让球胜平负/总进球/半全场跟投) + `combos`(2串1/3串1 TOP组合)

**喂 AI 产物**：`build_chat_predict.js` 读 `predict_31_<日期>.json`（可选叠加 `predict_r013_<日期>.json`）合并精简出 `modeling/artifacts/chat_predict_<日期>.json`（<2KB，去概率/内部标签，供 DeepSeek 对话引用）

**合并出单产物**（新策略，2026-06-20 加）：`python3 data/strategy/daily_dual_report.py <日期>` 读 `predict_31_<日期>.json` + `data/odds/` + R1 积分 + 本届指纹，输出 `modeling/artifacts/出单合并_<日期>.md`，**两段式**：① 31 规则出单（照搬 type/F4比分/rqspf主腿）② 新策略出单（原型 强弱×进球 + 本届指纹 + R2/R3 出线心态 → 信心★/中/⚠/✗ + 方向 + 比分 + 串关建议）。两套并排便于对照。脚本与结论见 `data/strategy/README.md`。
> 性质：仅出推荐对照，**不写 `data/bets.json`**（与 Step 6 一致，模拟单由用户手动录）。单届小样本，报告内已含诚实刹车。

> ⚠️ **旧路径已废弃，不再使用**：`05_predict_unplayed.js` / `06_recommend_parlays.js` / `predict_unplayed.json` / `modeling:train`(02/03/04 三模型) / `modeling:prepare`。31 号策略是当前**唯一主模型**，参数由 33_fit 持续训练（详见记忆 strategy-fit-architecture）。
> 训练样本仅含世界杯标签完赛场次。国际赛已剔除并落 `modeling/data/international_warmup.json` 留档

---

### Step 6 · 出当日推荐

> ⚠️ 写推荐前必先打开 `records/reflections.md` 通读一遍，确认当天的玩法/仓位/让球换算没触犯 R-00X

**输入**：`modeling/artifacts/predict_31_<日期>.json`（+ 喂 AI 用 `chat_predict_<日期>.json`）

写到 `records/<今日>.md`，四段式：

1. **一、原推荐**（资深经理+金融视角）
   - 段一"4 条理由"第 3 条 = **赔率市场情绪**（替代 5 模型陪审团）
     - 主胜赔率持续下降 → 加 1 档信心
     - 主胜赔率持续上升 → 减 1 档信心
     - 赔率无明显变化（< 5%）→ 市场情绪中性
   - **每场必出「全玩法预测」表**（5 玩法都出，**推荐下注**打勾才出钱）
   - **段一开头必加「## 0. 次日比赛比分预测汇总」表**（数据源 = `predict_31_<日期>.json` 的 `matches[].mainPicks`（主池3比分@赔率），全场列出，按开赛日期升序）
   - 5 模型陪审团已撤（用户反馈"5 模型推测不可作为你的数据依赖"）

2. **R-007 决策顺序硬规则**（"先 spf 后让球"）：

| 步骤 | 玩法        | 门槛                                                   | 不满足 |
| ---- | ----------- | ------------------------------------------------------ | ------ |
| ①    | spf（让 0） | K ≥ 0.10                                               | 进 ②   |
| ②    | rqspf 让-1  | K ≥ 0.10                                               | 进 ③   |
| ③    | rqspf 让-2  | **双重确认**（教练"主力全上"+近 3 场场均净胜 ≥2.5 球） | —      |

禁止跳级（K<0.10 直接推让-2）。禁止反推 K。

4. **二、实际下注**（用户手动出票后回填 · 本流程不写 bets.json）
   - **本流程不写** `data/bets.json`；用户自行去 `data/bets.json` 加新单（单关用 `lines` schema，串关用 `picks` + `parlayType`）
   - `records/<今日>.md` 段二"实际下注"**只写文字记录**（不写文件结构变更）

5. **三、赛果**（次日开赛完回填 · 必须做全玩法辨析）

6. **四、风控纪律**

> **串关推荐**要带 2×1+3×1 思路（小注试水 4 注 × 2 元 ≈ 8 元），别只给大额单关

---

## 3. 提交推送

```bash
git add -A
git commit -m "<今日> 抓取数据 + 推荐"  # 走 git-commit skill
git push
```

- 推送前用 `git status` 确认无遗漏
- 推送后用浏览器访问站点 URL 确认渲染

---

## 4. 工具与目录约定

| 用途     | 工具/路径                                                               |
| -------- | ----------------------------------------------------------------------- |
| 抓取     | chrome-devtools-mcp（**新页面用 isolated context** `wc2026-ai-<日期>`） |
| 临时文件 | `tmp/<日期>/`（截图、日志、debug HTML），完事必清                       |
| 每日数据 | `data/<日期>/*.json`                                                    |
| 记录     | `records/<日期>.md` / `records/reflections.md`（跨天教训）              |
| 比赛索引 | `data/matches_index.json`（自动生成）                                   |
| 球队代码 | `data/teams.json`（新加球队要补 code/name/flag/iso2）                   |

---

## 5. 风控红线（执行时反复对照）

- 单日仓位 ≤ 250 元
- 单笔 ≤ 总资金 10%
- 实际下注偏离推荐 ±50% 以上 → `records/<日期>.md` 写明理由
- 串关只作 2×1+3×1 试水，最大 10% 仓位
- 比分单只在小赔率高确定性场景下玩（>5 赔率不碰）
- 赔率取值一律从 `data/<日期>/*.json` 拉到的实际值，凭印象/历史赔率推荐视为违规（R-004 #7）

### 玩法硬红线（R-004 摘要）

| #   | 场景            | 硬规则                                                         |
| --- | --------------- | -------------------------------------------------------------- |
| 1   | 加时 / 点球大战 | **不算**入竞彩比分                                             |
| 2   | 混合 / 自由过关 | **不能同场不同玩法串**；不同场可以不同玩法串                   |
| 4   | 中立场主客      | **按盘口显示的"主队"**为准；让球让的是对阵表左边队伍           |
| 5   | 比分"其他"项    | 5:0/5:1/5:2 单独有赔率；**赔率按 data 拉到的值**               |
| 6   | 串关"3场-2,3关" | 系统按多关套餐自动展开 4 注（C(3,2)+C(3,3)），**不是手动拼接** |

### 串关套餐注数公式（不要手填 `combinations`）

| 套餐写法      | picks 长度 | parlayType            | 公式                 | 注数 |
| ------------- | ---------- | --------------------- | -------------------- | ---- |
| `3场-2关`     | 3          | `["2x1"]`             | C(3,2)               | 3    |
| `3场-2,3关`   | 3          | `["2x1","3x1"]`       | C(3,2)+C(3,3)        | 4    |
| `3场-3关`     | 3          | `["3x1"]`             | C(3,3)               | 1    |
| `4场-2,3,4关` | 4          | `["2x1","3x1","4x1"]` | C(4,2)+C(4,3)+C(4,4) | 11   |

---

## 6. 已知坑（预防性）

- **Chrome MCP 实例冲突**：`The browser is already running for ...` → 新页面用 `isolatedContext: "wc2026-ai-<日期>"`
- **PowerShell buffer 报错**：长命令用 `Out-String -Stream` 或拆短
- **Node ESM** `require is not defined` → 项目 `package.json` 已 `"type": "module"`，脚本统一用 `import`
- **比分表定位失败**：让球调整后 `tables[3]` 不一定是比分表，必须按表头 `"1:0"` 动态找
- **待开售场次没赔率**：spf/rqspf/bf 全 `null` 正常，售出后再补抓（写入 `rqspf_history` 第一条）
- **未在 teams.json 的球队**（如 PER/NIR）：先 `data/teams.json` 加条目再渲染，否则会 fallback 成 `?` 占位

---

## 7. 一句话唤起

```
执行每日 prompt（d:\project\github\wc2026-ai\每日执行.md）。

关注范围：仅世界杯正赛 M001-M104（其它赛事不拉不推）。
任务顺序：
1) 开子 agent 拉完赛结果 + 更新比分（仅正赛）
2) 重算积分（`node scripts/update-groups-standings.js` + `node scripts/build_teams_data.js`）
3) 统计（build_index + 消费 predictions.json 做 AI 命中复盘）
4) 拉未开赛+次日场的赔率（仅世界杯正赛，>10 场才开子 agent；is_finished_odds=true 的跳过）
5) npm run modeling:all（33_fit 拟合 + 31 预测，出 predict_31_<今日>.json）→ 再跑 node scripts/build_chat_predict.js 出 chat_predict_<今日>.json → 再跑 python3 data/strategy/daily_dual_report.py <今日> 出 出单合并_<今日>.md（31规则 + 新策略 并排对照）
6) 基于 predict_31 + 赔率市场情绪给推荐，**只写到 records/<今日>.md**（不写 data/bets.json，模拟单用户手动录）
7) git commit + push

注：AI 模拟结算、多 LLM 比分预测都不在本流程（前者单独触发、后者用户手动录入）。
临时文件放 tmp/<今日>/，完事清掉
```
