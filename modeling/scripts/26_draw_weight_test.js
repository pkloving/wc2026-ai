// 26_draw_weight_test.js — 测试"平局加权"能否覆盖剩余8场
// 核心假设: v4 因为强行选主方向的"有胜负"比分，错过了平局实际结果
// 策略: 根据双方tier组合，给平局比分不同的加权强度
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
    bf: oddsDoc.odds.bf_latest,
    zjq: oddsDoc.odds.zjq_latest,
    actualHome: actual.homeScore, actualAway: actual.awayScore,
  });
}

function normalizeScore(s) { return s.split(':').map(p => String(Number(p))).join(':'); }

// runPick: 核心测试函数
// drawBonus: 对平局比分的 fitCost 减分(越大越倾向平局)
//   0 = baseline(无平局加权),  2 = 中等,  4 = 强
// drawScoreOnly: 是否"某些tier组合才加权平局"
//   'all' = 所有场都加,  'balanced' = 只有势均力敌的组合(second vs second, weak vs weak等)
//   'smart' = 按tier差计算: 差距越小平局bonus越大
function runPick(m, drawBonus, drawMode) {
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

  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v }));

  // 用宽过滤: 只按进球上限过滤, 不按让球方向(因为平局本身就不在让球胜负方向内)
  const filtered = allScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return hg <= homeCap && ag <= awayCap;
  });

  // 平局加权: 根据tier组合计算
  // tier差: top=1, second=2, defensive/weak=3, unknown=2.5
  // 差距越小 → 平局概率越高 → bonus越大
  const tierVal = { top: 1, second: 2, defensive: 3, weak: 3, unknown: 2 };
  const tierDiff = Math.abs(tierVal[hTier] - tierVal[aTier]);
  let computedBonus = 0;
  if (drawMode === 'all') computedBonus = drawBonus;
  else if (drawMode === 'balanced') {
    // second vs second, weak vs weak, second vs weak 都算势均力敌
    const balanced = (hTier === 'second' && aTier === 'second')
                   || (hTier === 'weak' && aTier === 'weak')
                   || (hTier === 'defensive' && aTier === 'weak')
                   || (hTier === 'weak' && aTier === 'defensive')
                   || (hTier === 'second' && aTier === 'weak')
                   || (hTier === 'weak' && aTier === 'second')
                   || (hTier === 'defensive' && aTier === 'second')
                   || (hTier === 'second' && aTier === 'defensive')
                   || (hTier === 'top' && aTier === 'second')
                   || (hTier === 'second' && aTier === 'top');
    computedBonus = balanced ? drawBonus : 0;
  } else if (drawMode === 'smart') {
    // tier差0-1 → 强平局bonus; 差2 → 小bonus; 差3+ → 无
    if (tierDiff <= 1) computedBonus = drawBonus;
    else if (tierDiff === 2) computedBonus = drawBonus * 0.5;
    else computedBonus = 0;
  }
  // top vs top 的强强对话也加平局bonus
  if (hTier === 'top' && aTier === 'top') computedBonus = Math.max(computedBonus, drawBonus);
  // 含防守队(defensive) → 平局概率高
  if (hTier === 'defensive' || aTier === 'defensive') computedBonus = Math.max(computedBonus, drawBonus * 0.8);

  const dir = hc <= 0 ? 'home' : 'away';
  const hT = dir === 'home' ? homeGoals[1] : homeGoals[0];
  const aT = dir === 'home' ? awayGoals[0] : awayGoals[1];

  const fitCost = (s) => {
    const [h, a] = s.score.split(':').map(Number);
    const styleD = Math.abs(h - hT) + Math.abs(a - aT);
    let zjqD = 0;
    if (zjqMode != null) {
      const total = h + a;
      if (total < zjqMode - 1) zjqD += 1 * (zjqMode - 1 - total);
      if (total > zjqMode + 2) zjqD += 0.3 * (total - zjqMode - 2);
    }
    // 平局加权: 比分是平局(h=a)时, 减computedBonus分
    const drawD = (h === a) ? -computedBonus : 0;
    // 让球方向修正: hc<0主队让球时, 主队胜比分加一点分; 但保留平局的公平竞争
    return styleD + zjqD + drawD;
  };

  const ranked = filtered.slice().sort((x, y) => fitCost(x) - fitCost(y) || x.odds - y.odds);
  const top3 = ranked.slice(0, 3);
  return { top3, zjqMode, computedBonus, tierDiff };
}

// 测试多种平局策略
const configs = [
  { name: 'A_baseline', drawBonus: 0, drawMode: 'all', desc: '基线: 无平局加权' },
  { name: 'B_draw_small', drawBonus: 2, drawMode: 'balanced', desc: '势均力敌场平局+2' },
  { name: 'C_draw_med', drawBonus: 3, drawMode: 'balanced', desc: '势均力敌场平局+3' },
  { name: 'D_draw_big', drawBonus: 5, drawMode: 'balanced', desc: '势均力敌场平局+5' },
  { name: 'E_smart_small', drawBonus: 2, drawMode: 'smart', desc: '按tier差: 小差距+2' },
  { name: 'F_smart_med', drawBonus: 4, drawMode: 'smart', desc: '按tier差: 小差距+4' },
  { name: 'G_all_small', drawBonus: 2, drawMode: 'all', desc: '全场上平局+2' },
];

console.log(`\n## 平局加权策略对比\n`);
console.log(`| 配置 | 平局加权方式 | bonus | 命中 | 命中率 |`);
console.log(`|------|-------------|-------|------|--------|`);

const resultsByCfg = {};
for (const cfg of configs) {
  const hits = matches_.filter(m => {
    const r = runPick(m, cfg.drawBonus, cfg.drawMode);
    return r.top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`);
  }).length;
  resultsByCfg[cfg.name] = hits;
  console.log(`| ${cfg.name} | ${cfg.drawMode} | ${cfg.drawBonus} | ${hits}/${matches_.length} | ${(hits/matches_.length*100).toFixed(0)}% |`);
}

// 详细分析: 看best配置和基线的迁移
const bestCfg = configs.reduce((a, b) => resultsByCfg[a.name] > resultsByCfg[b.name] ? a : b);
console.log(`\n## 最佳配置: ${bestCfg.name} —— 详细迁移\n`);

const baselineHits = new Set();
const bestHits = new Set();
for (const m of matches_) {
  const r0 = runPick(m, 0, 'all');
  const rb = runPick(m, bestCfg.drawBonus, bestCfg.drawMode);
  if (r0.top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`)) baselineHits.add(m.code);
  if (rb.top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`)) bestHits.add(m.code);
}

console.log(`| 场次 | 对阵 | tier | 实际 | zjq | 基线top3 | 基线✅ | ${bestCfg.name}top3 | ${bestCfg.name}✅ | bonus | 迁移 |`);
for (const m of matches_) {
  const r0 = runPick(m, 0, 'all');
  const rb = runPick(m, bestCfg.drawBonus, bestCfg.drawMode);
  const actual = `${m.actualHome}:${m.actualAway}`;
  const hit0 = r0.top3.some(x => x.score === actual);
  const hitB = rb.top3.some(x => x.score === actual);
  const migration = hit0 && hitB ? '保持' : (!hit0 && hitB ? '✅新命中' : (hit0 && !hitB ? '❌回归' : '都错'));
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${hTier}/${aTier} | ${actual} | ${r0.zjqMode ?? '-'} | ${r0.top3.map(p=>`${p.score}@${p.odds}`).join(' ')} | ${hit0?'✅':'❌'} | ${rb.top3.map(p=>`${p.score}@${p.odds}`).join(' ')} | ${hitB?'✅':'❌'} | ${rb.computedBonus} | ${migration} |`);
}

// 重点: 新命中场和回归场详情
console.log(`\n## 新命中场 (基线错过 → ${bestCfg.name}命中)\n`);
for (const m of matches_) {
  const r0 = runPick(m, 0, 'all');
  const rb = runPick(m, bestCfg.drawBonus, bestCfg.drawMode);
  const actual = `${m.actualHome}:${m.actualAway}`;
  const hit0 = r0.top3.some(x => x.score === actual);
  const hitB = rb.top3.some(x => x.score === actual);
  if (!hit0 && hitB) {
    console.log(`  ${m.code} ${m.home}vs${m.away} ${actual} (${m.actualHome+m.actualAway}球, tier:${getTeamTier(m.home)}/${getTeamTier(m.away)})`);
    console.log(`    基线: ${r0.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
    console.log(`    ${bestCfg.name}: ${rb.top3.map(p => `${p.score}@${p.odds}`).join(' ')} | bonus=${rb.computedBonus}`);
  }
}
console.log(`\n## 回归场 (基线命中 → ${bestCfg.name}错过)\n`);
for (const m of matches_) {
  const r0 = runPick(m, 0, 'all');
  const rb = runPick(m, bestCfg.drawBonus, bestCfg.drawMode);
  const actual = `${m.actualHome}:${m.actualAway}`;
  const hit0 = r0.top3.some(x => x.score === actual);
  const hitB = rb.top3.some(x => x.score === actual);
  if (hit0 && !hitB) {
    console.log(`  ${m.code} ${m.home}vs${m.away} ${actual}`);
    console.log(`    基线: ${r0.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
    console.log(`    ${bestCfg.name}: ${rb.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
  }
}

// 按"实际进球数分组"分析最佳配置的命中分布
console.log(`\n## ${bestCfg.name}: 按实际进球分组命中率\n`);
const buckets = { '≤2': [], '3-4': [], '5+': [] };
for (const m of matches_) {
  const t = m.actualHome + m.actualAway;
  if (t <= 2) buckets['≤2'].push(m);
  else if (t <= 4) buckets['3-4'].push(m);
  else buckets['5+'].push(m);
}
for (const [k, games] of Object.entries(buckets)) {
  const hit0 = games.filter(m => runPick(m, 0, 'all').top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`)).length;
  const hitB = games.filter(m => runPick(m, bestCfg.drawBonus, bestCfg.drawMode).top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`)).length;
  console.log(`  ${k}球 ${games.length}场: 基线 ${hit0}/${games.length} → ${bestCfg.name} ${hitB}/${games.length}`);
}

// 最后: 还有哪些场连best配置也没命中?
console.log(`\n## ${bestCfg.name} 仍然未命中的场 —— 真正的硬骨头\n`);
for (const m of matches_) {
  const rb = runPick(m, bestCfg.drawBonus, bestCfg.drawMode);
  const actual = `${m.actualHome}:${m.actualAway}`;
  if (!rb.top3.some(x => x.score === actual)) {
    const allSorted = Object.entries(m.bf)
      .filter(([k, v]) => v > 1 && !/其它$/.test(k))
      .map(([k, v]) => ({ score: normalizeScore(k), odds: v }))
      .sort((a, b) => a.odds - b.odds);
    const rank = allSorted.findIndex(s => s.score === actual) + 1;
    const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
    console.log(`  ${m.code} ${m.home}vs${m.away} ${actual}@${allSorted[rank-1]?.odds} (${m.actualHome+m.actualAway}球, tier:${hTier}/${aTier}, hc:${m.handicap}) → 庄家赔率排名 #${rank}`);
    console.log(`    top5赔率: ${allSorted.slice(0, 5).map(s => `${s.score}@${s.odds}`).join(', ')}`);
  }
}
