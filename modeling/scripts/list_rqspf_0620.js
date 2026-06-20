#!/usr/bin/env node
// list_rqspf_0620.js — 列出 6/20 (周五) 4 场比赛的 RQSPF 主选/次选
//   不涉及出单策略, 只列数据
//
// 用法: node modeling/scripts/list_rqspf_0620.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { rqspfStrategy, mergeParams, DEFAULT_PARAMS } from './strategy_core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');

const ctx = { params: mergeParams(DEFAULT_PARAMS, null), getTeamTier: () => 'NORMAL', hasScorerStar: () => false };

const matches = [];
for (const f of fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json')).sort()) {
  const o = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf-8'));
  if (!o.basic || o.basic.league !== '世界杯') continue;
  const mid = o.basic.mid;
  if (fs.existsSync(path.join(RESULTS_DIR, mid + '.json'))) continue;
  // 只取 6/20 的比赛
  if (!String(o.basic.kickoff).startsWith('2026-06-20')) continue;
  matches.push({
    code: o.basic.code, kickoff: o.basic.kickoff,
    home: o.basic.home, away: o.basic.away,
    handicap: o.odds?.handicap ?? 0,
    spf: o.odds?.spf_latest,
    rqspf: o.odds?.rqspf_latest,
  });
}
matches.sort((a, b) => a.code.localeCompare(b.code, 'zh-CN', { numeric: true }));

console.log(`\n## 6/20 (周五) RQSPF 选号 - 4 场\n`);
console.log(`| 场次 | 开赛 | 对阵 | hc | spf(主/平/负) | rqspf(主/平/负) | 选号 | 次选(仅双选) | 类型 |`);
console.log(`|------|------|------|----|----------------|------------------|------|--------------|------|`);
for (const m of matches) {
  const pred = rqspfStrategy(m, ctx);
  if (!pred) { console.log(`| ${m.code} | - | ${m.home}vs${m.away} | ${m.handicap} | - | - | 无数据 | - | - | - |`); continue; }
  const P = pred.primary, S = pred.secondary;
  const rqStr = m.rqspf ? `${m.rqspf.home} / ${m.rqspf.draw} / ${m.rqspf.away}` : '-';
  const spfStr = m.spf ? `${m.spf.home} / ${m.spf.draw} / ${m.spf.away}` : '-';
  const d = String(m.kickoff).slice(11, 16);

  // 5 OR 瘦身判断 (A-D 跳次, E/F 强制覆盖主选为让胜)
  const triggers = [];
  if (P.d === 'home') triggers.push('A');
  if (m.spf?.home && m.spf.home < 1.3) triggers.push('B');
  if (m.spf?.home && m.spf.home >= 1.5 && m.spf.home < 2.0) triggers.push('C');
  if (Math.abs(m.handicap ?? 0) === 2) triggers.push('D');
  if (m.handicap === -1 && m.spf?.home && m.spf.home < 1.5) triggers.push('E');
  if (m.handicap === 1 && m.spf?.away && m.spf.away < 1.5) triggers.push('F');
  const slim = triggers.length > 0;
  // E/F 规则: 强制让胜, 覆盖 baseline
  let finalPick = P, finalOdds = P.odds, finalLabel = P.label;
  if (triggers.includes('E') || triggers.includes('F')) {
    finalPick = { d: 'home', label: '让胜' };
    finalOdds = m.rqspf?.home ?? P.odds;
    finalLabel = '让胜';
  }
  const type = slim ? `单选[${triggers.join('+')}]` : '双选';
  console.log(`| ${m.code} | ${d} | ${m.home}vs${m.away} | ${m.handicap} | ${spfStr} | ${rqStr} | ${finalLabel}@${finalOdds} | ${slim ? '—' : S.label+'@'+S.odds} | ${type} |`);
}
console.log(`\n[共 ${matches.length} 场 6/20 待预测比赛]`);
