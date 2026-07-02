#!/usr/bin/env node
// 33_fit_strategy.js — 31号策略的"持续训练"：用全量已完赛回测拟合策略参数
//
// 做的事 (替代以往人肉改 31→跑回测→对比 ROI→再改 的 v2/v3/v4 循环):
//   1. 加载所有"世界杯 + 已有赛果"的比赛 (loadBacktestMatches)
//   2. 从 DEFAULT_PARAMS 出发, 对 SEARCH_SPACE 里每个旋钮做坐标下降
//   3. 目标 = 组合 ROI 的"收缩值" (小样本惩罚, 防 24 场过拟合)
//   4. 只有提升 >= EPS 才接受改动 (否则保留默认, 抗噪)
//   5. 把最优参数写 modeling/artifacts/strategy_params.json (31 启动时加载)
//
// 用法:
//   node modeling/scripts/33_fit_strategy.js            # 拟合并写 strategy_params.json
//   node modeling/scripts/33_fit_strategy.js --dry-run  # 只打印, 不写文件
//
// 设计原则: 世界杯正赛样本极小(~24场), 拟合极易过拟合, 所以:
//   - 收缩目标 (cost + LAMBDA 当伪投入), 高 ROI 但低成交量的桶被压低
//   - 接受阈值 EPS, 噪声级的微小提升不动默认
//   - 全程打印各组成部分样本量, 人可复核

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_PARAMS, SEARCH_SPACE, clone, getPath, setPath,
  createTeamCtx, loadBacktestMatches,
  f4Strategy, singleBetStrategy, rqspfStrategy, zjqStrategy, bqcStrategy,
  selectBets, settleBets, deriveActual, groupByDay, buildPrediction,
} from './strategy_core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'modeling', 'artifacts');
const OUT_FILE = path.join(ARTIFACTS_DIR, 'strategy_params.json');

const DRY_RUN = process.argv.includes('--dry-run');
const LAMBDA = 30;   // 收缩伪投入($): 成交量越小, ROI 越被拉向 0
const EPS = 1.0;     // 接受阈值(收缩 ROI 百分点): 提升不到 EPS 不动默认参数
const MAX_PASSES = 3;

// ============== 入口前刷新赛果汇总 (与 31 一致, 保证训练数据最新) ==============
try {
  const r = spawnSync('node', [path.join(PROJECT_ROOT, 'scripts', 'build_settled.js'), '--incremental'],
    { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 });
  if (r.status !== 0) process.stderr.write(`⚠️  build_settled 退出码 ${r.status}\n`);
} catch (e) { process.stderr.write(`⚠️  build_settled 调用失败: ${e.message}\n`); }

const teamCtx = createTeamCtx(PROJECT_ROOT);
const MATCHES = loadBacktestMatches(PROJECT_ROOT);

// ============================================================
// 评估器: 对给定 params 在全量回测上算各玩法 cost/return/hits
// 公式与 31_tight_anti_value.js runBacktest 完全一致
// ============================================================
function evaluate(params) {
  const ctx = { params, getTeamTier: teamCtx.getTeamTier, hasScorerStar: teamCtx.hasScorerStar };
  const comp = {
    main:  { cost: 0, ret: 0, hits: 0, n: 0 },
    single:{ cost: 0, ret: 0, hits: 0, n: 0 },
    rqspf: { cost: 0, ret: 0, hits: 0, n: 0 },
    zjq:   { cost: 0, ret: 0, hits: 0, n: 0 },
    bqc:   { cost: 0, ret: 0, hits: 0, n: 0 },
    // 选单 5 类 (按天出, 见下方 picker 段)
    cat1:  { cost: 0, ret: 0, hits: 0, n: 0 },
    cat2:  { cost: 0, ret: 0, hits: 0, n: 0 },
    cat3:  { cost: 0, ret: 0, hits: 0, n: 0 },
    cat4:  { cost: 0, ret: 0, hits: 0, n: 0 },
    cat5:  { cost: 0, ret: 0, hits: 0, n: 0 },
  };

  for (const m of MATCHES) {
    const actual = `${m.actualHome}:${m.actualAway}`;

    // 主池 F4
    const picks = f4Strategy(m, ctx);
    comp.main.n++;
    comp.main.cost += picks.length;
    const mh = picks.find(p => p.score === actual);
    if (mh) { comp.main.ret += mh.odds; comp.main.hits++; }

    // 单关
    const singles = singleBetStrategy(m, picks, ctx);
    if (singles.length > 0) {
      comp.single.n++;
      comp.single.cost += singles.length;
      const sh = singles.find(p => p.score === actual);
      if (sh) { comp.single.ret += sh.odds; comp.single.hits++; }
    }

    // RQSPF
    if (m.rqspf && m.rqspf.home && m.rqspf.draw && m.rqspf.away) {
      const diff = m.actualHome - m.actualAway + (m.handicap ?? 0);
      const rqResult = diff > 0 ? 'home' : diff < 0 ? 'away' : 'draw';
      const st = rqspfStrategy({ rqspf: { home: m.rqspf.home, draw: m.rqspf.draw, away: m.rqspf.away } }, ctx);
      if (st) {
        comp.rqspf.n++; comp.rqspf.cost += 1;
        if (st.primary.d === rqResult) { comp.rqspf.ret += st.primary.odds; comp.rqspf.hits++; }
      }
    }

    // ZJQ
    if (m.zjq) {
      const total = m.actualHome + m.actualAway;
      const result = total >= 7 ? '7+' : String(total);
      const st = zjqStrategy(m, ctx);
      if (st) {
        let zpicks, oddsMap;
        if (st.corrected?.picks) { zpicks = st.corrected.picks; oddsMap = st.corrected.odds; }
        else if (st.corrected?.pick) { zpicks = [st.corrected.pick]; oddsMap = { [st.corrected.pick]: st.corrected.odds }; }
        else { zpicks = [st.stable]; oddsMap = { [st.stable]: st.stableOdds }; }
        comp.zjq.n++; comp.zjq.cost += zpicks.length;
        if (zpicks.includes(result)) { comp.zjq.ret += (oddsMap[result] || 0); comp.zjq.hits++; }
      }
    }

    // BQC (需 halfTime)
    if (m.bqc && m.halfTime) {
      const hh = m.halfTime.home, ha = m.halfTime.away;
      const half = hh > ha ? '胜' : hh < ha ? '负' : '平';
      const full = m.actualHome > m.actualAway ? '胜' : m.actualHome < m.actualAway ? '负' : '平';
      const result = half + full;
      const st = bqcStrategy(m, ctx);
      if (st) {
        const bpicks = st.corrected ? st.corrected.picks : st.top3.map(x => x.key);
        const odds = st.corrected ? (st.corrected.odds[result] || 0) : (st.top3.find(x => x.key === result)?.odds || 0);
        comp.bqc.n++; comp.bqc.cost += bpicks.length;
        if (bpicks.includes(result)) { comp.bqc.ret += odds; comp.bqc.hits++; }
      }
    }
  }

  // ---------- 选单 picker (按天 selectBets + settleBets, 调每类 ROI) ----------
  const byDay = groupByDay(MATCHES);
  for (const [, dayMatches] of byDay) {
    const preds = dayMatches.map(m => buildPrediction(m, ctx));
    const cats = selectBets(preds, ctx);
    const actualByCode = {};
    for (const m of dayMatches) actualByCode[m.code] = deriveActual(m);
    const settled = settleBets(cats, actualByCode);
    for (const k of ['cat1', 'cat2', 'cat3', 'cat4', 'cat5']) {
      comp[k].cost += settled[k].cost; comp[k].ret += settled[k].ret;
      comp[k].hits += settled[k].hits; comp[k].n += settled[k].n;
    }
  }

  const totalCost = Object.values(comp).reduce((s, c) => s + c.cost, 0);
  const totalRet = Object.values(comp).reduce((s, c) => s + c.ret, 0);
  const rawRoi = totalCost > 0 ? (totalRet - totalCost) / totalCost * 100 : 0;
  const shrunkRoi = (totalRet - totalCost) / (totalCost + LAMBDA) * 100;  // 目标函数
  return { comp, totalCost, totalRet, rawRoi, shrunkRoi };
}

function fmtComp(c) {
  const roi = c.cost > 0 ? ((c.ret - c.cost) / c.cost * 100).toFixed(0) : '-';
  return `n=${c.n} 命中${c.hits} 投$${c.cost} 回$${c.ret.toFixed(1)} ROI${roi}%`;
}

// ============================================================
// 坐标下降
// ============================================================
console.log(`\n[33_fit] 训练样本: ${MATCHES.length} 场已完赛 (世界杯)`);
if (MATCHES.length < 10) {
  console.log(`⚠️  样本 < 10 场, 拟合无意义, 直接退出 (31 将继续用 DEFAULT_PARAMS)`);
  process.exit(0);
}
console.log(`[33_fit] 收缩伪投入 LAMBDA=$${LAMBDA}  接受阈值 EPS=${EPS}pt  最多 ${MAX_PASSES} 轮\n`);

let params = clone(DEFAULT_PARAMS);
const baseline = evaluate(params);
console.log(`基线(默认参数): 收缩ROI ${baseline.shrunkRoi.toFixed(2)}%  原始ROI ${baseline.rawRoi.toFixed(1)}%  (投$${baseline.totalCost} 回$${baseline.totalRet.toFixed(1)})`);
for (const [k, c] of Object.entries(baseline.comp)) console.log(`    ${k.padEnd(7)} ${fmtComp(c)}`);

let bestObj = baseline.shrunkRoi;
const changes = [];

for (let pass = 1; pass <= MAX_PASSES; pass++) {
  let improvedThisPass = false;
  for (const knob of SEARCH_SPACE) {
    // 2026-07-02 调优: 跳过 frozen=true 旋钮 (6-29/6-30 n=3-6 子桶过拟合保护)
    //   这些旋钮的 effective n 太小, 33_fit 反复接受后又被关掉, frozen 防止再次循环
    //   留 DEFAULT_PARAMS 当前值, 等数据量明显增长时手动解冻
    if (knob.frozen) {
      console.log(`  [pass${pass}] SKIP ${knob.path} (frozen=true, 6-29/6-30 n≤6 子桶过拟合保护)`);
      continue;
    }
    const cur = getPath(params, knob.path);
    let bestV = cur, bestKnobObj = bestObj;
    for (const v of knob.values) {
      if (v === cur) continue;
      const trial = setPath(clone(params), knob.path, v);
      const obj = evaluate(trial).shrunkRoi;
      if (obj > bestKnobObj + 1e-9) { bestKnobObj = obj; bestV = v; }
    }
    if (bestV !== cur && bestKnobObj >= bestObj + EPS) {
      changes.push({ path: knob.path, from: cur, to: bestV, objFrom: +bestObj.toFixed(2), objTo: +bestKnobObj.toFixed(2), pass });
      console.log(`  [pass${pass}] ${knob.path}: ${cur} → ${bestV}   收缩ROI ${bestObj.toFixed(2)}% → ${bestKnobObj.toFixed(2)}%`);
      setPath(params, knob.path, bestV);
      bestObj = bestKnobObj;
      improvedThisPass = true;
    }
  }
  if (!improvedThisPass) { console.log(`  [pass${pass}] 无改动, 收敛`); break; }
}

const fitted = evaluate(params);
console.log(`\n拟合后: 收缩ROI ${fitted.shrunkRoi.toFixed(2)}%  原始ROI ${fitted.rawRoi.toFixed(1)}%  (投$${fitted.totalCost} 回$${fitted.totalRet.toFixed(1)})`);
for (const [k, c] of Object.entries(fitted.comp)) {
  const warn = (c.hits > 0 && c.n < 5) ? '  ⚠️样本<5,ROI不稳' : '';
  console.log(`    ${k.padEnd(7)} ${fmtComp(c)}${warn}`);
}
console.log(`\n共接受 ${changes.length} 处改动 (基线收缩ROI ${baseline.shrunkRoi.toFixed(2)}% → ${fitted.shrunkRoi.toFixed(2)}%)`);

// ============================================================
// 写产物
// ============================================================
const out = {
  fitted_at: new Date().toISOString().slice(0, 10),
  sample_size: MATCHES.length,
  method: `坐标下降, 目标=组合收缩ROI(LAMBDA=${LAMBDA}), 接受阈值=${EPS}pt`,
  baseline: { shrunkRoi: +baseline.shrunkRoi.toFixed(2), rawRoi: +baseline.rawRoi.toFixed(1) },
  fitted: { shrunkRoi: +fitted.shrunkRoi.toFixed(2), rawRoi: +fitted.rawRoi.toFixed(1) },
  changes,
  component_breakdown: Object.fromEntries(Object.entries(fitted.comp).map(([k, c]) => [k, {
    n: c.n, hits: c.hits, cost: c.cost, ret: +c.ret.toFixed(2),
    roi: c.cost > 0 ? +((c.ret - c.cost) / c.cost * 100).toFixed(1) : null,
  }])),
  params,
};

if (DRY_RUN) {
  console.log(`\n[--dry-run] 不写文件。拟合参数:\n${JSON.stringify(params, null, 2)}`);
} else {
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`\n参数写入: ${OUT_FILE}`);
  console.log(`→ 31_tight_anti_value.js 下次启动将自动加载此参数`);
}
