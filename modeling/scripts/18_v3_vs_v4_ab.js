// 18_v3_vs_v4_ab.js — v2
// 用真实数据结构调用 pickScores，做 v3 vs v4 的 A/B 测试
// 核心问题：之前的脚本用了错的数据结构，这里直接读 12_r013_user_rules.js 中的 pickScores

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
const SCORER_STAR_TEAMS = new Set([
  '法国', '阿根廷', '挪威', '乌拉圭', '葡萄牙', '英格兰', '西班牙', '巴西',
  '荷兰', '德国', '韩国', '日本', '美国', '墨西哥', '埃及', '波兰', '丹麦', '塞尔维亚',
]);
const STARS = {
  '法国': '姆巴佩', '阿根廷': '梅西', '挪威': '哈兰德', '乌拉圭': '苏亚雷斯/努涅斯',
  '葡萄牙': 'C罗', '英格兰': '凯恩', '西班牙': '亚马尔/罗德里', '巴西': '内马尔/维尼修斯',
  '荷兰': '德佩', '德国': '凯恩', '韩国': '孙兴慜', '日本': '三笘熏/久保建英',
  '美国': '普利希奇', '墨西哥': '希门尼斯', '埃及': '萨拉赫', '波兰': '莱万',
  '丹麦': '埃里克森', '塞尔维亚': '弗拉霍维奇',
};
function getStar(t) { return STARS[t] || '无'; }
function hasScorerStar(t) { return SCORER_STAR_TEAMS.has(t) && getStar(t) !== '无'; }
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

// 构造match对象（和12_r013_user_rules.js中一致）
function buildMatch(oddsDoc, actual) {
  return {
    mid: oddsDoc.basic.mid,
    code: oddsDoc.basic.code,
    home: oddsDoc.basic.home,
    away: oddsDoc.basic.away,
    kickoff: oddsDoc.basic.kickoff,
    handicap: oddsDoc.odds.handicap,
    spf: oddsDoc.odds.spf_latest,
    rqspf: oddsDoc.odds.rqspf_latest,
    bf: oddsDoc.odds.bf_latest,        // 比分赔率表 - 这是核心!
    zjq: oddsDoc.odds.zjq_latest,
    bqc: oddsDoc.odds.bqc_latest,
    actual: actual,
  };
}

// ============= v3: 原逻辑（zjq只对小球生效 + |h|>=2关zjq） =============
function pickScores_v3(m, dirs) {
  const { home, away } = m;
  const hc = m.handicap ?? 0;
  const favIsHome = hc <= -2;
  const favIsAway = hc >= 2;
  const GOAL_CAP = 4;
  const homeCap = favIsHome ? 6 : GOAL_CAP;   // v3 cap=6
  const awayCap = favIsAway ? 6 : GOAL_CAP;

  let homeGoals;
  const hT0 = getTeamTier(home);
  if (hT0 === 'top') homeGoals = [2, 3];
  else if (hT0 === 'second') homeGoals = [1, 2];
  else if (hT0 === 'defensive') homeGoals = [0, 1];
  else homeGoals = [0, 1];
  let awayGoals;
  const aT0 = getTeamTier(away);
  if (aT0 === 'top') awayGoals = [2, 3];
  else if (aT0 === 'second') awayGoals = [1, 2];
  else if (aT0 === 'defensive') awayGoals = [0, 1];
  else awayGoals = [0, 1];

  // 让球盘抬进球
  if (hc <= -2) { const target = awayGoals[0] + Math.abs(hc); homeGoals = [Math.max(homeGoals[0], target), target + 1]; }
  else if (hc >= 2) { const target = homeGoals[0] + Math.abs(hc); awayGoals = [Math.max(awayGoals[0], target), target + 1]; }

  // 球星抬下限
  if (hasScorerStar(home) && homeGoals[0] < 1) homeGoals = [1, Math.max(homeGoals[1], 1)];
  if (hasScorerStar(away) && awayGoals[0] < 1) awayGoals = [1, Math.max(awayGoals[1], 1)];

  const clampRangeFav = (r, cap) => [Math.min(r[0], cap), Math.min(Math.max(r[1], r[0]), cap)];
  homeGoals = clampRangeFav(homeGoals, homeCap);
  awayGoals = clampRangeFav(awayGoals, awayCap);

  // 读比分赔率
  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, prob: fairProbFromOdds(v) }));

  // 大盘真实性过滤
  let realScores = allScores;
  if (hc >= 2) { const kept = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg <= ag; }); if (kept.length > 0) realScores = kept; }
  else if (hc <= -2) { const kept = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg >= ag; }); if (kept.length > 0) realScores = kept; }

  // 方向过滤
  const matchDir = (dir, adj, ag) => dir === 'home' ? adj > ag : dir === 'draw' ? adj === ag : dir === 'away' ? adj < ag : false;
  const filtered = realScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    const adj = hg + hc;
    return dirs.some(dir => matchDir(dir, adj, ag));
  });

  // 球风过滤
  const homeTol = (getTeamTier(home) === 'weak' && !hasScorerStar(home) && hc >= 2) ? 0 : 1;
  const awayTol = (getTeamTier(away) === 'weak' && !hasScorerStar(away) && hc <= -2) ? 0 : 1;
  const inRange = (g, range, tol) => (g >= range[0] && g <= range[1] + tol);
  const styleFiltered = filtered.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return inRange(hg, homeGoals, homeTol) && inRange(ag, awayGoals, awayTol);
  });

  const candidates = styleFiltered.length > 0 ? styleFiltered : filtered;

  // 方向→目标进球
  const primary = dirs[0];
  let hT, aT;
  if (primary === 'home') { hT = homeGoals[1]; aT = awayGoals[0]; }
  else if (primary === 'away') { hT = homeGoals[0]; aT = awayGoals[1]; }
  else { hT = (homeGoals[0] + homeGoals[1]) / 2; aT = (awayGoals[0] + awayGoals[1]) / 2; }

  // v3: zjq —— |h|>=2 关掉；否则小球(≤3)有效
  const zjqW = 1;
  let zjqMode = null;
  if (m.zjq && !(Math.abs(hc) >= 2)) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }
  if (zjqMode != null && zjqMode > 3) zjqMode = null;

  // bqc
  let bqcHomeBonus = 0, bqcAwayBonus = 0, bqcUpsetBonus = 0;
  if (m.bqc) {
    const ss = m.bqc['胜胜'];
    const ff = m.bqc['负负'];
    if (ss && ss < 2.0) bqcHomeBonus = 1;
    else if (ff && ff < 2.0) bqcAwayBonus = 1;
    if ((ss && ss < 1.5) || (ff && ff < 1.5)) bqcUpsetBonus = 1;
  }

  // bqc 应用到目标进球
  if (bqcHomeBonus > 0 && primary !== 'away') { hT = Math.min(hc <= -2 ? homeGoals[1] + 1 : homeGoals[1], homeCap); aT = Math.max(0, aT - 0.5); }
  else if (bqcAwayBonus > 0 && primary !== 'home') { aT = Math.min(hc >= 2 ? awayGoals[1] + 1 : awayGoals[1], awayCap); hT = Math.max(0, hT - 0.5); }
  if (bqcUpsetBonus > 0) { hT = Math.max(1, Math.min(hT - 1, 2)); aT = Math.max(0, Math.min(aT, 2)); }

  const fitCost = (s) => {
    const [hg, ag] = s.score.split(':').map(Number);
    const styleD = Math.abs(hg - hT) + Math.abs(ag - aT);
    const zjqD = zjqMode != null ? zjqW * Math.abs(hg + ag - zjqMode) : 0;
    let bqcD = ((bqcHomeBonus > 0 && hg < 2) ? 2 : 0) + ((bqcAwayBonus > 0 && ag < 2) ? 2 : 0);
    if (bqcUpsetBonus > 0 && hg === ag && hg <= 2) bqcD = -1;
    return styleD + zjqD + bqcD;
  };

  // 取top3
  const sorted = candidates.slice().sort((a, b) => fitCost(a) - fitCost(b) || a.odds - b.odds);
  return sorted.slice(0, 3);
}

// ============= v4: 你的新逻辑 —— zjq打底 + 球风组合goalUplift上调目标进球 =============
function pickScores_v4(m, dirs) {
  const { home, away } = m;
  const hc = m.handicap ?? 0;
  const favIsHome = hc <= -2;
  const favIsAway = hc >= 2;
  const GOAL_CAP = 4;
  const homeCap = favIsHome ? 7 : GOAL_CAP;   // v4 cap=7
  const awayCap = favIsAway ? 7 : GOAL_CAP;

  let homeGoals;
  const hT0 = getTeamTier(home);
  if (hT0 === 'top') homeGoals = [2, 3];
  else if (hT0 === 'second') homeGoals = [1, 2];
  else if (hT0 === 'defensive') homeGoals = [0, 1];
  else homeGoals = [0, 1];
  let awayGoals;
  const aT0 = getTeamTier(away);
  if (aT0 === 'top') awayGoals = [2, 3];
  else if (aT0 === 'second') awayGoals = [1, 2];
  else if (aT0 === 'defensive') awayGoals = [0, 1];
  else awayGoals = [0, 1];

  if (hc <= -2) { const target = awayGoals[0] + Math.abs(hc); homeGoals = [Math.max(homeGoals[0], target), target + 2]; }
  else if (hc >= 2) { const target = homeGoals[0] + Math.abs(hc); awayGoals = [Math.max(awayGoals[0], target), target + 2]; }

  if (hasScorerStar(home) && homeGoals[0] < 1) homeGoals = [1, Math.max(homeGoals[1], 1)];
  if (hasScorerStar(away) && awayGoals[0] < 1) awayGoals = [1, Math.max(awayGoals[1], 1)];

  const clampRangeFav = (r, cap) => [Math.min(r[0], cap), Math.min(Math.max(r[1], r[0]), cap)];
  homeGoals = clampRangeFav(homeGoals, homeCap);
  awayGoals = clampRangeFav(awayGoals, awayCap);

  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, prob: fairProbFromOdds(v) }));

  let realScores = allScores;
  if (hc >= 2) { const kept = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg <= ag; }); if (kept.length > 0) realScores = kept; }
  else if (hc <= -2) { const kept = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg >= ag; }); if (kept.length > 0) realScores = kept; }

  const matchDir = (dir, adj, ag) => dir === 'home' ? adj > ag : dir === 'draw' ? adj === ag : dir === 'away' ? adj < ag : false;
  const filtered = realScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    const adj = hg + hc;
    return dirs.some(dir => matchDir(dir, adj, ag));
  });

  const homeTol = (getTeamTier(home) === 'weak' && !hasScorerStar(home) && hc >= 2) ? 0 : 1;
  const awayTol = (getTeamTier(away) === 'weak' && !hasScorerStar(away) && hc <= -2) ? 0 : 1;
  const inRange = (g, range, tol) => (g >= range[0] && g <= range[1] + tol);
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

  // v4 zjq：始终读，不再被|h|>=2关掉
  const zjqW = 1;
  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }
  if (zjqMode != null && zjqMode > 3) zjqMode = null;

  // v4: 球风组合 → goalUplift & bigBallBoost
  const hTier = getTeamTier(home), aTier = getTeamTier(away);
  const homeHasStar = hasScorerStar(home), awayHasStar = hasScorerStar(away);
  const homeIsWeak = hTier === 'weak' && !homeHasStar;
  const awayIsWeak = aTier === 'weak' && !awayHasStar;

  let goalUplift = 0, bigBallBoost = 0;
  const triggers = [];
  if (Math.abs(hc) >= 2) {
    const strongTeam = hc <= -2 ? home : away;
    const strongHasStar = hasScorerStar(strongTeam);
    goalUplift = Math.max(goalUplift, strongHasStar ? 3 : 2);
    bigBallBoost = Math.max(bigBallBoost, strongHasStar ? 2 : 1);
    if (strongHasStar) triggers.push(`A:|h|>=2+${strongTeam}有${getStar(strongTeam)}`);
    else triggers.push(`A:|h|>=2+${strongTeam}(无星)`);
  }
  if (homeHasStar && awayHasStar) { goalUplift = Math.max(goalUplift, 2); bigBallBoost = Math.max(bigBallBoost, 1); triggers.push('B:双方球星'); }
  if ((hTier !== 'weak' && awayIsWeak) || (aTier !== 'weak' && homeIsWeak)) {
    if (Math.abs(hc) < 2) { goalUplift = Math.max(goalUplift, 2); bigBallBoost = Math.max(bigBallBoost, 1); triggers.push('C:中强vs弱防守'); }
  }

  // bqc
  let bqcHomeBonus = 0, bqcAwayBonus = 0, bqcUpsetBonus = 0;
  if (m.bqc) {
    const ss = m.bqc['胜胜'];
    const ff = m.bqc['负负'];
    if (ss && ss < 2.0) bqcHomeBonus = 1;
    else if (ff && ff < 2.0) bqcAwayBonus = 1;
    if ((ss && ss < 1.5) || (ff && ff < 1.5)) bqcUpsetBonus = 1;
  }

  if (bqcHomeBonus > 0 && primary !== 'away') { hT = Math.min(hc <= -2 ? homeGoals[1] + 1 : homeGoals[1], homeCap); aT = Math.max(0, aT - 0.5); }
  else if (bqcAwayBonus > 0 && primary !== 'home') { aT = Math.min(hc >= 2 ? awayGoals[1] + 1 : awayGoals[1], awayCap); hT = Math.max(0, hT - 0.5); }
  if (bqcUpsetBonus > 0) { hT = Math.max(1, Math.min(hT - 1, 2)); aT = Math.max(0, Math.min(aT, 2)); }

  // v4 goalUplift 上调目标进球
  if (goalUplift > 0 && primary !== 'draw') {
    if (primary === 'home' && hc <= 0) hT = Math.min(hT + goalUplift, homeCap);
    else if (primary === 'away' && hc >= 0) aT = Math.min(aT + goalUplift, awayCap);
    else { hT = Math.min(hT + Math.ceil(goalUplift / 2), homeCap); aT = Math.min(aT + Math.ceil(goalUplift / 2), awayCap); }
  }

  const fitCost = (s) => {
    const [hg, ag] = s.score.split(':').map(Number);
    const styleD = Math.abs(hg - hT) + Math.abs(ag - aT);
    let zjqD = 0;
    if (zjqMode != null) {
      const total = hg + ag;
      if (total < zjqMode - 1) zjqD = zjqW * (zjqMode - 1 - total);
      else if (total > zjqMode + 1) zjqD = zjqW * Math.max(0, (total - zjqMode - 1) - bigBallBoost);
    }
    let bqcD = ((bqcHomeBonus > 0 && hg < 2) ? 2 : 0) + ((bqcAwayBonus > 0 && ag < 2) ? 2 : 0);
    if (bqcUpsetBonus > 0 && hg === ag && hg <= 2) bqcD = -1;
    return styleD + zjqD + bqcD;
  };

  const sorted = candidates.slice().sort((a, b) => fitCost(a) - fitCost(b) || a.odds - b.odds);
  return { picks: sorted.slice(0, 3), meta: { goalUplift, bigBallBoost, zjqMode, hT, aT, triggers } };
}

// ============= 主循环：读全部世界杯场次 =============
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

console.log(`\n## A/B测试: v3 vs v4 — 共 ${matches.length} 场\n`);

// 对每场模拟一个方向选择（用rqspf最低赔率方向做主方向，再覆盖全部方向）
function getDirs(m) {
  const r = m.rqspf;
  const picks = [];
  // 选最低赔率的方向做primary
  const oddsArr = [
    { key: 'home', odds: r.home },
    { key: 'draw', odds: r.draw },
    { key: 'away', odds: r.away },
  ].filter(x => x.odds > 1);
  oddsArr.sort((a, b) => a.odds - b.odds);
  // 取top2（相当于2边覆盖），若只有1个则取1个
  return oddsArr.slice(0, 2).map(x => x.key);
}

let v3Hit = 0, v4Hit = 0;
let v3win_v4lose = 0, v3lose_v4win = 0;
const rows = [];

for (const m of matches) {
  const dirs = getDirs(m);
  const v3Picks = pickScores_v3(m, dirs);
  const v4Out = pickScores_v4(m, dirs);
  const v4Picks = v4Out.picks;
  const actual = `${m.actual.homeScore}:${m.actual.awayScore}`;
  const v3Yes = v3Picks.some(p => p.score === actual);
  const v4Yes = v4Picks.some(p => p.score === actual);
  if (v3Yes) v3Hit++;
  if (v4Yes) v4Hit++;
  if (v3Yes && !v4Yes) v3win_v4lose++;
  if (!v3Yes && v4Yes) v3lose_v4win++;

  const homeTier = tierLabel(getTeamTier(m.home));
  const awayTier = tierLabel(getTeamTier(m.away));
  const homeStar = hasScorerStar(m.home) ? `⭐${getStar(m.home)}` : '无';
  const awayStar = hasScorerStar(m.away) ? `⭐${getStar(m.away)}` : '无';

  const v3Str = v3Picks.map(p => `${p.score}@${p.odds}`).join(' ');
  const v4Str = v4Picks.map(p => `${p.score}@${p.odds}`).join(' ');
  const trig = v4Out.meta.triggers.join(';') || '-';

  let change = '=';
  if (v3Yes && v4Yes) change = '✅均中';
  else if (v3Yes && !v4Yes) change = '🔴v3→v4错';
  else if (!v3Yes && v4Yes) change = '✅v3→v4对';
  else change = '❌均错';

  rows.push({ code: m.code, home: m.home, away: m.away, hc: m.handicap ?? 0, hTier: homeTier, aTier: awayTier, hStar: homeStar, aStar: awayStar, actual, zjqMode: v4Out.meta.zjqMode ?? '-', goalUplift: v4Out.meta.goalUplift, bigBallBoost: v4Out.meta.bigBallBoost, hT: v4Out.meta.hT, aT: v4Out.meta.aT, triggers: trig, v3: v3Str, v4: v4Str, v3Yes, v4Yes, change });
}

// 打印表
console.log(`| 场次 | 对阵 | h | 主队 | 客队 | 实际 | zjq | goalUplift | v3 top3 | v4 top3 | v3 | v4 | 变化 | 触发 |`);
console.log(`|------|------|----|------|------|------|-----|-----------|---------|---------|----|----|------|------|`);
for (const r of rows) {
  console.log(`| ${r.code} | ${r.home}vs${r.away} | ${r.hc} | ${r.hTier}/${r.hStar} | ${r.aTier}/${r.aStar} | ${r.actual} | ${r.zjqMode} | ${r.goalUplift} | ${r.v3} | ${r.v4} | ${r.v3Yes ? '✅' : '❌'} | ${r.v4Yes ? '✅' : '❌'} | ${r.change} | ${r.triggers} |`);
}

console.log(`\n## 汇总\n`);
console.log(`| 指标 | v3 | v4 | 变化 |`);
console.log(`|------|----|----|------|`);
console.log(`| 命中 | ${v3Hit}/${matches.length} (${(v3Hit / matches.length * 100).toFixed(0)}%) | ${v4Hit}/${matches.length} (${(v4Hit / matches.length * 100).toFixed(0)}%) | ${v4Hit - v3Hit >= 0 ? '+' : ''}${v4Hit - v3Hit} |`);
console.log(`| v3对→v4错 | - | ${v3win_v4lose} 场 | 回归分析 |`);
console.log(`| v3错→v4对 | ${v3lose_v4win} 场 | - | ✅新规则有效 |`);

console.log(`\n## 详细诊断1：v3 错 → v4 对（你的球风组合思路命中了）\n`);
for (const r of rows) if (!r.v3Yes && r.v4Yes) {
  console.log(`  ${r.code} ${r.home}vs${r.away} | h=${r.hc} | 实际:${r.actual} | zjqMode=${r.zjqMode} | hT=${r.hT},aT=${r.aT} | uplift=${r.goalUplift} | boost=${r.bigBallBoost}`);
  console.log(`    触发规则: ${r.triggers}`);
  console.log(`    v3 top3: ${r.v3}`);
  console.log(`    v4 top3: ${r.v4}`);
  console.log(`    → v3错过了什么？看 v3 top3 中进球区间 vs 实际 ${r.actual.split(':').reduce((a, b) => +a + +b, 0)} 球`);
  console.log();
}

console.log(`\n## 详细诊断2：v3 对 → v4 错（回归，需要找原因）\n`);
for (const r of rows) if (r.v3Yes && !r.v4Yes) {
  console.log(`  ${r.code} ${r.home}vs${r.away} | h=${r.hc} | 实际:${r.actual} | zjqMode=${r.zjqMode} | hT=${r.hT},aT=${r.aT} | uplift=${r.goalUplift} | boost=${r.bigBallBoost}`);
  console.log(`    触发规则: ${r.triggers}`);
  console.log(`    v3 top3: ${r.v3}`);
  console.log(`    v4 top3: ${r.v4}`);
  console.log(`    → 为什么 v4 反而错了？goalUplift把目标进球抬太高了？`);
  console.log();
}

console.log(`\n## 详细诊断3：两场都错的（需新策略）\n`);
const bothMiss = rows.filter(r => !r.v3Yes && !r.v4Yes);
for (const r of bothMiss) {
  console.log(`  ${r.code} ${r.home}vs${r.away} | h=${r.hc} | 实际:${r.actual} | zjqMode=${r.zjqMode} | 主队:${r.hTier}/${r.hStar} | 客队:${r.aTier}/${r.aStar}`);
  console.log(`    v3: ${r.v3}`);
  console.log(`    v4: ${r.v4}`);
}
console.log(`\n  合计 ${bothMiss.length} 场都不中`);
