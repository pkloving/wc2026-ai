// 31_tight_anti_value.js — 主模型策略脚本
// 核心策略: 主池=F4混合 (ROI+134%) + 单关=反方向/平局高赔率比分 (爆冷门)
//          + 5类选单 (rqspf 3串1/4串1 + 比分2串1 + 单关比分/zjq/bqc)
// 用法:
//   node modeling/scripts/31_tight_anti_value.js --predict    (默认, 预测今日比赛)
//   node modeling/scripts/31_tight_anti_value.js --backtest   (回测历史比赛, 报告落盘 modeling/artifacts/backtest_31_*.md)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_PARAMS, mergeParams, createTeamCtx,
  classifyMatch, f4Strategy, generateCombos,
  rqspfStrategy, zjqStrategy, bqcStrategy, singleBetStrategy,
  selectBets, settleBets, deriveActual, groupByDay,
  loadBacktestMatches, buildPrediction,
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

// ============== 入口前更新球队晋级压力分析 ==============
// 基于最新的 groups.json 积分榜，重新计算每队的晋级压力 + 淘汰赛对位
// 第二轮及以后尤为重要：积分形势 → 战意 → 影响比赛类型判断(BIG_BALL/NORMAL/WEAK_MATCH)
// 失败不阻塞建模（仅 warning）
try {
  const r = spawnSync('node', [path.join(PROJECT_ROOT, 'scripts', 'update_teams_qualification.js')], {
    cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000,
  });
  if (r.status === 0) {
    process.stdout.write(r.stdout || '');
  } else {
    process.stderr.write(`⚠️  update_teams_qualification 退出码 ${r.status}：${r.stderr || ''}\n`);
  }
} catch (e) {
  process.stderr.write(`⚠️  update_teams_qualification 调用失败：${e.message}\n`);
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
const { getTeamTier, hasScorerStar, getQual, getMatchQualCtx } = createTeamCtx(PROJECT_ROOT);
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
  getQual,
  getMatchQualCtx,
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

  // 对每场比赛应用 F4 + 单关 + rqspf/zjq/bqc 策略 (rq/z/b 供 selectBets 选单使用)
  const matchPredictions = todayMatches.map(m => {
    const type = classifyMatch(m, STRATEGY_CTX);
    const mainPicks = f4Strategy(m, STRATEGY_CTX);
    const singleBets = singleBetStrategy(m, mainPicks, STRATEGY_CTX);
    const rq = rqspfStrategy(m, STRATEGY_CTX);
    const z = zjqStrategy(m, STRATEGY_CTX);
    const b = bqcStrategy(m, STRATEGY_CTX);
    return { ...m, type, mainPicks, singleBets, rq, z, b };
  });

  // 生成组合
  const combos = generateCombos(matchPredictions, STRATEGY_CTX);

  // 输出日期
  const today = matchPredictions[0].kickoff ? matchPredictions[0].kickoff.split(' ')[0]
               : new Date().toISOString().split('T')[0];

  // ======= 球队晋级分析 (新增: 赛前积分/排名/晋级压力/对位分析) =======
  // 从 data/teams/<CODE>.json 读取 wc2026.qualification_pressure + knockout_matchup
  // 为 31 规则提供"强队抢分/弱队保守"等额外信号
  function loadTeamQual(teamName) {
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'teams', '_index.json'), 'utf-8'));
      const code = idx.by_name?.[teamName] || idx.name_variants_to_code?.[teamName];
      if (!code) return null;
      const rel = idx.by_code?.[code];
      if (!rel) return null;
      const t = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', rel), 'utf-8'));
      return t.wc2026 || null;
    } catch (e) { return null; }
  }

  function formatQualRow(teamName, matchCode, role) {
    const wc = loadTeamQual(teamName);
    if (!wc?.standings) return `  ${matchCode} ${role === 'home' ? '主' : '客'} ${teamName}: 暂无小组数据`;
    const s = wc.standings;
    const qp = wc.qualification_pressure || {};
    const km = wc.knockout_matchup || {};
    const groupId = wc.group || '-';
    const pressureLevel = qp.pressure_level || '-';
    const pressureIcon = pressureLevel === 'very-high' ? '🔴' : pressureLevel === 'high' ? '🟠' : pressureLevel === 'medium' ? '🟡' : pressureLevel === 'low-medium' ? '🟢' : pressureLevel === 'low' ? '✅' : '⚪';
    const pts = s.pts, pos = s.position, played = s.played;
    const remaining = 3 - played;
    const pressureText = qp.pressure_text || '';
    const targetPos = km.target_position || '-';
    const nextMatch = qp.next_match;
    let nextInfo = '';
    if (nextMatch) {
      nextInfo = `下一场 vs ${nextMatch.opponent_name} (${nextMatch.opponent_position}名/${nextMatch.opponent_pts}分)`;
    }
    return `  ${matchCode} ${role === 'home' ? '主' : '客'} ${teamName} (${groupId}组): ${pos}名 ${pts}分 ${played}场 ${pressureIcon}${pressureText} | 目标:${targetPos} ${nextInfo ? '| ' + nextInfo : ''}`;
  }

  console.log(`\n# 球队晋级策略分析 (${today})\n`);
  console.log(`| 场次 | 球队 | 小组 | 排名 | 积分 | 场次 | 剩余 | 压力 | 晋级目标 | 关键信号 |`);
  console.log(`|------|------|------|------|------|------|------|------|----------|----------|`);
  for (const p of matchPredictions) {
    // 主队
    const hw = loadTeamQual(p.home);
    const hGrp = hw?.group || '-';
    const hPos = hw?.standings?.position !== undefined ? hw.standings.position : '-';
    const hPts = hw?.standings?.pts !== undefined ? hw.standings.pts : '-';
    const hPlayed = hw?.standings?.played || '-';
    const hRem = hw?.standings ? (3 - hw.standings.played) : '-';
    const hPressure = hw?.qualification_pressure?.pressure_level || '-';
    const hTarget = hw?.knockout_matchup?.target_position || '-';
    const hSignal = hw?.qualification_pressure?.pressure_text ? hw.qualification_pressure.pressure_text.slice(0, 18) : '-';
    console.log(`| ${p.code} | ${p.home} | ${hGrp} | ${hPos} | ${hPts} | ${hPlayed} | ${hRem} | ${hPressure} | ${hTarget} | ${hSignal} |`);
    // 客队
    const aw = loadTeamQual(p.away);
    const aGrp = aw?.group || '-';
    const aPos = aw?.standings?.position !== undefined ? aw.standings.position : '-';
    const aPts = aw?.standings?.pts !== undefined ? aw.standings.pts : '-';
    const aPlayed = aw?.standings?.played || '-';
    const aRem = aw?.standings ? (3 - aw.standings.played) : '-';
    const aPressure = aw?.qualification_pressure?.pressure_level || '-';
    const aTarget = aw?.knockout_matchup?.target_position || '-';
    const aSignal = aw?.qualification_pressure?.pressure_text ? aw.qualification_pressure.pressure_text.slice(0, 18) : '-';
    console.log(`| ${p.code} | ${p.away} | ${aGrp} | ${aPos} | ${aPts} | ${aPlayed} | ${aRem} | ${aPressure} | ${aTarget} | ${aSignal} |`);
  }

  // 单场晋级压力深度解读（帮助纠正主池/单关的方向判断）
  console.log(`\n## 晋级压力深度解读\n`);
  for (const p of matchPredictions) {
    console.log(`### ${p.code} ${p.match}\n`);
    // 主队
    const hw = loadTeamQual(p.home);
    if (hw?.standings) {
      const qp = hw.qualification_pressure || {};
      const km = hw.knockout_matchup || {};
      const icon = qp.pressure_level === 'very-high' ? '🔴' : qp.pressure_level === 'high' ? '🟠' : qp.pressure_level === 'medium' ? '🟡' : qp.pressure_level === 'low-medium' ? '🟢' : '✅';
      console.log(`- **${p.home}** (${hw.group}组 ${qp.position}名 ${qp.points}分) ${icon}${qp.pressure_text}`);
      console.log(`  - 晋级机会: ${km.qualification_chance || '-'} | 目标排名: ${km.target_position || '-'}`);
      if (km.strategy_notes?.length) console.log(`  - 策略信号: ${km.strategy_notes.slice(0, 2).join('；')}`);
      if (km.best_case) console.log(`  - 最好情况: 积${km.best_case.best_possible_pts}分 (${km.best_case.scenario})`);
      if (km.worst_case) console.log(`  - 最坏情况: 积${km.worst_case.worst_possible_pts}分 (${km.worst_case.scenario})`);
      if (km.knockout_potential) console.log(`  - 淘汰赛对位: ${km.knockout_potential.would_play_description}`);
    } else {
      console.log(`- **${p.home}**: 暂无世界杯小组数据`);
    }
    // 客队
    const aw = loadTeamQual(p.away);
    if (aw?.standings) {
      const qp = aw.qualification_pressure || {};
      const km = aw.knockout_matchup || {};
      const icon = qp.pressure_level === 'very-high' ? '🔴' : qp.pressure_level === 'high' ? '🟠' : qp.pressure_level === 'medium' ? '🟡' : qp.pressure_level === 'low-medium' ? '🟢' : '✅';
      console.log(`- **${p.away}** (${aw.group}组 ${qp.position}名 ${qp.points}分) ${icon}${qp.pressure_text}`);
      console.log(`  - 晋级机会: ${km.qualification_chance || '-'} | 目标排名: ${km.target_position || '-'}`);
      if (km.strategy_notes?.length) console.log(`  - 策略信号: ${km.strategy_notes.slice(0, 2).join('；')}`);
      if (km.best_case) console.log(`  - 最好情况: 积${km.best_case.best_possible_pts}分 (${km.best_case.scenario})`);
      if (km.worst_case) console.log(`  - 最坏情况: 积${km.worst_case.worst_possible_pts}分 (${km.worst_case.scenario})`);
      if (km.knockout_potential) console.log(`  - 淘汰赛对位: ${km.knockout_potential.would_play_description}`);
    } else {
      console.log(`- **${p.away}**: 暂无世界杯小组数据`);
    }
    // 综合判断
    if (hw?.qualification_pressure && aw?.qualification_pressure) {
      const hPts = hw.qualification_pressure.points || 0;
      const aPts = aw.qualification_pressure.points || 0;
      const hLevel = hw.qualification_pressure.pressure_level;
      const aLevel = aw.qualification_pressure.pressure_level;
      const highPressure = ['high', 'very-high'];
      if (highPressure.includes(hLevel) && highPressure.includes(aLevel)) {
        console.log(`  \n  ⚠️ **双方高压力**: 双方都面临抢分压力，战意拉满，可能出现激烈对抗和进球大战`);
      } else if (highPressure.includes(hLevel)) {
        console.log(`  \n  ⚠️ **主队高压力**: ${p.home}需抢分，可能采取更积极的进攻策略，或因压力过大踢得保守`);
      } else if (highPressure.includes(aLevel)) {
        console.log(`  \n  ⚠️ **客队高压力**: ${p.away}需抢分，可能采取更积极的进攻策略，或因压力过大踢得保守`);
      } else if (hLevel === 'low' && aLevel === 'low') {
        console.log(`  \n  ✅ **双方低压力**: 双方形势都不错，可能轮换或调整状态，注意冷门或平局`);
      }
      if (Math.abs(hPts - aPts) >= 3) {
        console.log(`  ⚠️ **积分差距大 (${Math.abs(hPts - aPts)}分)**: 两队排名/处境不同，需警惕强队"放水"心态或弱队拼死一搏`);
      }
    }
    console.log(``);
  }

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
  const rqspfPicks = matchPredictions.map(p => ({ p, rq: p.rq })).filter(x => x.rq);
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
  const zjqPicks = matchPredictions.map(p => ({ p, z: p.z })).filter(x => x.z);
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
  const bqcPicks = matchPredictions.map(p => ({ p, b: p.b })).filter(x => x.b);
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

  // ======= 5 类选单 (picker) =======
  const picker = selectBets(matchPredictions, STRATEGY_CTX);
  const PCK = STRATEGY_CTX.params.picker;
  console.log(`\n# 今日选单 (5类: 必出 cat1/cat2 + 可选 cat3/cat4/cat5)\n`);

  // --- cat1: RQSPF 三层 (2串1 + 3串1 + 4串1) ---
  console.log(`## 必出① RQSPF 选单 (单选 ${picker.cat1.slimCount} 场 / 双选 ${picker.cat1.dualCount} 场, 挑场=${PCK.cat1.topNMode})\n`);
  const hasCat1 = picker.cat1.parlay2.length || picker.cat1.parlay3.length || picker.cat1.parlay4;
  if (hasCat1) {
    // 单行汇总: 2x1(N) + 3x1(N) + 4x1(N) = 总注
    const n2 = picker.cat1.parlay2.length;
    const n3 = picker.cat1.parlay3.length;
    // 4x1 在 n=3+dual 时是数组(双选展开 2 注), 否则是单 object
    const n4 = picker.cat1.parlay4
      ? (Array.isArray(picker.cat1.parlay4) ? picker.cat1.parlay4.length : 1)
      : 0;
    const total = n2 + n3 + n4;
    const n = picker.cat1.slimCount, m = picker.cat1.dualCount;
    // 单选状态表 (每场 primary/secondary + 单/双选标记)
    const enriched = matchPredictions
      .filter(p => picker.cat1.matches.includes(p.code))
      .map(p => {
        const slim = n >= 2 && (() => {
          const rq = p.rq;
          if (!rq?.primary) return false;
          if (p.handicap === 1) return false;                       // G (2026-06-20): 主受让+1 强制 DUAL, 同步 strategy_core.isRqSlim
          if (rq.primary.d === 'home') return true;                 // A: 主选=让胜
          if (p.spf?.home && p.spf.home < 1.3) return true;          // B: spf 大热门
          // C 规则(2026-06-20 关闭): spf.home∈[1.5,2.0) - 庄家陷阱盘,见 strategy_core.isRqSlim
          if (Math.abs(p.handicap ?? 0) === 2) return true;          // D: 大让球
          if (p.handicap === -1 && p.spf?.home && p.spf.home < 1.5) return true;  // E: 强让
          if (p.handicap === 1 && p.spf?.away && p.spf.away < 1.5) return true;    // F: 反向强让 (被 G 覆盖)
          return false;
        })();
        return { ...p, _slim: slim };
      });
    const slimN = enriched.filter(x => x._slim).length;
    const dualN = enriched.length - slimN;
    console.log(`### 单选场次状态 (共 ${enriched.length} 场: 单选 ${slimN} / 双选 ${dualN})\n`);
    console.log(`| 场次 | 对阵 | hc | 让胜 | 让平 | 让负 | 主选/次选 | 类型 |`);
    console.log(`|------|------|----|------|------|------|----------|------|`);
    for (const p of enriched) {
      const rq_ = p.rqspf || {};
      const rq = p.rq;
      const rqCell = rq ? `${rq.primary.label}@${rq.primary.odds} / ${rq.secondary.label}@${rq.secondary.odds}` : '-';
      const ruleName = rq?.rule?.name || '-';
      const kind = p._slim ? '单选' : '双选';
      console.log(`| ${p.code} | ${p.match} | ${p.handicap} | ${rq_.home ?? '-'} | ${rq_.draw ?? '-'} | ${rq_.away ?? '-'} | ${rqCell} | ${kind} (${ruleName}) |`);
    }
    console.log(`\n### 一张单子: 2x1(${n2}) + 3x1(${n3}) + 4x1(${n4}) = ${total} 注\n`);
    if (n2 === 0 && n3 === 0 && n4 === 0) {
      console.log(`(组合不足, 不出)\n`);
    } else {
      // 2串1
      if (n2 > 0) {
        console.log(`#### 2串1 (单选 ${n} 选 2 = C(${n},2) = ${n2} 注)\n`);
        console.log(`| # | 线路 (让球方向) | 串关赔率 | 注金 |`);
        console.log(`|---|----------------|----------|------|`);
        picker.cat1.parlay2.forEach((t, i) => {
          const desc = t.legs.map(l => `${l.code} ${l.label}@${l.odds}`).join(' × ');
          console.log(`| ${i + 1} | ${desc} | ${t.odds} | ${t.stake} |`);
        });
        console.log(``);
      }
      // 3串1
      if (n3 > 0) {
        const desc3 = n >= 3
          ? `单选 ${n} 选 3 = C(${n},3)`
          : n === 0
            ? `0 单选 + jqs + 2 best 双选 (1 票 × 1×2×2 笛卡尔)`
            : `1 单选 + 2 best 双选 (1 票 × 1×2×2 笛卡尔)`;
        console.log(`#### 3串1 (${desc3} = ${n3} 注)\n`);
        console.log(`| # | 线路 (让球方向) | 串关赔率 | 注金 |`);
        console.log(`|---|----------------|----------|------|`);
        picker.cat1.parlay3.forEach((t, i) => {
          const desc = t.legs.map(l => `${l.code} ${l.label}@${l.odds}`).join(' × ');
          console.log(`| ${i + 1} | ${desc} | ${t.odds} | ${t.stake} |`);
        });
        console.log(``);
      }
      // 4串1 (可能多注: 双选展开 2 注)
      if (n4 > 0) {
        const tArr = Array.isArray(picker.cat1.parlay4) ? picker.cat1.parlay4 : [picker.cat1.parlay4];
        const fill = 4 - Math.min(n, 4);
        const desc4 = n >= 4
          ? `单选 ${n} 选 4 = top 4`
          : `${n} 单选 + top ${fill} 双选 (双选展开 × 2)`;
        console.log(`#### 4串1 (${desc4} = ${tArr.length} 注, 原子模型)\n`);
        console.log(`| # | 线路 (让球方向) | 串关赔率 | 注金 |`);
        console.log(`|---|----------------|----------|------|`);
        tArr.forEach((t, i) => {
          const desc = t.legs.map(l => `${l.code} ${l.label}@${l.odds}`).join(' × ');
          console.log(`| 4×1 #${i + 1} | ${desc} | ${t.odds} | ${t.stake} |`);
        });
        console.log(``);
      }
    }
  } else {
    console.log(`(当日 rqspf 场次不足, 不出)`);
  }

  // --- cat2: 比分 2串1 ---
  console.log(`\n## 必出② 比分 2串1 (每场挑2比分, pickMode=${PCK.cat2.pickMode}, 挑场=${PCK.cat2.topNMode})\n`);
  if (picker.cat2.tickets.length > 0) {
    console.log(`选中场次: ${picker.cat2.matches.join(' / ')}  (共 ${picker.cat2.tickets.length} 注)\n`);
    console.log(`| # | 线路 (比分) | 串关赔率 |`);
    console.log(`|---|------------|----------|`);
    picker.cat2.tickets.forEach((t, i) => {
      const desc = t.legs.map(l => `${l.code} ${l.score}@${l.odds}`).join(' × ');
      console.log(`| ${i + 1} | ${desc} | ${t.odds} |`);
    });
  } else {
    console.log(`(当日有效场次不足 ${PCK.cat2.topN} 场, 不出)`);
  }

  // --- cat3: 高倍比分单关 (可选) ---
  console.log(`\n## 可选③ 高倍比分单关 (主池比分赔率 >= ${PCK.cat3.oddsThreshold})\n`);
  if (picker.cat3.length > 0) {
    for (const p of picker.cat3) console.log(`  ${p.code} ${p.match}: ${p.score}@${p.odds}`);
  } else {
    console.log(`(无高倍比分信号, 今日不出)`);
  }

  // --- cat4: zjq 单关 (可选) ---
  console.log(`\n## 可选④ 总进球(zjq) 单关 (仅纠偏信号)\n`);
  if (picker.cat4.length > 0) {
    for (const p of picker.cat4) {
      const desc = p.picks.map(k => `${k}球@${p.oddsMap[k]}`).join(' / ');
      console.log(`  ${p.code} ${p.match}: ${desc}  (${p.rule?.name || ''})`);
    }
  } else {
    console.log(`(无 zjq 纠偏信号, 今日不出)`);
  }

  // --- cat5: bqc 单关 (可选) ---
  console.log(`\n## 可选⑤ 半全场(bqc) 单关 (仅纠偏信号)\n`);
  if (picker.cat5.length > 0) {
    for (const p of picker.cat5) {
      const desc = p.picks.map(k => `${k}@${p.oddsMap[k]}`).join(' / ');
      console.log(`  ${p.code} ${p.match}: ${desc}  (${p.rule?.name || ''})`);
    }
  } else {
    console.log(`(无 bqc 纠偏信号, 今日不出)`);
  }

  // ======= 写入 JSON =======
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const jsonOut = {
    date: today,
    strategy: '31号策略 (F4主池 + 反方向单关 + RQSPF/ZJQ/BQC赔率纠偏)',
    picker,
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
//   报告同时落盘 modeling/artifacts/backtest_31_<时间戳>.md (仅留最近 2 份)
// ============================================================
function runBacktest() {
  // 把回测报告 tee 到 buffer, 结束时落盘成 Markdown (仅 console.log, 不影响终端输出)
  const _origLog = console.log;
  const _report = [];
  console.log = (...args) => { _report.push(args.map(String).join(' ')); _origLog(...args); };

  // ============================================================
  // 5 OR 瘦身 + E/F override 规则 (在 RQSPF 跟投和 Part1 逐场明细里统一使用)
  //   A: 主选=让胜  B: spf.home<1.3  C: spf.home∈[1.5,2.0)  D: |hc|=2
  //   E: hc=-1 + spf.home<1.5 强制让胜 (覆盖 baseline)
  //   F: hc=+1 + spf.away<1.5 强制让胜 (反向, 客热门爆冷)
  // ============================================================
  function shouldSlimRq(m, P) {
    if (!m || !P) return false;
    if (P.d === 'home') return true;
    if (m.spf?.home && m.spf.home < 1.3) return true;
    // C 规则(2026-06-20 关闭): spf.home∈[1.5,2.0) - 庄家陷阱盘,见 strategy_core.isRqSlim
    if (Math.abs(m.handicap ?? 0) === 2) return true;
    if (m.handicap === -1 && m.spf?.home && m.spf.home < 1.5) return true;
    if (m.handicap === 1 && m.spf?.away && m.spf.away < 1.5) return true;
    return false;
  }
  function shouldOverrideRq(m, P) {
    if (!m || !P) return null;
    if (m.handicap === -1 && m.spf?.home && m.spf.home < 1.5) {
      return { d: 'home', odds: m.rqspf?.home ?? P.odds, label: '让胜', rule: 'E' };
    }
    if (m.handicap === 1 && m.spf?.away && m.spf.away < 1.5) {
      return { d: 'home', odds: m.rqspf?.home ?? P.odds, label: '让胜', rule: 'F' };
    }
    return null;
  }

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
      spf: oddsDoc.odds.spf_latest,
      zjq: oddsDoc.odds.zjq_latest,
      bqc: oddsDoc.odds.bqc_latest,
      actualHome: actual.homeScore,
      actualAway: actual.awayScore,
    });
  }

  if (matches_.length === 0) {
    console.log('无历史比赛可回测');
    console.log = _origLog;
    return;
  }

  // 主池 ROI
  let mainCost = 0, mainReturn = 0, mainHits = 0;
  const details = [];
  for (const m of matches_) {
    mainCost += 3;
    const picks = f4Strategy(m, STRATEGY_CTX);
    const actual = `${m.actualHome}:${m.actualAway}`;
    const hit = picks.find(p => p.score === actual);
    if (hit) { mainReturn += hit.odds; mainHits++; }
    details.push({
      code: m.code, match: `${m.home}vs${m.away}`, type: classifyMatch(m, STRATEGY_CTX),
      actual, picks: picks.map(p => `${p.score}@${p.odds}`),
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

  // RQSPF 跟投 (5 OR + E/F 完整策略: 触发单选让胜, E/F 强制覆盖; 未触发走主+次双选)
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
    const strategy = rqspfStrategy({ rqspf: { home: rq.home, draw: rq.draw, away: rq.away }, spf: m.spf, handicap: m.handicap }, STRATEGY_CTX);
    if (!strategy) return null;
    const P = strategy.primary, S = strategy.secondary;
    // 5 OR + E/F 优先级: E/F override 强制让胜; 其它规则只跳次选(单选)
    const ovr = shouldOverrideRq(m, P);
    const slim = shouldSlimRq(m, P) || !!ovr;
    const effP = ovr ? { d: ovr.d, odds: ovr.odds, label: ovr.label } : P;
    // 命中计算: 单选(瘦身后) cost=1, 双选(未瘦身) cost=2
    let cost, ret, slimFlag;
    if (slim) {
      cost = 1;
      slimFlag = 'slim';
      if (effP.d === rqResult) ret = effP.odds;
      else ret = 0;
    } else {
      cost = 2;
      slimFlag = 'dual';
      if (P.d === rqResult) ret = P.odds;
      else if (S.d === rqResult) ret = S.odds;
      else ret = 0;
    }
    return { match: m, rq, rqResult, strategy, effP, ovr, cost, ret, slimFlag, rule: ovr ? { name: '纠偏-' + ovr.rule } : strategy.rule };
  }).filter(Boolean);

  if (rqspfBack.length > 0) {
    const n = rqspfBack.length;
    const totalCost = rqspfBack.reduce((s, x) => s + x.cost, 0);
    const totalRet = rqspfBack.reduce((s, x) => s + x.ret, 0);
    const hits = rqspfBack.filter(x => x.ret > 0).length;
    const roi = (totalRet - totalCost) / totalCost * 100;
    const corrN = rqspfBack.filter(x => x.rule.name.includes('纠偏')).length;
    const corrHits = rqspfBack.filter(x => x.rule.name.includes('纠偏') && x.ret > 0).length;
    const corrCost = rqspfBack.filter(x => x.rule.name.includes('纠偏')).reduce((s, x) => s + x.cost, 0);
    const corrRet = rqspfBack.filter(x => x.rule.name.includes('纠偏')).reduce((s, x) => s + x.ret, 0);
    const corrRoi = corrCost > 0 ? (corrRet - corrCost) / corrCost * 100 : 0;
    const slimN = rqspfBack.filter(x => x.slimFlag === 'slim').length;
    const dualN = n - slimN;
    console.log(`### RQSPF 跟投 (5 OR + E/F 完整策略: slim=单选 cost=1, dual=主+次 cost=2)\n`);
    console.log(`| 范围 | 命中 | 投入 | 回报 | ROI |`);
    console.log(`|------|------|------|------|-----|`);
    console.log(`| 全部 (${n}场: slim=${slimN} dual=${dualN}) | ${hits} | $${totalCost} | $${totalRet.toFixed(2)} | ${roi.toFixed(1)}% |`);
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

  // ============================================================
  // Part 1 (回测规则): 逐场表 —— rqspf 1-2选项&命中 + 3比分&命中 + 信号
  //   重点调优指标: rqspf 命中率、3比分单关 ROI
  // ============================================================
  const BT = loadBacktestMatches(PROJECT_ROOT);
  if (BT.length > 0) {
    const PCK = STRATEGY_CTX.params.picker;
    console.log(`\n## Part1 逐场明细 (rqspf选项&命中 + 3比分&命中 + 信号) —— ${BT.length} 场\n`);
    console.log(`| 场次 | 对阵 | hc | 实际 | rqspf主/次 | rq命中 | 3比分 | 比分命中 | 信号(高倍/zjq/bqc) |`);
    console.log(`|------|------|----|------|-----------|--------|-------|----------|--------------------|`);

    const RQ_LABEL = { home: '让胜', draw: '让平', away: '让负' };
    // shouldSlimRq / shouldOverrideRq 已在 runBacktest 顶部定义 (5 OR + E/F)
    let rqN = 0, rqHitP = 0, rqRetP = 0;               // rqspf 主选: 命中率 + ROI
    let rqHitS = 0, rqRetS = 0, rqCostS = 0;           // rqspf 次选: 仅在主未中时买(各1注)
    let rqHit2 = 0, rqRet2 = 0;                         // rqspf 主+次: 覆盖命中 (各1注, cost=2/场)
    let rqSlimHit = 0, rqSlimRet = 0, rqSlimCost = 0;   // 瘦身单选 (跳过次): cost=1/场
    let bf3N = 0, bf3Cost = 0, bf3Ret = 0, bf3Hit = 0; // 3比分单关: 每场买3个比分
    for (const m of BT) {
      const pred = buildPrediction(m, STRATEGY_CTX);
      const act = deriveActual(m);
      // rqspf 主/次 —— 命中标注命中的是 主 还是 次, 未覆盖则标实际方向
      let rqCell = '-', rqHitMark = '-', rqSlimMark = '-';
      if (pred.rq) {
        const P = pred.rq.primary, S = pred.rq.secondary;
        // E/F override 优先: 强制把主选改成让胜
        const ovr = shouldOverrideRq(m, P);
        const effP = ovr ? { d: ovr.d, odds: ovr.odds, label: ovr.label } : P;
        rqCell = `${effP.label}@${effP.odds} / ${S.label}@${S.odds}`;
        rqN++;
        const slim = shouldSlimRq(m, P);
        if (slim) { rqSlimCost++; rqSlimMark = `单选[${ovr ? ovr.rule : (P.d === 'home' ? 'A' : '')}]`; }
        if (effP.d === act.rqResult) {
          rqHitMark = `✅主@${effP.odds}`;
          rqHitP++; rqRetP += effP.odds; rqHit2++; rqRet2 += effP.odds;
          if (slim) { rqSlimHit++; rqSlimRet += effP.odds; rqSlimMark = `✅主@${effP.odds}`; }
        } else {
          // 主未中, 次算成本(1注), 命中给次选赔率
          rqCostS++;
          if (S.d === act.rqResult) {
            rqHitMark = `✅次@${S.odds}`;
            rqHitS++; rqRetS += S.odds; rqHit2++; rqRet2 += S.odds;
            if (slim) { rqSlimMark = `❌主${ovr ? '(' + ovr.rule + ')' : '(slim, 跳过次)'}`; }
          } else {
            rqHitMark = `❌(实际${RQ_LABEL[act.rqResult] || act.rqResult})`;
            if (slim) { rqSlimMark = `❌主${ovr ? '(' + ovr.rule + ')' : '(slim, 跳过次)'}`; }
          }
        }
      }
      // 3 比分
      const bf3 = pred.mainPicks || [];
      const bfCell = bf3.map(p => `${p.score}@${p.odds}`).join(' ');
      const bfHitPick = bf3.find(p => p.score === act.score);
      const bfHitMark = bfHitPick ? `✅@${bfHitPick.odds}` : '❌';
      if (bf3.length > 0) {
        bf3N++; bf3Cost += bf3.length;
        if (bfHitPick) { bf3Hit++; bf3Ret += bfHitPick.odds; }
      }
      // 信号
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
    const rqRoiS = rqCostS > 0 ? ((rqRetS - rqCostS) / rqCostS * 100).toFixed(1) : '0';
    console.log(`| rqspf 次选(主未中时) | ${rqHitS}/${rqCostS} | ${rqCostS > 0 ? (rqHitS / rqCostS * 100).toFixed(1) : 0}% | $${rqCostS} | $${rqRetS.toFixed(2)} | ${rqRoiS}% |`);
    const rqCost2 = rqN * 2;
    const rqRoi2 = rqCost2 > 0 ? ((rqRet2 - rqCost2) / rqCost2 * 100).toFixed(1) : '0';
    console.log(`| rqspf 主+次(各1注) | ${rqHit2}/${rqN} | ${rqN > 0 ? (rqHit2 / rqN * 100).toFixed(1) : 0}% | $${rqCost2} | $${rqRet2.toFixed(2)} | ${rqRoi2}% |`);
    // 瘦身单选: 触发了 shouldSlimRq 的场次, 只买主(跳过次)
    const rqRoiSlim = rqSlimCost > 0 ? ((rqSlimRet - rqSlimCost) / rqSlimCost * 100).toFixed(1) : '0';
    console.log(`| rqspf 瘦身单选(主+次条件筛选) | ${rqSlimHit}/${rqSlimCost} | ${rqSlimCost > 0 ? (rqSlimHit / rqSlimCost * 100).toFixed(1) : 0}% | $${rqSlimCost} | $${rqSlimRet.toFixed(2)} | ${rqRoiSlim}% |`);
    const bfRoi = bf3Cost > 0 ? ((bf3Ret - bf3Cost) / bf3Cost * 100).toFixed(1) : '0';
    console.log(`| 3比分单关 | ${bf3Hit}/${bf3N} | ${bf3N > 0 ? (bf3Hit / bf3N * 100).toFixed(1) : 0}% | $${bf3Cost} | $${bf3Ret.toFixed(2)} | ${bfRoi}% |`);

    // ============================================================
    // Part 2 (选单回测): 按天 selectBets + settleBets, 每类 ROI
    // ============================================================
    const byDay = groupByDay(BT);
    const agg = { cat1: { cost: 0, ret: 0, hits: 0, n: 0 }, cat2: { cost: 0, ret: 0, hits: 0, n: 0 }, cat3: { cost: 0, ret: 0, hits: 0, n: 0 }, cat4: { cost: 0, ret: 0, hits: 0, n: 0 }, cat5: { cost: 0, ret: 0, hits: 0, n: 0 } };
    let dayCount = 0;
    for (const [, dayMatches] of byDay) {
      dayCount++;
      const preds = dayMatches.map(m => buildPrediction(m, STRATEGY_CTX));
      const cats = selectBets(preds, STRATEGY_CTX);
      const actualByCode = {};
      for (const m of dayMatches) actualByCode[m.code] = deriveActual(m);
      const settled = settleBets(cats, actualByCode);
      for (const k of Object.keys(agg)) {
        agg[k].cost += settled[k].cost; agg[k].ret += settled[k].ret;
        agg[k].hits += settled[k].hits; agg[k].n += settled[k].n;
      }
    }

    console.log(`\n## Part2 选单回测 (按天选单, ${dayCount} 天 / ${BT.length} 场)\n`);
    console.log(`| 类别 | 注数 | 命中 | 投入 | 回报 | ROI |`);
    console.log(`|------|------|------|------|------|-----|`);
    const labels = { cat1: '① rqspf 2串1+3串1+4串1', cat2: '② 比分 2串1', cat3: '③ 高倍比分单', cat4: '④ zjq 单关', cat5: '⑤ bqc 单关' };
    for (const k of ['cat1', 'cat2', 'cat3', 'cat4', 'cat5']) {
      const c = agg[k];
      const roi = c.cost > 0 ? ((c.ret - c.cost) / c.cost * 100).toFixed(1) : '-';
      const warn = (c.n > 0 && c.n < 5) ? ' ⚠️样本<5' : '';
      console.log(`| ${labels[k]} | ${c.n} | ${c.hits} | $${c.cost} | $${c.ret.toFixed(2)} | ${roi}%${warn} |`);
    }
  }

  // ======= 回测报告落盘 (Markdown, 仅保留最近 2 份) =======
  console.log = _origLog;
  try {
    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace(/[:]/g, '');   // 2026-06-19T091030
    const header = `# 31号策略 回测报告\n\n生成时间: ${now.toISOString()}\n`;
    const outPath = path.join(ARTIFACTS_DIR, `backtest_31_${ts}.md`);
    fs.writeFileSync(outPath, header + '\n' + _report.join('\n') + '\n', 'utf-8');
    // 轮换: 按 mtime 新→旧, 只留最近 2 份
    const olds = fs.readdirSync(ARTIFACTS_DIR)
      .filter(f => /^backtest_31_.*\.md$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(ARTIFACTS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(2);
    for (const o of olds) fs.unlinkSync(path.join(ARTIFACTS_DIR, o.f));
    console.log(`\n回测报告写入: ${outPath}  (仅保留最近 2 份)`);
  } catch (e) {
    console.error(`⚠️ 回测报告落盘失败: ${e.message}`);
  }
}

// ============================================================
// 单日全量明细: 加载某日比赛 + 出全部 5 类选单 + 用赛果结算并标注命中
//   --day YYYY-MM-DD 触发
//   命中标注: 每个注后跟 ✅/❌; 末尾汇总当日总命中/总投入/总回报/ROI
// ============================================================
function runDayDetail(targetDay) {
  // 1) 加载该日所有赔率文件
  const oddsFiles = fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort();
  const dayMatches = [];
  for (const f of oddsFiles) {
    const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
    if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
    const day = (oddsDoc.basic.kickoff || '').split(' ')[0];
    if (day !== targetDay) continue;
    const mid = oddsDoc.basic.mid;
    const resultPath = path.join(RESULTS_DIR, mid + '.json');
    const hasResult = fs.existsSync(resultPath);
    const m = {
      code: oddsDoc.basic.code, mid, home: oddsDoc.basic.home, away: oddsDoc.basic.away,
      match: `${oddsDoc.basic.home}vs${oddsDoc.basic.away}`,
      kickoff: oddsDoc.basic.kickoff,
      handicap: oddsDoc.odds.handicap ?? 0,
      spf: oddsDoc.odds.spf_latest, rqspf: oddsDoc.odds.rqspf_latest,
      bf: oddsDoc.odds.bf_latest, zjq: oddsDoc.odds.zjq_latest, bqc: oddsDoc.odds.bqc_latest,
      hasResult,
    };
    if (hasResult) {
      const r = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      m.actualHome = r.homeScore; m.actualAway = r.awayScore;
    }
    dayMatches.push(m);
  }
  if (dayMatches.length === 0) {
    console.log(`无 ${targetDay} 比赛数据`); return;
  }
  const allSettled = dayMatches.every(m => m.hasResult);
  console.log(`\n[31号策略] 单日明细: ${targetDay} (${dayMatches.length} 场${allSettled ? ', 全部完赛' : ', 部分未完赛'})\n`);

  // 2) 出全部 5 类选单
  const matchPredictions = dayMatches.map(m => {
    const type = classifyMatch(m, STRATEGY_CTX);
    const mainPicks = f4Strategy(m, STRATEGY_CTX);
    const singleBets = singleBetStrategy(m, mainPicks, STRATEGY_CTX);
    const rq = rqspfStrategy(m, STRATEGY_CTX);
    const z = zjqStrategy(m, STRATEGY_CTX);
    const b = bqcStrategy(m, STRATEGY_CTX);
    return { ...m, type, mainPicks, singleBets, rq, z, b };
  });
  const picker = selectBets(matchPredictions, STRATEGY_CTX);
  const PCK = STRATEGY_CTX.params.picker;

  // 3) 准备赛果 lookup
  const actualByCode = {};
  for (const m of dayMatches) {
    if (!m.hasResult) continue;
    const diff = m.actualHome - m.actualAway;
    const hc = m.handicap ?? 0;
    let rqResult = diff + hc > 0 ? 'home' : diff + hc < 0 ? 'away' : 'draw';
    let zjqResult = String(m.actualHome + m.actualAway);
    if (m.actualHome + m.actualAway >= 7) zjqResult = '7+';
    actualByCode[m.code] = { score: `${m.actualHome}:${m.actualAway}`, rqResult, zjqResult };
  }

  // ====== 比赛结果概览 ======
  console.log(`## 比赛结果 (${dayMatches.length} 场)\n`);
  console.log(`| 场次 | 对阵 | hc | 实际比分 | rqspf | zjq |`);
  console.log(`|------|------|----|----------|-------|-----|`);
  for (const m of dayMatches) {
    const r = actualByCode[m.code];
    const rq = r ? (({ home: '让胜', draw: '让平', away: '让负' })[r.rqResult]) : '未完赛';
    const zjq = r ? r.zjqResult + '球' : '-';
    console.log(`| ${m.code} | ${m.match} | ${m.handicap} | ${r ? r.score : '-'} | ${rq} | ${zjq} |`);
  }

  // ====== ① RQSPF 选单 (含命中) ======
  console.log(`\n## ① RQSPF 选单 (单选 ${picker.cat1.slimCount} 场 / 双选 ${picker.cat1.dualCount} 场)\n`);
  const n2 = picker.cat1.parlay2.length;
  const n3 = picker.cat1.parlay3.length;
  // 4x1 在 n=3+dual 时是数组(双选展开 2 注), 否则是单 object
  const n4 = picker.cat1.parlay4
    ? (Array.isArray(picker.cat1.parlay4) ? picker.cat1.parlay4.length : 1)
    : 0;
  const totalCat1 = n2 + n3 + n4;
  const n = picker.cat1.slimCount;
  if (totalCat1 === 0) {
    console.log(`(当日 rqspf 场次不足, 不出)`);
  } else {
    // 单选场次状态
    const enriched = matchPredictions
      .filter(p => picker.cat1.matches.includes(p.code))
      .map(p => {
        const slim = (() => {
          const rq = p.rq;
          if (!rq?.primary) return false;
          if (p.handicap === 1) return false;                       // G (2026-06-20): 主受让+1 强制 DUAL, 同步 strategy_core.isRqSlim
          if (rq.primary.d === 'home') return true;                 // A: 主选=让胜
          if (p.spf?.home && p.spf.home < 1.3) return true;          // B: spf 大热门
          // C 规则(2026-06-20 关闭): spf.home∈[1.5,2.0) - 庄家陷阱盘,见 strategy_core.isRqSlim
          if (Math.abs(p.handicap ?? 0) === 2) return true;          // D: 大让球
          if (p.handicap === -1 && p.spf?.home && p.spf.home < 1.5) return true;  // E: 强让
          if (p.handicap === 1 && p.spf?.away && p.spf.away < 1.5) return true;    // F: 反向强让 (被 G 覆盖)
          return false;
        })();
        return { ...p, _slim: slim };
      });
    const slimN = enriched.filter(x => x._slim).length;
    const dualN = enriched.length - slimN;
    console.log(`### 单选场次状态 (共 ${enriched.length} 场: 单选 ${slimN} / 双选 ${dualN})\n`);
    console.log(`| 场次 | 对阵 | hc | 让胜 | 让平 | 让负 | 主选/次选 | 类型 |`);
    console.log(`|------|------|----|------|------|------|----------|------|`);
    for (const p of enriched) {
      const rq_ = p.rqspf || {};
      const rq = p.rq;
      const rqCell = rq ? `${rq.primary.label}@${rq.primary.odds} / ${rq.secondary.label}@${rq.secondary.odds}` : '-';
      const ruleName = rq?.rule?.name || '-';
      const kind = p._slim ? '单选' : '双选';
      console.log(`| ${p.code} | ${p.match} | ${p.handicap} | ${rq_.home ?? '-'} | ${rq_.draw ?? '-'} | ${rq_.away ?? '-'} | ${rqCell} | ${kind} (${ruleName}) |`);
    }
    console.log(`\n### 一张单子: 2x1(${n2}) + 3x1(${n3}) + 4x1(${n4}) = ${totalCat1} 注\n`);

    const renderLeg = (l) => {
      if (l.market === 'zjq') {
        const r = actualByCode[l.code];
        const hit = r && r.zjqResult === l.pick;
        return `${l.code} zjq${l.pick}球@${l.odds}${hit ? ' ✅' : (r ? ' ❌' : '')}`;
      }
      const r = actualByCode[l.code];
      const hit = r && r.rqResult === l.d;
      return `${l.code} ${l.label}@${l.odds}${hit ? ' ✅' : (r ? ' ❌' : '')}`;
    };
    const winT = (t) => t.legs.every(l => {
      const a = actualByCode[l.code]; if (!a) return false;
      if (l.market === 'zjq') return a.zjqResult === l.pick;
      return a.rqResult === l.d;
    });

    // 2串1
    if (n2 > 0) {
      console.log(`#### 2串1 (单选 ${n} 选 2 = C(${n},2) = ${n2} 注)\n`);
      console.log(`| # | 线路 (✅=中 ❌=未中) | 串关赔率 | 注金 | 命中 |`);
      console.log(`|---|--------------------|----------|------|------|`);
      picker.cat1.parlay2.forEach((t, i) => {
        const desc = t.legs.map(renderLeg).join(' × ');
        const win = winT(t);
        console.log(`| ${i + 1} | ${desc} | ${t.odds} | ${t.stake} | ${win ? `✅ +$${t.odds}` : '❌'} |`);
      });
      console.log(``);
    }
    // 3串1
    if (n3 > 0) {
      const desc3 = n >= 3
        ? `单选 ${n} 选 3 = C(${n},3)`
        : n === 0
          ? `0 单选 + jqs + 2 best 双选 (1 票 × 1×2×2 笛卡尔)`
          : `1 单选 + 2 best 双选 (1 票 × 1×2×2 笛卡尔)`;
      console.log(`#### 3串1 (${desc3} = ${n3} 注)\n`);
      console.log(`| # | 线路 (✅=中 ❌=未中) | 串关赔率 | 注金 | 命中 |`);
      console.log(`|---|--------------------|----------|------|------|`);
      picker.cat1.parlay3.forEach((t, i) => {
        const desc = t.legs.map(renderLeg).join(' × ');
        const win = winT(t);
        console.log(`| ${i + 1} | ${desc} | ${t.odds} | ${t.stake} | ${win ? `✅ +$${t.odds}` : '❌'} |`);
      });
      console.log(``);
    }
    // 4串1 (可能多注: 双选展开 2 注)
    if (n4 > 0) {
      const tArr = Array.isArray(picker.cat1.parlay4) ? picker.cat1.parlay4 : [picker.cat1.parlay4];
      const fill = 4 - Math.min(n, 4);
      const desc4 = n >= 4
        ? `单选 ${n} 选 4 = top 4`
        : `${n} 单选 + top ${fill} 双选 (双选展开 × 2)`;
      console.log(`#### 4串1 (${desc4} = ${tArr.length} 注, 原子模型)\n`);
      console.log(`| # | 线路 (✅=中 ❌=未中) | 串关赔率 | 注金 | 命中 |`);
      console.log(`|---|--------------------|----------|------|------|`);
      tArr.forEach((t, i) => {
        const desc = t.legs.map(renderLeg).join(' × ');
        const win = winT(t);
        console.log(`| 4×1 #${i + 1} | ${desc} | ${t.odds} | ${t.stake} | ${win ? `✅ +$${t.odds}` : '❌'} |`);
      });
      console.log(``);
    }
  }

  // ====== ② 比分 2串1 (含命中) ======
  console.log(`\n## ② 比分 2串1 (每场挑2比分, pickMode=${PCK.cat2.pickMode})\n`);
  if (picker.cat2.tickets.length > 0) {
    console.log(`选中场次: ${picker.cat2.matches.join(' / ')}  (共 ${picker.cat2.tickets.length} 注)\n`);
    console.log(`| # | 线路 (✅=中 ❌=未中) | 串关赔率 | 命中 |`);
    console.log(`|---|--------------------|----------|------|`);
    picker.cat2.tickets.forEach((t, i) => {
      const desc = t.legs.map(l => {
        const r = actualByCode[l.code];
        const hit = r && r.score === l.score;
        return `${l.code} ${l.score}@${l.odds}${hit ? ' ✅' : (r ? ' ❌' : '')}`;
      }).join(' × ');
      const win = t.legs.every(l => actualByCode[l.code]?.score === l.score);
      console.log(`| ${i + 1} | ${desc} | ${t.odds} | ${win ? `✅ +$${t.odds}` : '❌'} |`);
    });
  } else {
    console.log(`(当日有效场次不足 ${PCK.cat2.topN} 场, 不出)`);
  }

  // ====== ③ 高倍比分单关 ======
  console.log(`\n## ③ 高倍比分单关 (主池比分赔率 >= ${PCK.cat3.oddsThreshold})\n`);
  if (picker.cat3.length > 0) {
    for (const p of picker.cat3) {
      const r = actualByCode[p.code];
      const hit = r && r.score === p.score;
      console.log(`  ${p.code} ${p.match}: ${p.score}@${p.odds}${r ? (hit ? ' ✅' : ` ❌ (实际${r.score})`) : ''}`);
    }
  } else { console.log(`(无高倍比分信号, 今日不出)`); }

  // ====== ④ zjq 单关 (仅纠偏信号, auxOnly=012 球不出) ======
  console.log(`\n## ④ 总进球(zjq) 单关 (仅纠偏信号, 012 球辅助 bf 筛查不出单)\n`);
  if (picker.cat4.length > 0) {
    for (const p of picker.cat4) {
      const r = actualByCode[p.code];
      const hit = r && p.picks.includes(r.zjqResult);
      const desc = p.picks.map(k => `${k}球@${p.oddsMap[k]}`).join(' / ');
      console.log(`  ${p.code} ${p.match}: ${desc}${r ? (hit ? ` ✅ (实际${r.zjqResult}球)` : ` ❌ (实际${r.zjqResult}球)`) : ''}  (${p.rule?.name || ''})`);
    }
  } else { console.log(`(无 zjq 纠偏信号, 今日不出)`); }

  // ====== ⑤ bqc 单关 ======
  console.log(`\n## ⑤ 半全场(bqc) 单关 (仅纠偏信号)\n`);
  if (picker.cat5.length > 0) {
    // 注: deriveActual 提供 bqcResult, 这里需要补一下
    for (const p of picker.cat5) {
      const r = actualByCode[p.code];
      const desc = p.picks.map(k => `${k}@${p.oddsMap[k]}`).join(' / ');
      console.log(`  ${p.code} ${p.match}: ${desc}  (${p.rule?.name || ''})  ${r ? '' : '(bqcResult 未计算)'}`);
    }
  } else { console.log(`(无 bqc 纠偏信号, 今日不出)`); }

  // ====== 当日总账 ======
  if (allSettled) {
    const settled = settleBets(picker, actualByCode);
    console.log(`\n## 当日总账 (${targetDay})\n`);
    console.log(`| 类别 | 注数 | 命中 | 投入 | 回报 | ROI |`);
    console.log(`|------|------|------|------|------|-----|`);
    const labels = { cat1: '① rqspf 2x1+3x1+4x1', cat2: '② 比分 2串1', cat3: '③ 高倍比分单', cat4: '④ zjq 单关', cat5: '⑤ bqc 单关' };
    let totalCost = 0, totalRet = 0, totalHits = 0, totalN = 0;
    for (const k of ['cat1', 'cat2', 'cat3', 'cat4', 'cat5']) {
      const c = settled[k];
      const roi = c.cost > 0 ? ((c.ret - c.cost) / c.cost * 100).toFixed(1) : '-';
      console.log(`| ${labels[k]} | ${c.n} | ${c.hits} | $${c.cost} | $${c.ret.toFixed(2)} | ${roi}% |`);
      totalCost += c.cost; totalRet += c.ret; totalHits += c.hits; totalN += c.n;
    }
    const totalRoi = totalCost > 0 ? ((totalRet - totalCost) / totalCost * 100).toFixed(1) : '-';
    console.log(`| **合计** | **${totalN}** | **${totalHits}** | **$${totalCost}** | **$${totalRet.toFixed(2)}** | **${totalRoi}%** |`);
  } else {
    console.log(`\n(部分比赛未完赛, 跳过结算汇总)`);
  }
}

// ============================================================
// 主入口: 默认 predict, --backtest 触发回测, --day YYYY-MM-DD 触发单日明细
// ============================================================
const args = process.argv.slice(2);
if (args.includes('--backtest')) {
  runBacktest();
} else if (args[0] === '--day' && args[1]) {
  runDayDetail(args[1]);
} else {
  runPredict();
}
