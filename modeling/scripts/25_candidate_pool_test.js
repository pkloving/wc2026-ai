// 25_candidate_pool_test.js — 验证候选池瓶颈:
// 如果候选池里有实际比分, 它能进 top3 吗?
// 如果候选池里没有, 就说明区间/方向过滤才是问题, 不是 fitCost
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

function getTeamTier(team) {
  if (TOP_TIER.includes(team)) return 'top';
  if (SECOND_TIER.includes(team)) return 'second';
  if (DEFENSIVE.includes(team)) return 'defensive';
  if (WEAK_TEAMS.includes(team)) return 'weak';
  return 'unknown';
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
    code: oddsDoc.basic.code, home: oddsDoc.basic.home, away: oddsDoc.basic.away,
    handicap: oddsDoc.odds.handicap ?? 0,
    bf: oddsDoc.odds.bf_latest,
    zjq: oddsDoc.odds.zjq_latest,
    actualHome: actual.homeScore, actualAway: actual.awayScore,
  });
}

function normalizeScore(s) { return s.split(':').map(p => String(Number(p))).join(':'); }

// 核心测试: 用"非常宽"的候选池(包含所有可能比分), 看 odds+简单球风加权能否把实际比分排进 top3
// 这代表"理论最高命中率"——如果这个都低, 说明赔率本身就不支持猜中
function testWidePool(m, homeCap, awayCap) {
  const hc = m.handicap;
  const actualScore = `${m.actualHome}:${m.actualAway}`;
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);

  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v }));

  // 用区间 [0, homeCap] x [0, awayCap] 过滤
  const filtered = allScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return hg <= homeCap && ag <= awayCap;
  });

  // zjq 模式
  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  // 目标点
  const hBase = hTier === 'top' ? 3 : hTier === 'second' ? 2 : 1;
  const aBase = aTier === 'top' ? 3 : aTier === 'second' ? 2 : 1;

  // 纯赔率排序 (odds 最低的3个 = 庄家认为最可能的)
  const byOdds = filtered.slice().sort((a, b) => a.odds - b.odds);

  // 赔率+进球偏离加权
  const byFit = filtered.slice().sort((a, b) => {
    const [ahg, aag] = a.score.split(':').map(Number);
    const [bhg, bag] = b.score.split(':').map(Number);
    const aScore = Math.abs(ahg - hBase) + Math.abs(aag - aBase);
    const bScore = Math.abs(bhg - hBase) + Math.abs(bag - aBase);
    // 进球偏离权重 vs 赔率权重
    const aFinal = aScore * 1 + Math.log(a.odds) * 2;
    const bFinal = bScore * 1 + Math.log(b.odds) * 2;
    return aFinal - bFinal;
  });

  const top3Odds = byOdds.slice(0, 3).map(p => p.score);
  const top3Fit = byFit.slice(0, 3).map(p => p.score);
  const top5Fit = byFit.slice(0, 5).map(p => p.score);

  // 实际比分是否在过滤后的池子中
  const inPool = filtered.some(s => s.score === actualScore);

  // 实际比分在按赔率排序中的排名
  const oddsRank = byOdds.findIndex(s => s.score === actualScore);
  // 实际比分在加权排序中的排名
  const fitRank = byFit.findIndex(s => s.score === actualScore);

  return {
    inPool, top3Odds, top3Fit, top5Fit,
    oddsRank: oddsRank < 0 ? '未在池内' : `#${oddsRank+1}`,
    fitRank: fitRank < 0 ? '未在池内' : `#${fitRank+1}`,
    actualScore, total: m.actualHome + m.actualAway,
    zjqMode,
  };
}

// 测试多种区间上限
const caps = [
  { h: 3, a: 3, name: '紧(3,3)' },
  { h: 5, a: 3, name: '主宽(5,3)' },
  { h: 5, a: 5, name: '中(5,5)' },
  { h: 7, a: 5, name: '大主(7,5)' },
  { h: 7, a: 7, name: '超宽(7,7)' },
];

console.log(`\n## 不同区间上限的理论最高命中率\n`);
console.log(`| 上限 | 实际比分在池内 | 按赔率top3命中 | 按加权top3命中 | 按加权top5命中 |`);
console.log(`|------|---------------|--------------|-------------|--------------|`);

for (const cap of caps) {
  const results = matches_.map(m => testWidePool(m, cap.h, cap.a));
  const inPool = results.filter(r => r.inPool).length;
  const odds3 = results.filter(r => r.top3Odds.includes(r.actualScore)).length;
  const fit3 = results.filter(r => r.top3Fit.includes(r.actualScore)).length;
  const fit5 = results.filter(r => r.top5Fit.includes(r.actualScore)).length;
  console.log(`| ${cap.name} | ${inPool}/${matches_.length} | ${odds3}/${matches_.length} | ${fit3}/${matches_.length} | ${fit5}/${matches_.length} |`);
}

// 用(7,7)超宽池详细分析: 每场实际比分的"赔率排名" vs "加权排名"
console.log(`\n## (7,7)超宽池: 每场实际比分的排名\n`);
console.log(`| 场次 | 对阵 | tier | 实际 | 总进球 | zjq | 赔率top3 | 实际赔率排名 | 加权top3 | 实际加权排名 |`);
console.log(`|------|------|------|------|--------|-----|---------|-------------|---------|-------------|`);

let oddsHit = 0, fitHit = 0;
for (const m of matches_) {
  const r = testWidePool(m, 7, 7);
  const hT = getTeamTier(m.home), aT = getTeamTier(m.away);
  const isOddsHit = r.top3Odds.includes(r.actualScore);
  const isFitHit = r.top3Fit.includes(r.actualScore);
  if (isOddsHit) oddsHit++;
  if (isFitHit) fitHit++;
  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${hT}/${aT} | ${r.actualScore} | ${r.total} | ${r.zjqMode ?? '-'} | ${r.top3Odds.join(',')} | ${r.oddsRank} | ${r.top3Fit.join(',')} | ${r.fitRank} |`);
}
console.log(`\n纯赔率top3命中率: ${oddsHit}/${matches_.length} = ${(oddsHit/matches_.length*100).toFixed(0)}%`);
console.log(`球风加权top3命中率: ${fitHit}/${matches_.length} = ${(fitHit/matches_.length*100).toFixed(0)}%`);

// 分析: 哪些场实际比分赔率排名很低(说明庄家自己也没看好), 这是"命中率天花板"
console.log(`\n## 庄家赔率top3命中的场 (即"最容易猜中的比赛")\n`);
for (const m of matches_) {
  const r = testWidePool(m, 7, 7);
  if (r.top3Odds.includes(r.actualScore)) {
    const actualOdds = Object.entries(m.bf).find(([k]) => normalizeScore(k) === r.actualScore)?.[1];
    console.log(`  ${m.code} ${m.home}vs${m.away} ${r.actualScore}@${actualOdds} (${r.total}球, zjq=${r.zjqMode}) → oddsTop3=${r.top3Odds.join(',')}`);
  }
}

console.log(`\n## 庄家赔率排名 4-10 的场 ("有点难猜, 但进top10")\n`);
for (const m of matches_) {
  const r = testWidePool(m, 7, 7);
  if (!r.top3Odds.includes(r.actualScore)) {
    const allScores = Object.entries(m.bf)
      .filter(([k, v]) => v > 1 && !/其它$/.test(k))
      .map(([k, v]) => ({ score: normalizeScore(k), odds: v }))
      .sort((a, b) => a.odds - b.odds);
    const rank = allScores.findIndex(s => s.score === r.actualScore) + 1;
    if (rank >= 4 && rank <= 10) {
      console.log(`  ${m.code} ${m.home}vs${m.away} ${r.actualScore}@${m.bf[r.actualScore] || Object.entries(m.bf).find(([k])=>normalizeScore(k)===r.actualScore)?.[1]} (${r.total}球) → 庄家赔率排名 #${rank}`);
      console.log(`    top5: ${allScores.slice(0, 5).map(s => `${s.score}@${s.odds}`).join(', ')}`);
    }
  }
}

console.log(`\n## 庄家赔率排名 >10 的场 ("超难猜, 爆冷比分")\n`);
for (const m of matches_) {
  const r = testWidePool(m, 7, 7);
  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v }))
    .sort((a, b) => a.odds - b.odds);
  const rank = allScores.findIndex(s => s.score === r.actualScore) + 1;
  if (rank > 10) {
    console.log(`  ${m.code} ${m.home}vs${m.away} ${r.actualScore}@${allScores[rank-1]?.odds} (${r.total}球) → 庄家赔率排名 #${rank}`);
    console.log(`    top5: ${allScores.slice(0, 5).map(s => `${s.score}@${s.odds}`).join(', ')}`);
  }
}
