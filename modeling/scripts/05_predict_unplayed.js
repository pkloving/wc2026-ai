#!/usr/bin/env node
/**
 * Step 5 · 对未开赛场次出推荐
 *
 * 输入：
 *   - data/matches_status.json（过滤 status !== "finished" && league === "世界杯"）
 *   - modeling/artifacts/win_model.json
 *   - modeling/artifacts/handicap_model.json
 *   - modeling/artifacts/score_model.json
 *
 * 输出：modeling/artifacts/predict_unplayed.json
 *
 * 关注范围：**仅世界杯正赛**（`data/matches.json` 的 M001-M104）。
 * 竞彩对国际赛热身也开了盘（league="国际赛"），本脚本硬过滤掉，
 * 训练侧也只吸收 league="世界杯" 标签的完赛样本。
 *
 * 每场未开赛比赛 3 件事：
 *   1. 胜平负推荐：win_model 规则打分
 *   2. 让球盘路推荐：handicap_model 查档位
 *   3. 比分 Top-3：score_model Poisson
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const STATUS_FILE = path.join(PROJECT_ROOT, 'data', 'matches_status.json');
const WIN_MODEL = path.join(__dirname, '..', 'artifacts', 'win_model.json');
const HANDI_MODEL = path.join(__dirname, '..', 'artifacts', 'handicap_model.json');
const SCORE_MODEL = path.join(__dirname, '..', 'artifacts', 'score_model.json');
const OUT_FILE = path.join(__dirname, '..', 'artifacts', 'predict_unplayed.json');

const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
const winModel = JSON.parse(fs.readFileSync(WIN_MODEL, 'utf-8'));
const handiModel = JSON.parse(fs.readFileSync(HANDI_MODEL, 'utf-8'));
const scoreModel = JSON.parse(fs.readFileSync(SCORE_MODEL, 'utf-8'));

// 仅对世界杯正赛未完赛场次出推荐；竞彩开的国际赛热身盘（league="国际赛"）一律忽略。
// "世界杯"=正赛、"国际赛"=热身——竞彩 league 标签即正赛/热身分流。
const candidates = status.matches.filter(
  (m) => m.status !== 'finished' && m.league === '世界杯'
);
console.log(`未开赛/进行中（仅世界杯正赛）：${candidates.length} 场`);

// ---- 工具 ----
function logFactorial(k) {
  if (k === 0) return 0;
  let s = 0;
  for (let i = 1; i <= k; i += 1) s += Math.log(i);
  return s;
}
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}
function impliedProbs(odds) {
  if (!odds) return null;
  const inv = { home: 1 / odds.home, draw: 1 / odds.draw, away: 1 / odds.away };
  const sum = inv.home + inv.draw + inv.away;
  return { p0_home: inv.home / sum, p0_draw: inv.draw / sum, p0_away: inv.away / sum };
}

// ---- 1. 胜平负推荐 ----
function predictWin(m) {
  if (!m.spf) return { pick: null, confidence: 0, rationale: 'spf 未开售，无法判断胜平负' };
  const imp = impliedProbs(m.spf);
  // 找 p0 最大方向
  let pick = 'home';
  if (imp.p0_draw >= imp.p0_home && imp.p0_draw >= imp.p0_away) pick = 'draw';
  else if (imp.p0_away >= imp.p0_home && imp.p0_away >= imp.p0_draw) pick = 'away';
  // 信心度：看赔率最低那个
  const minOdds = Math.min(m.spf.home, m.spf.draw, m.spf.away);
  let confidence = 2; // 默认 ⭐⭐
  let label = '适中';
  if (minOdds < winModel.rules.fav_threshold) { confidence = 3; label = '大热门'; }
  else if (minOdds >= winModel.rules.long_shot_threshold) { confidence = 1; label = '大冷门'; }
  // 抑制平局
  if (pick === 'draw' && m.spf.draw < winModel.rules.draw_threshold) {
    return { pick: null, confidence: 0, rationale: `平局赔率 ${m.spf.draw} < ${winModel.rules.draw_threshold}，样本提示低赔平局假信号多，不推荐平` };
  }
  const rationale = `${label}（${pick === 'home' ? '主胜' : pick === 'away' ? '客胜' : '平局'} 赔率 ${m.spf[pick]}，p0 ${(imp[`p0_${pick}`] * 100).toFixed(0)}%）`;
  return { pick, confidence, label, rationale };
}

// ---- 2. 让球盘路推荐 ----
function predictHandicap(m) {
  if (m.handicap === null || m.handicap === undefined) {
    return { verdict: 'not_applicable', reason: 'handicap 未公布' };
  }
  if (m.handicap === 0) {
    return { verdict: 'not_applicable', reason: '让 0 球，等同 spf' };
  }
  const key = String(m.handicap);
  const tbl = handiModel.by_handicap[key];
  if (!tbl || tbl.n < handiModel.verdict_thresholds.min_samples) {
    return { verdict: 'skip', reason: `让${m.handicap} 样本不足（${tbl ? tbl.n : 0} < ${handiModel.verdict_thresholds.min_samples}）` };
  }
  if (tbl.home_win_rate >= handiModel.verdict_thresholds.chase_min_win_rate) {
    return {
      verdict: 'chase',
      reason: `让${m.handicap} 样本主胜率 ${(tbl.home_win_rate * 100).toFixed(0)}% >= 55%`,
      sample_win_rate: tbl.home_win_rate,
    };
  }
  return {
    verdict: 'skip',
    reason: `让${m.handicap} 样本主胜率 ${(tbl.home_win_rate * 100).toFixed(0)}% < 55%`,
    sample_win_rate: tbl.home_win_rate,
  };
}

// ---- 3. 比分 Top-3 ----
function predictScore(m) {
  const p0 = m.spf ? impliedProbs(m.spf).p0_home : null;
  let tier = 'balanced';
  if (p0 !== null) {
    if (p0 > scoreModel.tier_thresholds.strong_fav_p0) tier = 'strong_fav';
    else if (p0 < scoreModel.tier_thresholds.weak_fav_p0) tier = 'weak_fav';
  }
  const adj = scoreModel.tier_adjustment[tier];
  const lh = scoreModel.global_lambda_home * adj.home_mult;
  const la = scoreModel.global_lambda_away * adj.away_mult;
  const max = scoreModel.score_grid_max;
  const grid = [];
  let total = 0;
  for (let h = 0; h <= max; h += 1) {
    for (let a = 0; a <= max; a += 1) {
      const p = poissonPmf(h, lh) * poissonPmf(a, la);
      grid.push({ h, a, p });
      total += p;
    }
  }
  for (const g of grid) g.p = g.p / total;
  grid.sort((x, y) => y.p - x.p);
  return {
    tier,
    lambda_home: round(lh),
    lambda_away: round(la),
    top3: grid.slice(0, 3).map((g) => ({ score: `${g.h}-${g.a}`, prob: round(g.p) })),
  };
}

// ---- 主循环 ----
const predictions = candidates.map((m) => {
  const win = predictWin(m);
  const handi = predictHandicap(m);
  const score = predictScore(m);
  return {
    mid: m.mid,
    code: m.code,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    handicap: m.handicap,
    spf: m.spf,
    rqspf: m.rqspf,
    status: m.status,
    recommendations: {
      win: { pick: win.pick, confidence: win.confidence, label: win.label || null, rationale: win.rationale },
      handicap: { verdict: handi.verdict, reason: handi.reason, sample_win_rate: handi.sample_win_rate ?? null },
      score_top3: score.top3,
    },
    score_meta: { tier: score.tier, lambda_home: score.lambda_home, lambda_away: score.lambda_away },
  };
});

const out = {
  generated_at: new Date().toISOString(),
  source: 'data/matches_status.json (status !== finished && league === "世界杯")',
  scope: '世界杯正赛（data/matches.json M001-M104），不含国际赛热身',
  models_used: [
    'modeling/artifacts/win_model.json',
    'modeling/artifacts/handicap_model.json',
    'modeling/artifacts/score_model.json',
  ],
  input_count: predictions.length,
  predictions,
};

if (!fs.existsSync(path.dirname(OUT_FILE))) fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8');

// ---- 自检：所有 mid 都在 matches_status.json 找得到 ----
const allMids = new Set(status.matches.map((m) => m.mid));
const missing = predictions.filter((p) => !allMids.has(p.mid));
if (missing.length > 0) {
  console.error(`❌ 自检失败：${missing.length} 条 mid 在 matches_status.json 找不到！`);
  process.exit(1);
}

// ---- 摘要 ----
const winCount = predictions.filter((p) => p.recommendations.win.pick).length;
const chaseCount = predictions.filter((p) => p.recommendations.handicap.verdict === 'chase').length;
console.log(`输出 ${predictions.length} 条推荐`);
console.log(`  胜平负有推荐：${winCount}`);
console.log(`  让球 chase：${chaseCount}`);
console.log(`  落盘 ${path.relative(PROJECT_ROOT, OUT_FILE)}`);

function round(n) { return Math.round(n * 1000) / 1000; }
