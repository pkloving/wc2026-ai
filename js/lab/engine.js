// js/lab/engine.js — 回测实验室纯函数引擎（零 DOM，Node 可测）
//
// 用法（浏览器端）:  import { runBacktest, encodeCfg, decodeCfg } from './engine.js';
// 用法（Node 测试）:  node -e "import('./js/lab/engine.js').then(...)"
//
// 配置契约（cfg）:
//   {
//     play: 'spf' | 'rqspf' | 'zjq' | 'bqc',
//     pick: <play-specific>,          // 见下
//     filters: {
//       stage: 'group' | 'ko' | 'all',  // 阶段
//       rounds: [1,2,3] | null,         // 小组 R1/R2/R3（仅 group 阶段生效）
//       scenario: 'rest_vs_out' | ... | null,
//       favBand: 'favStrong' | 'favMed' | 'favWeak' | 'any',
//       goalAxis: 'bigBall' | 'midBall' | 'smallBall' | 'any',
//       rqspfSpreadMin: 0 | 2 | 3,      // 让球赔差阈值
//       favOddsMax: null | 1.5 | 2.0 | 2.5,  // favOdds ≤ 此值才纳入
//     },
//     structure: {
//       kind: 'single' | 'parlay' | 'cover',
//       legs: 2 | 3,                    // 仅 parlay 用
//     },
//   }
//
// pick 契约:
//   spf/rqspf: 'fav' | 'dog' | 'draw' | 'home' | 'away' | 'all-outcomes'
//              + 'cover-low' / 'cover-high' (rqspf 双选)
//   zjq: 单 band '0'..'6' | '7+'
//        'fav' (隐含最高 prob) | 'ev-mid' (2-3 球) | 'all-outcomes'
//   bqc: 单 key '胜胜' | '胜平' | ... | 'fav' | 'cover' (胜胜+平平) | 'all-outcomes'
//
// 数据契约:  data/lab_dataset.json → { y2026: {matches}, y2022: {matches}, ... }
// 每场: { t, id, mid, stage, round, group, home, away, kickoff, score, odds, res, flags }

// =====================================================================
// Helpers
// =====================================================================

/** 找 spf/rqspf 三门里赔率最低的方向（用于 fav/dog 策略） */
function pickLowest(odds, keys) {
  let best = null;
  for (const k of keys) {
    const v = odds?.[k];
    if (typeof v !== 'number') continue;
    if (best == null || v < best.odds) best = { side: k, odds: v };
  }
  return best;
}
function pickHighest(odds, keys) {
  let best = null;
  for (const k of keys) {
    const v = odds?.[k];
    if (typeof v !== 'number') continue;
    if (best == null || v > best.odds) best = { side: k, odds: v };
  }
  return best;
}

/** 找隐含概率最高的（1/odds 最大） */
function pickHighestProb(odds) {
  let best = null;
  for (const k of Object.keys(odds || {})) {
    const v = odds[k];
    if (typeof v !== 'number' || v <= 0) continue;
    if (best == null || 1 / v > best.prob) best = { side: k, odds: v, prob: 1 / v };
  }
  return best;
}

// =====================================================================
// 1) filterMatches
// =====================================================================

export function filterMatches(matches, filters = {}) {
  const f = filters || {};
  const stage = f.stage || 'all';
  const rounds = f.rounds || null;
  const scenario = f.scenario || null;
  const favBand = f.favBand || 'any';
  const goalAxis = f.goalAxis || 'any';
  const rqspfSpreadMin = f.rqspfSpreadMin || 0;
  const favOddsMax = f.favOddsMax || null;

  return matches.filter((m) => {
    if (stage === 'group' && m.stage !== 'group') return false;
    if (stage === 'ko' && m.stage === 'group') return false;
    if (rounds && rounds.length && (m.stage !== 'group' || !rounds.includes(m.round))) return false;
    if (scenario && m.flags?.scenario !== scenario) return false;
    if (favBand !== 'any' && m.flags?.favBand !== favBand) return false;
    if (goalAxis !== 'any' && m.flags?.goalAxis !== goalAxis) return false;
    if (rqspfSpreadMin > 0 && (m.flags?.rqspfSpread || 0) < rqspfSpreadMin) return false;
    if (favOddsMax != null && (m.flags?.favOdds || 999) > favOddsMax) return false;
    return true;
  });
}

// =====================================================================
// 2) makeLegs — 每场转成一组 selection(s) {side, odds, hit}
//    single:  1 leg = 1 selection
//    parlay:  1 leg = 1 selection（最后由 buildTickets 串起来）
//    cover:   1 leg = 2 selections（双选）
// =====================================================================

function rqspfSelection(m, pick) {
  if (!m.odds?.rqspf) return null;
  const o = m.odds.rqspf;
  if (pick === 'fav') {
    // 用 rqspf 三门最低赔率（rqspfFavSide 优先）
    const side = m.flags.rqspfFavSide || m.flags.favSide;
    return o[side] ? { side, odds: o[side] } : null;
  }
  if (pick === 'dog') {
    const fav = m.flags.rqspfFavSide || m.flags.favSide;
    const others = ['home', 'draw', 'away'].filter((s) => s !== fav);
    const p = pickHighest(o, others);
    return p ? { side: p.side, odds: p.odds } : null;
  }
  if (pick === 'draw') return o.draw ? { side: 'draw', odds: o.draw } : null;
  if (pick === 'home' || pick === 'away') return o[pick] ? { side: pick, odds: o[pick] } : null;
  if (pick === 'all-outcomes') {
    return ['home', 'draw', 'away'].filter((s) => o[s] != null).map((s) => ({ side: s, odds: o[s] }));
  }
  if (pick === 'cover-low' || pick === 'cover-high') {
    const all = ['home', 'draw', 'away'].filter((s) => o[s] != null).map((s) => ({ side: s, odds: o[s] }));
    if (all.length < 2) return null;
    all.sort((a, b) => a.odds - b.odds);
    if (pick === 'cover-low') return [all[0], all[1]];
    return [all[0], all[all.length - 1]];
  }
  return null;
}

function spfSelection(m, pick) {
  if (!m.odds?.spf) return null;
  const o = m.odds.spf;
  if (pick === 'fav') return { side: m.flags.favSide, odds: o[m.flags.favSide] };
  if (pick === 'dog') {
    const fav = m.flags.favSide;
    const others = ['home', 'draw', 'away'].filter((s) => s !== fav);
    const p = pickHighest(o, others);
    return p ? { side: p.side, odds: p.odds } : null;
  }
  if (pick === 'draw') return o.draw ? { side: 'draw', odds: o.draw } : null;
  if (pick === 'home' || pick === 'away') return o[pick] ? { side: pick, odds: o[pick] } : null;
  if (pick === 'all-outcomes') {
    return ['home', 'draw', 'away'].filter((s) => o[s] != null).map((s) => ({ side: s, odds: o[s] }));
  }
  return null;
}

function zjqSelection(m, pick) {
  const o = m.odds?.zjq;
  if (!o) return null;
  if (pick === 'all-outcomes') {
    return Object.keys(o).filter((k) => o[k] != null).map((k) => ({ side: k, odds: o[k] }));
  }
  if (pick === 'fav') {
    const p = pickHighestProb(o);
    return p ? { side: p.side, odds: p.odds } : null;
  }
  if (pick === 'ev-mid') {
    // 隐含期望 2-3 球：固定选 2 球（用户研究: ZJQ 2 球频率最高 30.8%）
    return o['2'] ? { side: '2', odds: o['2'] } : null;
  }
  if (/^[0-6]$/.test(pick) || pick === '7+') {
    return o[pick] ? { side: pick, odds: o[pick] } : null;
  }
  return null;
}

function bqcSelection(m, pick) {
  const o = m.odds?.bqc;
  if (!o) return null;
  if (pick === 'all-outcomes') {
    return Object.keys(o).filter((k) => o[k] != null).map((k) => ({ side: k, odds: o[k] }));
  }
  if (pick === 'fav') {
    const p = pickHighestProb(o);
    return p ? { side: p.side, odds: p.odds } : null;
  }
  if (pick === 'cover') {
    // 胜胜 + 平平（用户研究: 纠偏 ROI 之王）
    const a = o['胜胜'], b = o['平平'];
    if (a != null && b != null) return [{ side: '胜胜', odds: a }, { side: '平平', odds: b }];
    return null;
  }
  // 单 key: 胜胜/胜平/...
  if (o[pick] != null) return { side: pick, odds: o[pick] };
  return null;
}

export function makeLegs(matches, cfg) {
  const legs = [];
  for (const m of matches) {
    let sels = null;
    if (cfg.play === 'spf') sels = spfSelection(m, cfg.pick);
    else if (cfg.play === 'rqspf') sels = rqspfSelection(m, cfg.pick);
    else if (cfg.play === 'zjq') sels = zjqSelection(m, cfg.pick);
    else if (cfg.play === 'bqc') sels = bqcSelection(m, cfg.pick);
    if (!sels) continue; // 该场不参与（如缺赔率）
    if (!Array.isArray(sels)) sels = [sels];

    for (const s of sels) {
      if (typeof s.odds !== 'number' || s.odds <= 1) continue; // 赔率异常
      legs.push({
        mid: m.mid,
        id: m.id,
        kickoff: m.kickoff,
        home: m.home,
        away: m.away,
        play: cfg.play,
        side: s.side,
        odds: s.odds,
        // 命中判定
        hit: isHit(m, cfg.play, s.side),
      });
    }
  }
  return legs;
}

function isHit(m, play, side) {
  if (play === 'spf') return m.res?.spf === side;
  if (play === 'rqspf') return m.res?.rqspf === side;
  if (play === 'zjq') return m.res?.zjq === String(side);
  if (play === 'bqc') return m.res?.bqc === side;
  return false;
}

// =====================================================================
// 3) buildTickets — single/parlay/cover
// =====================================================================

function combinations(arr, k) {
  if (k <= 0) return [[]];
  if (k > arr.length) return [];
  if (k === arr.length) return [arr.slice()];
  if (k === 1) return arr.map((x) => [x]);
  const out = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const head = arr[i];
    const rest = combinations(arr.slice(i + 1), k - 1);
    for (const r of rest) out.push([head, ...r]);
  }
  return out;
}

export function buildTickets(legs, structure) {
  const kind = structure?.kind || 'single';
  if (kind === 'parlay') {
    const k = Math.max(2, structure.legs || 2);
    // 串关 = 同届内按 kickoff 排序，连续 k 腿成一串。凑不满的尾腿弃用 (dropped 计数)。
    // 不采样 C(N,k) 组合数学——那等于「每天随机抽 3 场买串关」，对用户是误导。
    const sorted = [...legs].sort((a, b) => String(a.kickoff || '').localeCompare(String(b.kickoff || '')));
    const totalLegs = sorted.length;
    const usedLegs = Math.floor(totalLegs / k) * k;  // 凑满 k 串的腿数
    const dropped = totalLegs - usedLegs;             // 尾部弃用（凑不满 k 腿）
    const tickets = [];
    for (let i = 0; i + k <= usedLegs; i += k) {
      tickets.push({ kind: 'parlay', legs: sorted.slice(i, i + k) });
    }
    return { tickets, dropped };
  }
  if (kind === 'cover') {
    return { tickets: [{ kind: 'cover', legs }], dropped: 0 };
  }
  return { tickets: legs.map((l) => ({ kind: 'single', legs: [l] })), dropped: 0 };
}

// =====================================================================
// 4) simulate — 每票每注各花 1 元，命中按 odds 返
// =====================================================================

export function simulate(tickets) {
  let cost = 0, ret = 0, hits = 0;
  const equity = []; // [{ x: 票序号(0..N-1), y: 累计净 }]
  let net = 0;
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    cost += 1;
    const allHit = t.legs.every((l) => l.hit);
    if (allHit) {
      const oddsProd = t.legs.reduce((p, l) => p * l.odds, 1);
      ret += oddsProd;
      hits += 1;
      net += (oddsProd - 1);
    } else {
      net -= 1;
    }
    equity.push({ x: i + 1, y: +net.toFixed(2) });
  }
  return { cost, ret, hits, net, n: tickets.length, equity };
}

// =====================================================================
// 5) breakdown — 输出 n/roi/hitRate/maxDrawdown
// =====================================================================

export function breakdown(sim) {
  const { cost, ret, hits, n, equity } = sim;
  const roi = cost > 0 ? +((ret - cost) / cost * 100).toFixed(2) : 0;
  const hitRate = n > 0 ? +(hits / n * 100).toFixed(1) : 0;
  let peak = 0, maxDD = 0;
  for (const p of equity) {
    if (p.y > peak) peak = p.y;
    const dd = peak - p.y;
    if (dd > maxDD) maxDD = dd;
  }
  return { n, cost: +cost.toFixed(2), ret: +ret.toFixed(2), net: +sim.net.toFixed(2), roi, hitRate, maxDrawdown: +maxDD.toFixed(2), equity };
}

// =====================================================================
// 6) runBacktest — 主入口
// =====================================================================

export function runBacktest(dataset, year, cfg) {
  const yearData = dataset[`y${year}`];
  if (!yearData) return null;
  const filtered = filterMatches(yearData.matches, cfg.filters);
  const legs = makeLegs(filtered, cfg);
  const { tickets, dropped } = buildTickets(legs, cfg.structure);
  const sim = simulate(tickets);
  const stat = breakdown(sim);
  return { year, n: stat.n, cost: stat.cost, ret: stat.ret, net: stat.net, roi: stat.roi, hitRate: stat.hitRate, maxDrawdown: stat.maxDrawdown, equity: stat.equity, matches: filtered.length, legs: legs.length, dropped, badges: [] };
}

// =====================================================================
// 7) detectBadges
// =====================================================================

export function detectBadges(results) {
  const badges = [];
  if (results.length < 2) return badges;
  const [a, b] = results;
  for (const r of results) {
    if (r.n > 0 && r.n < 10) r.badges.push({ type: 'smallSample', label: '样本过小', severity: 'warn' });
    if (r.year === 2026) r.badges.push({ type: 'inSample2026', label: '2026 样本内', severity: 'info' });
  }
  // regimeFlip: 两届 ROI 符号相反且至少一届 |roi| > 20
  if (a.roi * b.roi < 0 && (Math.abs(a.roi) >= 20 || Math.abs(b.roi) >= 20)) {
    badges.push({ type: 'regimeFlip', label: '两届方向翻转（过拟合演示）', severity: 'critical' });
  }
  return badges;
}

// =====================================================================
// 8) legsToCsvRows
// =====================================================================

export function legsToCsvRows(legs, tickets) {
  // 1 行 = 1 注
  const rows = [['kind', 'legs', 'home', 'away', 'side', 'odds', 'hit', 'payout']];
  for (const t of tickets) {
    if (t.kind === 'parlay') {
      const allHit = t.legs.every((l) => l.hit);
      const oddsProd = t.legs.reduce((p, l) => p * l.odds, 1);
      const payout = allHit ? oddsProd.toFixed(2) : '0';
      const summary = t.legs.map((l) => `${l.play}:${l.side}@${l.odds.toFixed(2)}`).join(' | ');
      rows.push(['parlay', t.legs.length, t.legs[0].home, t.legs[0].away, summary, oddsProd.toFixed(2), allHit ? '1' : '0', payout]);
    } else if (t.kind === 'cover') {
      // 2 注（按 leg 拆）
      for (const l of t.legs) {
        rows.push(['cover', 1, l.home, l.away, `${l.play}:${l.side}`, l.odds.toFixed(2), l.hit ? '1' : '0', l.hit ? l.odds.toFixed(2) : '0']);
      }
    } else {
      const l = t.legs[0];
      rows.push(['single', 1, l.home, l.away, `${l.play}:${l.side}`, l.odds.toFixed(2), l.hit ? '1' : '0', l.hit ? l.odds.toFixed(2) : '0']);
    }
  }
  return rows;
}

// =====================================================================
// 9) encodeCfg / decodeCfg
// =====================================================================

export function encodeCfg(cfg) {
  const params = new URLSearchParams();
  if (cfg.play) params.set('play', cfg.play);
  if (cfg.pick) params.set('pick', cfg.pick);
  if (cfg.filters) {
    for (const [k, v] of Object.entries(cfg.filters)) {
      if (v == null) continue;
      if (Array.isArray(v)) { if (v.length) params.set(k, v.join(',')); }
      else if (v !== 'all' && v !== 'any') params.set(k, String(v));
    }
  }
  if (cfg.structure?.kind) {
    params.set('struct', cfg.structure.kind);
    if (cfg.structure.legs) params.set('legs', String(cfg.structure.legs));
  }
  return params.toString();
}

export function decodeCfg(qs) {
  const params = qs instanceof URLSearchParams ? qs : new URLSearchParams(qs || '');
  const out = { play: null, pick: null, filters: {}, structure: { kind: 'single' } };
  if (params.get('play')) out.play = params.get('play');
  if (params.get('pick')) out.pick = params.get('pick');
  const stage = params.get('stage'); if (stage) out.filters.stage = stage;
  const rounds = params.get('rounds'); if (rounds) out.filters.rounds = rounds.split(',').map(Number);
  const scenario = params.get('scenario'); if (scenario) out.filters.scenario = scenario;
  const favBand = params.get('favBand'); if (favBand) out.filters.favBand = favBand;
  const goalAxis = params.get('goalAxis'); if (goalAxis) out.filters.goalAxis = goalAxis;
  const rqspfSpreadMin = params.get('rqspfSpreadMin'); if (rqspfSpreadMin) out.filters.rqspfSpreadMin = +rqspfSpreadMin;
  const favOddsMax = params.get('favOddsMax'); if (favOddsMax) out.filters.favOddsMax = +favOddsMax;
  const struct = params.get('struct'); if (struct) out.structure.kind = struct;
  const legs = params.get('legs'); if (legs) out.structure.legs = +legs;
  return out;
}

// =====================================================================
// 10) 6 个预设卡（用户可一键载入）
// =====================================================================

export const PRESETS = [
  {
    id: 'r3-underdog',
    title: { zh: 'R3 养生局冷门', en: 'R3 Rest-match underdog' },
    sub: { zh: '小组末轮双方动机差 + 押冷门', en: 'Group R3 motivation gap + dog' },
    cfg: {
      play: 'spf', pick: 'dog',
      filters: { stage: 'group', rounds: [3], scenario: 'rest_vs_mid' },
      structure: { kind: 'single' },
    },
  },
  {
    id: 'vigorish',
    title: { zh: '退水基线', en: 'Vigorish baseline' },
    sub: { zh: 'spf 全部三门 = 平均退水', en: 'spf all 3 outcomes = vig baseline' },
    cfg: {
      play: 'spf', pick: 'all-outcomes',
      filters: { stage: 'all' },
      structure: { kind: 'single' },
    },
  },
  {
    id: 'rqspf-fav-p3',
    title: { zh: '过拟合演示·镇页之宝', en: 'Overfit poster · rqspf fav 3-leg parlay' },
    sub: { zh: 'rqspf 热门 3串1：2026 样本内 vs 2022 样本外', en: 'rqspf fav 3-leg parlay: 2026 in-sample vs 2022 out-of-sample' },
    cfg: {
      play: 'rqspf', pick: 'fav',
      filters: { stage: 'all' },
      structure: { kind: 'parlay', legs: 3 },
    },
  },
  {
    id: 'parlay-leverage',
    title: { zh: '串关放大器', en: 'Parlay leverage' },
    sub: { zh: 'rqspf fav 单 vs 2串 vs 3串', en: 'rqspf fav single vs 2-leg vs 3-leg' },
    cfg: {
      play: 'rqspf', pick: 'fav',
      filters: { stage: 'all' },
      structure: { kind: 'parlay', legs: 2 },
    },
  },
  {
    id: 'rqspf-spread',
    title: { zh: '高赔差 ≥ 3.0', en: 'High rqspf spread ≥ 3.0' },
    sub: { zh: '让球赔差大 + 押热门方向（年景翻转关键样本）', en: 'Big handicap spread + fav (regime flip sample)' },
    // 2026-07-08 bugfix: 写 3.0 而非 3, 配合 <select id="cfg-spread"> 的 option value
    // ("0" / "1.0" / "1.5" / "2.0" / "3.0"), 否则 String(3)="3" 不匹配, 浏览器静默回退到 "0"
    cfg: {
      play: 'rqspf', pick: 'fav',
      filters: { stage: 'all', rqspfSpreadMin: 3.0 },
      structure: { kind: 'single' },
    },
  },
  {
    id: 'tournament-fingerprint',
    title: { zh: '本届指纹', en: 'Tournament fingerprint' },
    sub: { zh: 'zjq 2 球 + spf 平基线', en: 'zjq 2-goal + spf draw baseline' },
    cfg: {
      play: 'zjq', pick: 'ev-mid',
      filters: { stage: 'all' },
      structure: { kind: 'single' },
    },
  },
];
