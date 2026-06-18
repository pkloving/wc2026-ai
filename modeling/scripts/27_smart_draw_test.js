// 27_smart_draw_test.js — 精准平局加权
// 只在"真正势均力敌"的比赛给平局加权, second vs weak 不加
// 同时保留 v4 的 goalUplift 思路(之前简化脚本没做到)
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

// 关键改进: 按tier组合计算平局bonus, 并结合 zjq 和 hc
// tier组合分类:
//   BALANCED(势均力敌): top/top, second/second, top/second, second/top, weak/weak, defensive/weak, weak/defensive
//   FAVORITE(强弱分明): top/weak, second/weak, top/defensive —— 不加平局bonus
//   UNKNOWN(其他): 看zjq, zjq<=2且hc小 → 小加
function runPick(m, { drawBonusScale = 2, goalUpliftOn = true, zjqHighPenalty = 0.3, allowAnyDir = true } = {}) {
  const hc = m.handicap;
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  const homeHasStar = hasScorerStar(m.home), awayHasStar = hasScorerStar(m.away);

  let homeGoals = hTier === 'top' ? [2, 3] : (hTier === 'second' ? [1, 2] : [0, 1]);
  let awayGoals = aTier === 'top' ? [2, 3] : (aTier === 'second' ? [1, 2] : [0, 1]);
  const homeCap = hc <= -2 ? 7 : 5;
  const awayCap = hc >= 2 ? 7 : 5;
  if (hc <= -2) homeGoals = [3, 7];
  if (hc >= 2) awayGoals = [3, 7];
  if (homeHasStar && homeGoals[0] < 1) homeGoals = [1, homeGoals[1]];
  if (awayHasStar && awayGoals[0] < 1) awayGoals = [1, awayGoals[1]];

  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  // 判断是否"势均力敌" → 给平局bonus
  const tierPairs = `${hTier}/${aTier}`;
  const balancedPairs = ['top/top', 'second/second', 'top/second', 'second/top',
                        'weak/weak', 'defensive/weak', 'weak/defensive',
                        'second/defensive', 'defensive/second',
                        'unknown/unknown', 'unknown/second', 'second/unknown'];
  const isBalanced = balancedPairs.includes(tierPairs);
  // zjq 也作为辅助: zjq<=2(小球)时, 平局概率更高
  const zjqLowBall = zjqMode != null && zjqMode <= 2;
  // 让球盘小的(|hc| <= 1) → 更可能平局
  const smallHandicap = Math.abs(hc) <= 1;

  let drawBonus = 0;
  if (isBalanced && smallHandicap && zjqLowBall) drawBonus = drawBonusScale * 1.5;
  else if (isBalanced && smallHandicap) drawBonus = drawBonusScale * 1.2;
  else if (isBalanced) drawBonus = drawBonusScale * 0.8;
  else if (zjqLowBall && smallHandicap) drawBonus = drawBonusScale * 0.5;  // 弱对弱但zjq=2

  // 特殊: top vs weak, second vs weak → 明确优势方 → 不给平局bonus
  const favoritePairs = ['top/weak', 'second/weak', 'top/defensive', 'second/defensive',
                         'weak/top', 'weak/second', 'defensive/top', 'defensive/second'];
  if (favoritePairs.includes(tierPairs)) drawBonus = Math.min(drawBonus, drawBonusScale * 0.3);

  // goalUplift: 强强对话 或 大让球 → 进球上限抬
  let goalUplift = 0;
  if (goalUpliftOn) {
    if (Math.abs(hc) >= 2) goalUplift = 2;
    if (homeHasStar && awayHasStar) goalUplift = Math.max(goalUplift, 2);
    if (hTier === 'top' && aTier === 'second') goalUplift = Math.max(goalUplift, 1);
    if (aTier === 'top' && hTier === 'second') goalUplift = Math.max(goalUplift, 1);
  }

  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v }));

  const filtered = allScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return hg <= homeCap && ag <= awayCap;
  });

  // 目标进球点(主方向侧抬升, 基于goalUplift)
  const dir = hc <= 0 ? 'home' : 'away';
  let hT = dir === 'home' ? homeGoals[1] : homeGoals[0];
  let aT = dir === 'home' ? awayGoals[0] : awayGoals[1];
  if (goalUplift > 0) {
    if (dir === 'home' && hc <= 0) hT = Math.min(hT + goalUplift, homeCap);
    else if (dir === 'away' && hc >= 0) aT = Math.min(aT + goalUplift, awayCap);
    else { hT = Math.min(hT + Math.ceil(goalUplift/2), homeCap); aT = Math.min(aT + Math.ceil(goalUplift/2), awayCap); }
  }

  const fitCost = (s) => {
    const [h, a] = s.score.split(':').map(Number);
    const styleD = Math.abs(h - hT) + Math.abs(a - aT);
    let zjqD = 0;
    if (zjqMode != null) {
      const total = h + a;
      if (total < zjqMode - 1) zjqD += 1 * (zjqMode - 1 - total);
      if (total > zjqMode + 2) zjqD += zjqHighPenalty * (total - zjqMode - 2);
    }
    // 平局加权
    const drawD = (h === a) ? -drawBonus : 0;
    return styleD + zjqD + drawD;
  };

  const ranked = filtered.slice().sort((x, y) => fitCost(x) - fitCost(y) || x.odds - y.odds);
  return { top3: ranked.slice(0, 3), drawBonus, goalUplift, zjqMode, hT, aT };
}

// ========== 测试配置 ==========
const testCfgs = [];
testCfgs.push({ ...{ name: 'A_baseline', desc: 'v4: goalUplift, zjq轻罚高, 平局+0(之前v4实际上也有微弱平局倾向)' } });
testCfgs.push({ ...{ name: 'B_balanced_small', drawBonusScale: 2, desc: '势均力敌+低球+小让球 → 平局+3, 其他递减' } });
testCfgs.push({ ...{ name: 'C_balanced_strong', drawBonusScale: 3, desc: '势均力敌场平局+4.5, 更强平局' } });
testCfgs.push({ ...{ name: 'D_mix_v4_plus', drawBonusScale: 2.5, zjqHighPenalty: 0.1, desc: 'v4 + 轻平局 + zjq几乎不罚高' } });
testCfgs.push({ ...{ name: 'E_no_uplift_small_draw', drawBonusScale: 2, goalUpliftOn: false, desc: '不抬进球上限, 只加平局' } });
testCfgs.push({ ...{ name: 'F_no_zjq_high', drawBonusScale: 2, zjqHighPenalty: 0, desc: '平局+2, zjq完全不罚高球' } });

console.log(`\n## 配置对比\n`);
console.log(`| 配置 | drawBonus | goalUplift | zjq罚高 | 命中 | 命中率 |`);
console.log(`|------|-----------|-----------|---------|------|--------|`);

const results = {};
for (const cfg of testCfgs) {
  const hits = matches_.filter(m => {
    const r = runPick(m, { drawBonusScale: cfg.drawBonusScale || 0, goalUpliftOn: cfg.goalUpliftOn !== false, zjqHighPenalty: cfg.zjqHighPenalty ?? 0.3 });
    return r.top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`);
  }).length;
  results[cfg.name] = hits;
  console.log(`| ${cfg.name} | ${cfg.drawBonusScale || 0} | ${cfg.goalUpliftOn !== false ? 'ON' : 'OFF'} | ${cfg.zjqHighPenalty ?? 0.3} | ${hits}/${matches_.length} | ${(hits/matches_.length*100).toFixed(0)}% |`);
}

// 找最佳配置并做迁移分析
const bestName = Object.entries(results).sort((a, b) => b[1] - a[1])[0][0];
const bestCfg = testCfgs.find(c => c.name === bestName);
console.log(`\n## 最佳: ${bestName} —— 详细迁移 vs A_baseline\n`);

console.log(`| 场次 | 对阵 | tier/hc | 实际 | zjq | 基线top3 | 基线✅ | ${bestName}top3 | ${bestName}✅ | drawBonus | uplift | 迁移 |`);
let gained = [], lost = [];
for (const m of matches_) {
  const r0 = runPick(m, {});
  const rb = runPick(m, { drawBonusScale: bestCfg.drawBonusScale || 0, goalUpliftOn: bestCfg.goalUpliftOn !== false, zjqHighPenalty: bestCfg.zjqHighPenalty ?? 0.3 });
  const actual = `${m.actualHome}:${m.actualAway}`;
  const h0 = r0.top3.some(x => x.score === actual);
  const hb = rb.top3.some(x => x.score === actual);
  const mig = h0 && hb ? '保持' : (!h0 && hb ? '✅新命中' : (h0 && !hb ? '❌回归' : '都错'));
  if (!h0 && hb) gained.push({ m, r0, rb, actual });
  if (h0 && !hb) lost.push({ m, r0, rb, actual });
  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${getTeamTier(m.home)}/${getTeamTier(m.away)} h${m.handicap} | ${actual} | ${r0.zjqMode ?? '-'} | ${r0.top3.map(p=>`${p.score}@${p.odds}`).join(' ')} | ${h0?'✅':'❌'} | ${rb.top3.map(p=>`${p.score}@${p.odds}`).join(' ')} | ${hb?'✅':'❌'} | ${rb.drawBonus.toFixed(1)} | ${rb.goalUplift} | ${mig} |`);
}

console.log(`\n## 新命中(新配置补上的)\n`);
for (const g of gained) {
  console.log(`  ${g.m.code} ${g.m.home}vs${g.m.away} ${g.actual} → bonus=${g.rb.drawBonus.toFixed(1)}`);
  console.log(`    基线: ${g.r0.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
  console.log(`    ${bestName}: ${g.rb.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
}
console.log(`\n## 回归(新配置搞丢的)\n`);
for (const l of lost) {
  console.log(`  ${l.m.code} ${l.m.home}vs${l.m.away} ${l.actual}`);
  console.log(`    基线: ${l.r0.top3.map(p => `${l.p.score}@${l.p.odds}`).join(' ')}`);
  console.log(`    ${bestName}: ${l.rb.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
}

// 最后: 还有哪些场是所有配置都命中不了的?
console.log(`\n## 无法命中的场 (所有配置都错过)\n`);
for (const m of matches_) {
  const actual = `${m.actualHome}:${m.actualAway}`;
  let anyHit = false;
  for (const cfg of testCfgs) {
    const r = runPick(m, { drawBonusScale: cfg.drawBonusScale || 0, goalUpliftOn: cfg.goalUpliftOn !== false, zjqHighPenalty: cfg.zjqHighPenalty ?? 0.3 });
    if (r.top3.some(x => x.score === actual)) anyHit = true;
  }
  if (!anyHit) {
    const allSorted = Object.entries(m.bf)
      .filter(([k, v]) => v > 1 && !/其它$/.test(k))
      .map(([k, v]) => ({ score: normalizeScore(k), odds: v }))
      .sort((a, b) => a.odds - b.odds);
    const rank = allSorted.findIndex(s => s.score === actual) + 1;
    console.log(`  ${m.code} ${m.home}vs${m.away} ${actual}@${allSorted[rank-1]?.odds} (${m.actualHome+m.actualAway}球, tier:${getTeamTier(m.home)}/${getTeamTier(m.away)}, hc:${m.handicap}) → 庄家赔率排名 #${rank}`);
    console.log(`    top5: ${allSorted.slice(0, 5).map(s => `${s.score}@${s.odds}`).join(', ')}`);
  }
}
