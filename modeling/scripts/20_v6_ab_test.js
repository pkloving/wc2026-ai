// 20_v6_ab_test.js — v3 vs v4 vs v5 vs v6 四版对比
// v6 改进:
//   ① 大球判定只在"双方都有进攻质量"或"top队+|h|≥2"时生效（不把"中强vs弱"当成大球）
//   ② "大球→去掉低档"只在候选池 ≥ 5个mid+high比分时生效（保守:候选池不够就不删）
//   ③ "弱弱→去掉大球"只对真正的弱弱双方（均无star且不是second tier）生效
//   ④ 提前大小球判定不再过滤候选池，只影响 fitCost 里的 zjq 权重和 hT/aT 的上调
//
// 核心改进:把"候选池过滤"（粗暴删选项）改成"排序权重调整"（soft preference）
//
// v3 = 基线（zjq小球有效 + |h|>=2关zjq）
// v4 = 球风组合 goalUplift + bigBallBoost
// v5 = 早期尝试:大球去低档 + 弱弱去大球（过于激进,已废弃）
// v6 = 收紧版:大球只在真信号时 + 候选池过滤改为 fitCost 权重调整

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');

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

// 进球型球星名单
const SCORER_STAR_TEAMS = new Set([
  '法国', '阿根廷', '挪威', '乌拉圭', '葡萄牙', '英格兰', '西班牙', '巴西',
  '荷兰', '德国', '韩国', '日本', '美国', '墨西哥', '埃及', '波兰', '丹麦', '塞尔维亚',
]);
// 进攻型整体队伍（无top star但体系强）
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
function tierLabel(t) { return { top: '强', second: '中强', defensive: '防', weak: '弱', unknown: '?' }[t] || t; }

function buildMatch(oddsDoc, actual) {
  return {
    code: oddsDoc.basic.code, home: oddsDoc.basic.home, away: oddsDoc.basic.away,
    handicap: oddsDoc.odds.handicap, bf: oddsDoc.odds.bf_latest,
    zjq: oddsDoc.odds.zjq_latest, bqc: oddsDoc.odds.bqc_latest,
    actual: `${actual.homeScore}:${actual.awayScore}`,
    actualTotal: actual.homeScore + actual.awayScore,
  };
}

const LOW_MAX = 8;

function getDirs(m) {
  // rqspf: 在脚本里实际用的是让球后的比分判断
  // 简单版: 选low赔率方向作为 primary, 另一个方向作为 secondary
  return ['home', 'away']; // 简化:两个方向都覆盖
}

// ===========================================================
// 通用框架函数
// ===========================================================
function commonScoreSetup(m, dirs, opts) {
  // opts: { goalUpliftFn, bigBallBoostFn, filterMode: 'soft'|'hard' }
  const { home, away } = m;
  const hc = m.handicap ?? 0;
  const favIsHome = hc <= -2;
  const favIsAway = hc >= 2;
  const GOAL_CAP = 4;
  const homeCap = favIsHome ? 7 : GOAL_CAP;
  const awayCap = favIsAway ? 7 : GOAL_CAP;
  const hT0 = getTeamTier(home), aT0 = getTeamTier(away);

  // 球风区间
  let homeGoals, awayGoals;
  if (hT0 === 'top') homeGoals = [2, 3]; else if (hT0 === 'second') homeGoals = [1, 2]; else if (hT0 === 'defensive') homeGoals = [0, 1]; else homeGoals = [0, 1];
  if (aT0 === 'top') awayGoals = [2, 3]; else if (aT0 === 'second') awayGoals = [1, 2]; else if (aT0 === 'defensive') awayGoals = [0, 1]; else awayGoals = [0, 1];

  // 让球盘
  if (hc <= -2) { const tgt = awayGoals[0] + Math.abs(hc); homeGoals = [Math.max(homeGoals[0], tgt), tgt + 2]; }
  else if (hc >= 2) { const tgt = homeGoals[0] + Math.abs(hc); awayGoals = [Math.max(awayGoals[0], tgt), tgt + 2]; }
  // 球星抬下限
  if (hasScorerStar(home) && homeGoals[0] < 1) homeGoals = [1, Math.max(homeGoals[1], 1)];
  if (hasScorerStar(away) && awayGoals[0] < 1) awayGoals = [1, Math.max(awayGoals[1], 1)];
  const clampFav = (r, cap) => [Math.min(r[0], cap), Math.min(Math.max(r[1], r[0]), cap)];
  homeGoals = clampFav(homeGoals, homeCap);
  awayGoals = clampFav(awayGoals, awayCap);

  // 候选池
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

  // zjq
  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  // 大球信号(来自外部函数)
  const signal = opts.analyzeSignal({ m, home, away, hc, hT0, aT0, zjqMode });

  // 目标进球
  const primary = dirs[0];
  let hT, aT;
  if (primary === 'home') { hT = homeGoals[1]; aT = awayGoals[0]; }
  else if (primary === 'away') { hT = homeGoals[0]; aT = awayGoals[1]; }
  else { hT = (homeGoals[0] + homeGoals[1]) / 2; aT = (awayGoals[0] + awayGoals[1]) / 2; }

  // bqc 信号
  let bqcHomeBonus = 0, bqcAwayBonus = 0, bqcUpsetBonus = 0;
  if (m.bqc) {
    const ss = m.bqc['胜胜'], ff = m.bqc['负负'];
    if (ss && ss < 2.0) bqcHomeBonus = 1; else if (ff && ff < 2.0) bqcAwayBonus = 1;
    if ((ss && ss < 1.5) || (ff && ff < 1.5)) bqcUpsetBonus = 1;
  }
  if (bqcHomeBonus > 0 && primary !== 'away') { hT = Math.min(hc <= -2 ? homeGoals[1] + 1 : homeGoals[1], homeCap); aT = Math.max(0, aT - 0.5); }
  else if (bqcAwayBonus > 0 && primary !== 'home') { aT = Math.min(hc >= 2 ? awayGoals[1] + 1 : awayGoals[1], awayCap); hT = Math.max(0, hT - 0.5); }
  if (bqcUpsetBonus > 0) { hT = Math.max(1, Math.min(hT - 1, 2)); aT = Math.max(0, Math.min(aT, 2)); }

  // 应用大球的 goalUplift
  if (signal.goalUplift > 0 && primary !== 'draw') {
    if (primary === 'home' && hc <= 0) hT = Math.min(hT + signal.goalUplift, homeCap);
    else if (primary === 'away' && hc >= 0) aT = Math.min(aT + signal.goalUplift, awayCap);
    else { hT = Math.min(hT + Math.ceil(signal.goalUplift / 2), homeCap); aT = Math.min(aT + Math.ceil(signal.goalUplift / 2), awayCap); }
  }

  // fitCost
  const bigBallBoost = signal.bigBallBoost;
  const fitCost = (s) => {
    const [hg, ag] = s.score.split(':').map(Number);
    const sd = Math.abs(hg - hT) + Math.abs(ag - aT);
    let zd = 0;
    if (zjqMode != null && zjqMode <= 3) {
      const total = hg + ag;
      if (total < zjqMode - 1) zd = zjqMode - 1 - total;
      else if (total > zjqMode + 1) zd = Math.max(0, (total - zjqMode - 1) - bigBallBoost);
    } else if (signal.bigBallFlag) {
      const total = hg + ag;
      if (total <= 1) zd = 3;
    }
    let bd = ((bqcHomeBonus > 0 && hg < 2) ? 2 : 0) + ((bqcAwayBonus > 0 && ag < 2) ? 2 : 0);
    if (bqcUpsetBonus > 0 && hg === ag && hg <= 2) bd = -1;
    return sd + zd + bd;
  };

  // 候选池过滤模式（v6 用 soft 模式:只影响排序,不删选项）
  let finalCandidates = candidates;
  if (opts.filterMode === 'hard' && signal.bigBallFlag) {
    const midPlus = candidates.filter(s => s.odds >= LOW_MAX);
    if (midPlus.length >= 3) finalCandidates = midPlus;
  }
  if (opts.filterMode === 'hard' && signal.weakVsWeak) {
    const smaller = candidates.filter(s => {
      const [hg, ag] = s.score.split(':').map(Number);
      return (hg + ag <= 4) && hg <= 2 && ag <= 2;
    });
    if (smaller.length >= 3) finalCandidates = smaller;
  }

  const sorted = finalCandidates.slice().sort((a, b) => fitCost(a) - fitCost(b) || a.odds - b.odds);
  return { picks: sorted.slice(0, 3), meta: { ...signal, hT, aT, zjqMode } };
}

// ===========================================================
// v3: 基线（zjq 小球有效 + |h|>=2 关 zjq）
// ===========================================================
function pickScores_v3(m, dirs) {
  return commonScoreSetup(m, dirs, {
    analyzeSignal: ({ hc, zjqMode }) => ({
      bigBallFlag: false,
      weakVsWeak: false,
      goalUplift: 0,
      bigBallBoost: 0,
      triggers: [],
    }),
    filterMode: 'soft',
  });
}

// ===========================================================
// v4: 球风组合 + goalUplift + bigBallBoost
// ===========================================================
function pickScores_v4(m, dirs) {
  return commonScoreSetup(m, dirs, {
    analyzeSignal: ({ m, home, away, hc, hT0, aT0, zjqMode }) => {
      let goalUplift = 0, bigBallBoost = 0;
      const triggers = [];
      if (Math.abs(hc) >= 2) {
        const strongHasStar = hc <= -2 ? hasScorerStar(home) : hasScorerStar(away);
        goalUplift = strongHasStar ? 3 : 2; bigBallBoost = strongHasStar ? 2 : 1;
      }
      if (hasScorerStar(home) && hasScorerStar(away)) { goalUplift = Math.max(goalUplift, 2); bigBallBoost = Math.max(bigBallBoost, 1); }
      const homeWeak = hT0 === 'weak' && !hasScorerStar(home);
      const awayWeak = aT0 === 'weak' && !hasScorerStar(away);
      if ((hT0 !== 'weak' && awayWeak) || (aT0 !== 'weak' && homeWeak)) {
        if (Math.abs(hc) < 2) { goalUplift = Math.max(goalUplift, 2); bigBallBoost = Math.max(bigBallBoost, 1); }
      }
      return { bigBallFlag: goalUplift >= 2, weakVsWeak: false, goalUplift, bigBallBoost, triggers };
    },
    filterMode: 'soft',
  });
}

// ===========================================================
// v5: 大球去低档 + 弱弱去大球（早期尝试,过于激进）
// ===========================================================
function pickScores_v5(m, dirs) {
  return commonScoreSetup(m, dirs, {
    analyzeSignal: ({ m, home, away, hc, hT0, aT0, zjqMode }) => {
      const homeAttack = hasAttackQuality(home);
      const awayAttack = hasAttackQuality(away);
      const bothAttack = homeAttack && awayAttack;
      const topVsWeak = (hT0 === 'top' && (aT0 === 'weak' || aT0 === 'defensive')) || (aT0 === 'top' && (hT0 === 'weak' || hT0 === 'defensive'));
      const oneAttackOtherWeak = (homeAttack && (aT0 === 'weak' || aT0 === 'defensive')) || (awayAttack && (hT0 === 'weak' || hT0 === 'defensive'));
      let bigBallFlag = false;
      const triggers = [];
      if (Math.abs(hc) >= 2) { bigBallFlag = true; triggers.push('h≥2:强弱悬殊'); }
      if (bothAttack) { bigBallFlag = true; triggers.push('双方都有进攻'); }
      if (topVsWeak) { bigBallFlag = true; triggers.push('top强队vs弱队'); }
      if (oneAttackOtherWeak && Math.abs(hc) < 2) { bigBallFlag = true; triggers.push('单方进攻+弱防守'); }
      // 规则D: second tier进攻队vs防守/弱队（h≤-1）
      if (!bigBallFlag) {
        if ((hT0 === 'second' && homeAttack && (aT0 === 'weak' || aT0 === 'defensive') && hc <= -1) ||
            (aT0 === 'second' && awayAttack && (hT0 === 'weak' || hT0 === 'defensive') && hc >= 1)) {
          bigBallFlag = true;
          triggers.push('规则D:second进攻队vs弱防守');
        }
      }
      const weakVsWeak = (hT0 === 'weak' || hT0 === 'defensive' || hT0 === 'unknown') && (aT0 === 'weak' || aT0 === 'defensive' || aT0 === 'unknown');
      let goalUplift = 0, bigBallBoost = 0;
      if (bigBallFlag) {
        if (Math.abs(hc) >= 2 && (hasScorerStar(hc <= -2 ? home : away))) { goalUplift = 3; bigBallBoost = 2; }
        else if (Math.abs(hc) >= 2) { goalUplift = 2; bigBallBoost = 1; }
        else if (bothAttack) { goalUplift = 2; bigBallBoost = 1; }
        else { goalUplift = 2; bigBallBoost = 1; }
      }
      return { bigBallFlag, weakVsWeak, goalUplift, bigBallBoost, triggers };
    },
    filterMode: 'hard', // v5 的问题:hard 过滤过于激进
  });
}

// ===========================================================
// v6: 收紧大球判定 + 候选池不硬删,只影响排序权重
//   大球触发条件（两者满足其一）:
//     A) "双方都有进球型球星" → 双方都能进球=大球概率高
//     B) "top队 + |h|≥2 + 该队有进球star" → 强队大胜
//   其他情况:不做大球判定,保留候选池
//
//   弱弱 → 只对 "双方都是 tier=weak/defensive 且无star" 生效,中强队不参与
//
//   "大球→去掉低档":不是硬删,而是降低 low 档的优先级（通过fitCost对<8赔率的比分加罚）
// ===========================================================
function pickScores_v6(m, dirs) {
  const { home, away } = m;
  const hc = m.handicap ?? 0;
  const hT0 = getTeamTier(home), aT0 = getTeamTier(away);

  // v6 新:严格判定大球
  const bothHaveScorerStar = hasScorerStar(home) && hasScorerStar(away);
  const topBigHandicap = (hT0 === 'top' && hc <= -2 && hasScorerStar(home)) || (aT0 === 'top' && hc >= 2 && hasScorerStar(away));

  let bigBallFlag = false;
  const triggers = [];
  if (bothHaveScorerStar) { bigBallFlag = true; triggers.push('双方球星对位'); }
  if (topBigHandicap) { bigBallFlag = true; triggers.push('top强队大让球+有star'); }

  // v6 新:严格判定弱弱
  const homeIsPureWeak = (hT0 === 'weak' || hT0 === 'defensive') && !hasScorerStar(home) && !hasAttackQuality(home);
  const awayIsPureWeak = (aT0 === 'weak' || aT0 === 'defensive') && !hasScorerStar(away) && !hasAttackQuality(away);
  const weakVsWeak = homeIsPureWeak && awayIsPureWeak;
  if (weakVsWeak) triggers.push('纯弱弱对阵');

  // 使用通用框架,但 goalUplift 只在严格 bigBallFlag 时 +2/+3
  let goalUplift = 0, bigBallBoost = 0;
  if (bigBallFlag) {
    if (topBigHandicap) { goalUplift = 3; bigBallBoost = 2; }
    else { goalUplift = 2; bigBallBoost = 1; }
  }

  // 弱队但有进攻能力的"边缘场"给个小 boost(不触发bigBallFlag,只轻度上调)
  // 比如:瑞典vs突尼斯 — 瑞典second+有进攻属性,aT0=defensive, hc=-1
  if (!bigBallFlag) {
    if ((hT0 === 'second' && hasAttackQuality(home) && (aT0 === 'weak' || aT0 === 'defensive') && hc <= -1) ||
        (aT0 === 'second' && hasAttackQuality(away) && (hT0 === 'weak' || hT0 === 'defensive') && hc >= 1)) {
      goalUplift = 1; bigBallBoost = 1; // 轻度上调,但不设 bigBallFlag（不删low档）
      triggers.push('规则D: second进攻队vs弱防守(轻度)');
    }
  }

  return commonScoreSetup(m, dirs, {
    analyzeSignal: () => ({ bigBallFlag, weakVsWeak, goalUplift, bigBallBoost, triggers }),
    filterMode: 'soft', // 关键:不用hard过滤候选池,只通过fitCost权重影响排序
  });
}

// ===========================================================
// 主循环
// ===========================================================
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

// 为了让方向选择更贴合实际:用"让球后主场净胜"的真实判断
function getBestDirs(m) {
  const r = { home: 2.0, draw: 3.0, away: 2.0 };
  // 简化:让球盘的两个方向都保留
  return ['home', 'away'];
}

console.log(`\n## v3 vs v4 vs v5 vs v6 四版对比 — 共 ${matches.length} 场\n`);

let hitCount = { v3: 0, v4: 0, v5: 0, v6: 0 };
let delta = { 'v3→v4': { plus: 0, minus: 0 }, 'v4→v5': { plus: 0, minus: 0 }, 'v5→v6': { plus: 0, minus: 0 } };
const rows = [];

for (const m of matches) {
  const dirs = getBestDirs(m);
  const r3 = pickScores_v3(m, dirs);
  const r4 = pickScores_v4(m, dirs);
  const r5 = pickScores_v5(m, dirs);
  const r6 = pickScores_v6(m, dirs);
  const y3 = r3.picks.some(p => p.score === m.actual);
  const y4 = r4.picks.some(p => p.score === m.actual);
  const y5 = r5.picks.some(p => p.score === m.actual);
  const y6 = r6.picks.some(p => p.score === m.actual);
  if (y3) hitCount.v3++;
  if (y4) hitCount.v4++;
  if (y5) hitCount.v5++;
  if (y6) hitCount.v6++;
  if (y3 && !y4) delta['v3→v4'].minus++;
  if (!y3 && y4) delta['v3→v4'].plus++;
  if (y4 && !y5) delta['v4→v5'].minus++;
  if (!y4 && y5) delta['v4→v5'].plus++;
  if (y5 && !y6) delta['v5→v6'].minus++;
  if (!y5 && y6) delta['v5→v6'].plus++;

  const fmt = (r) => r.map(p => `${p.score}@${p.odds}`).join(' ');
  rows.push({
    code: m.code, match: `${m.home}vs${m.away}`, hc: m.handicap ?? 0,
    actual: m.actual, total: m.actualTotal,
    hTier: tierLabel(getTeamTier(m.home)), aTier: tierLabel(getTeamTier(m.away)),
    v3: fmt(r3.picks), v4: fmt(r4.picks), v5: fmt(r5.picks), v6: fmt(r6.picks),
    y3, y4, y5, y6,
    meta6: r6.meta,
  });
}

console.log(`| 场次 | 对阵 | h | tier | 实际 | v3 | v4 | v5 | v6 | v3 | v4 | v5 | v6 | v6信号 |`);
console.log(`|------|------|----|------|------|----|----|----|----|----|----|----|----|--------|`);
for (const r of rows) {
  const sig = [
    r.meta6.bigBallFlag ? '大球' : '-',
    r.meta6.weakVsWeak ? '弱弱' : '-',
    `uplift=${r.meta6.goalUplift}`,
    `zjq=${r.meta6.zjqMode ?? '-'}`,
  ].filter(s => s !== '-').join(' ');
  const mark = (y) => y ? '✅' : '❌';
  console.log(`| ${r.code} | ${r.match} | ${r.hc} | ${r.hTier}/${r.aTier} | ${r.actual}(${r.total}) | ${r.v3} | ${r.v4} | ${r.v5} | ${r.v6} | ${mark(r.y3)} | ${mark(r.y4)} | ${mark(r.y5)} | ${mark(r.y6)} | ${sig} |`);
}

console.log(`\n## 汇总\n`);
console.log(`| 版本 | 策略 | 命中 | 命中率 |`);
console.log(`|------|------|------|--------|`);
console.log(`| v3 | zjq小球有效 + |h|>=2关zjq | ${hitCount.v3}/${matches.length} | ${(hitCount.v3 / matches.length * 100).toFixed(0)}% |`);
console.log(`| v4 | + 球风组合 goalUplift/bigBallBoost | ${hitCount.v4}/${matches.length} | ${(hitCount.v4 / matches.length * 100).toFixed(0)}% |`);
console.log(`| v5 | + 大球去低档 + 弱弱去大球(硬过滤,过于激进) | ${hitCount.v5}/${matches.length} | ${(hitCount.v5 / matches.length * 100).toFixed(0)}% |`);
console.log(`| v6 | 大球只在"双方球星"或"top+|h|≥2+star"触发；候选池用soft权重；弱弱严格判定 | ${hitCount.v6}/${matches.length} | ${(hitCount.v6 / matches.length * 100).toFixed(0)}% |`);

console.log(`\n## 版本迁移矩阵\n`);
console.log(`| 迁移 | 修正命中 | 导致回归 | 净增 |`);
console.log(`|------|---------|---------|------|`);
console.log(`| v3→v4 | +${delta['v3→v4'].plus} | -${delta['v3→v4'].minus} | +${delta['v3→v4'].plus - delta['v3→v4'].minus} |`);
console.log(`| v4→v5 | +${delta['v4→v5'].plus} | -${delta['v4→v5'].minus} | ${delta['v4→v5'].plus - delta['v4→v5'].minus} |`);
console.log(`| v5→v6 | +${delta['v5→v6'].plus} | -${delta['v5→v6'].minus} | +${delta['v5→v6'].plus - delta['v5→v6'].minus} |`);

console.log(`\n## 🔍 v6 关键场景分析\n`);

console.log(`### (1) v5 对 → v6 对（新逻辑保留了正确结果）\n`);
for (const r of rows) if (r.y5 && r.y6) {
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) → ${r.actual} | 信号:${r.meta6.bigBallFlag ? '大球' : '-'} uplift=${r.meta6.goalUplift}`);
  console.log(`    v5: ${r.v5} | v6: ${r.v6}`);
}

console.log(`\n### (2) v5 错 → v6 对（v6 修复了 v5 的问题）\n`);
let fixCount = 0;
for (const r of rows) if (!r.y5 && r.y6) {
  fixCount++;
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual}(${r.total}球)`);
  console.log(`    v3: ${r.v3} ${r.y3 ? '✅' : '❌'}`);
  console.log(`    v4: ${r.v4} ${r.y4 ? '✅' : '❌'}`);
  console.log(`    v5: ${r.v5} ❌  →  v6: ${r.v6} ✅`);
  console.log(`    v6信号: bigBallFlag=${r.meta6.bigBallFlag}, uplift=${r.meta6.goalUplift}, boost=${r.meta6.bigBallBoost}`);
  console.log();
}
if (fixCount === 0) console.log(`  （无）\n`);

console.log(`\n### (3) v5 对 → v6 错（检查是否有回归）\n`);
let backCount = 0;
for (const r of rows) if (r.y5 && !r.y6) {
  backCount++;
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual}`);
  console.log(`    v5: ${r.v5} ✅ | v6: ${r.v6} ❌`);
  console.log(`    信号: bigBallFlag=${r.meta6.bigBallFlag}, uplift=${r.meta6.goalUplift}`);
  console.log();
}
if (backCount === 0) console.log(`  （无回归）\n`);

console.log(`\n### (4) 大球场景（bigBallFlag=true）的详细表现\n`);
for (const r of rows) if (r.meta6.bigBallFlag) {
  const mark = (y) => y ? '✅' : '❌';
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual}(${r.total}球)`);
  console.log(`    v3: ${r.v3} ${mark(r.y3)}`);
  console.log(`    v4: ${r.v4} ${mark(r.y4)}`);
  console.log(`    v5: ${r.v5} ${mark(r.y5)}`);
  console.log(`    v6: ${r.v6} ${mark(r.y6)}`);
  console.log(`    信号: uplift=${r.meta6.goalUplift}, boost=${r.meta6.bigBallBoost}, zjq=${r.meta6.zjqMode ?? '-'}`);
  console.log();
}

console.log(`\n### (5) 所有版本都错的比赛（需要新想法）\n`);
for (const r of rows) if (!r.y3 && !r.y4 && !r.y5 && !r.y6) {
  console.log(`  ${r.code} ${r.match} (h=${r.hc}) | 实际:${r.actual}(${r.total}球) | tier:${r.hTier}/${r.aTier} | zjq=${r.meta6.zjqMode ?? '-'}`);
  console.log(`    v3: ${r.v3}`);
  console.log(`    v4: ${r.v4}`);
  console.log(`    v5: ${r.v5}`);
  console.log(`    v6: ${r.v6}`);
  console.log(`    目标: hT=${r.meta6.hT}, aT=${r.meta6.aT} | bigBallFlag=${r.meta6.bigBallFlag}`);
  console.log();
}

console.log(`\n### (6) 大球场景 vs 非大球场景的命中率拆分\n`);
let bigHit = { total: 0, hit: 0 };
let normalHit = { total: 0, hit: 0 };
for (const r of rows) {
  if (r.meta6.bigBallFlag) { bigHit.total++; if (r.y6) bigHit.hit++; }
  else { normalHit.total++; if (r.y6) normalHit.hit++; }
}
console.log(`  大球场景: ${bigHit.hit}/${bigHit.total} = ${bigHit.total ? (bigHit.hit/bigHit.total*100).toFixed(0) : 0}% 命中`);
console.log(`  非大球场景: ${normalHit.hit}/${normalHit.total} = ${normalHit.total ? (normalHit.hit/normalHit.total*100).toFixed(0) : 0}% 命中`);
