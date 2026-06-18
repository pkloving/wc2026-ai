#!/usr/bin/env node
/**
 * Build the RAG embedding index from project data.
 *
 *   node scripts/build_embeddings.js
 *
 * Source: data/matches_status.json + data/odds/<mid>.json + data/results/<mid>.json
 *         + data/teams/*.json + modeling/artifacts/recommend_*.json
 *         + modeling/artifacts/predict_*.json
 * Output: public/data/embeddings/index.json (served statically at /data/embeddings/index.json)
 *
 * Requires SILICONFLOW_API_KEY in .env (or process.env).
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { embedTexts } from '../lib/siliconflow.js';
import { env } from '../lib/env.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
// Output lives under public/ so vite ships it to dist/ and serves it at
// /data/embeddings/index.json (the chat API fetches it at runtime on Vercel).
const OUT_DIR = resolve(ROOT, 'public/data/embeddings');
const OUT_FILE = resolve(OUT_DIR, 'index.json');

/* ------------------------------------------------------------------ */
/* chunk builders                                                     */
/* ------------------------------------------------------------------ */

function chunkMatch(m) {
  // 比赛总览：来自 matches_status.json
  const spf = m.spf ? `胜 ${m.spf.home} / 平 ${m.spf.draw} / 负 ${m.spf.away}` : '暂无';
  const rq = m.rqspf
    ? `让球 ${m.handicap >= 0 ? '+' + m.handicap : m.handicap}：让胜 ${m.rqspf.home} / 让平 ${m.rqspf.draw} / 让负 ${m.rqspf.away}`
    : '暂无';
  const fin = m.final_score ? `完赛比分 ${m.final_score}` : '未完赛';
  return {
    id: `match:${m.mid}`,
    type: 'match',
    text: `【${m.code}】${m.league} | ${m.home} vs ${m.away}\n开赛：${m.kickoff} | 状态：${m.status}\n胜平负：${spf}\n${rq}\n${fin}`,
    meta: { id: m.mid, code: m.code, home: m.home, away: m.away, type: 'match' },
  };
}

function chunkOddsDetail(mid) {
  const file = resolve(ROOT, `data/odds/${mid}.json`);
  if (!existsSync(file)) return null;
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const spf = d.odds?.spf_latest;
  const rq = d.odds?.rqspf_latest;
  const bf = d.odds?.bf_latest;
  const zjq = d.odds?.zjq_latest;
  const bqc = d.odds?.bqc_latest;
  const spfStr = spf ? `胜 ${spf.home} / 平 ${spf.draw} / 负 ${spf.away}` : '暂无';
  const rqStr = rq ? `让球 ${d.odds.handicap}：让胜 ${rq.home} / 让平 ${rq.draw} / 让负 ${rq.away}` : '暂无';
  const bfStr = bf ? Object.entries(bf).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(', ') : '暂无';
  const zjqStr = zjq ? Object.entries(zjq).map(([k, v]) => `${k}=${v}`).join(', ') : '暂无';
  const bqcStr = bqc ? Object.entries(bqc).slice(0, 9).map(([k, v]) => `${k}=${v}`).join(', ') : '暂无';
  return {
    id: `odds:${mid}`,
    type: 'odds',
    text: `【${d.basic.code}】${d.basic.home} vs ${d.basic.away} 详细赔率\n胜平负：${spfStr}\n${rqStr}\n比分：${bfStr}\n总进球：${zjqStr}\n半全场：${bqcStr}`,
    meta: { id: mid, home: d.basic.home, away: d.basic.away, type: 'odds' },
  };
}

function chunkResult(mid) {
  const file = resolve(ROOT, `data/results/${mid}.json`);
  if (!existsSync(file)) return null;
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const scorerStr = r.scorers?.length
    ? r.scorers.map((s) => `${s.team} ${s.player} ${s.type==='penalty'?'(点)':''} ${s.minute}'`).join('; ')
    : '无';
  return {
    id: `result:${mid}`,
    type: 'result',
    text: `完赛 ${mid}\n比分：${r.homeScore} - ${r.awayScore}\n半场：${r.halfTime?.home ?? '-'} - ${r.halfTime?.away ?? '-'}\n进球：${scorerStr}\n点球大战：${r.wentToPenalties ? `是 ${r.penaltyScore}` : '否'}`,
    meta: { id: mid, type: 'result' },
  };
}

function chunkTeam(code) {
  const file = resolve(ROOT, `data/teams/${code}.json`);
  if (!existsSync(file)) return null;
  const t = JSON.parse(readFileSync(file, 'utf8'));
  const hist = t.history_wc2022 ? `上届：${t.history_wc2022.description}（${t.history_wc2022.cold_history || ''}）` : '';
  const wc26 = t.wc2026
    ? `本届：小组 ${t.wc2026.group}，排名 ${t.wc2026.standings?.position}，积分 ${t.wc2026.standings?.pts}（${t.wc2026.standings?.win}胜${t.wc2026.standings?.draw}平${t.wc2026.standings?.lose}负，进${t.wc2026.standings?.gf}失${t.wc2026.standings?.ga}）`
    : '';
  const next = t.wc2026?.matches?.filter((m) => m.status === 'scheduled').map((m) => `${m.date} ${m.role === 'home' ? '主' : '客'} ${m.opponent_name}`).join('；');
  return {
    id: `team:${code}`,
    type: 'team',
    text: `${t.flag} ${t.name}（${t.nameEn}）\n所属足联：${t.confederation} | 档位：${t.meta?.tier} | 风格：${t.meta?.style}\n核心球员：${(t.meta?.stars || []).join('、')}\n${hist}\n${wc26}\n${next ? '未来比赛：' + next : ''}`,
    meta: { id: code, name: t.name, type: 'team' },
  };
}

// Normalize a pick object (or string) to a uniform {play, pick, odds} shape.
function fmtPick(p) {
  if (!p) return null;
  if (typeof p === 'string') return { play: '?', pick: p, odds: '?' };
  return {
    play: p.play || '?',
    pick: p.pick || p.score || p.pickLabel || '?',
    odds: p.odds ?? '?',
  };
}

// Try every known shape and return up to N pick records for a match.
function extractPicks(m) {
  const out = [];

  // 1) recommend_r012 style: picks is a dict {spf, rqspf, bf, zjq, play, ...}
  if (m.picks && typeof m.picks === 'object' && !Array.isArray(m.picks)) {
    for (const key of ['spf', 'rqspf', 'zjq', 'bqc', 'play']) {
      const v = m.picks[key];
      if (v && typeof v === 'object' && !Array.isArray(v) && v.pick) {
        const p = fmtPick(v);
        if (p) out.push(p);
      }
    }
    // array-valued keys (bf is normally an array of score picks)
    for (const key of ['bf']) {
      const v = m.picks[key];
      if (Array.isArray(v)) {
        for (const p of v.slice(0, 3)) {
          const fp = fmtPick(p);
          if (fp) out.push(fp);
        }
      }
    }
  } else if (Array.isArray(m.picks)) {
    // 2) older / generic shape: picks is a flat array
    for (const p of m.picks.slice(0, 5)) {
      const fp = fmtPick(p);
      if (fp) out.push(fp);
    }
  }

  // 3) r013 style: bf_picks + rqspf_picks at the match level
  if (Array.isArray(m.bf_picks)) {
    for (const p of m.bf_picks.slice(0, 3)) {
      const fp = fmtPick(p);
      if (fp) out.push(fp);
    }
  }
  if (m.rqspf_picks?.picks) {
    const rqOdds = m.rqspf || {};
    for (const side of m.rqspf_picks.picks.slice(0, 2)) {
      out.push({ play: 'rqspf', pick: side, odds: rqOdds[side] ?? '?' });
    }
  }

  // 4) 31 strategy style: mainPicks + singleBets
  if (Array.isArray(m.mainPicks)) {
    for (const p of m.mainPicks.slice(0, 3)) {
      const fp = fmtPick(p);
      if (fp) out.push(fp);
    }
  }
  if (Array.isArray(m.singleBets)) {
    for (const p of m.singleBets.slice(0, 3)) {
      const fp = fmtPick(p);
      if (fp) out.push(fp);
    }
  }

  return out.slice(0, 6);
}

function chunkRecommend(file) {
  if (!existsSync(file)) return null;
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const alg = d.algorithm?.name || d.algorithm || d.strategy || '';
  const target = d.target_date || d.scope || d.date || '';
  const matches = d.matches || [];
  const out = [];

  // Per-match chunks (may have empty picks when file is parlays-style)
  for (const m of matches) {
    const picks = extractPicks(m);
    const pickLine = picks.length
      ? picks.map((p) => `${p.play}=${p.pick}@${p.odds}`).join('；')
      : '见方向策略(direction_a/b)';
    out.push({
      id: `rec:${target || 'unknown'}:${m.mid || m.code}`,
      type: 'recommend',
      text:
        `推荐（${target}）算法：${alg}\n` +
        `${m.code} ${m.home} vs ${m.away} 开赛 ${m.kickoff} 让球 ${m.handicap}\n` +
        `策略：${pickLine}` +
        (m.direction ? `\n方向：${m.direction}` : '') +
        (m.style ? `\n对阵：${m.style}${m.star ? ' / 核心:' + m.star : ''}${m.cold ? ' / 冷门史:' + m.cold : ''}` : '') +
        (m.pre_analysis ? `\n预分析：${m.pre_analysis}` : ''),
      meta: { id: m.mid, code: m.code, target, type: 'recommend' },
    });
  }

  // Top-level strategy summary chunks (parlays.json style: direction_a/b at root)
  for (const key of ['direction_a', 'direction_b', 'direction_c']) {
    const block = d[key];
    if (!block) continue;
    const singles = block.singles?.length ?? 0;
    const pairs = block.pairs_2x1?.length ?? block.pairs?.length ?? 0;
    const parlays = block.parlays_3x1?.length ?? block.parlays?.length ?? 0;
    const lines = [];
    if (block.singles) {
      for (const s of block.singles.slice(0, 5)) {
        lines.push(`单关 ${s.play}=${s.pick}@${s.odds} (${s.code} ${s.home}vs${s.away})`);
      }
    }
    if (block.parlays_3x1) {
      for (const p of block.parlays_3x1.slice(0, 3)) {
        const parts = (p.picks || []).map((x) => `${x.play}=${x.pick}@${x.odds}`).join(' + ');
        lines.push(`3串1 倍率${p.totalOdds} EV=${p.ev}：${parts}`);
      }
    }
    if (block.pairs_2x1) {
      for (const p of block.pairs_2x1.slice(0, 3)) {
        const high = p.high ? `${p.high.play}=${p.high.pick}@${p.high.odds}` : '';
        const low = p.low ? `${p.low.play}=${p.low.pick}@${p.low.odds}` : '';
        lines.push(`2串1 倍率${p.totalOdds}：${high} × ${low}`);
      }
    }
    out.push({
      id: `rec:${target || 'unknown'}:${key}`,
      type: 'recommend_summary',
      text:
        `推荐策略（${target}）${key}\n` +
        `单关 ${singles} 条 / 2串1 ${pairs} 条 / 3串1 ${parlays} 条\n` +
        lines.join('\n'),
      meta: { target, type: 'recommend_summary', key },
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  if (!env('SILICONFLOW_API_KEY')) {
    console.error('❌ SILICONFLOW_API_KEY not set. Add it to .env first.');
    process.exit(1);
  }

  console.log('📦 Loading source data...');
  const status = JSON.parse(readFileSync(resolve(ROOT, 'data/matches_status.json'), 'utf8'));
  const matches = status.matches || [];
  console.log(`  - ${matches.length} matches from matches_status.json`);

  // 1) match overview
  const chunks = matches.map(chunkMatch);

  // 2) odds detail
  let oddsCount = 0;
  for (const m of matches) {
    const c = chunkOddsDetail(m.mid);
    if (c) { chunks.push(c); oddsCount++; }
  }
  console.log(`  - ${oddsCount} odds detail chunks`);

  // 3) results
  let resultCount = 0;
  for (const m of matches) {
    const c = chunkResult(m.mid);
    if (c) { chunks.push(c); resultCount++; }
  }
  console.log(`  - ${resultCount} result chunks`);

  // 4) teams
  const teamFiles = readdirSync(resolve(ROOT, 'data/teams')).filter((f) => f.endsWith('.json') && f !== '_index.json');
  for (const f of teamFiles) {
    const c = chunkTeam(f.replace('.json', ''));
    if (c) chunks.push(c);
  }
  console.log(`  - ${teamFiles.length} team chunks`);

  // 5) modeling recommendations
  const artifacts = readdirSync(resolve(ROOT, 'modeling/artifacts'))
    .filter((f) => f.startsWith('recommend_') || f.startsWith('predict_'))
    .filter((f) => f.endsWith('.json'));
  let recCount = 0;
  for (const f of artifacts) {
    const out = chunkRecommend(resolve(ROOT, 'modeling/artifacts', f));
    if (out) { chunks.push(...out); recCount += out.length; }
  }
  console.log(`  - ${recCount} recommend chunks from ${artifacts.length} artifact files`);

  console.log(`\n🔢 Total chunks to embed: ${chunks.length}`);

  // 6) embed in batches (SiliconFlow supports batched inputs)
  const BATCH = 16;
  const vectors = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    process.stdout.write(`  embedding ${i + 1}–${Math.min(i + BATCH, chunks.length)} / ${chunks.length}...\r`);
    const emb = await embedTexts(batch.map((c) => c.text));
    // ensure order matches
    emb.sort((a, b) => a.index - b.index);
    for (const e of emb) vectors.push(e.embedding);
    // tiny pause to be polite to rate limits
    if (i + BATCH < chunks.length) await new Promise((r) => setTimeout(r, 200));
  }
  console.log('');

  const index = {
    generated_at: new Date().toISOString(),
    model: 'BAAI/bge-m3',
    dim: vectors[0]?.length || 0,
    total: chunks.length,
    chunks: chunks.map((c, i) => ({ ...c, vector: vectors[i] })),
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(index));
  console.log(`\n✅ Wrote ${chunks.length} chunks to ${OUT_FILE}`);
  console.log(`   file size: ${(JSON.stringify(index).length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
