#!/usr/bin/env node
// scripts/fill_matches_final_score.js — 把 data/matches.json 里已完赛但缺
// final_score 的场从 views (5 玩法) 兜底补全。
//
// 触发: data/matches.json 大面积缺 final_score (39 场小组赛) 时一次性补
// 依赖: 5 个 view 文件 (data/views/{spf,rqspf,zjq,bqc,bf}_view.json)
// 输出: 原地改 data/matches.json; 备份 .bak.<ts>
//
// 用法:
//   node scripts/fill_matches_final_score.js          # 写盘 (有备份)
//   node scripts/fill_matches_final_score.js --dry   # 只打印, 不写盘

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const MATCHES = path.join(PROJECT_ROOT, 'data', 'matches.json');

const isDry = process.argv.includes('--dry');

// 1) 索引: 5 个 view 里 mid → final_score (取第一个非空)
const plays = ['spf', 'rqspf', 'zjq', 'bqc', 'bf'];
const viewByMid = {};
for (const p of plays) {
  const f = path.join(PROJECT_ROOT, 'data', 'views', `${p}_view.json`);
  if (!fs.existsSync(f)) continue;
  const rows = JSON.parse(fs.readFileSync(f, 'utf-8')).rows || [];
  for (const r of rows) {
    if (r.mid && r.final_score && !viewByMid[r.mid]) {
      viewByMid[r.mid] = r.final_score;
    }
  }
}

const matches = JSON.parse(fs.readFileSync(MATCHES, 'utf-8'));
let filled = 0, stillMissing = [];
for (const m of matches) {
  if (m.final_score) continue;
  // 优先 view, 兜底 data/results/<mid>.json
  let score = viewByMid[m.mid] || null;
  if (!score && m.mid) {
    const r = path.join(PROJECT_ROOT, 'data', 'results', `${m.mid}.json`);
    if (fs.existsSync(r)) {
      try {
        const j = JSON.parse(fs.readFileSync(r, 'utf-8'));
        if (Number.isFinite(j.homeScore) && Number.isFinite(j.awayScore)) {
          score = `${j.homeScore}:${j.awayScore}`;
        }
      } catch {}
    }
  }
  if (score) {
    m.final_score = score;
    filled++;
  } else {
    stillMissing.push(m);
  }
}

if (filled === 0) {
  console.log('[fill] 没有需要补 final_score 的场 (matches.json 已完整或无源数据)。');
  process.exit(0);
}

if (isDry) {
  console.log(`[fill --dry] 将要补 ${filled} 场 final_score。`);
  for (const m of stillMissing.slice(0, 8)) console.log(`  仍缺: ${m.mid || '(no-mid)'} ${m.id} ${m.home} vs ${m.away} (${m.stage})`);
  if (stillMissing.length > 8) console.log(`  ... 还 ${stillMissing.length - 8} 场`);
  process.exit(0);
}

const bak = `${MATCHES}.bak.${Date.now()}`;
fs.copyFileSync(MATCHES, bak);
fs.writeFileSync(MATCHES, JSON.stringify(matches, null, 2));
console.log(`[fill] 已补 ${filled} 场 final_score. 备份: ${path.basename(bak)}`);
if (stillMissing.length) {
  console.log(`[fill] 仍缺 ${stillMissing.length} 场 (无 view 源 + 无 results/ 文件 + 多数是 M097-M104 未开赛):`);
  for (const m of stillMissing.slice(0, 8)) console.log(`  ${m.mid || '(no-mid)'} ${m.id} ${m.home} vs ${m.away} (${m.stage})`);
  if (stillMissing.length > 8) console.log(`  ... 还 ${stillMissing.length - 8} 场`);
}
