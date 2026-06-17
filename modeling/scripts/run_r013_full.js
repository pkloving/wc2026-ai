// run_r013_full.js — 全量回测 R-013 rqspf 验证
// 遍历所有有结果的比赛日期，逐日运行 12_r013_user_rules.js 并汇总

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const oddsDir = path.join(PROJECT_ROOT, 'data', 'odds');
const resultsDir = path.join(PROJECT_ROOT, 'data', 'results');

// 1. 收集所有有结果的比赛 mid
const resultFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
const midsWithResult = new Set(resultFiles.map(f => f.replace('.json', '')));

// 2. 从 odds 文件中提取这些 mid 对应的 kickoff 日期
//    与 12 号脚本口径一致：只统计世界杯正赛(league==='世界杯')，剔除国际友谊赛
//    这样只含友谊赛的日期(如 2026-06-09)不会进入回测、避免出现误导性的 ERROR 行
const dateSet = new Set();
for (const mid of midsWithResult) {
  const oddsPath = path.join(oddsDir, `${mid}.json`);
  if (!fs.existsSync(oddsPath)) continue;
  const doc = JSON.parse(fs.readFileSync(oddsPath, 'utf-8'));
  if (doc.basic?.league !== '世界杯') continue;
  const kickoff = doc.basic?.kickoff || '';
  const date = kickoff.slice(0, 10); // YYYY-MM-DD
  if (date) dateSet.add(date);
}

const dates = [...dateSet].sort();
console.log(`[全量回测] 共 ${dates.length} 个日期: ${dates.join(', ')}`);
console.log(`[全量回测] 共 ${midsWithResult.size} 场有结果的比赛\n`);

// 3. 逐日运行
let totalMatches = 0;
let totalRqHit = 0;
let totalBfHit = 0;
// rqspf 拆分口径 + ROI 累计
let totalSingle = 0, totalSingleHit = 0;   // 单选场次（picks.length<=1）
let totalCover = 0, totalCoverHit = 0;      // 2边覆盖场次（picks.length>=2）
let totalRqStake = 0, totalRqRet = 0;       // rqspf 折算 ROI：每个 pick 1 注

const rqMap = { home_win: 'home', away_win: 'away', draw: 'draw', home: 'home', away: 'away' };

// 从某日产物 JSON 重算 rqspf 拆分命中 + ROI（与下注逻辑同源、可复现，不依赖 stdout 文本）
function deriveRqStats(date) {
  const artifactPath = path.join(PROJECT_ROOT, 'modeling', 'artifacts', `backtest_r013_${date}.json`);
  const stats = {
    single: 0, singleHit: 0, cover: 0, coverHit: 0, stake: 0, ret: 0,
  };
  if (!fs.existsSync(artifactPath)) return stats;
  const r = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  for (const m of r.matches || []) {
    if (!m.actual) continue;
    const picks = m.rqspf_picks?.picks || [];
    if (picks.length === 0) continue;
    const actual = rqMap[m.actual.handicapResult || m.actual.winner];
    const hit = picks.includes(actual);
    if (picks.length <= 1) { stats.single++; if (hit) stats.singleHit++; }
    else { stats.cover++; if (hit) stats.coverHit++; }
    // ROI：每个 pick 当 1 注下注，命中 pick 按其 rqspf 赔率赔付
    for (const p of picks) {
      stats.stake += 1;
      if (p === actual) stats.ret += (m.rqspf?.[p] || 0);
    }
  }
  return stats;
}

const dailyResults = [];

for (const date of dates) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`>>> 回测日期: ${date}`);
  console.log('='.repeat(80));

  try {
    const output = execSync(
      `node "${path.join(__dirname, '12_r013_user_rules.js')}" ${date}`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 }
    );
    console.log(output);

    // 解析汇总行
    const matchLine = output.match(/总场数:\s*(\d+)/);
    const rqLine = output.match(/rqspf 命中:\s*(\d+)\/(\d+)/);
    const bfLine = output.match(/比分命中\(3中1\):\s*(\d+)\/(\d+)/);

    const matches = matchLine ? parseInt(matchLine[1]) : 0;
    const rqHit = rqLine ? parseInt(rqLine[1]) : 0;
    const bfHit = bfLine ? parseInt(bfLine[1]) : 0;

    // 从当日产物重算拆分口径 + ROI（12 号脚本刚把产物写好）
    const s = deriveRqStats(date);

    totalMatches += matches;
    totalRqHit += rqHit;
    totalBfHit += bfHit;
    totalSingle += s.single; totalSingleHit += s.singleHit;
    totalCover += s.cover; totalCoverHit += s.coverHit;
    totalRqStake += s.stake; totalRqRet += s.ret;

    dailyResults.push({ date, matches, rqHit, bfHit, ...s });
  } catch (e) {
    console.error(`[错误] ${date}: ${e.message}`);
    dailyResults.push({ date, matches: 0, rqHit: 0, bfHit: 0, single: 0, singleHit: 0, cover: 0, coverHit: 0, stake: 0, ret: 0, error: true });
  }
}

// 4. 汇总报告
console.log(`\n${'='.repeat(80)}`);
console.log('>>> 全量回测汇总 (R-013 rqspf 验证)');
console.log('='.repeat(80));

const pct = (h, n) => n ? Math.round(h / n * 100) + '%' : '-';

// 表1：原合并口径 + 比分（保留，但合并口径仅作参考）
console.log('\n| 日期 | 场数 | rqspf命中(任意pick) | 命中率 | 比分命中(3中1) | 比分命中率 |');
console.log('|------|------|---------------------|--------|----------------|------------|');
for (const d of dailyResults) {
  if (d.error) {
    console.log(`| ${d.date} | - | - | ERROR | - | - |`);
  } else {
    console.log(`| ${d.date} | ${d.matches} | ${d.rqHit}/${d.matches} | ${pct(d.rqHit, d.matches)} | ${d.bfHit}/${d.matches} | ${pct(d.bfHit, d.matches)} |`);
  }
}

// 表2：rqspf 拆分口径（单选 vs 2边覆盖）+ 折算 ROI
console.log('\n### rqspf 拆分口径（避免"任意pick命中"虚高）+ 折算 ROI');
console.log('| 日期 | 单选命中 | 单选命中率 | 2边覆盖命中 | 2边命中率 | 投注注数 | 赔付 | ROI |');
console.log('|------|----------|------------|-------------|-----------|----------|------|-----|');
for (const d of dailyResults) {
  if (d.error) { console.log(`| ${d.date} | - | ERROR | - | - | - | - | - |`); continue; }
  const roi = d.stake ? ((d.ret - d.stake) / d.stake * 100).toFixed(1) + '%' : '-';
  console.log(`| ${d.date} | ${d.singleHit}/${d.single} | ${pct(d.singleHit, d.single)} | ${d.coverHit}/${d.cover} | ${pct(d.coverHit, d.cover)} | ${d.stake} | ${d.ret.toFixed(2)} | ${roi} |`);
}

const overallRqRate = totalMatches ? Math.round(totalRqHit / totalMatches * 100) : 0;
const overallBfRate = totalMatches ? Math.round(totalBfHit / totalMatches * 100) : 0;
const overallRoi = totalRqStake ? ((totalRqRet - totalRqStake) / totalRqStake * 100).toFixed(1) + '%' : '-';

console.log(`\n## 总计`);
console.log(`- 总日期数: ${dates.length}`);
console.log(`- 总场数: ${totalMatches}`);
console.log(`- rqspf 合并口径(任意pick命中, 仅参考): ${totalRqHit}/${totalMatches} = ${overallRqRate}%`);
console.log(`- rqspf 单选命中: ${totalSingleHit}/${totalSingle} = ${pct(totalSingleHit, totalSingle)}`);
console.log(`- rqspf 2边覆盖命中: ${totalCoverHit}/${totalCover} = ${pct(totalCoverHit, totalCover)}`);
console.log(`- rqspf 折算ROI(每pick 1注, 命中按rqspf赔率赔付): 投注${totalRqStake}注 / 赔付${totalRqRet.toFixed(2)} / ROI ${overallRoi}`);
console.log(`- 比分总命中(3中1): ${totalBfHit}/${totalMatches} = ${overallBfRate}%`);
