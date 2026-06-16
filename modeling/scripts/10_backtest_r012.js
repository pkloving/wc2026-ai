// 10_backtest_r012.js
// R-012 算法回测: 修 pick 选法 (R-011 的核心瓶颈)
//   - pick 选法: 跟用户票 1 实证对齐
//     - 大盘口 (|h| >= 2) 选让球方 (home if h<0, away if h>0)
//     - handicap=null 选赔率最低方向 (隐含大盘)
//     - 中小盘口 (|h| <= 1) + home prob >= 0.40 选主胜
//     - 中小盘口 + away prob 最高 + 与 home 差 > 0.05 选 draw (反庄家诱多)
//     - 中小盘口 + p0 三者接近 选 draw
//     - 兜底选主胜
//   - hit 比较: handicap=null 时把 rqspf 当 spf 比 winner
//   - 其他结构同 R-011 (方向 A bf 2串1 + 方向 B 3串1 + 方向 C 主流单关)
//
// 用法: node 10_backtest_r012.js <YYYY-MM-DD> [--unit-stake=2]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ============== CLI ==============
const TARGET_DATE = process.argv[2];
if (!TARGET_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error('用法: node 10_backtest_r012.js <YYYY-MM-DD> [--unit-stake=2]');
  process.exit(1);
}
const UNIT_STAKE = Number((process.argv.find(a => a.startsWith('--unit-stake=')) || '--unit-stake=2').split('=')[1]);

// ============== TUNING (R-012) ==============
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

  // R-012 pick 选法核心 (学用户票 1)
  P0_DRAW_SPREAD_THRESHOLD: 0.08,       // p0 三者差 < 8% 选平
  P0_DRAW_MIN_PROB: 0.28,               // 选平时 p0.draw 至少 0.28
  P0_HOME_THRESHOLD: 0.40,              // p0.home >= 0.40 选主胜
  P0_AWAY_HOME_DIFF_FOR_DRAW: 0.05,     // p0.away 最高 且 p0.away - p0.home > 5% 选平 (反诱多)
  PREFER_HOME_FALLBACK: true,           // 兜底选主胜

  // 让球盘特殊选法 (大盘口)
  HANDICAP_DEEP_THRESHOLD: 2,           // |h| >= 2 算大盘口

  // zjq
  ZJQ_PROB_MIN: 0.15,
  ZJQ_MAX_ODDS: 12,
  ZJQ_MAX_GOALS: 5,

  // 通用
  BF_EXCLUDE_AGGREGATE: true,
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

// ============== R-012 v5 pick 选法核心 (跟用户票 1 完全对齐) ==============
// 规则:
//  1) handicap=null + spf=null → rqspf home (假设 +2)
//  2) handicap=null + spf 存在 → spf home
//  3) |h| >= 2 → rqspf 选让球方 (home if h<0, away if h>0)
//  4) |h| == 1:
//     - spf p0.away < 0.30 (弱 away) → spf draw
//     - spf p0.away >= 0.65 (强 away) → spf away
//     - 中间 (0.30-0.65) → rqspf draw (走盘)
//  5) |h| == 0 → spf home
// 6) hit 比较: spf 玩法比 winner, rqspf 玩法比 handicapResult (handicap=null+spf=null 假设 +2)

function pickR012(m) {
  if (!m.odds) return null;
  const h = m.handicap;
  const spf = m.odds.spf_latest;
  const rqspf = m.odds.rqspf_latest;

  // 1) handicap=null + spf=null → rqspf home (假设 +2)
  if (h === null && !spf && rqspf) {
    return { play: 'rqspf', pick: 'home', pickLabel: '主胜', odds: rqspf.home, prob: 1/rqspf.home/(1+0.13), reason: '无 handicap + 无 spf, 假设 +2 选主胜(让)' };
  }
  // 2) handicap=null + spf 存在 → spf home
  if (h === null && spf) {
    return { play: 'spf', pick: 'home', pickLabel: '主胜', odds: spf.home, prob: 1/spf.home/(1+0.13), reason: '无 handicap, spf 选主胜' };
  }
  // 3) |h| >= 2 → rqspf 选让球方
  if (h !== null && h <= -TUNING.HANDICAP_DEEP_THRESHOLD && rqspf) {
    return { play: 'rqspf', pick: 'home', pickLabel: '主胜', odds: rqspf.home, prob: 1/rqspf.home/(1+0.13), reason: '大盘口 h=' + h + ' 选主胜(让)' };
  }
  if (h !== null && h >= TUNING.HANDICAP_DEEP_THRESHOLD && rqspf) {
    return { play: 'rqspf', pick: 'away', pickLabel: '客胜', odds: rqspf.away, prob: 1/rqspf.away/(1+0.13), reason: '大盘口 h=+' + h + ' 选客胜(让)' };
  }
  // 4) |h| == 1: 看 spf
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
    // 中间或无 spf → rqspf draw
    if (rqspf) {
      return { play: 'rqspf', pick: 'draw', pickLabel: '平', odds: rqspf.draw, prob: 1/rqspf.draw/(1+0.13), reason: '中盘口 rqspf 选平(走盘)' };
    }
  }
  // 5) |h| == 0 → spf home
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
  if (!fs.existsSync(resultPath)) continue;
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
  let actualWinner;
  if (homeScore > awayScore) actualWinner = 'home';
  else if (homeScore < awayScore) actualWinner = 'away';
  else actualWinner = 'draw';
  let actualHandicapResult = null;
  if (m.handicap !== null && m.handicap !== undefined) {
    const adjustedHome = homeScore + m.handicap;
    if (adjustedHome > awayScore) actualHandicapResult = 'home_win';
    else if (adjustedHome < awayScore) actualHandicapResult = 'away_win';
    else actualHandicapResult = 'draw';
  }
  m.actualSummary = {
    score: `${homeScore}:${awayScore}`,
    winner: actualWinner,
    handicapResult: actualHandicapResult,
    totalGoals: total,
    handicap: m.handicap,
  };
}

// ============== 3. 收集 picks (R-012 v5 选法) ==============
for (const m of matches) {
  m.picks = { spf: null, rqspf: null, play: null, bf: [], zjq: null };
  const odds = m.odds;

  // R-012 v5 选主 play
  const play = pickR012(m);
  if (play) {
    m.picks.play = play;
    // 复制到 spf/rqspf 字段 (兼容后面方向 C 单关选法)
    if (play.play === 'spf') {
      m.picks.spf = {
        play: 'spf', pick: play.pick,
        pickLabel: pickLabel('spf', play.pick),
        odds: play.odds,
        prob: round(play.prob),
        reason: play.reason,
      };
    } else if (play.play === 'rqspf') {
      m.picks.rqspf = {
        play: 'rqspf', pick: play.pick,
        pickLabel: pickLabel('rqspf', play.pick),
        odds: play.odds,
        prob: round(play.prob),
        reason: play.reason,
      };
    }
  }

  // --- bf: 全部非聚合比分
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

// ============== 4. 方向 A: bf 比分 2 串 1 ==============
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

// ============== 5. 方向 B: spf/rqspf + zjq 3 串 1 ==============
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

// ============== 6. 方向 C: 主流单关 ==============
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

// ============== 7. 命中率对比 ==============
// R-012 关键: handicap=null 时如何比较
// 情况 1: handicap=null + spf_latest 存在 → 用 spf 比 winner
// 情况 2: handicap=null + spf_latest=null → 假设 handicap=+2, 用 rqspf 比
// 情况 3: handicap!=null → 用 rqspf 比 handicapResult
function isRqspfHit(m, pick) {
  if (m.handicap === null) {
    if (m.odds.spf_latest) {
      return pick === m.actualSummary.winner;
    }
    // 假设 handicap=+2 (隐含大盘, 学用户票 1 隐含 handicap)
    const adjustedHome = m.actual.homeScore + 2;
    if (adjustedHome > m.actual.awayScore) return pick === 'home';
    if (adjustedHome < m.actual.awayScore) return pick === 'away';
    return pick === 'draw';
  }
  return ({ home: 'home_win', draw: 'draw', away: 'away_win' })[pick] === m.actualSummary.handicapResult;
}

const hitStats = { direction_a: { pairs: [] }, direction_b: { parlays: [] }, direction_c: { singles: [] } };

for (const p of directionA.pairs_2x1) {
  const mh = matches.find(m => m.mid === p.high.mid);
  const ml = matches.find(m => m.mid === p.low.mid);
  const hitH = p.high.pick === mh.actualSummary.score;
  const hitL = p.low.pick === ml.actualSummary.score;
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
    if (pick.play === 'bf') return pick.pick === m.actualSummary.score;
    if (pick.play === 'spf') return pick.pick === m.actualSummary.winner;
    if (pick.play === 'rqspf') return isRqspfHit(m, pick.pick);
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
  else if (s.play === 'rqspf') hit = isRqspfHit(m, s.pick);
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
  algorithm: 'R-012 (v2 智能pick 主流3串1+bf2串1+主流单关)',
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
    pick_strategy: 'R-012: 大盘口 |h|>=2 选让球方 / handicap=null 选赔率最低 / 中小盘口 home>=0.40 选主胜 / away 最高+away-home>5% 选 draw / 兜底主胜',
    handicap_null_treatment: 'handicap=null 时 rqspf 当 spf 用, 比较 winner',
  },
};

const OUT_FILE = path.join(__dirname, '..', 'artifacts', `backtest_r012_${TARGET_DATE}.json`);
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8');

console.log(`\n[回测 R-012 ${TARGET_DATE}] 写入 ${OUT_FILE}`);
console.log(`\n=== 命中汇总 ===`);
console.log(`  方向 A bf 2串1:    ${summary.direction_a_pairs.hits}/${summary.direction_a_pairs.total} 命中 | cost ${summary.direction_a_pairs.totalCost} → return ${summary.direction_a_pairs.totalReturn} | pnl ${summary.direction_a_pairs.totalPnl} | ROI ${summary.direction_a_pairs.roi}`);
console.log(`  方向 B 3串1:        ${summary.direction_b_parlays.hits}/${summary.direction_b_parlays.total} 命中 | cost ${summary.direction_b_parlays.totalCost} → return ${summary.direction_b_parlays.totalReturn} | pnl ${summary.direction_b_parlays.totalPnl} | ROI ${summary.direction_b_parlays.roi}`);
console.log(`  方向 C 主流单关:   ${summary.direction_c_singles.hits}/${summary.direction_c_singles.total} 命中 | cost ${summary.direction_c_singles.totalCost} → return ${summary.direction_c_singles.totalReturn} | pnl ${summary.direction_c_singles.totalPnl} | ROI ${summary.direction_c_singles.roi}`);
console.log(`  合计:              cost ${summary.totalCost} → return ${summary.totalReturn} | pnl ${summary.totalPnl} | ROI ${summary.totalRoi}`);

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

console.log(`\n=== 全部 rqspf 选法明细 ===`);
for (const m of matches) {
  if (m.picks.play) {
    const r = m.picks.play;
    const a = m.actualSummary;
    const hit = isRqspfHit(m, r.pick);  // rqspf 比较
    const isSpfPick = r.play === 'spf';
    const hitActual = isSpfPick ? a.winner : a.handicapResult;
    console.log(`  ${hit ? '✅' : '❌'}  ${m.code} h=${m.handicap} ${m.home} vs ${m.away} | ${r.play} pred=${r.pickLabel}@${r.odds} (prob ${(r.prob*100).toFixed(1)}%) reason="${r.reason}" | actual score=${a.score} winner=${a.winner} handicapResult=${a.handicapResult}`);
  }
}
