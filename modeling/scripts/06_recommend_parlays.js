// 06_recommend_parlays.js
// 推荐算法 v3: 2 个方向 (方向 A 比分玩法 / 方向 B 胜负+让球+进球数 3串1), 整体倍率 > 8
//
// 输入: modeling/artifacts/predict_unplayed.json + data/odds/<mid>.json
// 输出: modeling/artifacts/recommend_parlays.json
//
// 硬规则:
//   - 整体倍率 > 8
//   - 方向 A 比分玩法: 单关爆冷 (odds>12) / 2串1 高+低 (总 odds>8)
//   - 方向 B 胜负+让球+进球数 3串1: 3 场不同比赛, 至少 1 场 spf/rqspf, 至少 1 场 zjq, 总 odds>8
//
// 算法层 (TUNING 常量): 改这里就改推荐策略

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ============== TUNING 常量 (调优算法就改这里) ==============
const TUNING = {
  // 抽水 (sporttery.cn 历史抽水约 13%, 用于 fair prob 估算)
  VIG: 0.13,

  // 整体倍率门槛 (R-010 硬规则)
  MIN_OVERALL_ODDS: 8,

  // 次日过滤 (kickoff 起头日期 = "2026-06-17"), 避免混进 6-16/6-18
  NEXT_DAY: '2026-06-17',

  // 单 pick 赔率上限 (避免 7+球 50x / 0:3 250x 等极端值污染推荐)
  MAX_PICK_ODDS: 35,

  // zjq 进球数封顶 (6+球赔率太高, 概率太低, 实际推荐中不参与)
  ZJQ_MAX_GOALS: 5,

  // zjq 合理性下限 (排除 0 球/4+球等小概率候选, 避免 3 场 0 球配 0 球的极端组合)
  ZJQ_MIN_PROB: 0.15,

  // 方向 A - 比分玩法
  SINGLE_OUTSIDER_MIN_ODDS: 12,           // 单关爆冷最低赔率
  SINGLE_OUTSIDER_PROB_RANGE: [0.04, 0.12], // 概率在 4-12% 之间
  PAIR_HIGH_ODDS: 12,                     // 2串1 高倍率门槛
  PAIR_HIGH_PROB: [0.03, 0.15],
  PAIR_LOW_ODDS: [5, 12],                 // 2串1 低倍率区间
  PAIR_LOW_PROB: [0.07, 0.20],

  // 方向 B - 3串1
  PARLAY3_MIN_DISTINCT_MATCHES: 3,        // 3 场必须不同
  PARLAY3_REQUIRE_SPF_OR_RQSPF: true,     // 至少 1 场 spf/rqspf
  PARLAY3_REQUIRE_ZJQ: true,              // 至少 1 场 zjq
  PARLAY3_KEEP_TOP: 8,                    // 保留前 N 个候选

  // bf/zjq 过滤: 排除 "胜其它" / "平其它" / "负其它" 聚合项 (R-004 #5 语义)
  BF_EXCLUDE_AGGREGATE: true,

  // bqc 当前数据为空, 不参与推荐
  INCLUDE_BQC: false,
};

// ============== 工具 ==============
function impliedProbs3(odds) {
  if (!odds) return null;
  const inv = { home: 1/odds.home, draw: 1/odds.draw, away: 1/odds.away };
  const sum = inv.home + inv.draw + inv.away;
  return {
    home: inv.home/sum,
    draw: inv.draw/sum,
    away: inv.away/sum,
    vig: sum - 1,
  };
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

// ============== 1. 读输入 ==============
const PREDICT = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'artifacts', 'predict_unplayed.json'),
  'utf-8'
));

// ============== 2. 收集每场候选 picks ==============
const matches = [];
for (const pred of PREDICT.predictions) {
  const oddsPath = path.join(PROJECT_ROOT, 'data', 'odds', `${pred.mid}.json`);
  if (!fs.existsSync(oddsPath)) {
    console.warn(`[跳过] mid=${pred.mid} 无 odds 文件`);
    continue;
  }
  const oddsDoc = JSON.parse(fs.readFileSync(oddsPath, 'utf-8'));
  const odds = oddsDoc.odds;

  const matchPicks = [];

  // spf 主胜/平/客胜
  if (odds.spf_latest) {
    const p0 = impliedProbs3(odds.spf_latest);
    const pick = argmax3(p0);
    matchPicks.push({
      play: 'spf', pick,
      pickLabel: pickLabel('spf', pick),
      odds: odds.spf_latest[pick],
      prob: round(p0[pick]),
      probSource: 'market_implied',
    });
  }

  // rqspf 让球胜平负
  if (odds.rqspf_latest) {
    const p0 = impliedProbs3(odds.rqspf_latest);
    const pick = argmax3(p0);
    matchPicks.push({
      play: 'rqspf', pick,
      pickLabel: pickLabel('rqspf', pick),
      odds: odds.rqspf_latest[pick],
      prob: round(p0[pick]),
      probSource: 'market_implied',
    });
  }

  // bf 比分 (排除聚合项)
  if (odds.bf_latest) {
    for (const [score, odd] of Object.entries(odds.bf_latest)) {
      if (odd <= 1) continue;
      if (TUNING.BF_EXCLUDE_AGGREGATE && /其它$/.test(score)) continue;
      matchPicks.push({
        play: 'bf', pick: score,
        pickLabel: score,
        odds: odd,
        prob: round(fairProbFromOdds(odd)),
        probSource: 'bf_implied',
      });
    }
  }

  // zjq 进球数
  if (odds.zjq_latest) {
    for (const [goals, odd] of Object.entries(odds.zjq_latest)) {
      if (odd <= 1) continue;
      if (odd > TUNING.MAX_PICK_ODDS) continue;
      // 进球数封顶 (7+ 球赔率太高, 不参与)
      const goalsNum = goals === '7+' ? 7 : Number(goals);
      if (Number.isFinite(goalsNum) && goalsNum > TUNING.ZJQ_MAX_GOALS) continue;
      matchPicks.push({
        play: 'zjq', pick: goals,
        pickLabel: `${goals}球`,
        odds: odd,
        prob: round(fairProbFromOdds(odd)),
        probSource: 'zjq_implied',
      });
    }
  }

  matches.push({
    mid: pred.mid,
    code: pred.code,
    home: pred.home,
    away: pred.away,
    kickoff: pred.kickoff,
    handicap: pred.handicap,
    picks: matchPicks,
  });
}

// 应用 NEXT_DAY 过滤
const filtered = matches.filter(m => m.kickoff && m.kickoff.startsWith(TUNING.NEXT_DAY));
const skipped = matches.length - filtered.length;
if (skipped > 0) {
  console.log(`[NEXT_DAY 过滤] 保留 ${filtered.length} 场, 跳过 ${skipped} 场非 6-17 比赛`);
}
const matchesFinal = filtered;

console.log(`[输入] ${matchesFinal.length} 场 next-day (${TUNING.NEXT_DAY}) 比赛, 共 ${matchesFinal.reduce((a, m) => a + m.picks.length, 0)} 个候选 picks`);

// ============== 3. 方向 A: 比分玩法 ==============
const directionA = { singles: [], pairs_2x1: [] };

// 单关爆冷
const allBf = matchesFinal.flatMap(m => m.picks
  .filter(p => p.play === 'bf')
  .map(p => ({ ...p, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff }))
);

directionA.singles = allBf
  .filter(p =>
    p.odds > TUNING.SINGLE_OUTSIDER_MIN_ODDS &&
    p.prob > TUNING.SINGLE_OUTSIDER_PROB_RANGE[0] &&
    p.prob < TUNING.SINGLE_OUTSIDER_PROB_RANGE[1]
  )
  .sort((a, b) => b.odds - a.odds)
  .slice(0, 5);

// 2串1 高+低
const high = allBf.filter(p =>
  p.odds > TUNING.PAIR_HIGH_ODDS &&
  p.prob > TUNING.PAIR_HIGH_PROB[0] &&
  p.prob < TUNING.PAIR_HIGH_PROB[1]
);
const low = allBf.filter(p =>
  p.odds >= TUNING.PAIR_LOW_ODDS[0] && p.odds <= TUNING.PAIR_LOW_ODDS[1] &&
  p.prob > TUNING.PAIR_LOW_PROB[0] && p.prob < TUNING.PAIR_LOW_PROB[1]
);

const pairKey = (h, l) => [h.mid, h.pick, l.mid, l.pick].sort().join('|');
const pairSet = new Set();
const pairs = [];
for (const h of high) {
  for (const l of low) {
    if (h.mid === l.mid) continue;
    const totalOdds = round(h.odds * l.odds);
    if (totalOdds < TUNING.MIN_OVERALL_ODDS) continue;
    const key = pairKey(h, l);
    if (pairSet.has(key)) continue;
    pairSet.add(key);
    pairs.push({
      high: {
        mid: h.mid, code: h.code, play: 'bf', pick: h.pick, pickLabel: h.pickLabel,
        odds: h.odds, prob: h.prob, kickoff: h.kickoff, home: h.home, away: h.away,
      },
      low: {
        mid: l.mid, code: l.code, play: 'bf', pick: l.pick, pickLabel: l.pickLabel,
        odds: l.odds, prob: l.prob, kickoff: l.kickoff, home: l.home, away: l.away,
      },
      totalOdds,
      totalProb: round(h.prob * l.prob),
    });
  }
}
pairs.sort((a, b) => b.totalOdds - a.totalOdds);
directionA.pairs_2x1 = pairs.slice(0, 5);

// ============== 4. 方向 B: 胜负/让球 + 进球数 3串1 ==============
const directionB = { parlays_3x1: [] };

const spfRqspfPicks = matchesFinal.flatMap(m => m.picks
  .filter(p => p.play === 'spf' || p.play === 'rqspf')
  .map(p => ({ ...p, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff }))
);
const zjqPicks = matchesFinal.flatMap(m => m.picks
  .filter(p => p.play === 'zjq' && p.prob >= TUNING.ZJQ_MIN_PROB)
  .map(p => ({ ...p, mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff }))
);

const allPicks = [...spfRqspfPicks, ...zjqPicks];

const parlay3Key = (arr) => arr.map(x => `${x.mid}-${x.play}-${x.pick}`).sort().join('|');
const parlay3Set = new Set();
const parlays3 = [];

for (const p1 of spfRqspfPicks) {
  for (const p2 of zjqPicks) {
    if (p1.mid === p2.mid) continue;
    for (const p3 of allPicks) {
      const mids = new Set([p1.mid, p2.mid, p3.mid]);
      if (mids.size !== TUNING.PARLAY3_MIN_DISTINCT_MATCHES) continue;
      // 至少 1 spf/rqspf (p1 已保证) + 至少 1 zjq (p2 已保证)
      const totalOdds = round(p1.odds * p2.odds * p3.odds);
      if (totalOdds < TUNING.MIN_OVERALL_ODDS) continue;
      const picks = [p1, p2, p3];
      const key = parlay3Key(picks);
      if (parlay3Set.has(key)) continue;
      parlay3Set.add(key);
      parlays3.push({
        picks: picks.map(p => ({
          mid: p.mid, code: p.code, play: p.play, pick: p.pick, pickLabel: p.pickLabel,
          odds: p.odds, prob: p.prob, kickoff: p.kickoff, home: p.home, away: p.away,
        })),
        totalOdds,
        totalProb: round(p1.prob * p2.prob * p3.prob),
        // 排序键: 期望值 (prob × odds) — 高 EV 优先
        ev: round((p1.prob * p2.prob * p3.prob) * (p1.odds * p2.odds * p3.odds)),
      });
    }
  }
}

// 排序: 总赔率 (高赔率优先) + EV (高 EV 次之)
parlays3.sort((a, b) => {
  if (b.totalOdds !== a.totalOdds) return b.totalOdds - a.totalOdds;
  return b.ev - a.ev;
});
directionB.parlays_3x1 = parlays3.slice(0, TUNING.PARLAY3_KEEP_TOP);

// ============== 5. 整体倍率校验 ==============
const allDirectionAOdds = [
  ...directionA.singles.map(s => s.odds),
  ...directionA.pairs_2x1.map(p => p.totalOdds),
];
const allDirectionBOdds = directionB.parlays_3x1.map(p => p.totalOdds);

const overallCheck = {
  direction_a_min_odds: allDirectionAOdds.length ? Math.min(...allDirectionAOdds) : null,
  direction_a_max_odds: allDirectionAOdds.length ? Math.max(...allDirectionAOdds) : null,
  direction_b_min_odds: allDirectionBOdds.length ? Math.min(...allDirectionBOdds) : null,
  direction_b_max_odds: allDirectionBOdds.length ? Math.max(...allDirectionBOdds) : null,
  threshold: TUNING.MIN_OVERALL_ODDS,
  pass:
    allDirectionAOdds.length > 0 &&
    allDirectionBOdds.length > 0 &&
    Math.min(...allDirectionAOdds) > TUNING.MIN_OVERALL_ODDS &&
    Math.min(...allDirectionBOdds) > TUNING.MIN_OVERALL_ODDS,
};

// ============== 6. 输出 ==============
const out = {
  generated_at: new Date().toISOString(),
  source: 'modeling/artifacts/predict_unplayed.json + data/odds/<mid>.json',
  scope: '次日 6-17 世界杯正赛 4 场',
  algorithm: {
    name: 'v3 two-direction parlays',
    direction_a: '比分玩法: 单关爆冷 (odds>12) / 2串1 高+低 (总 odds>8)',
    direction_b: '胜负/让球 + 进球数 3串1 (3 场不同比赛, 总 odds>8)',
    hard_rule: '整体倍率 > 8',
    replaces: 'R-007 §1 K≥0.10 决策顺序 + R-008 串关为底 (R-010 新规则)',
  },
  tuning: TUNING,
  matches: matchesFinal.map(m => ({
    mid: m.mid, code: m.code, home: m.home, away: m.away, kickoff: m.kickoff,
    handicap: m.handicap, pickCount: m.picks.length,
  })),
  direction_a: directionA,
  direction_b: directionB,
  overall_check: overallCheck,
  summary: {
    direction_a_singles_count: directionA.singles.length,
    direction_a_pairs_count: directionA.pairs_2x1.length,
    direction_b_parlays_count: directionB.parlays_3x1.length,
    overall_pass: overallCheck.pass,
  },
};

const OUT_FILE = path.join(__dirname, '..', 'artifacts', 'recommend_parlays.json');
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8');

console.log(`\n[方向 A 单关爆冷] ${directionA.singles.length} 候选`);
for (const s of directionA.singles.slice(0, 3)) {
  console.log(`  - ${s.code} ${s.home} vs ${s.away} | bf ${s.pick} @ ${s.odds} (prob ${(s.prob*100).toFixed(1)}%)`);
}
console.log(`[方向 A 2串1 高+低] ${directionA.pairs_2x1.length} 候选`);
for (const p of directionA.pairs_2x1.slice(0, 3)) {
  console.log(`  - ${p.high.code} ${p.high.pick}@${p.high.odds} × ${p.low.code} ${p.low.pick}@${p.low.odds} = ${p.totalOdds}`);
}
console.log(`[方向 B 3串1 胜负+进球数] ${directionB.parlays_3x1.length} 候选`);
for (const p of directionB.parlays_3x1.slice(0, 3)) {
  const codes = p.picks.map(x => `${x.code}/${x.playLabel||x.play} ${x.pickLabel}@${x.odds}`).join(' × ');
  console.log(`  - ${codes} = ${p.totalOdds}`);
}
console.log(`\n[整体倍率校验] pass=${overallCheck.pass} | A min=${overallCheck.direction_a_min_odds?.toFixed(2)} | B min=${overallCheck.direction_b_min_odds?.toFixed(2)} | 阈值=${TUNING.MIN_OVERALL_ODDS}`);
