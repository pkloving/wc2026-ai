#!/usr/bin/env node
/**
 * Step 3 · 训练让球盘路倾向
 *
 * 输入：modeling/data/04_handicap_table.json
 *
 * 落 handicap_model.json：每档 handicap 下的实际主胜/走/负率，
 * + 一段"经验法则"提醒 predict_unplayed 何时不追让球。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.join(__dirname, '..', 'data', '04_handicap_table.json');
const OUT_FILE = path.join(__dirname, '..', 'artifacts', 'handicap_model.json');

const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));
const tbl = data.by_handicap;

console.log(`分组：${Object.keys(tbl).length} 个 handicap 档位`);

// 经验法则生成器
const rules = [];
for (const [k, v] of Object.entries(tbl)) {
  if (v.n === 0) continue;
  const h = Number(k);
  const winPct = (v.home_win_rate * 100).toFixed(0);
  if (h <= -1) {
    // 让球方（主队）让出去
    rules.push(
      `让${h}（${v.n} 场）：主胜率 ${winPct}% / 走 ${(v.draw_rate * 100).toFixed(0)}% / 主负 ${(v.home_lose_rate * 100).toFixed(0)}%`
    );
  } else if (h >= 1) {
    // 主队受让
    rules.push(
      `让+${h}（${v.n} 场）：主胜率 ${winPct}% / 走 ${(v.draw_rate * 100).toFixed(0)}% / 主负 ${(v.home_lose_rate * 100).toFixed(0)}%`
    );
  } else {
    rules.push(`让 0（${v.n} 场）：等同于 spf`);
  }
}

const model = {
  model_type: 'handicap_table_lookup',
  generated_at: new Date().toISOString(),
  source: 'modeling/data/04_handicap_table.json',
  n_samples: Object.values(tbl).reduce((a, b) => a + b.n, 0),
  by_handicap: tbl,
  // predict_unplayed 用的判定阈值
  verdict_thresholds: {
    // 同档位样本主胜率 >= 这个值才"追"
    chase_min_win_rate: 0.55,
    // 样本不足 N 场时一律 skip
    min_samples: 3,
  },
  decision_logic: {
    chase: '主胜率 >= 55% 且样本 >= 3',
    skip: '主胜率 < 55% 或样本不足',
    not_applicable: 'handicap === 0（无让球）',
  },
  rule_of_thumb: rules.join('\n  '),
};

if (!fs.existsSync(path.dirname(OUT_FILE))) fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(model, null, 2) + '\n', 'utf-8');

console.log('---- 经验法则 ----');
console.log(model.rule_of_thumb);
console.log(`落盘 ${path.relative(path.join(__dirname, '..', '..'), OUT_FILE)}`);
