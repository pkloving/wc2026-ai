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
 *   - 02_feature_records.json        机器可读特征（每场 25+ 维，含 movement 槽位）
 *   - 03_implied_probability.json    赔率 → P0 反推 + 实际命中
 *   - 04_handicap_table.json         按 handicap 分组的实际盘路结算表
 *   - 05_odds_movement.json          赔率变动明细（开盘 → 收盘，每场 1 行）
 *   - international_warmup.json      3 场国际赛（不进主建模，留档）
 *
 * 跨联赛过滤：默认只取 league === "世界杯" 的完赛样本。
 * 竞彩官方在 6-12 起开始挂世界杯正赛盘（对应 data/matches.json 的 M001-M104），
 * 训练侧只吸收这部分——避免被 6-09 的 3 场国际赛热身（2040145-2040147）节奏污染。
 * 那 3 场国际赛热身单独落 international_warmup.json 留档，不进主建模。
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
const historyDir = path.join(DATA_DIR, 'odds_history');
const historyMap = new Map();
if (fs.existsSync(historyDir)) {
  for (const f of fs.readdirSync(historyDir).filter((n) => n.endsWith('.json'))) {
    const mid = f.replace(/\.json$/, '');
    try {
      const h = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf-8'));
      historyMap.set(mid, h);
    } catch (_) { /* 单文件损坏不影响其他 */ }
  }
}

// ---- 2. 过滤完赛 + 分桶 ----
const finishedAll = status.matches.filter((m) => m.status === 'finished');
// "世界杯"=正赛、"国际赛"=热身——竞彩 league 标签即正赛/热身分流，主建模只吸收前者
const wcFinished = finishedAll.filter((m) => m.league === '世界杯');
const internationalFinished = finishedAll.filter((m) => m.league === '国际赛');

console.log(`完赛总数: ${finishedAll.length}（世界杯正赛 ${wcFinished.length} + 国际赛 ${internationalFinished.length}）`);

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

/**
 * 计算单场赔率变动特征（spf + rqspf 各自一组 + 综合）
 *
 * 输入：data/odds_history/<mid>.json
 *   { spf_history: [{time, home, draw, away}, ...],
 *     rqspf_history: [{...}, ...] }
 *
 * 输出（每组 8 维 + 4 维综合）：
 *   n           快照次数
 *   open_*      首次抓取的赔率（开盘参考）
 *   last_*      最近一次抓取的赔率
 *   delta_*     last - open（升/降方向与绝对幅度）
 *   range_*     max - min（波动幅度）
 *   fav_open/last  p0 最大方向字符串（home/draw/away）
 *   fav_drift      主流向是否稳定（0 稳定 / 1 切换过）
 *   p0_open/last/delta_home 等  反推 p0 的开盘/最新/差值
 *
 * 注意：当前 history 文件大多 n=1，特征几乎全 0——这是预留位，
 * 等抓取侧把"开赛前多次采样"频率提上来后这些字段会自动激活。
 */
function computeOddsMovement(mid) {
  const empty = {
    spf: { n: 0, open: null, last: null, delta: null, range: null, fav_open: null, fav_last: null, fav_drift: null, p0_open: null, p0_last: null, p0_delta_home: null, p0_delta_draw: null, p0_delta_away: null },
    rqspf: { n: 0, open: null, last: null, delta: null, range: null, fav_open: null, fav_last: null, fav_drift: null, p0_open: null, p0_last: null, p0_delta_home: null, p0_delta_draw: null, p0_delta_away: null },
    summary: { total_n: 0, any_drift: 0, max_abs_delta: null },
  };
  const h = historyMap.get(mid);
  if (!h) return empty;
  function summarizeSeries(series) {
    if (!Array.isArray(series) || series.length === 0) {
      return { n: 0, open: null, last: null, delta: null, range: null, fav_open: null, fav_last: null, fav_drift: null, p0_open: null, p0_last: null, p0_delta_home: null, p0_delta_draw: null, p0_delta_away: null };
    }
    const open = series[0];
    const last = series[series.length - 1];
    const homeArr = series.map((s) => s.home);
    const drawArr = series.map((s) => s.draw);
    const awayArr = series.map((s) => s.away);
    const range = {
      home: round(homeArr.reduce((a, b) => Math.max(a, b)) - homeArr.reduce((a, b) => Math.min(a, b))),
      draw: round(drawArr.reduce((a, b) => Math.max(a, b)) - drawArr.reduce((a, b) => Math.min(a, b))),
      away: round(awayArr.reduce((a, b) => Math.max(a, b)) - awayArr.reduce((a, b) => Math.min(a, b))),
    };
    const delta = {
      home: round(last.home - open.home),
      draw: round(last.draw - open.draw),
      away: round(last.away - open.away),
    };
    const p0Open = impliedProbs(open);
    const p0Last = impliedProbs(last);
    const p0Delta = {
      home: round(p0Last.p0_home - p0Open.p0_home),
      draw: round(p0Last.p0_draw - p0Open.p0_draw),
      away: round(p0Last.p0_away - p0Open.p0_away),
    };
    const favOf = (s) => {
      const p = impliedProbs(s);
      if (p.p0_draw >= p.p0_home && p.p0_draw >= p.p0_away) return 'draw';
      if (p.p0_away >= p.p0_home && p.p0_away >= p.p0_draw) return 'away';
      return 'home';
    };
    const favOpen = favOf(open);
    const favLast = favOf(last);
    return {
      n: series.length,
      open: { home: open.home, draw: open.draw, away: open.away },
      last: { home: last.home, draw: last.draw, away: last.away },
      delta,
      range,
      fav_open: favOpen,
      fav_last: favLast,
      fav_drift: favOpen === favLast ? 0 : 1,
      p0_open: p0Open,
      p0_last: p0Last,
      p0_delta_home: p0Delta.home,
      p0_delta_draw: p0Delta.draw,
      p0_delta_away: p0Delta.away,
    };
  }
  const spf = summarizeSeries(h.spf_history);
  const rqspf = summarizeSeries(h.rqspf_history);
  // 综合：两边合在一起看是否有"主流向漂移"
  const totalN = spf.n + rqspf.n;
  const anyDrift = (spf.fav_drift === 1 || rqspf.fav_drift === 1) ? 1 : 0;
  const allDeltas = [];
  if (spf.delta) allDeltas.push(spf.delta.home, spf.delta.draw, spf.delta.away);
  if (rqspf.delta) allDeltas.push(rqspf.delta.home, rqspf.delta.draw, rqspf.delta.away);
  const maxAbs = allDeltas.length ? round(Math.max(...allDeltas.map((d) => Math.abs(d)))) : null;
  return { spf, rqspf, summary: { total_n: totalN, any_drift: anyDrift, max_abs_delta: maxAbs } };
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
      movement: computeOddsMovement(m.mid), // 赔率变动特征（占位，多数场次 n=1）
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
  // ---- 赔率变动特征（movement 占位，n>1 时自动激活）----
  // spf 侧
  mov_spf_n: m.derived.movement.spf.n,
  mov_spf_open_home: m.derived.movement.spf.open?.home ?? null,
  mov_spf_open_draw: m.derived.movement.spf.open?.draw ?? null,
  mov_spf_open_away: m.derived.movement.spf.open?.away ?? null,
  mov_spf_last_home: m.derived.movement.spf.last?.home ?? null,
  mov_spf_last_draw: m.derived.movement.spf.last?.draw ?? null,
  mov_spf_last_away: m.derived.movement.spf.last?.away ?? null,
  mov_spf_delta_home: m.derived.movement.spf.delta?.home ?? null,
  mov_spf_delta_draw: m.derived.movement.spf.delta?.draw ?? null,
  mov_spf_delta_away: m.derived.movement.spf.delta?.away ?? null,
  mov_spf_range_home: m.derived.movement.spf.range?.home ?? null,
  mov_spf_fav_drift: m.derived.movement.spf.fav_drift,
  mov_spf_p0_delta_home: m.derived.movement.spf.p0_delta_home,
  mov_spf_p0_delta_draw: m.derived.movement.spf.p0_delta_draw,
  mov_spf_p0_delta_away: m.derived.movement.spf.p0_delta_away,
  // rqspf 侧
  mov_rqspf_n: m.derived.movement.rqspf.n,
  mov_rqspf_open_home: m.derived.movement.rqspf.open?.home ?? null,
  mov_rqspf_open_draw: m.derived.movement.rqspf.open?.draw ?? null,
  mov_rqspf_open_away: m.derived.movement.rqspf.open?.away ?? null,
  mov_rqspf_last_home: m.derived.movement.rqspf.last?.home ?? null,
  mov_rqspf_last_draw: m.derived.movement.rqspf.last?.draw ?? null,
  mov_rqspf_last_away: m.derived.movement.rqspf.last?.away ?? null,
  mov_rqspf_delta_home: m.derived.movement.rqspf.delta?.home ?? null,
  mov_rqspf_delta_draw: m.derived.movement.rqspf.delta?.draw ?? null,
  mov_rqspf_delta_away: m.derived.movement.rqspf.delta?.away ?? null,
  mov_rqspf_range_home: m.derived.movement.rqspf.range?.home ?? null,
  mov_rqspf_fav_drift: m.derived.movement.rqspf.fav_drift,
  mov_rqspf_p0_delta_home: m.derived.movement.rqspf.p0_delta_home,
  mov_rqspf_p0_delta_draw: m.derived.movement.rqspf.p0_delta_draw,
  mov_rqspf_p0_delta_away: m.derived.movement.rqspf.p0_delta_away,
  // 综合
  mov_total_n: m.derived.movement.summary.total_n,
  mov_any_drift: m.derived.movement.summary.any_drift,
  mov_max_abs_delta: m.derived.movement.summary.max_abs_delta,
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

// ---- 7.5 落 05_odds_movement.json（赔率变动明细，给人和后续模型共同看） ----
const movementRows = finishedAll.map((m) => {
  const mov = computeOddsMovement(m.mid);
  return {
    mid: m.mid,
    code: m.code,
    league: m.league,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    status: m.status,
    movement: mov,
  };
});
writeJson('05_odds_movement.json', {
  generated_at: new Date().toISOString(),
  source: 'data/odds_history/<mid>.json',
  note: 'n = 抓取快照次数；delta = last - open；range = max - min；fav_drift = 主流向是否切换',
  total: movementRows.length,
  rows: movementRows,
});
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
// 赔率变动占位摘要
const wcMovN = features.filter((f) => f.mov_total_n > 1).length;
console.log(`赔率变动：wc ${features.length} 场中 ${wcMovN} 场有 ≥2 个快照（其余 n=1 走默认占位）`);

function writeJson(name, obj) {
  const fp = path.join(OUT_DIR, name);
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  console.log(`  写 ${path.relative(PROJECT_ROOT, fp)}`);
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
