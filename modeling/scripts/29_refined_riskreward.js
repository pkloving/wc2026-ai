// 29_refined_riskreward.js — 收窄版验证
// 大球判定收紧: 只保留 |hc|>=2 + 让球方有星 OR 双方都有星
// 弱弱: weak/weak 或 weak/defensive 且无星
// 正常: 其他全部, 走"平局加权+低比分"
//
// 额外验证: 既然"弱对弱也会爆冷单球"(1:0/0:1这种),
// 试试弱对弱不走"压1球"而是走"庄家top3中的2球以内比分"
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
function normalizeScore(s) { return s.split(':').map(p => String(Number(p))).join(':'); }

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

// ===== 新分类 (收窄版) =====
function classifyMatchV2(m) {
  const hc = m.handicap;
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  const homeHasStar = hasScorerStar(m.home), awayHasStar = hasScorerStar(m.away);

  // 大球(收窄): 只保留大让球盘 |hc|>=2 + 让球方有星, 或双方都有星
  const bigHandicap = Math.abs(hc) >= 2;
  let bigBallReason = '';
  if (bigHandicap) {
    const favHasStar = hc < 0 ? homeHasStar : awayHasStar;
    if (favHasStar) bigBallReason = '大让球+让球方有星';
  }
  if (homeHasStar && awayHasStar) bigBallReason = bigBallReason ? (bigBallReason + '/双方有星') : '双方有星';

  // 弱弱: weak/weak 或 weak/defensive, 无星
  const isWeak = ((hTier === 'weak' || hTier === 'defensive') && (aTier === 'weak' || aTier === 'defensive') && !homeHasStar && !awayHasStar);

  if (bigBallReason) return { type: 'BIG_BALL', reason: bigBallReason };
  if (isWeak) return { type: 'WEAK_MATCH', reason: '弱/防组合无星' };
  return { type: 'NORMAL', reason: '中强对话或均衡' };
}

// ===== pick策略 =====
// 每个配置是一个完整的3 picks选择逻辑
function runStrategy(m, strategyName) {
  const hc = m.handicap;
  const info = classifyMatchV2(m);
  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => {
      const s = normalizeScore(k);
      const [h, a] = s.split(':').map(Number);
      return { score: s, odds: v, home: h, away: a, total: h + a, absDiff: Math.abs(h - a) };
    });

  // 读取 zjq
  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  // 让球方向过滤
  const dir = hc <= 0 ? 'home' : 'away';
  const dirMatch = (s) => {
    if (dir === 'home') return s.home >= s.away;
    return s.away >= s.home;
  };

  if (strategyName === 'A_pure_odds') {
    // 纯赔率 top3 (基准)
    return allScores.slice().sort((a, b) => a.odds - b.odds).slice(0, 3);
  }

  if (strategyName === 'B_baseline_old') {
    // 旧版: zjq±1 + 球风加权(无大小球分类)
    const hT = dir === 'home' ? 2 : 1;
    const aT = dir === 'home' ? 1 : 2;
    return allScores.slice().sort((x, y) => {
      const xScore = Math.abs(x.home - hT) + Math.abs(x.away - aT) + (zjqMode != null ? (x.total < zjqMode - 1 ? (zjqMode - 1 - x.total) : (x.total > zjqMode + 2 ? 0.3 * (x.total - zjqMode - 2) : 0)) : 0) + Math.log(x.odds) * 0.3;
      const yScore = Math.abs(y.home - hT) + Math.abs(y.away - aT) + (zjqMode != null ? (y.total < zjqMode - 1 ? (zjqMode - 1 - y.total) : (y.total > zjqMode + 2 ? 0.3 * (y.total - zjqMode - 2) : 0)) : 0) + Math.log(y.odds) * 0.3;
      return xScore - yScore;
    }).slice(0, 3);
  }

  if (strategyName === 'C_refined_v2') {
    // 你的思路(收窄版): 按场景分策略
    if (info.type === 'BIG_BALL') {
      // 大球: 推高赔率大比分
      // 1个保守(3:0/4:0/3:1), 1个中高(5:0/4:1/3:2@10-20), 1个超高(5:1/6:0@20-60)
      const dirFiltered = allScores.filter(s => dirMatch(s));
      const bigPool = dirFiltered.filter(s => s.total >= 4).sort((a, b) => a.odds - b.odds);
      const safe = bigPool.filter(s => s.odds < 12)[0] || bigPool[0];
      const midHigh = bigPool.filter(s => s.odds >= 12 && s.odds <= 25)[0] || bigPool[Math.floor(bigPool.length/2)] || bigPool[bigPool.length - 1];
      const high = bigPool.filter(s => s.odds >= 25 && s.odds <= 80)[0] || bigPool[bigPool.length - 1] || midHigh;
      const picks = [safe, midHigh, high].filter(Boolean);
      // 去重 + 补够3
      const seen = new Set();
      const result = [];
      for (const p of picks) if (p && !seen.has(p.score)) { seen.add(p.score); result.push(p); }
      const allSorted = allScores.slice().sort((a, b) => a.odds - b.odds);
      for (const s of allSorted) { if (result.length >= 3) break; if (!seen.has(s.score)) { seen.add(s.score); result.push(s); } }
      return result.slice(0, 3);
    } else if (info.type === 'WEAK_MATCH') {
      // 弱弱: ≤2球的比分, 按赔率排序
      const lowPool = allScores.filter(s => s.total <= 2).sort((a, b) => a.odds - b.odds);
      if (lowPool.length >= 3) return lowPool.slice(0, 3);
      // 补: 3球比分
      const extra = allScores.filter(s => s.total === 3 && !lowPool.includes(s)).sort((a, b) => a.odds - b.odds);
      return lowPool.concat(extra).slice(0, 3);
    } else {
      // NORMAL: 平局加权
      // 找最低赔率的平局 + 一个2:2 + 一个让球方向小胜
      const drawScores = allScores.filter(s => s.home === s.away).sort((a, b) => a.odds - b.odds);
      const dirWinScores = allScores.filter(s => dirMatch(s) && s.total <= 3).sort((a, b) => a.odds - b.odds);
      const picks = [];
      if (drawScores[0]) picks.push(drawScores[0]);  // 低赔率平局 1:1
      if (drawScores[1]) picks.push(drawScores[1]);  // 2:2
      if (dirWinScores[0]) picks.push(dirWinScores[0]); // 小胜 2:0/2:1
      if (picks.length < 3) {
        const allSorted = allScores.slice().sort((a, b) => a.odds - b.odds);
        for (const s of allSorted) { if (!picks.includes(s)) picks.push(s); if (picks.length >= 3) break; }
      }
      return picks.slice(0, 3);
    }
  }

  if (strategyName === 'D_extreme_split') {
    // 更极端: 每个场景把3 picks投向完全不同的"爆冷区间"
    // 大球: 全部投4-7球
    // 弱弱: 全部投0-2球
    // 正常: 1平+2小胜
    if (info.type === 'BIG_BALL') {
      const bigPool = allScores.filter(s => s.total >= 4 && dirMatch(s)).sort((a, b) => a.odds - b.odds);
      if (bigPool.length >= 3) return bigPool.slice(0, 3);
      return bigPool.concat(allScores.filter(s => !bigPool.includes(s)).sort((a, b) => a.odds - b.odds)).slice(0, 3);
    } else if (info.type === 'WEAK_MATCH') {
      const lowPool = allScores.filter(s => s.total <= 2).sort((a, b) => a.odds - b.odds);
      if (lowPool.length >= 3) return lowPool.slice(0, 3);
      return lowPool.concat(allScores.filter(s => s.total === 3 && !lowPool.includes(s)).sort((a, b) => a.odds - b.odds)).slice(0, 3);
    } else {
      // 正常: 平局权重大
      const drawPool = allScores.filter(s => s.home === s.away).sort((a, b) => a.odds - b.odds);
      const nearDrawPool = allScores.filter(s => Math.abs(s.home - s.away) === 1 && s.total <= 3).sort((a, b) => a.odds - b.odds);
      const picks = [];
      for (const d of drawPool) if (picks.length < 2) picks.push(d);
      for (const n of nearDrawPool) if (picks.length < 3) picks.push(n);
      const allSorted = allScores.slice().sort((a, b) => a.odds - b.odds);
      for (const s of allSorted) { if (!picks.includes(s)) picks.push(s); if (picks.length >= 3) break; }
      return picks.slice(0, 3);
    }
  }

  if (strategyName === 'E_goal_range_only') {
    // 只按进球数选: 根据类型锁定进球范围, 在范围内取赔率最低的3个
    let minT = 0, maxT = 10;
    if (info.type === 'BIG_BALL') { minT = 4; maxT = 8; }
    else if (info.type === 'WEAK_MATCH') { minT = 0; maxT = 2; }
    else { minT = 1; maxT = 3; }
    const pool = allScores.filter(s => s.total >= minT && s.total <= maxT).sort((a, b) => a.odds - b.odds);
    return pool.slice(0, 3);
  }

  return [];
}

// ========== 跑全部 ==========
const strategies = ['A_pure_odds', 'B_baseline_old', 'C_refined_v2', 'D_extreme_split', 'E_goal_range_only'];

// 汇总
console.log(`\n## 策略命中率对比\n`);
console.log(`| 策略 | 总命中 | 命中率 | 大球 | 弱弱 | 正常 | 命中≥8赔率数 | 命中最高赔率 |`);
console.log(`|------|--------|--------|------|------|------|-------------|------------|`);

const bigBallList = matches_.filter(m => classifyMatchV2(m).type === 'BIG_BALL');
const weakList = matches_.filter(m => classifyMatchV2(m).type === 'WEAK_MATCH');
const normalList = matches_.filter(m => classifyMatchV2(m).type === 'NORMAL');

const hitIn = (list, cfg) => list.filter(m => {
  const picks = runStrategy(m, cfg);
  const actual = `${m.actualHome}:${m.actualAway}`;
  return picks.some(p => p.score === actual);
}).length;

for (const cfg of strategies) {
  const total = hitIn(matches_, cfg);
  const big = hitIn(bigBallList, cfg);
  const weak = hitIn(weakList, cfg);
  const normal = hitIn(normalList, cfg);

  // 命中的最高赔率比分
  let maxOddsHit = { score: '-', odds: 0, match: '-', type: '-' };
  let highOddsCount = 0;
  for (const m of matches_) {
    const picks = runStrategy(m, cfg);
    const actual = `${m.actualHome}:${m.actualAway}`;
    const hitPick = picks.find(p => p.score === actual);
    if (hitPick) {
      if (hitPick.odds > maxOddsHit.odds) maxOddsHit = { score: actual, odds: hitPick.odds, match: `${m.code} ${m.home}vs${m.away}`, type: classifyMatchV2(m).type };
      if (hitPick.odds >= 8) highOddsCount++;
    }
  }

  console.log(`| ${cfg} | ${total}/${matches_.length} | ${(total/matches_.length*100).toFixed(0)}% | ${big}/${bigBallList.length} | ${weak}/${weakList.length} | ${normal}/${normalList.length} | ${highOddsCount} | ${maxOddsHit.score}@${maxOddsHit.odds} |`);
}

// 详细: 最佳策略的每场结果
console.log(`\n## 各策略的最佳高赔率命中 —— 看"血赚"能力\n`);
for (const cfg of strategies) {
  const hits = [];
  for (const m of matches_) {
    const picks = runStrategy(m, cfg);
    const actual = `${m.actualHome}:${m.actualAway}`;
    const hitPick = picks.find(p => p.score === actual);
    if (hitPick) hits.push({ m, hit: hitPick, type: classifyMatchV2(m).type });
  }
  const highOddsHits = hits.filter(h => h.hit.odds >= 8);
  console.log(`  ${cfg} (${hits.length}命中): ≥8=${highOddsHits.length}, 高赔率命中: ${highOddsHits.map(h => `${h.m.home}vs${h.m.away} ${h.hit.score}@${h.hit.odds}`).join(', ') || '-'}`);
}

// 分类后的每场结果详情(C_refined_v2)
console.log(`\n## C_refined_v2 每场详情 —— 你的收窄版策略\n`);
console.log(`| 场次 | 对阵 | 类型 | hc | 实际 | zjq | picks | 命中? | 赔率 |`);
let c_totalOdds = 0, c_hits = 0;
for (const m of matches_) {
  const picks = runStrategy(m, 'C_refined_v2');
  const info = classifyMatchV2(m);
  const actual = `${m.actualHome}:${m.actualAway}`;
  const hitPick = picks.find(p => p.score === actual);
  let zjqMode = '-';
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }
  if (hitPick) { c_totalOdds += hitPick.odds; c_hits++; }
  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${info.type} | ${m.handicap} | ${actual}(${m.actualHome+m.actualAway}球) | ${zjqMode} | ${picks.map(p => `${p.score}@${p.odds}`).join(' ')} | ${hitPick ? '✅' : '❌'} | ${hitPick ? '@'+hitPick.odds : '-'} |`);
}
console.log(`\n  C_refined_v2 汇总: ${c_hits}/${matches_.length} = ${(c_hits/matches_.length*100).toFixed(0)}%`);
console.log(`  命中平均赔率 = ${(c_totalOdds/Math.max(1, c_hits)).toFixed(2)}`);
console.log(`  ROI = (${c_totalOdds.toFixed(2)} - ${matches_.length * 3}) / ${matches_.length * 3} = ${((c_totalOdds / (matches_.length * 3) - 1) * 100).toFixed(0)}%`);

// 关键洞察: 列出每种分类下, 实际比分的"庄家赔率排名"
// 看"大球"场景下, 庄家自己给4+球的比分赔率多高, 是否有"价值空间"
console.log(`\n## 各场景的"庄家赔率价值"分析\n`);
for (const type of ['BIG_BALL', 'WEAK_MATCH', 'NORMAL']) {
  console.log(`  ### ${type} 场`);
  const list = matches_.filter(m => classifyMatchV2(m).type === type);
  for (const m of list) {
    const actual = `${m.actualHome}:${m.actualAway}`;
    const allSorted = Object.entries(m.bf)
      .filter(([k, v]) => v > 1 && !/其它$/.test(k))
      .map(([k, v]) => ({ score: normalizeScore(k), odds: v }))
      .sort((a, b) => a.odds - b.odds);
    const rank = allSorted.findIndex(s => s.score === actual) + 1;
    const oddsAtRank = allSorted[rank - 1]?.odds || 0;
    console.log(`    ${m.code} ${m.home}vs${m.away} ${actual} → 庄家排名#${rank} @${oddsAtRank}`);
  }
  console.log();
}

// 最后: 各策略 "top3的覆盖范围" 分析
// 你的策略 top3 的总赔率乘积越低, 意味着选的都是低赔率比分 → 命中但不赚
// 你的策略 top3 的赔率差异越大, 说明有"保守+爆冷"双轨 → 可能是好事
console.log(`\n## 各策略top3的赔率区间分析\n`);
for (const cfg of strategies) {
  let avgMin = 0, avgMax = 0, avgSum = 0;
  for (const m of matches_) {
    const picks = runStrategy(m, cfg);
    if (picks.length > 0) {
      const oddsList = picks.map(p => p.odds);
      avgMin += Math.min(...oddsList);
      avgMax += Math.max(...oddsList);
      avgSum += oddsList.reduce((a, b) => a + b, 0);
    }
  }
  const n = matches_.length;
  console.log(`  ${cfg}: 最低赔率avg=${(avgMin/n).toFixed(2)}, 最高赔率avg=${(avgMax/n).toFixed(2)}, sum=${(avgSum/n).toFixed(2)}`);
}
