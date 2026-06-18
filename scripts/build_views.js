#!/usr/bin/env node
// build_views.js — 把 data/settled_matches.json 按玩法维度拆成独立视图文件
// 用法:
//   node scripts/build_views.js                 # 全部重建
//   node scripts/build_views.js --incremental   # 增量(同 build_settled)
//
// 输出: data/views/{spf,rqspf,bf,zjq,bqc}_view.json
//   每个文件 = 比赛数组, 字段:
//     mid / code / home / away / kickoff / handicap / final_score
//     initial / last / result
//   spf/rqspf 的 result = 'home'|'draw'|'away'
//   bf 的 result = { score, other }
//   zjq/bqc 的 result = 字符串 ('胜胜' / '2' 等)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const SETTLED_FILE = path.join(PROJECT_ROOT, 'data', 'settled_matches.json');
const VIEWS_DIR = path.join(PROJECT_ROOT, 'data', 'views');

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

// 拆分: 全部 / 世界杯正赛 only
const matchesAll = matches;
const matchesWc = matches.filter(m => m.league === '世界杯');
if (matchesAll.length > matchesWc.length) {
  console.log(`[build_views] ⚠️ 含 ${matchesAll.length - matchesWc.length} 场非世界杯正赛 (国际赛), 默认全输出, 世界杯正赛见 *_wc_view.json`);
}

if (!fs.existsSync(VIEWS_DIR)) fs.mkdirSync(VIEWS_DIR, { recursive: true });

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

let summary = { generated_at: new Date().toISOString(), total_matches: matches.length, plays: {} };
for (const play of PLAYS) {
  const rows = matchesAll
    .map(m => viewOf(play, m))
    .filter(r => r && (r.initial || r.last || r.result));
  const outFile = path.join(VIEWS_DIR, `${play}_view.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    play,
    count: rows.length,
    rows,
  }, null, 2), 'utf-8');
  summary.plays[play] = rows.length;
  console.log(`[build_views] ${play}: ${rows.length} 条 → data/views/${play}_view.json`);
}

// 世界杯正赛 only 视图 (去除国际赛)
if (matchesWc.length > 0 && matchesWc.length < matchesAll.length) {
  for (const play of PLAYS) {
    const rows = matchesWc
      .map(m => viewOf(play, m))
      .filter(r => r && (r.initial || r.last || r.result));
    const outFile = path.join(VIEWS_DIR, `${play}_wc_view.json`);
    fs.writeFileSync(outFile, JSON.stringify({
      generated_at: new Date().toISOString(),
      play,
      count: rows.length,
      rows,
    }, null, 2), 'utf-8');
    summary.plays[`${play}_wc`] = rows.length;
    console.log(`[build_views] ${play}: ${rows.length} 条 (WC only) → data/views/${play}_wc_view.json`);
  }
}

// 总览索引
const indexFile = path.join(VIEWS_DIR, 'index.json');
fs.writeFileSync(indexFile, JSON.stringify(summary, null, 2), 'utf-8');
console.log(`[build_views] 索引 → data/views/index.json`);
console.log(`[build_views] 完成, 全部 ${matchesAll.length} 场, 世界杯正赛 ${matchesWc.length} 场`);
