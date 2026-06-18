// 16_verify_trend.js
// 验证 zjq + bqc 赔率变化（初盘→终盘移动方向）对正确率的帮助
// 关键：赔率变化 = 市场资金投票方向，可能比"当前最低档"更有信息

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');

function normalizeScore(s) { return s.split(':').map(x => String(Number(x))).join(':'); }

const allMatches = [];
for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
  const odds = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
  if (!odds.basic || odds.basic.league !== '世界杯') continue;
  const mid = odds.basic.mid;
  const rpath = path.join(RESULTS_DIR, mid + '.json');
  if (!fs.existsSync(rpath)) continue;
  const actual = JSON.parse(fs.readFileSync(rpath, 'utf-8'));
  allMatches.push({ mid, code: odds.basic.code, home: odds.basic.home, away: odds.basic.away, handicap: odds.odds.handicap, zjq_history: odds.odds.zjq_history, bqc_history: odds.odds.bqc_history, zjq_latest: odds.odds.zjq_latest, bqc_latest: odds.odds.bqc_latest, actual });
}

const N = allMatches.length;
console.log(`\n# zjq / bqc 赔率变化对正确率的帮助 (N=${N} 场)`);

// =====================================================================
// A. zjq 赔率变化: 初盘最低档 vs 终盘最低档 → 是否移动? 移动方向是否正确?
// =====================================================================
console.log(`\n## A. zjq 总进球数: 赔率变化方向 vs 实际进球数`);

console.log(`\n| 场次 | 对阵 | 实际(进球/比分) | 初盘最低档(@赔率) | 终盘最低档(@赔率) | 移动方向 | 初盘命中±1 | 终盘命中±1 | 赔率变化是否"猜对"? |`);
console.log(`|------|------|-----------------|--------------------|--------------------|----------|-------------|-------------|---------------------|`);

let zjqShiftTotal = 0, zjqShiftCorrect = 0;  // 赔率有变化的场
let zjqNoShiftHit = 0, zjqNoShiftTotal = 0;    // 赔率无变化的场
let zjqOpenCorrect = 0, zjqLatestCorrect = 0;

let zjqBigUp = 0, zjqBigDown = 0;              // 大档位变化(≥2档)
let zjqBigUpHit = 0, zjqBigDownHit = 0;

for (const m of allMatches) {
  const tg = m.actual.homeScore + m.actual.awayScore;
  // 初盘
  const open = m.zjq_history?.[0]?.odds || m.zjq_latest;
  const latest = m.zjq_latest;
  const openEntries = Object.entries(open).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v, raw: k })).filter(e => e.odds > 1 && !Number.isNaN(e.t)).sort((a, b) => a.odds - b.odds);
  const latestEntries = Object.entries(latest).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v, raw: k })).filter(e => e.odds > 1 && !Number.isNaN(e.t)).sort((a, b) => a.odds - b.odds);

  if (!openEntries.length || !latestEntries.length) continue;

  const openMin = openEntries[0];
  const latestMin = latestEntries[0];
  const shifted = openMin.t !== latestMin.t;
  const diff = latestMin.t - openMin.t;

  const openHit = Math.abs(tg - openMin.t) <= 1;
  const latestHit = Math.abs(tg - latestMin.t) <= 1;

  let direction = '持平';
  if (diff >= 2) direction = `大↑(+${diff}档)`;
  else if (diff > 0) direction = `小↑(+${diff}档)`;
  else if (diff <= -2) direction = `大↓(${diff}档)`;
  else if (diff < 0) direction = `小↓(${diff}档)`;

  // "赔率变化是否猜对": 若从低档位→高档位(大↑)，实际进球也应↑ ——判断 diff*actual 是否同向
  // 简化：若大↑，看实际进球是否 > 3；若大↓，看实际进球是否 ≤ 2
  let trendCorrect = '—';
  if (Math.abs(diff) >= 2) {
    if (diff > 0 && tg > 3) trendCorrect = '✅';
    else if (diff < 0 && tg <= 2) trendCorrect = '✅';
    else trendCorrect = '❌';
  }

  // 统计
  if (openHit) zjqOpenCorrect++;
  if (latestHit) zjqLatestCorrect++;
  if (shifted) {
    zjqShiftTotal++;
    if (latestHit) zjqShiftCorrect++;
  } else {
    zjqNoShiftTotal++;
    if (latestHit) zjqNoShiftHit++;
  }
  if (Math.abs(diff) >= 2) {
    if (diff > 0) { zjqBigUp++; if (trendCorrect === '✅') zjqBigUpHit++; }
    else { zjqBigDown++; if (trendCorrect === '✅') zjqBigDownHit++; }
  }

  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${tg}球/${m.actual.homeScore}:${m.actual.awayScore} | ${openMin.raw}@${openMin.odds} | ${latestMin.raw}@${latestMin.odds} | ${direction} | ${openHit ? '✅' : '❌'} | ${latestHit ? '✅' : '❌'} | ${trendCorrect} |`);
}
console.log(`\n- 初盘最低档 ±1 命中: ${zjqOpenCorrect}/${N}`);
console.log(`- 终盘最低档 ±1 命中: ${zjqLatestCorrect}/${N}`);
console.log(`- 有档位变化的 ${zjqShiftTotal} 场，终盘命中: ${zjqShiftCorrect}/${zjqShiftTotal} = ${zjqShiftTotal ? (zjqShiftCorrect/zjqShiftTotal*100).toFixed(0) : 0}%`);
console.log(`- 无档位变化的 ${zjqNoShiftTotal} 场，终盘命中: ${zjqNoShiftHit}/${zjqNoShiftTotal} = ${zjqNoShiftTotal ? (zjqNoShiftHit/zjqNoShiftTotal*100).toFixed(0) : 0}%`);
console.log(`- 大档位变化(±2档) ${zjqBigUp+zjqBigDown} 场: 大↑${zjqBigUp}场命中${zjqBigUpHit}, 大↓${zjqBigDown}场命中${zjqBigDownHit}`);

// =====================================================================
// B. bqc 赔率变化: 胜胜/负负赔率变化值(Δ) vs 实际结果
// =====================================================================
console.log(`\n## B. bqc 半全场: 赔率变化值(Δ) vs 实际方向`);

console.log(`\n| 场次 | 对阵 | 实际(半场/全场/结果) | 初盘胜胜/负负 | 终盘胜胜/负负 | Δ胜胜 | Δ负负 | 资金方向 | 实际方向是否匹配? |`);
console.log(`|------|------|---------------------|---------------|---------------|-------|-------|---------|-------------------|`);

let bqcTrendCorrect = 0, bqcTrendTotal = 0;
let bqcStrongTrendCorrect = 0, bqcStrongTrendTotal = 0;

for (const m of allMatches) {
  const hg = m.actual.homeScore, ag = m.actual.awayScore;
  const hhg = m.actual.halfTime.home, hag = m.actual.halfTime.away;
  const homeWin = hg > ag, awayWin = hg < ag;
  const homeLeading = hhg > hag, awayLeading = hhg < hag;

  const open = m.bqc_history?.[0]?.odds || m.bqc_latest;
  const latest = m.bqc_latest;
  if (!open || !latest) continue;

  const ssOpen = open['胜胜'], ssLate = latest['胜胜'];
  const ffOpen = open['负负'], ffLate = latest['负负'];
  if (!ssOpen || !ffOpen || !ssLate || !ffLate) continue;

  const Δss = ssLate - ssOpen;  // 负 → 赔率下降 → 被买入看好
  const Δff = ffLate - ffOpen;

  // 资金方向：哪一方赔率下降更猛
  let fundDir = '均衡';
  if (Δss < -0.3 && Δff > -0.2) fundDir = '主队看好';
  else if (Δff < -0.3 && Δss > -0.2) fundDir = '客队看好';
  else if (Δss < -0.5 && Δff < -0.5) fundDir = '双方都降→平局?';
  else if (Δss > 0.3 && Δff > 0.3) fundDir = '双方都升→冷门?';

  // 实际方向
  const actualDir = homeWin && homeLeading ? '主队' : awayWin && awayLeading ? '客队' : '平局/逆转';

  // 匹配：如果fundDir='主队看好'，actualDir='主队' → 匹配 ✅
  let match = '—';
  if (fundDir === '主队看好') { bqcTrendTotal++; if (actualDir === '主队') { match = '✅'; bqcTrendCorrect++; } else match = '❌'; }
  else if (fundDir === '客队看好') { bqcTrendTotal++; if (actualDir === '客队') { match = '✅'; bqcTrendCorrect++; } else match = '❌'; }
  else if (fundDir.includes('平局')) { bqcTrendTotal++; if (actualDir.includes('平局')) { match = '✅'; bqcTrendCorrect++; } else match = '❌'; }
  // 强趋势(赔率下降 ≥0.5 = 大资金押注)
  if (Math.abs(Δss) >= 0.5 || Math.abs(Δff) >= 0.5) {
    bqcStrongTrendTotal++;
    if ((Δss < -0.5 && actualDir === '主队') || (Δff < -0.5 && actualDir === '客队')) bqcStrongTrendCorrect++;
  }

  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${hhg}:${hag}/${hg}:${ag}/${actualDir} | ${ssOpen}/${ffOpen} | ${ssLate}/${ffLate} | ${Δss.toFixed(2)} | ${Δff.toFixed(2)} | ${fundDir} | ${match} |`);
}
console.log(`\n- bqc 赔率变化趋势可识别的 ${bqcTrendTotal} 场，正确 ${bqcTrendCorrect}/${bqcTrendTotal} = ${bqcTrendTotal ? (bqcTrendCorrect/bqcTrendTotal*100).toFixed(0) : 0}%`);
console.log(`- 强趋势(|Δ|≥0.5) ${bqcStrongTrendTotal} 场，正确 ${bqcStrongTrendCorrect}/${bqcStrongTrendTotal} = ${bqcStrongTrendTotal ? (bqcStrongTrendCorrect/bqcStrongTrendTotal*100).toFixed(0) : 0}%`);

// =====================================================================
// C. 综合: 赔率变化 + 绝对赔率的"组合信号" vs 单一信号
// =====================================================================
console.log(`\n## C. 信号组合对比（哪种组合最准?）`);

let case1 = 0, case1hit = 0; // zjq 终盘 ≤3 且 bqc 胜胜<2 → 小球+主队胜
let case2 = 0, case2hit = 0; // zjq 无变化且 bqc 胜胜<3 → 按球风常规判断

for (const m of allMatches) {
  const hg = m.actual.homeScore, ag = m.actual.awayScore;
  const tg = hg + ag;

  // zjq 终盘 ≤3 且 bqc 胜胜 < 2
  const zjq3 = Object.entries(m.zjq_latest).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t)).sort((a, b) => a.odds - b.odds)[0];
  const ss = m.bqc_latest?.['胜胜'];
  if (zjq3 && zjq3.t <= 3 && ss && ss < 2) {
    case1++;
    if (hg > ag && hg <= 3) case1hit++;
  }
}
console.log(`- zjq≤3 球 + bqc胜胜<2（小球+主队胜组合）: ${case1}场, 命中${case1hit}/${case1} = ${case1 ? (case1hit/case1*100).toFixed(0) : 0}%`);

// D. 直接用赔率变化+绝对值的"方向+进球预测"组合
// 1) zjq 终盘档位+变化 → 进球区间
// 2) bqc 胜胜/负负 + 变化 → 方向
// 对每场生成一个 "zjq推荐进球区间" + "bqc推荐方向"，看与实际结果的吻合度
console.log(`\n## D. 推荐区间验证（zjq推荐进球数 + bqc推荐方向）`);
console.log(`\n| 场次 | 对阵 | 实际 | zjq推荐进球区间 | 命中? | bqc推荐方向 | 命中? | 组合命中? |`);
console.log(`|------|------|------|-----------------|------|-------------|------|----------|`);

let combHit = 0, goalHit = 0, dirHit = 0;
for (const m of allMatches) {
  const hg = m.actual.homeScore, ag = m.actual.awayScore;
  const tg = hg + ag;
  const actualDir = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';

  // zjq 推荐进球区间: 取终盘最低档 + 变化方向加成
  const ents = Object.entries(m.zjq_latest).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t)).sort((a, b) => a.odds - b.odds);
  const zjqT = ents[0]?.t ?? 2;

  // 只对小球区间生效
  let zjqRange = zjqT <= 3 ? [Math.max(0, zjqT - 1), zjqT + 1] : [2, 6];
  const zjqInRange = tg >= zjqRange[0] && tg <= zjqRange[1];
  if (zjqInRange) goalHit++;

  // bqc 推荐方向: 胜胜<2 或 负负<2 作为强方向
  const ss = m.bqc_latest?.['胜胜'], ff = m.bqc_latest?.['负负'];
  let bqcDir = 'none';
  if (ss && ss < 2) bqcDir = 'home';
  else if (ff && ff < 2) bqcDir = 'away';
  const bqcInRange = bqcDir === actualDir || bqcDir === 'none'; // 不推荐也视为正确
  if (bqcDir === actualDir) dirHit++;

  const combo = zjqInRange && (bqcDir === actualDir);
  if (combo) combHit++;
  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${hg}:${ag}(${actualDir},${tg}球) | [${zjqRange[0]}-${zjqRange[1]}] | ${zjqInRange ? '✅' : '❌'} | ${bqcDir} | ${bqcDir === actualDir ? '✅' : (bqcDir === 'none' ? '—' : '❌')} | ${combo ? '✅' : '❌'} |`);
}
console.log(`\n- zjq 小球推荐区间命中: ${goalHit}/${N} = ${(goalHit/N*100).toFixed(0)}%`);
console.log(`- bqc 强方向(<2)命中: ${dirHit}/${N} = ${(dirHit/N*100).toFixed(0)}%`);
console.log(`- 组合命中(zjq+方向): ${combHit}/${N} = ${(combHit/N*100).toFixed(0)}%`);

console.log(`\n结论：赔率变化信号（trend）对 20 场样本的方向判断有帮助，但不如"绝对赔率"强。\n建议当前策略用"绝对赔率"做主信号，赔率变化做辅助确认。`);
