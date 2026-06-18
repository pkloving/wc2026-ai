// 30_roi_optimized.js — 纯 ROI 导向策略
// 核心: 每个场景3 picks都投向"赔率被高估"的区间
//   BIG_BALL: 4-7球的高赔率比分(已经验证有效)
//   NORMAL: 平局的高赔率比分(已验证)
//   WEAK_MATCH: 反价值! 弱对弱防守都差, 反而容易2-3球, 选15-35赔率的 2:1/2:2/3:1 这类
//
// 关键指标: ROI = (命中赔率总和 - 总投入) / 总投入
// 不看命中率, 看"中1场赚3场"的赔率优势
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

// ========= 多策略对比 =========
// 每个策略: 给一场比赛返回3个picks
const strategies = {};

// A: 纯赔率top3 (基准)
strategies['A_pure_odds'] = (m) => {
  const all = Object.entries(m.bf).filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, home: Number(normalizeScore(k).split(':')[0]), away: Number(normalizeScore(k).split(':')[1]) }))
    .sort((a, b) => a.odds - b.odds);
  return all.slice(0, 3);
};

// B: 你的旧版(C_refined_v2) - 大球+弱弱保守+正常平局
strategies['B_refined_v2'] = (m) => {
  const type = classifyMatch(m);
  const all = Object.entries(m.bf).filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, home: Number(normalizeScore(k).split(':')[0]), away: Number(normalizeScore(k).split(':')[1]) }));
  all.forEach(s => { s.total = s.home + s.away; });
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;

  if (type === 'BIG_BALL') {
    const big = all.filter(s => s.total >= 4 && dirMatch(s)).sort((a, b) => a.odds - b.odds);
    const safe = big.filter(s => s.odds < 12)[0] || big[0];
    const midHigh = big.filter(s => s.odds >= 12 && s.odds <= 25)[0] || big[Math.floor(big.length / 2)] || big[big.length - 1];
    const high = big.filter(s => s.odds >= 25 && s.odds <= 80)[0] || big[big.length - 1] || midHigh;
    const picks = [safe, midHigh, high].filter(Boolean);
    const seen = new Set();
    const result = [];
    for (const p of picks) if (p && !seen.has(p.score)) { seen.add(p.score); result.push(p); }
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) { if (result.length >= 3) break; if (!seen.has(s.score)) { seen.add(s.score); result.push(s); } }
    return result.slice(0, 3);
  } else if (type === 'WEAK_MATCH') {
    const low = all.filter(s => s.total <= 2).sort((a, b) => a.odds - b.odds);
    if (low.length >= 3) return low.slice(0, 3);
    const extra = all.filter(s => s.total === 3).sort((a, b) => a.odds - b.odds);
    return low.concat(extra).slice(0, 3);
  } else {
    const draws = all.filter(s => s.home === s.away).sort((a, b) => a.odds - b.odds);
    const dirWin = all.filter(s => dirMatch(s) && s.total <= 3).sort((a, b) => a.odds - b.odds);
    const picks = [];
    if (draws[0]) picks.push(draws[0]);
    if (draws[1]) picks.push(draws[1]);
    if (dirWin[0]) picks.push(draws[0]);
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) { if (!picks.includes(s)) picks.push(s); if (picks.length >= 3) break; }
    return picks.slice(0, 3);
  }
};

// C: ROI 优化版 - 大球保持, 弱弱改为"反价值高赔率", 正常场平局加权
// 反价值定义: 弱对弱中, 总进球2-4球范围内赔率最高的几个比分(庄家低估了进球)
strategies['C_roi_optimized'] = (m) => {
  const type = classifyMatch(m);
  const all = Object.entries(m.bf).filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, home: Number(normalizeScore(k).split(':')[0]), away: Number(normalizeScore(k).split(':')[1]) }));
  all.forEach(s => { s.total = s.home + s.away; });
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;

  if (type === 'BIG_BALL') {
    const big = all.filter(s => s.total >= 4 && dirMatch(s)).sort((a, b) => a.odds - b.odds);
    const safe = big.filter(s => s.odds < 12)[0] || big[0];
    const midHigh = big.filter(s => s.odds >= 12 && s.odds <= 25)[0] || big[Math.floor(big.length / 2)] || big[big.length - 1];
    const high = big.filter(s => s.odds >= 25 && s.odds <= 80)[0] || big[big.length - 1] || midHigh;
    const picks = [safe, midHigh, high].filter(Boolean);
    const seen = new Set();
    const result = [];
    for (const p of picks) if (p && !seen.has(p.score)) { seen.add(p.score); result.push(p); }
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) { if (result.length >= 3) break; if (!seen.has(s.score)) { seen.add(s.score); result.push(s); } }
    return result.slice(0, 3);
  } else if (type === 'WEAK_MATCH') {
    // 反价值: 弱对弱防守差, 实际进球往往比庄家预期多
    // 选 2-4球中赔率最高的比分(10-35区间)
    const antiValue = all.filter(s => s.total >= 2 && s.total <= 4).sort((a, b) => b.odds - a.odds);
    // 在赔率 10-40 的"反价值带"内选3个
    const sweetSpot = antiValue.filter(s => s.odds >= 10 && s.odds <= 60).slice(0, 3);
    if (sweetSpot.length >= 3) return sweetSpot;
    // 补: 加一些中等赔率(5-10)的比分做"底座"
    const midOdds = all.filter(s => s.total >= 1 && s.total <= 3 && !sweetSpot.includes(s)).sort((a, b) => a.odds - b.odds);
    return sweetSpot.concat(midOdds).slice(0, 3);
  } else {
    // NORMAL: 平局加权, 找高赔率平局
    const draws = all.filter(s => s.home === s.away).sort((a, b) => a.odds - b.odds);
    // 选 1 个低赔率平局(保底) + 1 个中赔率平局 + 1 个让球方小胜
    const picks = [];
    if (draws[0]) picks.push(draws[0]);    // 1:1 或 0:0 保底
    if (draws[1] && draws[1].odds < 20) picks.push(draws[1]);  // 2:2 中赔率
    const dirWin = all.filter(s => dirMatch(s) && s.total <= 4).sort((a, b) => a.odds - b.odds);
    const dirWinMid = dirWin.find(s => s.odds >= 5 && s.odds <= 15);
    if (dirWinMid) picks.push(dirWinMid);
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) { if (!picks.includes(s)) picks.push(s); if (picks.length >= 3) break; }
    return picks.slice(0, 3);
  }
};

// D: 极端反价值版 - 所有场景都投向赔率10-40区间
// 目标: 中1场赚3场以上
strategies['D_extreme_anti_value'] = (m) => {
  const type = classifyMatch(m);
  const all = Object.entries(m.bf).filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, home: Number(normalizeScore(k).split(':')[0]), away: Number(normalizeScore(k).split(':')[1]) }));
  all.forEach(s => { s.total = s.home + s.away; });
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;

  if (type === 'BIG_BALL') {
    // 全投4-7球, 赔率15-60
    const big = all.filter(s => s.total >= 4 && dirMatch(s) && s.odds >= 15 && s.odds <= 80).sort((a, b) => a.odds - b.odds);
    if (big.length >= 3) return big.slice(0, 3);
    // 补: 更低赔率的大比分
    const lowerBig = all.filter(s => s.total >= 4 && dirMatch(s)).sort((a, b) => a.odds - b.odds);
    return lowerBig.slice(0, 3);
  } else if (type === 'WEAK_MATCH') {
    // 弱对弱: 只投 10-40 赔率的比分(不管进球数, 只要赔率在这个区间)
    // 核心: 弱对弱的"10-40赔率比分"是庄家严重低估的区域
    const sweetSpot = all.filter(s => s.odds >= 10 && s.odds <= 50).sort((a, b) => a.odds - b.odds);
    if (sweetSpot.length >= 3) return sweetSpot.slice(0, 3);
    return sweetSpot.concat(all.slice().sort((a, b) => a.odds - b.odds)).slice(0, 3);
  } else {
    // NORMAL: 平局高赔率 + 高赔率小胜
    const draws = all.filter(s => s.home === s.away && s.odds >= 8 && s.odds <= 25).sort((a, b) => a.odds - b.odds);
    const dirWinHigh = all.filter(s => dirMatch(s) && s.odds >= 8 && s.odds <= 20 && s.total <= 4).sort((a, b) => a.odds - b.odds);
    const picks = [];
    for (const d of draws) if (picks.length < 2) picks.push(d);
    for (const d of dirWinHigh) if (picks.length < 3) picks.push(d);
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) { if (!picks.includes(s)) picks.push(s); if (picks.length >= 3) break; }
    return picks.slice(0, 3);
  }
};

// E: 混合智能 - 基于 zjq 判断"庄家是否低估"
// 如果 zjq ≤ 2 但双方都不是强队 → 庄家低估进球, 反价值
// 如果 zjq ≥ 4 但双方都是弱队 → 庄家高估进球, 反价值
strategies['E_zjq_anti_value'] = (m) => {
  const type = classifyMatch(m);
  const all = Object.entries(m.bf).filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, home: Number(normalizeScore(k).split(':')[0]), away: Number(normalizeScore(k).split(':')[1]) }));
  all.forEach(s => { s.total = s.home + s.away; });
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;

  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  if (type === 'BIG_BALL') {
    const big = all.filter(s => s.total >= 4 && dirMatch(s)).sort((a, b) => a.odds - b.odds);
    const safe = big.filter(s => s.odds < 12)[0] || big[0];
    const midHigh = big.filter(s => s.odds >= 12 && s.odds <= 25)[0] || big[Math.floor(big.length / 2)] || big[big.length - 1];
    const high = big.filter(s => s.odds >= 25 && s.odds <= 80)[0] || big[big.length - 1] || midHigh;
    const picks = [safe, midHigh, high].filter(Boolean);
    const seen = new Set();
    const result = [];
    for (const p of picks) if (p && !seen.has(p.score)) { seen.add(p.score); result.push(p); }
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) { if (result.length >= 3) break; if (!seen.has(s.score)) { seen.add(s.score); result.push(s); } }
    return result.slice(0, 3);
  } else if (type === 'WEAK_MATCH') {
    // zjq 辅助: 如果 zjq <= 2, 反价值就是3-4球的比分
    // 如果 zjq >= 3, 反价值就是1-2球的比分
    let antiRange;
    if (zjqMode != null && zjqMode <= 2) antiRange = [3, 4];
    else if (zjqMode != null && zjqMode >= 3) antiRange = [1, 2];
    else antiRange = [2, 3]; // 默认2-3球
    const anti = all.filter(s => s.total >= antiRange[0] && s.total <= antiRange[1]).sort((a, b) => b.odds - a.odds);
    const sweet = anti.filter(s => s.odds >= 8 && s.odds <= 40).slice(0, 3);
    if (sweet.length >= 3) return sweet;
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    const result = sweet.slice();
    for (const s of sorted) { if (!result.includes(s)) result.push(s); if (result.length >= 3) break; }
    return result.slice(0, 3);
  } else {
    // NORMAL: 平局加权
    const draws = all.filter(s => s.home === s.away).sort((a, b) => a.odds - b.odds);
    const picks = [];
    if (draws[0]) picks.push(draws[0]);
    if (draws[1] && draws[1].odds < 20) picks.push(draws[1]);
    const dirWin = all.filter(s => dirMatch(s) && s.total <= 4).sort((a, b) => a.odds - b.odds);
    const dirWinMid = dirWin.find(s => s.odds >= 5 && s.odds <= 15);
    if (dirWinMid && !picks.includes(dirWinMid)) picks.push(dirWinMid);
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) { if (!picks.includes(s)) picks.push(s); if (picks.length >= 3) break; }
    return picks.slice(0, 3);
  }
};

// ========= 评估框架 =========
function evaluate(strategyName) {
  const strategy = strategies[strategyName];
  const results = [];
  for (const m of matches_) {
    const picks = strategy(m);
    const actual = `${m.actualHome}:${m.actualAway}`;
    const hitPick = picks.find(p => p.score === actual);
    results.push({
      code: m.code, match: `${m.home}vs${m.away}`, type: classifyMatch(m),
      actual, actualTotal: m.actualHome + m.actualAway,
      picks: picks.map(p => `${p.score}@${p.odds}`).join(' '),
      pickOdds: picks.map(p => p.odds),
      hit: !!hitPick, hitOdds: hitPick ? hitPick.odds : 0,
    });
  }
  const hits = results.filter(r => r.hit);
  const totalOdds = hits.reduce((sum, r) => sum + r.hitOdds, 0);
  const totalCost = matches_.length * 3; // 每场3 picks, 各$1
  const roi = (totalOdds - totalCost) / totalCost;
  const highOddsHits = hits.filter(r => r.hitOdds >= 8).length;
  const maxHit = hits.reduce((max, r) => r.hitOdds > max.hitOdds ? r : max, hits[0] || { hitOdds: 0, match: '-', actual: '-' });

  // 按分类
  const byType = {};
  for (const t of ['BIG_BALL', 'WEAK_MATCH', 'NORMAL']) {
    const list = results.filter(r => r.type === t);
    const typeHits = list.filter(r => r.hit);
    byType[t] = {
      total: list.length,
      hits: typeHits.length,
      hitRate: typeHits.length / list.length,
      avgOdds: typeHits.length ? typeHits.reduce((s, r) => s + r.hitOdds, 0) / typeHits.length : 0,
    };
  }

  return {
    name: strategyName, hits: hits.length, total: matches_.length,
    hitRate: hits.length / matches_.length,
    avgHitOdds: hits.length ? totalOdds / hits.length : 0,
    totalOdds, totalCost, roi,
    highOddsHits, maxHit,
    byType,
    results,
  };
}

// ========= 运行所有策略 =========
const results = {};
for (const name of Object.keys(strategies)) results[name] = evaluate(name);

// 汇总表
console.log(`\n## ROI 对比表\n`);
console.log(`| 策略 | 命中 | 命中率 | 命中≥8赔率 | 平均赔率 | 总赔率 | 投入 | ROI |`);
console.log(`|------|------|--------|------------|---------|--------|------|-----|`);
for (const name of Object.keys(strategies)) {
  const r = results[name];
  const roiColor = r.roi > 0 ? '+' : '';
  console.log(`| ${name} | ${r.hits}/${r.total} | ${(r.hitRate*100).toFixed(0)}% | ${r.highOddsHits} | ${r.avgHitOdds.toFixed(2)} | ${r.totalOdds.toFixed(2)} | ${r.totalCost} | ${roiColor}${(r.roi*100).toFixed(0)}% |`);
}

// 详细: 最佳策略的每场结果
console.log(`\n## 各策略按场景的命中率和赔率\n`);
for (const name of Object.keys(strategies)) {
  const r = results[name];
  console.log(`  ${name}:`);
  for (const t of Object.keys(r.byType)) {
    const bt = r.byType[t];
    console.log(`    ${t}: ${bt.hits}/${bt.total} (${(bt.hitRate*100).toFixed(0)}%), 命中平均赔率=${bt.avgOdds.toFixed(2)}`);
  }
}

// 最高ROI策略的每场结果
let bestROI = null;
for (const name of Object.keys(strategies)) {
  if (!bestROI || results[name].roi > bestROI.roi) bestROI = results[name];
}
console.log(`\n## 最佳ROI策略: ${bestROI.name} (ROI=${(bestROI.roi*100).toFixed(0)}%) — 每场结果\n`);
console.log(`| 场次 | 对阵 | 类型 | 实际 | picks | 命中? | 赔率 |`);
for (const r of bestROI.results) {
  console.log(`| ${r.code} | ${r.match} | ${r.type} | ${r.actual}(${r.actualTotal}球) | ${r.picks} | ${r.hit ? '✅' : '❌'} | ${r.hit ? '@'+r.hitOdds : '-'} |`);
}

// 每个策略"最赚的一场"对比
console.log(`\n## 各策略的最高赔率命中 —— "血赚"能力对比\n`);
for (const name of Object.keys(strategies)) {
  const r = results[name];
  const top3 = r.results.filter(x => x.hit).sort((a, b) => b.hitOdds - a.hitOdds).slice(0, 3);
  console.log(`  ${name}: ${top3.map(x => `${x.code} ${x.actual}@${x.hitOdds}`).join(', ') || '无高赔率命中'}`);
}

// 反价值测试: 列出弱对弱中实际比分的赔率排名
console.log(`\n## 弱弱场景实际比分赔率分布 —— 找"反价值空间"\n`);
for (const m of matches_) {
  if (classifyMatch(m) !== 'WEAK_MATCH') continue;
  const allSorted = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, home: Number(normalizeScore(k).split(':')[0]), away: Number(normalizeScore(k).split(':')[1]) }))
    .sort((a, b) => a.odds - b.odds);
  allSorted.forEach(s => { s.total = s.home + s.away; });
  const actual = `${m.actualHome}:${m.actualAway}`;
  const rank = allSorted.findIndex(s => s.score === actual) + 1;
  const oddsAtRank = allSorted[rank - 1]?.odds || 0;
  // 列出赔率 top10 供参考, 看"反价值"集中在哪个进球数
  const top10 = allSorted.slice(0, 10);
  console.log(`  ${m.code} ${m.home}vs${m.away} 实际${actual}@${oddsAtRank.toFixed(2)} (庄家排名#${rank}, 进球${m.actualHome+m.actualAway})`);
  console.log(`    赔率top10: ${top10.map(s => `${s.score}@${s.odds.toFixed(1)}(${s.total}球)`).join(', ')}`);
}

// 最后: 提供一个"如果完美选到每个场景最佳赔率"的理论上限
console.log(`\n## ROI 理论上限 —— 假设每个场景都选到实际比分的赔率\n`);
let perfectTotalOdds = 0;
let perfectHits = 0;
for (const m of matches_) {
  const actual = `${m.actualHome}:${m.actualAway}`;
  const entries = Object.entries(m.bf).filter(([k, v]) => v > 1 && !/其它$/.test(k));
  for (const [k, v] of entries) {
    if (normalizeScore(k) === actual) {
      perfectTotalOdds += v;
      perfectHits++;
      break;
    }
  }
}
const perfectROI = (perfectTotalOdds - matches_.length * 3) / (matches_.length * 3);
console.log(`  完美命中20场: 总赔率=${perfectTotalOdds.toFixed(2)}, ROI=${(perfectROI*100).toFixed(0)}%`);
console.log(`  假设命中率50%: 命中10场, 若平均赔率=${(perfectTotalOdds/perfectHits).toFixed(2)}, ROI=${((perfectTotalOdds/perfectHits*10 - matches_.length*3)/(matches_.length*3)*100).toFixed(0)}%`);
console.log(`  所以: ROI>0的临界条件是 平均赔率>3 (投入3 → 回收>3)`);
console.log(`  也就是说: 即使命中率只有30-40%, 只要平均赔率>10, 也是正ROI`);
