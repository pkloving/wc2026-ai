#!/usr/bin/env node
/**
 * Step 2 · 训练胜平负模型
 *
 * 输入：modeling/data/03_implied_probability.json
 *
 * 策略（极简 + 可解释 + 0 新依赖）：
 *   1. 统计样本中"赔率最低方向"（市场大热门）的命中率
 *   2. 统计"平局赔率 < 3.3 时平局命中率"和"平局赔率 >= 3.3 时平局命中率"
 *   3. 统计"客胜赔率 >= 4 时冷门命中率"
 *   4. 落"软阈值 + 信心度"规则到 win_model.json
 *
 * 注意：11 场样本极少，校准值仅作"参考倾向"，实际预测时由 predict_unplayed
 * 根据 spf 赔率硬分类（大热门 / 适中 / 大冷门）输出 ⭐-⭐⭐⭐ 信心度。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.join(__dirname, '..', 'data', '01_matches_with_odds.json');
const OUT_FILE = path.join(__dirname, '..', 'artifacts', 'win_model.json');

const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));
const recs = data.matches.map((m) => ({
  mid: m.mid,
  code: m.code,
  home: m.home,
  away: m.away,
  spf: m.spf,
  spf_implied: m.derived.spf_implied,
  rqspf: m.rqspf,
  actual_winner: m.derived.actual_winner,
}));

console.log(`输入：${recs.length} 场`);

// 1. 大热门命中率（spf 三个赔率中最低那个方向）
let favHits = 0, favTotal = 0;
for (const r of recs) {
  if (!r.spf_implied) continue;
  // 用"最大 p0" = "市场最看好方向"
  const { p0_home, p0_draw, p0_away } = r.spf_implied;
  let fav = 'home';
  if (p0_draw >= p0_home && p0_draw >= p0_away) fav = 'draw';
  else if (p0_away >= p0_home && p0_away >= p0_draw) fav = 'away';
  favTotal += 1;
  if (fav === r.actual_winner) favHits += 1;
}
const favHitRate = favTotal ? favHits / favTotal : 0;

// 2. 主胜单独统计
const homeFav = recs.filter((r) => r.actual_winner === 'home').length;
const homeFavRate = homeFav / recs.length;

// 3. 平局：分阈值
const drawLow = recs.filter((r) => r.spf && r.spf.draw < 3.3);
const drawLowHit = drawLow.filter((r) => r.actual_winner === 'draw').length;
const drawHigh = recs.filter((r) => r.spf && r.spf.draw >= 3.3);
const drawHighHit = drawHigh.filter((r) => r.actual_winner === 'draw').length;

// 4. 客胜：分阈值
const awayLow = recs.filter((r) => r.spf && r.spf.away < 4);
const awayLowHit = awayLow.filter((r) => r.actual_winner === 'away').length;
const awayHigh = recs.filter((r) => r.spf && r.spf.away >= 4);
const awayHighHit = awayHigh.filter((r) => r.actual_winner === 'away').length;

// 5. 主胜：分阈值
const homeLow = recs.filter((r) => r.spf && r.spf.home < 1.5);
const homeLowHit = homeLow.filter((r) => r.actual_winner === 'home').length;
const homeMid = recs.filter((r) => r.spf && r.spf.home >= 1.5 && r.spf.home < 2.5);
const homeMidHit = homeMid.filter((r) => r.actual_winner === 'home').length;
const homeHigh = recs.filter((r) => r.spf && r.spf.home >= 2.5);
const homeHighHit = homeHigh.filter((r) => r.actual_winner === 'home').length;

// 6. 中等热门区间：p0_max ∈ [0.40, 0.60)（强信号：12 场样本 5 场平局率 60%）
//    业务诉求：让 win_model 在此区间对"主队大热门"预测降 1 档信心。
const MID_FAV_P0_LOW = 0.40;
const MID_FAV_P0_HIGH = 0.60;
const midFav = recs.filter((r) => {
  if (!r.spf_implied) return false;
  const p0max = Math.max(r.spf_implied.p0_home, r.spf_implied.p0_draw, r.spf_implied.p0_away);
  return p0max >= MID_FAV_P0_LOW && p0max < MID_FAV_P0_HIGH;
});
function pickByP0Max(imp) {
  if (imp.p0_draw >= imp.p0_home && imp.p0_draw >= imp.p0_away) return 'draw';
  if (imp.p0_away >= imp.p0_home && imp.p0_away >= imp.p0_draw) return 'away';
  return 'home';
}
const midFavHit = midFav.filter((r) => pickByP0Max(r.spf_implied) === r.actual_winner).length;
const midFavDraw = midFav.filter((r) => r.actual_winner === 'draw').length;

const model = {
  model_type: 'rule_based_with_confidence',
  generated_at: new Date().toISOString(),
  source: 'modeling/data/01_matches_with_odds.json',
  n_samples: recs.length,
  // 规则阈值
  rules: {
    fav_threshold: 1.5,    // 最低赔率 < 1.5 视为大热门
    moderate_threshold: 2.5, // 1.5-2.5 适中
    long_shot_threshold: 4.0, // >= 4 大冷门
    draw_threshold: 3.3,   // 平局赔率 < 3.3 不推荐平
    mid_fav_p0_low: MID_FAV_P0_LOW,
    mid_fav_p0_high: MID_FAV_P0_HIGH,
  },
  // 样本校准（命中率）
  calibration: {
    fav_overall_hit_rate: round(favHitRate),
    home_win_rate: round(homeFavRate),
    home_strong_hit_rate: safe(homeLowHit, homeLow.length),
    home_moderate_hit_rate: safe(homeMidHit, homeMid.length),
    home_weak_hit_rate: safe(homeHighHit, homeHigh.length),
    draw_low_odds_hit_rate: safe(drawLowHit, drawLow.length),
    draw_high_odds_hit_rate: safe(drawHighHit, drawHigh.length),
    away_low_odds_hit_rate: safe(awayLowHit, awayLow.length),
    away_long_shot_hit_rate: safe(awayHighHit, awayHigh.length),
    mid_fav_p0_n: midFav.length,
    mid_fav_p0hit_rate: safe(midFavHit, midFav.length),
    mid_fav_p0draw_rate: safe(midFavDraw, midFav.length),
  },
  // 信心度档位（1-3 ⭐）
  confidence_mapping: {
    strong_fav: 3,    // ⭐⭐⭐
    moderate: 2,      // ⭐⭐
    moderate_low: 1,  // ⭐（中等热门降档：p0_max ∈ [0.40, 0.60)）
    long_shot: 1,     // ⭐
  },
  // 决策规则（predict_unplayed 调用）
  decision_logic: {
    pick: 'spf_min_odds_direction（p0 最大那个）',
    confidence_rules: [
      'spf 最低赔率 < 1.5 → ⭐⭐⭐',
      `spf 最低赔率 1.5-2.5 且 p0_max ∈ [${MID_FAV_P0_LOW}, ${MID_FAV_P0_HIGH}) → ⭐（中等热门降档）`,
      'spf 最低赔率 1.5-2.5 且 p0_max ∉ [0.40, 0.60) → ⭐⭐',
      'spf 最低赔率 >= 2.5 → ⭐',
      '平局赔率 < 3.3 时不推荐平局（样本提示低赔平局假信号多）',
    ],
  },
};

if (!fs.existsSync(path.dirname(OUT_FILE))) fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(model, null, 2) + '\n', 'utf-8');

console.log('---- 校准结果 ----');
console.log(`  大热门（最低赔率方向）命中率：${(favHitRate * 100).toFixed(0)}%（${favHits}/${favTotal}）`);
console.log(`  主胜 < 1.5：${homeLowHit}/${homeLow.length}，1.5-2.5：${homeMidHit}/${homeMid.length}，>= 2.5：${homeHighHit}/${homeHigh.length}`);
console.log(`  平局 < 3.3：${drawLowHit}/${drawLow.length}，>= 3.3：${drawHighHit}/${drawHigh.length}`);
console.log(`  客胜 < 4：${awayLowHit}/${awayLow.length}，>= 4：${awayHighHit}/${awayHigh.length}`);
console.log(`  中等热门 [${MID_FAV_P0_LOW}, ${MID_FAV_P0_HIGH})：n=${midFav.length}, p0_max 方向命中 ${midFavHit}/${midFav.length}（${(midFav.length ? (midFavHit / midFav.length * 100).toFixed(0) : '-')}%）, 平局率 ${midFavDraw}/${midFav.length}（${(midFav.length ? (midFavDraw / midFav.length * 100).toFixed(0) : '-')}%）`);
console.log(`  落盘 ${path.relative(path.join(__dirname, '..', '..'), OUT_FILE)}`);

function round(n) { return Math.round(n * 1000) / 1000; }
function safe(a, b) { return b ? round(a / b) : null; }
