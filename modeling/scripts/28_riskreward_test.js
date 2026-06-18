// 28_riskreward_test.js — 验证"大球推高赔，弱弱压1球平局"
// 策略: 根据场景给3个picks分配不同目的
//   BIG_BALL: top强队vs弱队 + |hc|>=2 + 有star → push 5:0/4:1/5:1/6:1等高赔率
//   NORMAL_BALL: 双方势均力敌 → 给平局加权, 让 top3 中有平局
//   WEAK_MATCH: weak/weak 或 weak/defensive → 锁定 1:0/0:1/0:0/1:1 低比分
//
// 重点: 不再以"命中率"为唯一标准, 而是看"期望回报率"(赔率×命中概率)
// 比如 10 场有 2 场中@15 比分, 期望回报 = 10% × $2 × 15 = $3, 是+EV
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
const SCORER_STAR_TEAMS = new Set([
  '法国', '阿根廷', '挪威', '乌拉圭', '葡萄牙', '英格兰', '西班牙', '巴西',
  '荷兰', '德国', '韩国', '日本', '美国', '墨西哥', '埃及', '波兰', '丹麦', '塞尔维亚',
]);
function getTeamTier(team) {
  if (TOP_TIER.includes(team)) return 'top';
  if (SECOND_TIER.includes(team)) return 'second';
  if (DEFENSIVE.includes(team)) return 'defensive';
  if (WEAK_TEAMS.includes(team)) return 'weak';
  return 'unknown';
}
function hasScorerStar(team) { return SCORER_STAR_TEAMS.has(team); }

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
    bf: oddsDoc.odds.bf_latest, zjq: oddsDoc.odds.zjq_latest,
    actualHome: actual.homeScore, actualAway: actual.awayScore,
  });
}
function normalizeScore(s) { return s.split(':').map(p => String(Number(p))).join(':'); }

// 分类比赛类型
function classifyMatch(m) {
  const hc = m.handicap;
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  const homeHasStar = hasScorerStar(m.home), awayHasStar = hasScorerStar(m.away);

  // 大球场景: 大让球 + 强队有射手 OR 双方都有star
  // top vs weak + |hc|>=2 或 top有star
  // 或: 双方都有进球型球星
  const isBigBall =
    (Math.abs(hc) >= 2 && (homeHasStar || awayHasStar || hTier === 'top' || aTier === 'top')) ||
    (homeHasStar && awayHasStar) ||
    ((hTier === 'top' || hTier === 'second') && (aTier === 'weak' || aTier === 'defensive') && homeHasStar) ||
    ((aTier === 'top' || aTier === 'second') && (hTier === 'weak' || hTier === 'defensive') && awayHasStar);

  // 弱弱场景: weak/weak 或 weak/defensive 组合, 且无star
  const isWeakMatch =
    ((hTier === 'weak' || hTier === 'defensive') && (aTier === 'weak' || aTier === 'defensive') && !homeHasStar && !awayHasStar) ||
    (hTier === 'weak' && aTier === 'weak');

  if (isBigBall) return 'BIG_BALL';
  if (isWeakMatch) return 'WEAK_MATCH';
  return 'NORMAL';
}

// 策略1: 大球场景 → 推高赔率大比分(5:0/4:1/5:1/6:1/4:0/3:2等)
// 策略2: 弱弱场景 → 锁定 ≤2球的低比分 0:0/1:0/0:1/1:1
// 策略3: 正常场景 → 按球风 + 平局加权

function pickScoreForStrategy(m, cfgName) {
  const hc = m.handicap;
  const matchType = classifyMatch(m);

  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, home: Number(normalizeScore(k).split(':')[0]), away: Number(normalizeScore(k).split(':')[1]) }));

  // 计算每队实际进球数
  allScores.forEach(s => {
    s.total = s.home + s.away;
    s.absDiff = Math.abs(s.home - s.away);
  });

  let picked = [];
  if (cfgName === 'A_baseline') {
    // 基线: 只按赔率取前3
    picked = allScores.slice().sort((a, b) => a.odds - b.odds).slice(0, 3);
  } else if (cfgName === 'B_zjq_style') {
    // 基线: zjq + 球风加权 (最基本逻辑)
    let zjqMode = null;
    if (m.zjq) {
      const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
      if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
    }
    const dir = hc <= 0 ? 'home' : 'away';
    const hT = dir === 'home' ? 2 : 1;
    const aT = dir === 'home' ? 1 : 2;
    const score = (s) => {
      const d = Math.abs(s.home - hT) + Math.abs(s.away - aT);
      let zjqPen = 0;
      if (zjqMode != null) {
        if (s.total < zjqMode - 1) zjqPen = (zjqMode - 1 - s.total);
        else if (s.total > zjqMode + 2) zjqPen = 0.3 * (s.total - zjqMode - 2);
      }
      return d + zjqPen + Math.log(s.odds) * 0.5;
    };
    picked = allScores.slice().sort((a, b) => score(a) - score(b)).slice(0, 3);
  } else if (cfgName === 'C_risk_reward') {
    // 用户思路: 大球推高赔, 弱弱压1球平局, 正常给平局加权
    if (matchType === 'BIG_BALL') {
      // 大球场景: 优先大比分(≥4球) + 让球方向正确
      const dir = hc <= 0 ? 'home' : 'away';
      const bigScores = allScores.filter(s => {
        if (s.total < 4) return false;
        // 让球方向也要对
        if (dir === 'home' && s.home < s.away) return false;
        if (dir === 'away' && s.away < s.home) return false;
        return true;
      });
      // 选高赔率的: 按赔率降序(高赔率优先)但不能太离谱(>80可能太极端)
      const filtered = bigScores.length >= 3 ? bigScores.filter(s => s.odds <= 80) : allScores.filter(s => s.total >= 3);
      // 3个: 1个超高赔率(20-60), 1个中高(10-20), 1个保守(5-10)
      const superHigh = filtered.filter(s => s.odds >= 20 && s.odds <= 60).sort((a, b) => a.odds - b.odds)[0];
      const midHigh = filtered.filter(s => s.odds >= 10 && s.odds < 20).sort((a, b) => a.odds - b.odds)[0];
      const safe = filtered.filter(s => s.odds < 10).sort((a, b) => a.odds - b.odds)[0];
      const result = [superHigh, midHigh, safe].filter(Boolean);
      // 补齐
      if (result.length < 3) {
        const allSorted = allScores.slice().sort((a, b) => a.odds - b.odds);
        for (const s of allSorted) { if (result.length < 3 && !result.includes(s)) result.push(s); }
      }
      picked = result.slice(0, 3);
    } else if (matchType === 'WEAK_MATCH') {
      // 弱弱场景: 只选 ≤2 球的比分, 按赔率(低的优先)
      // 目标: 0:0/0:1/1:0/1:1/2:0/0:2
      const lowScores = allScores.filter(s => s.total <= 2).sort((a, b) => a.odds - b.odds);
      if (lowScores.length >= 3) picked = lowScores.slice(0, 3);
      else {
        picked = lowScores.concat(allScores.filter(s => s.total === 3 && !lowScores.includes(s)).sort((a, b) => a.odds - b.odds).slice(0, 3 - lowScores.length));
      }
    } else {
      // NORMAL: 平局加权的常规逻辑
      let zjqMode = null;
      if (m.zjq) {
        const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
        if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
      }
      // 平局bonus
      const drawBonus = 2.5;
      const score = (s) => {
        const d = Math.abs(s.home - 1.5) + Math.abs(s.away - 1.5);
        let zjqPen = 0;
        if (zjqMode != null) {
          if (s.total < zjqMode - 1) zjqPen = (zjqMode - 1 - s.total);
          else if (s.total > zjqMode + 2) zjqPen = 0.3 * (s.total - zjqMode - 2);
        }
        const drawPen = (s.home === s.away) ? -drawBonus : 0;
        return d + zjqPen + drawPen + Math.log(s.odds) * 0.5;
      };
      picked = allScores.slice().sort((a, b) => score(a) - score(b)).slice(0, 3);
    }
  } else if (cfgName === 'D_pure_high_ball') {
    // 极端版: 大球场景全部推高赔率(验证思路上限)
    if (matchType === 'BIG_BALL') {
      const dir = hc <= 0 ? 'home' : 'away';
      const bigScores = allScores.filter(s => {
        if (s.total < 5) return false;
        if (dir === 'home' && s.home < s.away) return false;
        if (dir === 'away' && s.away < s.home) return false;
        return true;
      }).sort((a, b) => a.odds - b.odds);
      const picked_big = bigScores.length >= 3 ? bigScores.slice(0, 3) : bigScores.concat(allScores.filter(s => s.total >= 4 && !bigScores.includes(s)).sort((a, b) => a.odds - b.odds)).slice(0, 3);
      picked = picked_big;
    } else if (matchType === 'WEAK_MATCH') {
      picked = allScores.filter(s => s.total <= 2).sort((a, b) => a.odds - b.odds).slice(0, 3);
      if (picked.length < 3) picked = picked.concat(allScores.filter(s => s.total === 3).sort((a, b) => a.odds - b.odds)).slice(0, 3);
    } else {
      // normal: 取赔率前3 + 一个平局
      const sortedByOdds = allScores.slice().sort((a, b) => a.odds - b.odds);
      picked = sortedByOdds.slice(0, 3);
    }
  }

  return { picks: picked, matchType };
}

// ========== 跑测试 ==========
const cfgs = ['A_baseline', 'B_zjq_style', 'C_risk_reward', 'D_pure_high_ball'];

console.log(`\n## 命中率对比 (top3命中)\n`);
console.log(`| 配置 | 总命中 | 命中率 | 大球场命中/总 | 弱弱场命中/总 | 正常场命中/总 | 最高赔率命中 |`);
console.log(`|------|--------|--------|--------------|--------------|--------------|-------------|`);

const cfgResults = {};
for (const cfg of cfgs) {
  const bigBallMatches = matches_.filter(m => classifyMatch(m) === 'BIG_BALL');
  const weakMatches = matches_.filter(m => classifyMatch(m) === 'WEAK_MATCH');
  const normalMatches = matches_.filter(m => classifyMatch(m) === 'NORMAL');
  const countHit = (list) => list.filter(m => {
    const r = pickScoreForStrategy(m, cfg);
    const actual = `${m.actualHome}:${m.actualAway}`;
    return r.picks.some(p => p.score === actual);
  }).length;
  const totalHit = countHit(matches_);
  const bigHit = countHit(bigBallMatches);
  const weakHit = countHit(weakMatches);
  const normalHit = countHit(normalMatches);

  // 计算命中的最高赔率比分
  let maxOddsHit = { score: '-', odds: 0, match: '-' };
  for (const m of matches_) {
    const r = pickScoreForStrategy(m, cfg);
    const actual = `${m.actualHome}:${m.actualAway}`;
    const hitPick = r.picks.find(p => p.score === actual);
    if (hitPick && hitPick.odds > maxOddsHit.odds) maxOddsHit = { score: actual, odds: hitPick.odds, match: `${m.home}vs${m.away}` };
  }

  cfgResults[cfg] = { totalHit, bigHit, weakHit, normalHit, maxOddsHit };
  console.log(`| ${cfg} | ${totalHit}/${matches_.length} | ${(totalHit/matches_.length*100).toFixed(0)}% | ${bigHit}/${bigBallMatches.length} | ${weakHit}/${weakMatches.length} | ${normalHit}/${normalMatches.length} | ${maxOddsHit.score}@${maxOddsHit.odds} |`);
}

// 详细: 用户的 C_risk_reward 每场结果
console.log(`\n## C_risk_reward 每场详情 —— 你的思路实战\n`);
console.log(`| 场次 | 对阵 | 类型 | 实际 | zjq | picks | 命中? | 命中赔率 | 期望赔率 |`);
let totalOdds = 0;
let hitCount = 0;
for (const m of matches_) {
  const r = pickScoreForStrategy(m, 'C_risk_reward');
  const actual = `${m.actualHome}:${m.actualAway}`;
  const hitPick = r.picks.find(p => p.score === actual);
  const isHit = !!hitPick;
  let zjqMode = '-';
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }
  if (isHit) { totalOdds += hitPick.odds; hitCount++; }
  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${r.matchType} | ${actual}(${m.actualHome+m.actualAway}球) | ${zjqMode} | ${r.picks.map(p=>`${p.score}@${p.odds}`).join(' ')} | ${isHit ? '✅' : '❌'} | ${hitPick ? '@'+hitPick.odds : '-'} |`);
}

console.log(`\n## C_risk_reward 命中率+赔率汇总\n`);
console.log(`  命中 ${hitCount}/${matches_.length} = ${(hitCount/matches_.length*100).toFixed(0)}%`);
console.log(`  命中的平均赔率 = ${(totalOdds/Math.max(1, hitCount)).toFixed(2)}`);
console.log(`  期望回报率 = 每场投入$3, 命中一场收入$odds → 总收入=$${(totalOdds).toFixed(2)}, 总投入=$${matches_.length * 3}`);
console.log(`  净收益 = $${(totalOdds - matches_ * 3).toFixed(2)} (ROI = ${((totalOdds / (matches_.length * 3) - 1) * 100).toFixed(0)}%)`);

// 比较: 你的思路 vs 纯赔率top3 的"高赔率命中"次数
console.log(`\n## 高赔率命中对比 (≥8赔率的算"高赔率", ≥15算"血赚")\n`);
for (const cfg of cfgs) {
  let highHits = 0, monsterHits = 0;
  for (const m of matches_) {
    const r = pickScoreForStrategy(m, cfg);
    const actual = `${m.actualHome}:${m.actualAway}`;
    const hitPick = r.picks.find(p => p.score === actual);
    if (hitPick && hitPick.odds >= 8) highHits++;
    if (hitPick && hitPick.odds >= 15) monsterHits++;
  }
  console.log(`  ${cfg}: ≥8命中=${highHits}, ≥15命中=${monsterHits}`);
}

// 分析: 大球场景中, 哪些比赛真的出现了高赔率比分, 你的策略能否捕捉?
console.log(`\n## 大球场景深入分析 —— "推高赔" 哪些比赛真的能中?\n`);
for (const m of matches_) {
  const type = classifyMatch(m);
  if (type !== 'BIG_BALL') continue;
  const actual = `${m.actualHome}:${m.actualAway}`;
  const total = m.actualHome + m.actualAway;
  const allSorted = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v }))
    .sort((a, b) => a.odds - b.odds);
  const rank = allSorted.findIndex(s => s.score === actual) + 1;
  const r = pickScoreForStrategy(m, 'C_risk_reward');
  const hitPick = r.picks.find(p => p.score === actual);
  console.log(`  ${m.code} ${m.home}vs${m.away} 实际${actual}(${total}球) hc=${m.handicap}`);
  console.log(`    庄家top5: ${allSorted.slice(0, 5).map(s => `${s.score}@${s.odds}`).join(', ')}`);
  console.log(`    实际比分排名: #${rank} @${allSorted[rank-1]?.odds}`);
  console.log(`    你的picks: ${r.picks.map(p=>`${p.score}@${p.odds}`).join(', ')} ${hitPick ? '✅' : '❌'}`);
}

console.log(`\n## 弱弱场景分析 —— "压1球平局" 效果\n`);
for (const m of matches_) {
  const type = classifyMatch(m);
  if (type !== 'WEAK_MATCH') continue;
  const actual = `${m.actualHome}:${m.actualAway}`;
  const total = m.actualHome + m.actualAway;
  const r = pickScoreForStrategy(m, 'C_risk_reward');
  const hitPick = r.picks.find(p => p.score === actual);
  const allSorted = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v }))
    .sort((a, b) => a.odds - b.odds);
  console.log(`  ${m.code} ${m.home}vs${m.away} 实际${actual}(${total}球)`);
  console.log(`    庄家top5: ${allSorted.slice(0, 5).map(s => `${s.score}@${s.odds}`).join(', ')}`);
  console.log(`    你的picks: ${r.picks.map(p=>`${p.score}@${p.odds}`).join(', ')} ${hitPick ? '✅' : '❌'}`);
}
