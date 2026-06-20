#!/usr/bin/env node
// build_views.js — 把 data/settled_matches.json 按玩法维度拆成独立视图文件
// 用法:
//   node scripts/build_views.js                 # 全部重建
//   node scripts/build_views.js --incremental   # 增量(同 build_settled)
//
// 输出: data/views/{spf,rqspf,bf,zjq,bqc}_view.json (本届: 2026)
//       data/2022wc/views/{spf,rqspf,bf,zjq,bqc}_view.json (上届: 2022)
//   每个文件 = 比赛数组, 字段:
//     mid / code / home / away / kickoff / handicap / final_score
//     initial / last / result
//   spf/rqspf 的 result = 'home'|'draw'|'away'
//   bf 的 result = { score, other }
//   zjq/bqc 的 result = 字符串 ('胜胜' / '2' 等)
//
// 拆分规则: 用 m.kickoff 起始 4 位 ('YYYY') 判断年份
//   2022 → data/2022wc/views/
//   2026 → data/views/
//   其它年份 → 也按年份落到 data/<YYYY>wc/views/ (兜底)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const SETTLED_FILE = path.join(PROJECT_ROOT, 'data', 'settled_matches.json');
const VIEWS_2026 = path.join(PROJECT_ROOT, 'data', 'views');
const VIEWS_2022 = path.join(PROJECT_ROOT, 'data', '2022wc', 'views');

const PLAYS = ['spf', 'rqspf', 'bf', 'zjq', 'bqc'];

// ============== 加载赛果汇总 ==============
if (!fs.existsSync(SETTLED_FILE)) {
  console.error(`[build_views] 找不到 ${SETTLED_FILE}, 请先跑 scripts/build_settled.js`);
  process.exit(0);
}
const doc = JSON.parse(fs.readFileSync(SETTLED_FILE, 'utf-8'));
const matches = doc.matches || [];
if (matches.length === 0) {
  console.error(`[build_views] ${SETTLED_FILE} 没有比赛, 跳过`);
  process.exit(0);
}

// 按年份分桶: '2022' / '2026' / 其它
function yearOf(m) {
  const k = m?.kickoff;
  if (typeof k !== 'string' || k.length < 4) return 'unknown';
  return k.slice(0, 4);
}
const matchesByYear = {};
for (const m of matches) {
  const y = yearOf(m);
  if (!matchesByYear[y]) matchesByYear[y] = [];
  matchesByYear[y].push(m);
}

// 输出目录映射: 2022 → data/2022wc/views, 2026 → data/views, 其它 → data/<y>wc/views
function outDirFor(year) {
  if (year === '2026') return VIEWS_2026;
  if (year === '2022') return VIEWS_2022;
  return path.join(PROJECT_ROOT, 'data', `${year}wc`, 'views');
}
const years = Object.keys(matchesByYear).sort();
if (years.length > 1) {
  console.log(`[build_views] 检测到多年份数据: ${years.map(y => `${y}=${matchesByYear[y].length}场`).join(', ')}`);
}

// 世界杯正赛 only (按 m.league === '世界杯') 用于 *_wc_view.json
function isWc(m) { return m.league === '世界杯'; }

if (!fs.existsSync(VIEWS_2026)) fs.mkdirSync(VIEWS_2026, { recursive: true });
if (!fs.existsSync(VIEWS_2022)) fs.mkdirSync(VIEWS_2022, { recursive: true });

// 共同基础字段
function baseOf(m) {
  return {
    mid: m.mid,
    code: m.code,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    handicap: m.handicap,
    final_score: m.result ? `${m.result.home}:${m.result.away}` : null,
  };
}

// 提取单个玩法的视图
function viewOf(play, m) {
  const cell = m[play];
  if (!cell) return null;
  return {
    ...baseOf(m),
    initial: cell.initial || null,
    last: cell.last || null,
    result: cell.result || null,
  };
}

function writePlay(outDir, play, rows, wcOnly) {
  const suffix = wcOnly ? '_wc' : '';
  const outFile = path.join(outDir, `${play}${suffix}_view.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    play,
    count: rows.length,
    rows,
  }, null, 2), 'utf-8');
  return outFile;
}

for (const year of years) {
  const yearMatches = matchesByYear[year];
  const yearMatchesWc = yearMatches.filter(isWc);
  const outDir = outDirFor(year);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 全部
  for (const play of PLAYS) {
    const rows = yearMatches
      .map(m => viewOf(play, m))
      .filter(r => r && (r.initial || r.last || r.result));
    const outFile = writePlay(outDir, play, rows, false);
    console.log(`[build_views][${year}] ${play}: ${rows.length} 条 → ${path.relative(PROJECT_ROOT, outFile)}`);
  }
  // 世界杯正赛 only
  if (yearMatchesWc.length > 0 && yearMatchesWc.length < yearMatches.length) {
    for (const play of PLAYS) {
      const rows = yearMatchesWc
        .map(m => viewOf(play, m))
        .filter(r => r && (r.initial || r.last || r.result));
      const outFile = writePlay(outDir, play, rows, true);
      console.log(`[build_views][${year}] ${play}: ${rows.length} 条 (WC only) → ${path.relative(PROJECT_ROOT, outFile)}`);
    }
  }

  // 索引
  const indexFile = path.join(outDir, 'index.json');
  const summary = { generated_at: new Date().toISOString(), total_matches: new Set(yearMatches.map(m => m.mid)).size, plays: {} };
  // 从刚写出的文件回读, 用更准确 count
  for (const f of fs.readdirSync(outDir).filter(x => x.endsWith('.json') && x !== 'index.json')) {
    const v = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf-8'));
    summary.plays[v.play + (f.includes('_wc_') ? '_wc' : '')] = v.count;
  }
  fs.writeFileSync(indexFile, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`[build_views][${year}] 索引 → ${path.relative(PROJECT_ROOT, indexFile)}`);
}

console.log(`[build_views] 完成, 总 ${matches.length} 场 (${years.map(y => `${y}=${matchesByYear[y].length}`).join(', ')})`);
