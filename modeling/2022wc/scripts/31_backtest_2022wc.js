#!/usr/bin/env node
/**
 * 31_backtest_2022wc.js — 2022 卡塔尔世界杯 31号策略回测
 *
 * 数据源（全部限制在 2022wc 目录下，与 2026 完全隔离）:
 *   data/2022wc/odds/<mid>.json     — 5 玩法赔率
 *   data/2022wc/results/<mid>.json   — 完赛结果（lottery 字段为 5 玩法官方赛果）
 *   data/2022wc/teams/_index.json   — 32 队 (tier / has_scorer_star / wc2022 赛果)
 *   data/2022wc/teams/<CODE>.json   — 32 个 team 文件
 *
 * 赛果读取走 lottery 字段（更准确，尤其是 BQC 不需要半场比分也能从 HAFU.combination 拿到）:
 *   lottery.HAD.combination     → "H" / "D" / "A"   (胜平负)
 *   lottery.HHAD.combination    → "H" / "D" / "A"   (让球胜平负: H=让胜 D=让平 A=让负)
 *   lottery.CRS.combination     → "2:0" 等           (比分)
 *   lottery.TTG.combination     → "0"-"7+"           (总进球)
 *   lottery.HAFU.combination    → "H:H" 等           (半全场: 半场字母:全场字母)
 *
 * 策略函数: 来自 ./strategy_core.js（modeling/scripts/strategy_core.js 的本地副本, 753 行完全一致）
 *   调试修改这里的 strategy_core.js 不会影响 2026 脚本
 *
 * 用法:
 *   node modeling/2022wc/scripts/31_backtest_2022wc.js                    # 默认 64 场全部
 *   node modeling/2022wc/scripts/31_backtest_2022wc.js --round=1          # 仅小组赛第 1 轮 (8 场)
 *   node modeling/2022wc/scripts/31_backtest_2022wc.js --round=1 --all    # 同上, --all 显式禁用过滤
 *   node modeling/2022wc/scripts/31_backtest_2022wc.js --stage=r16        # 仅 1/8 决赛 (8 场)
 *   node modeling/2022wc/scripts/31_backtest_2022wc.js --round=1 --stage=group   # 组合过滤
 *
 * 过滤参数:
 *   --round=N         小组赛第 N 轮 (N=1/2/3), 隐含 stage=group
 *   --stage=XXX       stage 过滤 (group/r16/qf/sf/third/final)
 *   --all             显式跑全部 64 场
 *
 * 注意: 策略函数从 ./strategy_core.js 导入, 是 modeling/scripts/strategy_core.js 的本地副本
 *       调试修改这里的 strategy_core.js 不会影响 2026 脚本
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_PARAMS, mergeParams,
  classifyMatch, f4Strategy, generateCombos,
  rqspfStrategy, zjqStrategy, bqcStrategy, singleBetStrategy,
  selectBets, settleBets, groupByDay,
  buildPrediction,
} from './strategy_core.js'; // 2022 专属本地副本, 调试改动不会污染 2026

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const WC2022_DIR = path.join(PROJECT_ROOT, 'data', '2022wc');
const ODDS_DIR = path.join(WC2022_DIR, 'odds');
const RESULTS_DIR = path.join(WC2022_DIR, 'results');
const TEAMS_DIR = path.join(WC2022_DIR, 'teams');
const ARTIFACTS_DIR = path.join(__dirname, '..', 'artifacts');

// 球队上下文: 走 2022 专属 data/2022wc/teams/ (32 队 + 2022 tier 划分 + 6 个原 2026 缺失队 WAL/POL/DEN/CRC/CMR/SRB)
// 这是 strategy_core.createTeamCtx 的本地版, 唯一差别是 teams 目录从 PROJECT_ROOT/data/teams 改为 TEAMS_DIR
function createTeamCtx2022wc(TEAMS_DIR) {
  const idx = JSON.parse(fs.readFileSync(path.join(TEAMS_DIR, '_index.json'), 'utf-8'));
  const codeByTier = idx.by_tier || {};
  const tierOfCode = {};
  for (const [tier, codes] of Object.entries(codeByTier)) for (const c of codes) tierOfCode[c] = tier;
  const codeByName = idx.by_name || {};
  const variants = idx.name_variants_to_code || {};
  const scorerStarCodes = new Set();
  const nameToTier = {};
  for (const [code, rel] of Object.entries(idx.by_code || {})) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(TEAMS_DIR, rel), 'utf-8'));
      if (t.meta?.has_scorer_star === true) scorerStarCodes.add(code);
      if (t.name && tierOfCode[code]) nameToTier[t.name] = tierOfCode[code];
    } catch (e) { /* ignore */ }
  }
  for (const [alias, code] of Object.entries(variants)) if (tierOfCode[code]) nameToTier[alias] = tierOfCode[code];
  const codeOf = (teamName) => (teamName ? (codeByName[teamName] || null) : null);
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
const { getTeamTier, hasScorerStar } = createTeamCtx2022wc(TEAMS_DIR);

// 策略参数：先找 2022 专属 fit 产物，没有则用 2026 fit 产物，最后用 DEFAULT_PARAMS
function loadStrategyParams() {
  const candidates = [
    path.join(ARTIFACTS_DIR, 'strategy_params.json'),
    path.join(PROJECT_ROOT, 'modeling', 'artifacts', 'strategy_params.json'),
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      try {
        const fit = JSON.parse(fs.readFileSync(f, 'utf-8'));
        const params = mergeParams(DEFAULT_PARAMS, fit.params || fit);
        console.log(`[策略参数] 已加载 fit 产物 ${path.relative(PROJECT_ROOT, f)}`
          + (fit.fitted_at ? ` (拟合于 ${fit.fitted_at}, 基于 ${fit.sample_size ?? '?'} 场)` : ''));
        return params;
      } catch (e) {
        console.error(`⚠️ 加载 ${f} 失败, 继续尝试下一个: ${e.message}`);
      }
    }
  }
  console.log('[策略参数] 未找到 fit 产物, 使用 DEFAULT_PARAMS (默认硬编码值)');
  return mergeParams(DEFAULT_PARAMS, null);
}
const STRATEGY_CTX = {
  params: loadStrategyParams(),
  getTeamTier,
  hasScorerStar,
};

// ============== 2022 专属：加载比赛 + lottery 字段映射 ==============

// HHAD.combination (H=让胜 D=让平 A=让负) → rqResult (home/draw/away)
const HHAD_TO_DIR = { H: 'home', D: 'draw', A: 'away' };

// HAFU.combination (半场字母:全场字母) → 中文 ("胜胜" 等)
const HAFU_TO_CN = {
  'H:H': '胜胜', 'H:D': '胜平', 'H:A': '胜负',
  'D:H': '平胜', 'D:D': '平平', 'D:A': '平负',
  'A:H': '负胜', 'A:D': '负平', 'A:A': '负负',
};

// 从 label 解析 stage / group / round
//   2022-A1  → { stage: 'group', group: 'A', round: 1, labelNum: 1 }
//   2022-A2  → { stage: 'group', group: 'A', round: 1, labelNum: 2 }  (A1+A2 同一轮)
//   2022-A3  → { stage: 'group', group: 'A', round: 2, labelNum: 3 }
//   2022-A4  → { stage: 'group', group: 'A', round: 2, labelNum: 4 }
//   2022-A5  → { stage: 'group', group: 'A', round: 3, labelNum: 5 }
//   2022-A6  → { stage: 'group', group: 'A', round: 3, labelNum: 6 }
//   2022-R16-1 → { stage: 'r16' }
//   2022-QF-1  → { stage: 'qf' }
//   2022-SF-1  → { stage: 'sf' }
//   2022-3RD   → { stage: 'third' }
//   2022-FINAL → { stage: 'final' }
//
// round 规则: 标准 WC 小组赛每轮 16 场 (8 组 × 2 场), 即每组每轮打 2 场
//   label 1,2 → round 1   (小组赛第 1 轮, 16 场)
//   label 3,4 → round 2   (小组赛第 2 轮, 16 场)
//   label 5,6 → round 3   (小组赛第 3 轮, 16 场)
function parseLabelMeta(code) {
  if (!code) return { stage: 'unknown' };
  const m = code.match(/^2022-([A-H])([1-6])$/);
  if (m) {
    const group = m[1];
    const labelNum = parseInt(m[2]);
    const round = Math.ceil(labelNum / 2);
    return { stage: 'group', group, labelNum, round };
  }
  if (/^2022-R16-\d+$/.test(code)) return { stage: 'r16' };
  if (/^2022-QF-\d+$/.test(code))  return { stage: 'qf' };
  if (/^2022-SF-\d+$/.test(code))  return { stage: 'sf' };
  if (code === '2022-3RD')   return { stage: 'third' };
  if (code === '2022-FINAL') return { stage: 'final' };
  return { stage: 'unknown' };
}

// 解析 CLI 参数: --round=N / --stage=XXX / --all
function parseCli() {
  const opts = { round: null, stage: null, all: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--all') { opts.round = null; opts.stage = null; opts.all = true; }
    else if (a.startsWith('--round=')) opts.round = parseInt(a.slice(8));
    else if (a.startsWith('--stage=')) opts.stage = a.slice(8);
  }
  return opts;
}

function load2022wcMatches() {
  const out = [];
  for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
    const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
    if (!oddsDoc.basic) continue;
    const mid = oddsDoc.basic.mid;
    const resultPath = path.join(RESULTS_DIR, mid + '.json');
    if (!fs.existsSync(resultPath)) continue;
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    if (!result.lottery) continue;
    const L = result.lottery;

    // 5 玩法赛果（lottery 是官方结算结果，比从 homeScore/awayScore 推导更准：
    // ① BQC 不需要半场比分；② HHAD 已含 handicap；③ CRS 反映 90+加时 比分）
    const hadActual  = L.HAD?.combination  || null;   // H/D/A
    const hhadActual = L.HHAD?.combination || null;   // H/D/A (让球后方向)
    // CRS 玩法的高比分场会用 "胜其它"(-1:-H) / "平其它"(-1:-D) / "负其它"(-1:-A) 替代真实比分
    // 此时退到 homeScore/awayScore 拿精确比分
    let crsActual  = L.CRS?.combination  || null;   // "2:0" 或 "-1:-H"
    const ttgActual  = L.TTG?.combination  || null;   // "0"-"7+"
    const hafuActual = L.HAFU?.combination || null;   // "H:H"

    // 兼容字段：从 homeScore/awayScore 拆出 actualHome/actualAway
    let actualHome = result.homeScore, actualAway = result.awayScore;
    // 把 CRS "胜其它" 等还原成具体比分（主池比较用）
    if (crsActual && /^-?\d+:-?[HDA]$/.test(crsActual)) {
      crsActual = `${actualHome}:${actualAway}`;
    }

    const meta = parseLabelMeta(oddsDoc.basic.code);
    out.push({
      mid,
      code: oddsDoc.basic.code,
      ...meta,  // stage / group / round
      home: oddsDoc.basic.home,
      away: oddsDoc.basic.away,
      match: `${oddsDoc.basic.home}vs${oddsDoc.basic.away}`,
      kickoff: oddsDoc.basic.kickoff,
      handicap: oddsDoc.odds?.handicap ?? 0,
      bf: oddsDoc.odds?.bf_latest,
      rqspf: oddsDoc.odds?.rqspf_latest,
      zjq: oddsDoc.odds?.zjq_latest,
      bqc: oddsDoc.odds?.bqc_latest,
      // lottery 字段直接挂载
      lottery: L,
      hadActual, hhadActual, crsActual, ttgActual, hafuActual,
      // 兼容字段
      actualHome, actualAway,
      halfTime: null,  // 2022 没有半场数据，BQC 走 HAFU
      wentToPenalties: result.wentToPenalties,
    });
  }
  return out;
}

// 2022 专属 deriveActual：所有玩法都从 lottery 字段拿，不依赖 halfTime
function deriveActual2022wc(m) {
  return {
    score: m.crsActual || `${m.actualHome}:${m.actualAway}`,
    rqResult: m.hhadActual ? (HHAD_TO_DIR[m.hhadActual] || null) : null,
    zjqResult: m.ttgActual || null,
    bqcResult: m.hafuActual ? (HAFU_TO_CN[m.hafuActual] || null) : null,
  };
}

// ============== 回测主流程 ==============
function runBacktest() {
  let matches_ = load2022wcMatches();
  if (matches_.length === 0) {
    console.log('无 2022 历史比赛可回测');
    return;
  }

  // CLI 过滤
  const cli = parseCli();
  const filterDesc = [];
  if (cli.round) {
    matches_ = matches_.filter(m => m.stage === 'group' && m.round === cli.round);
    filterDesc.push(`小组赛第 ${cli.round} 轮`);
  }
  if (cli.stage) {
    matches_ = matches_.filter(m => m.stage === cli.stage);
    filterDesc.push(`stage=${cli.stage}`);
  }
  if (filterDesc.length === 0) filterDesc.push('全部 64 场');
  if (matches_.length === 0) {
    console.log(`无匹配 [${filterDesc.join(' + ')}] 的比赛`);
    return;
  }

  // 把回测报告 tee 到 buffer, 结束时落盘成 Markdown
  const _origLog = console.log;
  const _report = [];
  console.log = (...args) => { _report.push(args.map(String).join(' ')); _origLog(...args); };

  console.log(`\n# 2022 卡塔尔世界杯 31号策略 回测\n`);
  console.log(`样本: ${matches_.length} 场 (${filterDesc.join(' + ')})`);
  console.log(`赛果来源: data/2022wc/results/<mid>.json 的 lottery 字段`);
  console.log(`策略参数源: ${
    fs.existsSync(path.join(ARTIFACTS_DIR, 'strategy_params.json')) ? '2022 专属 fit' :
    fs.existsSync(path.join(PROJECT_ROOT, 'modeling', 'artifacts', 'strategy_params.json')) ? '2026 fit 共享' :
    'DEFAULT_PARAMS 默认'
  }`);

  // ============== Part 1: 主池 (F4) / 单关 ROI ==============
  let mainCost = 0, mainReturn = 0, mainHits = 0;
  const details = [];
  for (const m of matches_) {
    mainCost += 3;
    const picks = f4Strategy(m, STRATEGY_CTX);
    const act = deriveActual2022wc(m);
    const hit = picks.find(p => p.score === act.score);
    if (hit) { mainReturn += hit.odds; mainHits++; }
    details.push({
      code: m.code, match: `${m.home}vs${m.away}`, type: classifyMatch(m, STRATEGY_CTX),
      actual: act.score, picks: picks.map(p => `${p.score}@${p.odds}`),
      hit: !!hit, hitOdds: hit ? hit.odds : 0,
    });
  }

  let singleCost = 0, singleReturn = 0, singleHits = 0;
  for (const m of matches_) {
    const picks = f4Strategy(m, STRATEGY_CTX);
    const singles = singleBetStrategy(m, picks, STRATEGY_CTX);
    if (singles.length === 0) continue;
    const act = deriveActual2022wc(m);
    singleCost += singles.length;
    const hit = singles.find(p => p.score === act.score);
    if (hit) { singleReturn += hit.odds; singleHits++; }
  }

  console.log(`\n## 31号策略 回测 (${matches_.length} 场)\n`);
  console.log(`| 部分 | 命中 | 投入 | 回报 | ROI |`);
  console.log(`|------|------|------|------|-----|`);
  console.log(`| 主池(F4) | ${mainHits}/${matches_.length} | $${mainCost} | $${mainReturn.toFixed(2)} | ${mainCost > 0 ? ((mainReturn - mainCost) / mainCost * 100).toFixed(0) : 0}% |`);
  console.log(`| 单关 | ${singleHits} | $${singleCost} | $${singleReturn.toFixed(2)} | ${singleCost > 0 ? ((singleReturn - singleCost) / singleCost * 100).toFixed(0) : 0}% |`);
  const totalCost = mainCost + singleCost;
  const totalReturn = mainReturn + singleReturn;
  console.log(`| **合计** | - | **$${totalCost}** | **$${totalReturn.toFixed(2)}** | **${totalCost > 0 ? ((totalReturn - totalCost) / totalCost * 100).toFixed(0) : 0}%** |`);

  console.log(`\n### 每场详情\n`);
  console.log(`| 场次 | 对阵 | 类型 | 实际 | 主池3比分 | 命中? |`);
  for (const d of details) {
    console.log(`| ${d.code} | ${d.match} | ${d.type} | ${d.actual} | ${d.picks.join(' ')} | ${d.hit ? `✅@${d.hitOdds}` : '❌'} |`);
  }

  // ============== Part 2: RQSPF / ZJQ / BQC 跟投 + 纠偏 ==============
  console.log(`\n## 31号策略 跟投 + 纠偏回测 (RQSPF / ZJQ / BQC)\n`);

  // RQSPF 跟投
  const rqspfBack = matches_.map(m => {
    const rq = m.rqspf;
    if (!rq || !rq.home || !rq.draw || !rq.away) return null;
    const act = deriveActual2022wc(m);
    if (!act.rqResult) return null;
    const strategy = rqspfStrategy({ rqspf: { home: rq.home, draw: rq.draw, away: rq.away } }, STRATEGY_CTX);
    if (!strategy) return null;
    const hit = strategy.primary.d === act.rqResult;
    const odds = strategy.primary.odds;
    return { match: m, rq, rqResult: act.rqResult, strategy, hit, odds, rule: strategy.rule };
  }).filter(Boolean);

  if (rqspfBack.length > 0) {
    const n = rqspfBack.length;
    const hits = rqspfBack.filter(x => x.hit).length;
    const cost = n;
    const ret = rqspfBack.filter(x => x.hit).reduce((s, x) => s + x.odds, 0);
    const roi = (ret - cost) / cost * 100;
    const corrN = rqspfBack.filter(x => x.rule.name.includes('纠偏')).length;
    const corrHits = rqspfBack.filter(x => x.rule.name.includes('纠偏') && x.hit).length;
    const corrCost = corrN;
    const corrRet = rqspfBack.filter(x => x.rule.name.includes('纠偏') && x.hit).reduce((s, x) => s + x.odds, 0);
    const corrRoi = corrCost > 0 ? (corrRet - corrCost) / corrCost * 100 : 0;
    console.log(`### RQSPF 跟投 (基线+16.6% / 纠偏+20.5%)\n`);
    console.log(`| 范围 | 命中 | 投入 | 回报 | ROI |`);
    console.log(`|------|------|------|------|-----|`);
    console.log(`| 全部 (${n}场) | ${hits} | $${cost} | $${ret.toFixed(2)} | ${roi.toFixed(1)}% |`);
    if (corrN > 0) console.log(`| 纠偏命中 (${corrN}场) | ${corrHits} | $${corrCost} | $${corrRet.toFixed(2)} | ${corrRoi.toFixed(1)}% |`);
  }

  // ZJQ 跟投
  const zjqBack = matches_.map(m => {
    const zjq = m.zjq;
    if (!zjq) return null;
    const act = deriveActual2022wc(m);
    if (!act.zjqResult) return null;
    const result = act.zjqResult;
    const strategy = zjqStrategy(m, STRATEGY_CTX);
    if (!strategy) return null;
    let picks, oddsMap, isCorrected = false;
    if (strategy.corrected?.picks) {
      picks = strategy.corrected.picks;
      oddsMap = strategy.corrected.odds;
      isCorrected = true;
    } else if (strategy.corrected?.pick) {
      picks = [strategy.corrected.pick];
      oddsMap = { [strategy.corrected.pick]: strategy.corrected.odds };
      isCorrected = true;
    } else {
      picks = [strategy.stable];
      oddsMap = { [strategy.stable]: strategy.stableOdds };
    }
    const cost = picks.length;
    const hit = picks.includes(result);
    const odds = hit ? (oddsMap[result] || 0) : 0;
    return { match: m, zjq, result, strategy, hit, cost, odds, rule: strategy.rule, isCorrected };
  }).filter(Boolean);

  if (zjqBack.length > 0) {
    const n = zjqBack.length;
    const hits = zjqBack.filter(x => x.hit).length;
    const cost = zjqBack.reduce((s, x) => s + x.cost, 0);
    const ret = zjqBack.filter(x => x.hit).reduce((s, x) => s + x.odds, 0);
    const roi = cost > 0 ? (ret - cost) / cost * 100 : 0;
    const corrN = zjqBack.filter(x => x.isCorrected).length;
    const corrHits = zjqBack.filter(x => x.isCorrected && x.hit).length;
    const corrCost = zjqBack.reduce((s, x) => x.isCorrected ? s + x.cost : s, 0);
    const corrRet = zjqBack.filter(x => x.isCorrected && x.hit).reduce((s, x) => s + x.odds, 0);
    const corrRoi = corrCost > 0 ? (corrRet - corrCost) / corrCost * 100 : 0;
    console.log(`\n### ZJQ 跟投 (基线+3.1% / 纠偏+24.7%)\n`);
    console.log(`| 范围 | 命中 | 投入 | 回报 | ROI |`);
    console.log(`|------|------|------|------|-----|`);
    console.log(`| 全部 (${n}场) | ${hits} | $${cost} | $${ret.toFixed(2)} | ${roi.toFixed(1)}% |`);
    if (corrN > 0) console.log(`| 纠偏命中 (${corrN}场) | ${corrHits} | $${corrCost} | $${corrRet.toFixed(2)} | ${corrRoi.toFixed(1)}% |`);
  }

  // BQC 跟投
  const bqcBack = matches_.map(m => {
    const bqc = m.bqc;
    if (!bqc) return null;
    const act = deriveActual2022wc(m);
    if (!act.bqcResult) return null;
    const result = act.bqcResult;
    const strategy = bqcStrategy(m, STRATEGY_CTX);
    if (!strategy) return null;
    const picks = strategy.corrected ? strategy.corrected.picks : strategy.top3.map(x => x.key);
    const hit = picks.includes(result);
    const cost = picks.length;
    const odds = strategy.corrected
      ? strategy.corrected.odds[result] || 0
      : strategy.top3.find(x => x.key === result)?.odds || 0;
    return { match: m, bqc, result, strategy, hit, cost, odds, rule: strategy.rule };
  }).filter(Boolean);

  if (bqcBack.length > 0) {
    const totalCost = bqcBack.reduce((s, x) => s + x.cost, 0);
    const totalRet = bqcBack.filter(x => x.hit).reduce((s, x) => s + x.odds, 0);
    const totalHits = bqcBack.filter(x => x.hit).length;
    const roi = totalCost > 0 ? (totalRet - totalCost) / totalCost * 100 : 0;
    const corrN = bqcBack.filter(x => x.rule.name.includes('纠偏')).length;
    const corrHits = bqcBack.filter(x => x.rule.name.includes('纠偏') && x.hit).length;
    const corrCost = bqcBack.reduce((s, x) => x.rule.name.includes('纠偏') ? s + x.cost : s, 0);
    const corrRet = bqcBack.filter(x => x.rule.name.includes('纠偏') && x.hit).reduce((s, x) => s + x.odds, 0);
    const corrRoi = corrCost > 0 ? (corrRet - corrCost) / corrCost * 100 : 0;
    console.log(`\n### BQC 跟投 (基线-10% / 纠偏+110.4%)\n`);
    console.log(`| 范围 | 命中 | 投入 | 回报 | ROI |`);
    console.log(`|------|------|------|------|-----|`);
    console.log(`| 全部 (${bqcBack.length}场) | ${totalHits} | $${totalCost} | $${totalRet.toFixed(2)} | ${roi.toFixed(1)}% |`);
    if (corrN > 0) console.log(`| 纠偏命中 (${corrN}场) | ${corrHits} | $${corrCost} | $${corrRet.toFixed(2)} | ${corrRoi.toFixed(1)}% |`);
  }

  // ============== Part 3: Part1 逐场明细 (rqspf 选项&命中 + 3 比分&命中) ==============
  const PCK = STRATEGY_CTX.params.picker;
  console.log(`\n## Part1 逐场明细 (rqspf选项&命中 + 3比分&命中 + 信号) —— ${matches_.length} 场\n`);
  console.log(`| 场次 | 对阵 | hc | 实际 | rqspf主/次 | rq命中 | 3比分 | 比分命中 | 信号(高倍/zjq/bqc) |`);
  console.log(`|------|------|----|------|-----------|--------|-------|----------|--------------------|`);

  const RQ_LABEL = { home: '让胜', draw: '让平', away: '让负' };
  let rqN = 0, rqHitP = 0, rqRetP = 0;
  let rqHit2 = 0, rqRet2 = 0;
  let bf3N = 0, bf3Cost = 0, bf3Ret = 0, bf3Hit = 0;

  for (const m of matches_) {
    const pred = buildPrediction(m, STRATEGY_CTX);
    const act = deriveActual2022wc(m);
    let rqCell = '-', rqHitMark = '-';
    if (pred.rq) {
      const P = pred.rq.primary, S = pred.rq.secondary;
      rqCell = `${P.label}@${P.odds} / ${S.label}@${S.odds}`;
      rqN++;
      if (P.d === act.rqResult) {
        rqHitMark = `✅主@${P.odds}`;
        rqHitP++; rqRetP += P.odds; rqHit2++; rqRet2 += P.odds;
      } else if (S.d === act.rqResult) {
        rqHitMark = `✅次@${S.odds}`;
        rqHit2++; rqRet2 += S.odds;
      } else {
        rqHitMark = `❌(实际${RQ_LABEL[act.rqResult] || act.rqResult || '?'})`;
      }
    }
    const bf3 = pred.mainPicks || [];
    const bfCell = bf3.map(p => `${p.score}@${p.odds}`).join(' ');
    const bfHitPick = bf3.find(p => p.score === act.score);
    const bfHitMark = bfHitPick ? `✅@${bfHitPick.odds}` : '❌';
    if (bf3.length > 0) {
      bf3N++; bf3Cost += bf3.length;
      if (bfHitPick) { bf3Hit++; bf3Ret += bfHitPick.odds; }
    }
    const sig = [];
    if (bf3.some(p => p.odds >= PCK.cat3.oddsThreshold)) sig.push('高倍比分');
    if (pred.z?.corrected) sig.push('zjq纠偏');
    if (pred.b?.corrected) sig.push('bqc纠偏');
    console.log(`| ${m.code} | ${m.match} | ${m.handicap} | ${act.score} | ${rqCell} | ${rqHitMark} | ${bfCell} | ${bfHitMark} | ${sig.join('/') || '-'} |`);
  }

  console.log(`\n### Part1 重点指标 (回测调优目标)\n`);
  console.log(`| 指标 | 命中/场次 | 命中率 | 投入 | 回报 | ROI |`);
  console.log(`|------|-----------|--------|------|------|-----|`);
  const rqRoiP = rqN > 0 ? ((rqRetP - rqN) / rqN * 100).toFixed(1) : '0';
  console.log(`| rqspf 主选 | ${rqHitP}/${rqN} | ${rqN > 0 ? (rqHitP / rqN * 100).toFixed(1) : 0}% | $${rqN} | $${rqRetP.toFixed(2)} | ${rqRoiP}% |`);
  const rqCost2 = rqN * 2;
  const rqRoi2 = rqCost2 > 0 ? ((rqRet2 - rqCost2) / rqCost2 * 100).toFixed(1) : '0';
  console.log(`| rqspf 主+次(各1注) | ${rqHit2}/${rqN} | ${rqN > 0 ? (rqHit2 / rqN * 100).toFixed(1) : 0}% | $${rqCost2} | $${rqRet2.toFixed(2)} | ${rqRoi2}% |`);
  const bfRoi = bf3Cost > 0 ? ((bf3Ret - bf3Cost) / bf3Cost * 100).toFixed(1) : '0';
  console.log(`| 3比分单关 | ${bf3Hit}/${bf3N} | ${bf3N > 0 ? (bf3Hit / bf3N * 100).toFixed(1) : 0}% | $${bf3Cost} | $${bf3Ret.toFixed(2)} | ${bfRoi}% |`);

  // ============== Part 4: Part2 选单回测 (按天 selectBets + settleBets) ==============
  const byDay = groupByDay(matches_);
  const agg = { cat1: { cost: 0, ret: 0, hits: 0, n: 0 }, cat2: { cost: 0, ret: 0, hits: 0, n: 0 }, cat3: { cost: 0, ret: 0, hits: 0, n: 0 }, cat4: { cost: 0, ret: 0, hits: 0, n: 0 }, cat5: { cost: 0, ret: 0, hits: 0, n: 0 } };
  let dayCount = 0;
  for (const [, dayMatches] of byDay) {
    dayCount++;
    const preds = dayMatches.map(m => buildPrediction(m, STRATEGY_CTX));
    const cats = selectBets(preds, STRATEGY_CTX);
    const actualByCode = {};
    for (const m of dayMatches) actualByCode[m.code] = deriveActual2022wc(m);
    const settled = settleBets(cats, actualByCode);
    for (const k of Object.keys(agg)) {
      agg[k].cost += settled[k].cost; agg[k].ret += settled[k].ret;
      agg[k].hits += settled[k].hits; agg[k].n += settled[k].n;
    }
  }

  console.log(`\n## Part2 选单回测 (按天选单, ${dayCount} 天 / ${matches_.length} 场)\n`);
  console.log(`| 类别 | 注数 | 命中 | 投入 | 回报 | ROI |`);
  console.log(`|------|------|------|------|------|-----|`);
  const labels = { cat1: '① rqspf 3串1', cat2: '② 比分 2串1', cat3: '③ 高倍比分单', cat4: '④ zjq 单关', cat5: '⑤ bqc 单关' };
  for (const k of ['cat1', 'cat2', 'cat3', 'cat4', 'cat5']) {
    const c = agg[k];
    const roi = c.cost > 0 ? ((c.ret - c.cost) / c.cost * 100).toFixed(1) : '-';
    const warn = (c.n > 0 && c.n < 5) ? ' ⚠️样本<5' : '';
    console.log(`| ${labels[k]} | ${c.n} | ${c.hits} | $${c.cost} | $${c.ret.toFixed(2)} | ${roi}%${warn} |`);
  }

  // ============== 落盘 Markdown ==============
  console.log = _origLog;
  try {
    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace(/[:]/g, '');
    // 报告里已经有 "# 2022 卡塔尔世界杯 31号策略 回测" 标题了, 这里只写生成时间戳
    const header = `# 2022 卡塔尔世界杯 31号策略 回测\n\n生成时间: ${now.toISOString()}\n`;
    const outPath = path.join(ARTIFACTS_DIR, `backtest_31_2022wc_${ts}.md`);
    // 用 header 的 # 标题覆盖 report buffer 里的 # 标题, 避免重复
    const reportBody = _report.join('\n').replace(/^\n?# 2022 卡塔尔世界杯 31号策略 回测\n*/, '').trimStart();
    fs.writeFileSync(outPath, header + '\n' + reportBody + '\n', 'utf-8');
    // 轮换: 只保留最近 2 份
    const olds = fs.readdirSync(ARTIFACTS_DIR)
      .filter(f => /^backtest_31_2022wc_.*\.md$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(ARTIFACTS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(2);
    for (const o of olds) fs.unlinkSync(path.join(ARTIFACTS_DIR, o.f));
    console.log(`\n回测报告写入: ${path.relative(PROJECT_ROOT, outPath)}  (仅保留最近 2 份)`);
  } catch (e) {
    console.error(`⚠️ 回测报告落盘失败: ${e.message}`);
  }
}

runBacktest();
