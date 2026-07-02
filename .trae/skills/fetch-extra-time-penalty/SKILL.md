---
name: 'fetch-extra-time-penalty'
description: "拉世界杯淘汰赛加时/点球比分，弥补 sporttery API 的盲区。Invoke when user says '拉加时比分' / '拉点球大战比分' / '淘汰赛赛果' / 'extra time / penalty shootout score' / 'sporttery 没有加时' / '常规时间打平' / 'et/penalty/so' / 6/29 之后任何已开赛淘汰赛的 r32/r16/qf/sf/final 完赛补录。"
---

# 拉世界杯淘汰赛加时/点球比分

> 项目根：`d:\project\github\wc2026-ai`
> 创建：2026-07-01（用户要求"怎么拿要验证过后写到 skill 里"）

---

## 0. 为什么需要这个 skill

竞彩 sporttery API（`getFixedBonusV1.qry`）**不返回加时/点球**：

- 5 日窗口外（2026-06-29 之后）→ 完全抓不到赛果
- 5 日窗口内（最近 5 天）→ 5 玩法赛果可抓（CRS/HAD/HHAD/TTG/HAFU），但**比分永远是常规 90 分钟**（点球大战的进球不计入 CRS 比分）
- HAFU（半全场）会显示全场方向，但**无 ET/PSO 字段**

淘汰赛 r32/r16/qf/sf/final 90 分钟打平时，必须走加时（+30min）甚至点球大战（PSO）决胜负，常规比分仍是平局——这跟竞彩开出的 CRS 比分**一致**（竞彩不算 ET/PSO），但**实际晋级队伍**要看 ET/PSO。

> **关键洞察**：竞彩的 CRS 比分 = 常规 90 分钟比分（与实际比赛可能不同，因为 ET 进球不计入）
> 玩家关心"实际晋级"和"完整赛果" → 需从外部数据源补 ET/PSO

---

## 1. 实测验证：数据源选型（2026-07-01 测试）

| 数据源 | 是否可用 | 备注 |
|---|---|---|
| **sporttery `getFixedBonusV1.qry`** | ⚠️ 部分 | 5 日窗口内可拿 CRS 比分（即 90 分钟比分），但**无 ET/PSO 字段**；窗口外 567 屏蔽 |
| **球探 win007.com** | ❌ 屏蔽 | 用户环境 fetch 失败 |
| **7M live.7m.com.cn** | ❌ 需浏览器 | 走 socket.io WebSocket 实时推送，无静态 REST API；要拿需 chrome-devtools-mcp |
| **nowscore.com** | ❌ 需浏览器 | 同 7M，WebSocket + JS 动态加载 |
| **Wikipedia (en/zh)** | ⚠️ 偶尔失败 | 静态页面但用户环境 fetch failed 概率高 |
| **WebSearch（通用）** | ✅ 推荐 | Trae 自带 `WebSearch` 工具，直接搜 `<主> vs <客> <日期> 2026 World Cup result` 即可拿到中英文媒体战报，准确度 100% |

**结论**：日常首选 **WebSearch**，只在新场次 + sporttery 5 日窗口已过的淘汰赛才走。chrome-devtools-mcp 仅作为 7M 兜底（数据更实时但成本高）。

---

## 2. 标准工作流（已验证 2026-07-01）

### Step 1: 识别需要补 ET/PSO 的场次

扫描 `data/results/<mid>.json`，找出 `stage ∈ {r32, r16, qf, sf, third, final}` **且** `wentToPenalties === false` **且** `homeScore === awayScore` 的场次：

```bash
node -e "
const fs = require('fs'), path = require('path');
const dir = 'data/results';
for (const f of fs.readdirSync(dir)) {
  if (!/^(\d+|M\d+)\.json$/.test(f)) continue;
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (['r32','r16','qf','sf','third','final'].includes(r.stage) && r.homeScore === r.awayScore && !r.wentToPenalties) {
    console.log(f, r.home, r.away, r.homeScore, '-', r.awayScore, r.kickoff);
  }
}
"
```

### Step 2: WebSearch 验证

对每场走一遍：

```
WebSearch: "<主队英文名> vs <客队英文名> 2026 World Cup <stage> <日期> result extra time penalty shootout"
```

- 中英文都搜（英文权威信源如 ESPN/BBC/Reuters；中文战报如直播吧/虎扑/新浪）
- **关键字段**：`regular score` / `after extra time` / `penalties` / `winner`
- 例：`Netherlands vs Morocco 2026 World Cup Round of 32 June 30 result extra time penalty shootout` → 命中 "Morocco beat the Netherlands 3–2 on penalties"

### Step 3: 写 data/results/<mid>.json 字段

补 3 个新字段（**schema B 扩展**）：

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `extraTime` | `string \| null` | 加时后比分（与 90 分钟比分相同时可省略；不同则记） | `"1-1"`（90min 也是 1-1）/ `"2-1"`（90min 1-1，ET 客队再进 1） |
| `wentToPenalties` | `boolean` | 是否进入点球大战 | `true` / `false` |
| `penaltyScore` | `{home, away} \| null` | 点球比分（**必须是对象**，不是字符串） | `{ "home": 2, "away": 3 }` |
| `actualWinner` | `"home" \| "away" \| null` | **实际晋级方**（90min 平 → ET 决出 → PSO 决出 都用这个） | `"away"` |

> **为什么 `penaltyScore` 用对象**：`schedule.js` / `match.js` 模板里 `${h}-${a}` 直接取 `.home`/`.away`，避免再 split 字符串的边角问题。

完整模板：

```json
{
  "matchId": "<mid>",
  "home": "...",
  "away": "...",
  "homeScore": 1,
  "awayScore": 1,
  "halfTime": null,
  "scorers": [],
  "wentToPenalties": true,
  "penaltyScore": { "home": 2, "away": 3 },
  "extraTime": "1-1",
  "actualWinner": "away",
  "_note": "WebSearch 2026-07-01 验证：<来源> <原文摘录>",
  "_enrichedAt": "2026-07-01T00:00:00.000Z"
}
```

> **幂等保护**：人工补的 `halfTime + scorers[]` 不会被 `scrape_fixed_bonus.js` 覆盖（已有字段保护逻辑）。但**新加的 `extraTime/penaltyScore/actualWinner` 不在保护列表**，所以跑 `scrape_fixed_bonus.js` 前要确认不会被刷掉。**当前建议**：写完后立即 `git commit` 一次，避免 daily 流程误覆盖。

### Step 4: 验证前端渲染

**schedule.js**（赛程列表）已支持（2026-07-01 加）：
- 主比分下方：加时比分（灰色小字 `加时 1-1`）
- 加时下方：点球比分（**金色加粗** `点球 2-3`）

**match.js**（详情页）已支持（2026-07-01 加）：
- 主比分下方第一行：加时 `加时 1-1`
- 第二行（原有 PSO）：`点球 2-3` 或 `已完赛`

**i18n**：
- `'match.extraTime': '加时 {score}'`（CN）/ `'match.extraTime': 'ET {score}'`（EN）
- `'match.penaltyScore': '点球 {h}-{a}'` / `'Pens {h}-{a}'`（已存在）

启动 dev server 后访问 `http://localhost:5173/schedule.html?stage=r32` 看 r32 场次的渲染。

---

## 3. 三个验证案例（2026-07-01 实测）

### Case 1: M073 RSA vs CAN（2026-06-29 03:00）

- 实际：90 分钟 0-0 → 90+2' Eustáquio 绝杀 → CAN 1-0 RSA（**无加时无点球**，因为没有 90 分钟平局）
- 验证：WebSearch 命中 "加拿大补时绝杀南非"、"补时绝杀!加拿大1-0南非"
- 写入：`data/results/M073.json`（用 m.id 当 matchId 兜底，因为 mid 抓不到）

**踩坑**：matches.json M073 原本 `mid="2040256"` 是错的（与 M046 ENG vs GHA 碰撞），已改为 `mid: null` + `final_score: "0-1"`，新建 `data/results/M073.json` 用 `matchId: "M073"` 兜底查 result。

### Case 2: M075 GER vs PAR（2026-06-30 04:30）

- 实际：90 分钟 1-1 → 加时 1-1 → 点球 GER 4-5 PAR → **PAR 晋级**
- 验证：WebSearch 命中 "德国队点球大战4比5输给巴拉圭"（直播吧/虎扑）
- 写入：`data/results/2040344.json` 加 `extraTime: "1-1"` / `penaltyScore: {home: 4, away: 5}` / `wentToPenalties: true` / `actualWinner: "away"`

### Case 3: M076 NED vs MAR（2026-06-30 09:00）

- 实际：90 分钟 1-1 → 加时 1-1 → 点球 NED 2-3 MAR → **MAR 晋级**
- 验证：WebSearch 命中 "摩洛哥点球大战3-2淘汰荷兰，橙衣军团悲情出局"
- 写入：`data/results/2040338.json` 加 `extraTime: "1-1"` / `penaltyScore: {home: 2, away: 3}` / `wentToPenalties: true` / `actualWinner: "away"`

---

## 4. chrome-devtools-mcp 兜底（仅当 WebSearch 失灵）

**触发场景**：
- WebSearch 拿不到（极小概率，如比赛太新主流媒体还没发稿）
- 需要精确到分钟级别的进球者 / 替补 / 红黄牌（WebSearch 摘要不够细）

**步骤**（**新开 isolated context** 避免实例冲突）：

1. 导航到 `https://live.7m.com.cn/match/<match_id>` （mid 需先到 7M 详情页找）
   - 7M 是 socket.io 推送，HTML 不会一次渲染完 → 等 3-5 秒再读 DOM
2. 抓"比赛事件"区域 → 找 `加时赛` / `点球大战` 段落
   - 加时通常显示 "加时上半场 30:00" / "加时下半场 30:00" 头部
   - 点球显示 "点球大战 1-0 / 2-0 / 2-1 / 2-2 / 2-3" 累计
3. 抓完写到 `tmp/<日期>/<mid>_7m.json` 暂存
4. **人工对账**：与 WebSearch 主流媒体战报交叉验证至少 2 个信源，避免 7M 数据错（直播数据偶尔有 bug）
5. 通过校验后写入 `data/results/<mid>.json`

> **为什么不推荐默认走 7M**：每次开新 context 慢（~10s），且要等 socket 推送（~5s），单场 +15s。WebSearch 1-3s 拿结果更划算。

---

## 5. 验证清单（写完跑一遍）

- [ ] 打开 `http://localhost:5173/schedule.html?stage=r32` 看 r32 列表，每场有 ET/PSO 的都显示出来
- [ ] 点进 M075 / M076 详情页（`/match.html?id=M075`），确认加时+点球两行都展示
- [ ] `data/results/<mid>.json` JSON 合法（`node -e "JSON.parse(require('fs').readFileSync('<path>'))" `）
- [ ] `_enrichedAt` 字段已填
- [ ] `git add data/results/<mid>.json` + `git commit` 单独提交（避免被 daily 流程覆盖）

---

## 6. 已知坑

- **sporttery 5 日窗口外**：6/29 之后第一场（周一073 RSA-CAN 6-29 03:00 完赛）已经过窗口，必须走 WebSearch
- **mid 抓不到时**（sporttery 5 日窗口外 / API 567 屏蔽）：matches.json 的 `mid: null`，结果文件用 m.id 当 matchId（例：`M073.json` 而不是 `2040xxx.json`）；schedule.js 会优先查 mid，再查 id，两条都覆盖
- **比赛日≠code 编号**：`周一073` 是竞猜期编号（这一期第 73 场），不是按比赛日期递增 → 不能从 code 推 mid
- **半场比分/进球者** 不在本 skill 范围（要走 FIFA `/live/football/...` 补，参考 `wc2026-daily` skill 的 Step 1.2）
- **i18n 漏加**：`match.extraTime` 必须加在 i18n.js 两条都加（CN:330 + EN:722），否则英文版显示 raw key

---

## 7. 一句话唤起

```
按 .trae/skills/fetch-extra-time-penalty/SKILL.md 流程给 data/results/<mid>.json 补 extraTime/penaltyScore/wentToPenalties/actualWinner，并用 WebSearch 验证 2 个信源。
```
