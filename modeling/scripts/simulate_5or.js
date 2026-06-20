#!/usr/bin/env node
// simulate_5or.js — 在 28 场回测里, 跑"5 条 OR 触发瘦身为单选"的数量和命中率
//   A: 主选=让胜
//   B: spf<1.3
//   C: spf∈[1.5, 2.0)
//   D: |hc|=2
//   E: hc=-1 + spf<1.5 (新规则: 跟 spf 方向强制让胜, 不管 rqspf 赔率如何)
//   F: hc=+1 + spf.away<1.5 (反向规则: 客热门爆冷, 强制让胜)
//
// 用法: node modeling/scripts/simulate_5or.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { rqspfStrategy, mergeParams, DEFAULT_PARAMS, deriveActual, loadBacktestMatches } from './strategy_core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ctx = { params: mergeParams(DEFAULT_PARAMS, null), getTeamTier: () => 'NORMAL', hasScorerStar: () => false };

function shouldSlim(m, P) {
  if (!m || !P) return [];
  const triggers = [];
  if (P.d === 'home') triggers.push('A');
  if (m.spf?.home && m.spf.home < 1.3) triggers.push('B');
  if (m.spf?.home && m.spf.home >= 1.5 && m.spf.home < 2.0) triggers.push('C');
  if (Math.abs(m.handicap ?? 0) === 2) triggers.push('D');
  // 规则 E: hc=-1 + spf.home<1.5 → 强制让胜 (覆盖基线让负, 跟 spf 方向)
  if (m.handicap === -1 && m.spf?.home && m.spf.home < 1.5 && P.d !== 'home') {
    triggers.push('E');
  }
  // 规则 F: hc=+1 + spf.away<1.5 → 反向强制让胜 (客热门爆冷, 主队受让反而赢)
  if (m.handicap === 1 && m.spf?.away && m.spf.away < 1.5) {
    triggers.push('F');
  }
  return triggers;
}

const BT = loadBacktestMatches(PROJECT_ROOT);
console.log(`总样本: ${BT.length} 场 (仅 2026)\n`);

let triggerN = 0, triggerHit = 0, triggerRet = 0;
let noTriggerN = 0, noTriggerBothHit = 0, noTriggerCost2 = 0, noTriggerRet = 0;
const triggersCount = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
let eOnlyN = 0, eOnlyHit = 0, eOnlyRet = 0;
let fOnlyN = 0, fOnlyHit = 0, fOnlyRet = 0;

console.log(`| # | 场次 | 对阵 | hc | spf | rqspf 主选(基线) | 命中规则 | 主选 | 实际 | 命中? |`);
console.log(`|---|------|------|----|-----|------------------|----------|------|------|-------|`);
for (const m of BT) {
  const pred = rqspfStrategy(m, ctx);
  if (!pred) continue;
  const act = deriveActual(m);
  const P = pred.primary, S = pred.secondary;
  const triggers = shouldSlim(m, P);
  const hasE = triggers.includes('E');
  const hasF = triggers.includes('F');
  // 实际用于"单选"的主选: E 或 F 触发都强制让胜
  const actualP = (hasE || hasF) ? { d: 'home', odds: m.rqspf.home, label: '让胜' } : P;
  const hit = actualP.d === act.rqResult;
  const trigStr = triggers.length > 0 ? triggers.join('+') : '-';
  if (triggers.length > 0) {
    triggerN++;
    if (hit) { triggerHit++; triggerRet += actualP.odds; }
    triggersCount.E += hasE ? 1 : 0;
    triggersCount.F += hasF ? 1 : 0;
    if (triggers.length === 1 && hasE) {
      eOnlyN++; if (hit) { eOnlyHit++; eOnlyRet += actualP.odds; }
    }
    if (triggers.length === 1 && hasF) {
      fOnlyN++; if (hit) { fOnlyHit++; fOnlyRet += actualP.odds; }
    }
    for (const t of triggers) triggersCount[t] = (triggersCount[t] || 0) + 1;
  } else {
    noTriggerN++;
    // 这场走"主+次双选"
    noTriggerCost2 += 2;
    if (P.d === act.rqResult) { noTriggerBothHit++; noTriggerRet += P.odds; }
    else if (S.d === act.rqResult) { noTriggerBothHit++; noTriggerRet += S.odds; }
  }
  console.log(`| ${m.code} | ${m.home}vs${m.away} | ${m.handicap} | ${m.spf?.home || '-'} | ${P.label}@${P.odds}${hasE ? '→让胜@'+actualP.odds : ''} | ${trigStr} | ${actualP.label}@${actualP.odds} | ${act.rqResult} | ${hit ? '✅' : '❌'} |`);
}

console.log(`\n## 5 OR 规则触发统计`);
console.log(`| 规则 | 触发场次 |`);
console.log(`|------|----------|`);
for (const [k, v] of Object.entries(triggersCount)) console.log(`| ${k} | ${v} |`);

console.log(`\n## 瘦身单选 (触发任一规则) 统计`);
const tRoi = triggerN > 0 ? ((triggerRet - triggerN) / triggerN * 100).toFixed(1) : '0';
console.log(`- 场次: ${triggerN}`);
console.log(`- 命中: ${triggerHit} / ${triggerN} = ${(triggerHit / triggerN * 100).toFixed(1)}%`);
console.log(`- ROI: ${tRoi}% (成本 $${triggerN}, 回报 $${triggerRet.toFixed(2)})`);

console.log(`\n## 未触发场次 → 走主+次双选`);
const nRoi = noTriggerCost2 > 0 ? ((noTriggerRet - noTriggerCost2) / noTriggerCost2 * 100).toFixed(1) : '0';
console.log(`- 场次: ${noTriggerN}`);
console.log(`- 主+次命中(任一): ${noTriggerBothHit} / ${noTriggerN} = ${(noTriggerBothHit / noTriggerN * 100).toFixed(1)}%`);
console.log(`- ROI: ${nRoi}% (成本 $${noTriggerCost2}, 回报 $${noTriggerRet.toFixed(2)})`);

console.log(`\n## 合并 (5 OR 触发单选 + 其余双选)`);
const totCost = triggerN + noTriggerCost2;
const totRet = triggerRet + noTriggerRet;
const totRoi = totCost > 0 ? ((totRet - totCost) / totCost * 100).toFixed(1) : '0';
const totHit = triggerHit + noTriggerBothHit;
const totN = triggerN + noTriggerN;
console.log(`- 场次: ${totN} | 成本 $${totCost} | 回报 $${totRet.toFixed(2)} | ROI ${totRoi}%`);
console.log(`- 命中(瘦身单选命中 OR 主+次任一命中): ${totHit} / ${totN} = ${(totHit / totN * 100).toFixed(1)}%`);

console.log(`\n## E 单独触发 (其它规则没触发) 统计`);
if (eOnlyN > 0) {
  console.log(`- 场次: ${eOnlyN}`);
  console.log(`- 命中: ${eOnlyHit} / ${eOnlyN} = ${(eOnlyHit / eOnlyN * 100).toFixed(1)}%`);
  const eRoi = ((eOnlyRet - eOnlyN) / eOnlyN * 100).toFixed(1);
  console.log(`- ROI: ${eRoi}%`);
} else {
  console.log(`- 28 场里没有 E 单独触发的场次 (E 触发时其它规则通常也触发)`);
}

console.log(`\n## F 单独触发 (其它规则没触发) 统计`);
if (fOnlyN > 0) {
  console.log(`- 场次: ${fOnlyN}`);
  console.log(`- 命中: ${fOnlyHit} / ${fOnlyN} = ${(fOnlyHit / fOnlyN * 100).toFixed(1)}%`);
  const fRoi = ((fOnlyRet - fOnlyN) / fOnlyN * 100).toFixed(1);
  console.log(`- ROI: ${fRoi}%`);
} else {
  console.log(`- 28 场里没有 F 单独触发的场次`);
}
