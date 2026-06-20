import fs from 'node:fs';
import path from 'node:path';

// strategy_core.js — 31号策略的"可调参数 + 纯策略函数"核心
// 2026-06-19 重构: 加入"rqspf命中率/3比分ROI/高倍比分/zjq/bqc信号"的统一口径
//                 加入5类选单 (rqspf 3串1/4串1 + 比分2串1 + 单关比分/zjq/bqc)
//                 所有策略均由 params 驱动, 33_fit 可坐标下降调参

// ==================================================================
// 1) 默认参数: 所有阈值/数量/选择逻辑全部抽成参数, 方便 33_fit 扫
// ==================================================================
export const DEFAULT_PARAMS = {
  classify: {
    bigHandicapAbs: 2,
  },
  f4: {
    mainCount: 3,
    bigBall: { totalMin: 4, safeOddsMax: 12, midLo: 12, midHi: 25, highLo: 15, highHi: 40 },
    weak:    { totalMin: 1, totalMax: 4, coreLo: 10, coreHi: 30, coreCount: 2, upsetLo: 30, upsetHi: 50 },
    normal:  { upsetTotalMin: 3, upsetTotalMax: 4, upsetOddsLo: 7, upsetOddsHi: 15, draw2OddsMax: 15 },
  },
  rqspf: {
    favHomeLo: 1.5, favHomeHi: 2.0,
  },
  zjq: {
    normalTwoLo: 2.5, normalTwoHi: 3.5,
    baselineBigHandicapAbs: 2,
  },
  bqc: {
    ssMax: 2.0,
  },
  single: {
    bigBall: { totalMin: 1, totalMax: 6, oddsLo: 25, oddsHi: 65, count: 2 },
    weak:    { totalMin: 1, totalMax: 4, oddsLo: 25, oddsHi: 50, count: 2 },
  },
  combos: {
    legMode: 'safe',
    legsPerMatch: 2,
    rank: 'oddsAsc',
    c2: { oddsLo: 10, oddsHi: 150, topN: 10 },
    c3: { oddsLo: 30, oddsHi: 1500, topN: 10 },
  },

  // ---------- 新增: 5类选单参数 + 信号阈值 ----------
  // 选单是在"当日所有场次出完各自的 rqspf 主+次 选项 + 3个比分"之后,
  // 把多场组合/单关汇总成投注建议。所有数字均为可优化参数。
  picker: {
    // 类别1: rqspf 3串1 (核心) / 4串1 (有4场时附加)
    // 每天挑 topN 场做 rqspf 3串1, 每场 rqspf 都投 2 倍: 主+次 同时下注
    // 挑场策略: topNMode = 'confidence' (默认: 有让胜纠偏优先, 否则按让胜赔率最接近 1.5 的顺序)
    //                          'all' = 不挑, 全上
    //                          'lowOdds' = 按 rqspf 主选赔率最低优先
    cat1: {
      topN: 3,                     // 每天挑几场做 3串1
      topNMode: 'confidence',      // 挑场排序策略: confidence | lowOdds
      parlay3: true,               // 是否出 3串1
      parlay4IfAvailable: true,    // 当日>=4场时额外出 4串1 (只取主方向, 1注, 靠命中率)
      // legMode: 每场 rqspf 腿的形式, 让 33_fit 试遍择 ROI 最高:
      //   'doubleSide'  = 主+次 双边展开成多注 (笛卡尔)
      //   'primaryOnly' = 只主方向, 1 注线
      //   'primary2x'   = 只主方向, 每腿下注金额 ×2
      legMode: 'doubleSide',
    },
    // 类别2: 比分 2串1 —— 每场从 3 个比分中挑 2 个
    // 怎么挑 = pickMode:
    //   'low2'       = 最低赔率的 2 个 (命中率优先)
    //   'high2'      = 最高赔率的 2 个 (爆冷优先)
    //   'outer2'     = 最低 + 最高 (保守 + 爆冷兼顾)
    //   'mid+low'    = 低 + 中
    // 再配合 topN 做场次筛选 (默认 'highRoi' = 按主池赔率最接近某阈值)
    cat2: {
      pickMode: 'low2',            // 每场从 3 比分里挑哪 2 个
      topN: 2,                     // 每天挑几场做 2串1
      topNMode: 'highRoi',         // highRoi=优先选主池最低赔率最接近 targetOdds 的
      targetOdds: 12,              // 配合 highRoi 使用
    },
    // 类别3: 单关高倍比分 —— 主池中有比分赔率 >= oddsThreshold 即出
    cat3: {
      oddsThreshold: 25,           // 主池里任何一个比分 >= 此阈值即出单关
      maxPerMatch: 1,              // 每场最多出几个 (命中就 1 个, 此值实际为是否多挑)
    },
    // 类别4: 单关 zjq —— 仅在"zjq策略给出纠偏推荐 (corrected 存在)"时出单关
    cat4: {
      needCorrected: true,         // 必须有纠偏才出 (否则每场都有 stable, 意义不大)
    },
    // 类别5: 单关 bqc —— 仅在"bqc策略给出纠偏推荐 (corrected 存在)"时出单关
    cat5: {
      needCorrected: true,
    },
  },
};

// ==================================================================
// 2) 搜索空间: 33_fit 坐标下降扫的旋钮
//    重点调优: rqspf命中率 / 3比分ROI / 5类选单 ROI
// ==================================================================
export const SEARCH_SPACE = [
  // --- rqspf 命中率 ---
  { path: 'rqspf.favHomeLo',              values: [1.4, 1.5, 1.6, 1.7] },
  { path: 'rqspf.favHomeHi',              values: [1.9, 2.0, 2.1, 2.2] },
  // --- 3 比分 ROI (f4 主池) ---
  { path: 'f4.bigBall.safeOddsMax',       values: [10, 12, 15] },
  { path: 'f4.bigBall.midLo',             values: [10, 12, 15] },
  { path: 'f4.bigBall.midHi',             values: [22, 25, 30] },
  { path: 'f4.weak.coreLo',               values: [8, 10, 12] },
  { path: 'f4.weak.coreHi',               values: [25, 30, 35] },
  { path: 'f4.normal.upsetOddsLo',        values: [6, 7, 8] },
  { path: 'f4.normal.upsetOddsHi',        values: [13, 15, 18] },
  { path: 'f4.normal.draw2OddsMax',       values: [12, 15, 20] },
  // --- zjq / bqc 纠偏 ---
  { path: 'zjq.normalTwoLo',              values: [2.3, 2.5, 2.7] },
  { path: 'zjq.normalTwoHi',              values: [3.3, 3.5, 3.7] },
  { path: 'bqc.ssMax',                    values: [1.8, 2.0, 2.2] },
  // --- 单关 (类别3 间接影响: 单关数量越少, ROI 越靠真信号) ---
  { path: 'single.bigBall.oddsLo',        values: [20, 25, 30] },
  { path: 'single.bigBall.oddsHi',        values: [55, 65, 75] },
  { path: 'single.bigBall.count',         values: [1, 2] },
  { path: 'single.weak.oddsLo',           values: [20, 25, 30] },
  { path: 'single.weak.oddsHi',           values: [45, 50, 60] },
  { path: 'single.weak.count',            values: [1, 2] },
  // --- 选单调参 (重点新加入: 调每类单的 ROI) ---
  { path: 'picker.cat1.topN',             values: [2, 3] },
  { path: 'picker.cat1.topNMode',         values: ['confidence', 'lowOdds'] },
  { path: 'picker.cat1.legMode',          values: ['doubleSide', 'primaryOnly', 'primary2x'] },
  { path: 'picker.cat2.pickMode',         values: ['low2', 'outer2', 'mid+low', 'high2'] },
  { path: 'picker.cat2.topN',             values: [2, 3] },
  { path: 'picker.cat3.oddsThreshold',    values: [20, 25, 35, 50] },
];

// 深拷贝 + 按路径读写
export function clone(o) { return JSON.parse(JSON.stringify(o)); }
export function getPath(obj, p) { return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
export function setPath(obj, p, v) {
  const ks = p.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
  return obj;
}
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

// ==================================================================
// 3) 球队上下文
// ==================================================================
export function createTeamCtx(PROJECT_ROOT) {
  const idx = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'teams', '_index.json'), 'utf-8'));
  const codeByTier = idx.by_tier || {};
  const tierOfCode = {};
  for (const [tier, codes] of Object.entries(codeByTier)) for (const c of codes) tierOfCode[c] = tier;
  const codeByName = idx.by_name || {};
  const variants = idx.name_variants_to_code || {};
  const scorerStarCodes = new Set();
  const nameToTier = {};
  for (const [code, rel] of Object.entries(idx.by_code || {})) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', rel), 'utf-8'));
      if (t.meta?.has_scorer_star === true) scorerStarCodes.add(code);
      if (t.name && tierOfCode[code]) nameToTier[t.name] = tierOfCode[code];
    } catch (e) { /* ignore */ }
  }
  for (const [alias, code] of Object.entries(variants)) if (tierOfCode[code]) nameToTier[alias] = tierOfCode[code];
  const codeOf = (teamName) => (teamName ? (codeByName[teamName] || nameToTier[teamName] ? null : null) : null);
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

// ==================================================================
// 4) 回测样本加载
// ==================================================================
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
      mid, code: oddsDoc.basic?.code || oddsDoc.basic?.match || String(oddsDoc.basic?.code),
      home: oddsDoc.basic?.home, away: oddsDoc.basic?.away,
      match: `${oddsDoc.basic?.home}vs${oddsDoc.basic?.away}`,
      kickoff: oddsDoc.basic?.kickoff,   // 选单回测要按天分组
      handicap: oddsDoc.odds?.handicap ?? 0,
      bf: oddsDoc.odds?.bf_latest,
      rqspf: oddsDoc.odds?.rqspf_latest,
      zjq: oddsDoc.odds?.zjq_latest,
      bqc: oddsDoc.odds?.bqc_latest,
      bf_latest: oddsDoc.odds?.bf_latest,
      actualHome: actual.homeScore, actualAway: actual.awayScore,
      halfTime: actual.halfTime || null,
    });
  }
  return out;
}

// ==================================================================
// 5) 工具: normalizeScore / parseOdds
// ==================================================================
export function normalizeScore(s) { return s.split(':').map(p => String(Number(p))).join(':'); }
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

// ==================================================================
// 6) 比赛分类
// ==================================================================
export function classifyMatch(m, ctx) {
  const P = ctx.params.classify;
  const hc = m.handicap;
  const tCode = m.teamCode || m.code;
  const tier = ctx.getTeamTier ? ctx.getTeamTier(m.home || m.code) : 'NORMAL';
  const homeHasStar = ctx.hasScorerStar ? ctx.hasScorerStar(m.home || m.code) : false;
  const awayHasStar = ctx.hasScorerStar ? ctx.hasScorerStar(m.away || m.code) : false;
  let isBigBall = false;
  if (Math.abs(hc) >= P.bigHandicapAbs) {
    const favHasStar = hc < 0 ? (m.homeHasStar || homeHasStar || false) : (m.awayHasStar || awayHasStar || false);
    if (favHasStar) isBigBall = true;
  }
  if (homeHasStar && awayHasStar) isBigBall = true;
  const isWeak = ((tier === 'weak' || tier === 'defensive') && !homeHasStar && !awayHasStar);
  if (isBigBall) return 'BIG_BALL';
  if (isWeak) return 'WEAK_MATCH';
  return 'NORMAL';
}

// ==================================================================
// 7) F4 混合主池 —— 输出 3 个比分 (排序: 低→高, 便于 3比分ROI 逐项分析)
// ==================================================================
export function f4Strategy(m, ctx) {
  const P = ctx.params.f4;
  const type = classifyMatch(m, ctx);
  const all = parseOdds(m.bf || m.bf_latest);
  const dir = (m.handicap ?? 0) <= 0 ? 'home' : 'away';
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

// ==================================================================
// 8) RQSPF 跟投 + 让胜纠偏
// ==================================================================
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

// ==================================================================
// 9) ZJQ 跟投 + 比赛类型判断
// ==================================================================
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

// ==================================================================
// 10) BQC 跟投 + 胜胜纠偏
// ==================================================================
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

// ==================================================================
// 11) 单关策略: BIG_BALL→反方向高赔率, WEAK_MATCH→高赔率, NORMAL→不推
// ==================================================================
export function singleBetStrategy(m, mainPicks, ctx) {
  const P = ctx.params.single;
  const type = classifyMatch(m, ctx);
  const all = parseOdds(m.bf || m.bf_latest);
  const dir = (m.handicap ?? 0) <= 0 ? 'home' : 'away';
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

// ==================================================================
// 12) 串关组合 (2串1 / 3串1) —— 比分串关, 喂 build_chat_predict, 形状勿动
// ==================================================================
export function generateCombos(matches, ctx) {
  const P = ctx.params.combos;
  const legsOf = (m) => {
    const picks = (m.mainPicks || []).slice().sort((a, b) => a.odds - b.odds);
    return P.legMode === 'safe' ? picks.slice(0, P.legsPerMatch) : picks;
  };
  const rankCmp = (a, b) => P.rank === 'oddsDesc' ? b.odds - a.odds : a.odds - b.odds;

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

// ==================================================================
// 13) buildPrediction —— 把一场(预测/回测)算成统一的 matchPrediction
//     供 selectBets 使用, 31/33 共用同一口径
// ==================================================================
export function buildPrediction(m, ctx) {
  return {
    code: m.code,
    match: m.match || `${m.home}vs${m.away}`,
    handicap: m.handicap ?? 0,
    rqspf: m.rqspf,
    mainPicks: f4Strategy(m, ctx),
    rq: rqspfStrategy(m, ctx),
    z: zjqStrategy(m, ctx),
    b: bqcStrategy(m, ctx),
  };
}

// ==================================================================
// 14) deriveActual —— 从完赛比赛推导各玩法真实结果 (回测/拟合共用)
// ==================================================================
export function deriveActual(m) {
  const score = `${m.actualHome}:${m.actualAway}`;
  const diff = m.actualHome - m.actualAway + (m.handicap ?? 0);
  const rqResult = diff > 0 ? 'home' : diff < 0 ? 'away' : 'draw';
  const total = m.actualHome + m.actualAway;
  const zjqResult = total >= 7 ? '7+' : String(total);
  let bqcResult = null;
  if (m.halfTime) {
    const hh = m.halfTime.home, ha = m.halfTime.away;
    const half = hh > ha ? '胜' : hh < ha ? '负' : '平';
    const full = m.actualHome > m.actualAway ? '胜' : m.actualHome < m.actualAway ? '负' : '平';
    bqcResult = half + full;
  }
  return { score, rqResult, zjqResult, bqcResult };
}

// ==================================================================
// 15) 选单 (picker): 把当日每场预测汇总成 5 类投注
//   cat1 必出: rqspf 3串1 (+4串1)   cat2 必出: 比分 2串1
//   cat3/4/5 可选: 高倍比分单关 / zjq 单关 / bqc 单关 (有信号才出)
//   入参 dayMatches: buildPrediction 产出的数组 (含 rq/z/b/mainPicks)
//   纯函数, 由 ctx.params.picker 驱动
// ==================================================================
function cartesian(arrs) {
  // [[a1,a2],[b1]] → [[a1,b1],[a2,b1]]
  return arrs.reduce((acc, cur) => {
    const out = [];
    for (const a of acc) for (const c of cur) out.push(a.concat([c]));
    return out;
  }, [[]]);
}

function rankCat1(dayMatches, c1, RQ) {
  const cands = dayMatches.filter(m => m.rq && m.rq.primary);
  const mid = (RQ.favHomeLo + RQ.favHomeHi) / 2;
  const scored = cands.map(m => {
    const rq = m.rq;
    let score;
    if (c1.topNMode === 'lowOdds') {
      score = rq.primary.odds;                                  // 主选赔率越低越优先
    } else { // 'confidence': 让胜纠偏优先, 其余按主选赔率距 favHome 中点
      const isCorr = rq.rule?.name?.includes('纠偏');
      score = (isCorr ? 0 : 1000) + Math.abs(rq.primary.odds - mid);
    }
    return { m, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.map(x => x.m);
}

function cat1Legs(m, legMode) {
  const rq = m.rq;
  const primary = { code: m.code, match: m.match, d: rq.primary.d, label: rq.primary.label, odds: rq.primary.odds };
  if (legMode === 'doubleSide' && rq.secondary && rq.secondary.d !== rq.primary.d) {
    return [primary, { code: m.code, match: m.match, d: rq.secondary.d, label: rq.secondary.label, odds: rq.secondary.odds }];
  }
  return [primary];
}

function buildCat1(dayMatches, c1, RQ) {
  const legMode = c1.legMode || 'doubleSide';
  const empty = { matches: [], tickets: [], parlay4: null, legMode, stake: 1 };
  if (!c1.parlay3) return empty;
  const ranked = rankCat1(dayMatches, c1, RQ);
  const sel = ranked.slice(0, c1.topN);
  if (sel.length < c1.topN) return empty;        // 必出, 但需够 topN 场才成串

  const stake = legMode === 'primary2x' ? 2 : 1;
  const legSets = sel.map(m => cat1Legs(m, legMode));
  const tickets = cartesian(legSets).map(legs => ({
    legs,
    odds: +legs.reduce((s, l) => s * l.odds, 1).toFixed(2),
    stake,
  }));

  let parlay4 = null;
  if (c1.parlay4IfAvailable && ranked.length >= 4) {
    const sel4 = ranked.slice(0, 4);
    const legs4 = sel4.map(m => cat1Legs(m, 'primaryOnly')[0]);
    parlay4 = {
      matches: sel4.map(m => m.code),
      legs: legs4,
      odds: +legs4.reduce((s, l) => s * l.odds, 1).toFixed(2),
      stake: 1,
    };
  }

  return { matches: sel.map(m => m.code), tickets, parlay4, legMode, stake };
}

function rankCat2(dayMatches, c2) {
  const cands = dayMatches.filter(m => (m.mainPicks || []).length >= 2);
  const loOf = (m) => Math.min(...m.mainPicks.map(p => p.odds));
  if (c2.topNMode === 'highRoi') {
    return cands.slice().sort((a, b) => Math.abs(loOf(a) - c2.targetOdds) - Math.abs(loOf(b) - c2.targetOdds));
  }
  return cands.slice().sort((a, b) => loOf(a) - loOf(b));
}

function cat2PickScores(mainPicks, pickMode) {
  const sorted = mainPicks.slice().sort((a, b) => a.odds - b.odds);
  const n = sorted.length;
  if (n <= 2) return sorted.slice(0, 2);
  switch (pickMode) {
    case 'high2':   return sorted.slice(n - 2);
    case 'outer2':  return [sorted[0], sorted[n - 1]];
    case 'mid+low': return [sorted[0], sorted[1]];
    case 'low2':
    default:        return sorted.slice(0, 2);
  }
}

function buildCat2(dayMatches, c2) {
  const ranked = rankCat2(dayMatches, c2);
  const sel = ranked.slice(0, c2.topN);
  if (sel.length < c2.topN) return { matches: [], tickets: [] };
  const legSets = sel.map(m =>
    cat2PickScores(m.mainPicks, c2.pickMode).map(p => ({ code: m.code, match: m.match, score: p.score, odds: p.odds }))
  );
  const tickets = cartesian(legSets).map(legs => ({
    legs,
    odds: +legs.reduce((s, l) => s * l.odds, 1).toFixed(2),
    stake: 1,
  }));
  return { matches: sel.map(m => m.code), tickets };
}

export function selectBets(dayMatches, ctx) {
  const P = ctx.params.picker;
  const cat1 = buildCat1(dayMatches, P.cat1, ctx.params.rqspf);
  const cat2 = buildCat2(dayMatches, P.cat2);

  const cat3 = [];
  for (const m of dayMatches) {
    const picks = (m.mainPicks || []).filter(p => p.odds >= P.cat3.oddsThreshold)
      .sort((a, b) => b.odds - a.odds).slice(0, P.cat3.maxPerMatch);
    for (const p of picks) cat3.push({ code: m.code, match: m.match, score: p.score, odds: p.odds });
  }

  const cat4 = [];
  for (const m of dayMatches) {
    const z = m.z;
    if (!z) continue;
    if (P.cat4.needCorrected && !z.corrected) continue;
    let picks, oddsMap;
    if (z.corrected?.picks) { picks = z.corrected.picks; oddsMap = z.corrected.odds; }
    else if (z.corrected?.pick) { picks = [z.corrected.pick]; oddsMap = { [z.corrected.pick]: z.corrected.odds }; }
    else continue;
    cat4.push({ code: m.code, match: m.match, picks, oddsMap, rule: z.rule });
  }

  const cat5 = [];
  for (const m of dayMatches) {
    const b = m.b;
    if (!b || !b.corrected) continue;
    if (P.cat5.needCorrected && !b.corrected) continue;
    cat5.push({ code: m.code, match: m.match, picks: b.corrected.picks, oddsMap: b.corrected.odds, rule: b.rule });
  }

  return { cat1, cat2, cat3, cat4, cat5 };
}

// ==================================================================
// 16) 选单结算 (回测/拟合共用)
//   categories = selectBets(...);  actualByCode[code] = deriveActual(m)
//   口径: 每注 1 单位 (stake 倍率计入 cost/ret); 串关全中才算中, return=腿赔率连乘×stake
// ==================================================================
export function settleBets(categories, actualByCode) {
  const z = () => ({ cost: 0, ret: 0, hits: 0, n: 0 });
  const out = { cat1: z(), cat2: z(), cat3: z(), cat4: z(), cat5: z() };

  const c1 = categories.cat1 || { tickets: [], parlay4: null };
  const allC1 = (c1.tickets || []).concat(c1.parlay4 ? [c1.parlay4] : []);
  for (const t of allC1) {
    const stake = t.stake || 1;
    out.cat1.n++; out.cat1.cost += stake;
    const win = t.legs.every(l => actualByCode[l.code]?.rqResult === l.d);
    if (win) { out.cat1.ret += t.odds * stake; out.cat1.hits++; }
  }

  for (const t of (categories.cat2?.tickets || [])) {
    const stake = t.stake || 1;
    out.cat2.n++; out.cat2.cost += stake;
    const win = t.legs.every(l => actualByCode[l.code]?.score === l.score);
    if (win) { out.cat2.ret += t.odds * stake; out.cat2.hits++; }
  }

  for (const p of (categories.cat3 || [])) {
    out.cat3.n++; out.cat3.cost += 1;
    if (actualByCode[p.code]?.score === p.score) { out.cat3.ret += p.odds; out.cat3.hits++; }
  }

  for (const p of (categories.cat4 || [])) {
    const res = actualByCode[p.code]?.zjqResult;
    out.cat4.n++; out.cat4.cost += p.picks.length;
    if (p.picks.includes(res)) { out.cat4.ret += (p.oddsMap[res] || 0); out.cat4.hits++; }
  }

  for (const p of (categories.cat5 || [])) {
    const res = actualByCode[p.code]?.bqcResult;
    out.cat5.n++; out.cat5.cost += p.picks.length;
    if (p.picks.includes(res)) { out.cat5.ret += (p.oddsMap[res] || 0); out.cat5.hits++; }
  }

  return out;
}

// ==================================================================
// 17) groupByDay —— 把回测样本按 kickoff 日期分组 (选单按天出)
// ==================================================================
export function groupByDay(matches) {
  const byDay = new Map();
  for (const m of matches) {
    const day = (m.kickoff || '').split(' ')[0] || 'unknown';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(m);
  }
  return byDay;
}