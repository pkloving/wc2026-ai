// scripts/build_chat_predict.js
// ---------------------------------------------------------------
// 从 predict_31_<date>.json 精简出 chat_predict_<date>.json（喂给 DeepSeek 的精简版）
//
// 精简点：
//   - 每场只留 mainPicks（主池3比分）+ 基本盘口（handicap/spf/rqspf）
//   - 去掉 teams 嵌套详情、建模内部字段
//   - 3串1 / 2串1 取自 predict_31.combos，每类 TOP5，只留 code + pick + odds
//   - 输出文件目标 < 2KB / 4 场
//
// 用法:
//   node scripts/build_chat_predict.js [YYYY-MM-DD]   (默认今天)
//   node scripts/build_chat_predict.js                # 用今天
//
// 接入 daily 流程：wc2026-daily skill Step 5，紧跟 modeling:all（31 出 predict_31 后）
// ---------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const TODAY = process.argv[2] || new Date().toISOString().slice(0, 10);
const ART = path.resolve('modeling/artifacts');

function safeRead(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const r31 = safeRead(path.join(ART, `predict_31_${TODAY}.json`));

if (!r31) {
  console.error(`[build_chat_predict] ❌ 没找到 ${TODAY} 的 predict_31`);
  console.error('  先跑: node modeling/scripts/31_tight_anti_value.js --predict');
  process.exit(1);
}

// 精简每场: 主池 mainPicks
const matches = (r31.matches || []).map((m) => ({
  code: m.code,
  mid: m.mid,
  home: m.home,
  away: m.away,
  kickoff: m.kickoff || '',
  handicap: m.handicap,
  spf: m.spf,
  rqspf: m.rqspf,
  picks: (m.mainPicks || []).map((p) => ({
    play: '比分', pick: p.score, odds: p.odds, tier: '推荐',
  })),
})).sort((a, b) => String(a.kickoff || '').localeCompare(String(b.kickoff || '')));

// 串关取自 predict_31 的 combos（每类 TOP COMBO_CAP，控制体积）
const COMBO_CAP = 5;

const parlays_3x1 = (r31.combos?.c3 || []).slice(0, COMBO_CAP).map((c) => ({
  picks: c.picks.map((x, i) => ({
    code: c.matches[i], play: '比分', pickLabel: x.score, odds: x.odds,
  })),
  totalOdds: Number((c.odds ?? 0).toFixed(2)),
}));

const pairs_2x1 = (r31.combos?.c2 || []).slice(0, COMBO_CAP).map((c) => ({
  a: { code: c.matches[0], pick: c.picks[0].score, odds: c.picks[0].odds },
  b: { code: c.matches[1], pick: c.picks[1].score, odds: c.picks[1].odds },
  totalOdds: Number((c.odds ?? 0).toFixed(2)),
}));

const out = {
  date: TODAY,
  generated_at: new Date().toISOString(),
  source_31: 'predict_31',
  match_count: matches.length,
  matches,
  parlays_3x1,
  pairs_2x1,
};

const outPath = path.join(ART, `chat_predict_${TODAY}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
const sz = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`✅ ${outPath}  (${matches.length} 场, ${parlays_3x1.length} 组 3串1, ${pairs_2x1.length} 组 2串1, ${sz} KB)`);
