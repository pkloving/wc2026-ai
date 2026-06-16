// 11_recommend_r012.js
// R-012 v5 智能pick 推荐脚本 (基于 10_backtest_r012.js 的 pickR012)
//   - 复用 pickR012() / 方向A bf 2串1 / 方向B 3串1 / 方向C 主流单关
//   - 过滤未完赛 (无 results/<mid>.json)
//   - 输出 JSON artifact + console 推荐
//
// 用法: node 11_recommend_r012.js <YYYY-MM-DD> [--unit-stake=2]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ============== CLI ==============
const TARGET_DATE = process.argv[2];
if (!TARGET_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error('用法: node 11_recommend_r012.js <YYYY-MM-DD> [--unit-stake=2]');
  process.exit(1);
}
const UNIT_STAKE = Number((process.argv.find(a => a.startsWith('--unit-stake=')) || '--unit-stake=2').split('=')[1]);

// ============== TUNING (R-012 v5) ==============
const TUNING = {
  VIG: 0.13,
  UNIT_STAKE,

  // 方向 A: bf 比分 2 串 1
  PAIR2_BF_ODDS_RANGE: [4, 12],
  PAIR2_BF_PROB_RANGE: [0.08, 0.25],
  PAIR2_BF_BET_COUNT: 4,
  PAIR2_BF_MIN_OVERALL_ODDS: 16,
  PAIR2_BF_MAX_OVERALL_ODDS: 144,
  PAIR2_BF_EXCLUDE_AGGREGATE: true,
  PAIR2_BF_TOP_N_PER_MATCH: 2,

  // 方向 B: spf/rqspf + zjq 3 串 1
  PARLAY3_MIN_DISTINCT_MATCHES: 3,
  PARLAY3_REQUIRE_SPF_OR_RQSPF: 1,
  PARLAY3_REQUIRE_ZJQ: 1,
  PARLAY3_MIN_OVERALL_ODDS: 8,
  PARLAY3_MAX_OVERALL_ODDS: 50,
  PARLAY3_KEEP_TOP: 3,
  PARLAY3_PERMUTATIONS_LIMIT: 2000,

  // 方向 C: 主流单关
  SINGLE_MAIN_ODDS_RANGE: [1.4, 2.5],
  SINGLE_MAIN_MIN_PROB: 0.40,
  SINGLE_MAIN_KEEP_TOP: 1,
  SINGLE_MAIN_PREFER_RQSPF: true,

  // R-012 选法核心
  HANDICAP_DEEP_THRESHOLD: 2,

  // zjq
  ZJQ_PROB_MIN: 0.15,
  ZJQ_MAX_ODDS: 12,
  ZJQ_MAX_GOALS: 5,

  BF_EXCLUDE_AGGREGATE: true,
};

// ============== 工具 ==============
function impliedProbs3(odds) {
  if (!odds) return null;
  const inv = { home: 1/odds.home, draw: 1/odds.draw, away: 1/odds.away };
  const sum = inv.home + inv.draw + inv.away;
  return { home: inv.home/sum, draw: inv.draw/sum, away: inv.away/sum, vig: sum - 1 };
}
function pickLabel(play, key) {
  if (play === 'spf' || play === 'rqspf') {
    return key === 'home' ? '主胜' : key === 'draw' ? '平' : '客胜';
  }
  return String(key);
}
function fairProbFromOdds(odds, vig = TUNING.VIG) {
  return 1 / (odds * (1 + vig));
}
function round(x, p = 4) { return Math.round(x * 10**p) / 10**p; }

// ============== R-012 v5 pick 选法 ==============
function pickR012(m) {
  if (!m.odds) return null;
  const h = m.handicap;
  const spf = m.odds.spf_latest;
  const rqspf = m.odds.rqspf_latest;

  if (h === null && !spf && rqspf) {
    return { play: 'rqspf', pick: 'home', pickLabel: '主胜', odds: rqspf.home, prob: 1/rqspf.home/(1+0.13), reason: '无 handicap + 无 spf, 假设 +2 选主胜(让)' };
  }
  if (h === null && spf) {
    return { play: 'spf', pick: 'home', pickLabel: '主胜', odds: spf.home, prob: 1/spf.home/(1+0.13), reason: '无 handicap, spf 选主胜' };
  }
  if (h !== null && h <= -TUNING.HANDICAP_DEEP_THRESHOLD && rqspf) {
    return { play: 'rqspf', pick: 'home', pickLabel: '主胜', odds: rqspf.home, prob: 1/rqspf.home/(1+0.13), reason: '大盘口 h=' + h + ' 选主胜(让)' };
  }
  if (h !== null && h >= TUNING.HANDICAP_DEEP_THRESHOLD && rqspf) {
    return { play: 'rqspf', pick: 'away', pickLabel: '客胜', odds: rqspf.away, prob: 1/rqspf.away/(1+0.13), reason: '大盘口 h=+' + h + ' 选客胜(让)' };
  }
  if (h !== null && Math.abs(h) === 1) {
    if (spf) {
      const p0 = impliedProbs3(spf);
      if (p0.away < 0.30) {
        return { play: 'spf', pick: 'draw', pickLabel: '平', odds: spf.draw, prob: p0.draw, reason: '中盘口 spf away 偏低 (' + p0.away.toFixed(2) + '), 选平' };
      }
      if (p0.away >= 0.65) {
        return { play: 'spf', pick: 'away', pickLabel: '客胜', odds: spf.away, prob: p0.away, reason: '中盘口 spf away 偏高 (' + p0.away.toFixed(2) + '), 选客胜' };
      }
    }
    if (rqspf) {
      return { play: 'rqspf', pick: 'draw', pickLabel: '平', odds: rqspf.draw, prob: 1/rqspf.draw/(1+0.13), reason: '中盘口 rqspf 选平(走盘)' };
    }
  }
  if (h !== null && h === 0 && spf) {
    return { play: 'spf', pick: 'home', pickLabel: '主胜', odds: spf.home, prob: 1/spf.home/(1+0.13), reason: 'h=0, spf 选主胜' };
  }
  return null;
}

// ============== 1. 加载数据 ==============
const oddsDir = path.join(PROJECT_ROOT, 'data', 'odds');
const resultsDir = path.join(PROJECT_ROOT, 'data', 'results');

const allOddsFiles = fs.readdirSync(oddsDir).filter(f => f.endsWith('.json'));
const matches = [];

for (const f of allOddsFiles) {
  const oddsDoc = JSON.parse(fs.readFileSync(path.join(oddsDir, f), 'utf-8'));
  const kickoff = oddsDoc.basic?.kickoff || '';
  if (!kickoff.startsWith(TARGET_DATE)) continue;
  const mid = oddsDoc.basic.mid;
  const resultPath = path.join(resultsDir, `${mid}.json`);
  if (fs.existsSync(resultPath)) continue;  // 跳过已完赛
  matches.push({
    mid,
    code: oddsDoc.basic.code,
    home: oddsDoc.basic.home,
    away: oddsDoc.basic.away,
    kickoff,
    handicap: oddsDoc.odds.handicap,
    odds: oddsDoc.odds,
  });
}

console.log(`[输入] ${matches.length} 场 ${TARGET_DATE} 未完赛比赛`);
if (matches.length === 0) {
  console.error(`无 ${TARGET_DATE} 未完赛比赛, 退出`);
  process.exit(1);
}

// ============== 2. 收集 picks (R-012 v5 选法) ==============
for (const m of matches) {
  m.picks = { spf: null, rqspf: null, play: null, bf: [], zjq: null };
  const odds = m.odds;

  const play = pickR012(m);
  if (play) {
    m.picks.play = play;
    if (play.play === 'spf') {
      m.picks.spf = {
        play: 'spf', pick: play.pick, pickLabel: pickLabel('spf', play.pick),
        odds: play.odds, prob: round(play.prob), reason: play.reason,
      };
    } else if (play.play === 'rqspf') {
      m.picks.rqspf = {
        play: 'rqspf', pick: play.pick, pickLabel: pickLabel('rqspf', play.pick),
        odds: play.odds, prob: round(play.prob), reason: play.reason,
      };
    }
  }

  if (odds.bf_latest) {
    for (const [score, odd] of Object.entries(odds.bf_latest)) {
      if (odd <= 1) continue;
      if (TUNING.BF_EXCLUDE_AGGREGATE && /其它$/.test(score)) continue;
      if (odd < TUNING.PAIR2_BF_ODDS_RANGE[0] || odd > TUNING.PAIR2_BF_ODDS_RANGE[1]) continue;
      const prob = fairProbFromOdds(odd);
      if (prob < TUNING.PAIR2_BF_PROB_RANGE[0] || prob > TUNING.PAIR2_BF_PROB_RANGE[1]) continue;
      m.picks.bf.push({
        play: 'bf', pick: score, pickLabel: score, odds: odd, prob: round(prob),
      });
    }
    m.picks.bf.sort((a, b) => b.prob - a.prob);
  }

  if (odds.zjq_latest) {
    let best = null;
    for (const [goals, odd] of Object.entries(odds.zjq_latest)) {
      if (odd <= 1) continue;
      if (odd > TUNING.ZJQ_MAX_ODDS) continue;
      const goalsNum = goals === '7+' ? 7 : Number(goals);
      if (Number.isFinite(goalsNum) && goalsNum > TUNING.ZJQ_MAX_GOALS) continue;
      const prob = fairProbFromOdds(odd);
      if (prob < TUNING.ZJQ_PROB_MIN) continue;
      if (!best || prob > best.prob) {
        best = { play: 'zjq', pick: goals, pickLabel: `${goals}球`, odds: odd, prob: round(prob) };
      }
    }
    m.picks.zjq = best;
  }
}

// ============== 3. 方向 A: bf 比分 2 串 1 ==============
const bfTopNByMatch = matches
  .filter(m => m.picks.bf.length >= 1)
  .map(m => ({
    mid: m.mid, code: m.code,
    bf: m.picks.bf.slice(0, TUNING.PAIR2_BF_TOP_N_PER_MATCH),
  }));

const directionA = { pairs_2x1: [] };
const pair2Set = new Set();
const pair2s = [];
for (const ma of bfTopNByMatch) {
  for (const mb of bfTopNByMatch) {
    if (ma.mid === mb.mid) continue;
    for (const pa of ma.bf) {
      for (const pb of mb.bf) {
        const totalOdds = round(pa.odds * pb.odds);
        if (totalOdds < TUNING.PAIR2_BF_MIN_OVERALL_ODDS) continue;
        if (totalOdds > TUNING.PAIR2_BF_MAX_OVERALL_ODDS) continue;
        const key = [ma.mid, pa.pick, mb.mid, pb.pick].sort().join('|');
        if (pair2Set.has(key)) continue;
        pair2Set.add(key);
        pair2s.push({
          high: { mid: ma.mid, code: ma.code, play: 'bf', pick: pa.pick, odds: pa.odds, prob: pa.prob },
          low: { mid: mb.mid, code: mb.code, play: 'bf', pick: pb.pick, odds: pb.odds, prob: pb.prob },
          totalOdds,
          totalProb: round(pa.prob * pb.prob),
        });
      }
    }
  }
}
pair2s.sort((a, b) => b.totalOdds - a.totalOdds);
directionA.pairs_2x1 = pair2s.slice(0, TUNING.PAIR2_BF_BET_COUNT);

// ============== 4. 方向 B: spf/rqspf + zjq 3 串 1 ==============
const directionB = { parlays_3x1: [] };

if (matches.length >= TUNING.PARLAY3_MIN_DISTINCT_MATCHES) {
  const spfRqspfPicks = [];
  for (const m of matches) {
    if (m.picks.play) {
      spfRqspfPicks.push({
        ...m.picks.play, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff,
      });
    }
  }
  const zjqPicks = matches
    .filter(m => m.picks.zjq)
    .map(m => ({ ...m.picks.zjq, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff }));

  const parlay3Set = new Set();
  const parlays3 = [];
  let permCount = 0;
  for (const p1 of spfRqspfPicks) {
    for (const p2 of zjqPicks) {
      if (p1.mid === p2.mid) continue;
      for (const p3 of [...spfRqspfPicks, ...zjqPicks]) {
        const mids = new Set([p1.mid, p2.mid, p3.mid]);
        if (mids.size !== TUNING.PARLAY3_MIN_DISTINCT_MATCHES) continue;
        const totalOdds = round(p1.odds * p2.odds * p3.odds);
        if (totalOdds < TUNING.PARLAY3_MIN_OVERALL_ODDS) continue;
        if (totalOdds > TUNING.PARLAY3_MAX_OVERALL_ODDS) continue;
        const key = [p1, p2, p3].map(x => `${x.mid}-${x.play}-${x.pick}`).sort().join('|');
        if (parlay3Set.has(key)) continue;
        parlay3Set.add(key);
        parlays3.push({
          picks: [p1, p2, p3].map(p => ({
            mid: p.mid, code: p.code, play: p.play, pick: p.pick, pickLabel: pickLabel(p.play, p.pick),
            odds: p.odds, prob: p.prob,
          })),
          totalOdds,
          totalProb: round(p1.prob * p2.prob * p3.prob),
          ev: round((p1.prob * p2.prob * p3.prob) * (p1.odds * p2.odds * p3.odds)),
        });
        permCount++;
        if (permCount >= TUNING.PARLAY3_PERMUTATIONS_LIMIT) break;
      }
      if (permCount >= TUNING.PARLAY3_PERMUTATIONS_LIMIT) break;
    }
    if (permCount >= TUNING.PARLAY3_PERMUTATIONS_LIMIT) break;
  }
  parlays3.sort((a, b) => b.totalOdds - a.totalOdds);
  directionB.parlays_3x1 = parlays3.slice(0, TUNING.PARLAY3_KEEP_TOP);
}

// ============== 5. 方向 C: 主流单关 ==============
const directionC = { singles: [] };
const mainSingles = [];
for (const m of matches) {
  if (m.picks.play) {
    const c = { ...m.picks.play, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff };
    if (c.odds < TUNING.SINGLE_MAIN_ODDS_RANGE[0] || c.odds > TUNING.SINGLE_MAIN_ODDS_RANGE[1]) continue;
    if (c.prob < TUNING.SINGLE_MAIN_MIN_PROB) continue;
    mainSingles.push(c);
  }
}
mainSingles.sort((a, b) => b.prob - a.prob);
directionC.singles = mainSingles.slice(0, TUNING.SINGLE_MAIN_KEEP_TOP);

// ============== 6. 输出 ==============
const out = {
  generated_at: new Date().toISOString(),
  target_date: TARGET_DATE,
  unit_stake: UNIT_STAKE,
  source: `data/odds/<mid>.json (${matches.length} 场 ${TARGET_DATE} 未完赛)`,
  algorithm: 'R-012 v5 智能pick (方向A bf 2串1 + 方向B 3串1 + 方向C 主流单关)',
  tuning: TUNING,
  matches: matches.map(m => ({
    mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff,
    handicap: m.handicap, picks: m.picks,
  })),
  direction_a: directionA,
  direction_b: directionB,
  direction_c: directionC,
  notes: {
    pick_strategy: 'R-012 v5: 大盘口 |h|>=2 选让球方 / handicap=null 选赔率最低 / 中小盘口 home>=0.40 选主胜 / away 最高+away-home>5% 选 draw / 兜底主胜',
    hit_logic: 'spf 比 winner, rqspf 比 handicapResult (handicap=null+spf=null 假设 +2)',
  },
};

const OUT_FILE = path.join(__dirname, '..', 'artifacts', `recommend_r012_${TARGET_DATE}.json`);
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8');

console.log(`[推荐 R-012 ${TARGET_DATE}] 写入 ${OUT_FILE}`);

console.log(`\n=== 全部 rqspf/spf 选法明细 ===`);
for (const m of matches) {
  if (m.picks.play) {
    const r = m.picks.play;
    console.log(`  ${m.code} h=${m.handicap} ${m.home} vs ${m.away} | ${r.play} pred=${r.pickLabel}@${r.odds} (prob ${(r.prob*100).toFixed(1)}%) reason="${r.reason}"`);
  } else {
    console.log(`  ${m.code} h=${m.handicap} ${m.home} vs ${m.away} | (无可用 pick)`);
  }
}

if (directionA.pairs_2x1.length > 0) {
  console.log(`\n=== 方向 A bf 2串1 top ${directionA.pairs_2x1.length} ===`);
  for (const p of directionA.pairs_2x1) {
    console.log(`  ${p.high.code} bf ${p.high.pick}@${p.high.odds} × ${p.low.code} bf ${p.low.pick}@${p.low.odds} | total ${p.totalOdds}`);
  }
} else {
  console.log(`\n=== 方向 A bf 2串1: 无候选 ===`);
}

if (directionB.parlays_3x1.length > 0) {
  console.log(`\n=== 方向 B 3串1 top ${directionB.parlays_3x1.length} ===`);
  for (const par of directionB.parlays_3x1) {
    const pickDesc = par.picks.map(x => `${x.code}/${x.play} ${x.pickLabel}@${x.odds}`).join(' × ');
    console.log(`  ${pickDesc} | total ${par.totalOdds} | ev ${par.ev}`);
  }
} else {
  console.log(`\n=== 方向 B 3串1: 无候选 (候选不足 ${TUNING.PARLAY3_MIN_DISTINCT_MATCHES} 场) ===`);
}

if (directionC.singles.length > 0) {
  console.log(`\n=== 方向 C 主流单关 top ${directionC.singles.length} ===`);
  for (const s of directionC.singles) {
    console.log(`  ${s.code} ${s.play} ${s.pickLabel}@${s.odds} (prob ${(s.prob*100).toFixed(1)}%) reason="${s.reason}"`);
  }
} else {
  console.log(`\n=== 方向 C 主流单关: 无候选 (spf/rqspf 赔率 ${TUNING.SINGLE_MAIN_ODDS_RANGE[0]}-${TUNING.SINGLE_MAIN_ODDS_RANGE[1]} + prob > ${(TUNING.SINGLE_MAIN_MIN_PROB*100).toFixed(0)}%) ===`);
}

const totalCost = (directionA.pairs_2x1.length + directionB.parlays_3x1.length + directionC.singles.length) * UNIT_STAKE;
console.log(`\n=== 汇总 ===`);
console.log(`  方向 A 候选: ${directionA.pairs_2x1.length} 注 × ${UNIT_STAKE} = ${directionA.pairs_2x1.length * UNIT_STAKE} 元`);
console.log(`  方向 B 候选: ${directionB.parlays_3x1.length} 注 × ${UNIT_STAKE} = ${directionB.parlays_3x1.length * UNIT_STAKE} 元`);
console.log(`  方向 C 候选: ${directionC.singles.length} 注 × ${UNIT_STAKE} = ${directionC.singles.length * UNIT_STAKE} 元`);
console.log(`  总 cost: ${totalCost} 元`);
