// 07_backtest.js
// R-010 算法回测：对历史某日的世界杯正赛跑推荐，对比实际结果
//
// 用法: node 07_backtest.js <YYYY-MM-DD> [--unit-stake=2]
//
// 输入: data/odds/<mid>.json (历史赔率) + data/results/<mid>.json (实际结果)
// 输出: modeling/artifacts/backtest_<date>.json (回测报告)
//        records/backtest_<date>.md (markdown 反思, gitignored)
//
// 算法逻辑同 06_recommend_parlays.js (TUNING 一致), 复制在此便于独立回测

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ============== CLI ==============
const TARGET_DATE = process.argv[2];
if (!TARGET_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error('用法: node 07_backtest.js <YYYY-MM-DD>');
  process.exit(1);
}
const UNIT_STAKE = Number((process.argv.find(a => a.startsWith('--unit-stake=')) || '--unit-stake=2').split('=')[1]);

// ============== TUNING (与 06 一致) ==============
const TUNING = {
  VIG: 0.13,
  MIN_OVERALL_ODDS: 8,
  MAX_PICK_ODDS: 35,
  ZJQ_MAX_GOALS: 5,
  ZJQ_MIN_PROB: 0.15,
  SINGLE_OUTSIDER_MIN_ODDS: 12,
  SINGLE_OUTSIDER_PROB_RANGE: [0.04, 0.12],
  PAIR_HIGH_ODDS: 12,
  PAIR_HIGH_PROB: [0.03, 0.15],
  PAIR_LOW_ODDS: [5, 12],
  PAIR_LOW_PROB: [0.07, 0.20],
  PARLAY3_MIN_DISTINCT_MATCHES: 3,
  PARLAY3_REQUIRE_SPF_OR_RQSPF: true,
  PARLAY3_REQUIRE_ZJQ: true,
  PARLAY3_KEEP_TOP: 8,
  BF_EXCLUDE_AGGREGATE: true,
  INCLUDE_BQC: false,
};

// ============== 工具 ==============
function impliedProbs3(odds) {
  if (!odds) return null;
  const inv = { home: 1/odds.home, draw: 1/odds.draw, away: 1/odds.away };
  const sum = inv.home + inv.draw + inv.away;
  return { home: inv.home/sum, draw: inv.draw/sum, away: inv.away/sum, vig: sum - 1 };
}
function argmax3(p) {
  let m = 'home', v = p.home;
  if (p.draw > v) { m = 'draw'; v = p.draw; }
  if (p.away > v) { m = 'away'; v = p.away; }
  return m;
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
// 规范化比分: sporttery scrape 在不同比赛里 bf_latest key 有时是 zero-pad "02:01" 有时是 no-pad "0:1"
// actualSummary 一律 no-pad. 比较前必须 normalize
function normalizeScore(s) {
  if (typeof s !== 'string') return s;
  return s.split(':').map(p => String(Number(p))).join(':');
}
// rqspf pick ('home'/'draw'/'away') → handicapResult 命名映射
const RQSPF_PICK_TO_RESULT = { home: 'home_win', draw: 'draw', away: 'away_win' };

// ============== 1. 找目标日的所有比赛 ==============
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
  if (!fs.existsSync(resultPath)) {
    console.warn(`[跳过] mid=${mid} (${kickoff}) 无 results 文件, 跳过`);
    continue;
  }
  matches.push({
    mid,
    code: oddsDoc.basic.code,
    home: oddsDoc.basic.home,
    away: oddsDoc.basic.away,
    kickoff,
    handicap: oddsDoc.odds.handicap,
    odds: oddsDoc.odds,
    actual: JSON.parse(fs.readFileSync(resultPath, 'utf-8')),
  });
}

console.log(`[输入] ${matches.length} 场 ${TARGET_DATE} 比赛 (有 odds + results)`);
if (matches.length === 0) {
  console.error(`无 ${TARGET_DATE} 比赛数据, 退出`);
  process.exit(1);
}

// ============== 2. 收集 picks (同 06) ==============
for (const m of matches) {
  m.picks = [];
  const odds = m.odds;

  if (odds.spf_latest) {
    const p0 = impliedProbs3(odds.spf_latest);
    const pick = argmax3(p0);
    m.picks.push({
      play: 'spf', pick,
      pickLabel: pickLabel('spf', pick),
      odds: odds.spf_latest[pick],
      prob: round(p0[pick]),
      probSource: 'market_implied',
    });
  }
  if (odds.rqspf_latest) {
    const p0 = impliedProbs3(odds.rqspf_latest);
    const pick = argmax3(p0);
    m.picks.push({
      play: 'rqspf', pick,
      pickLabel: pickLabel('rqspf', pick),
      odds: odds.rqspf_latest[pick],
      prob: round(p0[pick]),
      probSource: 'market_implied',
    });
  }
  if (odds.bf_latest) {
    for (const [score, odd] of Object.entries(odds.bf_latest)) {
      if (odd <= 1) continue;
      if (TUNING.BF_EXCLUDE_AGGREGATE && /其它$/.test(score)) continue;
      m.picks.push({
        play: 'bf', pick: score,
        pickLabel: score,
        odds: odd,
        prob: round(fairProbFromOdds(odd)),
        probSource: 'bf_implied',
      });
    }
  }
  if (odds.zjq_latest) {
    for (const [goals, odd] of Object.entries(odds.zjq_latest)) {
      if (odd <= 1) continue;
      if (odd > TUNING.MAX_PICK_ODDS) continue;
      const goalsNum = goals === '7+' ? 7 : Number(goals);
      if (Number.isFinite(goalsNum) && goalsNum > TUNING.ZJQ_MAX_GOALS) continue;
      m.picks.push({
        play: 'zjq', pick: goals,
        pickLabel: `${goals}球`,
        odds: odd,
        prob: round(fairProbFromOdds(odd)),
        probSource: 'zjq_implied',
      });
    }
  }
}

// ============== 3. 实际结果 (用 rqspf 形式) ==============
for (const m of matches) {
  const { homeScore, awayScore } = m.actual;
  const total = homeScore + awayScore;
  let actualWinner, actualHandicapResult;
  if (homeScore > awayScore) actualWinner = 'home';
  else if (homeScore < awayScore) actualWinner = 'away';
  else actualWinner = 'draw';
  // rqspf: 盘口让球后
  if (m.handicap !== null && m.handicap !== undefined) {
    const adjustedHome = homeScore + m.handicap;
    if (adjustedHome > awayScore) actualHandicapResult = 'home_win';
    else if (adjustedHome < awayScore) actualHandicapResult = 'away_win';
    else actualHandicapResult = 'draw';
  } else {
    actualHandicapResult = null;
  }
  m.actualSummary = {
    score: `${homeScore}:${awayScore}`,
    winner: actualWinner,
    handicapResult: actualHandicapResult,
    totalGoals: total,
  };
}

// ============== 4. 方向 A 比分玩法 ==============
const allBf = matches.flatMap(m => m.picks
  .filter(p => p.play === 'bf')
  .map(p => ({ ...p, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff }))
);

const directionA = { singles: [], pairs_2x1: [] };

directionA.singles = allBf
  .filter(p => p.odds > TUNING.SINGLE_OUTSIDER_MIN_ODDS &&
    p.prob > TUNING.SINGLE_OUTSIDER_PROB_RANGE[0] && p.prob < TUNING.SINGLE_OUTSIDER_PROB_RANGE[1])
  .sort((a, b) => b.odds - a.odds)
  .slice(0, 5);

const high = allBf.filter(p => p.odds > TUNING.PAIR_HIGH_ODDS &&
  p.prob > TUNING.PAIR_HIGH_PROB[0] && p.prob < TUNING.PAIR_HIGH_PROB[1]);
const low = allBf.filter(p => p.odds >= TUNING.PAIR_LOW_ODDS[0] && p.odds <= TUNING.PAIR_LOW_ODDS[1] &&
  p.prob > TUNING.PAIR_LOW_PROB[0] && p.prob < TUNING.PAIR_LOW_PROB[1]);

const pairSet = new Set();
const pairs = [];
for (const h of high) {
  for (const l of low) {
    if (h.mid === l.mid) continue;
    const totalOdds = round(h.odds * l.odds);
    if (totalOdds < TUNING.MIN_OVERALL_ODDS) continue;
    const key = [h.mid, h.pick, l.mid, l.pick].sort().join('|');
    if (pairSet.has(key)) continue;
    pairSet.add(key);
    pairs.push({
      high: { mid: h.mid, code: h.code, play: 'bf', pick: h.pick, odds: h.odds, prob: h.prob },
      low: { mid: l.mid, code: l.code, play: 'bf', pick: l.pick, odds: l.odds, prob: l.prob },
      totalOdds,
      totalProb: round(h.prob * l.prob),
    });
  }
}
pairs.sort((a, b) => b.totalOdds - a.totalOdds);
directionA.pairs_2x1 = pairs.slice(0, 5);

// ============== 5. 方向 B 3串1 ==============
const directionB = { parlays_3x1: [] };
if (matches.length >= TUNING.PARLAY3_MIN_DISTINCT_MATCHES) {
  const spfRqspfPicks = matches.flatMap(m => m.picks
    .filter(p => p.play === 'spf' || p.play === 'rqspf')
    .map(p => ({ ...p, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff }))
  );
  const zjqPicks = matches.flatMap(m => m.picks
    .filter(p => p.play === 'zjq' && p.prob >= TUNING.ZJQ_MIN_PROB)
    .map(p => ({ ...p, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff }))
  );
  const allPicks = [...spfRqspfPicks, ...zjqPicks];
  const parlay3Set = new Set();
  const parlays3 = [];
  for (const p1 of spfRqspfPicks) {
    for (const p2 of zjqPicks) {
      if (p1.mid === p2.mid) continue;
      for (const p3 of allPicks) {
        const mids = new Set([p1.mid, p2.mid, p3.mid]);
        if (mids.size !== TUNING.PARLAY3_MIN_DISTINCT_MATCHES) continue;
        const totalOdds = round(p1.odds * p2.odds * p3.odds);
        if (totalOdds < TUNING.MIN_OVERALL_ODDS) continue;
        const key = [p1, p2, p3].map(x => `${x.mid}-${x.play}-${x.pick}`).sort().join('|');
        if (parlay3Set.has(key)) continue;
        parlay3Set.add(key);
        parlays3.push({
          picks: [p1, p2, p3].map(p => ({
            mid: p.mid, code: p.code, play: p.play, pick: p.pick, pickLabel: p.pickLabel,
            odds: p.odds, prob: p.prob,
          })),
          totalOdds,
          totalProb: round(p1.prob * p2.prob * p3.prob),
          ev: round((p1.prob * p2.prob * p3.prob) * (p1.odds * p2.odds * p3.odds)),
        });
      }
    }
  }
  parlays3.sort((a, b) => b.totalOdds - a.totalOdds);
  directionB.parlays_3x1 = parlays3.slice(0, TUNING.PARLAY3_KEEP_TOP);
}

// ============== 6. 命中率对比 (核心) ==============
const hitStats = { direction_a: { singles: [], pairs: [] }, direction_b: { parlays: [] } };

for (const s of directionA.singles) {
  const match = matches.find(m => m.mid === s.mid);
  const hit = normalizeScore(s.pick) === normalizeScore(match.actualSummary.score);
  hitStats.direction_a.singles.push({
    mid: s.mid, code: s.code, predicted: s.pick, actual: match.actualSummary.score,
    odds: s.odds, fairProb: s.prob, hit,
    return: hit ? UNIT_STAKE * s.odds : 0,
    cost: UNIT_STAKE,
    pnl: hit ? UNIT_STAKE * (s.odds - 1) : -UNIT_STAKE,
  });
}

for (const p of directionA.pairs_2x1) {
  const mh = matches.find(m => m.mid === p.high.mid);
  const ml = matches.find(m => m.mid === p.low.mid);
  const hitH = normalizeScore(p.high.pick) === normalizeScore(mh.actualSummary.score);
  const hitL = normalizeScore(p.low.pick) === normalizeScore(ml.actualSummary.score);
  const allHit = hitH && hitL;
  hitStats.direction_a.pairs.push({
    high: { mid: p.high.mid, code: p.high.code, predicted: p.high.pick, actual: mh.actualSummary.score, hit: hitH, odds: p.high.odds },
    low: { mid: p.low.mid, code: p.low.code, predicted: p.low.pick, actual: ml.actualSummary.score, hit: hitL, odds: p.low.odds },
    totalOdds: p.totalOdds,
    hit: allHit,
    return: allHit ? UNIT_STAKE * p.totalOdds : 0,
    cost: UNIT_STAKE,
    pnl: allHit ? UNIT_STAKE * (p.totalOdds - 1) : -UNIT_STAKE,
  });
}

for (const par of directionB.parlays_3x1) {
  const hits = par.picks.map(pick => {
    const m = matches.find(mm => mm.mid === pick.mid);
    if (pick.play === 'bf') return normalizeScore(pick.pick) === normalizeScore(m.actualSummary.score);
    if (pick.play === 'spf') return pick.pick === m.actualSummary.winner;
    if (pick.play === 'rqspf') return pick.pick === m.actualSummary.handicapResult;
    if (pick.play === 'zjq') {
      const goals = pick.pick === '7+' ? 7 : Number(pick.pick);
      return goals === m.actualSummary.totalGoals;
    }
    return false;
  });
  const allHit = hits.every(h => h);
  hitStats.direction_b.parlays.push({
    picks: par.picks.map((p, i) => ({
      mid: p.mid, code: p.code, play: p.play, predicted: p.pickLabel,
      actual: matches.find(mm => mm.mid === p.mid)?.actualSummary,
      hit: hits[i],
    })),
    totalOdds: par.totalOdds,
    hit: allHit,
    return: allHit ? UNIT_STAKE * par.totalOdds : 0,
    cost: UNIT_STAKE,
    pnl: allHit ? UNIT_STAKE * (par.totalOdds - 1) : -UNIT_STAKE,
  });
}

// ============== 7. 汇总 ==============
function summarizePnl(list, name) {
  const total = list.length;
  const hits = list.filter(x => x.hit).length;
  const totalCost = list.reduce((a, x) => a + (x.cost || 0), 0);
  const totalReturn = list.reduce((a, x) => a + (x.return || 0), 0);
  const totalPnl = totalReturn - totalCost;
  return {
    name, total, hits, hitRate: total > 0 ? round(hits / total, 4) : null,
    totalCost, totalReturn: round(totalReturn, 2), totalPnl: round(totalPnl, 2),
    roi: totalCost > 0 ? round(totalPnl / totalCost, 4) : null,
  };
}

const summary = {
  unitStake: UNIT_STAKE,
  direction_a_singles: summarizePnl(hitStats.direction_a.singles, '方向A 单关爆冷'),
  direction_a_pairs: summarizePnl(hitStats.direction_a.pairs, '方向A 2串1 高+低'),
  direction_b_parlays: summarizePnl(hitStats.direction_b.parlays, '方向B 3串1 胜负+进球数'),
};
summary.totalCost = summary.direction_a_singles.totalCost + summary.direction_a_pairs.totalCost + summary.direction_b_parlays.totalCost;
summary.totalReturn = summary.direction_a_singles.totalReturn + summary.direction_a_pairs.totalReturn + summary.direction_b_parlays.totalReturn;
summary.totalPnl = round(summary.totalReturn - summary.totalCost, 2);
summary.totalRoi = summary.totalCost > 0 ? round(summary.totalPnl / summary.totalCost, 4) : null;

// ============== 8. 输出 ==============
const out = {
  generated_at: new Date().toISOString(),
  target_date: TARGET_DATE,
  unit_stake: UNIT_STAKE,
  source: `data/odds/<mid>.json + data/results/<mid>.json (${matches.length} 场 ${TARGET_DATE})`,
  algorithm: 'R-010 (v3 two-direction parlays)',
  tuning: TUNING,
  matches: matches.map(m => ({
    mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff,
    handicap: m.handicap, pickCount: m.picks.length, actual: m.actualSummary,
  })),
  direction_a: directionA,
  direction_b: directionB,
  hit_stats: hitStats,
  summary,
  notes: {
    direction_b_empty_reason: matches.length < TUNING.PARLAY3_MIN_DISTINCT_MATCHES
      ? `只 ${matches.length} 场比赛, 不足 ${TUNING.PARLAY3_MIN_DISTINCT_MATCHES} 场, 方向 B 跳过`
      : '方向 B 有推荐, 见 direction_b.parlays_3x1',
  },
};

const OUT_FILE = path.join(__dirname, '..', 'artifacts', `backtest_${TARGET_DATE}.json`);
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8');

console.log(`\n[回测 ${TARGET_DATE}] 写入 ${OUT_FILE}`);
console.log(`\n=== 命中汇总 ===`);
console.log(`  方向 A 单关爆冷:  ${summary.direction_a_singles.hits}/${summary.direction_a_singles.total} 命中 | cost ${summary.direction_a_singles.totalCost} → return ${summary.direction_a_singles.totalReturn} | pnl ${summary.direction_a_singles.totalPnl} | ROI ${summary.direction_a_singles.roi}`);
console.log(`  方向 A 2串1 高+低: ${summary.direction_a_pairs.hits}/${summary.direction_a_pairs.total} 命中 | cost ${summary.direction_a_pairs.totalCost} → return ${summary.direction_a_pairs.totalReturn} | pnl ${summary.direction_a_pairs.totalPnl} | ROI ${summary.direction_a_pairs.roi}`);
console.log(`  方向 B 3串1:      ${summary.direction_b_parlays.hits}/${summary.direction_b_parlays.total} 命中 | cost ${summary.direction_b_parlays.totalCost} → return ${summary.direction_b_parlays.totalReturn} | pnl ${summary.direction_b_parlays.totalPnl} | ROI ${summary.direction_b_parlays.roi}`);
console.log(`  合计:             cost ${summary.totalCost} → return ${summary.totalReturn} | pnl ${summary.totalPnl} | ROI ${summary.totalRoi}`);
console.log(`\n  ⚠️  ${out.notes.direction_b_empty_reason}`);

// 详细列出每条 hit/miss
console.log(`\n=== 方向 A 单关爆冷明细 ===`);
for (const s of hitStats.direction_a.singles) {
  console.log(`  ${s.hit ? '✅' : '❌'}  ${s.code} pred=${s.predicted} actual=${s.actual} @ ${s.odds} | fair prob ${(s.fairProb*100).toFixed(1)}% | pnl ${s.pnl}`);
}
console.log(`\n=== 方向 A 2串1 高+低明细 ===`);
for (const p of hitStats.direction_a.pairs) {
  console.log(`  ${p.hit ? '✅' : '❌'}  ${p.high.code} pred=${p.high.predicted} actual=${p.high.actual} × ${p.low.code} pred=${p.low.predicted} actual=${p.low.actual} | total ${p.totalOdds} | pnl ${p.pnl}`);
}
