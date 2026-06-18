// 24_zjq_penalty_test.js — 只测一个问题:
// zjq=2 时，fitCost 里对"实际≥4球"的比分是否罚得太狠？
// 改法: zjq 只惩罚"过低"的比分 (total < zjqMode-1)，不惩罚"过高"的比分
// 验证: zjq=2组(13场)中, 5场实际≥4球，放宽后top3是否能覆盖到它们?
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
function hasScorerStar(team) { return SCORER_STAR_TEAMS.has(team); }
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
function fairProbFromOdds(odds) { return 1 / (odds * 1.13); }

// 简化版 pickScores: 只测试"zjq 罚分规则"的影响
// 参数: zjqUpPenalty —— 对"总进球 > zjqMode+1"的惩罚强度
//   baseline: zjqUpPenalty = 1 (按进球差罚)
//   test: zjqUpPenalty = 0 (完全不罚高球)
//   test: zjqUpPenalty = 0.3 (轻度罚)
function runPick(m, zjqUpPenalty, goalUpTol) {
  // 球风区间(简化, 不含 uplift —— 让我们只看 zjq 罚分的效果)
  const hc = m.handicap;
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  const homeHasStar = hasScorerStar(m.home), awayHasStar = hasScorerStar(m.away);

  let homeGoals = hTier === 'top' ? [2, 3] : (hTier === 'second' ? [1, 2] : [0, 1]);
  let awayGoals = aTier === 'top' ? [2, 3] : (aTier === 'second' ? [1, 2] : [0, 1]);
  // |h|≥2 让球盘抬升
  const homeCap = hc <= -2 ? 7 : 4;
  const awayCap = hc >= 2 ? 7 : 4;
  if (hc <= -2) homeGoals = [3, 7];
  if (hc >= 2) awayGoals = [3, 7];
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

  // 球风过滤: 使用 goalUpTol(容差) 控制宽紧
  const inRange = (g, range, tol) => (g >= Math.max(0, range[0] - 1) && g <= range[1] + tol);
  const candidates = filtered.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return inRange(hg, homeGoals, goalUpTol) && inRange(ag, awayGoals, goalUpTol);
  });

  const useCand = candidates.length > 0 ? candidates : filtered;

  // 目标点
  const hT = dir === 'home' ? homeGoals[1] : homeGoals[0];
  const aT = dir === 'home' ? awayGoals[0] : awayGoals[1];

  // zjq 模式
  let zjqMode = null;
  if (m.zjq) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  const fitCost = (s) => {
    const [h, a] = s.score.split(':').map(Number);
    const styleD = Math.abs(h - hT) + Math.abs(a - aT);
    let zjqD = 0;
    if (zjqMode != null) {
      const total = h + a;
      // 罚低球(固定: 比 zjqMode-1 还低的才罚)
      if (total < zjqMode - 1) zjqD += 1 * (zjqMode - 1 - total);
      // 罚高球(由参数控制)
      if (total > zjqMode + 1) zjqD += zjqUpPenalty * (total - zjqMode - 1);
    }
    return styleD + zjqD;
  };

  // 取前3个最低成本
  const ranked = useCand.slice().sort((x, y) => fitCost(x) - fitCost(y) || x.odds - y.odds);
  const top3 = ranked.slice(0, 3);

  return { top3, zjqMode, homeGoals, awayGoals, hT, aT };
}

// 跑多种配置对比
const configs = [
  { name: 'A_baseline',    zjqUpPenalty: 1.0, goalUpTol: 1, desc: 'zjq ±1严格罚, 球风容差=1' },
  { name: 'B_loose_zjq',   zjqUpPenalty: 0.0, goalUpTol: 1, desc: 'zjq 完全不罚高球, 只罚过低' },
  { name: 'C_mild_zjq',    zjqUpPenalty: 0.3, goalUpTol: 1, desc: 'zjq 轻度罚高球' },
  { name: 'D_wide_range',  zjqUpPenalty: 1.0, goalUpTol: 3, desc: '球风容差放宽到3(覆盖4-6球比分)' },
  { name: 'E_best_combo',  zjqUpPenalty: 0.0, goalUpTol: 3, desc: '宽球风容差 + zjq 不罚高球' },
  { name: 'F_mild_combo',  zjqUpPenalty: 0.3, goalUpTol: 2, desc: '中等组合: 轻罚+容差=2' },
];

console.log(`\n## 按配置整体命中率\n`);
console.log(`| 配置 | zjq高罚分 | 球风容差 | 说明 | 命中 | 命中率 |`);
console.log(`|------|-----------|----------|------|------|--------|`);

const allResults = {};
for (const cfg of configs) {
  const picks = matches_.map(m => ({ m, r: runPick(m, cfg.zjqUpPenalty, cfg.goalUpTol) }));
  const actualHit = picks.filter(p => p.r.top3.some(x => x.score === `${p.m.actualHome}:${p.m.actualAway}`)).length;
  allResults[cfg.name] = picks;
  console.log(`| ${cfg.name} | ${cfg.zjqUpPenalty} | ${cfg.goalUpTol} | ${cfg.desc} | ${actualHit}/${matches_.length} | ${(actualHit/matches_.length*100).toFixed(0)}% |`);
}

// 按"实际总进球"分组看命中率变化
console.log(`\n## 按实际进球数分组 —— 各配置命中率\n`);
console.log(`| 实际进球 | 场数 | A(基线) | B(宽zjq) | D(宽球风) | E(都宽) | F(中组) | 代表场 |`);
console.log(`|----------|------|---------|----------|-----------|---------|---------|--------|`);

const totalBuckets = { '≤2': [], '3-4': [], '5+': [] };
for (const m of matches_) {
  const t = m.actualHome + m.actualAway;
  if (t <= 2) totalBuckets['≤2'].push(m);
  else if (t <= 4) totalBuckets['3-4'].push(m);
  else totalBuckets['5+'].push(m);
}

for (const [k, games] of Object.entries(totalBuckets)) {
  const row = [k, games.length];
  for (const cfgName of ['A_baseline', 'B_loose_zjq', 'D_wide_range', 'E_best_combo', 'F_mild_combo']) {
    const hits = games.filter(m => {
      const r = runPick(m,
        cfgName === 'A_baseline' ? 1.0 : cfgName === 'B_loose_zjq' ? 0.0 : cfgName === 'D_wide_range' ? 1.0 : cfgName === 'E_best_combo' ? 0.0 : 0.3,
        cfgName === 'A_baseline' ? 1 : cfgName === 'B_loose_zjq' ? 1 : cfgName === 'D_wide_range' ? 3 : cfgName === 'E_best_combo' ? 3 : 2
      );
      return r.top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`);
    }).length;
    row.push(`${hits}/${games.length} (${(hits/games.length*100).toFixed(0)}%)`);
  }
  row.push(games.slice(0, 2).map(m => `${m.home}vs${m.away} ${m.actualHome}:${m.actualAway}`).join('; '));
  console.log(`| ${row.join(' | ')} |`);
}

// 列出"配置A错过但配置E能命中"的场 = 放宽后新覆盖的
console.log(`\n## 新命中场(基线A没中, 宽松E中了) vs 回归场(基线A中, 宽松E漏了)\n`);
const aResults = allResults['A_baseline'];
const eResults = allResults['E_best_combo'];
const gained = [], lost = [];
for (let i = 0; i < matches_.length; i++) {
  const m = matches_[i];
  const aHit = aResults[i].r.top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`);
  const eHit = eResults[i].r.top3.some(x => x.score === `${m.actualHome}:${m.actualAway}`);
  if (!aHit && eHit) gained.push({ m, a: aResults[i].r, e: eResults[i].r });
  if (aHit && !eHit) lost.push({ m, a: aResults[i].r, e: eResults[i].r });
}
console.log(`✅ 新命中 ${gained.length} 场:`);
for (const g of gained) {
  console.log(`  ${g.m.code} ${g.m.home}vs${g.m.away} 实际 ${g.m.actualHome}:${g.m.actualAway} (${g.m.actualHome+g.m.actualAway}球, zjq=${g.a.zjqMode})`);
  console.log(`    A top3: ${g.a.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
  console.log(`    E top3: ${g.e.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
}
console.log(`\n❌ 回归 ${lost.length} 场:`);
for (const l of lost) {
  console.log(`  ${l.m.code} ${l.m.home}vs${l.m.away} 实际 ${l.m.actualHome}:${l.m.actualAway} (${l.m.actualHome+l.m.actualAway}球, zjq=${l.a.zjqMode})`);
  console.log(`    A top3: ${l.a.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
  console.log(`    E top3: ${l.e.top3.map(p => `${p.score}@${p.odds}`).join(' ')}`);
}
