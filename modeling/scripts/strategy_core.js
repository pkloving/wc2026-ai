import fs from 'node:fs';
import path from 'node:path';

// strategy_core.js — 31号策略的"可调参数 + 纯策略函数"核心
// 设计:
//   - 所有曾经硬编码在 31_tight_anti_value.js 里的阈值, 抽成 DEFAULT_PARAMS
//   - 策略函数全部改成吃 (m, ctx), ctx 携带 params + 球队上下文 + insights
//   - 31 (预测/回测) 与 33 (拟合扫参) 共用本模块, 单一事实源
//   - DEFAULT_PARAMS 的值 === 重构前 31 里的硬编码值 => 默认参数必须复现旧行为

// ============================================================
// 默认参数 (值 = 重构前 31 里的硬编码常量, 不要随意改)
// ============================================================
export const DEFAULT_PARAMS = {
  classify: {
    bigHandicapAbs: 2,        // |handicap| >= 此值 且 favorite 有射手星 => BIG_BALL 候选
  },
  f4: {
    mainCount: 3,             // 主池取几个比分
    bigBall: { totalMin: 4, safeOddsMax: 12, midLo: 12, midHi: 25, highLo: 15, highHi: 40 },
    weak:    { totalMin: 1, totalMax: 4, coreLo: 10, coreHi: 30, coreCount: 2, upsetLo: 30, upsetHi: 50 },
    normal:  { upsetTotalMin: 3, upsetTotalMax: 4, upsetOddsLo: 7, upsetOddsHi: 15, draw2OddsMax: 15 },
  },
  rqspf: {
    favHomeLo: 1.5, favHomeHi: 2.0,   // 让胜纠偏: rqspf.home 落此区间 => 优先让胜
  },
  zjq: {
    normalTwoLo: 2.5, normalTwoHi: 3.5,   // NORMAL: 2球赔率落此区间 => 推2球
    baselineBigHandicapAbs: 2,            // 基线兜底: |hc|>=此值 推大球, 否则小球
  },
  bqc: {
    ssMax: 2.0,               // 胜胜赔率 < 此值 => 推 胜胜+平平
  },
  single: {
    // count 默认=2: 重构前 pickSingleCount 因 .find 只取首个"1个"项, twoRoi 恒 undefined
    // => 实际恒回落 fallback=2 (隐藏 bug)。默认设 2 复现旧行为;
    // 重构后 count 由 33_fit 扫定 (insights 显示 1个 ROI 远高于 2个, fit 应选 1, 顺带修此 bug)
    bigBall: { totalMin: 1, totalMax: 6, oddsLo: 25, oddsHi: 65, count: 2 },
    weak:    { totalMin: 1, totalMax: 4, oddsLo: 25, oddsHi: 50, count: 2 },
  },
  combos: {
    // 串关组合不进 fit (combo 命中需多腿同时中, 24场样本里历史命中≈0, 回测ROI是噪声)。
    // 改用"设计修正": 用低赔腿(命中率高)组合 + 限定总赔率带 + band内最可能优先, 而非旧的"高赔降序取top10"(专挑最不可能中的腿)
    legMode: 'safe',     // safe=每场只用最低赔的几条腿; all=全 mainPicks 组合(旧爆冷行为)
    legsPerMatch: 2,     // safe 模式下每场取"最低赔"的前 N 条腿
    rank: 'oddsAsc',     // band 内排序: oddsAsc=最可能(总赔率最低)优先; oddsDesc=高赔优先(旧)
    c2: { oddsLo: 10, oddsHi: 150, topN: 10 },
    c3: { oddsLo: 30, oddsHi: 1500, topN: 10 },
  },
};

// ============================================================
// 搜索空间 (33_fit_strategy.js 坐标下降时逐个旋钮试的候选值)
// path: 用点号定位 DEFAULT_PARAMS 里的字段; values: 候选值数组(含默认值)
// 只暴露"有 ROI 注释 / 高影响"的旋钮, 避免组合爆炸 + 过拟合
// ============================================================
export const SEARCH_SPACE = [
  { path: 'rqspf.favHomeLo',        values: [1.4, 1.5, 1.6] },
  { path: 'rqspf.favHomeHi',        values: [1.9, 2.0, 2.1, 2.2] },
  { path: 'zjq.normalTwoLo',        values: [2.3, 2.5, 2.7] },
  { path: 'zjq.normalTwoHi',        values: [3.3, 3.5, 3.7] },
  { path: 'bqc.ssMax',              values: [1.8, 2.0, 2.2] },
  { path: 'single.bigBall.oddsLo',  values: [20, 25, 30] },
  { path: 'single.bigBall.oddsHi',  values: [55, 65, 75] },
  { path: 'single.bigBall.count',   values: [1, 2] },
  { path: 'single.weak.oddsLo',     values: [20, 25, 30] },
  { path: 'single.weak.oddsHi',     values: [45, 50, 60] },
  { path: 'single.weak.count',      values: [1, 2] },
  { path: 'f4.bigBall.safeOddsMax', values: [10, 12, 15] },
  { path: 'f4.weak.coreLo',         values: [8, 10, 12] },
  { path: 'f4.weak.coreHi',         values: [25, 30, 35] },
  { path: 'f4.normal.upsetOddsLo',  values: [6, 7, 8] },
  { path: 'f4.normal.upsetOddsHi',  values: [13, 15, 18] },
];

// 深拷贝 + 按 path 读写
export function clone(o) { return JSON.parse(JSON.stringify(o)); }
export function getPath(obj, p) { return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
export function setPath(obj, p, v) {
  const ks = p.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
  return obj;
}
// 合并 fit 产物到默认值(浅层递归), 缺字段回落默认
export function mergeParams(base, override) {
  const out = clone(base);
  if (!override) return out;
  const rec = (b, o) => {
    for (const k of Object.keys(o || {})) {
      if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && b[k] && typeof b[k] === 'object') rec(b[k], o[k]);
      else b[k] = o[k];
    }
  };
  rec(out, override);
  return out;
}

// ============================================================
// 球队上下文工厂: 单一数据源 data/teams/_index.json + 57 个 team json
// 返回 { getTeamTier(name), hasScorerStar(name) }, 供 31 / 33 共用 (避免逻辑漂移)
// ============================================================
export function createTeamCtx(PROJECT_ROOT) {
  const idx = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'teams', '_index.json'), 'utf-8'));
  const codeByTier = idx.by_tier || {};
  const tierOfCode = {};
  for (const [tier, codes] of Object.entries(codeByTier)) for (const c of codes) tierOfCode[c] = tier;
  const codeByName = idx.by_name || {};
  const variants = idx.name_variants_to_code || {};
  const nameToCode = { ...codeByName, ...variants };
  const scorerStarCodes = new Set();
  const nameToTier = {};
  for (const [code, rel] of Object.entries(idx.by_code || {})) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', rel), 'utf-8'));
      if (t.meta?.has_scorer_star === true) scorerStarCodes.add(code);
      if (t.name && tierOfCode[code]) nameToTier[t.name] = tierOfCode[code];
    } catch (e) {
      console.error(`⚠️ 加载 ${rel} 失败: ${e.message}`);
    }
  }
  for (const [alias, code] of Object.entries(variants)) if (tierOfCode[code]) nameToTier[alias] = tierOfCode[code];
  const codeOf = (teamName) => (teamName ? (nameToCode[teamName] || null) : null);
  const getTeamTier = (team) => {
    const code = codeOf(team);
    if (code) return tierOfCode[code] || 'unknown';
    return nameToTier[team] || 'unknown';
  };
  const hasScorerStar = (team) => {
    const code = codeOf(team);
    return code ? scorerStarCodes.has(code) : false;
  };
  return { getTeamTier, hasScorerStar };
}

// ============================================================
// 回测样本加载: 扫 data/odds + data/results, 取"世界杯 + 已有赛果"的比赛
// 返回 31 runBacktest 同款字段 + halfTime (BQC 用)
// ============================================================
export function loadBacktestMatches(PROJECT_ROOT) {
  const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
  const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');
  const out = [];
  for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
    const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
    if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
    const mid = oddsDoc.basic.mid;
    const resultPath = path.join(RESULTS_DIR, mid + '.json');
    if (!fs.existsSync(resultPath)) continue;
    const actual = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    out.push({
      mid, code: oddsDoc.basic.code,
      home: oddsDoc.basic.home, away: oddsDoc.basic.away,
      handicap: oddsDoc.odds.handicap ?? 0,
      bf: oddsDoc.odds.bf_latest,
      rqspf: oddsDoc.odds.rqspf_latest,
      zjq: oddsDoc.odds.zjq_latest,
      bqc: oddsDoc.odds.bqc_latest,
      actualHome: actual.homeScore,
      actualAway: actual.awayScore,
      halfTime: actual.halfTime || null,
    });
  }
  return out;
}

// ============================================================
// 工具
// ============================================================
export function normalizeScore(s) { return s.split(':').map(p => String(Number(p))).join(':'); }

// 解析 bf_latest 比分赔率 => {score, odds, home, away, total}[]
export function parseOdds(bf) {
  if (!bf) return [];
  return Object.entries(bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => {
      const score = normalizeScore(k);
      const parts = score.split(':');
      return { score, odds: v, home: Number(parts[0]), away: Number(parts[1]), total: Number(parts[0]) + Number(parts[1]) };
    });
}

// ============================================================
// 比赛分类: BIG_BALL / WEAK_MATCH / NORMAL
// ctx: { params, getTeamTier(name), hasScorerStar(name) }
// ============================================================
export function classifyMatch(m, ctx) {
  const P = ctx.params.classify;
  const hc = m.handicap;
  const hTier = ctx.getTeamTier(m.home), aTier = ctx.getTeamTier(m.away);
  const homeHasStar = ctx.hasScorerStar(m.home), awayHasStar = ctx.hasScorerStar(m.away);
  const bigHandicap = Math.abs(hc) >= P.bigHandicapAbs;
  let isBigBall = false;
  if (bigHandicap) {
    const favHasStar = hc < 0 ? homeHasStar : awayHasStar;
    if (favHasStar) isBigBall = true;
  }
  if (homeHasStar && awayHasStar) isBigBall = true;
  const isWeak = ((hTier === 'weak' || hTier === 'defensive') && (aTier === 'weak' || aTier === 'defensive') && !homeHasStar && !awayHasStar);
  if (isBigBall) return 'BIG_BALL';
  if (isWeak) return 'WEAK_MATCH';
  return 'NORMAL';
}

// ============================================================
// F4 混合策略
// ============================================================
export function f4Strategy(m, ctx) {
  const P = ctx.params.f4;
  const type = classifyMatch(m, ctx);
  const all = parseOdds(m.bf);
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;

  let mainPicks = [];

  if (type === 'BIG_BALL') {
    const b = P.bigBall;
    const big = all.filter(s => s.total >= b.totalMin && dirMatch(s)).sort((a, c) => a.odds - c.odds);
    const safe = big.filter(s => s.odds < b.safeOddsMax)[0] || big[0];
    const midHigh = big.filter(s => s.odds >= b.midLo && s.odds <= b.midHi)[0] || big[Math.floor(big.length / 2)] || big[big.length - 1];
    const high = big.filter(s => s.odds >= b.highLo && s.odds <= b.highHi)[0] || big[big.length - 1] || midHigh;
    mainPicks = [safe, midHigh, high].filter(Boolean).filter((p, i, arr) => arr.findIndex(q => q.score === p.score) === i);
    if (mainPicks.length < P.mainCount) {
      const sorted = all.slice().sort((a, c) => a.odds - c.odds);
      for (const s of sorted) if (!mainPicks.find(p => p.score === s.score)) mainPicks.push(s);
    }
    mainPicks = mainPicks.slice(0, P.mainCount);
  } else if (type === 'WEAK_MATCH') {
    const w = P.weak;
    const mainPool = all.filter(s => s.total >= w.totalMin && s.total <= w.totalMax).sort((a, c) => c.odds - a.odds);
    const corePicks = mainPool.filter(s => s.odds >= w.coreLo && s.odds <= w.coreHi).slice(0, w.coreCount);
    const upsetPick = mainPool.filter(s => s.odds > w.upsetLo && s.odds <= w.upsetHi)[0];
    mainPicks = corePicks.concat(upsetPick ? [upsetPick] : []);
    if (mainPicks.length < P.mainCount) {
      const filler = all.slice().sort((a, c) => a.odds - c.odds).filter(s => !mainPicks.find(p => p.score === s.score));
      mainPicks = mainPicks.concat(filler).slice(0, P.mainCount);
    }
  } else {
    const n = P.normal;
    const draws = all.filter(s => s.home === s.away).sort((a, c) => a.odds - c.odds);
    if (draws[0]) mainPicks.push(draws[0]);
    const upsetPick = all.filter(s => (s.total >= n.upsetTotalMin && s.total <= n.upsetTotalMax) && (s.odds >= n.upsetOddsLo && s.odds <= n.upsetOddsHi) && dirMatch(s)).sort((a, c) => a.odds - c.odds)[0];
    if (upsetPick) mainPicks.push(upsetPick);
    if (draws[1] && draws[1].odds < n.draw2OddsMax && !mainPicks.find(p => p.score === draws[1].score)) mainPicks.push(draws[1]);
    const sorted = all.slice().sort((a, c) => a.odds - c.odds);
    for (const s of sorted) if (!mainPicks.find(p => p.score === s.score)) mainPicks.push(s);
    mainPicks = mainPicks.slice(0, P.mainCount);
  }

  return mainPicks;
}

// ============================================================
// RQSPF 跟投 + 让胜纠偏
// ============================================================
export function rqspfStrategy(m, ctx) {
  const P = ctx.params.rqspf;
  if (!m.rqspf) return null;
  const rq = m.rqspf;
  if (!rq.home || !rq.draw || !rq.away) return null;
  const dirs = [
    { d: 'home', odds: rq.home, label: '让胜' },
    { d: 'draw', odds: rq.draw, label: '让平' },
    { d: 'away', odds: rq.away, label: '让负' },
  ];
  const sorted = dirs.slice().sort((a, b) => a.odds - b.odds);
  if (rq.home >= P.favHomeLo && rq.home < P.favHomeHi) {
    return {
      primary: { d: 'home', odds: rq.home, label: '让胜' },
      secondary: sorted.find(d => d.d !== 'home') || sorted[1],
      rule: { name: '让胜纠偏(主流盘)', roi: '+20.5%', n: 6 },
    };
  }
  return {
    primary: sorted[0],
    secondary: sorted[1],
    rule: { name: '基线(最低赔率)', roi: '+16.6%', n: 26 },
  };
}

// ============================================================
// ZJQ 跟投 + 比赛类型判断
// ============================================================
export function zjqStrategy(m, ctx) {
  const P = ctx.params.zjq;
  if (!m.zjq) return null;
  const odds = m.zjq;
  const keys = ['0', '1', '2', '3', '4', '5', '6', '7+'].filter(k => odds[k] > 1);
  if (keys.length === 0) return null;
  const type = classifyMatch(m, ctx);

  if (type === 'NORMAL' && odds['2'] >= P.normalTwoLo && odds['2'] < P.normalTwoHi) {
    const coldPick = keys.slice().sort((a, b) => odds[b] - odds[a])[0];
    return {
      corrected: { pick: '2', odds: odds['2'] },
      coldPick, stable: '2',
      coldOdds: odds[coldPick], stableOdds: odds['2'],
      rule: { name: 'NORMAL+2球纠偏(主流盘)', roi: '+54%', n: 10 },
    };
  }

  if (type === 'BIG_BALL') {
    const smallKeys = keys.filter(k => ['0', '1', '2'].includes(k));
    if (smallKeys.length === 0) return null;
    const cold = keys.slice().sort((a, b) => odds[b] - odds[a])[0];
    return {
      corrected: { picks: smallKeys, odds: Object.fromEntries(smallKeys.map(k => [k, odds[k]])), cost: smallKeys.length },
      coldPick: cold, stable: '0+1+2', coldOdds: odds[cold],
      stableOdds: smallKeys.map(k => odds[k]).reduce((a, b) => a + b, 0) / smallKeys.length,
      rule: { name: 'BIG_BALL+0+1+2(反市场冷门)', roi: '+205%', n: 5 },
    };
  }

  if (type === 'WEAK_MATCH') {
    const smallKeys = keys.filter(k => ['0', '1', '2'].includes(k));
    if (smallKeys.length === 0) return null;
    const cold = keys.slice().sort((a, b) => odds[b] - odds[a])[0];
    return {
      corrected: { picks: smallKeys, odds: Object.fromEntries(smallKeys.map(k => [k, odds[k]])), cost: smallKeys.length },
      coldPick: cold, stable: '0+1+2', coldOdds: odds[cold],
      stableOdds: smallKeys.map(k => odds[k]).reduce((a, b) => a + b, 0) / smallKeys.length,
      rule: { name: 'WEAK_MATCH+0+1+2', roi: '+10%', n: 5 },
    };
  }

  // 基线: 让球→大/小球 + 冷门
  const sorted = keys.slice().sort((a, b) => odds[b] - odds[a]);
  const coldPick = sorted[0];
  const hc = Math.abs(m.handicap ?? 0);
  let stable;
  if (hc >= P.baselineBigHandicapAbs) {
    stable = keys.filter(k => ['4', '5', '6', '7+'].includes(k)).sort((a, b) => odds[a] - odds[b])[0];
  } else {
    stable = keys.filter(k => ['1', '2'].includes(k)).sort((a, b) => odds[a] - odds[b])[0];
  }
  return {
    corrected: null, coldPick, stable,
    coldOdds: odds[coldPick], stableOdds: odds[stable],
    rule: { name: '基线(让球→大/小球)', roi: '+3.1%', n: 26 },
  };
}

// ============================================================
// BQC 跟投 + 胜胜纠偏
// ============================================================
export function bqcStrategy(m, ctx) {
  const P = ctx.params.bqc;
  if (!m.bqc) return null;
  const odds = m.bqc;
  const keys = Object.keys(odds).filter(k => (odds[k] ?? 999) < 999 && (odds[k] ?? 0) > 1);
  if (keys.length === 0) return null;
  const type = classifyMatch(m, ctx);

  if (type === 'BIG_BALL' && odds['胜胜'] && odds['胜胜'] < P.ssMax) {
    return {
      corrected: { picks: ['胜胜', '平平'].filter(k => odds[k] > 0), odds: { 胜胜: odds['胜胜'], 平平: odds['平平'] }, cost: 2 },
      top3: keys.slice().sort((a, b) => odds[a] - odds[b]).slice(0, 3).map(k => ({ key: k, odds: odds[k] })),
      rule: { name: 'BIG_BALL+胜胜纠偏(胜胜+平平)', roi: '+537%', n: 2 },
    };
  }

  if (odds['胜胜'] && odds['胜胜'] < P.ssMax) {
    return {
      corrected: { picks: ['胜胜', '平平'].filter(k => odds[k] > 0), odds: { 胜胜: odds['胜胜'], 平平: odds['平平'] }, cost: 2 },
      top3: keys.slice().sort((a, b) => odds[a] - odds[b]).slice(0, 3).map(k => ({ key: k, odds: odds[k] })),
      rule: { name: `${type}+胜胜纠偏(胜胜+平平)`, roi: '-32%', n: 4 },
    };
  }

  const sorted = keys.sort((a, b) => odds[a] - odds[b]);
  return {
    corrected: null,
    top3: sorted.slice(0, 3).map(k => ({ key: k, odds: odds[k] })),
    rule: { name: '基线(TOP3最低赔率)', roi: '-10%', n: 26 },
  };
}

// ============================================================
// 单关策略: BIG_BALL→反方向高赔率, WEAK_MATCH→高赔率, NORMAL→不推
// 取数(count) 直接用参数, fit 会扫 1 vs 2
// ============================================================
export function singleBetStrategy(m, mainPicks, ctx) {
  const P = ctx.params.single;
  const type = classifyMatch(m, ctx);
  const all = parseOdds(m.bf);
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;
  const existingScores = new Set(mainPicks.map(p => p.score));
  const notInMain = (s) => !existingScores.has(s.score);

  if (type === 'BIG_BALL') {
    const b = P.bigBall;
    const anti = all.filter(s => !dirMatch(s) && s.total >= b.totalMin && s.total <= b.totalMax && s.odds >= b.oddsLo && s.odds <= b.oddsHi && notInMain(s))
                    .sort((a, c) => a.odds - c.odds);
    return anti.slice(0, b.count);
  } else if (type === 'WEAK_MATCH') {
    const w = P.weak;
    const weak = all.filter(s => s.total >= w.totalMin && s.total <= w.totalMax && s.odds >= w.oddsLo && s.odds <= w.oddsHi && notInMain(s))
                    .sort((a, c) => a.odds - c.odds);
    return weak.slice(0, w.count);
  }
  return [];
}

// ============================================================
// 串关组合 (2串1 / 3串1)
// 设计修正(非 fit): 用低赔腿(命中率高) + 总赔率带过滤 + band内最可能优先, 取代旧"高赔降序取top10"
// 入参 matches: [{code, match, mainPicks:[{score,odds}]}], ctx.params.combos 控制
// 出参形状与旧版一致: { c2:[{matches,picks,odds}], c3:[...] } (build_chat_predict / 31 报告都依赖)
// ============================================================
export function generateCombos(matches, ctx) {
  const P = ctx.params.combos;
  // 每场候选腿: safe=最低赔的前 legsPerMatch 条(命中率高); all=全 mainPicks(旧爆冷)
  const legsOf = (m) => {
    const picks = (m.mainPicks || []).slice().sort((a, b) => a.odds - b.odds);
    return P.legMode === 'safe' ? picks.slice(0, P.legsPerMatch) : picks;
  };
  const rankCmp = (a, b) => P.rank === 'oddsDesc' ? b.odds - a.odds : a.odds - b.odds;

  // 2串1
  const c2 = [];
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      for (const pi of legsOf(matches[i])) {
        for (const pj of legsOf(matches[j])) {
          const odds = +(pi.odds * pj.odds).toFixed(2);
          if (odds < P.c2.oddsLo || odds > P.c2.oddsHi) continue;
          c2.push({
            matches: [matches[i].code, matches[j].code],
            picks: [
              { match: matches[i].match, score: pi.score, odds: pi.odds },
              { match: matches[j].match, score: pj.score, odds: pj.odds },
            ],
            odds,
          });
        }
      }
    }
  }
  c2.sort(rankCmp);

  // 3串1
  const c3 = [];
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      for (let k = j + 1; k < matches.length; k++) {
        for (const pi of legsOf(matches[i])) {
          for (const pj of legsOf(matches[j])) {
            for (const pk of legsOf(matches[k])) {
              const odds = +(pi.odds * pj.odds * pk.odds).toFixed(2);
              if (odds < P.c3.oddsLo || odds > P.c3.oddsHi) continue;
              c3.push({
                matches: [matches[i].code, matches[j].code, matches[k].code],
                picks: [
                  { match: matches[i].match, score: pi.score, odds: pi.odds },
                  { match: matches[j].match, score: pj.score, odds: pj.odds },
                  { match: matches[k].match, score: pk.score, odds: pk.odds },
                ],
                odds,
              });
            }
          }
        }
      }
    }
  }
  c3.sort(rankCmp);

  return { c2: c2.slice(0, P.c2.topN), c3: c3.slice(0, P.c3.topN) };
}
