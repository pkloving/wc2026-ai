// 23_v7_ab_test.js — v7 新思路: 球风信号前置判断大小球
// 核心: zjq 说2球，但实际 ≥4球 的场占 38%！庄家系统性低估大球
// 新做法:
//   Step1: 先读球风+让球+球星 → 判断是否"大球场景"(bigBall)
//   Step2: bigBall=true → homeGoals/awayGoals 上限放宽到7, zjq 只罚"0-1球"
//          bigBall=false → 按原始球风+zjq 正常罚分
//   Step3: 弱队无星 vs 有进球型强队的组合 → 一律抬升强队侧进球上限到 6
//   (之前 v4 只有 3-4，不足以覆盖瑞典 5:1 突尼斯这种)
//
// 同时跑 v4 baseline 和 v7，对比，确保不回归
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');

// ========== 工具(来自 12_r013_user_rules.js) ==========
const TOP_TIER = ['德国', '巴西', '阿根廷', '法国'];
const SECOND_TIER = ['比利时', '葡萄牙', '荷兰', '英格兰', '西班牙',
                    '奥地利', '瑞典', '瑞士', '韩国', '墨西哥', '克罗地亚',
                    '乌拉圭', '哥伦比亚', '摩洛哥', '美国', '日本', '塞内加尔',
                    '丹麦', '塞尔维亚', '挪威', '波兰', '埃及', '尼日利亚'];
const DEFENSIVE = ['沙特阿拉伯', '沙特', '伊朗', '突尼斯'];
const WEAK_TEAMS = ['南非', '捷克', '波黑', '巴拉圭', '海地', '库拉索',
                   '阿尔及利亚', '约旦', '新西兰', '伊拉克', '苏格兰', '土耳其',
                   '澳大利亚', '卡塔尔', '厄瓜多尔', '科特迪瓦',
                   '乌兹别克', '秘鲁', '北爱尔兰', '匈牙利',
                   '哈萨克', '冰岛', '哥斯达黎加',
                   '威尔士', '喀麦隆', '加纳', '巴拿马', '刚果(金)'];
const SCORER_STAR_TEAMS = new Set([
  '法国', '阿根廷', '挪威', '乌拉圭', '葡萄牙', '英格兰', '西班牙', '巴西',
  '荷兰', '德国', '韩国', '日本', '美国', '墨西哥', '埃及', '波兰', '丹麦', '塞尔维亚',
]);
function hasScorerStar(team) { return SCORER_STAR_TEAMS.has(team); }
function getTeamTier(team) {
  if (TOP_TIER.includes(team)) return 'top';
  if (SECOND_TIER.includes(team)) return 'second';
  if (DEFENSIVE.includes(team)) return 'defensive';
  if (WEAK_TEAMS.includes(team)) return 'weak';
  return 'unknown';
}
function predictGoalRange(home, away) {
  const h = getTeamTier(home);
  const a = getTeamTier(away);
  let homeGoals = h === 'top' ? [2,3] : (h === 'second' ? [1,2] : (h === 'defensive' ? [0,1] : [0,1]));
  let awayGoals = a === 'top' ? [2,3] : (a === 'second' ? [1,2] : (a === 'defensive' ? [0,1] : [0,1]));
  return { homeGoals, awayGoals };
}
function normalizeScore(s) { return s.split(':').map(p => String(Number(p))).join(':'); }
function fairProbFromOdds(odds) { return 1 / (odds * 1.13); }

// ========== 读比赛数据 ==========
const matches_ = [];
for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
  const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
  if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
  const mid = oddsDoc.basic.mid;
  const resultPath = path.join(RESULTS_DIR, mid + '.json');
  if (!fs.existsSync(resultPath)) continue;
  const actual = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  matches_.push({
    code: oddsDoc.basic.code, home: oddsDoc.basic.home, away: oddsDoc.basic.away,
    handicap: oddsDoc.odds.handicap ?? 0,
    bf: oddsDoc.odds.bf_latest,
    zjq: oddsDoc.odds.zjq_latest,
    bqc: oddsDoc.odds.bqc_latest,
    actualHome: actual.homeScore,
    actualAway: actual.awayScore,
  });
}

// ========== pickScores: v4 baseline ==========
function pickScoresV4(m) {
  const { home, away } = m;
  let { homeGoals, awayGoals } = predictGoalRange(home, away);
  const hc = m.handicap;
  const favIsHome = hc <= -2, favIsAway = hc >= 2;
  const GOAL_CAP = 4;
  const homeCap = favIsHome ? 7 : GOAL_CAP;
  const awayCap = favIsAway ? 7 : GOAL_CAP;
  const clampRangeFav = (r, cap) => [Math.min(r[0], cap), Math.min(Math.max(r[1], r[0]), cap)];
  if (hc <= -2) {
    const target = awayGoals[0] + Math.abs(hc);
    if (homeGoals[1] < target + 2) homeGoals = [Math.max(homeGoals[0], target), target + 2];
  } else if (hc >= 2) {
    const target = homeGoals[0] + Math.abs(hc);
    if (awayGoals[1] < target + 2) awayGoals = [Math.max(awayGoals[0], target), target + 2];
  }
  if (hasScorerStar(home) && homeGoals[0] < 1) homeGoals = [1, Math.max(homeGoals[1], 1)];
  if (hasScorerStar(away) && awayGoals[0] < 1) awayGoals = [1, Math.max(awayGoals[1], 1)];
  homeGoals = clampRangeFav(homeGoals, homeCap);
  awayGoals = clampRangeFav(awayGoals, awayCap);

  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, prob: fairProbFromOdds(v) }));

  let realScores = allScores;
  if (hc >= 2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg <= ag; });
  else if (hc <= -2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg >= ag; });

  // rqspf 方向: 用实际结果反向推导(因为我们只测比分准确性, 不测方向准确性)
  // 实际上我们简化处理: 对所有满足方向的比分打分, 主方向 = 让球主胜/客胜的热门
  const dir = hc <= 0 ? 'home' : 'away';
  const filtered = realScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    const adj = hg + hc;
    return dir === 'home' ? adj > ag : adj < ag;
  });

  const homeTol = (getTeamTier(home) === 'weak' && !hasScorerStar(home) && hc >= 2) ? 0 : 1;
  const awayTol = (getTeamTier(away) === 'weak' && !hasScorerStar(away) && hc <= -2) ? 0 : 1;
  const inRange = (g, range, tol) => (g >= range[0] && g <= range[1] + tol);

  const styleFiltered = filtered.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return inRange(hg, homeGoals, homeTol) && inRange(ag, awayGoals, awayTol);
  });
  const candidates = styleFiltered.length > 0 ? styleFiltered :
    filtered.filter(s => inRange(Number(s.score.split(':')[0]), homeGoals, homeTol));

  const HIGH_MIN = 18;
  let low = candidates.filter(s => s.odds < 8).sort((a, b) => a.odds - b.odds);
  let mid = candidates.filter(s => s.odds > 8 && s.odds <= HIGH_MIN).sort((a, b) => a.odds - b.odds);
  let high = candidates.filter(s => s.odds > HIGH_MIN).sort((a, b) => a.odds - b.odds);
  if (mid.length === 0) { if (low.length >= 2) mid = low.splice(1, 1); else if (high.length > 0) mid = high.splice(0, 1); }
  if (high.length === 0) { if (mid.length >= 2) high = mid.splice(-1, 1); else if (low.length > 0) high = low.splice(-1, 1); }
  if (low.length === 0) { if (mid.length > 0) low = mid.splice(0, 1); else if (high.length > 0) low = high.splice(0, 1); }

  // zjq 读
  const zjqW = 1;
  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  // v4 goalUplift
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  const homeHasStar = hasScorerStar(m.home);
  const awayHasStar = hasScorerStar(m.away);
  const homeIsWeak = hTier === 'weak' && !homeHasStar;
  const awayIsWeak = aTier === 'weak' && !awayHasStar;
  let goalUplift = 0, bigBallBoost = 0;
  if (Math.abs(hc) >= 2) {
    const strongTeam = hc <= -2 ? m.home : m.away;
    const strongHasStar = hasScorerStar(strongTeam);
    goalUplift = Math.max(goalUplift, strongHasStar ? 3 : 2);
    bigBallBoost = Math.max(bigBallBoost, strongHasStar ? 2 : 1);
  }
  if (homeHasStar && awayHasStar) { goalUplift = Math.max(goalUplift, 2); bigBallBoost = Math.max(bigBallBoost, 1); }
  if ((hTier !== 'weak' && awayIsWeak) || (aTier !== 'weak' && homeIsWeak)) {
    if (Math.abs(hc) < 2) { goalUplift = Math.max(goalUplift, 2); bigBallBoost = Math.max(bigBallBoost, 1); }
  }

  // 目标点 hT/aT
  let hT, aT;
  if (dir === 'home') { hT = homeGoals[1]; aT = awayGoals[0]; }
  else { hT = homeGoals[0]; aT = awayGoals[1]; }
  if (goalUplift > 0) {
    if (dir === 'home' && hc <= 0) hT = Math.min(hT + goalUplift, homeCap);
    else if (dir === 'away' && hc >= 0) aT = Math.min(aT + goalUplift, awayCap);
    else { hT = Math.min(hT + Math.ceil(goalUplift / 2), homeCap); aT = Math.min(aT + Math.ceil(goalUplift / 2), awayCap); }
  }

  const fitCost = (s) => {
    const [h, a] = s.score.split(':').map(Number);
    const styleD = Math.abs(h - hT) + Math.abs(a - aT);
    let zjqD = 0;
    if (zjqMode != null) {
      const total = h + a;
      if (total < zjqMode - 1) zjqD = zjqW * (zjqMode - 1 - total);
      else if (total > zjqMode + 1) zjqD = zjqW * Math.max(0, (total - zjqMode - 1) - bigBallBoost);
    }
    return styleD + zjqD;
  };
  const bestFit = (bucket) => bucket.length ? bucket.slice().sort((x, y) => fitCost(x) - fitCost(y) || x.odds - y.odds)[0] : null;

  const tierOf = (o) => (o < 8 ? 'low' : o <= HIGH_MIN ? 'mid' : 'high');
  const picks = [];
  const seen = new Set();
  for (const p of [bestFit(low), bestFit(mid), bestFit(high)]) {
    if (p && !seen.has(p.score)) { seen.add(p.score); picks.push({ ...p, tier: tierOf(p.odds) }); }
  }
  if (picks.length < 3) {
    const rest = candidates.filter(s => !seen.has(s.score)).sort((x, y) => fitCost(x) - fitCost(y) || x.odds - y.odds);
    for (const s of rest) { if (picks.length >= 3) break; seen.add(s.score); picks.push({ ...s, tier: tierOf(s.odds) }); }
  }
  picks.sort((a, b) => a.odds - b.odds);
  return { picks, meta: { hT, aT, goalUplift, bigBallBoost, zjqMode } };
}

// ========== pickScores: v7 (球风信号前置) ==========
function pickScoresV7(m) {
  const { home, away } = m;
  const hc = m.handicap;
  const hTier = getTeamTier(home), aTier = getTeamTier(away);
  const homeHasStar = hasScorerStar(home), awayHasStar = hasScorerStar(away);

  // ===== Step 1: 球风信号前置判断是否大球场景 =====
  // 大球场景(满足任一):
  //   A. top强队 vs 弱队/防守队 + 有进球型球星
  //   B. 双方都有进球型球星
  //   C. |h| >= 2 + 让球方/受让方是中强/top + 有星
  //   D. 中强队 vs 弱防守队(瑞典vs突尼斯)
  //   E. zjq 本身已经说 ≥4 球(强信号)
  const zjqMode = (() => {
    if (!m.zjq) return null;
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    return ents.length ? ents.sort((a, b) => a.odds - b.odds)[0].t : null;
  })();

  const condA = (hTier === 'top' && (aTier === 'weak' || aTier === 'defensive') && homeHasStar)
             || (aTier === 'top' && (hTier === 'weak' || hTier === 'defensive') && awayHasStar);
  const condB = homeHasStar && awayHasStar;
  const condC = Math.abs(hc) >= 2 && (homeHasStar || awayHasStar || hTier === 'top' || aTier === 'top');
  const condD = ((hTier === 'second' && (aTier === 'weak' || aTier === 'defensive'))
             || (aTier === 'second' && (hTier === 'weak' || hTier === 'defensive')));
  const condE = zjqMode != null && zjqMode >= 4;
  const bigBall = condA || condB || condC || condD || condE;

  // ===== Step 2: 进球区间 =====
  let homeGoals, awayGoals;
  if (bigBall) {
    // 大球场景: 强队侧上限放宽到 6-7，弱队侧也允许进 1-2 球
    if (hTier === 'top' || (hTier === 'second' && homeHasStar)) homeGoals = [2, 6];
    else if (hTier === 'second') homeGoals = [1, 5];
    else if (hTier === 'weak' || hTier === 'defensive') homeGoals = [0, 3];
    else homeGoals = [1, 4];

    if (aTier === 'top' || (aTier === 'second' && awayHasStar)) awayGoals = [2, 6];
    else if (aTier === 'second') awayGoals = [1, 5];
    else if (aTier === 'weak' || aTier === 'defensive') awayGoals = [0, 3];
    else awayGoals = [1, 4];
  } else {
    // 非大球场景: 用原始球风区间，但适度放宽(容差+2 而不是+1)
    if (hTier === 'top') homeGoals = [2, 3];
    else if (hTier === 'second') homeGoals = [1, 2];
    else homeGoals = [0, 2];
    if (aTier === 'top') awayGoals = [2, 3];
    else if (aTier === 'second') awayGoals = [1, 2];
    else awayGoals = [0, 2];
  }

  // |h|≥2 时大热门侧进球上限再放宽
  if (hc <= -2) homeGoals = [Math.max(homeGoals[0], 3), Math.max(homeGoals[1], 7)];
  if (hc >= 2) awayGoals = [Math.max(awayGoals[0], 3), Math.max(awayGoals[1], 7)];

  // 有进球型球星: 下限至少 1
  if (homeHasStar && homeGoals[0] < 1) homeGoals = [1, homeGoals[1]];
  if (awayHasStar && awayGoals[0] < 1) awayGoals = [1, awayGoals[1]];

  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, prob: fairProbFromOdds(v) }));

  let realScores = allScores;
  if (hc >= 2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg <= ag; });
  else if (hc <= -2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg >= ag; });

  const dir = hc <= 0 ? 'home' : 'away';
  const filtered = realScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    const adj = hg + hc;
    return dir === 'home' ? adj > ag : adj < ag;
  });

  // ===== Step 2 改进: 大球场景对球风区间放宽(容差更大) =====
  // 大球: 容差 +3, 允许比分超出区间
  // 非大球: 容差 +2
  const tol = bigBall ? 3 : 2;
  const inRange = (g, range, _tol) => (g >= Math.max(0, range[0] - 1) && g <= range[1] + _tol);

  const styleFiltered = filtered.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return inRange(hg, homeGoals, tol) && inRange(ag, awayGoals, tol);
  });
  const candidates = styleFiltered.length > 0 ? styleFiltered : filtered;

  const HIGH_MIN = 18;
  let low = candidates.filter(s => s.odds < 8).sort((a, b) => a.odds - b.odds);
  let mid = candidates.filter(s => s.odds > 8 && s.odds <= HIGH_MIN).sort((a, b) => a.odds - b.odds);
  let high = candidates.filter(s => s.odds > HIGH_MIN).sort((a, b) => a.odds - b.odds);
  if (mid.length === 0) { if (low.length >= 2) mid = low.splice(1, 1); else if (high.length > 0) mid = high.splice(0, 1); }
  if (high.length === 0) { if (mid.length >= 2) high = mid.splice(-1, 1); else if (low.length > 0) high = low.splice(-1, 1); }
  if (low.length === 0) { if (mid.length > 0) low = mid.splice(0, 1); else if (high.length > 0) low = high.splice(0, 1); }

  // ===== Step 3: fitCost —— 大球场景 zjq 只罚"0-1 球"的极端保守，高球不罚 =====
  let hT, aT;
  if (dir === 'home') { hT = homeGoals[1]; aT = awayGoals[0]; }
  else { hT = homeGoals[0]; aT = awayGoals[1]; }

  const zjqW = bigBall ? 0.5 : 1.5;  // 大球场景降低 zjq 权重, 非大球提高
  const fitCost = (s) => {
    const [h, a] = s.score.split(':').map(Number);
    const styleD = Math.abs(h - hT) + Math.abs(a - aT);
    let zjqD = 0;
    if (zjqMode != null) {
      const total = h + a;
      if (bigBall) {
        // 大球场景: 只罚 ≤1 球的极端保守, 其他比分全免
        if (total <= 1) zjqD = zjqW * 2;
        // 2-3 球: 轻微罚(因为 zjq 说这个但我们认为会更高)
        else if (total >= 2 && total < zjqMode) zjqD = zjqW * 0.5;
        // ≥4 球: 不罚 —— 完全按球风来
      } else {
        // 非大球场景: zjq 正常按 ±1 罚
        if (total < zjqMode - 1) zjqD = zjqW * (zjqMode - 1 - total);
        else if (total > zjqMode + 2) zjqD = zjqW * (total - zjqMode - 2);  // 这里放宽到 +2 才罚
      }
    }
    return styleD + zjqD;
  };
  const bestFit = (bucket) => bucket.length ? bucket.slice().sort((x, y) => fitCost(x) - fitCost(y) || x.odds - y.odds)[0] : null;

  const tierOf = (o) => (o < 8 ? 'low' : o <= HIGH_MIN ? 'mid' : 'high');
  const picks = [];
  const seen = new Set();
  for (const p of [bestFit(low), bestFit(mid), bestFit(high)]) {
    if (p && !seen.has(p.score)) { seen.add(p.score); picks.push({ ...p, tier: tierOf(p.odds) }); }
  }
  if (picks.length < 3) {
    const rest = candidates.filter(s => !seen.has(s.score)).sort((x, y) => fitCost(x) - fitCost(y) || x.odds - y.odds);
    for (const s of rest) { if (picks.length >= 3) break; seen.add(s.score); picks.push({ ...s, tier: tierOf(s.odds) }); }
  }
  picks.sort((a, b) => a.odds - b.odds);

  const signalParts = [];
  if (condA) signalParts.push('top+weak+star');
  if (condB) signalParts.push('双star');
  if (condC) signalParts.push('|h|≥2');
  if (condD) signalParts.push('second+weak/def');
  if (condE) signalParts.push('zjq≥4');
  return { picks, meta: { hT, aT, bigBall, signal: signalParts.join(',') || '-', zjqMode, homeGoals, awayGoals } };
}

// ========== 跑 v4 vs v7 ==========
const resultsV4 = [];
const resultsV7 = [];
for (const m of matches_) {
  const r4 = pickScoresV4(m);
  const r7 = pickScoresV7(m);
  const actualScore = `${m.actualHome}:${m.actualAway}`;
  const hitV4 = r4.picks.some(p => p.score === actualScore);
  const hitV7 = r7.picks.some(p => p.score === actualScore);
  resultsV4.push({ ...m, picks: r4.picks, meta: r4.meta, hit: hitV4 });
  resultsV7.push({ ...m, picks: r7.picks, meta: r7.meta, hit: hitV7 });
}

const total = matches_.length;
const hitsV4 = resultsV4.filter(r => r.hit).length;
const hitsV7 = resultsV7.filter(r => r.hit).length;

console.log(`\n## 对比汇总\n`);
console.log(`| 版本 | 策略 | 命中 | 命中率 |`);
console.log(`|------|------|------|--------|`);
console.log(`| v4 | baseline(goalUplift+bigBallBoost, zjq±1罚高) | ${hitsV4}/${total} | ${(hitsV4/total*100).toFixed(0)}% |`);
console.log(`| v7 | 球风前置判断bigBall | ${hitsV7}/${total} | ${(hitsV7/total*100).toFixed(0)}% |`);

// 详细迁移: 找 v4错→v7对, v4对→v7错
console.log(`\n## 迁移分析\n`);
const gained = [];  // v4 错 → v7 对
const lost = [];    // v4 对 → v7 错
const sameH = [];   // 都对
const sameM = [];   // 都错
for (let i = 0; i < total; i++) {
  const r4 = resultsV4[i], r7 = resultsV7[i];
  if (r4.hit && r7.hit) sameH.push({ r4, r7 });
  else if (!r4.hit && !r7.hit) sameM.push({ r4, r7 });
  else if (!r4.hit && r7.hit) gained.push({ r4, r7 });
  else lost.push({ r4, r7 });
}
console.log(`\n都对 ${sameH.length} 场 | v4错→v7对 ${gained.length} 场 | v4对→v7错 ${lost.length} 场 | 都错 ${sameM.length} 场`);

console.log(`\n## 逐场详情\n`);
console.log(`| 场次 | 对阵 | h | tier | star | 实际 | zjq | v4 top3 | v4✅ | v7信号 | v7 top3 | v7✅ | 迁移 |`);
for (let i = 0; i < total; i++) {
  const m = matches_[i];
  const r4 = resultsV4[i], r7 = resultsV7[i];
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  const starStr = (hasScorerStar(m.home) ? '★' : '') + '/' + (hasScorerStar(m.away) ? '★' : '');
  const v4Str = r4.picks.map(p => `${p.score}@${p.odds}`).join(' ');
  const v7Str = r7.picks.map(p => `${p.score}@${p.odds}`).join(' ');
  const signal = r7.meta.bigBall ? `⚡${r7.meta.signal}` : r7.meta.signal;
  const migration = r4.hit && r7.hit ? '保持' : (!r4.hit && !r7.hit ? '都错' : (r7.hit ? '✓新命中' : '✗回归'));
  const tierStr = `${hTier}/${aTier}`;
  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${m.handicap} | ${tierStr} | ${starStr} | ${m.actualHome}:${m.actualAway}(${m.actualHome+m.actualAway}球) | ${r7.meta.zjqMode ?? '-'} | ${v4Str} | ${r4.hit ? '✅' : '❌'} | ${signal} | ${v7Str} | ${r7.hit ? '✅' : '❌'} | ${migration} |`);
}

// 单独分析 v7 新命中的场
if (gained.length) {
  console.log(`\n## v7 新命中场(之前 v4 没猜中)\n`);
  for (const g of gained) {
    const m = g.r4;
    console.log(`  ${m.code} ${m.home}vs${m.away} h=${m.handicap} 实际 ${m.actualHome}:${m.actualAway}`);
    console.log(`    v4 top3: ${g.r4.picks.map(p => `${p.score}@${p.odds}`).join(' ')}  hT=${g.r4.meta.hT} aT=${g.r4.meta.aT} uplift=${g.r4.meta.goalUplift} boost=${g.r4.meta.bigBallBoost}`);
    console.log(`    v7 top3: ${g.r7.picks.map(p => `${p.score}@${p.odds}`).join(' ')}  bigBall=${g.r7.meta.bigBall} signal=${g.r7.meta.signal} hT=${g.r7.meta.hT} aT=${g.r7.meta.aT} homeGoals=[${g.r7.meta.homeGoals}] awayGoals=[${g.r7.meta.awayGoals}]`);
  }
}
if (lost.length) {
  console.log(`\n## v7 回归场(v4 对的, v7 丢了) —— 重点分析\n`);
  for (const l of lost) {
    const m = l.r4;
    console.log(`  ${m.code} ${m.home}vs${m.away} h=${m.handicap} 实际 ${m.actualHome}:${m.actualAway}`);
    console.log(`    v4 top3: ${l.r4.picks.map(p => `${p.score}@${p.odds}`).join(' ')}  hT=${l.r4.meta.hT} aT=${l.r4.meta.aT} uplift=${l.r4.meta.goalUplift}`);
    console.log(`    v7 top3: ${l.r7.picks.map(p => `${p.score}@${p.odds}`).join(' ')}  bigBall=${l.r7.meta.bigBall} signal=${l.r7.meta.signal} hT=${l.r7.meta.hT} aT=${l.r7.meta.aT} homeGoals=[${l.r7.meta.homeGoals}]`);
  }
}

// 分析 bigBall 场和非 bigBall 场的命中率
console.log(`\n## 大小球命中率分布(v7)\n`);
const bb = resultsV7.filter(r => r.meta.bigBall);
const nonBb = resultsV7.filter(r => !r.meta.bigBall);
console.log(`  大球场景 ${bb.length} 场: 命中 ${bb.filter(r=>r.hit).length}/${bb.length}`);
console.log(`  非大球场景 ${nonBb.length} 场: 命中 ${nonBb.filter(r=>r.hit).length}/${nonBb.length}`);

// 按实际进球数分析命中率
console.log(`\n## 按实际总进球数分布的命中率(v7)\n`);
const byTotal = {};
for (const r of resultsV7) {
  const t = r.actualHome + r.actualHome;  // 这里错了, 下面重新算
}
// 重新按实际总进球分组
const totalGroups = { '≤2': [], '3-4': [], '5+': [] };
for (const r of resultsV7) {
  const tg = r.actualHome + r.actualAway;
  if (tg <= 2) totalGroups['≤2'].push(r);
  else if (tg <= 4) totalGroups['3-4'].push(r);
  else totalGroups['5+'].push(r);
}
for (const [k, arr] of Object.entries(totalGroups)) {
  const hit = arr.filter(r => r.hit).length;
  console.log(`  ${k}球: ${hit}/${arr.length} = ${arr.length ? (hit/arr.length*100).toFixed(0) : 'N/A'}%`);
  console.log(`    实际比分: ${arr.map(r => `${r.home}vs${r.away} ${r.actualHome}:${r.actualAway}`).join(' | ')}`);
}
