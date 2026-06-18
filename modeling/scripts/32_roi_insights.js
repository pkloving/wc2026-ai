#!/usr/bin/env node
// 32_roi_insights.js — 基于已完赛汇总 data/settled_matches.json 提炼高 ROI 规律
// 用法:
//   node modeling/scripts/32_roi_insights.js                  # 跑一次, 输出建模信号
//   node modeling/scripts/32_roi_insights.js --quiet           # 不打控制台摘要
//
// 输出:
//   modeling/artifacts/roi_insights.json                       # 31_tight_anti_value.js 会读
//   控制台: 关键规律 + TOP 建议
//
// 设计原则:
//   - 样本量小(世界杯正赛 ~26 场), 不做复杂模型, 只做"按规则分桶的命中率 + ROI"
//   - 所有"建议"都是事实陈述 + 命中率 + 命中次数, 不做阈值过滤
//   - 没有命中过的桶也要输出(样本不足 warning)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SETTLED_FILE = path.join(PROJECT_ROOT, 'data', 'settled_matches.json');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'modeling', 'artifacts');
const OUTPUT_FILE = path.join(ARTIFACTS_DIR, 'roi_insights.json');

const QUIET = process.argv.includes('--quiet');

// ============== 工具 ==============
function bucket(v, edges) {
  // edges: [[lo, hi, name], ...]   (lo 闭, hi 开)
  for (const [lo, hi, name] of edges) {
    if (v >= lo && v < hi) return name;
  }
  return edges[edges.length - 1][2];
}
function pct(num, den) { return den > 0 ? +(num / den * 100).toFixed(1) : null; }
function roi(hit, total, sumOdds) {
  // 假设每个候选下注 1 元, ROI = (总回报 - 总投入) / 总投入
  if (total === 0) return null;
  return +((sumOdds - total) / total * 100).toFixed(1);
}
function fmtPct(x) { return x === null || x === undefined ? '-' : `${x}%`; }
function warnSmall(n) { return n < 5 ? '⚠️样本<5' : ''; }

// ============== classifyMatch 复刻 (与 31_tight_anti_value.js 同步, 动态加载 data/teams) ==============
// 用于按"比赛类型"拆 ROI 子样本
// 单一数据源: data/teams/_index.json (by_tier 分类) + data/teams/<CODE>.json (meta.has_scorer_star)
import fs_32 from 'node:fs';
import path_32 from 'node:path';
import { fileURLToPath as fileURLToPath_32 } from 'node:url';
const __dirname_32 = path_32.dirname(fileURLToPath_32(import.meta.url));
const PROJECT_ROOT_32 = path_32.join(__dirname_32, '..', '..');
const TEAMS_INDEX_FILE_32 = path_32.join(PROJECT_ROOT_32, 'data', 'teams', '_index.json');

function loadTeams_32() {
  const idx = JSON.parse(fs_32.readFileSync(TEAMS_INDEX_FILE_32, 'utf-8'));
  const codeByTier = idx.by_tier || {};
  const tierOfCode = {};
  for (const [tier, codes] of Object.entries(codeByTier)) {
    for (const c of codes) tierOfCode[c] = tier;
  }
  const codeByName = idx.by_name || {};
  const variants = idx.name_variants_to_code || {};
  const nameToCode = { ...codeByName, ...variants };
  const scorerStarCodes = new Set();
  const nameToTier = {};
  for (const [code, rel] of Object.entries(idx.by_code || {})) {
    try {
      const t = JSON.parse(fs_32.readFileSync(path_32.join(PROJECT_ROOT_32, 'data', rel), 'utf-8'));
      if (t.meta?.has_scorer_star === true) scorerStarCodes.add(code);
      if (t.name && tierOfCode[code]) nameToTier[t.name] = tierOfCode[code];
    } catch (e) {}
  }
  for (const [alias, code] of Object.entries(variants)) {
    if (tierOfCode[code]) nameToTier[alias] = tierOfCode[code];
  }
  return { tierOfCode, nameToCode, nameToTier, scorerStarCodes };
}
const TEAMS_32 = loadTeams_32();
function codeOf32(teamName) { return teamName ? TEAMS_32.nameToCode[teamName] || null : null; }
function getTeamTier32(team) {
  const code = codeOf32(team);
  if (code) return TEAMS_32.tierOfCode[code] || 'unknown';
  return TEAMS_32.nameToTier[team] || 'unknown';
}
function hasScorerStar32(team) {
  const code = codeOf32(team);
  if (code) return TEAMS_32.scorerStarCodes.has(code);
  return false;
}
function classifyMatch32(m) {
  // m.handicap 来自 settled_matches.json (顶层)
  const hc = m.handicap ?? 0;
  const hTier = getTeamTier32(m.home), aTier = getTeamTier32(m.away);
  const homeHasStar = hasScorerStar32(m.home), awayHasStar = hasScorerStar32(m.away);
  const bigHandicap = Math.abs(hc) >= 2;
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

// ============== 加载赛果汇总 ==============
if (!fs.existsSync(SETTLED_FILE)) {
  console.error(`[32_roi_insights] 找不到 ${SETTLED_FILE}, 请先跑 scripts/build_settled.js`);
  process.exit(0);
}
const settledDoc = JSON.parse(fs.readFileSync(SETTLED_FILE, 'utf-8'));
let matches = settledDoc.matches || [];
let originalMatches = matches;  // 用于 WC only 跑完恢复
const N = matches.length;
if (N === 0) {
  console.error(`[32_roi_insights] ${SETTLED_FILE} 还没有完赛比赛, 跳过`);
  process.exit(0);
}

// ============== 1. SPF 按主胜赔率区间 ==============
function analyzeSpf() {
  const edges = [[0, 1.5, '<1.5'], [1.5, 2.5, '1.5-2.5'], [2.5, 5, '2.5-5'], [5, 100, '5+']];
  const buckets = {};
  for (const [lo, hi, name] of edges) {
    buckets[name] = { n: 0, home: 0, draw: 0, away: 0, null_result: 0 };
  }
  for (const m of matches) {
    const spf = m.spf || {};
    if (!spf.initial || !spf.result) continue;
    const homeOdds = spf.initial.home;
    const r = spf.result;
    const name = bucket(homeOdds, edges);
    buckets[name].n++;
    if (r === 'home') buckets[name].home++;
    else if (r === 'draw') buckets[name].draw++;
    else if (r === 'away') buckets[name].away++;
    else buckets[name].null_result++;
  }
  const out = {};
  for (const [name, b] of Object.entries(buckets)) {
    if (b.n === 0) { out[name] = { ...b, home_rate: null, draw_rate: null, away_rate: null }; continue; }
    out[name] = {
      ...b,
      home_rate: pct(b.home, b.n),
      draw_rate: pct(b.draw, b.n),
      away_rate: pct(b.away, b.n),
    };
  }
  return out;
}

// ============== 2. BF 比分: 模拟"每场选 N 个候选"规则 ==============
// 关键: 不再按候选粒度摊开算命中率 (那样没意义, 因为不可能每场买30个比分赌1个中)
// 改成: 每场模拟一种选号规则, 整场只算 1 次 (命中 or 不中, 回报 = 命中的赔率)
// 多个规则并行, 哪个 ROI 高直接看

// 把 oddsMap 转成 [{score, odds, home, away, total, isOther}]
function bfCandidates(oddsMap) {
  const out = [];
  for (const [k, o] of Object.entries(oddsMap || {})) {
    if (!o || o <= 1) continue;
    if (k === '胜其它' || k === '负其它' || k === '平其它') {
      // other 字段保持与 settled_matches.bf.result.other 同名 (如 "胜其它")
      out.push({ key: k, odds: o, isOther: true, other: k, home: null, away: null, total: null });
    } else {
      const parts = k.split(':');
      out.push({ key: k, odds: o, isOther: false, home: Number(parts[0]), away: Number(parts[1]), total: Number(parts[0]) + Number(parts[1]) });
    }
  }
  return out;
}

function isHit(c, bfResult) {
  if (c.isOther) {
    return c.other === bfResult.other && bfResult.other !== null;
  }
  // settled_matches 里 bf.result.score 是 "1:1" (无前导零), 但 bf.initial.odds 的 key 是 "01:01"
  // 规范化后再比较
  const norm = (s) => s.split(':').map(p => String(Number(p))).join(':');
  return norm(c.key) === norm(bfResult.score) && bfResult.other === null;
}

// 模拟"每场按规则选 K 个候选" 的 ROI
function simRule(matches, ruleName, pickFn) {
  // pickFn(candidates, m) → [c1, c2, ...] 选中要买的候选
  // 整场算: 命中 = 至少 1 个命中, 回报 = 命中的最高赔率 (保守口径)
  let n = 0, hit = 0, sumReturn = 0, sumCost = 0, sumOddsAll = 0;
  for (const m of matches) {
    const bf = m.bf || {};
    if (!bf.initial || !bf.initial.odds || !bf.result) continue;
    const cands = bfCandidates(bf.initial.odds);
    if (cands.length === 0) continue;
    const picks = pickFn(cands, m);
    if (picks.length === 0) continue;
    n++;
    sumCost += picks.length;
    const actualResult = bf.result;
    const hitOne = picks.find(p => isHit(p, actualResult));
    if (hitOne) {
      hit++;
      sumReturn += hitOne.odds;
    }
    sumOddsAll += picks.reduce((s, p) => s + p.odds, 0);
  }
  return {
    rule: ruleName,
    n,
    hit,
    hit_rate: pct(hit, n),
    cost: sumCost,
    return: +sumReturn.toFixed(2),
    roi: roi(hit, sumCost, sumReturn),
    avg_odds_hit: hit > 0 ? +(sumReturn / hit).toFixed(2) : null,
    small: warnSmall(n),
  };
}

function analyzeBf() {
  // 多种规则并行
  const rules = [];

  // R1: 每场 1 个最低赔率 (低赔率稳健)
  rules.push(simRule(matches, '每场1个最低赔率', (cands) => {
    const sorted = cands.slice().sort((a, b) => a.odds - b.odds);
    return sorted.slice(0, 1);
  }));

  // R2: 每场 3 个最低赔率 (低赔率稳健)
  rules.push(simRule(matches, '每场3个最低赔率', (cands) => {
    const sorted = cands.slice().sort((a, b) => a.odds - b.odds);
    return sorted.slice(0, 3);
  }));

  // R3: 每场 1 个最高赔率 (赌冷)
  rules.push(simRule(matches, '每场1个最高赔率', (cands) => {
    const sorted = cands.slice().sort((a, b) => b.odds - a.odds);
    return sorted.slice(0, 1);
  }));

  // R4: 每场 3 个最高赔率
  rules.push(simRule(matches, '每场3个最高赔率', (cands) => {
    const sorted = cands.slice().sort((a, b) => b.odds - a.odds);
    return sorted.slice(0, 3);
  }));

  // R5: 跟 handicap 方向, 1 个最低赔率
  rules.push(simRule(matches, '跟盘方向1个最低赔率', (cands, m) => {
    const dir = m.handicap <= 0 ? 'home' : 'away';
    const dirCands = cands.filter(c => {
      if (c.isOther) return false;
      return dir === 'home' ? c.home >= c.away : c.away >= c.home;
    });
    if (dirCands.length === 0) return [];
    const sorted = dirCands.slice().sort((a, b) => a.odds - b.odds);
    return sorted.slice(0, 1);
  }));

  // R6: 跟 handicap 方向, 3 个最低赔率
  rules.push(simRule(matches, '跟盘方向3个最低赔率', (cands, m) => {
    const dir = m.handicap <= 0 ? 'home' : 'away';
    const dirCands = cands.filter(c => {
      if (c.isOther) return false;
      return dir === 'home' ? c.home >= c.away : c.away >= c.home;
    });
    if (dirCands.length === 0) return [];
    const sorted = dirCands.slice().sort((a, b) => a.odds - b.odds);
    return sorted.slice(0, 3);
  }));

  // R7: 反方向 1 个高赔率 (单关爆冷)
  rules.push(simRule(matches, '反方向1个最高赔率(25-65)', (cands, m) => {
    const dir = m.handicap <= 0 ? 'home' : 'away';
    const antiCands = cands.filter(c => {
      if (c.isOther) return false;
      if (c.total < 1 || c.total > 6) return false;
      if (c.odds < 25 || c.odds > 65) return false;
      return dir === 'home' ? c.home < c.away : c.away < c.home;
    });
    if (antiCands.length === 0) return [];
    const sorted = antiCands.slice().sort((a, b) => a.odds - b.odds);
    return sorted.slice(0, 1);
  }));

  // R8: 反方向 2 个高赔率
  rules.push(simRule(matches, '反方向2个高赔率(25-65)', (cands, m) => {
    const dir = m.handicap <= 0 ? 'home' : 'away';
    const antiCands = cands.filter(c => {
      if (c.isOther) return false;
      if (c.total < 1 || c.total > 6) return false;
      if (c.odds < 25 || c.odds > 65) return false;
      return dir === 'home' ? c.home < c.away : c.away < c.home;
    });
    if (antiCands.length === 0) return [];
    const sorted = antiCands.slice().sort((a, b) => a.odds - b.odds);
    return sorted.slice(0, 2);
  }));

  // R9: 比分按总进球分桶命中 (用于校验哪些总进球区间最容易"中")
  const totalEdges = [[0, 2, '0-1'], [2, 4, '2-3'], [4, 6, '4-5'], [6, 100, '6+']];
  const totalBuckets = {};
  for (const [, , name] of totalEdges) totalBuckets[name] = { n: 0, actual_in: 0 };
  for (const m of matches) {
    const bf = m.bf || {};
    if (!bf.result) continue;
    const home = m.result?.home, away = m.result?.away;
    if (home === undefined || away === undefined) continue;
    const t = home + away;
    const name = bucket(t, totalEdges);
    totalBuckets[name].n++;
    totalBuckets[name].actual_in++;
  }
  const totalOut = {};
  for (const [name, b] of Object.entries(totalBuckets)) {
    totalOut[name] = { ...b, rate: pct(b.actual_in, b.n), small: warnSmall(b.n) };
  }

  return { rules, total_distribution: totalOut };
}

// ============== 3. 单关策略: 多种规则模拟 ==============
function analyzeSingleBet() {
  // 跟 31 的 singleBetStrategy 一致, 但拆开看哪条 ROI 最高
  const rules = [];

  // S1: 反方向 25-65, 1 个最低赔率
  rules.push(simRule(matches, '单关: 反方向1个25-65', (cands, m) => {
    const dir = m.handicap <= 0 ? 'home' : 'away';
    const antiCands = cands.filter(c => {
      if (c.isOther) return false;
      if (c.total < 1 || c.total > 6) return false;
      if (c.odds < 25 || c.odds > 65) return false;
      return dir === 'home' ? c.home < c.away : c.away < c.home;
    });
    if (antiCands.length === 0) return [];
    return antiCands.slice().sort((a, b) => a.odds - b.odds).slice(0, 1);
  }));

  // S2: 反方向 25-65, 2 个最低赔率
  rules.push(simRule(matches, '单关: 反方向2个25-65', (cands, m) => {
    const dir = m.handicap <= 0 ? 'home' : 'away';
    const antiCands = cands.filter(c => {
      if (c.isOther) return false;
      if (c.total < 1 || c.total > 6) return false;
      if (c.odds < 25 || c.odds > 65) return false;
      return dir === 'home' ? c.home < c.away : c.away < c.home;
    });
    if (antiCands.length === 0) return [];
    return antiCands.slice().sort((a, b) => a.odds - b.odds).slice(0, 2);
  }));

  // S3: 任意方向 1 个 25-50 最低赔率
  rules.push(simRule(matches, '单关: 任意1个25-50', (cands) => {
    const pool = cands.filter(c => !c.isOther && c.total >= 1 && c.total <= 4 && c.odds >= 25 && c.odds <= 50);
    if (pool.length === 0) return [];
    return pool.slice().sort((a, b) => a.odds - b.odds).slice(0, 1);
  }));

  // S4: 任意方向 2 个 25-50 最低赔率
  rules.push(simRule(matches, '单关: 任意2个25-50', (cands) => {
    const pool = cands.filter(c => !c.isOther && c.total >= 1 && c.total <= 4 && c.odds >= 25 && c.odds <= 50);
    if (pool.length === 0) return [];
    return pool.slice().sort((a, b) => a.odds - b.odds).slice(0, 2);
  }));

  return rules;
}

// ============== 4. 赔率漂移: initial→last ==============
function analyzeDrift() {
  // 对 spf 而言, 主胜赔率下降 = 庄家看好主胜, 看命中率
  // 用 spf 比较
  const buckets = {
    home_drop: { n: 0, hit: 0, sum_odds: 0 },  // last.home < initial.home
    home_rise: { n: 0, hit: 0, sum_odds: 0 },
    home_flat: { n: 0, hit: 0, sum_odds: 0 },
  };
  for (const m of matches) {
    const spf = m.spf || {};
    if (!spf.initial || !spf.last || !spf.result) continue;
    const i = spf.initial.home, l = spf.last.home;
    const r = spf.result;
    let key;
    if (l < i - 0.02) key = 'home_drop';
    else if (l > i + 0.02) key = 'home_rise';
    else key = 'home_flat';
    buckets[key].n++;
    if (r === 'home') { buckets[key].hit++; buckets[key].sum_odds += l; }
  }
  const out = {};
  for (const [name, b] of Object.entries(buckets)) {
    out[name] = {
      ...b,
      home_rate: pct(b.hit, b.n),
      roi: roi(b.hit, b.n, b.sum_odds),
      small: warnSmall(b.n),
    };
  }
  return out;
}

// ============== 5. handicap × 比分方向 ==============
function analyzeHandicap() {
  // 按 |handicap| 分桶, 看 rqspf 三个方向命中率
  const edges = [[0, 1, '平手'], [1, 2, '让1球'], [2, 3, '让2球'], [3, 100, '让3球+']];
  const buckets = {};
  for (const [, , name] of edges) {
    buckets[name] = { n: 0, home: 0, draw: 0, away: 0 };
  }
  for (const m of matches) {
    const rqspf = m.rqspf || {};
    if (!rqspf.result || m.handicap === null || m.handicap === undefined) continue;
    const hc = Math.abs(m.handicap);
    const name = bucket(hc, edges);
    buckets[name].n++;
    if (rqspf.result === 'home') buckets[name].home++;
    else if (rqspf.result === 'draw') buckets[name].draw++;
    else if (rqspf.result === 'away') buckets[name].away++;
  }
  const out = {};
  for (const [name, b] of Object.entries(buckets)) {
    if (b.n === 0) { out[name] = { ...b, home_rate: null, draw_rate: null, away_rate: null, small: '' }; continue; }
    out[name] = {
      ...b,
      home_rate: pct(b.home, b.n),
      draw_rate: pct(b.draw, b.n),
      away_rate: pct(b.away, b.n),
      small: warnSmall(b.n),
    };
  }
  return out;
}

// ============== 7. RQSPF 规则模拟 ==============
function analyzeRqspf() {
  // 复用 simRule 框架，pickFn → [direction], hit = picks.includes(actualResult)
  // 候选方向: 'home', 'draw', 'away' (而不是比分候选)
  function rqsim(name, pickFn) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0, sumOddsAll = 0;
    for (const m of matches) {
      const rq = m.rqspf || {};
      if (!rq.initial || !rq.result || !rq.last) continue;
      const picks = pickFn(rq, m);
      if (picks.length === 0) continue;
      n++;
      cost += picks.length;
      const actual = rq.result;
      const hitPick = picks.find(d => d === actual);
      if (hitPick) {
        // 赔率用 last 的对应方向赔率
        hit++;
        const odds = rq.last[hitPick] || 1;
        sumOddsHit += odds;
        sumOddsAll += odds;
      } else {
        sumOddsAll += picks.reduce((s, d) => s + (rq.last[d] || 1), 0);
      }
    }
    return {
      rule: name,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      small: warnSmall(n),
    };
  }

  // 固定买某些方向的 ROI
  function rqFixedSim(name, dirs) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
    for (const m of matches) {
      const rq = m.rqspf || {};
      if (!rq.initial || !rq.result || !rq.last) continue;
      if (dirs.some(d => !(rq.initial[d] ?? 0) > 1)) continue;
      n++; cost += dirs.length;
      if (dirs.includes(rq.result)) {
        hit++;
        sumOddsHit += rq.last[rq.result] || 1;
      }
    }
    return {
      rule: name,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      small: warnSmall(n),
    };
  }

  // 固定买 + 赔率过滤 (纠偏)
  // filterFn(rq, m) -> bool: true=本场要买, false=跳过
  function rqOddsFiltered(name, dirs, filterFn) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
    for (const m of matches) {
      const rq = m.rqspf || {};
      if (!rq.initial || !rq.result || !rq.last) continue;
      if (dirs.some(d => !(rq.initial[d] ?? 0) > 1)) continue;
      if (!filterFn(rq, m)) continue;
      n++; cost += dirs.length;
      if (dirs.includes(rq.result)) {
        hit++;
        sumOddsHit += rq.last[rq.result] || 1;
      }
    }
    return {
      rule: name,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      small: warnSmall(n),
    };
  }

  // 单方向频率统计
  const freq = { home: 0, draw: 0, away: 0, total: 0 };
  for (const m of matches) {
    const rq = m.rqspf || {};
    if (!rq.result) continue;
    freq.total++;
    freq[rq.result] = (freq[rq.result] || 0) + 1;
  }
  const freqRate = {
    home: pct(freq.home, freq.total),
    draw: pct(freq.draw, freq.total),
    away: pct(freq.away, freq.total),
  };

  const rules = [];

  // ---- 按赔率排序选号 (7 条原有) ----
  rules.push(rqsim('每场选最低赔率方向', (rq) => {
    const dirs = ['home', 'draw', 'away'];
    const sorted = dirs.slice().sort((a, b) => (rq.last[a] ?? 999) - (rq.last[b] ?? 999));
    return [sorted[0]];
  }));
  rules.push(rqsim('每场选最高赔率方向', (rq) => {
    const dirs = ['home', 'draw', 'away'];
    const sorted = dirs.slice().sort((a, b) => (rq.last[b] ?? -1) - (rq.last[a] ?? -1));
    return [sorted[0]];
  }));
  rules.push(rqsim('spf区间→rq方向(spf<1.5主/2.5+客/1.5-2.5平)', (rq, m) => {
    const spf = m.spf?.initial;
    if (!spf) return [];
    if (spf.home < 1.5) return ['home'];
    if (spf.home > 2.5) return ['away'];
    return ['draw'];
  }));
  rules.push(rqsim('每场选最低+次低两门', (rq) => {
    const dirs = ['home', 'draw', 'away'];
    const sorted = dirs.slice().sort((a, b) => (rq.last[a] ?? 999) - (rq.last[b] ?? 999));
    return sorted.slice(0, 2);
  }));
  rules.push(rqsim('跟handicap方向', (rq, m) => {
    const hc = m.handicap;
    if (hc === null || hc === undefined) return [];
    return [hc <= 0 ? 'home' : 'away'];
  }));
  rules.push(rqsim('handicap>=2时让胜+让负两门', (rq, m) => {
    const hc = m.handicap;
    if (hc === null || hc === undefined) return [];
    if (Math.abs(hc) >= 2) return ['home', 'away'];
    return [hc <= 0 ? 'home' : 'away'];
  }));
  rules.push(rqsim('漂移跟随: initial→last赔率下降最多方向', (rq) => {
    const dirs = ['home', 'draw', 'away'];
    const drifts = dirs.map(d => ({ d, drift: (rq.initial[d] ?? 0) - (rq.last[d] ?? 0) }));
    drifts.sort((a, b) => b.drift - a.drift);
    return [drifts[0].d];
  }));

  // ---- 固定买某个方向 (用户重点) ----
  rules.push(rqFixedSim(`固定买让胜(home) [n=${freq.total} 主胜率${fmtPct(freqRate.home)}]`, ['home']));
  rules.push(rqFixedSim(`固定买让平(draw) [n=${freq.total} 平率${fmtPct(freqRate.draw)}]`, ['draw']));
  rules.push(rqFixedSim(`固定买让负(away) [n=${freq.total} 客率${fmtPct(freqRate.away)}]`, ['away']));
  rules.push(rqFixedSim('固定买让胜+让平(主或平)', ['home', 'draw']));
  rules.push(rqFixedSim('固定买让胜+让负(主或客, 避开平)', ['home', 'away']));
  rules.push(rqFixedSim('固定买让平+让负(平或客)', ['draw', 'away']));
  rules.push(rqFixedSim('固定买三门(保底)', ['home', 'draw', 'away']));

  // ---- 赔率纠偏 (让胜: 赔率分桶) ----
  rules.push(rqOddsFiltered('让胜纠偏: 初赔<1.5 (必买盘) 才买', ['home'], rq => (rq.initial.home ?? 999) < 1.5));
  rules.push(rqOddsFiltered('让胜纠偏: 初赔<1.8 (低赔率安全盘)', ['home'], rq => (rq.initial.home ?? 999) < 1.8));
  rules.push(rqOddsFiltered('让胜纠偏: 初赔1.5-2.0 (主流盘)', ['home'], rq => (rq.initial.home ?? 0) >= 1.5 && (rq.initial.home ?? 999) < 2.0));
  rules.push(rqOddsFiltered('让胜纠偏: 初赔>=2.0 (冷门盘跳过)', ['home'], rq => (rq.initial.home ?? 0) >= 2.0));
  // 漂移纠偏: last vs initial
  rules.push(rqOddsFiltered('让胜纠偏: 降赔看好 (last<initial*0.95)', ['home'], rq => (rq.last.home ?? 0) < (rq.initial.home ?? 999) * 0.95));
  rules.push(rqOddsFiltered('让胜纠偏: 升赔看衰 (last>initial*1.05) 跳过', ['home'], rq => (rq.last.home ?? 0) > (rq.initial.home ?? 0) * 1.05));
  rules.push(rqOddsFiltered('让胜纠偏: 降赔+低赔 (<1.8 且 降) 双重', ['home'], rq => (rq.initial.home ?? 999) < 1.8 && (rq.last.home ?? 0) < (rq.initial.home ?? 999)));

  // ---- 赔率纠偏 (让平: 赔率低=不值得, 加赔率门槛) ----
  rules.push(rqOddsFiltered('让平纠偏: 初赔>=3.0 才有赚头', ['draw'], rq => (rq.initial.draw ?? 0) >= 3.0));
  rules.push(rqOddsFiltered('让平纠偏: 初赔>=3.5', ['draw'], rq => (rq.initial.draw ?? 0) >= 3.5));
  rules.push(rqOddsFiltered('让平纠偏: 初赔>=4.0', ['draw'], rq => (rq.initial.draw ?? 0) >= 4.0));
  rules.push(rqOddsFiltered('让平纠偏: 升赔看好 (last>initial)', ['draw'], rq => (rq.last.draw ?? 0) > (rq.initial.draw ?? 0)));

  // ---- 赔率纠偏 (让胜+让平组合: 赔率分桶) ----
  rules.push(rqOddsFiltered('让胜+让平 纠偏: 组合min赔率<2.0', ['home', 'draw'], rq => Math.min(rq.initial.home ?? 999, rq.initial.draw ?? 999) < 2.0));
  rules.push(rqOddsFiltered('让胜+让平 纠偏: 组合min赔率>=2.0', ['home', 'draw'], rq => Math.min(rq.initial.home ?? 999, rq.initial.draw ?? 999) >= 2.0));
  rules.push(rqOddsFiltered('让胜+让平 纠偏: 组合max赔率<3.0 (低赔不买)', ['home', 'draw'], rq => Math.max(rq.initial.home ?? 0, rq.initial.draw ?? 0) < 3.0));
  rules.push(rqOddsFiltered('让胜+让平 纠偏: 组合max赔率>=3.5', ['home', 'draw'], rq => Math.max(rq.initial.home ?? 0, rq.initial.draw ?? 0) >= 3.5));

  // ---- 赔率纠偏 (让胜+让负组合) ----
  rules.push(rqOddsFiltered('让胜+让负 纠偏: 组合min<2.5', ['home', 'away'], rq => Math.min(rq.initial.home ?? 999, rq.initial.away ?? 999) < 2.5));
  rules.push(rqOddsFiltered('让胜+让负 纠偏: 升赔方向 (last更高=市场不看好该组合)', ['home', 'away'], rq => (rq.last.home ?? 0) > (rq.initial.home ?? 0) && (rq.last.away ?? 0) > (rq.initial.away ?? 0)));

  return { rules, freq, freqRate };
}

// ============== 8. ZJQ 规则模拟 ==============
function analyzeZjq() {
  const allKeys = ['0', '1', '2', '3', '4', '5', '6', '7+'];

  // 固定买某些 key 的 ROI
  function zjqFixedSim(name, keys) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
    for (const m of matches) {
      const zjq = m.zjq || {};
      if (!zjq.initial || !zjq.initial.odds || !zjq.result) continue;
      // 要求每个 key 都有赔率
      if (keys.some(k => !(zjq.initial.odds[k] ?? 0) > 1)) continue;
      n++; cost += keys.length;
      const actual = String(zjq.result);
      if (keys.includes(actual)) {
        hit++;
        sumOddsHit += zjq.initial.odds[actual] || 1;
      }
    }
    return {
      rule: name,
      keys,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      avg_odds_hit: hit > 0 ? +(sumOddsHit / hit).toFixed(2) : null,
      small: warnSmall(n),
    };
  }

  // 固定买 + 赔率过滤 (纠偏)
  // filterFn(zjq, m) -> bool
  function zjqOddsFiltered(name, keys, filterFn) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
    for (const m of matches) {
      const zjq = m.zjq || {};
      if (!zjq.initial?.odds || !zjq.result) continue;
      if (keys.some(k => !(zjq.initial.odds[k] ?? 0) > 1)) continue;
      if (!filterFn(zjq, m)) continue;
      n++; cost += keys.length;
      const actual = String(zjq.result);
      if (keys.includes(actual)) {
        hit++;
        sumOddsHit += zjq.initial.odds[actual] || 1;
      }
    }
    return {
      rule: name, keys,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      avg_odds_hit: hit > 0 ? +(sumOddsHit / hit).toFixed(2) : null,
      small: warnSmall(n),
    };
  }

  // 单 key 频率
  const freq = {}; for (const k of allKeys) freq[k] = 0;
  let total = 0;
  for (const m of matches) {
    const zjq = m.zjq || {};
    if (!zjq.result) continue;
    total++;
    freq[String(zjq.result)] = (freq[String(zjq.result)] || 0) + 1;
  }
  const freqRate = {};
  for (const k of allKeys) freqRate[k] = pct(freq[k], total);

  function zjqSim(name, pickFn) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
    for (const m of matches) {
      const zjq = m.zjq || {};
      if (!zjq.initial || !zjq.initial.odds || !zjq.result) continue;
      const picks = pickFn(zjq, m);
      if (picks.length === 0) continue;
      n++;
      cost += picks.length;
      const actual = String(zjq.result);
      const hitPick = picks.find(k => k === actual);
      if (hitPick) { hit++; sumOddsHit += zjq.initial.odds[hitPick] || 1; }
    }
    return {
      rule: name,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      avg_odds_hit: hit > 0 ? +(sumOddsHit / hit).toFixed(2) : null,
      small: warnSmall(n),
    };
  }

  const rules = [];

  // ---- 按赔率排序 (6 条原有) ----
  rules.push(zjqSim('每场1个最低赔率总进球', (zjq) => {
    const odds = zjq.initial.odds;
    const sorted = allKeys.filter(k => odds[k] > 1).sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999));
    return sorted.slice(0, 1);
  }));
  rules.push(zjqSim('每场2个最低赔率总进球', (zjq) => {
    const odds = zjq.initial.odds;
    const sorted = allKeys.filter(k => odds[k] > 1).sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999));
    return sorted.slice(0, 2);
  }));
  rules.push(zjqSim('每场3个最低赔率总进球', (zjq) => {
    const odds = zjq.initial.odds;
    const sorted = allKeys.filter(k => odds[k] > 1).sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999));
    return sorted.slice(0, 3);
  }));
  rules.push(zjqSim('每场1个最高赔率总进球', (zjq) => {
    const odds = zjq.initial.odds;
    const sorted = allKeys.filter(k => odds[k] > 1).sort((a, b) => (odds[b] ?? -1) - (odds[a] ?? -1));
    return sorted.slice(0, 1);
  }));
  rules.push(zjqSim('最低赔率→落在2-3区间? (含次低)', (zjq) => {
    const odds = zjq.initial.odds;
    const sorted = allKeys.filter(k => odds[k] > 1).sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999));
    if (sorted.length === 0) return [];
    return sorted.slice(0, 2);
  }));
  rules.push(zjqSim('强队让球→总进球多(>3)', (zjq, m) => {
    const hc = Math.abs(m.handicap ?? 0);
    const odds = zjq.initial.odds;
    if (hc >= 2) {
      const big = allKeys.filter(k => ['4', '5', '6', '7+'].includes(k) && (odds[k] ?? 999) < 999);
      return big.length > 0 ? [big.sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999))[0]] : [];
    } else {
      const small = allKeys.filter(k => ['1', '2'].includes(k) && (odds[k] ?? 999) < 999);
      return small.length > 0 ? [small.sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999))[0]] : [];
    }
  }));

  // ---- 固定买某个 key (用户重点) ----
  // 单球
  for (const k of allKeys) {
    rules.push(zjqFixedSim(`固定买${k}球 [频率${fmtPct(freqRate[k])}]`, [k]));
  }
  // 组合
  rules.push(zjqFixedSim('固定买0+1(超小球)', ['0', '1']));
  rules.push(zjqFixedSim('固定买1+2(最常见小球)', ['1', '2']));
  rules.push(zjqFixedSim('固定买0+1+2(保守小球)', ['0', '1', '2']));
  rules.push(zjqFixedSim('固定买2+3(中等)', ['2', '3']));
  rules.push(zjqFixedSim('固定买1+2+3(中低球)', ['1', '2', '3']));
  rules.push(zjqFixedSim('固定买2+3+4(中球)', ['2', '3', '4']));
  rules.push(zjqFixedSim('固定买4+5(大球)', ['4', '5']));
  rules.push(zjqFixedSim('固定买4+5+6+7+(全大球)', ['4', '5', '6', '7+']));
  rules.push(zjqFixedSim('固定买3+4+5+6+7+(大球宽松)', ['3', '4', '5', '6', '7+']));
  rules.push(zjqFixedSim('固定买0+1+2+3+4(全小球)', ['0', '1', '2', '3', '4']));

  // ---- 赔率纠偏: 0+1+2 保守小球 (赔率分桶) ----
  rules.push(zjqOddsFiltered('0+1+2 纠偏: 组合min赔率<1.5 (太冷门 跳过)', ['0', '1', '2'],
    zjq => Math.min(zjq.initial.odds['0'] ?? 999, zjq.initial.odds['1'] ?? 999, zjq.initial.odds['2'] ?? 999) < 1.5));
  rules.push(zjqOddsFiltered('0+1+2 纠偏: 组合min赔率>=1.8 (主流盘)', ['0', '1', '2'],
    zjq => Math.min(zjq.initial.odds['0'] ?? 999, zjq.initial.odds['1'] ?? 999, zjq.initial.odds['2'] ?? 999) >= 1.8));
  rules.push(zjqOddsFiltered('0+1+2 纠偏: 2球初赔<3.0 (低赔=高信心)', ['0', '1', '2'],
    zjq => (zjq.initial.odds['2'] ?? 999) < 3.0));
  rules.push(zjqOddsFiltered('0+1+2 纠偏: 2球初赔>=3.0 (冷门) 跳过', ['0', '1', '2'],
    zjq => (zjq.initial.odds['2'] ?? 0) >= 3.0));

  // ---- 赔率纠偏: 2球 (最高频单球) ----
  rules.push(zjqOddsFiltered('2球纠偏: 初赔<2.5 (信心盘)', ['2'],
    zjq => (zjq.initial.odds['2'] ?? 999) < 2.5));
  rules.push(zjqOddsFiltered('2球纠偏: 初赔2.5-3.5 (主流盘)', ['2'],
    zjq => (zjq.initial.odds['2'] ?? 0) >= 2.5 && (zjq.initial.odds['2'] ?? 999) < 3.5));
  rules.push(zjqOddsFiltered('2球纠偏: 初赔>=3.5 (冷门盘) 跳过', ['2'],
    zjq => (zjq.initial.odds['2'] ?? 0) >= 3.5));
  rules.push(zjqOddsFiltered('2球纠偏: 降赔看好 (last<initial)', ['2'],
    zjq => (zjq.last?.odds?.['2'] ?? 0) < (zjq.initial.odds['2'] ?? 999)));

  // ---- 赔率纠偏: 4+5+6+7+ 全大球 ----
  rules.push(zjqOddsFiltered('4+5+6+7+ 纠偏: 4球赔率<3.0 (市场看好大球)', ['4', '5', '6', '7+'],
    zjq => (zjq.initial.odds['4'] ?? 999) < 3.0));
  rules.push(zjqOddsFiltered('4+5+6+7+ 纠偏: 4球赔率>=4.0 (市场看衰大球)', ['4', '5', '6', '7+'],
    zjq => (zjq.initial.odds['4'] ?? 0) >= 4.0));
  rules.push(zjqOddsFiltered('4+5+6+7+ 纠偏: 7+球赔率>=15 (冷门信号)', ['4', '5', '6', '7+'],
    zjq => (zjq.initial.odds['7+'] ?? 0) >= 15));

  // ---- 赔率纠偏: 0+1+2 配合让球 ----
  rules.push(zjqOddsFiltered('0+1+2 纠偏: |让球|<=1 才买 (势均力敌)', ['0', '1', '2'],
    (zjq, m) => Math.abs(m.handicap ?? 0) <= 1));
  rules.push(zjqOddsFiltered('4+5+6+7+ 纠偏: |让球|>=2 才买 (强队压制)', ['4', '5', '6', '7+'],
    (zjq, m) => Math.abs(m.handicap ?? 0) >= 2));

  // ---- 按比赛类型 (NORMAL/BIG_BALL/WEAK_MATCH) 拆 3 条核心规则 ----
  // 拆: 2球赔率 [2.5, 3.5)
  const splitByType = (ruleName, keys, baseFilter) => {
    const out = { rule: ruleName, by_type: {} };
    for (const t of ['NORMAL', 'BIG_BALL', 'WEAK_MATCH']) {
      let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
      for (const m of matches) {
        const zjq = m.zjq || {};
        if (!zjq.initial?.odds || !zjq.result) continue;
        if (keys.some(k => !(zjq.initial.odds[k] ?? 0) > 1)) continue;
        if (classifyMatch32(m) !== t) continue;
        if (baseFilter && !baseFilter(zjq, m)) continue;
        n++; cost += keys.length;
        const actual = String(zjq.result);
        if (keys.includes(actual)) {
          hit++;
          sumOddsHit += zjq.initial.odds[actual] || 1;
        }
      }
      out.by_type[t] = { n, hit, hit_rate: pct(hit, n), cost, return: +sumOddsHit.toFixed(2), roi: roi(hit, cost, sumOddsHit), small: warnSmall(n) };
    }
    return out;
  };
  const zjqSplits = [
    splitByType('2球 [2.5, 3.5) 按分类', ['2'],
      zjq => (zjq.initial.odds['2'] ?? 0) >= 2.5 && (zjq.initial.odds['2'] ?? 999) < 3.5),
    splitByType('4+5+6+7+ [无过滤] 按分类', ['4', '5', '6', '7+']),
    splitByType('0+1+2 [无过滤] 按分类', ['0', '1', '2']),
  ];

  return { rules, freq, freqRate, total, splits: zjqSplits };
}

// ============== 9. BQC 规则模拟 ==============
function analyzeBqc() {
  const allKeys = ['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负'];

  // 固定买某些 key 的 ROI
  function bqcFixedSim(name, keys) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
    for (const m of matches) {
      const bqc = m.bqc || {};
      if (!bqc.initial || !bqc.initial.odds || !bqc.result) continue;
      if (keys.some(k => !(bqc.initial.odds[k] ?? 0) > 1)) continue;
      n++; cost += keys.length;
      if (keys.includes(bqc.result)) {
        hit++;
        sumOddsHit += bqc.initial.odds[bqc.result] || 1;
      }
    }
    return {
      rule: name,
      keys,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      avg_odds_hit: hit > 0 ? +(sumOddsHit / hit).toFixed(2) : null,
      small: warnSmall(n),
    };
  }

  // 固定买 + 赔率过滤 (纠偏)
  function bqcOddsFiltered(name, keys, filterFn) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
    for (const m of matches) {
      const bqc = m.bqc || {};
      if (!bqc.initial?.odds || !bqc.result) continue;
      if (keys.some(k => !(bqc.initial.odds[k] ?? 0) > 1)) continue;
      if (!filterFn(bqc, m)) continue;
      n++; cost += keys.length;
      if (keys.includes(bqc.result)) {
        hit++;
        sumOddsHit += bqc.initial.odds[bqc.result] || 1;
      }
    }
    return {
      rule: name, keys,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      avg_odds_hit: hit > 0 ? +(sumOddsHit / hit).toFixed(2) : null,
      small: warnSmall(n),
    };
  }

  // 单 key 频率
  const freq = {}; for (const k of allKeys) freq[k] = 0;
  let total = 0;
  for (const m of matches) {
    const bqc = m.bqc || {};
    if (!bqc.result) continue;
    total++;
    freq[bqc.result] = (freq[bqc.result] || 0) + 1;
  }
  const freqRate = {};
  for (const k of allKeys) freqRate[k] = pct(freq[k], total);

  function bqcSim(name, pickFn) {
    let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
    for (const m of matches) {
      const bqc = m.bqc || {};
      if (!bqc.initial || !bqc.initial.odds || !bqc.result) continue;
      const picks = pickFn(bqc, m);
      if (picks.length === 0) continue;
      n++;
      cost += picks.length;
      const actual = bqc.result;
      const hitPick = picks.find(k => k === actual);
      if (hitPick) { hit++; sumOddsHit += bqc.initial.odds[hitPick] || 1; }
    }
    return {
      rule: name,
      n, hit,
      hit_rate: pct(hit, n),
      cost,
      return: +sumOddsHit.toFixed(2),
      roi: roi(hit, cost, sumOddsHit),
      avg_odds_hit: hit > 0 ? +(sumOddsHit / hit).toFixed(2) : null,
      small: warnSmall(n),
    };
  }

  const rules = [];

  // ---- 按赔率排序 (5 条原有) ----
  rules.push(bqcSim('每场1个最低赔率半全场', (bqc) => {
    const odds = bqc.initial.odds;
    const sorted = allKeys.filter(k => (odds[k] ?? 999) < 999).sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999));
    return sorted.slice(0, 1);
  }));
  rules.push(bqcSim('每场2个最低赔率半全场', (bqc) => {
    const odds = bqc.initial.odds;
    const sorted = allKeys.filter(k => (odds[k] ?? 999) < 999).sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999));
    return sorted.slice(0, 2);
  }));
  rules.push(bqcSim('跟盘方向半全场(胜胜/负负/平平)', (bqc, m) => {
    const hc = m.handicap;
    const dir = hc !== null && hc !== undefined && hc <= 0 ? 'home' : 'away';
    if (dir === 'home') return ['胜胜'];
    if (dir === 'away') return ['负负'];
    return ['平平'];
  }));
  rules.push(bqcSim('handicap>=2→胜胜或负负(看赔率低者)', (bqc, m) => {
    const hc = Math.abs(m.handicap ?? 0);
    if (hc < 2) return [];
    const odds = bqc.initial.odds;
    const pool = ['胜胜', '负负'].filter(k => (odds[k] ?? 999) < 999);
    pool.sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999));
    return pool.slice(0, 1);
  }));
  rules.push(bqcSim('每场3个最低赔率半全场', (bqc) => {
    const odds = bqc.initial.odds;
    const sorted = allKeys.filter(k => (odds[k] ?? 999) < 999).sort((a, b) => (odds[a] ?? 999) - (odds[b] ?? 999));
    return sorted.slice(0, 3);
  }));

  // ---- 固定买某个 key (用户重点) ----
  for (const k of allKeys) {
    rules.push(bqcFixedSim(`固定买${k} [频率${fmtPct(freqRate[k])}]`, [k]));
  }
  // 组合
  rules.push(bqcFixedSim('固定买胜胜+平平(主+平二选一)', ['胜胜', '平平']));
  rules.push(bqcFixedSim('固定买胜胜+平平+负负(跟盘向三选一)', ['胜胜', '平平', '负负']));
  rules.push(bqcFixedSim('固定买胜胜+胜平+平胜+平平(主/平主导4选)', ['胜胜', '胜平', '平胜', '平平']));
  rules.push(bqcFixedSim('固定买胜胜+胜负(主队半场赢后任意)', ['胜胜', '胜负']));
  rules.push(bqcFixedSim('固定买负胜+负平+负负(客队半场输后任意)', ['负胜', '负平', '负负']));
  rules.push(bqcFixedSim('固定买平胜+平平+平负(半场平后任意)', ['平胜', '平平', '平负']));
  rules.push(bqcFixedSim('固定买胜平+平平(半场赢后平+半场平后平)', ['胜平', '平平']));
  rules.push(bqcFixedSim('固定买平平+平负(半场平后客胜)', ['平平', '平负']));

  // ---- 赔率纠偏: 胜胜+平平 (用户重点问的组合) ----
  // 组合平均赔率avg = (odds[胜胜] + odds[平平]) / 2
  rules.push(bqcOddsFiltered('胜胜+平平 纠偏: 组合avg赔率<2.5 (低赔率场 跳过)', ['胜胜', '平平'],
    bqc => ((bqc.initial.odds['胜胜'] ?? 999) + (bqc.initial.odds['平平'] ?? 999)) / 2 < 2.5));
  rules.push(bqcOddsFiltered('胜胜+平平 纠偏: 组合avg赔率2.5-4.0 (主流盘)', ['胜胜', '平平'],
    bqc => {
      const avg = ((bqc.initial.odds['胜胜'] ?? 999) + (bqc.initial.odds['平平'] ?? 999)) / 2;
      return avg >= 2.5 && avg < 4.0;
    }));
  rules.push(bqcOddsFiltered('胜胜+平平 纠偏: 组合avg赔率>=4.0 (冷门盘)', ['胜胜', '平平'],
    bqc => ((bqc.initial.odds['胜胜'] ?? 999) + (bqc.initial.odds['平平'] ?? 999)) / 2 >= 4.0));
  // 单 key 赔率过滤
  rules.push(bqcOddsFiltered('胜胜+平平 纠偏: 胜胜赔率<2.0 (市场看好主队赢到底)', ['胜胜', '平平'],
    bqc => (bqc.initial.odds['胜胜'] ?? 999) < 2.0));
  rules.push(bqcOddsFiltered('胜胜+平平 纠偏: 平平赔率>=3.5 (市场看衰全平)', ['胜胜', '平平'],
    bqc => (bqc.initial.odds['平平'] ?? 0) >= 3.5));
  // 漂移纠偏
  rules.push(bqcOddsFiltered('胜胜+平平 纠偏: 胜胜降赔 (last<initial*0.95)', ['胜胜', '平平'],
    bqc => (bqc.last?.odds?.['胜胜'] ?? 0) < (bqc.initial.odds['胜胜'] ?? 999) * 0.95));
  rules.push(bqcOddsFiltered('胜胜+平平 纠偏: 升赔方向 (last都升) 跳过', ['胜胜', '平平'],
    bqc => (bqc.last?.odds?.['胜胜'] ?? 0) > (bqc.initial.odds['胜胜'] ?? 0) && (bqc.last?.odds?.['平平'] ?? 0) > (bqc.initial.odds['平平'] ?? 0)));

  // ---- 赔率纠偏: 胜胜+胜平+平胜+平平 (4选1, 覆盖76%比赛) ----
  rules.push(bqcOddsFiltered('胜胜+胜平+平胜+平平 纠偏: 组合avg赔率<2.0', ['胜胜', '胜平', '平胜', '平平'],
    bqc => {
      const odds = ['胜胜', '胜平', '平胜', '平平'].map(k => bqc.initial.odds[k] ?? 999);
      return odds.reduce((s, x) => s + x, 0) / 4 < 2.0;
    }));
  rules.push(bqcOddsFiltered('胜胜+胜平+平胜+平平 纠偏: 组合avg赔率2.0-3.0', ['胜胜', '胜平', '平胜', '平平'],
    bqc => {
      const odds = ['胜胜', '胜平', '平胜', '平平'].map(k => bqc.initial.odds[k] ?? 999);
      const avg = odds.reduce((s, x) => s + x, 0) / 4;
      return avg >= 2.0 && avg < 3.0;
    }));
  rules.push(bqcOddsFiltered('胜胜+胜平+平胜+平平 纠偏: 组合avg赔率>=3.0', ['胜胜', '胜平', '平胜', '平平'],
    bqc => {
      const odds = ['胜胜', '胜平', '平胜', '平平'].map(k => bqc.initial.odds[k] ?? 999);
      return odds.reduce((s, x) => s + x, 0) / 4 >= 3.0;
    }));

  // ---- 赔率纠偏: 胜胜 单 key ----
  rules.push(bqcOddsFiltered('胜胜纠偏: 初赔<1.5 (必买盘) 才买', ['胜胜'],
    bqc => (bqc.initial.odds['胜胜'] ?? 999) < 1.5));
  rules.push(bqcOddsFiltered('胜胜纠偏: 初赔1.5-2.5 (主流盘)', ['胜胜'],
    bqc => (bqc.initial.odds['胜胜'] ?? 0) >= 1.5 && (bqc.initial.odds['胜胜'] ?? 999) < 2.5));
  rules.push(bqcOddsFiltered('胜胜纠偏: 降赔看好 (last<initial*0.95)', ['胜胜'],
    bqc => (bqc.last?.odds?.['胜胜'] ?? 0) < (bqc.initial.odds['胜胜'] ?? 999) * 0.95));

  // ---- 赔率纠偏: 平平 单 key ----
  rules.push(bqcOddsFiltered('平平纠偏: 初赔>=4.0 (市场看衰全平=有赚头)', ['平平'],
    bqc => (bqc.initial.odds['平平'] ?? 0) >= 4.0));
  rules.push(bqcOddsFiltered('平平纠偏: 初赔>=5.0', ['平平'],
    bqc => (bqc.initial.odds['平平'] ?? 0) >= 5.0));
  rules.push(bqcOddsFiltered('平平纠偏: 升赔看好 (last>initial)', ['平平'],
    bqc => (bqc.last?.odds?.['平平'] ?? 0) > (bqc.initial.odds['平平'] ?? 0)));

  // ---- 赔率纠偏: 负平 单 key (冷门) ----
  rules.push(bqcOddsFiltered('负平纠偏: 初赔>=8 (大冷门盘)', ['负平'],
    bqc => (bqc.initial.odds['负平'] ?? 0) >= 8));
  rules.push(bqcOddsFiltered('负平纠偏: 初赔<5 (热门盘 跳过)', ['负平'],
    bqc => (bqc.initial.odds['负平'] ?? 999) < 5));

  // ---- 按比赛类型拆 BQC 胜胜+平平<2.0 (用户洞察) ----
  const bqcSplit = (ruleName, keys, baseFilter) => {
    const out = { rule: ruleName, by_type: {} };
    for (const t of ['NORMAL', 'BIG_BALL', 'WEAK_MATCH']) {
      let n = 0, hit = 0, cost = 0, sumOddsHit = 0;
      for (const m of matches) {
        const bqc = m.bqc || {};
        if (!bqc.initial?.odds || !bqc.result) continue;
        if (keys.some(k => !(bqc.initial.odds[k] ?? 0) > 1)) continue;
        if (classifyMatch32(m) !== t) continue;
        if (baseFilter && !baseFilter(bqc, m)) continue;
        n++; cost += keys.length;
        if (keys.includes(bqc.result)) {
          hit++;
          sumOddsHit += bqc.initial.odds[bqc.result] || 1;
        }
      }
      out.by_type[t] = { n, hit, hit_rate: pct(hit, n), cost, return: +sumOddsHit.toFixed(2), roi: roi(hit, cost, sumOddsHit), small: warnSmall(n) };
    }
    return out;
  };
  const bqcSplits = [
    bqcSplit('胜胜+平平 [胜胜<2.0] 按分类', ['胜胜', '平平'],
      bqc => (bqc.initial.odds['胜胜'] ?? 999) < 2.0),
  ];

  return { rules, freq, freqRate, total, splits: bqcSplits };
}
// ============== 6. 提炼 TOP 建议 ==============
function makeAdvices(insights) {
  const advices = [];
  // SPF
  for (const [name, b] of Object.entries(insights.spf || {})) {
    if (b.n >= 3 && b.home_rate !== null) {
      advices.push(`spf 主胜赔率${name}: 主胜命中${b.home}/${b.n}=${fmtPct(b.home_rate)} (平${fmtPct(b.draw_rate)} 客${fmtPct(b.away_rate)})`);
    }
  }
  // BF 规则模拟 (按 ROI 倒序, 过滤 n>=5)
  const bfRules = (insights.bf?.rules || []).filter(r => r.n >= 5);
  bfRules.sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of bfRules.slice(0, 3)) {
    advices.push(`bf 规则「${r.rule}」: 命中${r.hit}/${r.n}=${fmtPct(r.hit_rate)}, ROI=${fmtPct(r.roi)} ${r.small}`);
  }
  // BF 总进球分布
  for (const [name, b] of Object.entries(insights.bf?.total_distribution || {})) {
    if (b.n >= 3) {
      advices.push(`实际总进球落在${name}: ${b.actual_in}/${b.n}=${fmtPct(b.rate)} ${b.small}`);
    }
  }
  // RQSPF 规则模拟 (按 ROI 倒序, TOP 3)
  const rqRules = (insights.rqspf?.rules || []).filter(r => r.n >= 5);
  rqRules.sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of rqRules.slice(0, 3)) {
    advices.push(`rqspf「${r.rule}」: 命中${r.hit}/${r.n}=${fmtPct(r.hit_rate)}, ROI=${fmtPct(r.roi)} ${r.small}`);
  }
  // ZJQ 规则模拟
  const zjRules = (insights.zjq?.rules || []).filter(r => r.n >= 5);
  zjRules.sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of zjRules.slice(0, 3)) {
    advices.push(`zjq「${r.rule}」: 命中${r.hit}/${r.n}=${fmtPct(r.hit_rate)}, ROI=${fmtPct(r.roi)} ${r.small}`);
  }
  // BQC 规则模拟
  const bqRules = (insights.bqc?.rules || []).filter(r => r.n >= 5);
  bqRules.sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of bqRules.slice(0, 3)) {
    advices.push(`bqc「${r.rule}」: 命中${r.hit}/${r.n}=${fmtPct(r.hit_rate)}, ROI=${fmtPct(r.roi)} ${r.small}`);
  }
  // 单关规则模拟 (按 ROI 倒序, 过滤 n>=4)
  const sbRules = (insights.single_bet || []).filter(r => r.n >= 4);
  sbRules.sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of sbRules.slice(0, 3)) {
    advices.push(`单关「${r.rule}」: 命中${r.hit}/${r.n}=${fmtPct(r.hit_rate)}, ROI=${fmtPct(r.roi)} ${r.small}`);
  }
  // 漂移
  for (const [name, b] of Object.entries(insights.drift || {})) {
    if (b.n >= 3) {
      advices.push(`spf ${name}: 主胜命中${b.hit}/${b.n}=${fmtPct(b.home_rate)}, ROI=${fmtPct(b.roi)} ${b.small}`);
    }
  }
  // Handicap
  for (const [name, b] of Object.entries(insights.handicap || {})) {
    if (b.n >= 3) {
      advices.push(`让球${name}: 主${fmtPct(b.home_rate)} 平${fmtPct(b.draw_rate)} 客${fmtPct(b.away_rate)} (n=${b.n}) ${b.small}`);
    }
  }
  return advices;
}

// ============== 主流程 (函数化, 跑两遍: all / wc_only) ==============
// analyzeXxx 函数内部用全局 `matches` 变量, 所以函数运行前会 swap 进去
// runs 跑出来的 insights 写到不同的 artifact 文件
function runAnalysis(label) {
  const outFile = label === 'wc_only'
    ? OUTPUT_FILE.replace('.json', '_wc.json')
    : OUTPUT_FILE;

  const insights = {
    generated_at: new Date().toISOString(),
    sample_size: matches.length,
    scope: label,
    note: matches.length < 20 ? '⚠️ 样本量较小(N=' + matches.length + '), 规律仅供参考, 避免过度拟合' : '',
    spf: analyzeSpf(),
    bf: analyzeBf(),
    rqspf: analyzeRqspf(),
    zjq: analyzeZjq(),
    bqc: analyzeBqc(),
    single_bet: analyzeSingleBet(),
    drift: analyzeDrift(),
    handicap: analyzeHandicap(),
  };
  insights.top_advices = makeAdvices(insights);

  // ============== 输出 ==============
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(insights, null, 2), 'utf-8');

  if (!QUIET) {
  console.log(`\n[32_roi_insights][${label}] 基于 ${matches.length} 场已完赛比赛`);
  if (insights.note) console.log(`  ${insights.note}`);
  console.log(`\n## SPF 主胜赔率分桶`);
  for (const [name, b] of Object.entries(insights.spf)) {
    console.log(`  ${name.padEnd(10)} n=${String(b.n).padStart(2)}  主${fmtPct(b.home_rate).padStart(6)}  平${fmtPct(b.draw_rate).padStart(6)}  客${fmtPct(b.away_rate).padStart(6)}`);
  }
  console.log(`\n## BF 比分: 模拟选号规则 ROI (按 ROI 倒序)`);
  const sortedBf = [...insights.bf.rules].sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of sortedBf) {
    console.log(`  ${r.rule.padEnd(20)} n=${String(r.n).padStart(3)}  命中${fmtPct(r.hit_rate).padStart(6)}  ROI=${fmtPct(r.roi).padStart(7)}  ${r.small}`);
  }
  console.log(`\n## BF 比分: 实际总进球分布`);
  for (const [name, b] of Object.entries(insights.bf.total_distribution)) {
    console.log(`  ${name.padEnd(8)} n=${String(b.n).padStart(2)}  落在该区间=${fmtPct(b.rate).padStart(6)}  ${b.small}`);
  }
  console.log(`\n## RQSPF 让球胜平负: 频率统计 (n=${insights.rqspf.freq.total})`);
  for (const [k, label] of [['home', '让胜(主)'], ['draw', '让平'], ['away', '让负(客)']]) {
    const c = insights.rqspf.freq[k] || 0;
    const r = insights.rqspf.freqRate[k] ?? 0;
    const bar = '█'.repeat(Math.round(r / 2)) + ' '.repeat(Math.max(0, 25 - Math.round(r / 2)));
    console.log(`  ${label.padEnd(8)} ${String(c).padStart(2)}  ${fmtPct(r).padStart(6)}  ${bar}  ${r >= 35 ? '⭐高频' : r <= 20 ? '⚠️低频' : ''}`);
  }
  console.log(`\n## RQSPF 让球胜平负: 模拟选号规则 ROI (按 ROI 倒序)`);
  const sortedRq = [...insights.rqspf.rules].sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of sortedRq) {
    console.log(`  ${r.rule.padEnd(50)} n=${String(r.n).padStart(2)}  命中${fmtPct(r.hit_rate).padStart(6)}  ROI=${fmtPct(r.roi).padStart(7)}  ${r.small}`);
  }
  console.log(`\n## ZJQ 总进球: 频率统计 (n=${insights.zjq.total})`);
  for (const k of ['0', '1', '2', '3', '4', '5', '6', '7+']) {
    const c = insights.zjq.freq[k] || 0;
    const r = insights.zjq.freqRate[k] ?? 0;
    const bar = '█'.repeat(Math.round(r / 2)) + ' '.repeat(Math.max(0, 25 - Math.round(r / 2)));
    console.log(`  ${(k + '球').padEnd(4)} ${String(c).padStart(2)}  ${fmtPct(r).padStart(6)}  ${bar}  ${r >= 20 ? '⭐高频' : r <= 5 ? '⚠️低频' : ''}`);
  }
  console.log(`\n## ZJQ 总进球: 模拟选号规则 ROI (按 ROI 倒序, 仅显示前 18 条)`);
  const sortedZj = [...insights.zjq.rules].sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of sortedZj.slice(0, 18)) {
    console.log(`  ${r.rule.padEnd(38)} n=${String(r.n).padStart(2)}  命中${fmtPct(r.hit_rate).padStart(6)}  ROI=${fmtPct(r.roi).padStart(7)}  ${r.small}`);
  }
  console.log(`\n## BQC 半全场: 频率统计 (n=${insights.bqc.total})`);
  for (const k of ['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负']) {
    const c = insights.bqc.freq[k] || 0;
    const r = insights.bqc.freqRate[k] ?? 0;
    const bar = '█'.repeat(Math.round(r / 2)) + ' '.repeat(Math.max(0, 25 - Math.round(r / 2)));
    console.log(`  ${k.padEnd(4)} ${String(c).padStart(2)}  ${fmtPct(r).padStart(6)}  ${bar}  ${r >= 20 ? '⭐高频' : r === 0 ? '❌从未出现' : r <= 5 ? '⚠️低频' : ''}`);
  }
  console.log(`\n## BQC 半全场: 模拟选号规则 ROI (按 ROI 倒序, 仅显示前 18 条)`);
  const sortedBq = [...insights.bqc.rules].sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of sortedBq.slice(0, 18)) {
    console.log(`  ${r.rule.padEnd(45)} n=${String(r.n).padStart(2)}  命中${fmtPct(r.hit_rate).padStart(6)}  ROI=${fmtPct(r.roi).padStart(7)}  ${r.small}`);
  }

  // ============== 赔率纠偏 ROI 段 ==============
  // 提取所有 "纠偏" 字样的规则, 按 ROI 倒序
  function correctionRules(rules) {
    return rules.filter(r => r.rule.includes('纠偏') && r.n >= 3);
  }

  console.log(`\n## 赔率纠偏 ROI: RQSPF 让胜/让平/组合 (按 ROI 倒序, n>=3)`);
  const rqCorr = correctionRules(insights.rqspf.rules).sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of rqCorr) {
    console.log(`  ${r.rule.padEnd(50)} n=${String(r.n).padStart(2)}  命中${fmtPct(r.hit_rate).padStart(6)}  ROI=${fmtPct(r.roi).padStart(7)}  ${r.small}`);
  }

  console.log(`\n## 赔率纠偏 ROI: ZJQ 总进球 (按 ROI 倒序, n>=3)`);
  const zjCorr = correctionRules(insights.zjq.rules).sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of zjCorr) {
    console.log(`  ${r.rule.padEnd(55)} n=${String(r.n).padStart(2)}  命中${fmtPct(r.hit_rate).padStart(6)}  ROI=${fmtPct(r.roi).padStart(7)}  ${r.small}`);
  }

  console.log(`\n## 赔率纠偏 ROI: BQC 半全场 (按 ROI 倒序, n>=3)`);
  const bqCorr = correctionRules(insights.bqc.rules).sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of bqCorr) {
    console.log(`  ${r.rule.padEnd(55)} n=${String(r.n).padStart(2)}  命中${fmtPct(r.hit_rate).padStart(6)}  ROI=${fmtPct(r.roi).padStart(7)}  ${r.small}`);
  }
  console.log(`\n## 单关候选: 模拟选号规则 ROI (按 ROI 倒序)`);
  const sortedSb = [...insights.single_bet].sort((a, b) => (b.roi ?? -9999) - (a.roi ?? -9999));
  for (const r of sortedSb) {
    console.log(`  ${r.rule.padEnd(20)} n=${String(r.n).padStart(3)}  命中${fmtPct(r.hit_rate).padStart(6)}  ROI=${fmtPct(r.roi).padStart(7)}  ${r.small}`);
  }
  console.log(`\n## 赔率漂移 (spf 主胜赔率 initial→last)`);
  for (const [name, b] of Object.entries(insights.drift)) {
    console.log(`  ${name.padEnd(12)} n=${String(b.n).padStart(2)}  主胜命中${fmtPct(b.home_rate).padStart(6)}  ROI=${fmtPct(b.roi).padStart(7)}  ${b.small}`);
  }
  console.log(`\n## 让球数 × 比分方向 (rqspf 命中)`);
  for (const [name, b] of Object.entries(insights.handicap)) {
    console.log(`  ${name.padEnd(10)} n=${String(b.n).padStart(2)}  主${fmtPct(b.home_rate).padStart(6)}  平${fmtPct(b.draw_rate).padStart(6)}  客${fmtPct(b.away_rate).padStart(6)}  ${b.small}`);
  }
  console.log(`\n## TOP 建议 (按规则分桶的事实陈述, 共 ${insights.top_advices.length} 条)`);
  for (const a of insights.top_advices) console.log(`  • ${a}`);

  // ============== 按比赛类型拆 ROI 子样本 (2026-06-18 用户洞察) ==============
  if (insights.zjq?.splits?.length) {
    console.log(`\n## ZJQ 按比赛类型拆 ROI (验证"NORMAL 推 2 球 / BIG_BALL 推 4 球 / WEAK_MATCH 推 0-1 球"是否合理)`);
    for (const s of insights.zjq.splits) {
      console.log(`  ${s.rule}`);
      for (const t of ['NORMAL', 'BIG_BALL', 'WEAK_MATCH']) {
        const v = s.by_type[t];
        console.log(`    ${t.padEnd(10)} n=${String(v.n).padStart(2)}  命中${String(v.hit).padStart(2)}  ${fmtPct(v.hit_rate).padStart(6)}  ROI=${fmtPct(v.roi).padStart(7)}  ${v.small}`);
      }
    }
  }
  if (insights.bqc?.splits?.length) {
    console.log(`\n## BQC 按比赛类型拆 ROI`);
    for (const s of insights.bqc.splits) {
      console.log(`  ${s.rule}`);
      for (const t of ['NORMAL', 'BIG_BALL', 'WEAK_MATCH']) {
        const v = s.by_type[t];
        console.log(`    ${t.padEnd(10)} n=${String(v.n).padStart(2)}  命中${String(v.hit).padStart(2)}  ${fmtPct(v.hit_rate).padStart(6)}  ROI=${fmtPct(v.roi).padStart(7)}  ${v.small}`);
      }
    }
  }

  // ============== 5 玩法完整频率分布 (直接读 data/views/) ==============
  // 这是用户视角: 看完 ROI 之后, 还想看到"每种结果到底出现过几次"
  // 各玩法所有 key/结果的完整分布, 不截断
  const VIEWS_DIR = path.join(PROJECT_ROOT, 'data', 'views');
  const viewSuffix = label === 'wc_only' ? '_wc' : '';
  function readView(name) {
    try { return JSON.parse(fs.readFileSync(path.join(VIEWS_DIR, `${name}${viewSuffix}_view.json`), 'utf-8')); }
    catch { return null; }
  }

  function printFreqBars(playName, items, total) {
    // items: [{key, count}], total: number
    const maxCount = Math.max(1, ...items.map(x => x.count));
    console.log(`\n## ${playName} 完整频率分布 (n=${total})`);
    for (const { key, count } of items) {
      const r = total > 0 ? +(count / total * 100).toFixed(1) : 0;
      const width = Math.round(count / maxCount * 30);
      const bar = '█'.repeat(width) + ' '.repeat(Math.max(0, 30 - width));
      const tag = r >= 20 ? '⭐' : r === 0 ? '❌' : r <= 5 ? '⚠️ ' : '  ';
      console.log(`  ${String(key).padEnd(8)} ${String(count).padStart(2)}  ${fmtPct(r).padStart(6)}  ${bar} ${tag}`);
    }
  }

  // SPF
  const spfView = readView('spf');
  if (spfView) {
    const dist = { home: 0, draw: 0, away: 0 };
    for (const r of spfView.rows) if (r.result) dist[r.result] = (dist[r.result] || 0) + 1;
    printFreqBars('SPF 胜平负', [
      { key: '主胜', count: dist.home },
      { key: '平局', count: dist.draw },
      { key: '客胜', count: dist.away },
    ], spfView.rows.length);
  }

  // RQSPF
  const rqView = readView('rqspf');
  if (rqView) {
    const dist = { home: 0, draw: 0, away: 0 };
    for (const r of rqView.rows) if (r.result) dist[r.result] = (dist[r.result] || 0) + 1;
    printFreqBars('RQSPF 让球胜平负', [
      { key: '让胜(主)', count: dist.home },
      { key: '让平', count: dist.draw },
      { key: '让负(客)', count: dist.away },
    ], rqView.rows.length);
  }

  // BF
  const bfView = readView('bf');
  if (bfView) {
    const dist = {};
    for (const r of bfView.rows) {
      const key = r.result?.other ? `${r.result.other}` : r.result?.score;
      if (key) dist[key] = (dist[key] || 0) + 1;
    }
    const items = Object.entries(dist)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
    printFreqBars('BF 比分 (按出现次数倒序)', items, bfView.rows.length);
  }

  // ZJQ
  const zjView = readView('zjq');
  if (zjView) {
    const dist = {};
    for (const r of zjView.rows) if (r.result) dist[r.result] = (dist[r.result] || 0) + 1;
    const items = ['0', '1', '2', '3', '4', '5', '6', '7+']
      .map(k => ({ key: `${k}球`, count: dist[k] || 0 }));
    printFreqBars('ZJQ 总进球', items, zjView.rows.length);
  }

  // BQC
  const bqView = readView('bqc');
  if (bqView) {
    const dist = {};
    for (const r of bqView.rows) if (r.result) dist[r.result] = (dist[r.result] || 0) + 1;
    const items = ['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负']
      .map(k => ({ key: k, count: dist[k] || 0 }));
    printFreqBars('BQC 半全场', items, bqView.rows.length);
  }

  // ============== 世界杯正赛 only 频率分布 由第二次 runAnalysis('wc_only') 打印, 这里不需要重复 ==============

  console.log(`\n[32_roi_insights][${label}] 写入 ${outFile}`);
  } // end if (!QUIET)
  return insights;
} // end runAnalysis

// ============== 跑两遍: all 全部 26 场, wc_only 世界杯正赛 only 23 场 ==============
const insightsAll = runAnalysis('all');

const wcCount = matches.filter(m => m.league === '世界杯').length;
const nonWcCount = matches.length - wcCount;
if (wcCount > 0 && wcCount < matches.length) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`## 切换到世界杯正赛 only (排除 ${nonWcCount} 场国际赛, 剩 ${wcCount} 场)`);
  console.log('='.repeat(60));
  // swap 全局 matches 到 WC only
  matches = matches.filter(m => m.league === '世界杯');
  const insightsWc = runAnalysis('wc_only');
  // 恢复
  matches = originalMatches;
} else {
  console.log(`[32_roi_insights] 全部 ${matches.length} 场都是世界杯正赛, 无需 wc_only 跑两遍`);
}
