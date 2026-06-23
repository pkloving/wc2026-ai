#!/usr/bin/env node
// build_frequency_atlas.js — 从 5 玩法视图（2026 + 2022）汇总频率分布，写 data/frequency_atlas.json
//
// 用法:  node scripts/build_frequency_atlas.js
//
// 触发时机: 完赛补录后跑（wc2026-daily skill 内的 Step 1+2+3 之后）
//   - Step 1 写完赛结果 → 跑 build_settled.js  → 跑 build_views.js → 跑本脚本
//   - 本脚本只是「再聚合一层」出 5 玩法的频率直方图，喂给 frequency.html 页面
//
// 数据源:
//   - data/views/<play>_wc_view.json          (2026 美加墨 世界杯正赛)
//   - data/2022wc/views/<play>_wc_view.json   (2022 卡塔尔 世界杯正赛)
//
// 输出: data/frequency_atlas.json
//   {
//     generated_at, total_matches_2026, total_matches_2022,
//     y2026: { spf, rqspf, bf, zjq, bqc, meta },
//     y2022: { ... }
//   }
//
// 字段约定:
//   spf / rqspf: { counts: { home, draw, away }, total }
//   bf:          { top: [{ score, count, pct }], others: { '胜其它': count }, total }
//   zjq:         { buckets: [{ label, count, pct }], total }  // 0..6, 7+
//   bqc:         { buckets: [{ label, count, pct }], total }  // 9 个组合
//
// 设计取舍:
//   - WC only（不混国际赛/热身赛）—— 跟 *_wc_view.json 一致
//   - 不消费 odds，只消费 result（每场只记一票的命中/不命中）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

const SOURCES = [
  { year: 2026, dir: path.join(PROJECT_ROOT, 'data', 'views') },
  { year: 2022, dir: path.join(PROJECT_ROOT, 'data', '2022wc', 'views') },
];

const PLAYS = ['spf', 'rqspf', 'bf', 'zjq', 'bqc'];

// ---------- helpers ----------
function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function safeDiv(a, b) {
  return b > 0 ? +(a / b * 100).toFixed(1) : 0;
}

function pctBar(pct, maxPct, width = 30) {
  if (maxPct <= 0) return '';
  const filled = Math.max(1, Math.round((pct / maxPct) * width));
  return '█'.repeat(Math.min(filled, width));
}

// ---------- per-play 统计 ----------
function statSpf(rows) {
  const counts = { home: 0, draw: 0, away: 0 };
  let total = 0;
  for (const r of rows) {
    const v = r.result;
    if (v !== 'home' && v !== 'draw' && v !== 'away') continue;
    counts[v] += 1;
    total += 1;
  }
  return { counts, total };
}

function statRqspf(rows) {
  // result 同样是 home / draw / away（按让球后的方向）
  return statSpf(rows);
}

// 2022 视图 bqc.result 全是 null（缺半场比分），但 result 文件的 lottery.HAFU.combinationDesc
// 里有「胜胜 / 胜平 / 负负」等 BQC 9 组合。fallback 从 result 文件补。
const BQC_KEYS = new Set(['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负']);
function fillBqcFromResults(year, rows) {
  // 找 result 目录: 2022 在 data/2022wc/results/，2026 在 data/results/
  const candidates = year === 2022
    ? path.join(PROJECT_ROOT, 'data', '2022wc', 'results')
    : path.join(PROJECT_ROOT, 'data', 'results');
  for (const r of rows) {
    if (r.result != null) continue;
    if (!r.mid) continue;
    const f = path.join(candidates, `${r.mid}.json`);
    if (!fs.existsSync(f)) continue;
    try {
      const doc = loadJson(f);
      const desc = doc?.lottery?.HAFU?.combinationDesc;
      if (desc && BQC_KEYS.has(desc)) r.result = desc;
    } catch (_) {}
  }
  return rows;
}

function statBf(rows) {
  // result = { score: "1:0", other: null | "胜其它" | "平其它" | "负其它" }
  // 部分 view 文件没把 other 算对（build_settled 直接 score="h:a"），所以这里按竞彩规则再归类一次
  //   规则: 主胜差 ≥ 3 → 胜其它；客胜差 ≥ 3 → 负其它；4:4 / 5:5+ → 平其它；其它留具体比分
  const map = new Map(); // score -> count
  const others = { '胜其它': 0, '平其它': 0, '负其它': 0 };
  let total = 0;
  for (const r of rows) {
    const v = r.result;
    if (!v || typeof v !== 'object') continue;
    if (v.other && others[v.other] != null) {
      others[v.other] += 1;
      total += 1;
    } else if (v.score) {
      const c = classifyBfScore(v.score);
      if (c.other) {
        others[c.other] += 1;
        total += 1;
      } else {
        map.set(c.score, (map.get(c.score) || 0) + 1);
        total += 1;
      }
    }
  }
  const top = [...map.entries()]
    .map(([score, count]) => ({ score, count, pct: safeDiv(count, total) }))
    .sort((a, b) => b.count - a.count);
  return { top, others, total };
}

// 竞彩 BF 归类: 胜负差 ≥ 3 → 胜其它 / 负其它；平局 ≥ 4:4 → 平其它
function classifyBfScore(score) {
  const m = /^(\d+):(\d+)$/.exec(score);
  if (!m) return { score, other: null };
  const h = +m[1], a = +m[2];
  if (h === a) {
    if (h >= 4) return { score: null, other: '平其它' };
    return { score, other: null };
  }
  if (h - a >= 3) return { score: null, other: '胜其它' };
  if (a - h >= 3) return { score: null, other: '负其它' };
  return { score, other: null };
}

function statZjq(rows) {
  // result = "0" | "1" | ... | "6" | "7+"
  const order = ['0', '1', '2', '3', '4', '5', '6', '7+'];
  const counts = Object.fromEntries(order.map((k) => [k, 0]));
  let total = 0;
  for (const r of rows) {
    const v = r.result;
    if (v == null) continue;
    if (counts[v] != null) {
      counts[v] += 1;
      total += 1;
    }
  }
  // 5+ 合并为一段（5+球）→ 视觉上更紧凑，与 PNG 图一致
  const buckets = [
    { label: '0球', key: '0' },
    { label: '1球', key: '1' },
    { label: '2球', key: '2' },
    { label: '3球', key: '3' },
    { label: '4球', key: '4' },
    { label: '5+球', keys: ['5', '6', '7+'] },
  ].map((b) => {
    const count = b.keys ? b.keys.reduce((s, k) => s + (counts[k] || 0), 0) : (counts[b.key] || 0);
    return { label: b.label, count, pct: safeDiv(count, total) };
  });
  return { buckets, total };
}

function statBqc(rows) {
  // 9 个固定 key：胜胜/胜平/胜负/平胜/平平/平负/负胜/负平/负负
  const order = ['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负'];
  const counts = Object.fromEntries(order.map((k) => [k, 0]));
  let total = 0;
  for (const r of rows) {
    const v = r.result;
    if (v == null) continue;
    if (counts[v] != null) {
      counts[v] += 1;
      total += 1;
    }
  }
  const buckets = order.map((k) => ({ label: k, count: counts[k], pct: safeDiv(counts[k], total) }));
  return { buckets, total };
}

// ---------- 入口 ----------
function buildForYear(src) {
  const out = { total: 0, byPlay: {} };
  for (const play of PLAYS) {
    const file = path.join(src.dir, `${play}_wc_view.json`);
    if (!fs.existsSync(file)) {
      out.byPlay[play] = { total: 0, error: `missing ${path.relative(PROJECT_ROOT, file)}` };
      continue;
    }
    const view = loadJson(file);
    // BQC 2022 的 view 里 result 全是 null，filter 会被清空，所以这个玩法保留所有行
    // 让 fillBqcFromResults 从 result 文件补齐
    const rows = play === 'bqc'
      ? (view.rows || [])
      : (view.rows || []).filter((r) => r.result != null);
    // BQC 兜底：2022 视图里 bqc.result 全是 null，从 result 文件 lottery.HAFU 补
    const enriched = play === 'bqc' ? fillBqcFromResults(src.year, rows) : rows;
    let stat;
    if (play === 'spf') stat = statSpf(enriched);
    else if (play === 'rqspf') stat = statRqspf(enriched);
    else if (play === 'bf') stat = statBf(enriched);
    else if (play === 'zjq') stat = statZjq(enriched);
    else if (play === 'bqc') stat = statBqc(enriched);
    out.byPlay[play] = stat;
    out.total = Math.max(out.total, stat.total);
  }
  return out;
}

function main() {
  const payload = {
    generated_at: new Date().toISOString(),
    note: '由 scripts/build_frequency_atlas.js 从 data/views 与 data/2022wc/views 汇总',
  };
  for (const src of SOURCES) {
    const key = `y${src.year}`;
    const stat = buildForYear(src);
    payload[key] = stat;
    console.log(`[build_frequency_atlas] ${key}:`,
      PLAYS.map((p) => `${p}=${stat.byPlay[p]?.total ?? 0}`).join(' '));
  }

  // 写入主文件
  const outFile = path.join(PROJECT_ROOT, 'data', 'frequency_atlas.json');
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[build_frequency_atlas] 写入 ${path.relative(PROJECT_ROOT, outFile)}`);

  // 控制台摘要（直读 view 文件的人能一眼看到）
  for (const src of SOURCES) {
    const key = `y${src.year}`;
    const stat = payload[key];
    console.log(`\n=== ${key} 摘要 ===`);
    for (const play of PLAYS) {
      const s = stat.byPlay[play];
      if (!s) continue;
      if (play === 'spf' || play === 'rqspf') {
        const { counts, total } = s;
        console.log(`  ${play.toUpperCase()} (n=${total}): 主胜 ${counts.home}(${safeDiv(counts.home, total)}%) / 平 ${counts.draw}(${safeDiv(counts.draw, total)}%) / 客胜 ${counts.away}(${safeDiv(counts.away, total)}%)`);
      } else if (play === 'zjq') {
        const max = Math.max(...s.buckets.map((b) => b.pct), 1);
        console.log(`  ZJQ (n=${s.total}):`);
        for (const b of s.buckets) console.log(`    ${b.label.padEnd(4)} ${String(b.count).padStart(3)} (${String(b.pct).padStart(5)}%)  ${pctBar(b.pct, max)}`);
      } else if (play === 'bqc') {
        const max = Math.max(...s.buckets.map((b) => b.pct), 1);
        console.log(`  BQC (n=${s.total}):`);
        for (const b of s.buckets) console.log(`    ${b.label.padEnd(4)} ${String(b.count).padStart(3)} (${String(b.pct).padStart(5)}%)  ${pctBar(b.pct, max)}`);
      } else if (play === 'bf') {
        console.log(`  BF (n=${s.total}) top: ${s.top.slice(0, 5).map((t) => `${t.score}(${t.count})`).join(', ')}`);
        const othersStr = Object.entries(s.others).filter(([, c]) => c > 0).map(([k, c]) => `${k}(${c})`).join(', ');
        if (othersStr) console.log(`        others: ${othersStr}`);
      }
    }
  }
}

main();
