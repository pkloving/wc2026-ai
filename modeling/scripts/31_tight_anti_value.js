// 31_tight_anti_value.js — 主模型策略脚本
// 核心策略: 主池=F4混合 (ROI+134%) + 单关=反方向/平局高赔率比分 (爆冷门)
// 用法:
//   node modeling/scripts/31_tight_anti_value.js --predict    (默认, 预测今日比赛)
//   node modeling/scripts/31_tight_anti_value.js --backtest   (回测历史比赛)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'modeling', 'artifacts');

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

// 解析 bf_latest 比分赔率, 返回 {score, odds, home, away, total}[]
function parseOdds(bf) {
  if (!bf) return [];
  return Object.entries(bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => {
      const score = normalizeScore(k);
      const parts = score.split(':');
      return { score, odds: v, home: Number(parts[0]), away: Number(parts[1]), total: Number(parts[0]) + Number(parts[1]) };
    });
}

// 比赛分类: BIG_BALL / WEAK_MATCH / NORMAL
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

// ============================================================
// F4 混合策略: 2x@10-30 + 1x@30-50, 返回 [{score, odds}]
// ============================================================
function f4Strategy(m) {
  const type = classifyMatch(m);
  const all = parseOdds(m.bf);
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;

  let mainPicks = [];

  if (type === 'BIG_BALL') {
    // BIG_BALL: 3档大球比分 (低赔率<12 / 12-25 / 15-40)
    const big = all.filter(s => s.total >= 4 && dirMatch(s)).sort((a, b) => a.odds - b.odds);
    const safe = big.filter(s => s.odds < 12)[0] || big[0];
    const midHigh = big.filter(s => s.odds >= 12 && s.odds <= 25)[0] || big[Math.floor(big.length / 2)] || big[big.length - 1];
    const high = big.filter(s => s.odds >= 15 && s.odds <= 40)[0] || big[big.length - 1] || midHigh;
    mainPicks = [safe, midHigh, high].filter((p, i, arr) => arr.findIndex(q => q.score === p.score) === i);
    if (mainPicks.length < 3) {
      const sorted = all.slice().sort((a, b) => a.odds - b.odds);
      for (const s of sorted) if (!mainPicks.find(p => p.score === s.score)) mainPicks.push(s);
    }
    mainPicks = mainPicks.slice(0, 3);
  } else if (type === 'WEAK_MATCH') {
    // WEAK_MATCH: 2x@10-30 (主体) + 1x@30-50 (赌大冷门)
    const mainPool = all.filter(s => s.total >= 1 && s.total <= 4).sort((a, b) => b.odds - a.odds);
    const corePicks = mainPool.filter(s => s.odds >= 10 && s.odds <= 30).slice(0, 2);
    const upsetPick = mainPool.filter(s => s.odds > 30 && s.odds <= 50)[0];
    mainPicks = corePicks.concat(upsetPick ? [upsetPick] : []);
    if (mainPicks.length < 3) {
      const filler = all.slice().sort((a, b) => a.odds - b.odds).filter(s => !mainPicks.find(p => p.score === s.score));
      mainPicks = mainPicks.concat(filler).slice(0, 3);
    }
  } else {
    // NORMAL: 1平局保底 + 3-4球@7-15方向爆冷 + 中赔率平局或低赔率方向小胜
    const draws = all.filter(s => s.home === s.away).sort((a, b) => a.odds - b.odds);
    if (draws[0]) mainPicks.push(draws[0]);
    const upsetPick = all.filter(s => (s.total >= 3 && s.total <= 4) && (s.odds >= 7 && s.odds <= 15) && dirMatch(s)).sort((a, b) => a.odds - b.odds)[0];
    if (upsetPick) mainPicks.push(upsetPick);
    if (draws[1] && draws[1].odds < 15 && !mainPicks.find(p => p.score === draws[1].score)) mainPicks.push(draws[1]);
    const sorted = all.slice().sort((a, b) => a.odds - b.odds);
    for (const s of sorted) if (!mainPicks.find(p => p.score === s.score)) mainPicks.push(s);
    mainPicks = mainPicks.slice(0, 3);
  }

  return mainPicks;
}

// ============================================================
// 单关策略: BIG_BALL→反方向/平局高赔率, WEAK_MATCH→2个@25-50, NORMAL→不推
// ============================================================
function singleBetStrategy(m, mainPicks) {
  const type = classifyMatch(m);
  const all = parseOdds(m.bf);
  const dir = m.handicap <= 0 ? 'home' : 'away';
  const dirMatch = (s) => dir === 'home' ? s.home >= s.away : s.away >= s.home;
  const existingScores = new Set(mainPicks.map(p => p.score));
  const notInMain = (s) => !existingScores.has(s.score);

  if (type === 'BIG_BALL') {
    // 反方向/平局高赔率比分, 赔率@25-65, 进球数合理, 取赔率最低的1-2个
    const anti = all.filter(s => !dirMatch(s) && s.total >= 1 && s.total <= 6 && s.odds >= 25 && s.odds <= 65 && notInMain(s))
                    .sort((a, b) => a.odds - b.odds);
    return anti.slice(0, 2);
  } else if (type === 'WEAK_MATCH') {
    // 弱弱对阵: 赔率@25-50 高赔率比分
    const weak = all.filter(s => s.total >= 1 && s.total <= 4 && s.odds >= 25 && s.odds <= 50 && notInMain(s))
                    .sort((a, b) => a.odds - b.odds);
    return weak.slice(0, 2);
  } else {
    // NORMAL: 不推单关
    return [];
  }
}

// ============================================================
// 生成组合 (2串1 / 3串1)
// ============================================================
function generateCombos(matches) {
  // 2串1: 所有两两组合
  const c2 = [];
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      for (const pi of matches[i].mainPicks) {
        for (const pj of matches[j].mainPicks) {
          c2.push({
            matches: [matches[i].code, matches[j].code],
            picks: [{ match: matches[i].match, score: pi.score, odds: pi.odds }, { match: matches[j].match, score: pj.score, odds: pj.odds }],
            odds: +(pi.odds * pj.odds).toFixed(2),
          });
        }
      }
    }
  }
  c2.sort((a, b) => b.odds - a.odds);

  // 3串1: 所有三三元组合
  const c3 = [];
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      for (let k = j + 1; k < matches.length; k++) {
        for (const pi of matches[i].mainPicks) {
          for (const pj of matches[j].mainPicks) {
            for (const pk of matches[k].mainPicks) {
              c3.push({
                matches: [matches[i].code, matches[j].code, matches[k].code],
                picks: [
                  { match: matches[i].match, score: pi.score, odds: pi.odds },
                  { match: matches[j].match, score: pj.score, odds: pj.odds },
                  { match: matches[k].match, score: pk.score, odds: pk.odds },
                ],
                odds: +(pi.odds * pj.odds * pk.odds).toFixed(2),
              });
            }
          }
        }
      }
    }
  }
  c3.sort((a, b) => b.odds - a.odds);

  return { c2: c2.slice(0, 10), c3: c3.slice(0, 10) };
}

// ============================================================
// 预测模式: 预测今日比赛 (无result文件的比赛)
// ============================================================
function runPredict() {
  // 找所有 odds 文件, 过滤: 世界杯 + 无result文件
  const oddsFiles = fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort();
  const todayMatches = [];

  for (const f of oddsFiles) {
    const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
    if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
    const mid = oddsDoc.basic.mid;
    const resultPath = path.join(RESULTS_DIR, mid + '.json');
    if (fs.existsSync(resultPath)) continue; // 已有结果的跳过
    if (oddsDoc.basic.is_cancel) continue;
    if (!oddsDoc.odds || !oddsDoc.odds.bf_latest) continue; // 需要比分赔率数据
    todayMatches.push({
      code: oddsDoc.basic.code,
      mid,
      home: oddsDoc.basic.home,
      away: oddsDoc.basic.away,
      match: `${oddsDoc.basic.home}vs${oddsDoc.basic.away}`,
      kickoff: oddsDoc.basic.kickoff,
      handicap: oddsDoc.odds.handicap ?? 0,
      spf: oddsDoc.odds.spf_latest,
      rqspf: oddsDoc.odds.rqspf_latest,
      bf: oddsDoc.odds.bf_latest,
    });
  }

  todayMatches.sort((a, b) => a.code.localeCompare(b.code, 'zh-CN', { numeric: true }));

  if (todayMatches.length === 0) {
    console.log('无待预测比赛');
    return;
  }

  // 对每场比赛应用 F4 + 单关策略
  const matchPredictions = todayMatches.map(m => {
    const type = classifyMatch(m);
    const mainPicks = f4Strategy(m);
    const singleBets = singleBetStrategy(m, mainPicks);
    return { ...m, type, mainPicks, singleBets };
  });

  // 生成组合
  const combos = generateCombos(matchPredictions);

  // 输出日期
  const today = matchPredictions[0].kickoff ? matchPredictions[0].kickoff.split(' ')[0]
               : new Date().toISOString().split('T')[0];

  // ======= 控制台输出 =======
  console.log(`\n[31号策略] 目标日期: ${today} (预测模式)`);
  console.log(`[输入] ${matchPredictions.length} 场 ${today} 比赛 (预测模式)\n`);

  console.log(`# 31号策略 预测报告 (${today})\n`);
  console.log(`| 场次 | 对阵 | 类型 | handicap | spf(主/平/客) | 主池3比分 | 单关比分 |`);
  console.log(`|------|------|------|----------|---------------|-----------|----------|`);
  for (const p of matchPredictions) {
    const mainStr = p.mainPicks.map(x => `${x.score}@${x.odds}`).join(' ');
    const singleStr = p.singleBets.length ? p.singleBets.map(x => `${x.score}@${x.odds}`).join(' ') : '-';
    console.log(`| ${p.code} | ${p.match} | ${p.type} | ${p.handicap} | ${p.spf.home}/${p.spf.draw}/${p.spf.away} | ${mainStr} | ${singleStr} |`);
  }

  // 单关单独列出
  const hasSingle = matchPredictions.some(p => p.singleBets.length > 0);
  if (hasSingle) {
    console.log(`\n## 单关建议 (高赔率爆冷, 赔率@25-65, 独立推荐, 不影响主池)\n`);
    for (const p of matchPredictions) {
      if (p.singleBets.length > 0) {
        console.log(`  ${p.code} ${p.match} (${p.type}): ${p.singleBets.map(x => `${x.score}@${x.odds}`).join(' / ')}`);
      }
    }
  }

  // 2串1 TOP推荐
  if (combos.c2.length > 0) {
    console.log(`\n## 2串1 比分 TOP组合 (赔率排序, 取前10)\n`);
    console.log(`| 组合 | 赔率 |`);
    console.log(`|------|------|`);
    for (const c of combos.c2) {
      const desc = c.picks.map(p => `${p.match} ${p.score}@${p.odds}`).join(' × ');
      console.log(`| ${desc} | ${c.odds} |`);
    }
  }

  // 3串1 TOP推荐
  if (combos.c3.length > 0) {
    console.log(`\n## 3串1 比分 TOP组合 (赔率排序, 取前10)\n`);
    console.log(`| 组合 | 赔率 |`);
    console.log(`|------|------|`);
    for (const c of combos.c3) {
      const desc = c.picks.map(p => `${p.match} ${p.score}@${p.odds}`).join(' × ');
      console.log(`| ${desc} | ${c.odds} |`);
    }
  }

  // ======= 写入 JSON =======
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const jsonOut = {
    date: today,
    strategy: '31号策略 (F4主池 + 反方向单关)',
    matches: matchPredictions.map(p => ({
      code: p.code,
      mid: p.mid,
      match: p.match,
      home: p.home,
      away: p.away,
      kickoff: p.kickoff,
      type: p.type,
      handicap: p.handicap,
      spf: p.spf,
      rqspf: p.rqspf,
      mainPicks: p.mainPicks.map(x => ({ score: x.score, odds: x.odds })),
      singleBets: p.singleBets.map(x => ({ score: x.score, odds: x.odds })),
    })),
    combos,
  };
  const outPath = path.join(ARTIFACTS_DIR, `predict_31_${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(jsonOut, null, 2), 'utf-8');
  console.log(`\n报告写入: ${outPath}`);
}

// ============================================================
// 回测模式: 对有结果的比赛应用策略并报告 ROI
// ============================================================
function runBacktest() {
  const matches_ = [];
  for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
    const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
    if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
    const mid = oddsDoc.basic.mid;
    const resultPath = path.join(RESULTS_DIR, mid + '.json');
    if (!fs.existsSync(resultPath)) continue;
    const actual = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    matches_.push({
      code: oddsDoc.basic.code,
      home: oddsDoc.basic.home,
      away: oddsDoc.basic.away,
      handicap: oddsDoc.odds.handicap ?? 0,
      bf: oddsDoc.odds.bf_latest,
      actualHome: actual.homeScore,
      actualAway: actual.awayScore,
    });
  }

  if (matches_.length === 0) {
    console.log('无历史比赛可回测');
    return;
  }

  // 主池 ROI
  let mainCost = 0, mainReturn = 0, mainHits = 0;
  const details = [];
  for (const m of matches_) {
    mainCost += 3;
    const picks = f4Strategy(m);
    const actual = `${m.actualHome}:${m.actualAway}`;
    const hit = picks.find(p => p.score === actual);
    if (hit) { mainReturn += hit.odds; mainHits++; }
    details.push({
      code: m.code, match: `${m.home}vs${m.away}`, type: classifyMatch(m),
      actual, picks: picks.map(p => `${p.score}@${p.odds}`),
      hit: !!hit, hitOdds: hit ? hit.odds : 0,
    });
  }

  // 单关 ROI
  let singleCost = 0, singleReturn = 0, singleHits = 0;
  for (const m of matches_) {
    const picks = f4Strategy(m);
    const singles = singleBetStrategy(m, picks);
    if (singles.length === 0) continue;
    const actual = `${m.actualHome}:${m.actualAway}`;
    singleCost += singles.length;
    const hit = singles.find(p => p.score === actual);
    if (hit) { singleReturn += hit.odds; singleHits++; }
  }

  console.log(`\n## 31号策略 回测 (${matches_.length} 场)\n`);
  console.log(`| 部分 | 命中 | 投入 | 回报 | ROI |`);
  console.log(`|------|------|------|------|-----|`);
  console.log(`| 主池(F4) | ${mainHits}/${matches_.length} | $${mainCost} | $${mainReturn.toFixed(2)} | ${mainCost > 0 ? ((mainReturn - mainCost) / mainCost * 100).toFixed(0) : 0}% |`);
  console.log(`| 单关 | ${singleHits} | $${singleCost} | $${singleReturn.toFixed(2)} | ${singleCost > 0 ? ((singleReturn - singleCost) / singleCost * 100).toFixed(0) : 0}% |`);
  const totalCost = mainCost + singleCost;
  const totalReturn = mainReturn + singleReturn;
  console.log(`| **合计** | - | **$${totalCost}** | **$${totalReturn.toFixed(2)}** | **${totalCost > 0 ? ((totalReturn - totalCost) / totalCost * 100).toFixed(0) : 0}%** |`);

  console.log(`\n### 每场详情\n`);
  console.log(`| 场次 | 对阵 | 类型 | 实际 | 主池3比分 | 命中? |`);
  for (const d of details) {
    console.log(`| ${d.code} | ${d.match} | ${d.type} | ${d.actual} | ${d.picks.join(' ')} | ${d.hit ? `✅@${d.hitOdds}` : '❌'} |`);
  }
}

// ============================================================
// 主入口: 默认 predict, --backtest 触发回测
// ============================================================
const args = process.argv.slice(2);
if (args.includes('--backtest')) {
  runBacktest();
} else {
  runPredict();
}
