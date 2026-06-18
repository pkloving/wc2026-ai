// 验证两个问题：
// 1. zjq 是否只对"小球"(total≤3) 有用，对"大球"(total≥4) 反而误导？
// 2. bqc "胜胜/负负"赔率能否辅助确认方向（尤其是让球盘方向）？

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');

const allMatches = [];
for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
  const odds = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
  if (!odds.basic || odds.basic.league !== '世界杯') continue;
  const mid = odds.basic.mid;
  const rpath = path.join(RESULTS_DIR, mid + '.json');
  if (!fs.existsSync(rpath)) continue;
  const actual = JSON.parse(fs.readFileSync(rpath, 'utf-8'));
  allMatches.push({ mid, code: odds.basic.code, home: odds.basic.home, away: odds.basic.away, handicap: odds.odds.handicap, rqspf: odds.odds.rqspf_latest, zjq: odds.odds.zjq_latest, bqc: odds.odds.bqc_latest, actual });
}

const N = allMatches.length;
console.log(`\n## 1. zjq —— 小球 vs 大球 命中率对比\n`);

let smallGood = 0, smallTotal = 0;  // 实际≤3球
let bigGood = 0, bigTotal = 0;      // 实际≥4球
let zjqFilteredSmallHit = 0, zjqFilteredSmallMiss = 0; // zjq 过滤命中/漏

console.log(`| 场次 | 对阵 | 实际比分 | 总进球 | zjq最低档 | zjq命中±1? | 球大小 |`);
console.log(`|------|------|---------|-------|----------|-----------|-------|`);

for (const m of allMatches) {
  const hg = m.actual.homeScore, ag = m.actual.awayScore;
  const tg = hg + ag;
  if (!m.zjq) continue;
  const zjqEntries = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v, raw: k })).filter(e => !Number.isNaN(e.t)).sort((a, b) => a.odds - b.odds);
  const zjqLow = zjqEntries[0];
  const hit = Math.abs(tg - zjqLow.t) <= 1;

  if (tg <= 3) {
    smallTotal++;
    if (hit) smallGood++;
    console.log(`| ${m.code} | ${m.home}vs${m.away} | ${hg}:${ag} | ${tg}球 | ${zjqLow.raw}@${zjqLow.odds} | ${hit ? '✅' : '❌'} | 小球 |`);
  } else {
    bigTotal++;
    if (hit) bigGood++;
    console.log(`| ${m.code} | ${m.home}vs${m.away} | ${hg}:${ag} | ${tg}球 | ${zjqLow.raw}@${zjqLow.odds} | ${hit ? '✅' : '❌'} | 大球 |`);
  }
}
console.log(`\n- 小球(≤3球) zjq命中率: ${smallGood}/${smallTotal} = ${smallTotal ? (smallGood/smallTotal*100).toFixed(0) : 0}%`);
console.log(`- 大球(≥4球) zjq命中率: ${bigGood}/${bigTotal} = ${bigTotal ? (bigGood/bigTotal*100).toFixed(0) : 0}%`);
console.log(`\n→ 结论：${smallGood >= bigGood ? 'zjq 在小球场景准，大球场景不准' : 'zjq 两者都准'}`);

console.log(`\n## 2. bqc "胜胜/负负" 辅助确认方向\n`);

console.log(`| 场次 | 对阵 | h | 实际让球结果 | 实际比分 | bqc最低档@赔率 | bqc胜胜赔率 | bqc负负赔率 | bqc辅助方向是否与实际一致? |`);
console.log(`|------|------|---|-------------|---------|---------------|-----------|-----------|------------------------|`);

let bqcConfirm = 0, bqcTotal = 0;
for (const m of allMatches) {
  if (!m.bqc || !m.rqspf) continue;
  const hg = m.actual.homeScore, ag = m.actual.awayScore;
  const hc = m.handicap || 0;
  const adjustedHome = hg + hc;
  const actualResult = adjustedHome > ag ? 'home' : adjustedHome < ag ? 'away' : 'draw';
  const bqcEntries = Object.entries(m.bqc).sort((a, b) => a[1] - b[1]);
  const low = bqcEntries[0];
  const ss = m.bqc['胜胜'], ff = m.bqc['负负'];

  // bqc辅助方向: 胜胜 < 负负 → 倾向主队胜；反之客队
  let bqcDir = 'draw';
  let bqcStrong = false;
  if (ss && ff) {
    if (ss < ff && ss < 3) { bqcDir = 'home'; bqcStrong = true; }
    else if (ff < ss && ff < 3) { bqcDir = 'away'; bqcStrong = true; }
    else bqcDir = 'unclear';
  }
  bqcTotal++;
  let consistent = '—';
  if (bqcDir === 'home' && actualResult === 'home') { consistent = '✅'; bqcConfirm++; }
  else if (bqcDir === 'away' && actualResult === 'away') { consistent = '✅'; bqcConfirm++; }
  else if (bqcDir === 'home' || bqcDir === 'away') { consistent = '❌'; }

  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${hc} | ${actualResult} | ${hg}:${ag} | ${low[0]}@${low[1]} | ${ss || '-'} | ${ff || '-'} | ${consistent}${bqcStrong ? '(强)' : ''} |`);
}
console.log(`\n- bqc胜胜/负负(<3)辅助确认方向: ${bqcConfirm}/${bqcTotal} 场`);

// 进一步: bqc能否在"rqspf 最低赔率方向 不准"的那些比赛 帮上忙?
console.log(`\n## 3. bqc 能否在 rqspf 最低方向错的时候救场？\n`);
let rqspfMissRescuedByBqc = 0, rqspfMissTotal = 0;
for (const m of allMatches) {
  if (!m.rqspf || !m.bqc) continue;
  const hg = m.actual.homeScore, ag = m.actual.awayScore;
  const hc = m.handicap || 0;
  const adjustedHome = hg + hc;
  const actualResult = adjustedHome > ag ? 'home' : adjustedHome < ag ? 'away' : 'draw';
  const rqspfEntries = Object.entries(m.rqspf).sort((a, b) => a[1] - b[1]);
  const rqspfDir = rqspfEntries[0][0];
  const ss = m.bqc['胜胜'], ff = m.bqc['负负'];
  let bqcDir = null;
  if (ss && ff) {
    if (ss < ff && ss < 3) bqcDir = 'home';
    else if (ff < ss && ff < 3) bqcDir = 'away';
  }
  if (rqspfDir !== actualResult) {
    rqspfMissTotal++;
    const rescued = bqcDir === actualResult;
    if (rescued) rqspfMissRescuedByBqc++;
    console.log(`  ${m.code} ${m.home}vs${m.away}: rqspf说${rqspfDir}@${rqspfEntries[0][1]} 但实际${actualResult} | bqc胜胜@${ss||'-'} 负负@${ff||'-'} → ${rescued ? '✅ bqc猜对了' : '❌ bqc也没救回来'}`);
  }
}
console.log(`\n- rqspf最低方向错误的比赛: ${rqspfMissTotal} 场，其中 bqc 救回: ${rqspfMissRescuedByBqc} 场`);
console.log(`→ bqc 的作用：${rqspfMissRescuedByBqc > 0 ? '在rqspf搞不定的场景，bqc能救回一部分' : '救不回来，bqc本身也不准'}`);
