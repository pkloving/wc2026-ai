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

// ---- 注入：data/teams 球队属性（tier / style / stars / is_host 等）----
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const TEAMS_DIR = path.join(DATA_DIR, 'teams');
const teamsIndexPath = path.join(TEAMS_DIR, '_index.json');
const teamsIndex = fs.existsSync(teamsIndexPath)
  ? JSON.parse(fs.readFileSync(teamsIndexPath, 'utf-8'))
  : { by_code: {}, by_name: {}, by_tier: {}, hosts: [], name_variants_to_code: {} };
const teamDocs = new Map();
for (const code of Object.keys(teamsIndex.by_code || {})) {
  const f = path.join(TEAMS_DIR, `${code}.json`);
  if (!fs.existsSync(f)) continue;
  try { teamDocs.set(code, JSON.parse(fs.readFileSync(f, 'utf-8'))); } catch (_) { /* ignore */ }
}
const nameToCode = new Map();
for (const [zh, code] of Object.entries(teamsIndex.by_name || {})) nameToCode.set(zh, code);
for (const [variant, code] of Object.entries(teamsIndex.name_variants_to_code || {})) nameToCode.set(variant, code);
const NAME_SHORTCUTS = {
  '沙特阿拉伯': 'KSA', '沙特': 'KSA',
  '乌兹别克斯坦': 'UZB', '乌兹别克': 'UZB',
  '刚果（金）': 'COD', '刚果(金)': 'COD',
  '哥斯达黎加': 'CRC', '哥斯达': 'CRC',
  '哈萨克斯坦': 'KAZ', '哈萨克': 'KAZ',
  '尼日利亚': 'NGA', '威尔士': 'WAL', '波兰': 'POL',
  '丹麦': 'DEN', '喀麦隆': 'CMR', '塞尔维亚': 'SRB',
};
for (const [zh, code] of Object.entries(NAME_SHORTCUTS)) if (!nameToCode.has(zh)) nameToCode.set(zh, code);
function resolveTeam(zhName) {
  if (!zhName) return { code: null, tier: null, has_scorer_star: false, is_host: false, style: null, stars: [] };
  const code = nameToCode.get(zhName) || null;
  const doc = code ? teamDocs.get(code) || null : null;
  const meta = doc && doc.meta ? doc.meta : {};
  return {
    code,
    tier: meta.tier || null,
    has_scorer_star: !!meta.has_scorer_star,
    is_host: !!meta.is_host,
    style: meta.style || null,
    stars: Array.isArray(meta.stars) ? meta.stars : [],
  };
}
const TIER_NUM = { top: 1, second: 2, defensive: 3, weak: 3, unknown: 2.5 };
function tierNum(t) { return t && TIER_NUM[t] !== undefined ? TIER_NUM[t] : 2.5; }

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
function predictWin(m, homeTeam, awayTeam) {
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
  // 中等热门降档：spf 1.5-2.5 区间，若 p0_max ∈ [mid_fav_p0_low, mid_fav_p0_high) → ⭐
  //   12 场样本里 5 场落此区间，主胜仅 2/5 命中，平局率 60%
  else if (minOdds >= winModel.rules.fav_threshold && minOdds < winModel.rules.moderate_threshold) {
    const p0max = Math.max(imp.p0_home, imp.p0_draw, imp.p0_away);
    const low = winModel.rules.mid_fav_p0_low ?? 0.40;
    const high = winModel.rules.mid_fav_p0_high ?? 0.60;
    if (p0max >= low && p0max < high) {
      confidence = 1; label = '中等热门(降档)';
    }
  }
  // 球队属性的轻量调节：
  //  - 若方向对的一方是弱队(weak/defensive)且无球星 → 信心 -1（弱队缺乏终结稳定性）
  //  - 若方向对的一方是 top 且有球星 → 信心 +1（强队容错率更高）
  const favTier = pick === 'home' ? homeTeam.tier : pick === 'away' ? awayTeam.tier : null;
  const favHasStar = pick === 'home' ? homeTeam.has_scorer_star : pick === 'away' ? awayTeam.has_scorer_star : false;
  const hostBoost = (pick === 'home' && homeTeam.is_host) || (pick === 'away' && awayTeam.is_host);
  if (favTier === 'top' && favHasStar && confidence < 3) { confidence += 1; label += '+Top+球星'; }
  if ((favTier === 'weak' || favTier === 'defensive') && !favHasStar && confidence > 1) { confidence -= 1; label += '-弱队无星'; }
  if (hostBoost && confidence < 3) { confidence += 1; label += '+东道主'; }
  // 抑制平局
  if (pick === 'draw' && m.spf.draw < winModel.rules.draw_threshold) {
    return { pick: null, confidence: 0, rationale: `平局赔率 ${m.spf.draw} < ${winModel.rules.draw_threshold}，样本提示低赔平局假信号多，不推荐平` };
  }
  const rationale = `${label}（${pick === 'home' ? '主胜' : pick === 'away' ? '客胜' : '平局'} 赔率 ${m.spf[pick]}，p0 ${(imp[`p0_${pick}`] * 100).toFixed(0)}%，主tier=${homeTeam.tier ?? '-'} 客tier=${awayTeam.tier ?? '-'}）`;
  return { pick, confidence, label, rationale };
}

// ---- 2. 让球盘路推荐 ----
function predictHandicap(m, homeTeam, awayTeam) {
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
  // 球队属性辅助判断：
  //  - 让-1 的主队若是 top + 有 star → chase 可更坚决
  //  - 受让方若是 weak/defensive 无 star → 谨慎 chase（可能被爆冷）
  const chaseMin = handiModel.verdict_thresholds.chase_min_win_rate;
  const h = Number(m.handicap);
  const softBlock =
    (h <= -1 && homeTeam.tier !== 'top' && !homeTeam.has_scorer_star) ||
    (h >= 1 && (awayTeam.tier === 'weak' || awayTeam.tier === 'defensive') && !awayTeam.has_scorer_star);
  const extra = [];
  if (h <= -1 && homeTeam.tier === 'top' && homeTeam.has_scorer_star) extra.push('主队top+球星，让球盘有支撑');
  if (softBlock) extra.push('受让方/主队非top 且无球星，需谨慎');
  if (tbl.home_win_rate >= chaseMin && !softBlock) {
    return {
      verdict: 'chase',
      reason: `让${m.handicap} 样本主胜率 ${(tbl.home_win_rate * 100).toFixed(0)}% >= ${(chaseMin * 100).toFixed(0)}%${extra.length ? '；' + extra.join('；') : ''}`,
      sample_win_rate: tbl.home_win_rate,
    };
  }
  return {
    verdict: 'skip',
    reason: `让${m.handicap} 样本主胜率 ${(tbl.home_win_rate * 100).toFixed(0)}% < ${(chaseMin * 100).toFixed(0)}%${extra.length ? '；' + extra.join('；') : ''}`,
    sample_win_rate: tbl.home_win_rate,
  };
}

// ---- 3. 比分 Top-3 ----
function predictScore(m, homeTeam, awayTeam) {
  const imp = m.spf ? impliedProbs(m.spf) : null;
  const p0Home = imp?.p0_home ?? null;
  const p0Away = imp?.p0_away ?? null;
  // v2 概率加权公式（与 score_model.json artifact 一致）：
  //   λ_home = λ_total × p0_home / (p0_home + p0_away)
  //   λ_away = λ_total × p0_away / (p0_home + p0_away)
  let lh, la;
  if (p0Home === null || p0Away === null || p0Home + p0Away <= 0) {
    lh = scoreModel.global_lambda_home;
    la = scoreModel.global_lambda_away;
  } else {
    const denom = p0Home + p0Away;
    const total = scoreModel.global_lambda_total;
    lh = total * (p0Home / denom);
    la = total * (p0Away / denom);
  }
  // tier 轻量修正（在全局λ基础上 ±~10%）：
  //  top + 有星 → 进攻系数 +10%；weak/defensive → 进攻系数 -10%
  const adj = (tier, hasStar) => {
    if (tier === 'top' && hasStar) return 1.10;
    if (tier === 'top') return 1.05;
    if (tier === 'second' && hasStar) return 1.05;
    if (tier === 'weak' || tier === 'defensive') return 0.90;
    return 1.0;
  };
  lh = round(lh * adj(homeTeam.tier, homeTeam.has_scorer_star));
  la = round(la * adj(awayTeam.tier, awayTeam.has_scorer_star));
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
    lambda_home: lh,
    lambda_away: la,
    top3: grid.slice(0, 3).map((g) => ({ score: `${g.h}-${g.a}`, prob: round(g.p) })),
  };
}

// ---- 主循环 ----
const predictions = candidates.map((m) => {
  const homeTeam = resolveTeam(m.home);
  const awayTeam = resolveTeam(m.away);
  const win = predictWin(m, homeTeam, awayTeam);
  const handi = predictHandicap(m, homeTeam, awayTeam);
  const score = predictScore(m, homeTeam, awayTeam);
  return {
    mid: m.mid,
    code: m.code,
    home: m.home,
    away: m.away,
    home_code: homeTeam.code,
    away_code: awayTeam.code,
    kickoff: m.kickoff,
    handicap: m.handicap,
    spf: m.spf,
    rqspf: m.rqspf,
    status: m.status,
    teams: {
      home: { tier: homeTeam.tier, has_scorer_star: homeTeam.has_scorer_star, is_host: homeTeam.is_host, style: homeTeam.style, stars: homeTeam.stars },
      away: { tier: awayTeam.tier, has_scorer_star: awayTeam.has_scorer_star, is_host: awayTeam.is_host, style: awayTeam.style, stars: awayTeam.stars },
      tier_diff: round(tierNum(awayTeam.tier) - tierNum(homeTeam.tier)),
    },
    recommendations: {
      win: { pick: win.pick, confidence: win.confidence, label: win.label || null, rationale: win.rationale },
      handicap: { verdict: handi.verdict, reason: handi.reason, sample_win_rate: handi.sample_win_rate ?? null },
      score_top3: score.top3,
    },
    score_meta: { lambda_home: score.lambda_home, lambda_away: score.lambda_away },
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
