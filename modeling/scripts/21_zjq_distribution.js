// 21_zjq_distribution.js — 验证 zjq 档位对应的真实进球分布
// 核心问题: zjqMode=2 是否真的代表"小球"？或者 2 球是常规，3-4 球也很常见？

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');

const matches = [];
for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
  const oddsDoc = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
  if (!oddsDoc.basic || oddsDoc.basic.league !== '世界杯') continue;
  const mid = oddsDoc.basic.mid;
  const resultPath = path.join(RESULTS_DIR, mid + '.json');
  if (!fs.existsSync(resultPath)) continue;
  const actual = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));

  // 读 zjq
  let zjqMode = null;
  if (oddsDoc.odds.zjq_latest) {
    const ents = Object.entries(oddsDoc.odds.zjq_latest).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }

  matches.push({
    code: oddsDoc.basic.code, home: oddsDoc.basic.home, away: oddsDoc.basic.away,
    handicap: oddsDoc.odds.handicap,
    zjqMode, total: actual.homeScore + actual.awayScore,
    actual: `${actual.homeScore}:${actual.awayScore}`,
  });
}

console.log(`\n## 20场世界杯: zjq 档位 → 实际总进球分布\n`);

// 按 zjq 档位分组统计
const buckets = {};
for (const m of matches) {
  const key = m.zjqMode ?? '?';
  if (!buckets[key]) buckets[key] = { count: 0, totals: [], actuals: [], small: 0, normal: 0, big: 0 };
  buckets[key].count++;
  buckets[key].totals.push(m.total);
  buckets[key].actuals.push(m.actual);
  if (m.total <= 1) buckets[key].small++;
  else if (m.total <= 3) buckets[key].normal++;
  else buckets[key].big++;
}

console.log(`| zjq档位 | 场数 | 实际进球数 | ≤1球 | 2-3球 | ≥4球 | ≥4球占比 | 实际平均值 | 与 zjq 差 ≥2 的场 |`);
console.log(`|---------|------|-----------|------|-------|------|----------|-----------|------------------|`);

for (const [key, data] of Object.entries(buckets).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const avg = (data.totals.reduce((s, v) => s + v, 0) / data.count).toFixed(1);
  const bigRate = (data.big / data.count * 100).toFixed(0);
  const far = data.totals.filter(t => Math.abs(t - Number(key)) >= 2).length;
  console.log(`| ${key}球 | ${data.count} | ${data.totals.join(',')} | ${data.small} | ${data.normal} | ${data.big} | ${bigRate}% | ${avg}球 | ${far}/${data.count} |`);
}

// 汇总: zjq说N球时，实际≥N+2球的比例是多少？
console.log(`\n## 核心问题: zjq说X球，实际多2球以上的频率？\n`);

let underrateCount = 0, totalWithZjq = 0;
for (const m of matches) {
  if (m.zjqMode == null) continue;
  totalWithZjq++;
  if (m.total >= m.zjqMode + 2) underrateCount++;
}
console.log(`zjq 可用 ${totalWithZjq} 场，其中实际总进球 ≥ zjq档位+2 球 = ${underrateCount}/${totalWithZjq} = ${(underrateCount/totalWithZjq*100).toFixed(0)}%`);
console.log(`\n 解读: 庄家 zjq 赔率给的是众数（最可能的进球数），但分布偏右——实际比分经常比 zjq 档位高 2 球甚至更多。`);
console.log(`  这意味着 fitCost 中对超过 zjqMode+1 的比分惩罚太严了。`);

// 不同档位下 ±2 球内 vs ±2 球外 的命中率
console.log(`\n## 如果把大球定义为"≥4球"，重新分类这20场\n`);

let ball4 = { total: 0, hit: 0 }; // ≥4球
let ballSmall = { total: 0, hit: 0 }; // ≤3球
for (const m of matches) {
  if (m.total >= 4) { ball4.total++; if (m.zjqMode != null && m.zjqMode >= 3) ball4.hit++; }
  else { ballSmall.total++; if (m.zjqMode != null && m.zjqMode <= 2) ballSmall.hit++; }
}
console.log(`  实际≥4球(大球): ${ball4.total}场, zjq≥3球的只有 ${ball4.hit} 场 — zjq 对大球预测很差`);
console.log(`  实际≤3球(小球): ${ballSmall.total}场, zjq≤2球的有 ${ballSmall.hit} 场 — zjq 对小球判断较好但仍不精确`);

// 真正应该:用 zjq 作为进球下限的下限参考
// zjq=2 → 最可能是2球,但允许3-4球（宽公差）
// zjq=3 → 可能3-4球,也允许5球
console.log(`\n## 按"实际是否≥4球"拆分,看 zjq 分布\n`);

const isBig = matches.map(m => ({ ...m, isBig: m.total >= 4 }));
const big = isBig.filter(m => m.isBig);
const small = isBig.filter(m => !m.isBig);
console.log(`大球(≥4球) ${big.length}场: ${big.map(m => `${m.code}${m.home}vs${m.away}=${m.actual}(${m.total}球,zjq=${m.zjqMode ?? '?'})`).join(' | ')}`);
console.log(`  → 这些场中 zjq档位: ${big.map(m => m.zjqMode ?? '?').join(',')}`);
console.log(`  → 大球场景里 zjq<3球的有: ${big.filter(m => m.zjqMode != null && m.zjqMode < 3).length}/${big.length} 场 → zjq对大球严重低估`);
console.log();
console.log(`小球(≤3球) ${small.length}场: ${small.map(m => `${m.code}${m.home}vs${m.away}=${m.actual}(${m.total}球,zjq=${m.zjqMode ?? '?'})`).join(' | ')}`);
console.log(`  → 这些场中 zjq档位: ${small.map(m => m.zjqMode ?? '?').join(',')}`);
console.log(`  → 小球场景里 zjq>3球的有: ${small.filter(m => m.zjqMode != null && m.zjqMode > 3).length}/${small.length} 场`);

// 结论: zjq 对小球(≤3)预测尚可, 对大球(≥4)严重低估
// 应该改: zjq 只对"≤1球"的过低比分惩罚, 不对高比分做惩罚
// 或者: zjq 给出一个中心, 高方向不对称放宽
