#!/usr/bin/env node
// build_backtest_dataset.js — 汇总 2022 + 2026 完赛数据 + 赔率 + 标志位，输出 data/lab_dataset.json
//
// 用法:  node scripts/build_backtest_dataset.js
//
// 触发时机: build_settled.js + build_views.js 之后（依赖 *_wc_view.json）
// 加 npm script: build:lab → daily 更新链的末端
//
// 数据源:
//   - data/views/<play>_wc_view.json            (2026)
//   - data/2022wc/views/<play>_wc_view.json     (2022)
//   - data/matches.json                          (2026 赛程 → stage/round/group)
//   - data/2022wc/id_map.json                    (2022 赛程 → stage/group/label→round)
//   - data/2022wc/results/<mid>.json             (2022 兜底: lottery.HAFU → bqc, lottery 交叉校验)
//
// 输出: data/lab_dataset.json
//   { generated_at, notes, y2026: { matches[], n }, y2022: { matches[], n } }
//   每场 schema:
//   {
//     t: 2026|2022, id, mid, stage, round, group, home, away, kickoff,
//     score: { ft: "h:a", ht: "h:a"|null },
//     odds:  { spf: {h,d,a}, rqspf: {h,d,a,handicap}, zjq: {0..6,7+}, bqc: {9 keys} },
//     res:   { spf: 'home'|'draw'|'away', rqspf, zjq, bqc, bf: {score, other} },
//     flags: { favSide, favOdds, favBand, rqspfSpread, zjqEV, goalAxis, archetype,
//              scenario, overround: {spf, rqspf, zjq, bqc} }
//   }
//
// 设计取舍:
//   - 不带 bf 31 格赔率（体积减半，v1 玩法 = spf/rqspf/zjq/bqc）
//   - 90 分钟口径 res：依赖 view 文件的结算（已剔除加时/点球污染）
//   - 5 场 2026 淘汰赛无 mid（M073, M093-M096）→ 排除并记 meta.notes

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

// ---------- helpers ----------
function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function safeDiv(a, b) { return b > 0 ? +(a / b).toFixed(4) : 0; }
function parseScore(s) {
  if (!s) return null;
  const m = /^(\d+)[:\-](\d+)$/.exec(String(s).trim());
  if (!m) return null;
  return { h: +m[1], a: +m[2] };
}
function spfFromScore(h, a) { return h > a ? 'home' : h < a ? 'away' : 'draw'; }
function rqspfFromScore(h, a, hdcp) {
  // 负让 = 主让 (hdcp < 0); 正让 = 主受让 (hdcp > 0)
  // 结算: 加上 hdcp 后比
  const adj = (h + hdcp) - a;
  if (adj > 0) return 'home';
  if (adj < 0) return 'away';
  return 'draw';
}
function bqcFromHalfFull(ht, ft) {
  if (!ht || !ft) return null;
  const half = spfFromScore(ht.h, ht.a);
  const full = spfFromScore(ft.h, ft.a);
  return { home: '胜', draw: '平', away: '负' }[half] + { home: '胜', draw: '平', away: '负' }[full];
}
function oddsFromJson(o) {
  // 2022 view 的 initial/last 块含 time 字段，去掉它
  if (!o) return null;
  const { time: _t, ...rest } = o;
  return rest;
}
function _impliedSum(odds) {
  return Object.values(odds).filter((v) => typeof v === 'number' && v > 0).reduce((s, v) => s + 1 / v, 0);
}
function overround(odds) {
  if (!odds) return null;
  const s = _impliedSum(odds);
  return s > 0 ? +s.toFixed(4) : null;
}

// ---------- 加载 5 玩法 view ----------
function loadViews(dir) {
  const out = {};
  for (const p of ['spf', 'rqspf', 'zjq', 'bqc', 'bf']) {
    const f = path.join(dir, `${p}_wc_view.json`);
    if (!fs.existsSync(f)) { out[p] = { rows: [] }; continue; }
    out[p] = loadJson(f);
  }
  return out;
}

// ---------- 2026 端：每场 mid → 行 + matches.json 补 stage/round/group ----------
function build2026() {
  const views = loadViews(path.join(PROJECT_ROOT, 'data', 'views'));
  const matches = loadJson(path.join(PROJECT_ROOT, 'data', 'matches.json'));

  // group 维度的 R1/R2/R3: 6 场一组，按 date 排序 0-1/2-3/4-5
  const groupRounds = {};  // group -> [{mid, idx}]
  for (const m of matches) {
    if (m.stage !== 'group' || !m.group || !m.date) continue;
    if (!groupRounds[m.group]) groupRounds[m.group] = [];
    groupRounds[m.group].push({ mid: m.mid, date: m.date, id: m.id });
  }
  for (const g of Object.keys(groupRounds)) {
    groupRounds[g].sort((a, b) => a.date.localeCompare(b.date));
    groupRounds[g].forEach((x, i) => { x.round = Math.floor(i / 2) + 1; });
  }

  // pre-cache 2026 group standings: 用 view 5 玩法 final_score + matches.json 的 group/date
  //   (不再读 matches.json.final_score 字段, 该字段大量缺失; view 兜底全)
  preCache2026Standings(matches, views, groupRounds);

  // 排除 mid 缺失的场（5 场 M073/M093-M096 + 任何 mid=null）
  const excluded = [];
  const midToMeta = {};   // mid → {id, stage, round, group, final_score, home, away, kickoff}
  for (const m of matches) {
    if (!m.mid) {
      excluded.push({ id: m.id, stage: m.stage, reason: 'mid null (sporttery 5 日窗口外)' });
      continue;
    }
    let round = null;
    if (m.stage === 'group' && m.group) {
      const arr = groupRounds[m.group] || [];
      const x = arr.find((y) => y.mid === m.mid);
      round = x ? x.round : null;
    }
    midToMeta[m.mid] = {
      id: m.id,
      stage: m.stage,
      round,
      group: m.group,
      final_score: m.final_score,
      home: m.home,
      away: m.away,
      kickoff: m.kickoff || m.date,
    };
  }

  // 按 mid 联表（5 玩法 + matches.json 补 stage/round/group）
  const mids = new Set();
  for (const play of ['spf', 'rqspf', 'zjq', 'bqc', 'bf']) {
    for (const r of (views[play]?.rows || [])) {
      if (r.mid) mids.add(r.mid);
    }
  }
  for (const mid of Object.keys(midToMeta)) mids.add(mid);

  const out = [];
  const seen = new Set();
  for (const mid of mids) {
    const meta = midToMeta[mid];
    if (!meta) continue; // view 有 mid 但 matches.json 没有 → 排除

    const spf = views.spf.rows.find((r) => r.mid === mid);
    const rqspf = views.rqspf.rows.find((r) => r.mid === mid);
    const zjq = views.zjq.rows.find((r) => r.mid === mid);
    const bqc = views.bqc.rows.find((r) => r.mid === mid);
    const bf = views.bf.rows.find((r) => r.mid === mid);

    // final_score 优先用 matches.json，没有再从 view 兜底
    let finalScore = meta.final_score;
    if (!finalScore) {
      const viewAny = spf || rqspf || zjq || bqc || bf;
      finalScore = viewAny?.final_score;
    }
    if (!finalScore) continue; // 还没完赛

    const ft = parseScore(finalScore);
    if (!ft) continue;

    const res = {
      spf: spf?.result || spfFromScore(ft.h, ft.a),
      rqspf: rqspf?.result || (rqspf ? rqspfFromScore(ft.h, ft.a, rqspf.last?.handicap ?? 0) : null),
      zjq: zjq?.result || String(ft.h + ft.a),
      bqc: bqc?.result || null,
      bf: bf?.result || { score: `${ft.h}:${ft.a}`, other: null },
    };
    // 强制重算 spf/rqspf/zjq（view 缺 result 时公式兜底，确保 90 分钟口径）
    res.spf = spfFromScore(ft.h, ft.a);
    if (rqspf) {
      const hdcp = rqspf.last?.handicap ?? rqspf.initial?.handicap ?? 0;
      res.rqspf = rqspfFromScore(ft.h, ft.a, hdcp);
    }
    res.zjq = String(ft.h + ft.a);

    const odds = {
      spf: spf ? oddsFromJson(spf.last) : null,
      rqspf: rqspf ? { ...(oddsFromJson(rqspf.last) || {}), handicap: rqspf.handicap ?? 0 } : null,
      zjq: zjq?.last?.odds || null,
      bqc: bqc?.last?.odds || null,
    };

    const flags = deriveFlags(odds, res, ft, { ...meta, t: 2026 });
    out.push({
      t: 2026,
      id: meta.id,
      mid,
      stage: meta.stage,
      round: meta.round,
      group: meta.group,
      home: meta.home,
      away: meta.away,
      kickoff: meta.kickoff,
      score: { ft: `${ft.h}:${ft.a}`, ht: null },
      odds,
      res,
      flags,
    });
    seen.add(mid);
  }
  out.sort((a, b) => String(a.kickoff || '').localeCompare(String(b.kickoff || '')));
  return { matches: out, excluded };
}

// ---------- 2022 端：view + id_map + results.lottery 兜底 + 交叉校验 ----------
function build2022() {
  const views = loadViews(path.join(PROJECT_ROOT, 'data', '2022wc', 'views'));
  const idMap = loadJson(path.join(PROJECT_ROOT, 'data', '2022wc', 'id_map.json'));
  const crossErrors = [];

  function resultFile(mid) {
    return path.join(PROJECT_ROOT, 'data', '2022wc', 'results', `${mid}.json`);
  }
  function loadResult(mid) {
    const f = resultFile(mid);
    if (!fs.existsSync(f)) return null;
    return loadJson(f);
  }

  // 交叉校验 + 兜底
  const out = [];
  for (const [mid, meta] of Object.entries(idMap.matches)) {
    if (!meta.full_time_score) continue;
    const ft = parseScore(meta.full_time_score);
    if (!ft) continue;

    const spf = views.spf.rows.find((r) => r.mid === mid);
    const rqspf = views.rqspf.rows.find((r) => r.mid === mid);
    const zjq = views.zjq.rows.find((r) => r.mid === mid);
    const bqc = views.bqc.rows.find((r) => r.mid === mid);
    const bf = views.bf.rows.find((r) => r.mid === mid);

    const resultDoc = loadResult(mid);
    const lottery = resultDoc?.lottery || null;

    // 校验 spf view vs lottery.HAD
    if (spf && lottery?.HAD?.combination) {
      const expected = lottery.HAD.combination === 'H' ? 'home' : lottery.HAD.combination === 'A' ? 'away' : 'draw';
      if (spf.result && spf.result !== expected) {
        crossErrors.push({ mid, field: 'spf', view: spf.result, lottery: expected });
      }
    }
    // 校验 rqspf view vs lottery.HHAD
    if (rqspf && lottery?.HHAD?.combination) {
      // HHAD 是 (让球方向 +1/-1 + 主客) 字符串如 "(+1)负" → 'A'; 我们用 ft + handicap 重算
      const hdcp = rqspf.handicap ?? 0;
      const expected = rqspfFromScore(ft.h, ft.a, hdcp);
      if (rqspf.result && rqspf.result !== expected) {
        crossErrors.push({ mid, field: 'rqspf', view: rqspf.result, lottery: expected, hdcp });
      }
    }
    // 校验 zjq view vs lottery.TTG
    if (zjq && lottery?.TTG?.combination) {
      if (zjq.result && zjq.result !== lottery.TTG.combination) {
        crossErrors.push({ mid, field: 'zjq', view: zjq.result, lottery: lottery.TTG.combination });
      }
    }

    // 兜底 bqc
    let bqcRes = bqc?.result;
    if (!bqcRes && lottery?.HAFU?.combinationDesc) {
      bqcRes = lottery.HAFU.combinationDesc;
    }
    if (!bqcRes && resultDoc?.halfTime) {
      // 极端兜底：用 halfTime + ft 推
      const ht = parseScore(resultDoc.halfTime);
      bqcRes = ht ? bqcFromHalfFull(ht, ft) : null;
    }

    // 重算 rqspf（view 缺 result 时）
    let rqspfRes = rqspf?.result;
    if (!rqspfRes && rqspf) {
      const hdcp = rqspf.handicap ?? 0;
      rqspfRes = rqspfFromScore(ft.h, ft.a, hdcp);
    }

    const res = {
      spf: spf?.result || spfFromScore(ft.h, ft.a),
      rqspf: rqspfRes,
      zjq: zjq?.result || String(ft.h + ft.a),
      bqc: bqcRes,
      bf: bf?.result || { score: `${ft.h}:${ft.a}`, other: null },
    };

    const odds = {
      spf: spf ? oddsFromJson(spf.last) : null,
      rqspf: rqspf ? { ...(oddsFromJson(rqspf.last) || {}), handicap: rqspf.handicap ?? 0 } : null,
      zjq: zjq?.last?.odds || null,
      bqc: bqc?.last?.odds || null,
    };

    const stage = meta.stage;
    const round = stage === 'group' ? rndFromLabel(meta.label) : null;
    const flags = deriveFlags(odds, res, ft, { t: 2022, stage, round, group: meta.group, home: meta.home, away: meta.away });
    out.push({
      t: 2022,
      id: meta.label,
      mid,
      stage,
      round,
      group: meta.group,
      home: meta.home,
      away: meta.away,
      kickoff: meta.kickoff,
      score: { ft: `${ft.h}:${ft.a}`, ht: resultDoc?.halfTime ? String(resultDoc.halfTime).replace('-', ':') : null },
      odds,
      res,
      flags,
    });
  }
  if (crossErrors.length) {
    console.error('[build_lab] ❌ 2022 交叉校验失败:');
    for (const e of crossErrors.slice(0, 20)) console.error('  ', JSON.stringify(e));
    throw new Error(`2022 交叉校验失败 ${crossErrors.length} 条`);
  }
  out.sort((a, b) => String(a.kickoff || '').localeCompare(String(b.kickoff || '')));
  return { matches: out, excluded: [] };
}

function rndFromLabel(label) {
  // '2022-A5' → A5 → 5 → (5-1)//2+1 = 3
  const m = /-([A-Z]\d+)$/.exec(label);
  if (!m) return null;
  const n = +m[1].slice(1);
  return Math.floor((n - 1) / 2) + 1;
}

// ---------- 标志位派生 ----------
function pickFav(odds) {
  if (!odds) return null;
  const trip = [['home', odds.home], ['draw', odds.draw], ['away', odds.away]]
    .filter(([, v]) => typeof v === 'number');
  if (trip.length !== 3) return null;
  trip.sort((a, b) => a[1] - b[1]);
  const side = trip[0][0];
  const o = trip[0][1];
  return { side, odds: o, band: o < 1.5 ? 'favStrong' : o < 2.2 ? 'favMed' : 'favWeak' };
}

function deriveFlags(odds, res, ft, meta) {
  // spf 热门
  const spfFav = pickFav(odds.spf);
  // rqspf 热门
  const rqspfFav = pickFav(odds.rqspf);
  // 默认 favSide / favOdds 用 spf（向后兼容）
  const favSide = spfFav?.side ?? rqspfFav?.side ?? null;
  const favOdds = spfFav?.odds ?? rqspfFav?.odds ?? null;
  const favBand = spfFav?.band ?? rqspfFav?.band ?? null;
  // rqspfSpread
  let rqspfSpread = null;
  if (odds.rqspf) {
    const vals = [odds.rqspf.home, odds.rqspf.draw, odds.rqspf.away].filter((v) => typeof v === 'number');
    if (vals.length === 3) rqspfSpread = +((Math.max(...vals) - Math.min(...vals))).toFixed(2);
  }
  // zjqEV: 隐含期望进球 = Σ k * (1/odds_k) / Σ (1/odds_k)
  let zjqEV = null;
  if (odds.zjq) {
    const probSum = Object.values(odds.zjq).filter((v) => typeof v === 'number').reduce((s, v) => s + 1 / v, 0);
    const evSum = Object.entries(odds.zjq).reduce((s, [k, v]) => {
      if (typeof v !== 'number') return s;
      const n = k === '7+' ? 7.5 : +k;
      return s + n * (1 / v);
    }, 0);
    zjqEV = probSum > 0 ? +(evSum / probSum).toFixed(2) : null;
  }
  // goalAxis: 偏大(≥2.8) / 偏小(≤2.2) / 居中
  let goalAxis = null;
  if (zjqEV != null) goalAxis = zjqEV >= 2.8 ? 'bigBall' : zjqEV <= 2.2 ? 'smallBall' : 'midBall';
  // archetype: 强弱轴×进球轴
  let archetype = null;
  if (favBand && goalAxis) {
    const strong = favBand === 'favStrong' || favBand === 'favMed';
    const ball = goalAxis === 'bigBall' ? 'big' : goalAxis === 'smallBall' ? 'small' : 'mid';
    archetype = `${strong ? 'strong' : 'weak'}_${ball}`;
  }
  // scenario: 仅 R2/R3 算
  const scenario = meta.round && meta.round >= 2
    ? (meta.t === 2026 ? computeScenario2026(meta) : computeScenario2022(meta))
    : null;
  // overround
  const overR = {
    spf: odds.spf ? overround(odds.spf) : null,
    rqspf: odds.rqspf ? overround({ h: odds.rqspf.home, d: odds.rqspf.draw, a: odds.rqspf.away }) : null,
    zjq: odds.zjq ? overround(odds.zjq) : null,
    bqc: odds.bqc ? overround(odds.bqc) : null,
  };
  return { favSide, favOdds, favBand, rqspfFavSide: rqspfFav?.side ?? null, rqspfFavOdds: rqspfFav?.odds ?? null, rqspfSpread, zjqEV, goalAxis, archetype, scenario, overround: overR };
}

// 2022 scenario 复刻 points_mentality_2022.py 的逻辑（仅 R2/R3 算）
const _2022Standings = { cache: null };
function getStandings2022() {
  if (_2022Standings.cache) return _2022Standings.cache;
  const idMap = loadJson(path.join(PROJECT_ROOT, 'data', '2022wc', 'id_map.json')).matches;
  // build per group: round → standings
  const groups = {};
  for (const [mid, m] of Object.entries(idMap)) {
    if (m.stage !== 'group' || !m.full_time_score) continue;
    const ft = parseScore(m.full_time_score);
    if (!ft) continue;
    const r = rndFromLabel(m.label);
    groups[m.group] = groups[m.group] || { teams: new Set(), rounds: {} };
    const g = groups[m.group];
    g.teams.add(m.home); g.teams.add(m.away);
    g.rounds[r] = g.rounds[r] || [];
    g.rounds[r].push({ mid, r, h: m.home, a: m.away, hg: ft.h, ag: ft.a });
  }
  _2022Standings.cache = groups;
  return groups;
}
function computeScenario2022(meta) {
  if (!meta.group || !meta.round || meta.round < 2) return null;
  const groups = getStandings2022();
  const g = groups[meta.group];
  if (!g) return null;
  // 算 meta.round 之前各队积分（修 P1-7: 客胜用 ag > hg 而非 ag > h，h 是队名字符串）
  const pts = {};
  const gd = {};
  for (const t of g.teams) { pts[t] = 0; gd[t] = 0; }
  for (let r = 1; r < meta.round; r++) {
    for (const m of (g.rounds[r] || [])) {
      if (m.hg > m.ag) { pts[m.h] += 3; gd[m.h] += m.hg - m.ag; gd[m.a] += m.ag - m.hg; }
      else if (m.ag > m.hg) { pts[m.a] += 3; gd[m.a] += m.ag - m.hg; gd[m.h] += m.hg - m.ag; }
      else { pts[m.h] += 1; pts[m.a] += 1; }
    }
  }
  const ph = pts[meta.home] ?? 0;
  const pa = pts[meta.away] ?? 0;
  const hi = Math.max(ph, pa), lo = Math.min(ph, pa);
  if (meta.round === 3) {
    if (hi >= 4 && lo <= 1) return 'rest_vs_out';
    if (hi >= 4 && lo <= 3) return 'rest_vs_mid';
    if (ph === pa && [1, 2, 3, 4].includes(ph)) return 'same_pts_battle';
    return 'other_r3';
  }
  if (meta.round === 2) {
    if (hi === 3 && lo === 0) return 'win_vs_loss';
    if (ph === 0 && pa === 0) return 'both_lost_r2';
    return 'other_r2';
  }
  return null;
}

// 2026 standings: 直接用 build 阶段已联好的 lab 小组赛数据 (与 2022 同构)
//   缓存由 preCache2026Standings() 在 build2026() 顶部填入——按 m.group 聚合,
//   用 view 5 玩法 final_score (90 分钟比分) + matches.json 的 group/date/round 派生建积分表。
//   修复轮次错位 (第三轮, 2026-07-08): 不再读 data/matches.json.final_score
//   —— 该文件大量已完赛小组赛缺比分 (E 组 6 场全缺), 且
//   原实现按"有比分子集"重编 round 还会把 R3 当 R1。
const _2026GroupRounds = { cache: null };

// preCache 阶段：view.final_score 兜底 + groupRounds 派生 round (与 build2026 同源)
function preCache2026Standings(matches, views, groupRounds) {
  // 1) 收集每场有比分的小组赛
  const byMid = new Map();
  // view 5 玩法 row 含 final_score，先按 mid 索引
  const viewFinalScore = (mid) => {
    for (const play of ['spf', 'rqspf', 'zjq', 'bqc', 'bf']) {
      const r = (views[play]?.rows || []).find((x) => x.mid === mid);
      if (r?.final_score) return r.final_score;
    }
    return null;
  };
  for (const m of matches) {
    if (m.stage !== 'group' || !m.group || !m.date) continue;
    const final = m.final_score || viewFinalScore(m.mid);
    if (!final) continue;
    const ft = parseScore(final);
    if (!ft) continue;
    byMid.set(m.mid, { mid: m.mid, group: m.group, date: m.date, home: m.home, away: m.away, hg: ft.h, ag: ft.a });
  }
  // 2) 套用 build2026 已派生的 groupRounds (round 字段已存在, 不再按"有比分子集"重编)
  const groups = {};
  for (const [g, arr] of Object.entries(groupRounds)) {
    for (const x of arr) {
      const r = byMid.get(x.mid);
      if (!r) continue;
      if (!groups[g]) groups[g] = { teams: new Set(), rounds: {} };
      const gg = groups[g];
      gg.teams.add(r.home); gg.teams.add(r.away);
      gg.rounds[x.round] = gg.rounds[x.round] || [];
      gg.rounds[x.round].push({ mid: r.mid, r: x.round, h: r.home, a: r.away, hg: r.hg, ag: r.ag });
    }
  }
  _2026GroupRounds.cache = groups;
}
function getStandings2026() {
  if (!_2026GroupRounds.cache) {
    throw new Error('getStandings2026 called before set2026GroupRounds. build2026() must call set2026GroupRounds() before deriveFlags.');
  }
  return _2026GroupRounds.cache;
}
function computeScenario2026(meta) {
  if (!meta.group || !meta.round || meta.round < 2) return null;
  const groups = getStandings2026();
  const g = groups[meta.group];
  if (!g) return null;
  // 算 meta.round 之前各队积分（与 2022 同构）
  const pts = {};
  for (const t of g.teams) { pts[t] = 0; }
  for (let r = 1; r < meta.round; r++) {
    for (const m of (g.rounds[r] || [])) {
      if (m.hg > m.ag) pts[m.h] += 3;
      else if (m.ag > m.hg) pts[m.a] += 3;
      else { pts[m.h] += 1; pts[m.a] += 1; }
    }
  }
  const ph = pts[meta.home] ?? 0;
  const pa = pts[meta.away] ?? 0;
  const hi = Math.max(ph, pa), lo = Math.min(ph, pa);
  if (meta.round === 3) {
    if (hi >= 4 && lo <= 1) return 'rest_vs_out';
    if (hi >= 4 && lo <= 3) return 'rest_vs_mid';
    if (ph === pa && [1, 2, 3, 4].includes(ph)) return 'same_pts_battle';
    return 'other_r3';
  }
  if (meta.round === 2) {
    if (hi === 3 && lo === 0) return 'win_vs_loss';
    if (ph === 0 && pa === 0) return 'both_lost_r2';
    return 'other_r2';
  }
  return null;
}

// ---------- main ----------
function main() {
  const y2026 = build2026();
  const y2022 = build2022();

  // 统计
  const n2026 = y2026.matches.length;
  const n2022 = y2022.matches.length;
  const scenarioCounts2022 = {};
  for (const m of y2022.matches) {
    const s = m.flags.scenario || '_';
    scenarioCounts2022[s] = (scenarioCounts2022[s] || 0) + 1;
  }
  const scenarioCounts2026 = {};
  for (const m of y2026.matches) {
    const s = m.flags.scenario || '_';
    scenarioCounts2026[s] = (scenarioCounts2026[s] || 0) + 1;
  }
  const roundCounts2022 = { R1: 0, R2: 0, R3: 0, K: 0 };
  for (const m of y2022.matches) {
    if (m.stage !== 'group') roundCounts2022.K++;
    else if (m.round === 1) roundCounts2022.R1++;
    else if (m.round === 2) roundCounts2022.R2++;
    else if (m.round === 3) roundCounts2022.R3++;
  }
  const roundCounts2026 = { R1: 0, R2: 0, R3: 0, K: 0 };
  for (const m of y2026.matches) {
    if (m.stage !== 'group') roundCounts2026.K++;
    else if (m.round === 1) roundCounts2026.R1++;
    else if (m.round === 2) roundCounts2026.R2++;
    else if (m.round === 3) roundCounts2026.R3++;
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source: 'data/views + data/2022wc/views + data/matches.json + data/2022wc/id_map.json + data/2022wc/results',
    notes: {
      y2026: {
        excluded: y2026.excluded,
        excluded_reason: 'mid 缺失（5 日窗口外）',
        no_spf_odds: y2026.matches.filter((m) => !m.odds.spf).length,
      },
      y2022: {
        excluded: [],
        no_spf_odds: y2022.matches.filter((m) => !m.odds.spf).length,
        no_bqc_result: y2022.matches.filter((m) => !m.res.bqc).length,
      },
    },
    y2026: { matches: y2026.matches, n: n2026, rounds: roundCounts2026, scenario_counts: scenarioCounts2026 },
    y2022: { matches: y2022.matches, n: n2022, rounds: roundCounts2022, scenario_counts: scenarioCounts2022 },
  };

  const outFile = path.join(PROJECT_ROOT, 'data', 'lab_dataset.json');
  fs.writeFileSync(outFile, JSON.stringify(payload), 'utf-8');

  // 控制台摘要
  console.log('[build_lab] 已写入', path.relative(PROJECT_ROOT, outFile));
  console.log(`  y2026: ${n2026} 场  R1/R2/R3/KO = ${roundCounts2026.R1}/${roundCounts2026.R2}/${roundCounts2026.R3}/${roundCounts2026.K}`);
  console.log(`  y2022: ${n2022} 场  R1/R2/R3/KO = ${roundCounts2022.R1}/${roundCounts2022.R2}/${roundCounts2022.R3}/${roundCounts2022.K}`);
  console.log(`  y2026 排除场: ${y2026.excluded.length} 场 → ${y2026.excluded.map((e) => e.id).join(', ') || '(无)'}`);
  console.log(`  y2022 缺 spf odds: ${payload.notes.y2022.no_spf_odds}, 缺 bqc result: ${payload.notes.y2022.no_bqc_result}`);
  console.log('  y2022 scenario counts:');
  for (const [k, v] of Object.entries(scenarioCounts2022)) console.log(`    ${k.padEnd(18)} ${v}`);
  console.log('  y2026 scenario counts:');
  for (const [k, v] of Object.entries(scenarioCounts2026)) console.log(`    ${k.padEnd(18)} ${v}`);
  // 验证 sanity：90 分钟口径
  const m087 = y2026.matches.find((m) => m.mid === '2040348');
  if (m087) console.log(`  sanity: 2040348 (ARG vs CPV) res.spf=${m087.res.spf} (期望 draw, 90min 1-1)`);
  const m001 = y2026.matches.find((m) => m.mid === '2040162');
  if (m001) console.log(`  sanity: 2040162 (MEX vs RSA, 2:0) handicap=${m001.odds.rqspf?.handicap} res.rqspf=${m001.res.rqspf} (期望 home)`);
}

main();
