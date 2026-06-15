#!/usr/bin/env node
/**
 * Step 1 · 前提炼
 *
 * 输入：
 *   - data/matches_status.json        (含 spf/rqspf/handicap/sale_status)
 *   - data/results/<mid>.json         (per-mid 完赛结果)
 *
 * 输出（全部落到 modeling/data/）：
 *   - 01_matches_with_odds.json      完赛场次 = 状态字段 + 赔率 + 结果 合并
 *   - 02_feature_records.json        机器可读特征（每场 25+ 维）
 *   - 03_implied_probability.json    赔率 → P0 反推 + 实际命中
 *   - 04_handicap_table.json         按 handicap 分组的实际盘路结算表
 *   - international_warmup.json      3 场国际赛（不进主建模，留档）
 *
 * 跨联赛过滤：默认只取 league === "世界杯"（竞彩官方为 2026 世界杯开的盘口，
 * 含 6-12 起的 8-9 场热身赛性质世界杯盘）。3 场国际赛热身（2040145-2040147）
 * 单独落 international_warmup.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const OUT_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- 1. 读源数据 ----
const statusPath = path.join(DATA_DIR, 'matches_status.json');
const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
const resultsDir = path.join(DATA_DIR, 'results');
const resultFiles = fs.readdirSync(resultsDir).filter((f) => f.endsWith('.json'));
const resultMap = new Map();
for (const f of resultFiles) {
  const mid = f.replace(/\.json$/, '');
  const data = JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf-8'));
  resultMap.set(mid, data);
}

// ---- 2. 过滤完赛 + 分桶 ----
const finishedAll = status.matches.filter((m) => m.status === 'finished');
const wcFinished = finishedAll.filter((m) => m.league === '世界杯');
const internationalFinished = finishedAll.filter((m) => m.league === '国际赛');

console.log(`完赛总数: ${finishedAll.length}（世界杯 ${wcFinished.length} + 国际赛 ${internationalFinished.length}）`);

// ---- 3. 合并 + 衍生特征 ----
function impliedProbs(odds) {
  if (!odds) return null;
  const inv = { home: 1 / odds.home, draw: 1 / odds.draw, away: 1 / odds.away };
  const sum = inv.home + inv.draw + inv.away;
  const vig = sum - 1; // 抽水
  return {
    p0_home: inv.home / sum,
    p0_draw: inv.draw / sum,
    p0_away: inv.away / sum,
    vig,
  };
}

function buildMerged(m) {
  const r = resultMap.get(m.mid);
  if (!r) return null; // 没结果跳过
  const homeGoals = r.homeScore;
  const awayGoals = r.awayScore;
  const totalGoals = homeGoals + awayGoals;
  const scoreDiff = homeGoals - awayGoals;
  const actualWinner = scoreDiff > 0 ? 'home' : scoreDiff < 0 ? 'away' : 'draw';
  // 让球后结果：主队让 handicap 球（负数=让出去；正数=受让）
  // 让-1：主队实际需赢 2 球及以上才"赢盘"
  const adjustedDiff = scoreDiff + (m.handicap ?? 0);
  const actualHandicap = adjustedDiff > 0 ? 'home_win' : adjustedDiff === 0 ? 'draw' : 'home_lose';

  const spfImp = impliedProbs(m.spf);
  const rqspfImp = impliedProbs(m.rqspf);

  // 标记 spf/rqspf 是否命中
  let spfHit = null;
  if (m.spf) {
    // spf：直接看胜平负
    const fav = m.spf.home < m.spf.away ? 'home' : m.spf.home > m.spf.away ? 'away' : 'draw';
    spfHit = fav === actualWinner;
  }
  let rqspfHit = null;
  if (m.rqspf) {
    const adjDiff = scoreDiff + (m.handicap ?? 0);
    let rqResult = adjDiff > 0 ? 'home' : adjDiff < 0 ? 'away' : 'draw';
    const fav = m.rqspf.home < m.rqspf.away ? 'home' : m.rqspf.home > m.rqspf.away ? 'away' : 'draw';
    rqspfHit = fav === rqResult;
  }

  return {
    mid: m.mid,
    code: m.code,
    league: m.league,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    kickoff_iso: toIso(m.kickoff),
    handicap: m.handicap,
    spf: m.spf,
    rqspf: m.rqspf,
    scraped_at: m.scraped_at,
    final_score: r,
    derived: {
      home_goals: homeGoals,
      away_goals: awayGoals,
      total_goals: totalGoals,
      score_diff: scoreDiff,
      actual_winner: actualWinner,
      actual_handicap_result: actualHandicap,
      spf_implied: spfImp,
      rqspf_implied: rqspfImp,
      spf_hit: spfHit,
      rqspf_hit: rqspfHit,
    },
  };
}

function toIso(kickoff) {
  // 形如 "2026-06-12 03:00" → 视为 UTC+8 当地时间，转 ISO
  if (!kickoff) return null;
  const [d, t] = kickoff.split(' ');
  if (!d || !t) return null;
  // 简化处理：当成本地时间，不做时区换算（前端用原生 Date.parse 已经够用）
  return `${d}T${t}:00+08:00`;
}

const wcMerged = wcFinished.map(buildMerged).filter(Boolean);
const intlMerged = internationalFinished.map(buildMerged).filter(Boolean);

// ---- 4. 落 01_matches_with_odds.json ----
writeJson('01_matches_with_odds.json', {
  generated_at: new Date().toISOString(),
  source: 'data/matches_status.json + data/results/*.json',
  total: wcMerged.length,
  matches: wcMerged,
});

// ---- 5. 落 02_feature_records.json（机器可读特征） ----
const features = wcMerged.map((m) => ({
  mid: m.mid,
  code: m.code,
  home: m.home,
  away: m.away,
  handicap: m.handicap,
  // spf 特征
  spf_home: m.spf?.home ?? null,
  spf_draw: m.spf?.draw ?? null,
  spf_away: m.spf?.away ?? null,
  spf_p0_home: m.derived.spf_implied?.p0_home ?? null,
  spf_p0_draw: m.derived.spf_implied?.p0_draw ?? null,
  spf_p0_away: m.derived.spf_implied?.p0_away ?? null,
  spf_min_odds: m.spf ? Math.min(m.spf.home, m.spf.draw, m.spf.away) : null,
  spf_max_odds: m.spf ? Math.max(m.spf.home, m.spf.draw, m.spf.away) : null,
  spf_vig: m.derived.spf_implied?.vig ?? null,
  // rqspf 特征
  rqspf_home: m.rqspf?.home ?? null,
  rqspf_draw: m.rqspf?.draw ?? null,
  rqspf_away: m.rqspf?.away ?? null,
  rqspf_p0_home: m.derived.rqspf_implied?.p0_home ?? null,
  rqspf_p0_draw: m.derived.rqspf_implied?.p0_draw ?? null,
  rqspf_p0_away: m.derived.rqspf_implied?.p0_away ?? null,
  rqspf_vig: m.derived.rqspf_implied?.vig ?? null,
  // 实际结果
  home_goals: m.derived.home_goals,
  away_goals: m.derived.away_goals,
  total_goals: m.derived.total_goals,
  score_diff: m.derived.score_diff,
  actual_winner: m.derived.actual_winner,
  actual_handicap_result: m.derived.actual_handicap_result,
  spf_hit: m.derived.spf_hit,
  rqspf_hit: m.derived.rqspf_hit,
}));
writeJson('02_feature_records.json', {
  generated_at: new Date().toISOString(),
  total: features.length,
  records: features,
});

// ---- 6. 落 03_implied_probability.json ----
const implied = wcMerged.map((m) => ({
  mid: m.mid,
  code: m.code,
  home: m.home,
  away: m.away,
  spf_implied: m.derived.spf_implied,
  rqspf_implied: m.derived.rqspf_implied,
  actual_winner: m.derived.actual_winner,
  actual_handicap_result: m.derived.actual_handicap_result,
  spf_hit: m.derived.spf_hit,
  rqspf_hit: m.derived.rqspf_hit,
}));
writeJson('03_implied_probability.json', {
  generated_at: new Date().toISOString(),
  total: implied.length,
  records: implied,
});

// ---- 7. 落 04_handicap_table.json（按 handicap 分组） ----
const handiGroups = new Map();
for (const m of wcMerged) {
  const h = m.handicap;
  if (h === null || h === undefined) continue;
  const key = String(h);
  if (!handiGroups.has(key)) handiGroups.set(key, []);
  handiGroups.get(key).push(m);
}
const handiTable = {};
for (const [key, arr] of handiGroups) {
  const n = arr.length;
  const homeWin = arr.filter((m) => m.derived.actual_handicap_result === 'home_win').length;
  const draw = arr.filter((m) => m.derived.actual_handicap_result === 'draw').length;
  const homeLose = arr.filter((m) => m.derived.actual_handicap_result === 'home_lose').length;
  handiTable[key] = {
    n,
    home_win_rate: round(homeWin / n),
    draw_rate: round(draw / n),
    home_lose_rate: round(homeLose / n),
    samples: arr.map((m) => ({
      mid: m.mid, home: m.home, away: m.away,
      handicap: m.handicap, final: `${m.derived.home_goals}-${m.derived.away_goals}`,
      result: m.derived.actual_handicap_result,
    })),
  };
}
writeJson('04_handicap_table.json', {
  generated_at: new Date().toISOString(),
  total_groups: Object.keys(handiTable).length,
  by_handicap: handiTable,
});

// ---- 8. 落 international_warmup.json（留档，不进主建模） ----
writeJson('international_warmup.json', {
  generated_at: new Date().toISOString(),
  note: '3 场国际赛热身，不进主建模（避免污染世界杯特征）',
  total: intlMerged.length,
  matches: intlMerged,
});

// ---- 9. 控制台摘要 ----
console.log('---- 摘要 ----');
console.log(`完赛：${wcMerged.length} 场（世界杯标签）`);
console.log(`胜平负命中 spf_hit 比例：${features.filter((f) => f.spf_hit).length}/${features.length}`);
console.log(`让球命中 rqspf_hit 比例：${features.filter((f) => f.rqspf_hit).length}/${features.length}`);
const handiKeys = Object.keys(handiTable).sort((a, b) => Number(a) - Number(b));
for (const k of handiKeys) {
  const t = handiTable[k];
  console.log(`  让${k}：${t.n} 场，主胜率 ${(t.home_win_rate * 100).toFixed(0)}% 走 ${(t.draw_rate * 100).toFixed(0)}% 主负 ${(t.home_lose_rate * 100).toFixed(0)}%`);
}

function writeJson(name, obj) {
  const fp = path.join(OUT_DIR, name);
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  console.log(`  写 ${path.relative(PROJECT_ROOT, fp)}`);
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
