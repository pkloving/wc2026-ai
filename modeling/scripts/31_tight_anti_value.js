// 31_tight_anti_value.js — 主模型策略脚本
// 核心策略: 主池=F4混合 (ROI+134%) + 单关=反方向/平局高赔率比分 (爆冷门)
// 用法:
//   node modeling/scripts/31_tight_anti_value.js --predict    (默认, 预测今日比赛)
//   node modeling/scripts/31_tight_anti_value.js --backtest   (回测历史比赛)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_PARAMS, mergeParams, createTeamCtx,
  classifyMatch, f4Strategy, generateCombos,
  rqspfStrategy, zjqStrategy, bqcStrategy, singleBetStrategy,
} from './strategy_core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'modeling', 'artifacts');
const SETTLED_FILE = path.join(PROJECT_ROOT, 'data', 'settled_matches.json');
const INSIGHTS_FILE = path.join(ARTIFACTS_DIR, 'roi_insights.json');

// ============== 入口前增量更新赛果汇总 ==============
// 跑回测/预测前，先把 data/results/ 里新增的完赛比赛拼到 data/settled_matches.json
// 这样后续模型要找"赔率变化 → 命中"规律时，能拿到完整数据
// 失败不阻塞建模（仅 warning）
try {
  const r = spawnSync('node', [path.join(PROJECT_ROOT, 'scripts', 'build_settled.js'), '--incremental'], {
    cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000,
  });
  if (r.status === 0) {
    process.stdout.write(r.stdout || '');
  } else {
    process.stderr.write(`⚠️  build_settled 退出码 ${r.status}：${r.stderr || ''}\n`);
  }
} catch (e) {
  process.stderr.write(`⚠️  build_settled 调用失败：${e.message}\n`);
}

// ============== 入口前按玩法维度拆视图文件 ==============
// 把 settled_matches 拆成 data/views/{spf,rqspf,bf,zjq,bqc}_view.json
// 方便手工 query / 验证 / 调试 (避免每次都走大源文件)
try {
  const r = spawnSync('node', [path.join(PROJECT_ROOT, 'scripts', 'build_views.js')], {
    cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000,
  });
  if (r.status === 0) {
    process.stdout.write(r.stdout || '');
  } else {
    process.stderr.write(`⚠️  build_views 退出码 ${r.status}：${r.stderr || ''}\n`);
  }
} catch (e) {
  process.stderr.write(`⚠️  build_views 调用失败：${e.message}\n`);
}

// ============== 入口前提炼高 ROI 规律 ==============
// 基于已完赛的 settled_matches.json，按玩法/赔率区间/handicap/赔率漂移分桶统计命中率和 ROI
// 失败不阻塞建模（仅 warning）
try {
  const r = spawnSync('node', [path.join(__dirname, '32_roi_insights.js')], {
    cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000,
  });
  if (r.status === 0) {
    process.stdout.write(r.stdout || '');
  } else {
    process.stderr.write(`⚠️  32_roi_insights 退出码 ${r.status}：${r.stderr || ''}\n`);
  }
} catch (e) {
  process.stderr.write(`⚠️  32_roi_insights 调用失败：${e.message}\n`);
}

// ============== 加载提炼好的 ROI 规律（供主池/单关做信号） ==============
function loadInsights() {
  try {
    if (!fs.existsSync(INSIGHTS_FILE)) return null;
    return JSON.parse(fs.readFileSync(INSIGHTS_FILE, 'utf-8'));
  } catch (e) {
    return null;
  }
}
const ROI_INSIGHTS = loadInsights();

// ============== 动态加载球队分层 + 射手星 (从 data/teams/_index.json + 57 个 team json) ==============
// 单一数据源: data/teams/_index.json (by_tier 分类) + data/teams/<CODE>.json (meta.has_scorer_star)
// 球队上下文由 strategy_core.createTeamCtx 统一构建, 与 33_fit 共用同一份逻辑
const { getTeamTier, hasScorerStar } = createTeamCtx(PROJECT_ROOT);
// ============================================================
// 策略参数: DEFAULT_PARAMS (strategy_core.js) 叠加 33_fit 产物 strategy_params.json
// 没有 fit 产物时 = 默认参数 = 重构前的硬编码行为
// ============================================================
const STRATEGY_PARAMS_FILE = path.join(ARTIFACTS_DIR, 'strategy_params.json');
function loadStrategyParams() {
  try {
    if (fs.existsSync(STRATEGY_PARAMS_FILE)) {
      const fit = JSON.parse(fs.readFileSync(STRATEGY_PARAMS_FILE, 'utf-8'));
      const params = mergeParams(DEFAULT_PARAMS, fit.params || fit);
      console.log(`[策略参数] 已加载 fit 产物 ${path.basename(STRATEGY_PARAMS_FILE)}`
        + (fit.fitted_at ? ` (拟合于 ${fit.fitted_at}, 基于 ${fit.sample_size ?? '?'} 场)` : ''));
      return params;
    }
  } catch (e) {
    console.error(`⚠️ 加载 strategy_params.json 失败, 回落默认参数: ${e.message}`);
  }
  console.log('[策略参数] 未找到 fit 产物, 使用 DEFAULT_PARAMS (默认硬编码值)');
  return mergeParams(DEFAULT_PARAMS, null);
}
// 策略上下文: 策略函数从这里拿 params + 球队信息
const STRATEGY_CTX = {
  params: loadStrategyParams(),
  getTeamTier,
  hasScorerStar,
};

// 串关组合 generateCombos 已移至 strategy_core.js (参数化, 设计修正: 低赔腿+赔率带+最可能优先)

// ============================================================
// 预测模式: 预测今日比赛 (无result文件的比赛)
// ============================================================
function runPredict() {
  // 找所有 odds 文件, 过滤: 世界杯 + 无result文件
  const oddsFiles = fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort();
  const todayMatches = [];

  for (const f of oddsFiles) {
    const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
    if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
    const mid = oddsDoc.basic.mid;
    const resultPath = path.join(RESULTS_DIR, mid + '.json');
    if (fs.existsSync(resultPath)) continue; // 已有结果的跳过
    if (oddsDoc.basic.is_cancel) continue;
    if (!oddsDoc.odds || !oddsDoc.odds.bf_latest) continue; // 需要比分赔率数据
    todayMatches.push({
      code: oddsDoc.basic.code,
      mid,
      home: oddsDoc.basic.home,
      away: oddsDoc.basic.away,
      match: `${oddsDoc.basic.home}vs${oddsDoc.basic.away}`,
      kickoff: oddsDoc.basic.kickoff,
      handicap: oddsDoc.odds.handicap ?? 0,
      spf: oddsDoc.odds.spf_latest,
      rqspf: oddsDoc.odds.rqspf_latest,
      bf: oddsDoc.odds.bf_latest,
      zjq: oddsDoc.odds.zjq_latest,
      bqc: oddsDoc.odds.bqc_latest,
    });
  }

  todayMatches.sort((a, b) => a.code.localeCompare(b.code, 'zh-CN', { numeric: true }));

  if (todayMatches.length === 0) {
    console.log('无待预测比赛');
    return;
  }

  // ====== 打印本次推荐基于的 ROI 规律 ======
  if (ROI_INSIGHTS) {
    console.log(`\n[ROI 规律] 基于 ${ROI_INSIGHTS.sample_size} 场已完赛汇总 (生成于 ${ROI_INSIGHTS.generated_at})`);
    if (ROI_INSIGHTS.note) console.log(`  ${ROI_INSIGHTS.note}`);
    console.log(`  TOP 建议:`);
    for (const a of (ROI_INSIGHTS.top_advices || []).slice(0, 8)) console.log(`    • ${a}`);
    console.log(`  → 单关数量已按规律自动调整 (1 个 vs 2 个, 看哪个 ROI 高)\n`);
  } else {
    console.log(`\n⚠️  [ROI 规律] 未加载到 insights, 单关数量走默认 (2 个)\n`);
  }

  // 对每场比赛应用 F4 + 单关策略
  const matchPredictions = todayMatches.map(m => {
    const type = classifyMatch(m, STRATEGY_CTX);
    const mainPicks = f4Strategy(m, STRATEGY_CTX);
    const singleBets = singleBetStrategy(m, mainPicks, STRATEGY_CTX);
    return { ...m, type, mainPicks, singleBets };
  });

  // 生成组合
  const combos = generateCombos(matchPredictions, STRATEGY_CTX);

  // 输出日期
  const today = matchPredictions[0].kickoff ? matchPredictions[0].kickoff.split(' ')[0]
               : new Date().toISOString().split('T')[0];

  // ======= 控制台输出 =======
  console.log(`\n[31号策略] 目标日期: ${today} (预测模式)`);
  console.log(`[输入] ${matchPredictions.length} 场 ${today} 比赛 (预测模式)\n`);

  console.log(`# 31号策略 预测报告 (${today})\n`);
  console.log(`| 场次 | 对阵 | 类型 | handicap | spf(主/平/客) | 主池3比分 | 单关比分 |`);
  console.log(`|------|------|------|----------|---------------|-----------|----------|`);
  for (const p of matchPredictions) {
    const mainStr = p.mainPicks.map(x => `${x.score}@${x.odds}`).join(' ');
    const singleStr = p.singleBets.length ? p.singleBets.map(x => `${x.score}@${x.odds}`).join(' ') : '-';
    const spfStr = p.spf ? `${p.spf.home}/${p.spf.draw}/${p.spf.away}` : '-/-/-';
    console.log(`| ${p.code} | ${p.match} | ${p.type} | ${p.handicap} | ${spfStr} | ${mainStr} | ${singleStr} |`);
  }

  // 单关单独列出
  const hasSingle = matchPredictions.some(p => p.singleBets.length > 0);
  if (hasSingle) {
    console.log(`\n## 单关建议 (高赔率爆冷, 赔率@25-65, 独立推荐, 不影响主池)\n`);
    for (const p of matchPredictions) {
      if (p.singleBets.length > 0) {
        console.log(`  ${p.code} ${p.match} (${p.type}): ${p.singleBets.map(x => `${x.score}@${x.odds}`).join(' / ')}`);
      }
    }
  }

  // ======= RQSPF 跟投 + 纠偏 (insights: 基线+16.6% / 纠偏+20.5%) =======
  const rqspfPicks = matchPredictions.map(p => ({ p, rq: rqspfStrategy(p, STRATEGY_CTX) })).filter(x => x.rq);
  if (rqspfPicks.length > 0) {
    const corrCount = rqspfPicks.filter(x => x.rq.rule.name.includes('纠偏')).length;
    console.log(`\n## RQSPF 让球胜平负 跟投 (${corrCount}场命中纠偏条件 → 用让胜, 其余用基线最低赔率)\n`);
    console.log(`| 场次 | 对阵 | 让球 | 让胜 | 让平 | 让负 | 推荐(主/次) | 纠偏规则 |`);
    console.log(`|------|------|------|------|------|------|--------------|----------|`);
    for (const { p, rq } of rqspfPicks) {
      const rq_ = p.rqspf || {};
      const isCorr = rq.rule.name.includes('纠偏');
      const ruleMark = isCorr ? `⭐${rq.rule.name} (${rq.rule.roi})` : rq.rule.name;
      console.log(`| ${p.code} | ${p.match} | ${p.handicap} | ${rq_.home} | ${rq_.draw} | ${rq_.away} | ${rq.primary.label}@${rq.primary.odds} / ${rq.secondary.label}@${rq.secondary.odds} | ${ruleMark} |`);
    }
  }

  // ======= ZJQ 跟投 + 纠偏 (insights: 2球主流盘 ROI+24.7%) =======
  const zjqPicks = matchPredictions.map(p => ({ p, z: zjqStrategy(p, STRATEGY_CTX) })).filter(x => x.z);
  if (zjqPicks.length > 0) {
    const corrCount = zjqPicks.filter(x => x.z.corrected).length;
    console.log(`\n## ZJQ 总进球 跟投 (${corrCount}场命中纠偏条件 → 用2球主流盘, 其余用让球→大/小球)\n`);
    console.log(`| 场次 | 对阵 | 让球 | 冷门(7+球) | 稳定 | 纠偏 | 规则 |`);
    console.log(`|------|------|------|-----------|------|------|------|`);
    for (const { p, z } of zjqPicks) {
      const corrMark = z.corrected ? `⭐${z.corrected.pick}球@${z.corrected.odds}` : '-';
      const ruleMark = z.rule.name.includes('纠偏') ? `⭐${z.rule.name} (${z.rule.roi})` : z.rule.name;
      console.log(`| ${p.code} | ${p.match} | ${p.handicap} | ${z.coldPick}球@${z.coldOdds} | ${z.stable}球@${z.stableOdds} | ${corrMark} | ${ruleMark} |`);
    }
  }

  // ======= BQC 跟投 + 纠偏 (insights: 胜胜赔率<2.0 → 胜胜+平平 ROI+110.4%) =======
  const bqcPicks = matchPredictions.map(p => ({ p, b: bqcStrategy(p, STRATEGY_CTX) })).filter(x => x.b);
  if (bqcPicks.length > 0) {
    const corrCount = bqcPicks.filter(x => x.b.corrected).length;
    console.log(`\n## BQC 半全场 跟投 (${corrCount}场命中纠偏条件 → 胜胜+平平, 其余用TOP3)\n`);
    for (const { p, b } of bqcPicks) {
      const top3 = b.top3.map(x => `${x.key}@${x.odds}`).join(' ');
      if (b.corrected) {
        const corrStr = b.corrected.picks.map(k => `${k}@${b.corrected.odds[k]}`).join('+');
        console.log(`  ⭐ ${p.code} ${p.match}: 纠偏=${corrStr}  (${b.rule.name} ROI ${b.rule.roi})  TOP3=${top3}`);
      } else {
        console.log(`  ${p.code} ${p.match}: TOP3=${top3}  (${b.rule.name})`);
      }
    }
  }

  // 2串1 TOP推荐
  if (combos.c2.length > 0) {
    console.log(`\n## 2串1 比分 TOP组合 (赔率排序, 取前10)\n`);
    console.log(`| 组合 | 赔率 |`);
    console.log(`|------|------|`);
    for (const c of combos.c2) {
      const desc = c.picks.map(p => `${p.match} ${p.score}@${p.odds}`).join(' × ');
      console.log(`| ${desc} | ${c.odds} |`);
    }
  }

  // 3串1 TOP推荐
  if (combos.c3.length > 0) {
    console.log(`\n## 3串1 比分 TOP组合 (赔率排序, 取前10)\n`);
    console.log(`| 组合 | 赔率 |`);
    console.log(`|------|------|`);
    for (const c of combos.c3) {
      const desc = c.picks.map(p => `${p.match} ${p.score}@${p.odds}`).join(' × ');
      console.log(`| ${desc} | ${c.odds} |`);
    }
  }

  // ======= 写入 JSON =======
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const jsonOut = {
    date: today,
    strategy: '31号策略 (F4主池 + 反方向单关 + RQSPF/ZJQ/BQC赔率纠偏)',
    rqspf_follow: rqspfPicks.map(({ p, rq }) => ({
      code: p.code, mid: p.mid, match: p.match, handicap: p.handicap,
      rqspf_odds: { home: p.rqspf?.home, draw: p.rqspf?.draw, away: p.rqspf?.away },
      primary: rq.primary, secondary: rq.secondary, rule: rq.rule,
    })),
    zjq_follow: zjqPicks.map(({ p, z }) => ({
      code: p.code, mid: p.mid, match: p.match, handicap: p.handicap,
      corrected: z.corrected, coldPick: z.coldPick, stable: z.stable,
      coldOdds: z.coldOdds, stableOdds: z.stableOdds, rule: z.rule,
    })),
    bqc_follow: bqcPicks.map(({ p, b }) => ({
      code: p.code, mid: p.mid, match: p.match,
      corrected: b.corrected, top3: b.top3, rule: b.rule,
    })),
    matches: matchPredictions.map(p => ({
      code: p.code,
      mid: p.mid,
      match: p.match,
      home: p.home,
      away: p.away,
      kickoff: p.kickoff,
      type: p.type,
      handicap: p.handicap,
      spf: p.spf,
      rqspf: p.rqspf,
      mainPicks: p.mainPicks.map(x => ({ score: x.score, odds: x.odds })),
      singleBets: p.singleBets.map(x => ({ score: x.score, odds: x.odds })),
    })),
    combos,
  };
  const outPath = path.join(ARTIFACTS_DIR, `predict_31_${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(jsonOut, null, 2), 'utf-8');
  console.log(`\n报告写入: ${outPath}`);
}

// ============================================================
// 回测模式: 对有结果的比赛应用策略并报告 ROI
// ============================================================
function runBacktest() {
  const matches_ = [];
  for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
    const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
    if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
    const mid = oddsDoc.basic.mid;
    const resultPath = path.join(RESULTS_DIR, mid + '.json');
    if (!fs.existsSync(resultPath)) continue;
    const actual = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    matches_.push({
      mid: oddsDoc.basic.mid,
      code: oddsDoc.basic.code,
      home: oddsDoc.basic.home,
      away: oddsDoc.basic.away,
      handicap: oddsDoc.odds.handicap ?? 0,
      bf: oddsDoc.odds.bf_latest,
      rqspf: oddsDoc.odds.rqspf_latest,
      zjq: oddsDoc.odds.zjq_latest,
      bqc: oddsDoc.odds.bqc_latest,
      actualHome: actual.homeScore,
      actualAway: actual.awayScore,
    });
  }

  if (matches_.length === 0) {
    console.log('无历史比赛可回测');
    return;
  }

  // 主池 ROI
  let mainCost = 0, mainReturn = 0, mainHits = 0;
  const details = [];
  for (const m of matches_) {
    mainCost += 3;
    const picks = f4Strategy(m, STRATEGY_CTX);
    const actual = `${m.actualHome}:${m.actualAway}`;
    // 2026-06-19 调优: "胜其它" 兜底命中检测 (主队赢球 + 进 5+ 球)
    // 例: 6-0/5-0/5-1 等"非典型大比分" 走"胜其它"档
    const hit = picks.find(p => p.score === actual)
             || picks.find(p => p._isOther && p.score === '胜其它' && m.actualHome > m.actualAway && m.actualHome >= 5)
             || picks.find(p => p._isOther && p.score === '负其它' && m.actualHome < m.actualAway && m.actualAway >= 5)
             || picks.find(p => p._isOther && p.score === '平其它' && m.actualHome === m.actualAway && (m.actualHome + m.actualAway) >= 5);
    if (hit) { mainReturn += hit.odds; mainHits++; }
    details.push({
      code: m.code, match: `${m.home}vs${m.away}`, type: classifyMatch(m, STRATEGY_CTX),
      actual, picks: picks.map(p => `${p.score}@${p.odds}${p._isOther ? '(兜底)' : ''}`),
      hit: !!hit, hitOdds: hit ? hit.odds : 0,
    });
  }

  // 单关 ROI
  let singleCost = 0, singleReturn = 0, singleHits = 0;
  for (const m of matches_) {
    const picks = f4Strategy(m, STRATEGY_CTX);
    const singles = singleBetStrategy(m, picks, STRATEGY_CTX);
    if (singles.length === 0) continue;
    const actual = `${m.actualHome}:${m.actualAway}`;
    singleCost += singles.length;
    const hit = singles.find(p => p.score === actual);
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

  // ============== RQSPF / ZJQ / BQC 纠偏回测 ==============
  // 用历史数据验证 3 条纠偏规则的实战 ROI
  console.log(`\n## 31号策略 跟投 + 纠偏回测 (RQSPF / ZJQ / BQC)\n`);

  // RQSPF 跟投
  const rqspfBack = matches_.map(m => {
    const rq = m.rqspf;
    if (!rq || !rq.home || !rq.draw || !rq.away) return null;
    // rqspf.result = 主队净胜 + 让球后的方向
    const actualDiff = m.actualHome - m.actualAway;
    const handicap = m.handicap ?? 0;
    let rqResult;
    if (actualDiff + handicap > 0) rqResult = 'home';
    else if (actualDiff + handicap < 0) rqResult = 'away';
    else rqResult = 'draw';
    const strategy = rqspfStrategy({ rqspf: { home: rq.home, draw: rq.draw, away: rq.away } }, STRATEGY_CTX);
    if (!strategy) return null;
    const hit = strategy.primary.d === rqResult;
    const odds = strategy.primary.odds;
    return { match: m, rq, rqResult, strategy, hit, odds, rule: strategy.rule };
  }).filter(Boolean);

  if (rqspfBack.length > 0) {
    let n = rqspfBack.length;
    let hits = rqspfBack.filter(x => x.hit).length;
    let cost = n;  // 每场 1 注
    let ret = rqspfBack.filter(x => x.hit).reduce((s, x) => s + x.odds, 0);
    let roi = (ret - cost) / cost * 100;
    let corrN = rqspfBack.filter(x => x.rule.name.includes('纠偏')).length;
    let corrHits = rqspfBack.filter(x => x.rule.name.includes('纠偏') && x.hit).length;
    let corrCost = corrN;
    let corrRet = rqspfBack.filter(x => x.rule.name.includes('纠偏') && x.hit).reduce((s, x) => s + x.odds, 0);
    let corrRoi = corrCost > 0 ? (corrRet - corrCost) / corrCost * 100 : 0;
    console.log(`### RQSPF 跟投 (基线+16.6% / 纠偏+20.5%)\n`);
    console.log(`| 范围 | 命中 | 投入 | 回报 | ROI |`);
    console.log(`|------|------|------|------|-----|`);
    console.log(`| 全部 (${n}场) | ${hits} | $${cost} | $${ret.toFixed(2)} | ${roi.toFixed(1)}% |`);
    if (corrN > 0) console.log(`| 纠偏命中 (${corrN}场) | ${corrHits} | $${corrCost} | $${corrRet.toFixed(2)} | ${corrRoi.toFixed(1)}% |`);
  }

  // ZJQ 跟投 (与 32 fixedPicksSim 公式一致: 每场 cost = picks.length, 命中 = 1 个 key 赔率)
  const zjqBack = matches_.map(m => {
    const zjq = m.zjq;
    if (!zjq) return null;
    const total = m.actualHome + m.actualAway;
    const result = total >= 7 ? '7+' : String(total);
    const strategy = zjqStrategy(m, STRATEGY_CTX);  // 传完整 m, 让 classifyMatch 能拿到 home/away
    if (!strategy) return null;
    // picks: corrected.picks 数组(NORMAL+BIG_BALL/WEAK) 或 [stable] (基线)
    let picks, oddsMap, isCorrected = false;
    if (strategy.corrected?.picks) {
      picks = strategy.corrected.picks;
      oddsMap = strategy.corrected.odds;
      isCorrected = true;
    } else if (strategy.corrected?.pick) {
      // 旧版: 单 key 纠偏
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
    let n = zjqBack.length;
    let hits = zjqBack.filter(x => x.hit).length;
    let cost = zjqBack.reduce((s, x) => s + x.cost, 0);
    let ret = zjqBack.filter(x => x.hit).reduce((s, x) => s + x.odds, 0);
    let roi = cost > 0 ? (ret - cost) / cost * 100 : 0;
    let corrN = zjqBack.filter(x => x.isCorrected).length;
    let corrHits = zjqBack.filter(x => x.isCorrected && x.hit).length;
    let corrCost = zjqBack.filter(x => x.isCorrected).reduce((s, x) => s + x.cost, 0);
    let corrRet = zjqBack.filter(x => x.isCorrected && x.hit).reduce((s, x) => s + x.odds, 0);
    let corrRoi = corrCost > 0 ? (corrRet - corrCost) / corrCost * 100 : 0;
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
    const actual = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, m.mid + '.json'), 'utf-8'));
    if (!actual.halfTime) return null;
    const halfHome = actual.halfTime.home;
    const halfAway = actual.halfTime.away;
    let half, full;
    if (halfHome > halfAway) half = '胜';
    else if (halfHome < halfAway) half = '负';
    else half = '平';
    if (m.actualHome > m.actualAway) full = '胜';
    else if (m.actualHome < m.actualAway) full = '负';
    else full = '平';
    const result = half + full;
    const strategy = bqcStrategy(m, STRATEGY_CTX);  // 传完整 m, 让 classifyMatch 能拿到 home/away
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
    let totalCost = bqcBack.reduce((s, x) => s + x.cost, 0);
    let totalRet = bqcBack.filter(x => x.hit).reduce((s, x) => s + x.odds, 0);
    let totalHits = bqcBack.filter(x => x.hit).length;
    let roi = totalCost > 0 ? (totalRet - totalCost) / totalCost * 100 : 0;
    let corrN = bqcBack.filter(x => x.rule.name.includes('纠偏')).length;
    let corrHits = bqcBack.filter(x => x.rule.name.includes('纠偏') && x.hit).length;
    let corrCost = bqcBack.filter(x => x.rule.name.includes('纠偏')).reduce((s, x) => s + x.cost, 0);
    let corrRet = bqcBack.filter(x => x.rule.name.includes('纠偏') && x.hit).reduce((s, x) => s + x.odds, 0);
    let corrRoi = corrCost > 0 ? (corrRet - corrCost) / corrCost * 100 : 0;
    console.log(`\n### BQC 跟投 (基线-10% / 纠偏+110.4%)\n`);
    console.log(`| 范围 | 命中 | 投入 | 回报 | ROI |`);
    console.log(`|------|------|------|------|-----|`);
    console.log(`| 全部 (${bqcBack.length}场) | ${totalHits} | $${totalCost} | $${totalRet.toFixed(2)} | ${roi.toFixed(1)}% |`);
    if (corrN > 0) console.log(`| 纠偏命中 (${corrN}场) | ${corrHits} | $${corrCost} | $${corrRet.toFixed(2)} | ${corrRoi.toFixed(1)}% |`);
  }
}

// ============================================================
// 主入口: 默认 predict, --backtest 触发回测
// ============================================================
const args = process.argv.slice(2);
if (args.includes('--backtest')) {
  runBacktest();
} else {
  runPredict();
}
