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
    // 2026-07-03 调优 (sampled 2040337 BRA vs JPN 2-1 hc=-1):
    // 扩 favWinPick total 上限 2 → 3, 让 2:1/3:0/3:1 (主受让庄家低赔主胜) 进入主池
    // 旧 1-2 漏 2:1@5.8 (lowest odds 主胜), 26场主胜 7/13 实际落在 total 1-3
    normal:  { upsetTotalMin: 3, upsetTotalMax: 4, upsetOddsLo: 8, upsetOddsHi: 15, draw2OddsMax: 15, favWinTotalMax: 3 },
  },
  rqspf: {
    favHomeLo: 1.5, favHomeHi: 2.0,
    // 暂未启用: spf 大热门主队 (spf.home < spfFavHomeMax) → 跟让胜
    // 2026 数据: 8 场样本, 加规则后命中率 6/8=75% (vs 基线 7/8=87.5%), 净亏
    // 原因: spf<1.5 时 rq 让胜赔率多数已经最低, 基线已选对, 强制让胜反而打错 1 场
    // 设 0 禁用, 留参数等更多"spf 大热门 + rq 让胜赔率>让负"反例再激活
    spfFavHomeMax: 0,
    // 2026-06-27 调优 (sampled 2040177 伊朗 2-2 新西兰, hc=-1 走盘):
    // hc=-1 + rq.away 是最低赔率 + rq.away ∈ [1.5, 1.8) 主流盘
    //   实际走盘率 80% (5场触发, 4场让平命中), 改买让平 ROI +43.3% (n=32 综合)
    //   机制: 庄家看客胜 (rq.away 最低) 实际是"主让-1 走盘陷阱",
    //         走盘比分 (1:0, 2:1) 在主让-1 场景下让平赔率 3-4 区间被严重低估
    // 默认 1.5/1.8 = 关闭 (0/0) 时维持原基线 (最低赔率 away)
    hcMinus1AwayTrap: { minOdds: 1.5, maxOdds: 1.8 },
    // 2026-06-28 调优 (sampled 2040243 荷兰 5-1 瑞典, hc=-1, spf.home=1.54 主胜大热门):
    // hc=-1 + spf.home<1.6 (主胜大热门) + rq.away 是最低赔率 + rq.away ∈ [1.8, 2.2) 中盘
    //   实际让平率 0% (n=6 0场), 让胜/让负 5:5 完美对称, 改单选让胜 ROI +36.3% (n=6)
    //   [1.8, 2.2) 子桶 ROI +41.3% (n=4), [2.2, 2.5) 子桶 ROI +26.5% (n=2)
    //   机制: 庄家看客胜 (rq.away 最低 1.8-2.2) 但 spf 强烈看好主胜 (spf.home<1.6)
    //         → 让平率被庄家压到 0, 让胜 vs 让负 50/50 完美对称
    //         → 选 home 赔率 ~2.85 替代 away 赔率 ~2.0, 单注 ROI 提升 +30 pct
    //   跟 hcMinus1AwayTrap ([1.5, 1.8) 让平) 同源机制: 都是 hc=-1+away 最低+庄家陷阱,
    //   但本规则处理 [1.8, 2.2) 中盘 (让平率 0% 走"对称"路径) 而非 [1.5, 1.8) 走盘比分
    // 默认 1.8/2.2 = 关闭 (0/0) 时维持原基线 (最低赔率 away)
    spfFavHcMinus1AwayMid: { minOdds: 1.8, maxOdds: 2.2 },
    // 2026-06-30 调优 (sampled 2040308 约旦 1-3 阿根廷, hc=+2 走盘):
    // hc=+2 + rq.away 是最低赔率 + rq.away ∈ [1.5, 2.0) 主流盘
    //   实际走盘率 100% (3场触发, 3场让平命中), 改买让平 ROI +290% (n=3 子桶)
    //   机制: 跟 6-27 hcMinus1AwayTrap 镜像, "主受让+2 走盘陷阱"
    //         庄家看客胜 (rq.away 最低 1.5-2.0) 但客让 2 球后, 主队加 2 球刚好持平
    //         走盘比分 (0:2, 1:3, 1:2) 在主受让+2 场景下让平赔率 3.8-4.0 区间被严重低估
    //   跟 6-29 回滚的 hc=+1 主+平双选 完全不同: hc=+2 大盘 + 主流盘 away 热门
    //   关键差异: hc=+1 让平率 21.1% (n=19 不显著) vs hc=+2 让平率 100% (n=3 结构性)
    // 默认 1.5/2.0 = 关闭 (0/0) 时维持原基线 (最低赔率 away)
    hcPlus2AwayTrap: { minOdds: 1.5, maxOdds: 2.0 },
  },
  zjq: {
    normalTwoLo: 2.5, normalTwoHi: 3.5,
    // 2026-06-26 调优 (sampled 2040285 瑞士 2-1 加拿大 hc=-1 走盘):
    // 2 球纠偏在 rq.away<1.6 (让负热门) 场景下 0/2 命中 (n=2 ROI -100%)
    // 排除后剩余 n=13 ROI +18.5%, 命中率从 33.3% → 38.5%
    // 默认 1.6 关闭 rq.away<1.6 的 2 球纠偏, 走 baseline 让球→大/小球
    normalTwoRqAwayMin: 1.6,
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
    // 类别1: rqspf 三层 (2串1 + 3串1 + 4串1)
    // 每天按 isRqSlim 把所有 rqspf 场次分单选 (1 腿) / 双选 (2 腿):
    //   2串1: n 单选 → C(n,2) 注
    //   3串1: 单选+双选 (0/1/2+ 单选 三档, 每注必须含 ≥1 单选)
    //   4串1: n≥2 单选 → 1 注 4 选 4 (单选不够时补 top 双选, 单选 > 4 时取 top 4)
    // 挑场策略: topNMode = 'confidence' (默认: 让胜纠偏优先, 否则按让胜赔率最接近 1.5 的顺序)
    //                          'lowOdds' = 按 rqspf 主选赔率最低优先
    // 旧参数 legMode/topN 已废弃 (单选/双选由 isRqSlim 自动决定, 场次由 n 单选驱动)
    cat1: {
      topN: 3,                     // 废弃: 旧版 3串1 挑 N 场; 新版按 n 单选自动算 C(n,2) 等
      topNMode: 'confidence',      // 挑场排序策略: confidence | lowOdds (rankCat1 用)
      parlay3: true,               // 是否出 3串1
      parlay4IfAvailable: true,    // n 单选 ≥2 时出 4串1 (1 注, 原子模型)
      parlay4OnlyN4: true,         // 2026-06-20 新增: 仅 n=4 (4 单选) 才出 4串1
                                   //   n=3 降级到 n=2 不出 4x1
                                   //   n=2 本身(2 单选) 不出 4x1
                                   //   原因: n=2+双选笛卡尔 (1×1×2×2=4 注) ROI 负, 历史回测覆盖
      parlay2Stake: 1,             // 2026-06-20 测试: 2x1 注金倍率, 默认 1
                                    //   Kelly 55.9% 不算最高, 仅做对照
      parlay3aStake: 10,           // 2026-06-20 启用: 3x1a (3单选 only) 注金倍率
                                    //   Kelly 62.3% 是高频高赔最优, 推荐加倍
      parlay3bStake: 2,            // 2026-06-20 测试: 3x1b (2单选+1双选) 注金倍率
                                    //   折中: 既给 3x1b 一点权重(公平), 又不因 stake=10 拖累 ROI
                                    //   Kelly 0% ROI 0%, 加注主要是增加降级单选次选覆盖
      parlay3bSkip: true,          // 2026-06-20 启用: 跳过 3x1b 原始版本 (parlay3bDowngrade 替代)
                                    //   Kelly 0% ROI 0%, 12 注都白投
      parlay3bDowngrade: true,     // 2026-06-20 新增: 当 n>=3 时, 挑 1 单选降级为"虚拟双选"
                                    //   让 3x1b 覆盖次选信号 (parlay3bStake 倍注)
      parlay4N3WithDual: true,     // 2026-06-20 新增: n=3 + 1 dual 时, 是否出 4x1 (2 注, 双选展开)
      // legMode: 废弃, 见 isRqSlim (5 OR + E/F)
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
  { path: 'f4.normal.favWinTotalMax',     values: [2, 3, 4] },
  // --- zjq / bqc 纠偏 ---
  { path: 'zjq.normalTwoLo',              values: [2.3, 2.5, 2.7] },
  { path: 'zjq.normalTwoHi',              values: [3.3, 3.5, 3.7] },
  // 2026-06-26: 加 normalTwoRqAwayMin 旋钮 (0=关闭过滤, 1.5/1.6=温和过滤, 1.8/2.0=严格)
  { path: 'zjq.normalTwoRqAwayMin',       values: [0, 1.5, 1.6, 1.8] },
  { path: 'bqc.ssMax',                    values: [1.8, 2.0, 2.2] },
  // 2026-06-27: 加 hcMinus1AwayTrap 旋钮 (主让-1 走盘陷阱)
  //   minOdds 范围: 0=关闭, 1.4/1.5/1.6 主流盘过滤
  //   maxOdds 范围: 0=关闭, 1.7/1.8/2.0 上限
  // 2026-07-02 调优 (sampled 2040258 COL 2-0 COD, hc=-1, 4/5 命中): frozen=true
  //   6-29/6-30 反复验证 n=3-5 子桶过拟合, 33_fit 不应 fit 这两个旋钮
  { path: 'rqspf.hcMinus1AwayTrap.minOdds', values: [0, 1.4, 1.5, 1.6], frozen: true },
  { path: 'rqspf.hcMinus1AwayTrap.maxOdds', values: [0, 1.7, 1.8, 2.0], frozen: true },
  // 2026-06-28: 加 spfFavHcMinus1AwayMid 旋钮 (spf大热门主队+hc=-1+rq.away中盘→让胜)
  //   minOdds 范围: 0=关闭, 1.7/1.8/1.9 起点
  //   maxOdds 范围: 0=关闭, 2.1/2.2/2.5 终点 (1.8-2.2 较稳 ROI +41.3% n=4, 1.8-2.5 含 n=2 小样本 ROI +36.3%)
  // 2026-07-02 调优: 同样 frozen=true (n=4-6 子桶, 6-29 log 验证 33_fit 倾向关掉)
  { path: 'rqspf.spfFavHcMinus1AwayMid.minOdds', values: [0, 1.7, 1.8, 1.9], frozen: true },
  { path: 'rqspf.spfFavHcMinus1AwayMid.maxOdds', values: [0, 2.1, 2.2, 2.5], frozen: true },
  // 2026-06-30: 加 hcPlus2AwayTrap 旋钮 (主受让+2 走盘陷阱, 镜像 6-27 hcMinus1AwayTrap)
  //   minOdds 范围: 0=关闭, 1.4/1.5/1.6 主流盘过滤
  //   maxOdds 范围: 0=关闭, 1.8/2.0/2.2 上限
  // 2026-07-02 调优: 同样 frozen=true (n=3 子桶, overfit 风险最高)
  { path: 'rqspf.hcPlus2AwayTrap.minOdds', values: [0, 1.4, 1.5, 1.6], frozen: true },
  { path: 'rqspf.hcPlus2AwayTrap.maxOdds', values: [0, 1.8, 2.0, 2.2], frozen: true },
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
  const qualCache = {}; // code -> wc2026 晋级数据缓存
  for (const [code, rel] of Object.entries(idx.by_code || {})) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', rel), 'utf-8'));
      if (t.meta?.has_scorer_star === true) scorerStarCodes.add(code);
      if (t.name && tierOfCode[code]) nameToTier[t.name] = tierOfCode[code];
      if (t.wc2026) qualCache[code] = t.wc2026;
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
  // 2026-06-21 新增: 读取球队 wc2026 晋级信息 (积分/排名/压力/目标)
  // 返回 { group, position, pts, played, pressure_level, target_position, ... } 或 null
  const getQual = (team) => {
    const code = team ? (codeByName[team] || (variants && variants[team]) || null) : null;
    if (!code) return null;
    const wc = qualCache[code];
    if (!wc?.standings) return null;
    const s = wc.standings;
    const qp = wc.qualification_pressure || {};
    const km = wc.knockout_matchup || {};
    return {
      group: wc.group,
      position: s.position,
      pts: s.pts,
      played: s.played,
      remaining: 3 - s.played,
      pressure_level: qp.pressure_level || 'low',
      target_position: km.target_position || null,
      strategy_notes: km.strategy_notes || [],
    };
  };
  // 2026-06-21 新增: 生成一场比赛的晋级对比信号
  // 返回 { home, away, bothHighPressure, bigPressureDiff, homeNeedWin, awayNeedWin }
  const getMatchQualCtx = (m) => {
    const h = getQual(m.home);
    const a = getQual(m.away);
    if (!h && !a) return null;
    const hPts = h?.pts ?? null;
    const aPts = a?.pts ?? null;
    const highLevels = ['high', 'very-high', 'medium-high'];
    return {
      home: h,
      away: a,
      bothHighPressure: h && a && highLevels.includes(h.pressure_level) && highLevels.includes(a.pressure_level),
      bigPressureDiff: h && a && Math.abs((hPts ?? 0) - (aPts ?? 0)) >= 3,
      homeNeedWin: h && highLevels.includes(h.pressure_level),
      awayNeedWin: a && highLevels.includes(a.pressure_level),
      homeFavTied: h && h.pressure_level === 'low' && (hPts ?? 0) >= 3 && (aPts ?? 0) <= 1, // 主队积分领先+低压力=有放水心态
    };
  };
  return { getTeamTier, hasScorerStar, getQual, getMatchQualCtx };
}

// ==================================================================
// 4) 回测样本加载 (只读本届 2026, 不混入 2022)
// 2022 数据在 data/2022wc/, 由独立脚本按需读取
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
      spf: oddsDoc.odds?.spf_latest,
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

  // 2026-06-21 新增: 晋级信号融合 — 双方高压力 → 对攻大战 → BIG_BALL
  // 例: 厄瓜多尔vs库拉索 (双方0分均需抢分) → 进球数可能更多
  // 2026-06-23 调优: 双方高压力 + 大盘 (|hc|>=2) 实际是"双方怕输保守踢"
  //   例: 2040245 厄瓜多尔 0-0 库拉索 (handicap=-2, 双方 medium-high) → 0-0
  //   BIG_BALL 主池只追 4+ 球主胜比分, 完全不覆盖 0-0 走盘结果
  //   修复: 双方高压力 + 大盘 + 弱/防守型 → 降级到 WEAK_MATCH (走 WEAK 主池)
  if (ctx.getMatchQualCtx) {
    const qc = ctx.getMatchQualCtx(m);
    if (qc?.bothHighPressure) {
      const isBigHandicap = Math.abs(hc) >= P.bigHandicapAbs;
      const isWeakSide = (tier === 'weak' || tier === 'defensive') && !homeHasStar && !awayHasStar;
      if (isBigHandicap && isWeakSide) {
        // 双方高压力 + 大盘 + 弱/防守型 → 实际多走盘/小比分, 走 WEAK 路径
        isBigBall = false; // 覆盖上面所有 bigBall 设置
      } else {
        isBigBall = true;
      }
    }
  }

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
    // 2026-07-03 调优: favWinPick total 上限参数化 (n.favWinTotalMax, 默认 3)
    // 6-25 加 favWinPick 时写死 total<=2, 留 TODO; 2040337 实际 2:1 (total 3) 实证应纳入
    const favWinPick = all.filter(s => s.total >= 1 && s.total <= (n.favWinTotalMax ?? 3) && s.odds < n.draw2OddsMax && dirMatch(s) && !mainPicks.find(p => p.score === s.score)).sort((a, c) => a.odds - c.odds)[0];
    if (favWinPick) mainPicks.push(favWinPick);
    const upsetPick = all.filter(s => (s.total >= n.upsetTotalMin && s.total <= n.upsetTotalMax) && (s.odds >= n.upsetOddsLo && s.odds <= n.upsetOddsHi) && dirMatch(s)).sort((a, c) => a.odds - c.odds)[0];
    if (upsetPick) mainPicks.push(upsetPick);
    if (draws[1] && draws[1].odds < n.draw2OddsMax && !mainPicks.find(p => p.score === draws[1].score)) mainPicks.push(draws[1]);
    // 2026-06-25 调优: mainPicks 按 odds asc 排序, 保证 Top-1 = 最低赔率
    mainPicks.sort((a, c) => a.odds - c.odds);
    if (mainPicks.length < P.mainCount) {
      const sorted = all.slice().sort((a, c) => a.odds - c.odds).filter(s => !mainPicks.find(p => p.score === s.score));
      mainPicks = mainPicks.concat(sorted);
    }
    mainPicks = mainPicks.slice(0, P.mainCount);
  }

  return mainPicks;
}

// ==================================================================
// 7.5) isRqSlim —— 「单选 rqspf」判定 (5 OR + E/F + G 2026-06-20)
//   单选 = 该场 rqspf 出 1 腿 (仅 primary); 双选 = 出 2 腿 (primary + secondary)
//   用于 cat1 出单规则的"单选/双选"分流 (buildCat1)
//   与回测里 shouldSlimRq + shouldOverrideRq 的合并版等价: 命中任一即视为单选
//   注: E/F 在 isRqSlim 里只触发单选标记, 不覆盖 primary 方向 (保持预测和回测口径一致)
//
// 2026-06-20 G 规则 (主受让+1 强制 DUAL) → 2026-06-29 回滚 (过拟合):
//   6-20 n=6 时 ROI +11.6% → n=19 时 ROI -20.3% (-31.9 pct 退化)
//   同期基线(最低赔率) n=19 ROI +12.5%, 主+平双选严重过拟合
//   6-27 log 已预警, 今日执行回滚
//   改: G 规则从 force DUAL → force SLIM (单选), 让 hc=+1 走基线最低赔率
// ==================================================================
export function isRqSlim(m, primary) {
  if (!m || !primary) return false;
  if (m.handicap === 1) return true;                           // G (2026-06-29 回滚): 主受让+1 force SLIM (单选基线)
  if (primary.d === 'home') return true;                       // A: 主选=让胜
  if (m.spf?.home && m.spf.home < 1.3) return true;            // B: spf 大热门
// C 规则(2026-06-20 关闭): spf.home∈[1.5,2.0) 触发 slim
//   关闭原因: 9 场样本中 8 场主队 hc=-1 + rqspf 让负热门(基线最低赔率),
//            形成 spf 主胜热门 vs rqspf 让负热门的"庄家陷阱"盘口
//            关掉后改走双选(主+次), 至少兜底不浪费次选信号
//   典型反例: 2026-06-13 周五004 美国vs巴拉圭 (spf.home=1.79, rqspf.away=1.8, 实际让胜)
//   if (m.spf?.home && m.spf.home >= 1.5 && m.spf.home < 2.0) return true;  // C 已关闭
  if (Math.abs(m.handicap ?? 0) === 2) return true;            // D: 大让球
  if (m.handicap === -1 && m.spf?.home && m.spf.home < 1.5) return true;  // E: 强让
  if (m.handicap === 1 && m.spf?.away && m.spf.away < 1.5) return true;    // F: 反向强让 (G 6-29 回滚后变 fallback, spf<1.5 时单选 away)
  return false;
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
  // 2026-06-29 调优 (sampled 2040168 海地 0-1 苏格兰, hc=+1 主受让, actual 让负 away):
  //   6-20 加的"hc=+1 主+平双选"规则在 n=6 时 ROI +11.6%, n=19 时 ROI -20.3% (-31.9 pct 退化)
  //   同期基线(最低赔率) n=19 ROI +12.5%, 主+平双选严重过拟合
  //   6-27 log 已预警"hc=+1 主+平双选过拟合回滚"留待下轮, 今日执行回滚
  //   修复: 删除信号 0 (让 hc=+1 自然落到基线最低赔率), isRqSlim G 改 force SLIM (单选)
  //  (信号 0 已删除, hc=+1 走基线)
  // 信号① (2026-06-21 新增: 晋级信号融合 — 优先级最高)
  // 主队 high/medium-high 压力 + 让胜赔率 1.3-2.4 → 倾向让胜
  // 例: 荷兰vs瑞典(荷兰需抢分) / 德国vs科特迪瓦(德国需巩固头名)
  const triggerLevels = ['high', 'very-high', 'medium-high'];
  if (ctx.getMatchQualCtx) {
    const qc = ctx.getMatchQualCtx(m);
    if (qc?.home && triggerLevels.includes(qc.home.pressure_level)
      && qc.home.pts <= 3 && rq.home >= 1.3 && rq.home < 2.4) {
      return {
        primary: { d: 'home', odds: rq.home, label: '让胜' },
        secondary: sorted.find(d => d.d !== 'home') || sorted[1],
        rule: { name: '⭐晋级:主队需抢分→让胜', roi: '(动态)', n: 0 },
      };
    }
    // 客队高压力 + handicap 正向/平盘 → 客队拼命 → 倾向让负
    if (qc?.away && triggerLevels.includes(qc.away.pressure_level)
      && qc.away.pts <= 3 && (m.handicap ?? 0) >= 0 && rq.away >= 1.3 && rq.away < 2.4) {
      return {
        primary: { d: 'away', odds: rq.away, label: '让负' },
        secondary: sorted.find(d => d.d !== 'away') || sorted[1],
        rule: { name: '⭐晋级:客队需抢分→让负', roi: '(动态)', n: 0 },
      };
    }
  }
  // 信号②: spf 大热门主队 (spf.home < 1.5) → 跟让胜
  // 2026 数据: 8 场样本, 命中 7 场 (87.5%), ROI +76.4%
  const spf = m.spf;
  if (spf?.home && P.spfFavHomeMax > 0 && spf.home < P.spfFavHomeMax) {
    return {
      primary: { d: 'home', odds: rq.home, label: '让胜' },
      secondary: sorted.find(d => d.d !== 'home') || sorted[1],
      rule: { name: 'SPF大热门→让胜', roi: '+76.4%', n: 8 },
    };
  }
  // 信号②: 让胜纠偏 (主流盘) home odds ∈ [1.5, 2.0)
  if (rq.home >= P.favHomeLo && rq.home < P.favHomeHi) {
    return {
      primary: { d: 'home', odds: rq.home, label: '让胜' },
      secondary: sorted.find(d => d.d !== 'home') || sorted[1],
      rule: { name: '让胜纠偏(主流盘)', roi: '+20.5%', n: 6 },
    };
  }
  // 2026-06-27 调优 (sampled 2040177 伊朗 2-2 新西兰, hc=-1 走盘比分):
  // 信号②b: 主让-1 + 走盘陷阱 (away 是最低赔率 + rq.away ∈ [minOdds, maxOdds))
  //   机制: 庄家看客胜 (rq.away 最低) 实际是"主让-1 走盘陷阱",
  //         走盘比分 (1:0, 2:1) 在主让-1 场景下让平赔率 3-4 区间被严重低估
  //   样本: 5 场触发 → 4 场让平命中 (80% 走盘率), 改买让平 ROI +43.3% (n=32 综合)
  //   优先级: 低于让胜纠偏 (避免覆盖 hc=-1 + home 是主流盘场景), 高于基线
  //   默认 minOdds=1.5 / maxOdds=1.8, 都设 0 = 关闭
  const trap = P.hcMinus1AwayTrap || { minOdds: 1.5, maxOdds: 1.8 };
  if (m.handicap === -1 && trap.minOdds > 0 && trap.maxOdds > trap.minOdds) {
    const minOdds = Math.min(rq.home, rq.draw, rq.away);
    if (rq.away === minOdds && rq.away >= trap.minOdds && rq.away < trap.maxOdds) {
      return {
        primary: { d: 'draw', odds: rq.draw, label: '让平' },
        secondary: sorted.find(d => d.d !== 'draw') || sorted[1],
        rule: { name: '⭐主让-1+走盘陷阱(away主流盘)→让平', roi: '+43.3%', n: 32 },
      };
    }
  }
  // 2026-06-30 调优 (sampled 2040308 约旦 1-3 阿根廷, hc=+2 走盘):
  // 信号②b': 主受让+2 + 走盘陷阱 (away 是最低赔率 + rq.away ∈ [minOdds, maxOdds))
  //   机制: 跟 6-27 hcMinus1AwayTrap 镜像, "主受让+2 走盘陷阱"
  //         庄家看客胜 (rq.away 最低) 但客让 2 球后, 主队加 2 球刚好持平
  //         走盘比分 (0:2, 1:3, 1:2) 在主受让+2 场景下让平赔率 3.8-4.0 区间被严重低估
  //   样本: 3 场触发 (rq.away ∈ [1.5, 2.0)) → 3 场让平命中 (100% 走盘率)
  //   优先级: 跟 hcMinus1AwayTrap 镜像, 让胜纠偏 (home [1.5, 2.0)) > 本规则 ([1.5, 2.0)) > 基线
  //   默认 minOdds=1.5 / maxOdds=2.0, 都设 0 = 关闭
  //   跟 6-29 回滚的 hc=+1 主+平双选 完全不同: hc=+2 大盘 + 主流盘 away 热门 vs hc=+1 小盘 + 任意 away
  //   关键差异: hc=+2 让平率 100% (n=3 结构性) vs hc=+1 让平率 21.1% (n=19 不显著)
  const plus2Trap = P.hcPlus2AwayTrap || { minOdds: 1.5, maxOdds: 2.0 };
  if (m.handicap === 2 && plus2Trap.minOdds > 0 && plus2Trap.maxOdds > plus2Trap.minOdds) {
    const minOdds = Math.min(rq.home, rq.draw, rq.away);
    if (rq.away === minOdds && rq.away >= plus2Trap.minOdds && rq.away < plus2Trap.maxOdds) {
      return {
        primary: { d: 'draw', odds: rq.draw, label: '让平' },
        secondary: sorted.find(d => d.d !== 'draw') || sorted[1],
        rule: { name: '⭐主受让+2+走盘陷阱(away主流盘)→让平', roi: '+290%', n: 3 },
      };
    }
  }
  // 2026-06-28 调优 (sampled 2040243 荷兰 5-1 瑞典, hc=-1, spf.home=1.54 主胜大热门):
  // 信号②c: spf大热门主队 + hc=-1 + rq.away 中盘最低 → 单选让胜
  //   机制: 庄家看客胜 (rq.away 最低 1.8-2.2) 但 spf 强烈看好主胜 (spf.home<1.6)
  //         → 实际让平率 0% (n=6 0场), 让胜/让负 5:5 完美对称
  //         → 选 home 赔率 ~2.85 替代 away 赔率 ~2.0, 单注 ROI 提升 +30 pct
  //   样本: 4 场触发 (rq.away ∈ [1.8, 2.2) + spf.home<1.6) → 2 让胜+2 让负, 改让胜 ROI +41.3%
  //         6 场全样本 (含 [2.2, 2.5) 2 场) → 3 让胜+3 让负, 改让胜 ROI +36.3%
  //   优先级: 让胜纠偏 (home [1.5, 2.0)) > 走盘陷阱 ([1.5, 1.8)) > 本规则 ([1.8, 2.2)) > 基线
  //   默认 minOdds=1.8 / maxOdds=2.2 (n=4 较稳), 都设 0 = 关闭
  const spfFavMid = P.spfFavHcMinus1AwayMid || { minOdds: 1.8, maxOdds: 2.2 };
  if (m.handicap === -1 && spfFavMid.minOdds > 0 && spfFavMid.maxOdds > spfFavMid.minOdds
      && spf?.home && spf.home < 1.6) {
    const minOdds = Math.min(rq.home, rq.draw, rq.away);
    if (rq.away === minOdds && rq.away >= spfFavMid.minOdds && rq.away < spfFavMid.maxOdds) {
      return {
        primary: { d: 'home', odds: rq.home, label: '让胜' },
        secondary: sorted.find(d => d.d !== 'home') || sorted[1],
        rule: { name: '⭐spf大热门+hc=-1+rq.away中盘(1.8-2.2)→让胜', roi: '+41.3%', n: 4 },
      };
    }
  }
  // 基线: 最低赔率 (注: 2026-06-20 改成"主让-1 基线", 主受让+1 走信号 0 不进基线)
  return {
    primary: sorted[0],
    secondary: sorted[1],
    rule: { name: '基线(最低赔率,主让-1)', roi: '+19.5%', n: 20 },
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

  // 2026-06-21 新增: 晋级信号融合 (早于主分类判断)
  // 主队或客队高压力 → 进球倾向增加。如果原本是 NORMAL 但有一方压力 high+
  // 例: 荷兰vs瑞典 (荷兰积分不够需抢分) → 倾向更多进球
  if (ctx.getMatchQualCtx) {
    const qc = ctx.getMatchQualCtx(m);
    if ((qc?.homeNeedWin || qc?.awayNeedWin) && type === 'NORMAL') {
      const coldPick = keys.slice().sort((a, b) => odds[b] - odds[a])[0];
      // 高压力比赛 → 倾向 2-3 球范围
      // 跳过 2 球纠偏规则的严格区间检查，直接推 2-3 球
      // 但保留原 NORMAL 的路径：先看 2 球赔率是否在主流盘，仍用 2 球纠偏；否则推 3 球
      // 2026-06-26 调优 (sampled 2040163 韩国 2-1 捷克, hc=-1, rq.away=1.39 高压力):
      // 高压力 + rq.away<1.6 (让负热门) → 实际走盘 3 球, 2 球错
      // 加 rq.away 过滤: <1.6 时推 3 球 (走盘 1:0/2:1 走盘比分), ≥1.6 时维持 2 球
      const rqAway = m.rqspf?.away ?? 999;
      const rqAwayMin = P.normalTwoRqAwayMin ?? 1.6;
      if (rqAway < rqAwayMin && odds['3'] > 1) {
        return {
          corrected: { pick: '3', odds: odds['3'] },
          coldPick, stable: '3',
          coldOdds: odds[coldPick], stableOdds: odds['3'],
          rule: { name: '晋级信号:高压力NORMAL+rq.away<1.6→3球(走盘)', roi: '(动态)', n: 0 },
        };
      }
      if (odds['2'] >= P.normalTwoLo && odds['2'] < 4) {
        return {
          corrected: { pick: '2', odds: odds['2'] },
          coldPick, stable: '2',
          coldOdds: odds[coldPick], stableOdds: odds['2'],
          rule: { name: '晋级信号:高压力NORMAL→2球', roi: '见晋级分析', n: 0 },
        };
      }
      // 3 球也做纠偏 (有晋级压力 提升进球倾向
    }
  }

  if (type === 'NORMAL' && odds['2'] >= P.normalTwoLo && odds['2'] < P.normalTwoHi
      && (!m.rqspf?.away || m.rqspf.away >= (P.normalTwoRqAwayMin ?? 1.6))) {
    const coldPick = keys.slice().sort((a, b) => odds[b] - odds[a])[0];
    return {
      corrected: { pick: '2', odds: odds['2'] },
      coldPick, stable: '2',
      coldOdds: odds[coldPick], stableOdds: odds['2'],
      rule: { name: 'NORMAL+2球纠偏(主流盘,rq.away≥1.6)', roi: '+18.5%', n: 13 },
    };
  }

  if (type === 'BIG_BALL') {
    const smallKeys = keys.filter(k => ['0', '1', '2'].includes(k));
    if (smallKeys.length === 0) return null;
    const cold = keys.slice().sort((a, b) => odds[b] - odds[a])[0];
    return {
      corrected: { picks: smallKeys, odds: Object.fromEntries(smallKeys.map(k => [k, odds[k]])), cost: smallKeys.length },
      auxOnly: true,  // 012 球辅助 bf 筛查用, 不单独出 zjq 单关
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
      auxOnly: true,  // 012 球辅助 bf 筛查用, 不单独出 zjq 单关
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
    spf: m.spf,
    mainPicks: f4Strategy(m, ctx),
    rq: rqspfStrategy(m, ctx),
    z: zjqStrategy(m, ctx),
    b: bqcStrategy(m, ctx),
    // 2026-06-21: 加 type, 让 selectBets 能识别 NORMAL/BIG_BALL/WEAK_MATCH
    //   cat3 cat3 扩展 highOddsHomeWin 候选池 (4-1/4-0/5-1/4-2) 需要
    type: classifyMatch(m, ctx),
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

function cat1Legs(m) {
  // 单选 (isRqSlim=true) 只出 1 腿 primary; 双选出 2 腿 primary + secondary
  const rq = m.rq;
  const primary = { code: m.code, match: m.match, d: rq.primary.d, label: rq.primary.label, odds: rq.primary.odds };
  if (isRqSlim(m, rq.primary)) return [primary];
  return [primary, { code: m.code, match: m.match, d: rq.secondary.d, label: rq.secondary.label, odds: rq.secondary.odds }];
}

// buildCat1 (新版 31 规则) — 单选/双选分流 + 2串1/3串1/4串1
//   n = 当日单选 (isRqSlim) 场次; m = 双选 场次
//   2串1: n≥2 时, C(n,2) 注 (全是单选)
//   3串1:
//     - n≥3: C(n,3) 注 (从单选里抽 3 场, 不掺双选)
//     - n=0 + jqs + ≥2 双选: 1 票 (jqs + 2 best 双选 rqspf) = 1×2×2=4 注
//     - n=1 + ≥2 双选: 1 票 (单选 + 2 best 双选) = 1×2×2=4 注
//     - 其他: 跳过
//   4串1: n≥2 时, 1 票 4 选 4 (双选只用于填补 4 场不足的位置)
//     - 2 ≤ n ≤ 4: 全单选 + top (4-n) 双选
//     - n > 4:     top 4 单选 (按 rankCat1 排序)
function buildCat1(dayMatches, c1, RQ) {
  const empty = {
    matches: [], tickets: [], parlay2: [], parlay3: [], parlay4: null,
    legMode: 'atomic', stake: 1, slimCount: 0, dualCount: 0,
  };
  if (!c1.parlay3) return empty;
  const ranked = rankCat1(dayMatches, c1, RQ);
  if (ranked.length < 2) return empty;

  // 单选/双选分流 + 算腿
  const enriched = ranked.map(m => {
    const slim = isRqSlim(m, m.rq.primary);
    return { m, slim, legs: cat1Legs(m) };
  });
  const slims = enriched.filter(x => x.slim);
  const duals = enriched.filter(x => !x.slim);

  const result = {
    ...empty,
    matches: enriched.map(x => x.m.code),
    slimCount: slims.length,
    dualCount: duals.length,
  };

  // 笛卡尔展开工具: 给一组 match-leg-set, 生成笛卡尔注 (单注 stake=1)
  const expand = (legSets, stake = 1) => cartesian(legSets).map(legs => ({
    legs,
    odds: +legs.reduce((s, l) => s * l.odds, 1).toFixed(2),
    stake,
  }));

  // ----- 降级场选择 (BEFORE 2x1/3x1) -----
  //   2026-06-20 规则: n>=3 + parlay3bDowngrade 时, 挑 1 单选降级为"虚拟双选"
  //   降级场必须在 3x1 里, 2x1 仅做非降级场组合
  let downgradeSlimCode = null;
  if (c1.parlay3bDowngrade && slims.length >= 3) {
    const weakest = [...slims].sort((a, b) => b.m.rq.primary.odds - a.m.rq.primary.odds)[0];
    downgradeSlimCode = weakest.m.code;
  }
  const bSlims = downgradeSlimCode
    ? slims.filter(s => s.m.code !== downgradeSlimCode)
    : slims;

  // ----- 2串1: C(bSlims, 2) 注, 仅做非降级场组合 -----
  // 2026-06-20 规则: 2x1 仅做非降级场的 C(bSlims.length, 2) 注
  if (bSlims.length >= 2) {
    for (let i = 0; i < bSlims.length; i++) {
      for (let j = i + 1; j < bSlims.length; j++) {
        result.parlay2.push(...expand([bSlims[i].legs, bSlims[j].legs], c1.parlay2Stake));
      }
    }
  }

  // ----- 3串1 -----
  //   n≥3:
  //     (a) 3x1a: 1 降级 + 2 非降级 (C(n-1, 2) 注, 降级场必须在 3x1 里)
  //     (b) 3x1b: 1 降级次选 + 2 非降级 (C(n-1, 2) 注, 虚拟双选只用 secondary, 不混原 duals)
  //   n=2 + ≥1 双选: 3x1c (2 单选 + top 1 双选的主边) = 1 注 (2026-06-20 用户新规则)
  //   n=0 + jqs + ≥2 双选: 1 票 (jqs + 2 best 双选 rqspf) = 1×2×2=4 注
  //   n=1 + ≥2 双选: 1 票 (单选 + 2 best 双选) = 1×2×2=4 注
  //   其他: 跳过
  if (slims.length >= 3) {
    // (a) 3x1a: 必须含降级场 (1 降级 + 2 非降级 = C(n-1, 2) 注)
    //   2026-06-20 规则: 降级场必须在 3x1 里, 其他 n-1 场做 C(n-1, 2) 组合
    if (downgradeSlimCode) {
      const downgradeSlim = slims.find(s => s.m.code === downgradeSlimCode);
      for (let i = 0; i < bSlims.length; i++) {
        for (let j = i + 1; j < bSlims.length; j++) {
          result.parlay3.push(...expand([bSlims[i].legs, bSlims[j].legs, downgradeSlim.legs], c1.parlay3aStake));
        }
      }
    } else {
      // 无降级时回退: 3 单选 only (C(n,3)) - 适用 n=4
      for (let i = 0; i < slims.length; i++) {
        for (let j = i + 1; j < slims.length; j++) {
          for (let k = j + 1; k < slims.length; k++) {
            result.parlay3.push(...expand([slims[i].legs, slims[j].legs, slims[k].legs], c1.parlay3aStake));
          }
        }
      }
    }
    // (b) 3x1b: 降级场次选 + 2 非降级 (1 注, 虚拟双选只用 secondary, 不混原 duals)
    //   2026-06-20 规则: 双边的默认不选进 3x1, 只用降级的虚拟双选 secondary
    if (bSlims.length >= 2 && downgradeSlimCode && c1.parlay3bDowngrade) {
      const downgradeSlim = slims.find(s => s.m.code === downgradeSlimCode);
      // 用 raw rqspf 算降级场的次选方向
      const r = downgradeSlim.m.rqspf;
      if (r) {
        const dirs = [
          { d: 'home', label: '让胜', odds: r.home },
          { d: 'draw', label: '让平', odds: r.draw },
          { d: 'away', label: '让负', odds: r.away },
        ].filter(x => x.odds != null);
        dirs.sort((a, b) => a.odds - b.odds);
        const primary = dirs[0];
        const secondary = dirs[1];
        if (primary && secondary) {
          const secondaryLeg = { code: downgradeSlim.m.code, match: downgradeSlim.m.match, d: secondary.d, label: secondary.label, odds: secondary.odds };
          for (let i = 0; i < bSlims.length; i++) {
            for (let j = i + 1; j < bSlims.length; j++) {
              result.parlay3.push(...expand([bSlims[i].legs, bSlims[j].legs, [secondaryLeg]], c1.parlay3bStake));
            }
          }
        }
      }
    }
  } else if (slims.length === 0 && duals.length >= 2) {
    // 0 单选: 放弃 3 best 双选组合; 若当日有 jqs 纠偏信号, 出 1 组合 (jqs + 2 best 双选 rqspf)
    // 0 单选 + 无 jqs: 跳过 (不出 3串1)
    const jqsMatch = enriched.find(x => x.m.z?.corrected);
    if (jqsMatch) {
      const j = jqsMatch.m.z.corrected;
      const jqsKey = j.pick ?? j.picks?.[0];
      const jqsOdds = (typeof j.odds === 'object' ? j.odds[jqsKey] : j.odds) ?? 0;
      if (jqsKey && jqsOdds > 0) {
        const jqsLeg = {
          code: jqsMatch.m.code,
          match: jqsMatch.m.match,
          market: 'zjq',
          pick: jqsKey,
          odds: jqsOdds,
          label: `zjq ${jqsKey}球`,
        };
        // 2 best 双选 rqspf: 优先排除 jqsMatch 自身
        const dualsForRq = jqsMatch.slim === false
          ? duals.filter(d => d.m.code !== jqsMatch.m.code).slice(0, 2)
          : duals.slice(0, 2);
        if (dualsForRq.length === 2) {
          const legSets = [[jqsLeg], dualsForRq[0].legs, dualsForRq[1].legs];
          result.parlay3.push(...expand(legSets));
        }
      }
    }
  } else if (slims.length === 1 && duals.length >= 2) {
    // 1 单选: 1 组合 (单选 + 2 best 双选)
    const [d1, d2] = duals;
    result.parlay3.push(...expand([slims[0].legs, d1.legs, d2.legs]));
  } else if (slims.length === 2 && duals.length >= 1) {
    // 2 单选 + 1 双选: 3x1c = 2 单选 + top 1 双选的主边 = 1×1×1 = 1 注 (2026-06-20 新增)
    //   双选只取 primary(主边),不展开 secondary; 避免 1×1×2 = 2 注 成本
    //   stake=1 (单注, 不加倍; 2026-06-20 用户规则)
    //   如果 2 双选都在, 用 duals[0] (rankCat1 排序在前, 置信度最高)
    const bestDual = duals[0];
    const primaryLeg = bestDual.legs[0];  // cat1Legs 返回 [primary] 或 [primary, secondary], primary 在前
    result.parlay3.push(...expand([slims[0].legs, slims[1].legs, [primaryLeg]], 1));
  }

  // ----- 4串1: n=4 (4 单选) 时, 4 选 4 (原子模型) -----
  //   2026-06-20 改: parlay4OnlyN4 默认 true
  //     - n=3 降级后 n=2: 不出 4x1 (parlay3bDowngrade 接管)
  //     - n=2 (2 单选): 不出 4x1 (1×1×2×2 笛卡尔 ROI 负, 历史回测覆盖)
  //     - 仅 n=4 (4 单选) 出 4x1 (1 注)
  //   旧逻辑 n>=2: 双选展开 × 2 (parlay4N3WithDual) → 已废
  if (c1.parlay4IfAvailable && slims.length >= 2) {
    let p4Matches = null;
    if (c1.parlay4OnlyN4) {
      // 严格模式: 仅 n=4 才出 4x1
      if (slims.length === 4 && duals.length === 0) {
        p4Matches = slims.slice(0, 4);
      }
    } else {
      // 旧模式: n>=2 + 双选补位
      if (slims.length >= 4) {
        p4Matches = slims.slice(0, 4);
      } else {
        const need = 4 - slims.length;
        const fill = duals.slice(0, need);
        p4Matches = fill.length === need ? [...slims, ...fill] : null;
      }
      if (p4Matches) {
        const isN3WithDual = slims.length === 3 && duals.length >= 1;
        if (isN3WithDual && c1.parlay4N3WithDual === false) {
          p4Matches = null;
        }
      }
    }
    if (p4Matches) {
      const legSets = p4Matches.map(x => x.legs);
      const expanded = cartesian(legSets).map(legs => ({
        legs,
        odds: +legs.reduce((s, l) => s * l.odds, 1).toFixed(2),
        stake: 1,
      }));
      result.parlay4 = expanded.length === 1 ? expanded[0] : expanded;
    }
  }

  // 向后兼容: tickets 字段 (老代码读这里). settleBets 不再读, 避免重复计 cost
  result.tickets = [...result.parlay2, ...result.parlay3];
  return result;
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
    // 2026-06-21: NORMAL+hc<0 扩展 highOddsHomeWin 候选 (4-1/4-0/5-1/4-2)
    //   历史 4 场 NORMAL 4-5 球主胜 (2040165/173/183/236) 因主池 caps 全部不覆盖, 加单关兜底
    //   优先 4-1 (历史 50% 命中), 退路 4-0/4-2/5-1; odds [20, 100] 区间
    if (m.type === 'NORMAL' && m.handicap < 0 && picks.length === 0) {
      const allBf = parseOdds(m.bf || m.bf_latest);
      const priority = ['4:1', '4:2', '5:1', '4:0'];
      for (const score of priority) {
        const cand = allBf.find(s => s.score === score && s.odds >= 20 && s.odds <= 100);
        if (cand) { picks.push(cand); break; }
      }
    }
    for (const p of picks) cat3.push({ code: m.code, match: m.match, score: p.score, odds: p.odds });
  }

  const cat4 = [];
  for (const m of dayMatches) {
    const z = m.z;
    if (!z) continue;
    if (P.cat4.needCorrected && !z.corrected) continue;
    if (z.auxOnly) continue;  // 012 球规则 (BIG_BALL/WEAK_MATCH) 只辅助 bf 筛查, 不出 zjq 单
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

  // cat1 三层: parlay2 (C(n,2)) + parlay3 (单选+双选) + parlay4 (n≥2 单选, 可能多注)
  // 不再读 legacy tickets 字段 (buildCat1 仍写入该字段供老代码兼容, 但避免重复计 cost)
  const c1 = categories.cat1 || {};
  // 4x1 在 n=3+dual 时是数组(双选展开 2 注), 否则是单 object
  const parlay4Tickets = c1.parlay4
    ? (Array.isArray(c1.parlay4) ? c1.parlay4 : [c1.parlay4])
    : [];
  const c1All = []
    .concat(c1.parlay2 || [])
    .concat(c1.parlay3 || [])
    .concat(parlay4Tickets);
  for (const t of c1All) {
    const stake = t.stake || 1;
    out.cat1.n++; out.cat1.cost += stake;
    // rqspf 腿用 rqResult 比 d; jqs 腿 (market='zjq') 用 zjqResult 比 pick
    const win = t.legs.every(l => {
      const act = actualByCode[l.code];
      if (!act) return false;
      if (l.market === 'zjq') return act.zjqResult === l.pick;
      return act.rqResult === l.d;
    });
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