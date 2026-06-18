// 31_tight_anti_value.js — 主模型策略脚本
// 核心策略: 主池=F4混合 (ROI+134%) + 单关=反方向/平局高赔率比分 (爆冷门)
// 用法:
//   node modeling/scripts/31_tight_anti_value.js --predict    (默认, 预测今日比赛)
//   node modeling/scripts/31_tight_anti_value.js --backtest   (回测历史比赛)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

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
// 不再硬编码 5 个数组, 球队增减只改 data/teams/ 目录
const TEAMS_INDEX_FILE = path.join(PROJECT_ROOT, 'data', 'teams', '_index.json');

function loadTeams() {
  const idx = JSON.parse(fs.readFileSync(TEAMS_INDEX_FILE, 'utf-8'));
  // by_tier: code 数组 (e.g. by_tier.top = ['ARG', 'BRA', 'FRA', 'GER'])
  const codeByTier = idx.by_tier || {};
  // 反查: code -> tier
  const tierOfCode = {};
  for (const [tier, codes] of Object.entries(codeByTier)) {
    for (const c of codes) tierOfCode[c] = tier;
  }
  // by_name: 中文名 -> code
  const codeByName = idx.by_name || {};
  // name_variants_to_code: 别名 (沙特/乌兹别克/刚果(金)) -> code
  const variants = idx.name_variants_to_code || {};
  const nameToCode = { ...codeByName, ...variants };
  // 扫 57 个 team json 找 has_scorer_star=true
  const scorerStarCodes = new Set();
  const nameToTier = {}; // 中文名 -> tier
  for (const [code, rel] of Object.entries(idx.by_code || {})) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', rel), 'utf-8'));
      if (t.meta?.has_scorer_star === true) scorerStarCodes.add(code);
      if (t.name && tierOfCode[code]) nameToTier[t.name] = tierOfCode[code];
    } catch (e) {
      console.error(`⚠️ 加载 ${rel} 失败: ${e.message}`);
    }
  }
  // 名字别名也进 nameToTier
  for (const [alias, code] of Object.entries(variants)) {
    if (tierOfCode[code]) nameToTier[alias] = tierOfCode[code];
  }
  return { tierOfCode, codeByName, nameToCode, nameToTier, scorerStarCodes, by_tier: codeByTier };
}
const TEAMS = loadTeams();
// 中文名 -> code 的反向 (供 31 脚本里用 m.home (中文名) 查询)
function codeOf(teamName) {
  if (!teamName) return null;
  return TEAMS.nameToCode[teamName] || null;
}
function getTeamTier(team) {
  const code = codeOf(team);
  if (code) return TEAMS.tierOfCode[code] || 'unknown';
  return TEAMS.nameToTier[team] || 'unknown';
}
function hasScorerStar(team) {
  const code = codeOf(team);
  if (code) return TEAMS.scorerStarCodes.has(code);
  return false;
}
function normalizeScore(s) { return s.split(':').map(p => String(Number(p))).join(':'); }

// 解析 bf_latest 比分赔率, 返回 {score, odds, home, away, total}[]
function parseOdds(bf) {
  if (!bf) return [];
  return Object.entries(bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => {
      const score = normalizeScore(k);
      const parts = score.split(':');
      return { score, odds: v, home: Number(parts[0]), away: Number(parts[1]), total: Number(parts[0]) + Number(parts[1]) };
    });
}

// 比赛分类: BIG_BALL / WEAK_MATCH / NORMAL
function classifyMatch(m) {
  const hc = m.handicap;
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  const homeHasStar = hasScorerStar(m.home), awayHasStar = hasScorerStar(m.away);
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

// ============================================================
// F4 混合策略: 2x@10-30 + 1x@30-50, 返回 [{score, odds}]
// ============================================================
function f4Strategy(m) {
  const type = classifyMatch(m);
  const all = parseOdds(m.bf);
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;

  let mainPicks = [];

  if (type === 'BIG_BALL') {
    // BIG_BALL: 3档大球比分 (低赔率<12 / 12-25 / 15-40)
    const big = all.filter(s => s.total >= 4 && dirMatch(s)).sort((a, b) => a.odds - b.odds);
    const safe = big.filter(s => s.odds < 12)[0] || big[0];
    const midHigh = big.filter(s => s.odds >= 12 && s.odds <= 25)[0] || big[Math.floor(big.length / 2)] || big[big.length - 1];
    const high = big.filter(s => s.odds >= 15 && s.odds <= 40)[0] || big[big.length - 1] || midHigh;
    mainPicks = [safe, midHigh, high].filter((p, i, arr) => arr.findIndex(q => q.score === p.score) === i);
    if (mainPicks.length < 3) {
      const sorted = all.slice().sort((a, b) => a.odds - b.odds);
      for (const s of sorted) if (!mainPicks.find(p => p.score === s.score)) mainPicks.push(s);
    }
    mainPicks = mainPicks.slice(0, 3);
  } else if (type === 'WEAK_MATCH') {
    // WEAK_MATCH: 2x@10-30 (主体) + 1x@30-50 (赌大冷门)
    const mainPool = all.filter(s => s.total >= 1 && s.total <= 4).sort((a, b) => b.odds - a.odds);
    const corePicks = mainPool.filter(s => s.odds >= 10 && s.odds <= 30).slice(0, 2);
    const upsetPick = mainPool.filter(s => s.odds > 30 && s.odds <= 50)[0];
    mainPicks = corePicks.concat(upsetPick ? [upsetPick] : []);
    if (mainPicks.length < 3) {
      const filler = all.slice().sort((a, b) => a.odds - b.odds).filter(s => !mainPicks.find(p => p.score === s.score));
      mainPicks = mainPicks.concat(filler).slice(0, 3);
    }
  } else {
    // NORMAL: 1平局保底 + 3-4球@7-15方向爆冷 + 中赔率平局或低赔率方向小胜
    const draws = all.filter(s => s.home === s.away).sort((a, b) => a.odds - b.odds);
    if (draws[0]) mainPicks.push(draws[0]);
    const upsetPick = all.filter(s => (s.total >= 3 && s.total <= 4) && (s.odds >= 7 && s.odds <= 15) && dirMatch(s)).sort((a, b) => a.odds - b.odds)[0];
    if (upsetPick) mainPicks.push(upsetPick);
    if (draws[1] && draws[1].odds < 15 && !mainPicks.find(p => p.score === draws[1].score)) mainPicks.push(draws[1]);
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) if (!mainPicks.find(p => p.score === s.score)) mainPicks.push(s);
    mainPicks = mainPicks.slice(0, 3);
  }

  return mainPicks;
}

// ============================================================
// RQSPF 跟投 + 赔率纠偏 (2026-06-18 升级)
// insights 提炼 (26场):
//   - 基础: 每场选最低赔率方向 → ROI +16.6% (基线)
//   - 纠偏: 让胜 initial 赔率 [1.5, 2.0) 主流盘 → 命中 4/6=66.7%, ROI +20.5% ⭐
// 策略: 命中条件优先于赔率排序, 满足纠偏条件就用纠偏, 否则用最低赔率
// ============================================================
function rqspfStrategy(m) {
  if (!m.rqspf) return null;
  const rq = m.rqspf;
  if (!rq.home || !rq.draw || !rq.away) return null;
  const dirs = [
    { d: 'home', odds: rq.home, label: '让胜' },
    { d: 'draw', odds: rq.draw, label: '让平' },
    { d: 'away', odds: rq.away, label: '让负' },
  ];
  const sorted = dirs.slice().sort((a, b) => a.odds - b.odds);
  // ---- 纠偏 #1: 让胜赔率 [1.5, 2.0) 主流盘 → 优先让胜 (ROI +20.5%) ----
  if (rq.home >= 1.5 && rq.home < 2.0) {
    return {
      primary: { d: 'home', odds: rq.home, label: '让胜' },
      secondary: sorted.find(d => d.d !== 'home') || sorted[1],
      rule: { name: '让胜纠偏(1.5-2.0主流盘)', roi: '+20.5%', n: 6 },
    };
  }
  // ---- 基线: 选最低赔率方向 + 次低 ----
  return {
    primary: sorted[0],
    secondary: sorted[1],
    rule: { name: '基线(最低赔率)', roi: '+16.6%', n: 26 },
  };
}

// ============================================================
// ZJQ 跟投 + 赔率纠偏 + 比赛类型判断 (2026-06-18 第二轮升级)
// insights 提炼 (23场 WC only, 按 NORMAL/BIG_BALL/WEAK_MATCH 拆):
//   - NORMAL  + 2球赔率 [2.5, 3.5) → 推 2 球 (命中 5/10=50%, ROI +54%) ⭐
//   - BIG_BALL → 推 0+1+2 (命中 2/5=40%, ROI +205%) ⭐ 反市场冷门
//   - WEAK_MATCH → 推 0+1+2 (命中 4/5=80%, ROI +10%) ⭐
// 触发逻辑: 先看分类(classifyMatch), 再选球数
// ============================================================
function zjqStrategy(m) {
  if (!m.zjq) return null;
  const odds = m.zjq;
  const keys = ['0', '1', '2', '3', '4', '5', '6', '7+'].filter(k => odds[k] > 1);
  if (keys.length === 0) return null;
  const type = classifyMatch(m);

  // ---- NORMAL: 2 球赔率 [2.5, 3.5) 主流盘 → 推 2 球 (ROI +54%) ----
  if (type === 'NORMAL' && odds['2'] >= 2.5 && odds['2'] < 3.5) {
    const coldPick = keys.slice().sort((a, b) => odds[b] - odds[a])[0];
    return {
      corrected: { pick: '2', odds: odds['2'] },
      coldPick, stable: '2',
      coldOdds: odds[coldPick], stableOdds: odds['2'],
      rule: { name: 'NORMAL+2球纠偏(2.5-3.5主流盘)', roi: '+54%', n: 10 },
    };
  }

  // ---- BIG_BALL: 推 0+1+2 保守小球 (ROI +205% 反市场) ----
  if (type === 'BIG_BALL') {
    const smallKeys = keys.filter(k => ['0', '1', '2'].includes(k));
    if (smallKeys.length === 0) return null;
    return {
      corrected: {
        picks: smallKeys,
        odds: Object.fromEntries(smallKeys.map(k => [k, odds[k]])),
        cost: smallKeys.length,
      },
      coldPick: keys.slice().sort((a, b) => odds[b] - odds[a])[0],
      stable: '0+1+2',
      coldOdds: odds[keys.slice().sort((a, b) => odds[b] - odds[a])[0]],
      stableOdds: smallKeys.map(k => odds[k]).reduce((a, b) => a + b, 0) / smallKeys.length,
      rule: { name: 'BIG_BALL+0+1+2(反市场冷门)', roi: '+205%', n: 5 },
    };
  }

  // ---- WEAK_MATCH: 推 0+1+2 (ROI +10%) ----
  if (type === 'WEAK_MATCH') {
    const smallKeys = keys.filter(k => ['0', '1', '2'].includes(k));
    if (smallKeys.length === 0) return null;
    return {
      corrected: {
        picks: smallKeys,
        odds: Object.fromEntries(smallKeys.map(k => [k, odds[k]])),
        cost: smallKeys.length,
      },
      coldPick: keys.slice().sort((a, b) => odds[b] - odds[a])[0],
      stable: '0+1+2',
      coldOdds: odds[keys.slice().sort((a, b) => odds[b] - odds[a])[0]],
      stableOdds: smallKeys.map(k => odds[k]).reduce((a, b) => a + b, 0) / smallKeys.length,
      rule: { name: 'WEAK_MATCH+0+1+2', roi: '+10%', n: 5 },
    };
  }

  // ---- 基线: 让球→大/小球 + 冷门 (兜底) ----
  const sorted = keys.slice().sort((a, b) => odds[b] - odds[a]);
  const coldPick = sorted[0];
  const hc = Math.abs(m.handicap ?? 0);
  let stable;
  if (hc >= 2) {
    stable = keys.filter(k => ['4', '5', '6', '7+'].includes(k)).sort((a, b) => odds[a] - odds[b])[0];
  } else {
    stable = keys.filter(k => ['1', '2'].includes(k)).sort((a, b) => odds[a] - odds[b])[0];
  }
  return {
    corrected: null,
    coldPick, stable,
    coldOdds: odds[coldPick], stableOdds: odds[stable],
    rule: { name: '基线(让球→大/小球)', roi: '+3.1%', n: 26 },
  };
}

// ============================================================
// BQC 跟投 + 赔率纠偏 + 比赛类型判断 (2026-06-18 第二轮升级)
// insights 提炼 (23场 WC only, 胜胜+平平<2.0 拆子样本):
//   - BIG_BALL: 2/2 命中 100%, ROI +537% ⭐⭐ (市场看好主队赢到底=实际真赢到底)
//   - NORMAL:  3/4 命中 75%,  ROI -32% ⚠️样本<5 (命中率不低但赔率低)
// 触发: BIG_BALL + 胜胜赔率<2.0 → 推胜胜+平平; 否则基线 TOP3
// ============================================================
function bqcStrategy(m) {
  if (!m.bqc) return null;
  const odds = m.bqc;
  const keys = Object.keys(odds).filter(k => (odds[k] ?? 999) < 999 && (odds[k] ?? 0) > 1);
  if (keys.length === 0) return null;
  const type = classifyMatch(m);

  // ---- BIG_BALL + 胜胜赔率 < 2.0 → 胜胜+平平 组合 (ROI +537% 子样本) ----
  if (type === 'BIG_BALL' && odds['胜胜'] && odds['胜胜'] < 2.0) {
    return {
      corrected: {
        picks: ['胜胜', '平平'].filter(k => odds[k] > 0),
        odds: { 胜胜: odds['胜胜'], 平平: odds['平平'] },
        cost: 2,
      },
      top3: keys.slice().sort((a, b) => odds[a] - odds[b]).slice(0, 3).map(k => ({ key: k, odds: odds[k] })),
      rule: { name: 'BIG_BALL+胜胜纠偏(胜胜<2.0+平平)', roi: '+537%', n: 2 },
    };
  }

  // ---- NORMAL/WEAK_MATCH: 胜胜赔率 < 2.0 也用胜胜+平平 (NORMAL 命中率 75% 高) ----
  if (odds['胜胜'] && odds['胜胜'] < 2.0) {
    return {
      corrected: {
        picks: ['胜胜', '平平'].filter(k => odds[k] > 0),
        odds: { 胜胜: odds['胜胜'], 平平: odds['平平'] },
        cost: 2,
      },
      top3: keys.slice().sort((a, b) => odds[a] - odds[b]).slice(0, 3).map(k => ({ key: k, odds: odds[k] })),
      rule: { name: `${type}+胜胜纠偏(胜胜<2.0+平平)`, roi: '-32%', n: 4 },
    };
  }

  // ---- 基线: TOP3 最低赔率 ----
  const sorted = keys.sort((a, b) => odds[a] - odds[b]);
  return {
    corrected: null,
    top3: sorted.slice(0, 3).map(k => ({ key: k, odds: odds[k] })),
    rule: { name: '基线(TOP3最低赔率)', roi: '-10%', n: 26 },
  };
}

// ============================================================
// 单关策略: BIG_BALL→反方向/平局高赔率, WEAK_MATCH→2个@25-50, NORMAL→不推
// 参数 insights: ROI_INSIGHTS 全局, 用来决定"取 1 个 vs 2 个"
//   - 若 insights 提示"反方向1个25-65" ROI > "2个" -> 取 1 个
//   - 若 insights 提示"任意1个25-50"  ROI > "2个" -> 取 1 个
// ============================================================
function pickSingleCount(antiRules, fallback) {
  if (!ROI_INSIGHTS) return fallback;
  // 从 insights 找对应规则
  const rules = ROI_INSIGHTS.bf?.rules || [];
  const sbRules = ROI_INSIGHTS.single_bet || [];
  const target = [...antiRules.map(n => rules.find(r => r.rule.includes(n))),
                  ...antiRules.map(n => sbRules.find(r => r.rule.includes(n)))]
                  .filter(Boolean);
  if (target.length === 0) return fallback;
  // 简单规则: 若 1 个 vs 2 个两个都在, 1 个 ROI 高则取 1 个
  const oneRoi = target.find(r => /1个/.test(r.rule))?.roi;
  const twoRoi = target.find(r => /2个/.test(r.rule))?.roi;
  if (oneRoi !== undefined && twoRoi !== undefined) {
    return oneRoi > twoRoi ? 1 : 2;
  }
  return fallback;
}
function singleBetStrategy(m, mainPicks) {
  const type = classifyMatch(m);
  const all = parseOdds(m.bf);
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;
  const existingScores = new Set(mainPicks.map(p => p.score));
  const notInMain = (s) => !existingScores.has(s.score);

  if (type === 'BIG_BALL') {
    // 反方向/平局高赔率比分, 赔率@25-65, 进球数合理
    const anti = all.filter(s => !dirMatch(s) && s.total >= 1 && s.total <= 6 && s.odds >= 25 && s.odds <= 65 && notInMain(s))
                    .sort((a, b) => a.odds - b.odds);
    const k = pickSingleCount(['反方向'], 2);
    return anti.slice(0, k);
  } else if (type === 'WEAK_MATCH') {
    // 弱弱对阵: 赔率@25-50 高赔率比分
    const weak = all.filter(s => s.total >= 1 && s.total <= 4 && s.odds >= 25 && s.odds <= 50 && notInMain(s))
                    .sort((a, b) => a.odds - b.odds);
    const k = pickSingleCount(['任意'], 2);
    return weak.slice(0, k);
  } else {
    // NORMAL: 不推单关
    return [];
  }
}

// ============================================================
// 生成组合 (2串1 / 3串1)
// ============================================================
function generateCombos(matches) {
  // 2串1: 所有两两组合
  const c2 = [];
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      for (const pi of matches[i].mainPicks) {
        for (const pj of matches[j].mainPicks) {
          c2.push({
            matches: [matches[i].code, matches[j].code],
            picks: [{ match: matches[i].match, score: pi.score, odds: pi.odds }, { match: matches[j].match, score: pj.score, odds: pj.odds }],
            odds: +(pi.odds * pj.odds).toFixed(2),
          });
        }
      }
    }
  }
  c2.sort((a, b) => b.odds - a.odds);

  // 3串1: 所有三三元组合
  const c3 = [];
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      for (let k = j + 1; k < matches.length; k++) {
        for (const pi of matches[i].mainPicks) {
          for (const pj of matches[j].mainPicks) {
            for (const pk of matches[k].mainPicks) {
              c3.push({
                matches: [matches[i].code, matches[j].code, matches[k].code],
                picks: [
                  { match: matches[i].match, score: pi.score, odds: pi.odds },
                  { match: matches[j].match, score: pj.score, odds: pj.odds },
                  { match: matches[k].match, score: pk.score, odds: pk.odds },
                ],
                odds: +(pi.odds * pj.odds * pk.odds).toFixed(2),
              });
            }
          }
        }
      }
    }
  }
  c3.sort((a, b) => b.odds - a.odds);

  return { c2: c2.slice(0, 10), c3: c3.slice(0, 10) };
}

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
    const type = classifyMatch(m);
    const mainPicks = f4Strategy(m);
    const singleBets = singleBetStrategy(m, mainPicks);
    return { ...m, type, mainPicks, singleBets };
  });

  // 生成组合
  const combos = generateCombos(matchPredictions);

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
    console.log(`| ${p.code} | ${p.match} | ${p.type} | ${p.handicap} | ${p.spf.home}/${p.spf.draw}/${p.spf.away} | ${mainStr} | ${singleStr} |`);
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
  const rqspfPicks = matchPredictions.map(p => ({ p, rq: rqspfStrategy(p) })).filter(x => x.rq);
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
  const zjqPicks = matchPredictions.map(p => ({ p, z: zjqStrategy(p) })).filter(x => x.z);
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
  const bqcPicks = matchPredictions.map(p => ({ p, b: bqcStrategy(p) })).filter(x => x.b);
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
    const picks = f4Strategy(m);
    const actual = `${m.actualHome}:${m.actualAway}`;
    const hit = picks.find(p => p.score === actual);
    if (hit) { mainReturn += hit.odds; mainHits++; }
    details.push({
      code: m.code, match: `${m.home}vs${m.away}`, type: classifyMatch(m),
      actual, picks: picks.map(p => `${p.score}@${p.odds}`),
      hit: !!hit, hitOdds: hit ? hit.odds : 0,
    });
  }

  // 单关 ROI
  let singleCost = 0, singleReturn = 0, singleHits = 0;
  for (const m of matches_) {
    const picks = f4Strategy(m);
    const singles = singleBetStrategy(m, picks);
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
    const strategy = rqspfStrategy({ rqspf: { home: rq.home, draw: rq.draw, away: rq.away } });
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
    const strategy = zjqStrategy(m);  // 传完整 m, 让 classifyMatch 能拿到 home/away
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
    const strategy = bqcStrategy(m);  // 传完整 m, 让 classifyMatch 能拿到 home/away
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
