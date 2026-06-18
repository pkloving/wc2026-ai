// 19_v5_ab_test.js — v3 vs v4 vs v5 三版对比
// v5 新规则:
//   ① 提前综合大小球判定（big/small flag）
//   ② 大球场景 → 比分三档中"去掉低档(odds<8)"
//   ③ 弱弱对阵 → 从候选池移除大比分(总进球≥5或某队≥3)
//   ④ 规则D: second tier进攻队 vs 纯防守弱队（h <= -1,无星但有进攻整体）
//   ⑤ 规则E: ATTACK_TEAMS 名单（进攻型但无top星）
//
// v3 = 基线（zjq小球有效+h>=2关zjq）
// v4 = 球风组合 goalUplift + bigBallBoost
// v5 = v4 + 提前大小球判定 + 大球/弱弱的候选池过滤 + 规则D/E

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');

const VIG = 0.08;
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

// 进球型球星名单(v4已有)
const SCORER_STAR_TEAMS = new Set([
  '法国', '阿根廷', '挪威', '乌拉圭', '葡萄牙', '英格兰', '西班牙', '巴西',
  '荷兰', '德国', '韩国', '日本', '美国', '墨西哥', '埃及', '波兰', '丹麦', '塞尔维亚',
]);
// v5 新增: 进攻型整体队伍(无top球星但进攻体系强)
const ATTACK_TEAMS = new Set(['瑞典', '奥地利', '塞尔维亚', '荷兰', '加纳', '土耳其']);

const STARS = {
  '法国': '姆巴佩', '阿根廷': '梅西', '挪威': '哈兰德', '乌拉圭': '苏亚雷斯/努涅斯',
  '葡萄牙': 'C罗', '英格兰': '凯恩', '西班牙': '亚马尔/罗德里', '巴西': '内马尔/维尼修斯',
  '荷兰': '德佩', '德国': '凯恩', '韩国': '孙兴慜', '日本': '三笘熏/久保建英',
  '美国': '普利希奇', '墨西哥': '希门尼斯', '埃及': '萨拉赫', '波兰': '莱万',
  '丹麦': '埃里克森', '塞尔维亚': '弗拉霍维奇',
};
function getStar(t) { return STARS[t] || '无'; }
function hasScorerStar(t) { return SCORER_STAR_TEAMS.has(t) && getStar(t) !== '无'; }
function hasAttackQuality(t) { return hasScorerStar(t) || ATTACK_TEAMS.has(t); }
function getTeamTier(team) {
  if (TOP_TIER.includes(team)) return 'top';
  if (SECOND_TIER.includes(team)) return 'second';
  if (DEFENSIVE.includes(team)) return 'defensive';
  if (WEAK_TEAMS.includes(team)) return 'weak';
  return 'unknown';
}
function normalizeScore(s) { if (typeof s !== 'string') return s; return s.split(':').map(p => String(Number(p))).join(':'); }
function fairProbFromOdds(odds, vig = VIG) { return 1 / (odds * (1 + vig)); }
function tierLabel(t) { return { top: '强', second: '中强', defensive: '防', weak: '弱', unknown: '?' }[t] || t; }

// ---------- 构造 match 对象 ----------
function buildMatch(oddsDoc, actual) {
  return {
    code: oddsDoc.basic.code,
    home: oddsDoc.basic.home,
    away: oddsDoc.basic.away,
    handicap: oddsDoc.odds.handicap,
    spf: oddsDoc.odds.spf_latest,
    rqspf: oddsDoc.odds.rqspf_latest,
    bf: oddsDoc.odds.bf_latest,
    zjq: oddsDoc.odds.zjq_latest,
    bqc: oddsDoc.odds.bqc_latest,
    actual: `${actual.homeScore}:${actual.awayScore}`,
    actualTotal: actual.homeScore + actual.awayScore,
  };
}

// ---------- 三档阈值(与12_r013_user_rules.js一致) ----------
const LOW_MAX = 8;
const HIGH_MIN = 18;
function tierOf(odds) { return odds < LOW_MAX ? 'low' : odds <= HIGH_MIN ? 'mid' : 'high'; }

// ---------- rqspf 方向选择 ----------
function getDirs(m) {
  const r = m.rqspf;
  const arr = [
    { key: 'home', odds: r.home },
    { key: 'draw', odds: r.draw },
    { key: 'away', odds: r.away },
  ].filter(x => x.odds > 1);
  arr.sort((a, b) => a.odds - b.odds);
  return arr.slice(0, 2).map(x => x.key);
}

// ========================================================
// v3: 基线版本（zjq小球有效+h>=2关zjq）
// ========================================================
function pickScores_v3(m, dirs) {
  const { home, away } = m;
  const hc = m.handicap ?? 0;
  const favIsHome = hc <= -2;
  const favIsAway = hc >= 2;
  const GOAL_CAP = 4;
  const homeCap = favIsHome ? 6 : GOAL_CAP;
  const awayCap = favIsAway ? 6 : GOAL_CAP;

  // 球风→进球区间
  let homeGoals, awayGoals;
  const hT0 = getTeamTier(home), aT0 = getTeamTier(away);
  if (hT0 === 'top') homeGoals = [2, 3]; else if (hT0 === 'second') homeGoals = [1, 2]; else if (hT0 === 'defensive') homeGoals = [0, 1]; else homeGoals = [0, 1];
  if (aT0 === 'top') awayGoals = [2, 3]; else if (aT0 === 'second') awayGoals = [1, 2]; else if (aT0 === 'defensive') awayGoals = [0, 1]; else awayGoals = [0, 1];

  if (hc <= -2) { const tgt = awayGoals[0] + Math.abs(hc); homeGoals = [Math.max(homeGoals[0], tgt), tgt + 1]; }
  else if (hc >= 2) { const tgt = homeGoals[0] + Math.abs(hc); awayGoals = [Math.max(awayGoals[0], tgt), tgt + 1]; }
  if (hasScorerStar(home) && homeGoals[0] < 1) homeGoals = [1, Math.max(homeGoals[1], 1)];
  if (hasScorerStar(away) && awayGoals[0] < 1) awayGoals = [1, Math.max(awayGoals[1], 1)];
  const clampFav = (r, cap) => [Math.min(r[0], cap), Math.min(Math.max(r[1], r[0]), cap)];
  homeGoals = clampFav(homeGoals, homeCap);
  awayGoals = clampFav(awayGoals, awayCap);

  // 读比分
  const allScores = Object.entries(m.bf).filter(([, v]) => v > 1 && !/其它$/.test(arguments[0])).map(([k, v]) => ({ score: normalizeScore(k), odds: v }));
  // 真实过滤(大盘)
  let realScores = allScores;
  if (hc >= 2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg <= ag; });
  else if (hc <= -2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg >= ag; });

  // 方向过滤
  const matchDir = (dir, adj, ag) => dir === 'home' ? adj > ag : dir === 'draw' ? adj === ag : dir === 'away' ? adj < ag : false;
  const filtered = realScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    const adj = hg + hc;
    return dirs.some(d => matchDir(d, adj, ag));
  });

  // 球风过滤
  const homeTol = (getTeamTier(home) === 'weak' && !hasScorerStar(home) && hc >= 2) ? 0 : 1;
  const awayTol = (getTeamTier(away) === 'weak' && !hasScorerStar(away) && hc <= -2) ? 0 : 1;
  const inRange = (g, range, tol) => g >= range[0] && g <= range[1] + tol;
  const styleFiltered = filtered.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return inRange(hg, homeGoals, homeTol) && inRange(ag, awayGoals, awayTol);
  });
  const candidates = styleFiltered.length > 0 ? styleFiltered : filtered;

  // 目标进球
  const primary = dirs[0];
  let hT, aT;
  if (primary === 'home') { hT = homeGoals[1]; aT = awayGoals[0]; }
  else if (primary === 'away') { hT = homeGoals[0]; aT = awayGoals[1]; }
  else { hT = (homeGoals[0] + homeGoals[1]) / 2; aT = (awayGoals[0] + awayGoals[1]) / 2; }

  // zjq: v3 — h>=2关掉;否则小球生效
  let zjqMode = null;
  if (m.zjq && !(Math.abs(hc) >= 2)) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }
  if (zjqMode != null && zjqMode > 3) zjqMode = null;

  // bqc
  let bqcHomeBonus = 0, bqcAwayBonus = 0, bqcUpsetBonus = 0;
  if (m.bqc) {
    const ss = m.bqc['胜胜'], ff = m.bqc['负负'];
    if (ss && ss < 2.0) bqcHomeBonus = 1; else if (ff && ff < 2.0) bqcAwayBonus = 1;
    if ((ss && ss < 1.5) || (ff && ff < 1.5)) bqcUpsetBonus = 1;
  }
  if (bqcHomeBonus > 0 && primary !== 'away') { hT = Math.min(hc <= -2 ? homeGoals[1] + 1 : homeGoals[1], homeCap); aT = Math.max(0, aT - 0.5); }
  else if (bqcAwayBonus > 0 && primary !== 'home') { aT = Math.min(hc >= 2 ? awayGoals[1] + 1 : awayGoals[1], awayCap); hT = Math.max(0, hT - 0.5); }
  if (bqcUpsetBonus > 0) { hT = Math.max(1, Math.min(hT - 1, 2)); aT = Math.max(0, Math.min(aT, 2)); }

  const fitCost = (s) => {
    const [hg, ag] = s.score.split(':').map(Number);
    const sd = Math.abs(hg - hT) + Math.abs(ag - aT);
    const zd = zjqMode != null ? Math.abs(hg + ag - zjqMode) : 0;
    let bd = ((bqcHomeBonus > 0 && hg < 2) ? 2 : 0) + ((bqcAwayBonus > 0 && ag < 2) ? 2 : 0);
    if (bqcUpsetBonus > 0 && hg === ag && hg <= 2) bd = -1;
    return sd + zd + bd;
  };
  const sorted = candidates.slice().sort((a, b) => fitCost(a) - fitCost(b) || a.odds - b.odds);
  return sorted.slice(0, 3);
}

// ========================================================
// v4: 球风组合 + goalUplift + bigBallBoost
// ========================================================
function pickScores_v4(m, dirs) {
  const { home, away } = m;
  const hc = m.handicap ?? 0;
  const favIsHome = hc <= -2;
  const favIsAway = hc >= 2;
  const GOAL_CAP = 4;
  const homeCap = favIsHome ? 7 : GOAL_CAP;
  const awayCap = favIsAway ? 7 : GOAL_CAP;

  let homeGoals, awayGoals;
  const hT0 = getTeamTier(home), aT0 = getTeamTier(away);
  if (hT0 === 'top') homeGoals = [2, 3]; else if (hT0 === 'second') homeGoals = [1, 2]; else if (hT0 === 'defensive') homeGoals = [0, 1]; else homeGoals = [0, 1];
  if (aT0 === 'top') awayGoals = [2, 3]; else if (aT0 === 'second') awayGoals = [1, 2]; else if (aT0 === 'defensive') awayGoals = [0, 1]; else awayGoals = [0, 1];

  if (hc <= -2) { const tgt = awayGoals[0] + Math.abs(hc); homeGoals = [Math.max(homeGoals[0], tgt), tgt + 2]; }
  else if (hc >= 2) { const tgt = homeGoals[0] + Math.abs(hc); awayGoals = [Math.max(awayGoals[0], tgt), tgt + 2]; }
  if (hasScorerStar(home) && homeGoals[0] < 1) homeGoals = [1, Math.max(homeGoals[1], 1)];
  if (hasScorerStar(away) && awayGoals[0] < 1) awayGoals = [1, Math.max(awayGoals[1], 1)];
  const clampFav = (r, cap) => [Math.min(r[0], cap), Math.min(Math.max(r[1], r[0]), cap)];
  homeGoals = clampFav(homeGoals, homeCap);
  awayGoals = clampFav(awayGoals, awayCap);

  const allScores = Object.entries(m.bf).filter(([k]) => !/其它$/.test(k)).map(([k, v]) => ({ score: normalizeScore(k), odds: v }));
  let realScores = allScores;
  if (hc >= 2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg <= ag; });
  else if (hc <= -2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg >= ag; });

  const matchDir = (dir, adj, ag) => dir === 'home' ? adj > ag : dir === 'draw' ? adj === ag : dir === 'away' ? adj < ag : false;
  const filtered = realScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    const adj = hg + hc;
    return dirs.some(d => matchDir(d, adj, ag));
  });

  const homeTol = (getTeamTier(home) === 'weak' && !hasScorerStar(home) && hc >= 2) ? 0 : 1;
  const awayTol = (getTeamTier(away) === 'weak' && !hasScorerStar(away) && hc <= -2) ? 0 : 1;
  const inRange = (g, range, tol) => g >= range[0] && g <= range[1] + tol;
  const styleFiltered = filtered.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return inRange(hg, homeGoals, homeTol) && inRange(ag, awayGoals, awayTol);
  });
  const candidates = styleFiltered.length > 0 ? styleFiltered : filtered;

  const primary = dirs[0];
  let hT, aT;
  if (primary === 'home') { hT = homeGoals[1]; aT = awayGoals[0]; }
  else if (primary === 'away') { hT = homeGoals[0]; aT = awayGoals[1]; }
  else { hT = (homeGoals[0] + homeGoals[1]) / 2; aT = (awayGoals[0] + awayGoals[1]) / 2; }

  // zjq: v4 — 始终读
  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }
  if (zjqMode != null && zjqMode > 3) zjqMode = null;

  // 规则A/B/C触发
  let goalUplift = 0, bigBallBoost = 0;
  if (Math.abs(hc) >= 2) {
    const strongHasStar = hc <= -2 ? hasScorerStar(home) : hasScorerStar(away);
    goalUplift = Math.max(goalUplift, strongHasStar ? 3 : 2);
    bigBallBoost = Math.max(bigBallBoost, strongHasStar ? 2 : 1);
  }
  if (hasScorerStar(home) && hasScorerStar(away)) { goalUplift = Math.max(goalUplift, 2); bigBallBoost = Math.max(bigBallBoost, 1); }
  const homeWeakNoStar = hT0 === 'weak' && !hasScorerStar(home);
  const awayWeakNoStar = aT0 === 'weak' && !hasScorerStar(away);
  if ((hT0 !== 'weak' && awayWeakNoStar) || (aT0 !== 'weak' && homeWeakNoStar)) {
    if (Math.abs(hc) < 2) { goalUplift = Math.max(goalUplift, 2); bigBallBoost = Math.max(bigBallBoost, 1); }
  }

  // bqc
  let bqcHomeBonus = 0, bqcAwayBonus = 0, bqcUpsetBonus = 0;
  if (m.bqc) {
    const ss = m.bqc['胜胜'], ff = m.bqc['负负'];
    if (ss && ss < 2.0) bqcHomeBonus = 1; else if (ff && ff < 2.0) bqcAwayBonus = 1;
    if ((ss && ss < 1.5) || (ff && ff < 1.5)) bqcUpsetBonus = 1;
  }
  if (bqcHomeBonus > 0 && primary !== 'away') { hT = Math.min(hc <= -2 ? homeGoals[1] + 1 : homeGoals[1], homeCap); aT = Math.max(0, aT - 0.5); }
  else if (bqcAwayBonus > 0 && primary !== 'home') { aT = Math.min(hc >= 2 ? awayGoals[1] + 1 : awayGoals[1], awayCap); hT = Math.max(0, hT - 0.5); }
  if (bqcUpsetBonus > 0) { hT = Math.max(1, Math.min(hT - 1, 2)); aT = Math.max(0, Math.min(aT, 2)); }

  // v4 goalUplift
  if (goalUplift > 0 && primary !== 'draw') {
    if (primary === 'home' && hc <= 0) hT = Math.min(hT + goalUplift, homeCap);
    else if (primary === 'away' && hc >= 0) aT = Math.min(aT + goalUplift, awayCap);
    else { hT = Math.min(hT + Math.ceil(goalUplift / 2), homeCap); aT = Math.min(aT + Math.ceil(goalUplift / 2), awayCap); }
  }

  const fitCost = (s) => {
    const [hg, ag] = s.score.split(':').map(Number);
    const sd = Math.abs(hg - hT) + Math.abs(ag - aT);
    let zd = 0;
    if (zjqMode != null) {
      const total = hg + ag;
      if (total < zjqMode - 1) zd = zjqMode - 1 - total;
      else if (total > zjqMode + 1) zd = Math.max(0, (total - zjqMode - 1) - bigBallBoost);
    }
    let bd = ((bqcHomeBonus > 0 && hg < 2) ? 2 : 0) + ((bqcAwayBonus > 0 && ag < 2) ? 2 : 0);
    if (bqcUpsetBonus > 0 && hg === ag && hg <= 2) bd = -1;
    return sd + zd + bd;
  };
  const sorted = candidates.slice().sort((a, b) => fitCost(a) - fitCost(b) || a.odds - b.odds);
  return sorted.slice(0, 3);
}

// ========================================================
// v5: v4 + 提前大小球判定 + 大球去低档 + 弱弱去大球 + 规则D/E
// ========================================================
function pickScores_v5(m, dirs) {
  const { home, away } = m;
  const hc = m.handicap ?? 0;
  const favIsHome = hc <= -2;
  const favIsAway = hc >= 2;
  const GOAL_CAP = 4;
  const homeCap = favIsHome ? 7 : GOAL_CAP;
  const awayCap = favIsAway ? 7 : GOAL_CAP;

  const hT0 = getTeamTier(home), aT0 = getTeamTier(away);

  // ================ v5 ①: 提前综合大小球判定 ================
  // 输入信号(所有):
  //   1. zjq 最低档位 + 赔率分布
  //   2. 两队 tier 组合
  //   3. 让球盘 h 的绝对值
  //   4. 双方是否有进球型球星/进攻质量
  //   5. 是否"弱弱对阵"
  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  // 进攻信号: 双方都"有进攻质量"
  const homeAttack = hasAttackQuality(home);
  const awayAttack = hasAttackQuality(away);
  const bothAttack = homeAttack && awayAttack;
  const oneAttackOtherWeak =
    (homeAttack && (aT0 === 'weak' || aT0 === 'defensive')) ||
    (awayAttack && (hT0 === 'weak' || hT0 === 'defensive'));
  const weakVsWeak = (hT0 === 'weak' || hT0 === 'defensive' || hT0 === 'unknown') && (aT0 === 'weak' || aT0 === 'defensive' || aT0 === 'unknown');
  const topVsWeak = (hT0 === 'top' && (aT0 === 'weak' || aT0 === 'defensive')) || (aT0 === 'top' && (hT0 === 'weak' || hT0 === 'defensive'));

  // 综合判定: bigBallFlag (预计总进球 ≥ 4)
  let bigBallFlag = false;
  const triggerReasons = [];
  if (Math.abs(hc) >= 2) { bigBallFlag = true; triggerReasons.push(`h=${Math.abs(hc)}:强弱悬殊`); }
  if (bothAttack) { bigBallFlag = true; triggerReasons.push('双方都有进攻质量'); }
  if (topVsWeak) { bigBallFlag = true; triggerReasons.push('top强队vs弱队'); }
  if (oneAttackOtherWeak) { triggerReasons.push('单方进攻+弱防守'); }  // 注意:不强制升big,但作为信号
  // zjq 确认: 如果 zjq=0 或 zjq=1(庄家明确说小球)，即便有进攻信号，谨慎处理
  if (zjqMode != null && zjqMode <= 1 && triggerReasons.length === 0) bigBallFlag = false;

  // 计算 goalUplift（对 hT/aT 的上调）和 bigBallBoost（对 zjq 大球惩罚的减免）
  let goalUplift = 0, bigBallBoost = 0;
  if (bigBallFlag) {
    if (Math.abs(hc) >= 2 && (hasScorerStar(hc <= -2 ? home : away))) { goalUplift = 3; bigBallBoost = 2; }
    else if (Math.abs(hc) >= 2) { goalUplift = 2; bigBallBoost = 1; }
    else if (bothAttack) { goalUplift = 2; bigBallBoost = 1; }
    else if (topVsWeak) { goalUplift = 2; bigBallBoost = 1; }
  }
  // 规则 D: second tier 进攻队 vs 防守/弱队(h <= -1, 无星)
  if (!bigBallFlag) {
    if ((hT0 === 'second' && homeAttack && (aT0 === 'weak' || aT0 === 'defensive') && hc <= -1) ||
        (aT0 === 'second' && awayAttack && (hT0 === 'weak' || hT0 === 'defensive') && hc >= -1 && hc !== 0)) {
      bigBallFlag = true;
      goalUplift = 2;
      bigBallBoost = 1;
      triggerReasons.push('规则D: second进攻队vs弱防守');
    }
  }

  // ================ 球风→进球区间 ================
  let homeGoals, awayGoals;
  if (hT0 === 'top') homeGoals = [2, 3]; else if (hT0 === 'second') homeGoals = [1, 2]; else if (hT0 === 'defensive') homeGoals = [0, 1]; else homeGoals = [0, 1];
  if (aT0 === 'top') awayGoals = [2, 3]; else if (aT0 === 'second') awayGoals = [1, 2]; else if (aT0 === 'defensive') awayGoals = [0, 1]; else awayGoals = [0, 1];

  if (hc <= -2) { const tgt = awayGoals[0] + Math.abs(hc); homeGoals = [Math.max(homeGoals[0], tgt), tgt + 2]; }
  else if (hc >= 2) { const tgt = homeGoals[0] + Math.abs(hc); awayGoals = [Math.max(awayGoals[0], tgt), tgt + 2]; }
  if (hasScorerStar(home) && homeGoals[0] < 1) homeGoals = [1, Math.max(homeGoals[1], 1)];
  if (hasScorerStar(away) && awayGoals[0] < 1) awayGoals = [1, Math.max(awayGoals[1], 1)];
  const clampFav = (r, cap) => [Math.min(r[0], cap), Math.min(Math.max(r[1], r[0]), cap)];
  homeGoals = clampFav(homeGoals, homeCap);
  awayGoals = clampFav(awayGoals, awayCap);

  // ================ 读比分 ================
  const allScores = Object.entries(m.bf).filter(([k]) => !/其它$/.test(k)).map(([k, v]) => ({ score: normalizeScore(k), odds: v }));
  let realScores = allScores;
  if (hc >= 2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg <= ag; });
  else if (hc <= -2) realScores = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg >= ag; });

  const matchDir = (dir, adj, ag) => dir === 'home' ? adj > ag : dir === 'draw' ? adj === ag : dir === 'away' ? adj < ag : false;
  const filtered = realScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    const adj = hg + hc;
    return dirs.some(d => matchDir(d, adj, ag));
  });

  // 球风过滤
  const homeTol = (getTeamTier(home) === 'weak' && !hasScorerStar(home) && hc >= 2) ? 0 : 1;
  const awayTol = (getTeamTier(away) === 'weak' && !hasScorerStar(away) && hc <= -2) ? 0 : 1;
  const inRange = (g, range, tol) => g >= range[0] && g <= range[1] + tol;
  const styleFiltered = filtered.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return inRange(hg, homeGoals, homeTol) && inRange(ag, awayGoals, awayTol);
  });
  const candidates = styleFiltered.length > 0 ? styleFiltered : filtered;

  // ================ v5 ②③: 候选池再过滤 ================
  let finalCandidates = candidates;
  // ② 大球 → 去掉低档（odds<8 的比分,都是小比分保守选项,大球场合不准）
  if (bigBallFlag) {
    const midPlus = candidates.filter(s => s.odds >= LOW_MAX);
    if (midPlus.length >= 2) {
      finalCandidates = midPlus;
      triggerReasons.push('大球→去掉低档');
    }
  }
  // ③ 弱弱 → 去掉大球比分(总进球>=5或某队>=3)
  if (weakVsWeak && !bigBallFlag) {
    const smaller = candidates.filter(s => {
      const [hg, ag] = s.score.split(':').map(Number);
      return (hg + ag <= 4) && hg <= 2 && ag <= 2;
    });
    if (smaller.length >= 2) {
      finalCandidates = smaller;
      triggerReasons.push('弱弱→去掉大球');
    }
  }

  // ================ 目标进球 ================
  const primary = dirs[0];
  let hT, aT;
  if (primary === 'home') { hT = homeGoals[1]; aT = awayGoals[0]; }
  else if (primary === 'away') { hT = homeGoals[0]; aT = awayGoals[1]; }
  else { hT = (homeGoals[0] + homeGoals[1]) / 2; aT = (awayGoals[0] + awayGoals[1]) / 2; }

  // bqc
  let bqcHomeBonus = 0, bqcAwayBonus = 0, bqcUpsetBonus = 0;
  if (m.bqc) {
    const ss = m.bqc['胜胜'], ff = m.bqc['负负'];
    if (ss && ss < 2.0) bqcHomeBonus = 1; else if (ff && ff < 2.0) bqcAwayBonus = 1;
    if ((ss && ss < 1.5) || (ff && ff < 1.5)) bqcUpsetBonus = 1;
  }
  if (bqcHomeBonus > 0 && primary !== 'away') { hT = Math.min(hc <= -2 ? homeGoals[1] + 1 : homeGoals[1], homeCap); aT = Math.max(0, aT - 0.5); }
  else if (bqcAwayBonus > 0 && primary !== 'home') { aT = Math.min(hc >= 2 ? awayGoals[1] + 1 : awayGoals[1], awayCap); hT = Math.max(0, hT - 0.5); }
  if (bqcUpsetBonus > 0) { hT = Math.max(1, Math.min(hT - 1, 2)); aT = Math.max(0, Math.min(aT, 2)); }

  // goalUplift 上调
  if (goalUplift > 0 && primary !== 'draw') {
    if (primary === 'home' && hc <= 0) hT = Math.min(hT + goalUplift, homeCap);
    else if (primary === 'away' && hc >= 0) aT = Math.min(aT + goalUplift, awayCap);
    else { hT = Math.min(hT + Math.ceil(goalUplift / 2), homeCap); aT = Math.min(aT + Math.ceil(goalUplift / 2), awayCap); }
  }

  // fitCost: 大球模式下 zjq 惩罚更宽松(bigBallBoost);小球模式下 zjq 正常生效
  const fitCost = (s) => {
    const [hg, ag] = s.score.split(':').map(Number);
    const sd = Math.abs(hg - hT) + Math.abs(ag - aT);
    let zd = 0;
    if (zjqMode != null && zjqMode <= 3) {
      const total = hg + ag;
      if (total < zjqMode - 1) zd = zjqMode - 1 - total;
      else if (total > zjqMode + 1) zd = Math.max(0, (total - zjqMode - 1) - bigBallBoost);
    } else if (bigBallFlag) {
      // 大球模式: zjq 没给清晰信号 → 只罚超保守(0-1球)
      const total = hg + ag;
      if (total <= 1) zd = 3;
    }
    let bd = ((bqcHomeBonus > 0 && hg < 2) ? 2 : 0) + ((bqcAwayBonus > 0 && ag < 2) ? 2 : 0);
    if (bqcUpsetBonus > 0 && hg === ag && hg <= 2) bd = -1;
    return sd + zd + bd;
  };
  const sorted = finalCandidates.slice().sort((a, b) => fitCost(a) - fitCost(b) || a.odds - b.odds);
  const top3 = sorted.slice(0, 3);
  return {
    picks: top3,
    meta: {
      bigBallFlag, weakVsWeak, goalUplift, bigBallBoost, zjqMode, hT, aT,
      triggers: triggerReasons,
      removedLow: bigBallFlag && candidates.some(s => s.odds < LOW_MAX),
      removedBig: weakVsWeak && candidates.some(s => {
        const [hg, ag] = s.score.split(':').map(Number);
        return hg + ag >= 5 || hg >= 3 || ag >= 3;
      }),
    },
  };
}

// ========================================================
// 主循环
// ========================================================
const matches = [];
for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
  const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
  if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
  const mid = oddsDoc.basic.mid;
  const resultPath = path.join(RESULTS_DIR, mid + '.json');
  if (!fs.existsSync(resultPath)) continue;
  const actual = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  matches.push(buildMatch(oddsDoc, actual));
}

console.log(`\n## v3 vs v4 vs v5 三版对比 — 共 ${matches.length} 场\n`);

let v3Hit = 0, v4Hit = 0, v5Hit = 0;
let v3Win_v4Lose = 0, v3Lose_v4Win = 0;
let v4Win_v5Lose = 0, v4Lose_v5Win = 0;
const rows = [];

for (const m of matches) {
  const dirs = getDirs(m);
  const v3 = pickScores_v3(m, dirs);
  const v4 = pickScores_v4(m, dirs);
  const v5Out = pickScores_v5(m, dirs);
  const v5 = v5Out.picks;
  const v3Yes = v3.some(p => p.score === m.actual);
  const v4Yes = v4.some(p => p.score === m.actual);
  const v5Yes = v5.some(p => p.score === m.actual);
  if (v3Yes) v3Hit++;
  if (v4Yes) v4Hit++;
  if (v5Yes) v5Hit++;
  if (v3Yes && !v4Yes) v3Win_v4Lose++;
  if (!v3Yes && v4Yes) v3Lose_v4Win++;
  if (v4Yes && !v5Yes) v4Win_v5Lose++;
  if (!v4Yes && v5Yes) v4Lose_v5Win++;

  const fmt = (arr) => arr.map(p => `${p.score}@${p.odds}`).join(' ');
  const mark = (yes) => yes ? '✅' : '❌';

  rows.push({
    code: m.code, match: `${m.home}vs${m.away}`, hc: m.handicap ?? 0,
    actual: m.actual, actualTotal: m.actualTotal,
    hTier: tierLabel(getTeamTier(m.home)), aTier: tierLabel(getTeamTier(m.away)),
    v3: fmt(v3), v4: fmt(v4), v5: fmt(v5),
    v3Yes, v4Yes, v5Yes,
    meta: v5Out.meta,
  });
}

// 输出详细表
console.log(`| 场次 | 对阵 | h | tier | 实际(进球) | v3 top3 | ${v3Hit}命中 | v4 top3 | ${v4Hit}命中 | v5 top3 | ${v5Hit}命中 | v5信号 |`);
console.log(`|------|------|-----|-----|-----------|---------|---------|---------|---------|---------|---------|--------|`);
for (const r of rows) {
  const sig = [
    r.meta.bigBallFlag ? '大球' : '-',
    r.meta.weakVsWeak ? '弱弱' : '-',
    `uplift=${r.meta.goalUplift}`,
    `zjq=${r.meta.zjqMode ?? '-'}`,
  ].filter(s => s !== '-').join(' ');
  console.log(`| ${r.code} | ${r.match} | ${r.hc} | ${r.hTier}/${r.aTier} | ${r.actual}(${r.actualTotal}) | ${r.v3} | ${r.v3Yes ? '✅' : '❌'} | ${r.v4} | ${r.v4Yes ? '✅' : '❌'} | ${r.v5} | ${r.v5Yes ? '✅' : '❌'} | ${sig} |`);
}

console.log(`\n## 汇总对比\n`);
console.log(`| 版本 | 命中 | 命中率 | vs 上一版 +命中 | vs 上一版 -命中 |`);
console.log(`|------|------|--------|---------------|----------------|`);
console.log(`| v3(基线: zjq小球+h>=2关zjq) | ${v3Hit}/${matches.length} | ${(v3Hit / matches.length * 100).toFixed(0)}% | - | - |`);
console.log(`| v4(+ 球风组合 goalUplift) | ${v4Hit}/${matches.length} | ${(v4Hit / matches.length * 100).toFixed(0)}% | +${v3Lose_v4Win}(v3错→v4对) | -${v3Win_v4Lose}(v3对→v4错) |`);
console.log(`| v5(+ 提前大小球 + 大球去低档 + 弱弱去大球 + 规则D/E) | ${v5Hit}/${matches.length} | ${(v5Hit / matches.length * 100).toFixed(0)}% | +${v4Lose_v5Win}(v4错→v5对) | -${v4Win_v5Lose}(v4对→v5错) |`);

console.log(`\n## 🔍 关键场景分析:新规则影响了哪些比赛\n`);

console.log(`### (1) v4 错 → v5 对（你的新规则命中了）\n`);
for (const r of rows) if (!r.v4Yes && r.v5Yes) {
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual} | tier:${r.hTier}/${r.aTier}`);
  console.log(`    v3: ${r.v3} ${r.v3Yes ? '✅' : '❌'}`);
  console.log(`    v4: ${r.v4} ${r.v4Yes ? '✅' : '❌'}`);
  console.log(`    v5: ${r.v5} ${r.v5Yes ? '✅' : '❌'}`);
  console.log(`    信号: bigBallFlag=${r.meta.bigBallFlag}, uplift=${r.meta.goalUplift}, zjq=${r.meta.zjqMode ?? '-'}`);
  console.log(`    触发: ${r.meta.triggers.join('; ') || '无'}`);
  console.log();
}

console.log(`\n### (2) v4 对 → v5 错（回归,需要检查你的新逻辑是否过度）\n`);
let regressCount = 0;
for (const r of rows) if (r.v4Yes && !r.v5Yes) {
  regressCount++;
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual} | tier:${r.hTier}/${r.aTier}`);
  console.log(`    v4: ${r.v4} ✅`);
  console.log(`    v5: ${r.v5} ❌`);
  console.log(`    信号: bigBallFlag=${r.meta.bigBallFlag}, uplift=${r.meta.goalUplift}, removedLow=${r.meta.removedLow}, removedBig=${r.meta.removedBig}`);
  console.log(`    触发: ${r.meta.triggers.join('; ') || '无'}`);
  console.log(`    → 是否因"去掉低档/去掉大球"把正确的比分过滤了？`);
  console.log();
}
if (regressCount === 0) console.log(`  （无回归）\n`);

console.log(`\n### (3) 大球场景(flag=true)的详细表现\n`);
for (const r of rows) if (r.meta.bigBallFlag) {
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual}(${r.actualTotal}球) | tier:${r.hTier}/${r.aTier}`);
  console.log(`    v3 top3: ${r.v3} ${r.v3Yes ? '✅' : '❌'}`);
  console.log(`    v4 top3: ${r.v4} ${r.v4Yes ? '✅' : '❌'}`);
  console.log(`    v5 top3: ${r.v5} ${r.v5Yes ? '✅' : '❌'}`);
  console.log(`    信号: uplift=${r.meta.goalUplift}, boost=${r.meta.bigBallBoost}, zjq=${r.meta.zjqMode ?? '-'}, 去掉低档=${r.meta.removedLow}`);
  console.log(`    触发: ${r.meta.triggers.join('; ') || '无'}`);
  console.log();
}

console.log(`\n### (4) 弱弱场景(weakVsWeak=true)的详细表现\n`);
let weakCount = 0;
for (const r of rows) if (r.meta.weakVsWeak && !r.meta.bigBallFlag) {
  weakCount++;
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual}(${r.actualTotal}球) | tier:${r.hTier}/${r.aTier}`);
  console.log(`    v3: ${r.v3} ${r.v3Yes ? '✅' : '❌'}`);
  console.log(`    v4: ${r.v4} ${r.v4Yes ? '✅' : '❌'}`);
  console.log(`    v5: ${r.v5} ${r.v5Yes ? '✅' : '❌'}`);
  console.log(`    去掉大球=${r.meta.removedBig}`);
  console.log();
}
if (weakCount === 0) console.log(`  （无弱弱场景）\n`);

console.log(`\n### (5) 所有版本都错的比赛（需要新想法）\n`);
for (const r of rows) if (!r.v3Yes && !r.v4Yes && !r.v5Yes) {
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual}(${r.actualTotal}球) | tier:${r.hTier}/${r.aTier} | zjq=${r.meta.zjqMode ?? '-'}`);
  console.log(`    v3: ${r.v3}`);
  console.log(`    v4: ${r.v4}`);
  console.log(`    v5: ${r.v5}`);
  console.log(`    → 分析: bigBallFlag=${r.meta.bigBallFlag}, 实际进球${r.actualTotal}, 目标hT=${r.meta.hT},aT=${r.meta.aT}`);
  console.log();
}
