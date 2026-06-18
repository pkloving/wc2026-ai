// scripts/build_chat_predict.js
// ---------------------------------------------------------------
// 从 predict_31_<date>.json + predict_r013_<date>.json
// 合并精简出 chat_predict_<date>.json（喂给 DeepSeek 的精简版）
//
// 精简点：
//   - 去掉 prob（0-1 浮点，AI 不会自己算）
//   - 去掉 tier=low/mid/high 内部标签（改成「低赔/中赔/高赔」中文）
//   - 去掉 direction / style / star / cold / pre_analysis 全字段（建模内部用）
//   - 去掉 teams 嵌套详情
//   - 3串1 / 2串1 只留 code + playLabel + odds（r013 缺省时回落 predict_31.combos，每类 TOP5）
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

const TIER_CN = { low: '低赔', mid: '中赔', high: '高赔' };
const RQDIR_CN = { home: '让胜', draw: '让平', away: '让负' };

function safeRead(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const r31 = safeRead(path.join(ART, `predict_31_${TODAY}.json`));
const r013 = safeRead(path.join(ART, `predict_r013_${TODAY}.json`));

if (!r31 && !r013) {
  console.error(`[build_chat_predict] ❌ 没找到 ${TODAY} 的 predict_31 / predict_r013`);
  console.error('  跑其中一个:');
  console.error('    node modeling/scripts/31_tight_anti_value.js ' + TODAY + ' --predict');
  console.error('    node modeling/scripts/12_r013_user_rules.js ' + TODAY + ' --predict');
  process.exit(1);
}

// 用 r013 为主（更详尽），r31 补 mainPicks
const byCode = new Map();
if (r013?.matches) {
  for (const m of r013.matches) {
    byCode.set(m.code, {
      code: m.code,
      mid: m.mid,
      home: m.home,
      away: m.away,
      kickoff: m.kickoff || '',   // r013 里没 kickoff，由 r31 补
      handicap: m.handicap,
      spf: m.spf,
      rqspf: m.rqspf,
      picks: (m.bf_picks || []).slice(0, 3).map((p) => ({
        play: '比分',
        pick: p.score,
        odds: p.odds,
        tier: TIER_CN[p.tier] || '中赔',
      })),
      reason: m.pre_analysis || '',
      rqspf_direction: (m.rqspf_picks?.picks || [])
        .map((p) => RQDIR_CN[p] || p)
        .join('+') || '',
    });
  }
}

if (r31?.matches) {
  for (const m of r31.matches) {
    const existing = byCode.get(m.code);
    if (existing) {
      // 补 kickoff
      if (!existing.kickoff && m.kickoff) existing.kickoff = m.kickoff;
      continue;
    }
    byCode.set(m.code, {
      code: m.code,
      home: m.home,
      away: m.away,
      kickoff: m.kickoff || '',
      handicap: m.handicap,
      spf: m.spf,
      rqspf: m.rqspf,
      picks: (m.mainPicks || []).map((p) => ({
        play: '比分', pick: p.score, odds: p.odds, tier: '推荐',
      })),
      reason: '',
      rqspf_direction: '',
    });
  }
}

const matches = [...byCode.values()].sort((a, b) =>
  String(a.kickoff || '').localeCompare(String(b.kickoff || ''))
);

// 串关来源（2026-06-18 对齐）：优先 r013（若跑了），否则回落 predict_31 的 combos
// daily 流程只跑 31，所以常态走 r31.combos 分支
const COMBO_CAP = 5;   // 控制 chat_predict 体积，每类只留 TOP COMBO_CAP

// 3串1
let parlays_3x1 = r013?.direction_a?.parlays_3x1?.map((p) => ({
  picks: p.picks.map((x) => ({
    code: x.code, play: x.play, pickLabel: x.pickLabel, odds: x.odds,
  })),
  totalOdds: Number(p.totalOdds?.toFixed(2) || 0),
})) || [];
if (parlays_3x1.length === 0 && r31?.combos?.c3) {
  parlays_3x1 = r31.combos.c3.slice(0, COMBO_CAP).map((c) => ({
    picks: c.picks.map((x, i) => ({
      code: c.matches[i], play: '比分', pickLabel: x.score, odds: x.odds,
    })),
    totalOdds: Number((c.odds ?? 0).toFixed(2)),
  }));
}

// 2串1
let pairs_2x1 = r013?.direction_b?.pairs_2x1?.map((p) => ({
  a: { code: p.a.code, pick: p.a.pick, odds: p.a.odds },
  b: { code: p.b.code, pick: p.b.pick, odds: p.b.odds },
  totalOdds: Number(p.totalOdds?.toFixed(2) || 0),
})) || [];
if (pairs_2x1.length === 0 && r31?.combos?.c2) {
  pairs_2x1 = r31.combos.c2.slice(0, COMBO_CAP).map((c) => ({
    a: { code: c.matches[0], pick: c.picks[0].score, odds: c.picks[0].odds },
    b: { code: c.matches[1], pick: c.picks[1].score, odds: c.picks[1].odds },
    totalOdds: Number((c.odds ?? 0).toFixed(2)),
  }));
}

const out = {
  date: TODAY,
  generated_at: new Date().toISOString(),
  source_31: r31 ? 'predict_31' : null,
  source_r013: r013 ? 'predict_r013' : null,
  match_count: matches.length,
  matches,
  parlays_3x1,
  pairs_2x1,
};

const outPath = path.join(ART, `chat_predict_${TODAY}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
const sz = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`✅ ${outPath}  (${matches.length} 场, ${parlays_3x1.length} 组 3串1, ${pairs_2x1.length} 组 2串1, ${sz} KB)`);
