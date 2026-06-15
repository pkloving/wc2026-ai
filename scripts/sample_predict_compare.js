// scripts/sample_predict_compare.js
// 随机抽一场已完赛的世界杯正赛，用模型对它的 spf/rqspf/handicap 做一次推测，
// 输出 win/handicap/score 三类推荐与实际比分的对比。
// 用途：人工验证 3 个模型的逻辑是否合理（不是回测，回测见 modeling/data/01_matches_with_odds.json）

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const data = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'modeling/data/01_matches_with_odds.json'), 'utf-8')
);
const winModel = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'modeling/artifacts/win_model.json'), 'utf-8')
);
const handiModel = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'modeling/artifacts/handicap_model.json'), 'utf-8')
);
const scoreModel = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'modeling/artifacts/score_model.json'), 'utf-8')
);

// 用法：node scripts/sample_predict_compare.js [--mid=2040xxx]
// 不传 --mid：随机抽 1 场（seed = 今日）；优先挑 spf 非空的
const argMid = (process.argv.find((a) => a.startsWith('--mid=')) || '').slice(6);

const seed = new Date().toISOString().slice(0, 10);
let s = 0;
for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
let idx, m;
if (argMid) {
  const found = data.matches.findIndex((x) => x.mid === argMid);
  if (found < 0) {
    console.error(`--mid=${argMid} 在 01_matches_with_odds.json 找不到`);
    process.exit(1);
  }
  idx = found;
  m = data.matches[found];
} else {
  const candidates = data.matches
    .map((mm, i) => ({ m: mm, i }))
    .filter((x) => x.m.spf);
  if (candidates.length === 0) {
    console.error('没有 spf 非空的完赛场次！');
    process.exit(1);
  }
  const picked = candidates[s % candidates.length];
  idx = picked.i;
  m = picked.m;
}

console.log(`=== 样本（seed=${seed}, idx=${idx}/${data.matches.length}） ===`);
console.log(`mid:        ${m.mid}`);
console.log(`code:       ${m.code}`);
console.log(`对阵:       ${m.home} vs ${m.away}`);
console.log(`kickoff:    ${m.kickoff}`);
console.log(`spf:        ${JSON.stringify(m.spf)}`);
console.log(`handicap:   ${m.handicap}`);
console.log(`rqspf:      ${JSON.stringify(m.rqspf)}`);
console.log(`实际比分:    ${m.derived.home_goals}-${m.derived.away_goals}`);
console.log(`胜平负结果:  ${m.derived.actual_winner}`);
console.log(`让球后结果:  ${m.derived.actual_handicap_result}`);
console.log('');

// ---- 工具：反推 P0 ----
function impliedProbs(odds) {
  if (!odds) return null;
  const inv = { home: 1 / odds.home, draw: 1 / odds.draw, away: 1 / odds.away };
  const sum = inv.home + inv.draw + inv.away;
  return { p0_home: inv.home / sum, p0_draw: inv.draw / sum, p0_away: inv.away / sum };
}

// ---- 1. 胜平负推测 ----
function predictWin(spf) {
  if (!spf) return { pick: null, label: 'spf 缺' };
  const imp = impliedProbs(spf);
  let pick = 'home';
  if (imp.p0_draw >= imp.p0_home && imp.p0_draw >= imp.p0_away) pick = 'draw';
  else if (imp.p0_away >= imp.p0_home && imp.p0_away >= imp.p0_draw) pick = 'away';
  const minOdds = Math.min(spf.home, spf.draw, spf.away);
  let confidence = 2, label = '适中';
  if (minOdds < winModel.rules.fav_threshold) { confidence = 3; label = '大热门'; }
  else if (minOdds >= winModel.rules.long_shot_threshold) { confidence = 1; label = '大冷门'; }
  if (pick === 'draw' && spf.draw < winModel.rules.draw_threshold) {
    return { pick: null, label: `平局赔率 ${spf.draw} < ${winModel.rules.draw_threshold} → 抑制平局` };
  }
  return {
    pick,
    confidence,
    label,
    p0: (imp[`p0_${pick}`] * 100).toFixed(1) + '%',
    min_odds: minOdds,
  };
}

// ---- 2. 让球盘路推测 ----
function predictHandicap(handicap) {
  if (handicap === null || handicap === undefined) return { verdict: 'not_applicable', reason: 'handicap 缺' };
  if (handicap === 0) return { verdict: 'not_applicable', reason: '让 0 球，等同 spf' };
  const key = String(handicap);
  const tbl = handiModel.by_handicap[key];
  if (!tbl || tbl.n < handiModel.verdict_thresholds.min_samples) {
    return { verdict: 'skip', reason: `让${handicap} 样本不足（${tbl ? tbl.n : 0} < ${handiModel.verdict_thresholds.min_samples}）` };
  }
  if (tbl.home_win_rate >= handiModel.verdict_thresholds.chase_min_win_rate) {
    return { verdict: 'chase', reason: `让${handicap} 样本主胜率 ${(tbl.home_win_rate * 100).toFixed(0)}% >= 55%`, sample_win_rate: tbl.home_win_rate };
  }
  return { verdict: 'skip', reason: `让${handicap} 样本主胜率 ${(tbl.home_win_rate * 100).toFixed(0)}% < 55%`, sample_win_rate: tbl.home_win_rate };
}

// ---- 3. 比分 Top-3 ----
function predictScore(spf) {
  const p0 = spf ? impliedProbs(spf).p0_home : null;
  let tier = 'balanced';
  if (p0 !== null) {
    if (p0 > scoreModel.tier_thresholds.strong_fav_p0) tier = 'strong_fav';
    else if (p0 < scoreModel.tier_thresholds.weak_fav_p0) tier = 'weak_fav';
  }
  const adj = scoreModel.tier_adjustment[tier];
  const lh = scoreModel.global_lambda_home * adj.home_mult;
  const la = scoreModel.global_lambda_away * adj.away_mult;
  const max = scoreModel.score_grid_max;
  // poisson PMF
  function logFactorial(k) { let s=0; for(let i=1;i<=k;i++)s+=Math.log(i); return s; }
  function pmf(k, lambda) { return lambda<=0?(k===0?1:0):Math.exp(-lambda + k*Math.log(lambda) - logFactorial(k)); }
  const grid = []; let total = 0;
  for (let h = 0; h <= max; h++) for (let a = 0; a <= max; a++) {
    const p = pmf(h, lh) * pmf(a, la);
    grid.push({ h, a, p }); total += p;
  }
  for (const g of grid) g.p = g.p / total;
  grid.sort((x, y) => y.p - x.p);
  return {
    tier,
    lambda_home: lh.toFixed(2),
    lambda_away: la.toFixed(2),
    top3: grid.slice(0, 3).map((g) => `${g.h}-${g.a}（${(g.p*100).toFixed(1)}%）`),
  };
}

const win = predictWin(m.spf);
const handi = predictHandicap(m.handicap);
const score = predictScore(m.spf);

console.log('=== 模型推测 ===');
console.log(`[胜平负] pick=${win.pick ?? '—'}  confidence=${win.confidence ?? '—'}  label=${win.label}  p0=${win.p0 ?? '—'}  min_odds=${win.min_odds ?? '—'}`);
console.log(`         实际=${m.derived.actual_winner}  ${win.pick === m.derived.actual_winner ? '✅ 命中' : '❌ 未中'}`);
console.log(`[让球]   verdict=${handi.verdict}  reason=${handi.reason}`);
console.log(`         实际=${m.derived.actual_handicap_result}`);
console.log(`[比分]   tier=${score.tier}  λh=${score.lambda_home}  λa=${score.lambda_away}`);
console.log(`         Top-3: ${score.top3.join('  ')}`);
console.log(`         实际=${m.derived.home_goals}-${m.derived.away_goals}`);

// movement 信息（如果 history 有 ≥2 快照就贴上）
const histFile = path.join(PROJECT_ROOT, 'data/odds_history', `${m.mid}.json`);
if (fs.existsSync(histFile)) {
  const h = JSON.parse(fs.readFileSync(histFile, 'utf-8'));
  const spfN = (h.spf_history || []).length;
  const rqN = (h.rqspf_history || []).length;
  console.log('');
  console.log(`[赔率变动] spf n=${spfN}  rqspf n=${rqN}`);
  if (spfN >= 2) {
    const open = h.spf_history[0];
    const last = h.spf_history[spfN - 1];
    console.log(`  spf open  = ${open.home}/${open.draw}/${open.away}  (${open.time})`);
    console.log(`  spf last  = ${last.home}/${last.draw}/${last.away}  (${last.time})`);
    console.log(`  spf delta = ${(last.home-open.home).toFixed(2)} / ${(last.draw-open.draw).toFixed(2)} / ${(last.away-open.away).toFixed(2)}`);
  }
  if (rqN >= 2) {
    const open = h.rqspf_history[0];
    const last = h.rqspf_history[rqN - 1];
    console.log(`  rqspf open  = ${open.home}/${open.draw}/${open.away}  (${open.time})`);
    console.log(`  rqspf last  = ${last.home}/${last.draw}/${last.away}  (${last.time})`);
    console.log(`  rqspf delta = ${(last.home-open.home).toFixed(2)} / ${(last.draw-open.draw).toFixed(2)} / ${(last.away-open.away).toFixed(2)}`);
  }
}
