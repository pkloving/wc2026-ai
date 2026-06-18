// 13_bet_strategy.js
// ============================================================================
// 投注策略回测层(独立于预测层)
// ----------------------------------------------------------------------------
// 目的: 预测层(12_r013_user_rules.js)只回答"每场买什么方向/比分", 不回答"怎么把它们
//       拼成单子、压几注、每注多少"。本模块专门回测"怎么买更科学":
//       吃预测层产物 backtest_r013_<date>.json(含 rqspf 三路赔率、模型所选腿、真实赛果),
//       在历史赛果上模拟多种"投注构造策略" + 凯利注码, 输出 ROI/命中率/资金曲线/最大回撤。
//
// 概率(两者混合, 用户选定): p_est = (1-BLEND)·市场公平prob + BLEND·模型lean prob
//   - 市场公平prob: rqspf 三路 1/赔率 去 margin(归一)
//   - 模型lean: 对 R013 所选腿(rqspf_picks.picks)做 prob 加权(MODEL_BOOST), 体现模型方向修正
// edge = p_est·赔率 - 1; 注码 = 分数凯利 KELLY_FRAC · f*, f* = (b·p-(1-p))/b, b=赔率-1
//
// 用法: node 13_bet_strategy.js
//   可调环境变量: BET_BLEND(默认0.5) BET_BOOST(1.3) BET_KELLY(0.25) BET_DAYCAP(0.5)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, '..', 'artifacts');

const BLEND = Number(process.env.BET_BLEND ?? 0.5);    // 模型lean权重(0=纯市场, 1=纯模型)
const MODEL_BOOST = Number(process.env.BET_BOOST ?? 1.3); // 模型所选腿prob加权
const KELLY_FRAC = Number(process.env.BET_KELLY ?? 0.25); // 分数凯利(1/4 Kelly, 防过注)
const DAY_CAP = Number(process.env.BET_DAYCAP ?? 0.5);  // 单日总注码上限(占当前资金比例)
const STAKE_MODE = process.env.BET_STAKE ?? 'flat';     // flat=每注1单位平注; kelly=分数凯利
const BANKROLL0 = 1000;
const KEYS = ['home', 'draw', 'away'];
const HC2OUT = { home_win: 'home', away_win: 'away', draw: 'draw' };

// ---- 读所有预测层产物, 按日期排序 ----
function loadDays() {
  const files = fs.readdirSync(ART)
    .filter(f => /^backtest_r013_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.map(f => {
    const doc = JSON.parse(fs.readFileSync(path.join(ART, f), 'utf8'));
    return { date: f.match(/(\d{4}-\d{2}-\d{2})/)[1], matches: (doc.matches || []).filter(m => m.rqspf && m.actual) };
  }).filter(d => d.matches.length > 0);
}

// ---- rqspf 三路混合概率 ----
function rqspfProbs(m) {
  const o = m.rqspf;
  const r = {}; let Z = 0;
  for (const k of KEYS) { r[k] = 1 / o[k]; Z += r[k]; }
  const pm = {}; for (const k of KEYS) pm[k] = r[k] / Z;        // 市场公平
  const picks = new Set((m.rqspf_picks && m.rqspf_picks.picks) || []);
  const w = {}; let Zw = 0;
  for (const k of KEYS) { w[k] = pm[k] * (picks.has(k) ? MODEL_BOOST : 1); Zw += w[k]; }
  const pmod = {}; for (const k of KEYS) pmod[k] = w[k] / Zw;   // 模型lean
  const p = {}; for (const k of KEYS) p[k] = (1 - BLEND) * pm[k] + BLEND * pmod[k];
  return { p, o, fair: pm, picks };
}
const winnerOf = (m) => HC2OUT[m.actual.handicapResult];
const normScore = (s) => s.split(':').map(x => String(Number(x))).join(':');

// ---- 比分(方向B)串关: 每场取 nScore 个比分(按赔率升序=最可能优先), k串1 全包 ----
function buildBfLines(day, nScore, k) {
  const ms = day.matches.filter(m => Array.isArray(m.bf_picks) && m.bf_picks.length);
  k = Math.min(k, ms.length);
  if (k < 2) return [];
  const perMatch = ms.map((m, i) => ({
    mi: day.matches.indexOf(m),
    legs: m.bf_picks.slice().sort((a, b) => a.odds - b.odds).slice(0, nScore)
      .map(p => ({ score: normScore(p.score), odds: p.odds })),
  }));
  const idxCombos = combos(perMatch.map((_, i) => i), k);
  const lines = [];
  for (const ic of idxCombos) {
    let acc = [[]];
    for (const i of ic) acc = acc.flatMap(pre => perMatch[i].legs.map(l => [...pre, { mi: perMatch[i].mi, ...l }]));
    for (const legs of acc) lines.push({ legs });
  }
  return lines;
}
function backtestBf(days, nScore, k) {
  let staked = 0, returned = 0, lines = 0, won = 0, dayHit = 0, dayPlayed = 0, maxLines = 0;
  for (const day of days) {
    const raw = buildBfLines(day, nScore, k);
    if (!raw.length) continue;
    maxLines = Math.max(maxLines, raw.length);
    let dayWonAny = false;
    for (const line of raw) {
      const win = line.legs.every(leg => normScore(day.matches[leg.mi].actual.score) === leg.score);
      const O = line.legs.reduce((a, l) => a * l.odds, 1);
      staked += 1; lines += 1;
      if (win) { returned += O; won += 1; dayWonAny = true; }
    }
    dayPlayed += 1; if (dayWonAny) dayHit += 1;
  }
  return {
    label: `比分 ${nScore}比分/场 ${k}串1`,
    roi: staked ? (returned - staked) / staked : 0,
    lines, won, lineHit: lines ? won / lines : 0,
    dayHit: dayPlayed ? dayHit / dayPlayed : 0,
    staked, returned, maxLinesPerDay: maxLines,
  };
}

// ---- 组合工具 ----
function combos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...rest] = arr;
  return [...combos(rest, k - 1).map(c => [h, ...c]), ...combos(rest, k)];
}

// ---- 给一天构造"注"(每注 = 跨场的腿组合) ----
// 返回 lines: [{ legs: [{mi, out, odds, p}], }]
function buildLines(day, strategy) {
  const enriched = day.matches.map((m, mi) => ({ mi, m, ...rqspfProbs(m) }));
  const k = Math.min(3, enriched.length);
  if (k < 2) {
    // 不足2场无法串关; 单关策略仍可出
    if (!strategy.startsWith('single') && !strategy.startsWith('cover')) return [];
  }

  // 每场按策略选"代表腿"(单选类策略)
  const pickLeg = (e, mode) => {
    let best = null;
    for (const out of KEYS) {
      const odds = e.o[out], p = e.p[out];
      const edge = p * odds - 1;
      const score = mode === 'odds' ? odds : mode === 'value' ? edge : p; // conviction=按p
      if (!best || score > best.score) best = { mi: e.mi, out, odds, p, score };
    }
    return best;
  };

  if (strategy === 'A_conviction_parlay') {
    const legs = enriched.map(e => pickLeg(e, 'p'));
    return combos(legs, k).map(c => ({ legs: c }));
  }
  if (strategy === 'C_maxodds_parlay') {
    const legs = enriched.map(e => pickLeg(e, 'odds'));
    return combos(legs, k).map(c => ({ legs: c }));
  }
  if (strategy === 'D_value_parlay') {
    const legs = enriched.map(e => pickLeg(e, 'value'));
    return combos(legs, k).map(c => ({ legs: c }));
  }
  if (strategy === 'B_fullcover_parlay') {
    // 每场买模型所选的全部腿(没picks则用全部3路), 串关覆盖所有组合
    const perMatch = enriched.map(e => {
      const outs = e.picks.size ? [...e.picks] : KEYS;
      return outs.map(out => ({ mi: e.mi, out, odds: e.o[out], p: e.p[out] }));
    });
    // 先选哪 k 场, 再笛卡尔展开每场的腿
    const matchCombos = combos(enriched.map(e => e.mi), k);
    const lines = [];
    for (const mc of matchCombos) {
      let acc = [[]];
      for (const mi of mc) {
        const legs = perMatch[enriched.findIndex(e => e.mi === mi)];
        acc = acc.flatMap(prefix => legs.map(l => [...prefix, l]));
      }
      for (const legs of acc) lines.push({ legs });
    }
    return lines;
  }
  if (strategy === 'G_2ends_parlay') {
    // 每场强制选"两端"(赔率最低的2个outcome=最可能的两条), 一张单全包所有 k串1 组合(C(n,k)×2^k 注)
    const perMatch = enriched.map(e => {
      const two = KEYS.map(out => ({ mi: e.mi, out, odds: e.o[out], p: e.p[out] }))
        .sort((a, b) => a.odds - b.odds).slice(0, 2);
      return two;
    });
    const matchCombos = combos(enriched.map(e => e.mi), k);
    const lines = [];
    for (const mc of matchCombos) {
      let acc = [[]];
      for (const mi of mc) {
        const legs = perMatch[enriched.findIndex(e => e.mi === mi)];
        acc = acc.flatMap(prefix => legs.map(l => [...prefix, l]));
      }
      for (const legs of acc) lines.push({ legs });
    }
    return lines;
  }
  if (strategy === 'E_value_single') {
    return enriched.map(e => ({ legs: [pickLeg(e, 'value')] }));
  }
  if (strategy === 'F_cover_single') {
    // 模型所选的每条腿各打一注单关(买两端覆盖)
    const lines = [];
    for (const e of enriched) {
      const outs = e.picks.size ? [...e.picks] : [pickLeg(e, 'p').out];
      for (const out of outs) lines.push({ legs: [{ mi: e.mi, out, odds: e.o[out], p: e.p[out] }] });
    }
    return lines;
  }
  return [];
}

// ---- 注码: 平注(每注1单位) 或 分数凯利 ----
function sizeStake(line, bankroll) {
  const O = line.legs.reduce((a, l) => a * l.odds, 1);
  const P = line.legs.reduce((a, l) => a * l.p, 1);
  const b = O - 1;
  const f = (b * P - (1 - P)) / b; // 凯利最优比例(可负=无优势)
  const edge = P * O - 1;
  if (STAKE_MODE === 'kelly') {
    return { O, P, f, edge, stake: f > 0 ? KELLY_FRAC * f * bankroll : 0 };
  }
  return { O, P, f, edge, stake: 1 }; // 平注: 每注固定1单位
}

// ---- 回测一种策略 ----
function backtest(days, strategy) {
  let bankroll = BANKROLL0, peak = BANKROLL0, maxDD = 0;
  let staked = 0, returned = 0, lines = 0, won = 0, dayHit = 0, dayPlayed = 0;
  let edgeSum = 0, edgePos = 0, edgeN = 0;
  for (const day of days) {
    const raw = buildLines(day, strategy);
    if (!raw.length) continue;
    const sized = raw.map(l => ({ l, ...sizeStake(l, bankroll) }));
    for (const x of sized) { edgeSum += x.edge; edgeN += 1; if (x.edge > 0) edgePos += 1; }
    const active = sized.filter(x => x.stake > 0);
    if (!active.length) continue;
    // 凯利模式: 单日总注码超 DAY_CAP·资金 则等比缩放(平注模式 scale=1)
    const total = active.reduce((a, x) => a + x.stake, 0);
    const cap = DAY_CAP * bankroll;
    const scale = STAKE_MODE === 'kelly' && total > cap ? cap / total : 1;
    let dayStake = 0, dayRet = 0, dayWonAny = false;
    for (const x of active) {
      const stake = x.stake * scale;
      const win = x.l.legs.every(leg => winnerOf(day.matches[leg.mi]) === leg.out);
      dayStake += stake; lines += 1;
      if (win) { dayRet += stake * x.O; won += 1; dayWonAny = true; }
    }
    bankroll += dayRet - dayStake;
    staked += dayStake; returned += dayRet;
    dayPlayed += 1; if (dayWonAny) dayHit += 1;
    peak = Math.max(peak, bankroll);
    maxDD = Math.max(maxDD, peak > 0 ? (peak - bankroll) / peak : 0);
  }
  return {
    strategy,
    roi: staked > 0 ? (returned - staked) / staked : 0,
    growth: bankroll / BANKROLL0 - 1,
    lines, won, lineHit: lines ? won / lines : 0,
    dayHit: dayPlayed ? dayHit / dayPlayed : 0,
    staked, returned, maxDD,
    avgEdge: edgeN ? edgeSum / edgeN : 0, edgePosPct: edgeN ? edgePos / edgeN : 0,
  };
}

// ---- 主流程 ----
const days = loadDays();
const totalMatches = days.reduce((a, d) => a + d.matches.length, 0);
console.log(`\n# 投注策略回测 (${days.length} 天 / ${totalMatches} 场 / rqspf 让球)`);
console.log(`注码模式: ${STAKE_MODE === 'kelly' ? `分数凯利(${KELLY_FRAC})` : '平注(每注1单位)'} | 概率: BLEND=${BLEND}(模型权重) BOOST=${MODEL_BOOST}\n`);

const STRATS = [
  ['A_conviction_parlay', 'A 挑着买    (每场1条最稳腿, k串1单注链)'],
  ['G_2ends_parlay', 'G 两端全包  (每场选2端, 一张单C(n,k)×2^k全包)'],
  ['B_fullcover_parlay', 'B 模型腿全包(每场买模型所选腿, 覆盖组合)'],
  ['C_maxodds_parlay', 'C 最高赔串关(每场最高赔腿, 6-17亏的那种)'],
  ['D_value_parlay', 'D 价值串关  (每场edge最高腿, k串1)'],
  ['E_value_single', 'E 价值单关  (每场edge最高腿, 各打单关)'],
  ['F_cover_single', 'F 两端单关  (所选每条腿各打单关, 覆盖)'],
];

const rows = STRATS.map(([id, label]) => ({ label, ...backtest(days, id) }));
console.log('| 策略 | ROI | 注数 | 注命中% | 日命中% | 投入 | 回收 | 净盈亏 | 正edge腿% |');
console.log('|------|-----|------|---------|---------|------|------|--------|-----------|');
for (const r of rows) {
  const pnl = r.returned - r.staked;
  console.log(`| ${r.label} | ${(r.roi * 100).toFixed(1)}% | ${r.lines} | ${(r.lineHit * 100).toFixed(0)}% | ${(r.dayHit * 100).toFixed(0)}% | ${r.staked.toFixed(0)} | ${r.returned.toFixed(0)} | ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)} | ${(r.edgePosPct * 100).toFixed(0)}% |`);
}
console.log('\n说明(平注每注1单位): ROI=回收/投入-1; 净盈亏=回收-投入(单位数);');
console.log('注命中%=中奖注数/总注数; 日命中%=至少中一注的天数/投注天数(体现"不放过可能性");');
console.log('正edge腿%=p_est·赔率>1 的腿占比(凯利只投这些; 比例低=模型相对市场优势不明显)。\n');

// ===== 比分(方向B)串关: 每场买几个比分 × 几串1 的成本/回报对比 =====
console.log('# 比分(方向B)串关: 成本 vs 回报 (平注每注1单位=2元)\n');
console.log('| 买法 | 单日最多注数 | 总注数 | 注命中% | 日命中% | 投入(元) | 回收(元) | ROI |');
console.log('|------|--------------|--------|---------|---------|----------|----------|-----|');
const BF = [[1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 3], [3, 4]];
for (const [n, k] of BF) {
  const r = backtestBf(days, n, k);
  console.log(`| ${r.label} | ${r.maxLinesPerDay} | ${r.lines} | ${(r.lineHit * 100).toFixed(0)}% | ${(r.dayHit * 100).toFixed(0)}% | ${(r.staked * 2).toFixed(0)} | ${(r.returned * 2).toFixed(0)} | ${(r.roi * 100).toFixed(1)}% |`);
}
console.log('\n比分串关结论: 注数 = C(场数,串数)×(每场比分数)^串数, 随"比分数"和"串数"指数爆炸。');
console.log('单日最多注数 = 4场全买3比分时的注数(2元/注 → 乘2即金额)。\n');
