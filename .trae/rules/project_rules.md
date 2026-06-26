# wc2026-ai Project Rules

## 数据目录约定（重要）

**统一的赔率存储 schema（schema A）**：
- `data/odds/<mid>.json` — 单场比赛的「当前赔率 + 基础信息」+ 5 玩法 latest
- `data/odds_history/<mid>.json` — 单场比赛的「历史快照」（spf_history + rqspf_history 追加）
- `data/results/<mid>.json` — 完赛结果
- `data/matches_status.json` — 中央索引，每场比赛有：
  - `odds_file: "odds/<mid>.json"`
  - `history_file: "odds_history/<mid>.json"`
  - `result_file: "results/<mid>.json"`（已完赛的）

**不要写到 `data/<YYYY-MM-DD>/<比赛名>.json` 这种格式**。

**理由**：
- 老 20 场（2040145-2040190, 2040162-2040173）已用 schema A
- `scripts/build_index.js` 只认 schema A（从 `m.history_file` 读 history 快照数）
- `scripts/scrape_fixed_bonus.js` 也只写 schema A
- 一致性 > 自包含文件

**如果以后要存当日临时数据**，请用 `data/odds/<mid>.json` 写入 + 同步 `matches_status.json`，不要新建 `data/<日期>/` 目录。

## matches_status.json 字段约定

每场比赛必备：
- `mid` (str, sporttery.cn mid)
- `code` (str, 周一013 等)
- `league` ('国际赛' | '世界杯')
- `home` / `away` (str)
- `kickoff` ('YYYY-MM-DD HH:MM')
- `status` ('scheduled' | 'on_sale' | 'in_progress' | 'finished' | 'cancelled' | 'postponed')
- `spf` (obj|null) — `{ home, draw, away }`
- `handicap` (int|null) — 让球数
- `rqspf` (obj|null) — `{ home, draw, away }`
- `odds_file` ('odds/<mid>.json')
- `history_file` ('odds_history/<mid>.json')
- 完赛时还要有 `final_score` + `result_file`

## betting 三原则

1. 模拟单（`data/bets.json`）是用户手动录入的，**不要自动写入**
2. daily 流程第 6 步只生成推荐，**不写入 bets.json**
3. 出推荐必须包含「次日比赛比分预测汇总」表

## Shell 环境（PowerShell 5 陷阱）

**当前终端是 PowerShell 5**（Trae IDE on Windows 默认），以下语法**不工作**：

1. **heredoc 语法** `$(cat <<'EOF' ... EOF)`
   - PowerShell 5 不支持，会报 "标记 && 不是此版本中的有效语句分隔符"
   - `git commit -m "..."` 配合多行 message 走 heredoc 也会失败
   - **解决**：先把 commit message 写到 `.git/COMMIT_EDITMSG_XXX` 临时文件，再用 `git commit -F <file>` 提交
2. **`&&` 链式命令**（`cmd1 && cmd2`）
   - PowerShell 5 不识别 `&&` 作为语句分隔符
   - **解决**：用 `;` 代替（`cmd1; cmd2`）
3. **管道后用 GNU coreutils**（`head`, `tail`, `find`, `grep`）
   - PowerShell 的别名是 `Select-Object -First N` 等，不支持 `head -50`
   - **解决**：用 PowerShell 原生命令，或绕开管道直接用 Node 一行命令

**典型 commit 流程（多行 message）**：
```powershell
# 1. Write 工具写 .git/COMMIT_EDITMSG_<name>
# 2. git add <files>; git commit -F .git/COMMIT_EDITMSG_<name>
# 3. DeleteFile 删临时文件（不要 commit 进去）
```

**为什么用 `.git/COMMIT_EDITMSG_XXX`**：这个路径是 Git 内部的，git status 不会显示，commit 时不会污染 staged files。

## 文件写入踩坑

**Trae IDE 的 Edit/Write 工具有时状态回滚**（success 报告但磁盘没改）：

1. **症状**：Edit 返回 `tool_result: updated successfully` + 漂亮的 cat -n snippet，但下一次 Read 显示旧内容
2. **常见场景**：
   - 同一文件连续 8+ 次 Edit
   - 并行 Edit 多段
3. **兜底策略**：
   - 重要文件写入后**立即 Read 验证**（不能信 tool 报告）
   - 状态回滚时**用 Write 全量重写**（比 Edit 可靠）
   - Write 前先 Read 拿最新状态，避免覆盖其他人的修改
4. 历史踩坑：
   - 2026-06-19 同时 8 个 Kimi 半场 Edit，4 个因重复失败，4 个状态回滚
   - 解决：Write 全量重写

## 建模经验教训（2026-06-17 与用户讨论 R-013 整理）

**赔率档位划分**（3档严格按数值，不要凭感觉）：
- **低**：< 8
- **中**：8-15
- **高**：> 15
- ⚠️ 常见错误：3:1(10) 是中档不是"不够"，10>8

**3串1 = rqspf 让球单选**（不是方向胜平负）：
- **spf < 1.5**：选 spf 对应方向（主队/客队）
- **spf 1.5-1.7**：看 rqspf 差值
- **spf 1.7-2.5**：选平
- **spf > 2.5**：选客胜
- **spf 无 + |handicap| ≤ 1**：选 rqspf 最低赔率（避开平）
- **|handicap| ≥ 2**：买 2 边（让胜+让负）
- **|handicap| ≥ 3**：买让胜+让平

**2串1 比分 C22**（2场×每场2个比分=4注）：
- 1个**低**(<8) + 1个**中**(8-15) + 1个**高**(>15)
- 比分必须与方向 A 一致
- **球风→进球数**：
  - 顶级强队（德巴阿法）：2-3球
  - 二流（比葡荷英西奥瑞韩墨）：1-2球
  - 防守型（沙瑞伊）：0-1球
  - 弱队：0-1球
  - 势均力敌：双方0-1球

**回测历史数据**（2026-06-13~16，14场 R-013 v1）：
- rqspf 单选：5/14 = 36%
- 3串1：0/7 = 0%
- 2串1 比分：0/7 = 0%
- 比分高赔率组合极难猜中，单关才能稳定赚

**R-013 脚本路径**：`modeling/scripts/12_r013_user_rules.js`
- 回测：`node 12_r013_user_rules.js <YYYY-MM-DD>`
- 预测：`node 12_r013_user_rules.js <YYYY-MM-DD> --predict`

## 比分赔率「其它」档位规则（2026-06-18 用户提醒）

**"其它"档位 = 超出已列出比分范围的兜底赔率**：
- **胜其他**：主队赢球，但比分 >= 6:0（即主队进 6 球及以上，且客队进 0 球），或主队进 6 球+客队进 N 球的全部组合
- **负其他**：客队赢球，比分 >= 0:6 同理
- **平其他**：双方打平，进球总数 >= 5（即 5:5、6:6、7:7...）

**已列出的常规比分范围**：
- 0:0 到 0:5（客队 0-5 球）
- 1:0 到 1:5（主队 1 球，客队 0-5 球）
- 2:0 到 2:5
- 3:0 到 3:5
- 4:0 到 4:5
- 5:0 到 5:5

**实际案例**：
- 德国 7-1 库拉索（周日009）→ 走「胜其他」档，因为 7:1 不在常规比分范围
- 高比分比赛（如 5:0、5:1、5:2 已在常规范围）走具体比分赔率
- 5:5 及以上平局走「平其他」

**重要**：出「其它」比分推荐前，先查 `bf_latest` 中"胜其他/平其他/负其他"的赔率，不要假定具体比分

## 已完赛汇总表 data/settled_matches.json（2026-06-18 用户要求）

**目的**：把每场比赛的 5 玩法（spf/rqspf/bf/zjq/bqc）initial/last 赔率 + 实际命中结果汇总到一个文件，方便模型找规律、算 ROI。

**文件位置**：`data/settled_matches.json`

**结构**：每场一个对象，字段：
- `mid/code/league/home/away/kickoff/handicap` — 基础信息
- `spf.rqspf.bf.zjq.bqc` 各含 `{initial, last, result}` — 5 玩法
  - spf.result ∈ {home, draw, away}
  - rqspf.result = 让球后的胜平负方向
  - bf.result = `{score: "h:a", other: "胜其它"|"负其它"|"平其它"|null}`
  - zjq.result ∈ {"0", "1", ..., "6", "7+"}
  - bqc.result ∈ {"胜胜", "胜平", ..., "负负"}
- `result` — 完赛原始：`{home, away, half, scorers_count, went_to_penalties, penalty_score}`
- `meta.history_points` — 每个玩法历史快照数

**建表命令**：
- 全量：`node scripts/build_settled.js`
- 增量（推荐）：`node scripts/build_settled.js --incremental`

**自动接入**：`modeling/scripts/12_r013_user_rules.js` 入口已加 spawn 调用 `--incremental`，跑回测/预测前自动更新表，失败仅 warning 不阻塞。

**数据源拼装**：
- `data/odds/<mid>.json` 的 `_latest` 字段（最新赔率快照）
- `data/odds_history/<mid>.json` 的 `history[0]` 是 initial、`history[len-1]` 是 last
- `data/results/<mid>.json` 完赛结果
- 增量模式只扫 `data/results/`，跟 `existingByMid` 对比 — 已有的会 rebuild（idempotent），新 result 文件会添加

**用法示例**（modeling 找规律）：
```js
const data = JSON.parse(fs.readFileSync('data/settled_matches.json', 'utf-8'));
// 找 spf 初始 < 1.5 的主胜命中率
const lowSpf = data.matches.filter(m => m.spf?.initial?.home < 1.5);
const homeWin = lowSpf.filter(m => m.spf?.result === 'home').length;
console.log(`${homeWin}/${lowSpf.length} = ${homeWin/lowSpf.length*100}%`);
```

## 按玩法维度拆视图 `data/views/`

**目的**：把 `data/settled_matches.json` 按 5 玩法拆成独立小文件，方便手工 query / 验证 / 调试，避免每次都走大源文件。

**视图文件**（`scripts/build_views.js` 产出）：
- `data/views/spf_view.json` — 20 条（注意 SPF 只有 20 场有 result，其余 6 场早期缺 spf result）
- `data/views/rqspf_view.json` — 26 条
- `data/views/bf_view.json` — 26 条
- `data/views/zjq_view.json` — 26 条
- `data/views/bqc_view.json` — 25 条
- `data/views/index.json` — 总览（generated_at + 各玩法 count）

**每条 row 字段**：`mid / code / home / away / kickoff / handicap / final_score / initial / last / result`

**手工 query 示例**（验证数据正确性）：
```bash
node -e "const r=require('./data/views/spf_view.json').rows;const h=r.filter(x=>x.result==='home').length;console.log('SPF 主胜:',h,'/',r.length,'=',(h/r.length*100).toFixed(1)+'%');"
```

**当前 26 场频率（视图文件直接读出）**：
- **SPF 主胜 12/20 = 60.0%**（注意只有 20 场有 spf.result，不是 26 场）
- **RQSPF 让胜 12/26 = 46.2%** / 让平 5/26=19.2% / 让负 9/26=34.6%
- **BQC 胜胜 8/25 = 32%** / 平平 4/25=16% / 平胜 5/25=20% / 负平 3/25=12% / 胜平 2/25=8%
- **ZJQ 2球 8/26 = 30.8%** / 4球 6/26=23.1% / 1球+3球各 3/26=11.5% / 5球+6球各 2/26=7.7% / 0球+7+球各 1/26=3.8%
- **BF 最常出现比分**：1:1 (6场) / 3:1 (3场) / 2:1+2:0+2:2+1:0 (各2场)

**WC only 23 场频率（排除 3 场国际赛后，视图文件直读）**：
- **SPF 主胜 11/19 = 57.9%** / 平 7/19=36.8% / **客胜 1/19 = 5.3%**（仅海地 vs 苏格兰 0:1）—— 客胜极低，要特别注意
- **RQSPF 让胜 12/23 = 52.2%** / 让平 3/23=**13.0%**（比全部的 19.2% 还低）/ 让负 8/23=34.8%
- **BQC** (n=22)：胜胜 6=**27.3%** / 平胜 5=**22.7%** / **平平 4=18.2%** / 负平 3=13.6% / 胜平 2=9.1% / 负负 2=9.1% / 胜负 0% / 平负 0% / 负胜 0%
- **ZJQ** (n=23)：2球 8=**34.8%**（比全部的 30.8% 还高）/ 4球 4=17.4% / 1球 3=13% / 3+5+6 球各 2=8.7% / 0+7+球各 1=4.3%
- **BF**：1:1 仍是最高频（5场），其次 3:1 (3场) / 2:1+2:0+2:2+1:0 (各 2 场)

**接入**：`modeling/scripts/31_tight_anti_value.js` 入口已加 spawn 调用 `scripts/build_views.js`，跑回测/预测前自动重建视图。

**非世界杯的 3 场**：荷兰 2:1 乌兹别克（国际赛）/ 法国 - 北爱尔兰（缺 spf）/ 秘鲁 1:3 西班牙（国际赛 客胜）—— 这 3 场 build_views 默认全输出，但生成 `*_wc_view.json` 排除它们

**SPF n=20 vs 26 原因（4 场世界杯 + 2 场国际赛 spf 缺 result）**：
- 世界杯 4 场 spf.initial 和 spf.last 都是 null：卡塔尔 vs 瑞士、德国 vs 库拉索、西班牙 vs 佛得角、伊拉克 vs 挪威
- 推测 sporttery.cn 这 4 场**没开 spf 玩法**（只开了 rqspf/bf/zjq/bqc）
- 不是 build_settled bug，是数据源就没有

---

## 高 ROI 规律提炼 `modeling/scripts/32_roi_insights.js`

- **位置**：`modeling/scripts/32_roi_insights.js`
- **输入**：`data/settled_matches.json`（由 `scripts/build_settled.js` 产出）
- **输出**：
  - `modeling/artifacts/roi_insights.json`：结构化规律文件，供 `31_tight_anti_value.js` 读
  - 控制台：分桶事实陈述 + TOP 建议列表
- **核心思路**：按"规则模拟"算 ROI（每场选 N 个候选，整场算 1 次命中），不是"按候选摊开"算（那种没意义，因为不可能每场买 30 个比分赌 1 个中）
- **统计维度**：
  - SPF：主胜赔率分桶（<1.5 / 1.5-2.5 / 2.5-5 / 5+）的主/平/客命中率
  - BF 比分：8 种选号规则模拟（每场 N 个最低/最高、跟盘/反方向）的 ROI
  - BF 比分：实际总进球分布（0-1 / 2-3 / 4-5 / 6+）
  - 单关：4 种选号规则模拟的 ROI
  - 赔率漂移：spf 主胜 initial→last 的降/升/平的主胜命中率和 ROI
  - 让球 × 方向：让 1/2/3+ 球的主/平/客命中率
- **小样本 warning**：N < 5 的桶标 `⚠️样本<5`
- **用法**：
  ```bash
  node modeling/scripts/32_roi_insights.js             # 打控制台摘要
  node modeling/scripts/32_roi_insights.js --quiet     # 只写文件
  ```
- **被谁调用**：
  - `modeling/scripts/12_r013_user_rules.js`（用户规则建模，入口已加 spawn）
  - `modeling/scripts/31_tight_anti_value.js`（主模型策略，入口已加 spawn）
- **关键 bug 修复**（2026-06-18）：
  - `bf.result.score` 是 "1:1"（无前导零），但 `bf.initial.odds` 的 key 是 "01:01"——`isHit` 必须 `normalizeScore` 后比较
  - `其它` 候选的 `other` 字段必须与 `bf.result.other` 同名（"胜其它"/"负其它"/"平其它"），不能用 `replace('其它', '')` 简化
- **TOP 建议结构**（`roi_insights.top_advices`）：18 条左右事实陈述，按 spf / bf 规则 / 总进球分布 / 单关 / 漂移 / 让球 分组
- **31 怎么用**：
  - `runPredict` 顶部打印 `TOP 建议` 前 8 条
  - `pickSingleCount(['反方向'], 2)` / `pickSingleCount(['任意'], 2)`：单关数量按 insights 的 "1 个 vs 2 个" ROI 自动调整
  - 主池（F4）目前**不**用 insights 改（保留原策略，避免过度拟合）
- **RQSPF/ZJQ/BQC 规则模拟**（2026-06-18 扩展）：
  - RQSPF 7 条按赔率选 + **7 条固定买**（home/draw/away/组合 4 种）：核心是验证"固定买某个方向" ROI
  - ZJQ 6 条按赔率选 + **8 条单球/组合固定买**（0~7+ / 0+1 / 1+2 / 0+1+2 / 2+3 / 4+5 / 4+5+6+7+ / 0~4 / 3~7+）
  - BQC 5 条按赔率选 + **9 条单 key/组合固定买**（9 个单 key + 8 个组合：胜胜+平平、胜胜+平平+负负、胜胜+胜平+平胜+平平 等）
  - 每块都先打**频率统计**，再打 ROI 排序
  - **关键发现 (26 场样本)**：
    - RQSPF「每场选最低赔率方向」命中 57.7%, **ROI +16.6%** —— 唯一稳定正 ROI 的多场规则
    - RQSPF「固定买让胜(home)」命中 46.2%, **ROI +11.7%** —— 单买最强（让胜频率 46.2% 是 RQSPF 最高）
    - RQSPF「固定买让平(draw)」命中 19.2%, **ROI -27.7%** —— **强烈不建议**（平率最低 + 赔率也不高）
    - RQSPF「固定买三门(保底)」命中 100%, **ROI -11.2%** —— 命中率 100% 但赔率抽水
    - ZJQ「固定买 6 球」命中 7.7%, **ROI +100%**（7+ 球冷门，样本少）
    - ZJQ「固定买 0 球」命中 3.8%, **ROI +61.5%**（冷门）
    - ZJQ「固定买 4 球」命中 23.1%, **ROI +18.3%**（4 球频率 23.1% 不错）
    - ZJQ「固定买 0+1+2 保守小球」命中 46.2%, **ROI +4.4%**（最稳的小球组合，覆盖 46% 比赛）
    - ZJQ「固定买 4+5+6+7+ 全大球」命中 42.3%, **ROI +6.7%**（最稳的大球组合）
    - BQC「固定买负平」命中 12%, **ROI +142%**（小众但赔率极高）
    - BQC「固定买平平」命中 16%, **ROI +44%**（平局平局两次都是平）
    - BQC「固定买胜平」命中 8%, **ROI +42%**
    - **BQC「固定买胜平+平平」命中 24%, ROI +43%**（用户重点问的组合买）
    - **BQC「固定买胜胜+平平(主+平二选一)」命中 48%, ROI +19.3%**（用户重点问的胜胜+平平组合）
    - BQC「固定买胜胜+胜平+平胜+平平(主/平主导4选)」命中 76%, **ROI +19.7%**（覆盖 76% 比赛）
    - BQC 全部按赔率排序选号 ROI 都负（9 选 1 命中率天然低）
- **赔率纠偏规则**（2026-06-18 第三轮，固定买 + 赔率过滤）：
  - 给每条固定买规则，加 `*OddsFiltered` 模拟器（带 filterFn 过滤赔率分桶/漂移/让球配合），看哪些过滤能拉高 ROI
  - RQSPF 让胜纠偏：让胜 1.5-2.0 主流盘 → 命中 4/6=66.7%, **ROI +20.5%**（让胜基础 ROI +11.7% 提升到 +20.5%）
  - RQSPF 让胜+让负 纠偏：升赔方向 (last都升=市场不看好该组合) → 命中 5/5=**100%**, ROI **+35.4%** ⚠️ n=5
  - RQSPF 让胜+让平 纠偏：组合max赔率>=3.5 → 命中 9/13=69.2%, ROI +8%
  - ZJQ 2球纠偏：初赔 2.5-3.5 主流盘 → 命中 6/15=40%, **ROI +24.7%**（2球基础 ROI +1% 提升到 +24.7%）
  - ZJQ 0+1+2 纠偏：2球初赔>=3.0 冷门跳过 → 命中 9/21=42.9%, ROI +14.8%
  - ZJQ 4+5+6+7+ 纠偏：4球赔率>=4.0 (市场看衰大球) → 命中 10/24=41.7%, ROI +10.6%
  - **BQC 胜胜+平平 纠偏：胜胜赔率<2.0 (市场看好主队赢到底)** → 命中 7/8=87.5%, **ROI +110.4%** ⚠️ n=8 ⭐⭐⭐ 最强纠偏
  - BQC 胜胜+平平 纠偏：组合avg赔率>=4.0 冷门盘 → 命中 10/19=52.6%, ROI +35.8%
  - BQC 胜胜+平平 纠偏：平平赔率>=3.5 (市场看衰全平) → 命中 12/25=48%, ROI +19.3%
  - BQC 平平纠偏：初赔>=4.0 → 命中 4/24=16.7%, ROI +50%
  - BQC 平平纠偏：初赔>=5.0 → 命中 4/19=21.1%, ROI +89.5%
  - BQC 负平纠偏：初赔>=8 (大冷门盘) → 命中 3/25=12%, ROI +142% ⭐⭐ 仍是 ROI 之王
  - BQC 胜胜+胜平+平胜+平平 纠偏：组合avg赔率>=3.0 → 命中 19/25=76%, ROI +19.7%
- **RQSPF 频率**(26 场)：让胜 46.2% / 让平 19.2% / 让负 34.6% —— **让胜最高**
- **ZJQ 频率**(26 场)：0球3.8% / 1球11.5% / **2球30.8%** / 3球11.5% / 4球23.1% / 5球7.7% / 6球7.7% / 7+球3.8% —— **2 球最高**
- **BQC 频率**(25 场)：胜胜32% / 胜平8% / 胜负0% / 平胜20% / **平平16%** / 平负0% / 负胜0% / 负平12% / 负负0% —— **胜胜最高**
- **31 跟投函数**（[31_tight_anti_value.js](file:///d:/project/github/wc2026-ai/modeling/scripts/31_tight_anti_value.js)）：
  - `rqspfStrategy(m)`：让胜赔率 [1.5, 2.0) 优先选让胜 (纠偏+20.5%), 否则选最低赔率 (基线+16.6%)
  - `zjqStrategy(m)`：2球赔率 [2.5, 3.5) 优先 2 球 (纠偏+24.7%), 否则让球→大/小球 (基线+3.1%)
  - `bqcStrategy(m)`：胜胜赔率 < 2.0 选 胜胜+平平 (纠偏+110.4%), 否则 TOP3 (基线-10%)
  - `runPredict` 主报告后新增 3 段：RQSPF 跟投表 / ZJQ 跟投表 / BQC 跟投表，每行都标 `⭐纠偏规则` 或 `基线`
  - `runBacktest` 末尾新增 `## 31号策略 跟投 + 纠偏回测` 段，验证 3 条纠偏实战 ROI
- **31 跟投 + 纠偏回测结果**（23 场 WC only, 2026-06-18）：
  - **RQSPF 跟投**: 全部 23 场 14 命中 / $23 / $28.11 / **+22.2%** ROI；纠偏命中 2 场 (胜赔1.5-2.0) 2 中 2 / $2 / $3.43 / **+71.5%** ROI
  - **ZJQ 跟投**: 全部 23 场 6 命中 / $23 / $18.70 / -18.7% ROI；纠偏命中 15 场 (2球赔2.5-3.5) 6 中 6 / $15 / $18.70 / **+24.7%** ROI
  - **BQC 跟投**: 全部 22 场 13 命中 / $60 / $59.28 / -1.2% ROI；纠偏命中 6 场 (胜胜赔<2.0) 5 中 6 / $12 / $31.09 / **+159.1%** ROI ⭐⭐⭐
  - **结论**: RQSPF 跟投全样本已 +22.2%（不靠纠偏也赚），ZJQ/BQC 必须靠纠偏过滤才有正 ROI，纯基线是负的
  - 15/23 场 ZJQ 触发纠偏（命中率 65%）—— 实际 2 球赔率在 [2.5, 3.5) 很常见
  - 6/22 场 BQC 触发纠偏（27%）—— 胜胜赔率 < 2.0 不算稀有，但命中率 5/6 = 83% 是关键优势

## 球队分层数据源 `data/teams/`（2026-06-18 升级）

**目录结构**：
- `data/teams/_index.json` — 总索引 (generated_at / by_code / by_name / by_tier / by_group / name_variants_to_code)
- `data/teams/<CODE>.json` — 单队详情 (code / name / meta.tier / meta.stars / meta.has_scorer_star / wc2026)

**`_index.json` 关键字段**：
- `by_tier.top` (4) / `second` (20) / `defensive` (5) / `weak` (27) / `unknown` (1) — code 数组
- `by_name` — 中文名 → code 反查 (e.g. `"英格兰": "ENG"`)
- `name_variants_to_code` — 别名 (e.g. `"沙特": "KSA"` / `"乌兹别克": "UZB"` / `"刚果(金)": "COD"`)
- `by_group` — A~L 共 12 组，每组 4 队

**单队 json 关键字段** (`meta`)：
- `tier` — top / second / defensive / weak / unknown
- `has_scorer_star` — bool，是否有明星射手（姆巴佩/哈兰德/C罗/凯恩/孙兴慜等）
- `stars` — 球员名数组（"凯恩", "贝林厄姆" 等）
- `is_host` — 是否东道主（CAN/MEX/USA = true）
- `fifa_rank` — FIFA 排名（暂未填）

**31/32 脚本 `loadTeams()` 动态加载**（替代硬编码 5 数组）：
- 启动时读 `_index.json` 拿 by_tier + by_name + name_variants_to_code
- 扫 57 个 team json 文件 → 构造 `scorerStarCodes: Set<code>`
- `getTeamTier(name)` / `hasScorerStar(name)` 用动态数据，不再硬编码

**当前 18 个 has_scorer_star=true 队**（动态扫描得出）:
- top (3): ARG 阿根廷, FRA 法国, GER 德国（**缺巴西**，需补）
- second (12): CAN 加拿大, EGY 埃及, ENG 英格兰, ESP 西班牙, JPN 日本, KOR 韩国, MEX 墨西哥, NED 荷兰, NOR 挪威, POR 葡萄牙, URU 乌拉圭, USA 美国
- defensive (1): ALG 阿尔及利亚, DZA（重复映射到 ALG）
- weak (0)
- **注意**: 巴西 BRA 不在射手星列表（_index.json 缺 meta.has_scorer_star=true），需补 = true
- **注意**: 比利时 BEL 也不在（但有德布劳内/卢卡库），需补

**核心修复**（用户洞察 2026-06-18）：
- 原来 31 硬编码 5 个数组 (TOP_TIER/SECOND_TIER/DEFENSIVE/WEAK_TEAMS/SCORER_STAR_TEAMS) 维护成本高
- 改用 `data/teams/_index.json` + 单队 json 单一数据源，增减球队只改 `data/teams/` 目录
- 31 脚本 [`loadTeams()`](file:///d:/project/github/wc2026-ai/modeling/scripts/31_tight_anti_value.js#L85-117) 函数 + [`getTeamTier()`](file:///d:/project/github/wc2026-ai/modeling/scripts/31_tight_anti_value.js#L124-128) / [`hasScorerStar()`](file:///d:/project/github/wc2026-ai/modeling/scripts/31_tight_anti_value.js#L129-133)
- 32 脚本 `loadTeams_32()` 函数同样逻辑

## 31 触发条件按比赛类型拆分（2026-06-18 用户洞察升级）

**之前的 bug**：
- 31 脚本里 zjqStrategy 只看"2 球赔率 [2.5, 3.5)"触发 → 4 场全触发 2 球 (没看 handicap / 球队强弱)
- bqcStrategy 只看"胜胜赔率 < 2.0"触发 → 4 场推 胜胜+平平 (没看 handicap)
- 实战：022 推 2 球 (实际 6 球错) + 023 推 2 球 (实际 1 球错) + 021 推 胜胜+平平 (实际平平, ✅ 中)
- 22 场回测里 BIG_BALL 走 0+1+2 才 +205% ROI (反市场冷门), 但 31 旧版不给 BIG_BALL 触发

**修复后的触发逻辑**（v3，2026-06-18 23:00 验证）:

| 玩法 | 比赛类型 | 触发条件 | 推荐 | 实战 ROI (n) |
|---|---|---|---|---|
| ZJQ | NORMAL | 2 球赔率 [2.5, 3.5) | 2 球 (1 注) | **+71.1%** (n=9) ⭐ |
| ZJQ | BIG_BALL | 无 | 0+1+2 (3 注) | **+205%** (n=5) ⭐⭐ 反市场冷门 |
| ZJQ | WEAK_MATCH | 无 | 0+1+2 (3 注) | **+10%** (n=5) ⭐ |
| ZJQ | (兜底) | 都不满足 | 冷门 + 稳定 | 基线 +3.1% |
| BQC | BIG_BALL | 胜胜赔率 < 2.0 | 胜胜+平平 (2 注) | **+201.4%** (n=5) ⭐⭐⭐ |
| BQC | NORMAL | 胜胜赔率 < 2.0 | 胜胜+平平 (2 注) | -41.3% (n=3) ⚠️样本<5 |
| BQC | (兜底) | 都不满足 | TOP3 最低赔率 | 基线 -10% |
| RQSPF | (通用) | 让胜赔率 [1.5, 2.0) | 让胜 (1 注) | +71.5% (n=2) |
| RQSPF | (兜底) | 不满足 | 让胜 + 让负 (最低赔率 2 个) | 基线 +16.6% |

**v3 实战 23 场回测结果**:
- **ZJQ 跟投**: 全部 23 场 11 命中 / $45 / $77.90 / **+73.1%** ROI ⭐⭐ (旧版 -18.7% → 新版 +73.1%)
- **BQC 跟投**: 全部 22 场 13 命中 / $60 / $59.28 / -1.2% ROI (靠 BIG_BALL 纠偏 6 场 5 中 6 +159.1% 拉回)
- **RQSPF 跟投**: 14 命中 / $23 / $28.11 / +22.2% ROI (稳定)

**关键 bug 修复**: 31 脚本 [`runBacktest`](file:///d:/project/github/wc2026-ai/modeling/scripts/31_tight_anti_value.js#L760) 段原来给 zjqStrategy / bqcStrategy 只传 `{zjq, handicap}` → classifyMatch 拿不到 home/away, 永远返回 NORMAL, BIG_BALL/WEAK_MATCH 全部走基线错
- 修法: 传完整 `m` (含 home/away/handicap/odds)

**今日 4 场 v3 实战结果**（2026-06-18）:
- 周三021 葡萄牙 vs 刚果(金) BIG_BALL: ZJQ 0+1+2 推 3 注 (实际 2 球中 1 注 @4) + BQC 胜胜+平平 推 2 注 (实际 平平中 1 注 @8.2) → 投入 5 注, 回报 12.2 → **+144%**
- 周三022 英格兰 vs 克罗地亚 NORMAL: ZJQ 2 球 推 1 注 (实际 6 球未中) → 投入 1 注 输 → -100%
- 周三023 加纳 vs 巴拿马 WEAK_MATCH: ZJQ 0+1+2 推 3 注 (实际 1 球中 1 注 @5) → 投入 3 注, 回报 5 → +66.7%
- 周三024 乌兹别克 vs 哥伦比亚 NORMAL (待赛 10:00): 0 场触发 → 走基线 RQSPF 让负@1.81 / ZJQ 7+球@29+2 球@3.55 / BQC TOP3 负负@1.79

## 5 玩法完整频率分布（控制台柱状图，2026-06-18）

`32_roi_insights.js` 控制台末尾新增 "**5 玩法完整频率分布**" 段，直接从 `data/views/` 读，展示每个玩法所有 key/比分的出现次数+百分比+柱状图（███）+ 高低频标记（⭐高频 / ⚠️低频 / ❌从未出现）。

**当前 26 场（直读视图文件）**：

| 玩法 | key | 次数 | 频率 |
|---|---|---|---|
| **SPF** (n=20) | 主胜 / 平局 / 客胜 | 12 / 7 / 1 | 60% / 35% / 5% |
| **RQSPF** (n=26) | 让胜(主) / 让平 / 让负(客) | 12 / 5 / 9 | 46.2% / 19.2% / 34.6% |
| **BF 比分** (n=26) | 1:1 / 3:1 / 2:1 / 2:0 / 2:2 / 1:0 / 1:3 / 4:1 / 0:1 / 胜其它 / 5:1 / 0:0 / 1:4 / 3:0 / 4:2 | 6 / 3 / 2 / 2 / 2 / 2 / 1 / 1 / 1 / 1 / 1 / 1 / 1 / 1 / 1 | 23.1% / 11.5% / 7.7% ×4 / 3.8% ×8 |
| **ZJQ** (n=26) | 0 / 1 / 2 / 3 / 4 / 5 / 6 / 7+ | 1 / 3 / 8 / 3 / 6 / 2 / 2 / 1 | 3.8% / 11.5% / **30.8%** / 11.5% / 23.1% / 7.7% ×2 / 3.8% |
| **BQC** (n=25) | 胜胜 / 胜平 / 胜负 / 平胜 / 平平 / 平负 / 负胜 / 负平 / 负负 | 8 / 2 / 0 / 5 / 4 / 0 / 0 / 3 / 3 | **32%** / 8% / ❌0% / **20%** / **16%** / ❌0% / ❌0% / 12% / 12% |

**柱状图宽度规则**：
- BF：max=6 (1:1) → 30 格
- ZJQ/BQC：每行自己的 max 拉伸到 30 格
- 高低频阈值（用户可改）：
  - ZJQ：≥20% 高频，≤5% 低频
  - BQC：≥20% 高频，=0% 标"从未出现"，≤5% 低频
  - RQSPF：≥35% 高频，≤20% 低频
  - BF：≥20% 高频

