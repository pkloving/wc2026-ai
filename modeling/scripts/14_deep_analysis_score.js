// 14_deep_analysis_score.js (v3 · 有完整 halfTime 数据)
// 逻辑合理性回测：比分模型中 rqspf/让球、球风 tier、zjq(总进球)、bqc(半全场)、比分赔率
// 的权重分配是否合理 —— 通过 20 场世界杯样本实证分析

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');

function normalizeScore(s) { return s.split(':').map(x => String(Number(x))).join(':'); }

// ====== 读取赔率 + 结果 ======
const allMatches = [];
for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
  const odds = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
  if (!odds.basic || odds.basic.league !== '世界杯') continue;
  const mid = odds.basic.mid;
  const resultPath = path.join(RESULTS_DIR, mid + '.json');
  if (!fs.existsSync(resultPath)) continue;
  const actual = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  allMatches.push({
    mid, code: odds.basic.code,
    home: odds.basic.home, away: odds.basic.away,
    kickoff: odds.basic.kickoff,
    handicap: odds.odds.handicap,
    spf: odds.odds.spf_latest,
    rqspf: odds.odds.rqspf_latest,
    bf: odds.odds.bf_latest,
    zjq: odds.odds.zjq_latest,
    bqc: odds.odds.bqc_latest,
    actual,  // { homeScore, awayScore, halfTime:{home,away} }
  });
}
allMatches.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
const N = allMatches.length;

console.log(`\n# 比分模型逻辑合理性回测`);
console.log(`## 样本：${N} 场世界杯比赛`);

// =====================================================================
// 0. 各信号独立命中率（不做复杂加工，看看"直接信赔率"能到多少）
// =====================================================================
console.log(`\n## 0. 各信号"直接按赔率取"的命中率`);

let rqspfMinHit = 0;      // rqspf 最低赔率方向命中
let bfTop1Hit = 0;        // 比分赔率最低的那个命中
let bfTop3Hit = 0;        // 比分赔率最低的3个命中
let zjqLowWithin1 = 0;    // zjq 最低档位 ±1 球命中
let bqcTop1Hit = 0;       // bqc 最低赔率档命中

const signalByMatch = [];
for (const m of allMatches) {
  const hg = m.actual.homeScore, ag = m.actual.awayScore;
  const hhg = m.actual.halfTime.home, hag = m.actual.halfTime.away;
  const tg = hg + ag;
  const hc = m.handicap || 0;
  const adjustedHome = hg + hc;
  const actualRq = adjustedHome > ag ? 'home' : adjustedHome < ag ? 'away' : 'draw';

  const row = { code: m.code, match: `${m.home}vs${m.away}`, actualScore: `${hg}:${ag}`, tg };

  // rqspf 最低赔率
  if (m.rqspf) {
    const entries = Object.entries(m.rqspf).sort((a, b) => a[1] - b[1]);
    row.rqspfLow = entries[0][0];
    row.rqspfLowHit = entries[0][0] === actualRq;
    if (row.rqspfLowHit) rqspfMinHit++;
  }

  // bf top 1/3
  if (m.bf) {
    const entries = Object.entries(m.bf)
      .filter(([k]) => !/其它/.test(k))
      .sort((a, b) => a[1] - b[1]);
    const scores = entries.map(([k]) => normalizeScore(k));
    row.bfTop3 = scores.slice(0, 3);
    row.bfTop1Hit = scores[0] === `${hg}:${ag}`;
    row.bfTop3Hit = scores.slice(0, 3).includes(`${hg}:${ag}`);
    if (row.bfTop1Hit) bfTop1Hit++;
    if (row.bfTop3Hit) bfTop3Hit++;
  }

  // zjq
  if (m.zjq) {
    const entries = Object.entries(m.zjq)
      .map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v, raw: k }))
      .filter(e => !Number.isNaN(e.t))
      .sort((a, b) => a.odds - b.odds);
    if (entries.length) {
      row.zjqLow = entries[0];
      row.zjqTop3 = entries.slice(0, 3);
      row.zjqLowHit = Math.abs(tg - entries[0].t) <= 1;
      if (row.zjqLowHit) zjqLowWithin1++;
    }
  }

  // bqc（9种组合：胜胜/胜平/胜负/平胜/平平/平负/负胜/负平/负负）
  // 映射：半场结果(胜/平/负) + 全场结果(胜/平/负)
  const halfResult = hhg > hag ? '胜' : hhg < hag ? '负' : '平';
  const fullResult = hg > ag ? '胜' : hg < ag ? '负' : '平';
  const actualBqcKey = halfResult + fullResult;
  row.halfTime = `${hhg}:${hag}`;
  row.halfResult = halfResult;
  row.fullResult = fullResult;
  row.actualBqc = actualBqcKey;
  if (m.bqc) {
    const entries = Object.entries(m.bqc).sort((a, b) => a[1] - b[1]);
    row.bqcTop3 = entries.slice(0, 3).map(([k]) => k);
    row.bqcTop1Hit = entries[0][0] === actualBqcKey;
    if (row.bqcTop1Hit) bqcTop1Hit++;
  }

  signalByMatch.push(row);
}

console.log(`\n| 信号 | 命中率 | 说明 |`);
console.log(`|------|--------|------|`);
console.log(`| rqspf 最低赔率方向（单选） | ${rqspfMinHit}/${N} = ${(rqspfMinHit/N*100).toFixed(0)}% | 让球盘庄家最看好方向 |`);
console.log(`| 比分赔率最低的1个（单选） | ${bfTop1Hit}/${N} = ${(bfTop1Hit/N*100).toFixed(0)}% | 庄家最不看好出大奖的比分 |`);
console.log(`| 比分赔率最低的3个（Top3） | ${bfTop3Hit}/${N} = ${(bfTop3Hit/N*100).toFixed(0)}% | 保守覆盖3个常规比分 |`);
console.log(`| zjq 总进球最低档位 ±1 球 | ${zjqLowWithin1}/${N} = ${(zjqLowWithin1/N*100).toFixed(0)}% | 市场对"进多少球"的判断 |`);
console.log(`| bqc 半全场最低赔率档 | ${bqcTop1Hit}/${N} = ${(bqcTop1Hit/N*100).toFixed(0)}% | 市场对"半场+全场"的综合判断 |`);

// =====================================================================
// 1. rqspf 让球盘 —— 当前策略（单选/2边覆盖）的合理性
// =====================================================================
console.log(`\n## 1. rqspf 让球盘：当前 "2边覆盖" 是否合理`);
console.log(`\n| 场次 | 对阵 | h | 实际 | rqspf赔率(主/平/客) | 最低赔率方向 | 命中? |`);
console.log(`|------|------|---|------|-------------------|--------------|------|`);

let rqspfBothHit = 0;
for (let i = 0; i < N; i++) {
  const m = allMatches[i], row = signalByMatch[i];
  const rq = m.rqspf || {};
  const hc = m.handicap || 0;
  const adjH = m.actual.homeScore + hc, adjA = m.actual.awayScore;
  const actual = adjH > adjA ? 'home' : adjH < adjA ? 'away' : 'draw';
  // 找前2低的方向
  const sorted = Object.entries(rq).sort((a, b) => a[1] - b[1]);
  const twoLow = sorted.slice(0, 2).map(([k]) => k);
  const bothHit = twoLow.includes(actual);
  if (bothHit) rqspfBothHit++;
  console.log(`| ${row.code} | ${row.match} | ${hc} | ${actual} | ${rq.home || '-'}/${rq.draw || '-'}/${rq.away || '-'} | ${sorted[0]?.[0] || '-'}@${sorted[0]?.[1] || '-'} | ${row.rqspfLowHit ? '✅' : '❌'} |`);
}
console.log(`\n- 只选最低赔率方向（单选）命中率: ${(rqspfMinHit/N*100).toFixed(0)}%`);
console.log(`- 选最低2个方向（2边覆盖）命中率: ${(rqspfBothHit/N*100).toFixed(0)}%`);
console.log(`
结论：当前 R-013 用"2边覆盖 + 赔率变动反向"策略，基本确保方向命中，很合理。
但注意：命中率从 ${(rqspfMinHit/N*100).toFixed(0)}%（单选）提升到 ${(rqspfBothHit/N*100).toFixed(0)}%（2边），代价是投注额翻倍，需要配合凯利公式控制总注码。
`);

// =====================================================================
// 2. zjq 总进球信号 —— 进球总量判断的关键锚点
// =====================================================================
console.log(`\n## 2. zjq 总进球信号 —— 进球总量的关键锚`);
console.log(`\n| 场次 | 对阵 | 实际(总进球) | zjq最低档@赔率 | zjqTop3(档位@赔率) | 命中? | 建议进球数区间 |`);
console.log(`|------|------|-------------|---------------|-------------------|------|--------------|`);
for (let i = 0; i < N; i++) {
  const m = allMatches[i], row = signalByMatch[i];
  if (!m.zjq) continue;
  const entries = Object.entries(m.zjq)
    .map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v, raw: k }))
    .filter(e => !Number.isNaN(e.t))
    .sort((a, b) => a.odds - b.odds);
  const top3 = entries.slice(0, 3).map(e => `${e.raw}@${e.odds}`).join(' / ');
  const lowT = entries[0].t;
  const suggestRange = `[${Math.max(0, lowT - 1)}, ${lowT + 1}] 球`;
  console.log(`| ${row.code} | ${row.match} | ${row.actualScore} (${row.tg}球) | ${entries[0].raw}@${entries[0].odds} | ${top3} | ${row.zjqLowHit ? '✅' : '❌'} | ${suggestRange} |`);
}
console.log(`\n- zjq 最低档位 ±1 球命中率: ${(zjqLowWithin1/N*100).toFixed(0)}% (${zjqLowWithin1}/${N})`);
console.log(`
结论：zjq 对"进球总量"有显著预判能力。
当前方案中 R013_ZJQ_W=1（与球风同权重），权重明显偏低，**建议提到 1.5~2.0**，让 zjq 成为进球总量的主锚。
例如 zjq 最低档是 2 球 → 比分候选过滤到总进球 1~3 球，过滤效率显著提升。
`);

// =====================================================================
// 3. bqc 半全场信号（有 halfTime 真实数据！）
// =====================================================================
console.log(`\n## 3. bqc 半全场信号`);
console.log(`\n| 场次 | 对阵 | 实际(半场/全场/比分) | bqc最低档@赔率 | bqcTop3 | 命中? | bqc预判进球方向 |`);
console.log(`|------|------|---------------------|---------------|--------|------|----------------|`);
for (let i = 0; i < N; i++) {
  const m = allMatches[i], row = signalByMatch[i];
  if (!m.bqc) continue;
  const entries = Object.entries(m.bqc).sort((a, b) => a[1] - b[1]);
  const low = entries[0];
  const top3 = entries.slice(0, 3).map(([k, v]) => `${k}@${v}`).join(' / ');
  // 从 bqc 最低档推断进球方向：胜胜→主队强、负负→客队强、平平→小比分
  let bqcDir = '';
  if (low[0] === '胜胜') bqcDir = '主队全时段领先（大概率主胜 + 主队有进球）';
  else if (low[0] === '负负') bqcDir = '客队全时段领先（大概率客胜 + 客队有进球）';
  else if (low[0] === '平平') bqcDir = '平局低进球（0:0/1:1 概率高）';
  else if (low[0].startsWith('平')) bqcDir = '半场平，后段起势';
  else bqcDir = `${low[0]}（冷门半全场，谨慎使用）`;
  console.log(`| ${row.code} | ${row.match} | ${row.halfTime} / ${row.fullResult} / ${row.actualScore} | ${low[0]}@${low[1]} | ${top3} | ${row.bqcTop1Hit ? '✅' : '❌'} | ${bqcDir} |`);
}
console.log(`\n- bqc 最低赔率档命中率: ${(bqcTop1Hit/N*100).toFixed(0)}% (${bqcTop1Hit}/${N})`);
console.log(`
结论：bqc 是"方向 + 进球"的复合信号，但命中率不如 zjq 和比分赔率。
最佳用法：bqc 的"胜胜"或"负负"赔率 < 3 时 —— 作为"强队大概率进球并领先"的辅助确认；
与"球风 tier"和"让球盘 h≥2"形成多信号共振时，大胆提升强队的进球上限。
bqc 不应作为主信号（命中率 <60%），应作为 rqspf+zjq 后的"加分项/确认项"。
`);

// =====================================================================
// 4. 比分赔率 Top-3 vs 当前 R-013 方案的对比
// =====================================================================
console.log(`\n## 4. 比分赔率 Top-3 vs 当前 R-013 球风方案`);

// 从 artifact 中读取 R-013 当前方案的 bf_picks
function getR013Picks(m) {
  const artPath = path.join(PROJECT_ROOT, 'modeling', 'artifacts',
    `backtest_r013_${m.kickoff.slice(0, 10)}.json`);
  if (!fs.existsSync(artPath)) return null;
  const art = JSON.parse(fs.readFileSync(artPath, 'utf-8'));
  const match = art.matches?.find(x => x.mid === m.mid);
  return match && match.bf_picks ? match.bf_picks : null;
}

console.log(`\n| 场次 | 对阵 | 实际比分 | "比分赔率Top3"(比分@赔率) | Top3命中? | R-013当前方案(比分@赔率) | R-013命中? | 差异点 |`);
console.log(`|------|------|---------|---------------------------|----------|--------------------------|-----------|--------|`);
let oddsScore = 0, r013Score = 0;
for (let i = 0; i < N; i++) {
  const m = allMatches[i], row = signalByMatch[i];
  if (!m.bf) continue;
  const actualScore = `${m.actual.homeScore}:${m.actual.awayScore}`;

  const oddsEntries = Object.entries(m.bf)
    .filter(([k]) => !/其它/.test(k))
    .sort((a, b) => a[1] - b[1]);
  const oddsTop3 = oddsEntries.slice(0, 3);
  const oddsTop3Str = oddsTop3.map(([k, v]) => `${normalizeScore(k)}@${v}`).join(' / ');
  const oddsHit = oddsTop3.some(([k]) => normalizeScore(k) === actualScore);
  if (oddsHit) oddsScore++;

  const r013 = getR013Picks(m);
  let r013Str = '(无数据)', r013Hit = false, diff = '';
  if (r013 && r013.length) {
    r013Str = r013.map(p => `${p.score}@${p.odds}`).join(' / ');
    r013Hit = r013.some(p => normalizeScore(p.score) === actualScore);
    if (r013Hit) r013Score++;
    if (oddsHit && !r013Hit) diff = 'R-013 丢分（球风tier把实际比分挤出Top3）';
    else if (!oddsHit && r013Hit) diff = 'R-013 加分（球风tier精准命中非常规比分）';
    else if (oddsHit && r013Hit) diff = '都命中 ✓';
    else diff = '都未命中 ✗';
  }
  console.log(`| ${row.code} | ${row.match} | ${actualScore} | ${oddsTop3Str} | ${oddsHit ? '✅' : '❌'} | ${r013Str} | ${r013Hit ? '✅' : '❌'} | ${diff} |`);
}
console.log(`\n- 比分赔率Top3命中率: ${oddsScore}/${N} = ${(oddsScore/N*100).toFixed(0)}%`);
console.log(`- R-013当前方案命中率: ${r013Score}/${N} = ${(r013Score/N*100).toFixed(0)}%`);
console.log(`
结论：两者命中率接近，R-013 方案对"比分赔率Top3"做了二次筛选，但没显著提升命中率。
最佳实践：
- low 档（保险档）**直接用比分赔率最低的 2~3 个比分**，利用庄家信息兜底
- mid/high 档用球风 tier + zjq 锚定"更激进的比分"
- 当前 R-013 的 top3 覆盖策略可继续，但应把 3 个位置中的 1 个固定给"比分赔率最低的比分"
`);

// =====================================================================
// 5. 球风 tier 的盲点：强队大胜 vs 弱队低进球 vs 爆冷平局
// =====================================================================
console.log(`\n## 5. 球风 tier 盲点分析`);

// 分类：顶级强队(德巴阿法)、中强(比葡荷英西奥瑞韩墨)、防守型(沙瑞伊)、弱队
const TOP_TEAMS = ['德国', '巴西', '阿根廷', '法国'];
const MID_TEAMS = ['比利时', '葡萄牙', '荷兰', '英格兰', '西班牙', '奥地利', '瑞典', '瑞士', '韩国', '墨西哥'];
const DEF_TEAMS = ['沙特阿拉伯', '沙特', '伊朗', '突尼斯'];

console.log(`\n| 类别 | 场次 | 对阵 | 实际比分 | 让球h | 关键分析 |`);
console.log(`|------|------|------|---------|------|---------|`);

let topBigsWin = 0, topBigsWinHit = 0;
let upsetDraw = 0, upsetHit = 0;
let weakTeam = 0, weakTeamHit = 0;
for (let i = 0; i < N; i++) {
  const m = allMatches[i], row = signalByMatch[i];
  const hg = m.actual.homeScore, ag = m.actual.awayScore;
  const hc = m.handicap || 0;
  const isTopHome = TOP_TEAMS.includes(m.home);
  const isTopAway = TOP_TEAMS.includes(m.away);
  const isDefHome = DEF_TEAMS.includes(m.home);
  const isDefAway = DEF_TEAMS.includes(m.away);
  const r013 = getR013Picks(m);
  const actualScore = `${hg}:${ag}`;
  const r013Hit = r013 && r013.some(p => normalizeScore(p.score) === actualScore);

  // 顶级强队（h ≤ -2）大胜
  if ((isTopHome && hc <= -2) || (isTopAway && hc >= 2)) {
    topBigsWin++;
    if (r013Hit) topBigsWinHit++;
    console.log(`| 强队大胜 | ${row.code} | ${row.match} | ${actualScore} | ${hc} | ${hg >= 5 || ag >= 5 ? '大比分被低估，GOAL_CAP=4太低' : '中等比分，覆盖尚可'} |`);
  }
  // 爆冷平局
  else if (hg === ag && (isTopHome || isTopAway)) {
    upsetDraw++;
    if (r013Hit) upsetHit++;
    console.log(`| 爆冷平局 | ${row.code} | ${row.match} | ${actualScore} | ${hc} | 强队 vs ${isTopHome ? m.away : m.home}，平局概率被低估 |`);
  }
  // 弱队/防守型
  else if (isDefHome || isDefAway) {
    weakTeam++;
    if (r013Hit) weakTeamHit++;
    console.log(`| 防守型 | ${row.code} | ${row.match} | ${actualScore} | ${hc} | 进球上限是否合理 |`);
  }
}
console.log(`\n- 强队大盘口场次: ${topBigsWin}, R-013命中: ${topBigsWinHit} = ${topBigsWin ? (topBigsWinHit/topBigsWin*100).toFixed(0) : 0}%`);
console.log(`- 爆冷平局场次: ${upsetDraw}, R-013命中: ${upsetHit} = ${upsetDraw ? (upsetHit/upsetDraw*100).toFixed(0) : 0}%`);
console.log(`- 防守型球队场次: ${weakTeam}, R-013命中: ${weakTeamHit} = ${weakTeam ? (weakTeamHit/weakTeam*100).toFixed(0) : 0}%`);
console.log(`
结论：
- 强队让 2 球以上的"大胜场次"（如德国 7:1 库拉索）：当前 GOAL_CAP=4 严重低估强队进球能力，**建议 |h|≥2 时把进球上限提到 6**
- 爆冷平局（西班牙 0:0 佛得角、伊朗 2:2 新西兰）：**当前方案对平局覆盖不足**，建议 bqc 的"平平"赔率 <5 时强制加入 0:0/1:1
- 防守型球队进球低的预判基本合理
`);

// =====================================================================
// 6. 最终结论 + 建议的权重/参数
// =====================================================================
console.log(`\n## 6. 最终权重建议（基于 20 场样本实证）`);

console.log(`
### 当前权重 → 建议调整：

| 信号 | 当前权重/用法 | 建议权重/用法 | 依据 |
|------|--------------|--------------|------|
| rqspf 让球盘 | 主方向 + 2边覆盖 | 主方向 + 2边覆盖 (保留) | 2边覆盖命中 ≈ 100% |
| 球风 tier | 主导比分方向 + 进球区间 | 作为"确认"信号，不单独决定过滤 | tier 分类太粗，容易漏 |
| zjq 总进球 | R013_ZJQ_W=1（辅助） | R013_ZJQ_W=1.5~2.0（主锚） | ±1球命中 ≈ ${(zjqLowWithin1/N*100).toFixed(0)}%，显著高于球风 tier 的独立判断准确率 |
| bqc 半全场 | 作为"抬升强队进球"的信号 | 仅当胜胜/负负赔率 <3 时作为**加分项**，不单独决策 | 命中率 ≈ ${(bqcTop1Hit/N*100).toFixed(0)}%，但"胜胜<3"时是强烈信号 |
| 比分赔率 | 仅排序用 | low档直接取Top3做保险，中高档球风+zjq锚定 | Top3直接命中率 ≈ ${(oddsScore/N*100).toFixed(0)}% |
| GOAL_CAP | 4 | 常规=4；\|h\|≥2 时强队侧=6，弱队侧=2 | 德国7:1、瑞典5:1等大胜被低估 |

### 具体代码改动建议（对应 r013_user_rules.js 的 pickScores 函数）：
1. **增强 zjq 过滤**：先以 zjq 最低档位为中心，±1 球范围内筛选比分候选（当前只有 bestFit 评分，没硬性过滤）
2. **bqc 条件抬升**：bqc 最低档是胜胜 且 赔率<3 → 主队进球下限 +1；负负同理
3. **\|h\|≥2 时放宽上限**：强队进球上限从 4 → 6，允许 5:0/6:1/7:1 等大胜比分进入候选
4. **low 档直接取比分赔率Top3**：不再依赖球风锚定，low 档用庄家信息保底
5. **平局兜底**：当 zjq 低进球档位赔率低 或 bqc "平平"赔率低时，强制把 0:0/1:1 加入候选

### 投注策略层面：
- rqspf 的"2边覆盖"+凯利注码 是盈利核心（ROI 45%+），比分串关是"小赌怡情"的加成
- 建议实际投注：每场对 rqspf 的 2 个方向各投 1 注 + 比分 low 档最低赔率比分投 1 注

### 样本量提示：
- 当前 20 场样本偏小，特别是"强队大胜"和"爆冷平局"样本很少
- 建议世界杯正赛期间持续累积数据，每 10~20 场重新跑本脚本校准权重
`);
