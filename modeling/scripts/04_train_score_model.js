#!/usr/bin/env node
/**
 * Step 4 · 训练比分 Poisson 模型
 *
 * 输入：modeling/data/01_matches_with_odds.json（取 derived + spf_implied）
 *
 * 简化版 Poisson（独立同分布进球率）：
 *   1. 聚合 11 场样本算全局 λ_home / λ_away
 *   2. 按"赔率热门档"分 3 档调系数（强队/均衡/弱队）
 *   3. 落 score_model.json（含 tier_adjustment）
 *   4. 同时落 score_top3_sample.json：每场样本的 Top-3 比分概率回放
 *      （赛后可用作"模型校准"参考）
 *
 * P(score = h:a) = Poisson(h; λ_h) * Poisson(a; λ_a)
 * 跑 0-5 网格归一化（5+ 归"其他"）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.join(__dirname, '..', 'data', '01_matches_with_odds.json');
const OUT_FILE = path.join(__dirname, '..', 'artifacts', 'score_model.json');
const SAMPLE_FILE = path.join(__dirname, '..', 'artifacts', 'score_top3_sample.json');

const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));
const matches = data.matches;

const n = matches.length;
const totalHome = matches.reduce((a, m) => a + m.derived.home_goals, 0);
const totalAway = matches.reduce((a, m) => a + m.derived.away_goals, 0);
const lambdaHome = totalHome / n;
const lambdaAway = totalAway / n;
const lambdaTotal = lambdaHome + lambdaAway;

console.log(`输入：${n} 场`);
console.log(`  总进球：主 ${totalHome} / 客 ${totalAway}`);
console.log(`  全局 λ_home = ${lambdaHome.toFixed(2)}, λ_away = ${lambdaAway.toFixed(2)}, λ_total = ${lambdaTotal.toFixed(2)}`);

// Poisson PMF
function logFactorial(k) {
  if (k === 0) return 0;
  let s = 0;
  for (let i = 1; i <= k; i += 1) s += Math.log(i);
  return s;
}
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

// 分档：根据 spf p0_home 判定
function tierOf(p0Home) {
  if (p0Home === null || p0Home === undefined) return 'balanced';
  if (p0Home > 0.6) return 'strong_fav';
  if (p0Home < 0.3) return 'weak_fav';
  return 'balanced';
}

// v2 公式：赔率概率加权分配总进球期望到主/客
// λ_home = λ_total × p0_home / (p0_home + p0_away)
// λ_away = λ_total × p0_away / (p0_home + p0_away)
// 注：分母忽略 p0_draw（赔率市场的"主客对立"信号更强），保持与 score_model.json artifact 一致
function lambdasFor(p0Home, p0Away) {
  if (p0Home === null || p0Away === null || p0Home + p0Away <= 0) {
    return { lh: lambdaHome, la: lambdaAway };
  }
  const denom = p0Home + p0Away;
  return {
    lh: lambdaTotal * (p0Home / denom),
    la: lambdaTotal * (p0Away / denom),
  };
}

// 旧 v1 tier 调整逻辑已废弃（artifact 是 v2 概率加权）；保留为参考注释以备回滚：
// const tierAdjust = {
//   strong_fav: { home_mult: 1.3, away_mult: 0.8 },
//   balanced:   { home_mult: 1.0, away_mult: 1.0 },
//   weak_fav:   { home_mult: 0.8, away_mult: 1.2 },
// };

const model = {
  model_type: 'poisson_probability_weighted',
  generated_at: new Date().toISOString(),
  source: 'modeling/data/01_matches_with_odds.json',
  n_samples: n,
  global_lambda_total: round(lambdaTotal),
  global_lambda_home: round(lambdaHome),
  global_lambda_away: round(lambdaAway),
  score_grid_max: 5,
  formula: 'λ_home = λ_total × p0_home / (p0_home + p0_away)；λ_away = λ_total × p0_away / (p0_home + p0_away)',
  mid_fav_p0_range: [0.40, 0.60],
  mid_fav_topk_force_draw: true,
  note: 'v2: 用赔率概率比例分配进球期望，确保比分方向与胜负预测一致（修复 v1 客队热门时 λ_home > λ_away 的矛盾）；v3 (2026-06-17 调优): p0_max ∈ [0.40, 0.60) 区间 Top-3 强制含 1 个平局候选 (12 场样本 5 场落此区间, 实际平局率 60%, 现行 Top-3 命中仅 1/5 = 20%)',
};

if (!fs.existsSync(path.dirname(OUT_FILE))) fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(model, null, 2) + '\n', 'utf-8');

// 给每场样本算 Top-3（用 spf 实际赔率驱动），落 sample 辅助表
// v3 平局保护：p0_max ∈ [0.40, 0.60) 时 Top-3 强制含 1 个平局
function applyV3DrawProtection(grid, p0) {
  if (!model.mid_fav_topk_force_draw || !p0) return grid.slice(0, 3);
  const [low, high] = model.mid_fav_p0_range || [0.40, 0.60];
  const p0max = Math.max(p0.p0_home, p0.p0_draw, p0.p0_away);
  if (p0max < low || p0max >= high) return grid.slice(0, 3);
  const top3HasDraw = grid.slice(0, 3).some((g) => g.h === g.a);
  if (top3HasDraw) return grid.slice(0, 3);
  const drawScores = grid.filter((g) => g.h === g.a);
  const topDraw = drawScores[0];
  if (!topDraw) return grid.slice(0, 3);
  return [grid[0], grid[1], topDraw];
}

const sampleTop3 = matches.map((m) => {
  const p0 = m.derived.spf_implied;
  const p0Home = p0?.p0_home ?? null;
  const p0Away = p0?.p0_away ?? null;
  const tier = tierOf(p0Home);
  const { lh, la } = lambdasFor(p0Home, p0Away);
  const grid = [];
  let total = 0;
  for (let h = 0; h <= 5; h += 1) {
    for (let a = 0; a <= 5; a += 1) {
      const p = poissonPmf(h, lh) * poissonPmf(a, la);
      grid.push({ h, a, p });
      total += p;
    }
  }
  // 归一化
  for (const g of grid) g.p = g.p / total;
  grid.sort((x, y) => y.p - x.p);
  // v3 平局保护后的 Top-3
  const top3Raw = grid.slice(0, 3);
  const top3Protected = applyV3DrawProtection(grid, p0);
  const top3 = top3Protected.map((g) => ({
    score: `${g.h}-${g.a}`,
    prob: round(g.p),
  }));
  // 内容比较判定是否真的触发了保护（避免 slice 引用变化误判）
  const rawScores = top3Raw.map((g) => `${g.h}-${g.a}`).join(',');
  const protectedScores = top3Protected.map((g) => `${g.h}-${g.a}`).join(',');
  const drawProtectionApplied = rawScores !== protectedScores;
  return {
    mid: m.mid,
    home: m.home,
    away: m.away,
    tier,
    lambda_home: round(lh),
    lambda_away: round(la),
    actual_score: `${m.derived.home_goals}-${m.derived.away_goals}`,
    actual_score_prob: round(
      poissonPmf(m.derived.home_goals, lh) * poissonPmf(m.derived.away_goals, la) / total
    ),
    top3_raw: top3Raw.map((g) => `${g.h}-${g.a}`),
    top3_v3: top3.map((t) => t.score),
    draw_protection_applied: drawProtectionApplied,
    top3,
  };
});

fs.writeFileSync(SAMPLE_FILE, JSON.stringify({
  generated_at: new Date().toISOString(),
  note: '每场样本用实际 spf 赔率驱动 Poisson，Top-3 是模型给该场的最佳 3 个比分概率。v3 (2026-06-18): p0_max ∈ [0.40, 0.60) 区间 Top-3 末位替换为最高概率平局 (draw_protection_applied=true 标记)',
  total: sampleTop3.length,
  samples: sampleTop3,
}, null, 2) + '\n', 'utf-8');

console.log('---- 样本回放 Top-3 命中情况 ----');
let inTop3 = 0;
let inTop1 = 0;
let inTop3V3 = 0;
let drawProtected = 0;
for (const s of sampleTop3) {
  const top1 = s.top3[0].score;
  const top3List = s.top3_v3;
  if (top1 === s.actual_score) inTop1 += 1;
  if (top3List.includes(s.actual_score)) inTop3V3 += 1;
  if (s.top3_raw.includes(s.actual_score)) inTop3 += 1;
  if (s.draw_protection_applied) drawProtected += 1;
}
console.log(`  Top-1 命中：${inTop1}/${sampleTop3.length}（${(inTop1 / sampleTop3.length * 100).toFixed(0)}%）`);
console.log(`  Top-3 命中（v3 实施前）：${inTop3}/${sampleTop3.length}（${(inTop3 / sampleTop3.length * 100).toFixed(0)}%）`);
console.log(`  Top-3 命中（v3 实施后）：${inTop3V3}/${sampleTop3.length}（${(inTop3V3 / sampleTop3.length * 100).toFixed(0)}%）`);
console.log(`  v3 平局保护触发：${drawProtected}/${sampleTop3.length} 场`);
console.log(`落盘 ${path.relative(path.join(__dirname, '..', '..'), OUT_FILE)} + score_top3_sample.json`);

function round(n) { return Math.round(n * 1000) / 1000; }
