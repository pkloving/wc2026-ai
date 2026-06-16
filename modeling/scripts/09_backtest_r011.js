// 09_backtest_r011.js
// R-011 算法回测：放弃 R-010 "12+ odds 单关爆冷" 路线, 改用用户实证的
//   - 方向 A: bf 比分 2 串 1 (每场挑 2 个候选, 2x1 跨 2 场, 4 注)
//   - 方向 B: spf/rqspf + zjq 3 串 1 (3 场不同 mid, 至少 1 spf/rqspf + 至少 1 zjq)
//   - 方向 C: 主流单关 (spf/rqspf 主流赔率 1.4-2.5, prob > 40%)
// 设计目标: 把 "高赔率" 从单注 12x 移到 3 串 1 堆出来 (15-100x), 单注 prob 20-50%
//
// 用法: node 09_backtest_r011.js <YYYY-MM-DD> [--unit-stake=2]
// 输入: data/odds/<mid>.json + data/results/<mid>.json
// 输出: modeling/artifacts/backtest_r011_<date>.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ============== CLI ==============
const TARGET_DATE = process.argv[2];
if (!TARGET_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error('用法: node 09_backtest_r011.js <YYYY-MM-DD> [--unit-stake=2]');
  process.exit(1);
}
const UNIT_STAKE = Number((process.argv.find(a => a.startsWith('--unit-stake=')) || '--unit-stake=2').split('=')[1]);

// ============== TUNING (R-011) ==============
const TUNING = {
  VIG: 0.13,
  UNIT_STAKE,

  // 方向 A: bf 比分 2 串 1 (用户票 2 模式: 4 注 2x1)
  // 每场选 bf top 2 (最可能 2 个比分), 跨 2 场不同 mid 配 2x1 = 4 组合, 4 注都买
  PAIR2_BF_ODDS_RANGE: [5, 15],
  PAIR2_BF_PROB_RANGE: [0.05, 0.20],
  PAIR2_BF_BET_COUNT: 4,                 // 2 场 × 2 候选 = 4 组合, 全买
  PAIR2_BF_MIN_OVERALL_ODDS: 25,         // 单注总赔率下限
  PAIR2_BF_MAX_OVERALL_ODDS: 250,
  PAIR2_BF_EXCLUDE_AGGREGATE: true,
  PAIR2_BF_TOP_N_PER_MATCH: 2,           // 每场取 prob 最高的 N 个候选

  // 方向 B: spf/rqspf + zjq 3 串 1
  PARLAY3_MIN_DISTINCT_MATCHES: 3,
  PARLAY3_REQUIRE_SPF_OR_RQSPF: 1,      // 至少 1 spf/rqspf
  PARLAY3_REQUIRE_ZJQ: 1,               // 至少 1 zjq
  PARLAY3_MIN_OVERALL_ODDS: 15,
  PARLAY3_MAX_OVERALL_ODDS: 100,
  PARLAY3_KEEP_TOP: 3,
  PARLAY3_PERMUTATIONS_LIMIT: 2000,    // 3 串 1 组合上限, 避免爆炸

  // 方向 C: 主流单关
  SINGLE_MAIN_ODDS_RANGE: [1.4, 2.5],
  SINGLE_MAIN_MIN_PROB: 0.40,
  SINGLE_MAIN_KEEP_TOP: 1,
  SINGLE_MAIN_PREFER_RQSPF: true,       // 优先 rqspf (让球盘 prob 更高)

  // 让球盘特殊选法 (学用户票 1)
  HANDICAP_DEEP_HOME: 2,                // handicap >= 2 强制 rqspf.home (主胜让)
  HANDICAP_DEEP_AWAY: -2,               // handicap <= -2 强制 rqspf.away (客胜让)

  // zjq
  ZJQ_PROB_MIN: 0.15,
  ZJQ_MAX_ODDS: 12,
  ZJQ_MAX_GOALS: 5,

  // 通用
  BF_EXCLUDE_AGGREGATE: true,
  NORMALIZE_SCORE: true,
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
function normalizeScore(s) {
  if (typeof s !== 'string') return s;
  return s.split(':').map(p => String(Number(p))).join(':');
}
// rqspf pick ('home'/'draw'/'away') → handicapResult 命名映射
const RQSPF_PICK_TO_RESULT = { home: 'home_win', draw: 'draw', away: 'away_win' };

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

// ============== 2. 实际结果 ==============
for (const m of matches) {
  const { homeScore, awayScore } = m.actual;
  const total = homeScore + awayScore;
  let actualWinner, actualHandicapResult;
  if (homeScore > awayScore) actualWinner = 'home';
  else if (homeScore < awayScore) actualWinner = 'away';
  else actualWinner = 'draw';
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

// ============== 3. 收集 picks ==============
for (const m of matches) {
  m.picks = { spf: null, rqspf: null, bf: [], zjq: null };
  const odds = m.odds;

  // --- spf: argmax p0
  if (odds.spf_latest) {
    const p0 = impliedProbs3(odds.spf_latest);
    const pick = argmax3(p0);
    m.picks.spf = {
      play: 'spf', pick,
      pickLabel: pickLabel('spf', pick),
      odds: odds.spf_latest[pick],
      prob: round(p0[pick]),
    };
  }

  // --- rqspf: 大盘口强制方向, 中小盘口 argmax p0
  if (odds.rqspf_latest) {
    const p0 = impliedProbs3(odds.rqspf_latest);
    let pick, reason;
    const h = m.handicap;
    if (h !== null && h !== undefined && h >= TUNING.HANDICAP_DEEP_HOME) {
      pick = 'home'; reason = `handicap=+${h} 大盘口选主胜(让)`;
    } else if (h !== null && h !== undefined && h <= TUNING.HANDICAP_DEEP_AWAY) {
      pick = 'away'; reason = `handicap=${h} 大盘口选客胜(让)`;
    } else {
      pick = argmax3(p0);
      reason = h === null || h === undefined ? 'argmax p0 (无让球)' : `argmax p0 (handicap=${h})`;
    }
    m.picks.rqspf = {
      play: 'rqspf', pick,
      pickLabel: pickLabel('rqspf', pick),
      odds: odds.rqspf_latest[pick],
      prob: round(p0[pick]),
      reason,
    };
  }

  // --- bf: 全部非聚合比分, odds 5-15
  if (odds.bf_latest) {
    for (const [score, odd] of Object.entries(odds.bf_latest)) {
      if (odd <= 1) continue;
      if (TUNING.BF_EXCLUDE_AGGREGATE && /其它$/.test(score)) continue;
      if (odd < TUNING.PAIR2_BF_ODDS_RANGE[0] || odd > TUNING.PAIR2_BF_ODDS_RANGE[1]) continue;
      const prob = fairProbFromOdds(odd);
      if (prob < TUNING.PAIR2_BF_PROB_RANGE[0] || prob > TUNING.PAIR2_BF_PROB_RANGE[1]) continue;
      m.picks.bf.push({
        play: 'bf', pick: score,
        pickLabel: score,
        odds: odd,
        prob: round(prob),
      });
    }
    // 按 prob 降序, 后面取 top 2
    m.picks.bf.sort((a, b) => b.prob - a.prob);
  }

  // --- zjq: 隐含 prob 最高的进球数
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

// ============== 4. 方向 A: bf 比分 2 串 1 (4 注 2x1) ==============
// 每场取 bf top N (按 prob 降序, 即最可能 N 个比分), 跨 2 场不同 mid 配对
const bfTopNByMatch = matches
  .filter(m => m.picks.bf.length >= 1)
  .map(m => ({
    mid: m.mid, code: m.code,
    home: m.home, away: m.away, kickoff: m.kickoff,
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

// ============== 5. 方向 B: spf/rqspf + zjq 3 串 1 ==============
const directionB = { parlays_3x1: [] };

if (matches.length >= TUNING.PARLAY3_MIN_DISTINCT_MATCHES) {
  const spfRqspfPicks = [];
  for (const m of matches) {
    if (m.picks.rqspf) spfRqspfPicks.push({ ...m.picks.rqspf, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff });
    else if (m.picks.spf) spfRqspfPicks.push({ ...m.picks.spf, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff });
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
            mid: p.mid, code: p.code, play: p.play, pick: p.pick, pickLabel: p.pickLabel,
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

// ============== 6. 方向 C: 主流单关 ==============
const directionC = { singles: [] };

const mainSingles = [];
for (const m of matches) {
  const candidates = [];
  if (m.picks.rqspf) candidates.push({ ...m.picks.rqspf, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff, _source: 'rqspf' });
  if (m.picks.spf && !TUNING.SINGLE_MAIN_PREFER_RQSPF) candidates.push({ ...m.picks.spf, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff, _source: 'spf' });
  for (const c of candidates) {
    if (c.odds < TUNING.SINGLE_MAIN_ODDS_RANGE[0] || c.odds > TUNING.SINGLE_MAIN_ODDS_RANGE[1]) continue;
    if (c.prob < TUNING.SINGLE_MAIN_MIN_PROB) continue;
    mainSingles.push(c);
  }
}
mainSingles.sort((a, b) => b.prob - a.prob);
directionC.singles = mainSingles.slice(0, TUNING.SINGLE_MAIN_KEEP_TOP);

// ============== 7. 命中率对比 ==============
const hitStats = { direction_a: { pairs: [] }, direction_b: { parlays: [] }, direction_c: { singles: [] } };

for (const p of directionA.pairs_2x1) {
  const mh = matches.find(m => m.mid === p.high.mid);
  const ml = matches.find(m => m.mid === p.low.mid);
  const hitH = normalizeScore(p.high.pick) === normalizeScore(mh.actualSummary.score);
  const hitL = normalizeScore(p.low.pick) === normalizeScore(ml.actualSummary.score);
  const allHit = hitH && hitL;
  hitStats.direction_a.pairs.push({
    high: { mid: p.high.mid, code: p.high.code, predicted: p.high.pick, actual: mh.actualSummary.score, hit: hitH, odds: p.high.odds, prob: p.high.prob },
    low: { mid: p.low.mid, code: p.low.code, predicted: p.low.pick, actual: ml.actualSummary.score, hit: hitL, odds: p.low.odds, prob: p.low.prob },
    totalOdds: p.totalOdds,
    totalProb: p.totalProb,
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
    if (pick.play === 'rqspf') return RQSPF_PICK_TO_RESULT[pick.pick] === m.actualSummary.handicapResult;
    if (pick.play === 'zjq') {
      const goals = pick.pick === '7+' ? 7 : Number(pick.pick);
      return goals === m.actualSummary.totalGoals;
    }
    return false;
  });
  const allHit = hits.every(h => h);
  hitStats.direction_b.parlays.push({
    picks: par.picks.map((p, i) => ({
      mid: p.mid, code: p.code, play: p.play, pick: p.pick, pickLabel: p.pickLabel,
      predicted: p.pickLabel, odds: p.odds, prob: p.prob,
      actual: matches.find(mm => mm.mid === p.mid)?.actualSummary,
      hit: hits[i],
    })),
    totalOdds: par.totalOdds,
    totalProb: par.totalProb,
    ev: par.ev,
    hit: allHit,
    return: allHit ? UNIT_STAKE * par.totalOdds : 0,
    cost: UNIT_STAKE,
    pnl: allHit ? UNIT_STAKE * (par.totalOdds - 1) : -UNIT_STAKE,
  });
}

for (const s of directionC.singles) {
  const m = matches.find(mm => mm.mid === s.mid);
  let hit;
  if (s.play === 'spf') hit = s.pick === m.actualSummary.winner;
  else if (s.play === 'rqspf') hit = RQSPF_PICK_TO_RESULT[s.pick] === m.actualSummary.handicapResult;
  else hit = false;
  hitStats.direction_c.singles.push({
    mid: s.mid, code: s.code, play: s.play, pick: s.pick, pickLabel: s.pickLabel,
    predicted: s.pickLabel, actual: m.actualSummary, odds: s.odds, fairProb: s.prob, hit,
    return: hit ? UNIT_STAKE * s.odds : 0,
    cost: UNIT_STAKE,
    pnl: hit ? UNIT_STAKE * (s.odds - 1) : -UNIT_STAKE,
  });
}

// ============== 8. 汇总 ==============
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
  direction_a_pairs: summarizePnl(hitStats.direction_a.pairs, '方向A bf 2串1'),
  direction_b_parlays: summarizePnl(hitStats.direction_b.parlays, '方向B spf/rqspf+zjq 3串1'),
  direction_c_singles: summarizePnl(hitStats.direction_c.singles, '方向C 主流单关'),
};
summary.totalCost = summary.direction_a_pairs.totalCost + summary.direction_b_parlays.totalCost + summary.direction_c_singles.totalCost;
summary.totalReturn = summary.direction_a_pairs.totalReturn + summary.direction_b_parlays.totalReturn + summary.direction_c_singles.totalReturn;
summary.totalPnl = round(summary.totalReturn - summary.totalCost, 2);
summary.totalRoi = summary.totalCost > 0 ? round(summary.totalPnl / summary.totalCost, 4) : null;

// ============== 9. 输出 ==============
const out = {
  generated_at: new Date().toISOString(),
  target_date: TARGET_DATE,
  unit_stake: UNIT_STAKE,
  source: `data/odds/<mid>.json + data/results/<mid>.json (${matches.length} 场 ${TARGET_DATE})`,
  algorithm: 'R-011 (v1 主流3串1+bf2串1+主流单关)',
  tuning: TUNING,
  matches: matches.map(m => ({
    mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff,
    handicap: m.handicap, picks: m.picks, actual: m.actualSummary,
  })),
  direction_a: directionA,
  direction_b: directionB,
  direction_c: directionC,
  hit_stats: hitStats,
  summary,
  notes: {
    direction_b_empty_reason: matches.length < TUNING.PARLAY3_MIN_DISTINCT_MATCHES
      ? `只 ${matches.length} 场比赛, 不足 ${TUNING.PARLAY3_MIN_DISTINCT_MATCHES} 场, 方向 B 跳过`
      : '方向 B 有推荐, 见 direction_b.parlays_3x1',
    direction_c_pick_strategy: TUNING.SINGLE_MAIN_PREFER_RQSPF ? '优先 rqspf (让球盘 prob 更高)' : '用 spf',
  },
};

const OUT_FILE = path.join(__dirname, '..', 'artifacts', `backtest_r011_${TARGET_DATE}.json`);
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8');

console.log(`\n[回测 R-011 ${TARGET_DATE}] 写入 ${OUT_FILE}`);
console.log(`\n=== 命中汇总 ===`);
console.log(`  方向 A bf 2串1:    ${summary.direction_a_pairs.hits}/${summary.direction_a_pairs.total} 命中 | cost ${summary.direction_a_pairs.totalCost} → return ${summary.direction_a_pairs.totalReturn} | pnl ${summary.direction_a_pairs.totalPnl} | ROI ${summary.direction_a_pairs.roi}`);
console.log(`  方向 B 3串1:        ${summary.direction_b_parlays.hits}/${summary.direction_b_parlays.total} 命中 | cost ${summary.direction_b_parlays.totalCost} → return ${summary.direction_b_parlays.totalReturn} | pnl ${summary.direction_b_parlays.totalPnl} | ROI ${summary.direction_b_parlays.roi}`);
console.log(`  方向 C 主流单关:   ${summary.direction_c_singles.hits}/${summary.direction_c_singles.total} 命中 | cost ${summary.direction_c_singles.totalCost} → return ${summary.direction_c_singles.totalReturn} | pnl ${summary.direction_c_singles.totalPnl} | ROI ${summary.direction_c_singles.roi}`);
console.log(`  合计:              cost ${summary.totalCost} → return ${summary.totalReturn} | pnl ${summary.totalPnl} | ROI ${summary.totalRoi}`);
console.log(`\n  ⚠️  ${out.notes.direction_b_empty_reason}`);

// 详细列出每条
console.log(`\n=== 方向 A bf 2串1 明细 ===`);
for (const p of hitStats.direction_a.pairs) {
  const h = p.high.hit ? '✅' : '❌';
  const l = p.low.hit ? '✅' : '❌';
  console.log(`  ${p.hit ? '✅' : '❌'}  ${p.high.code} pred=${p.high.predicted} actual=${p.high.actual} (${h}) × ${p.low.code} pred=${p.low.predicted} actual=${p.low.actual} (${l}) | total ${p.totalOdds} | pnl ${p.pnl}`);
}
console.log(`\n=== 方向 B 3串1 明细 ===`);
for (const p of hitStats.direction_b.parlays) {
  const pickDesc = p.picks.map(x => `${x.code}/${x.play} ${x.predicted}@${x.odds}(${x.hit ? '✅' : '❌'})`).join(' × ');
  console.log(`  ${p.hit ? '✅' : '❌'}  ${pickDesc} | total ${p.totalOdds} | pnl ${p.pnl}`);
}
if (hitStats.direction_c.singles.length > 0) {
  console.log(`\n=== 方向 C 主流单关明细 ===`);
  for (const s of hitStats.direction_c.singles) {
    console.log(`  ${s.hit ? '✅' : '❌'}  ${s.code} ${s.play} pred=${s.predicted} actual.score=${s.actual.score} winner=${s.actual.winner} handicapResult=${s.actual.handicapResult} @ ${s.odds} | fair prob ${(s.fairProb*100).toFixed(1)}% | pnl ${s.pnl}`);
  }
}
