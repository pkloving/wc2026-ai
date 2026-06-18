/**
 * lib/data_summary.js
 * ---------------------------------------------------------------
 * 汇总本地 data/ + modeling/artifacts/ 里的关键文件，给 admin 控制台
 * 和公开数据看板（/simulate.html）共用：
 *   - settled_matches 概况
 *   - 5 玩法视图频率（spf / rqspf / bf / zjq / bqc，仅保留 *_wc_ 世界杯正赛视图）
 *   - 最新 predict_31_<date>.json 摘要
 *   - 最新 chat_predict_<date>.json
 *   - roi_insights.json TOP 建议（如果有）
 *   - matches_status 概览
 *
 * 所有文件用 fs.readFileSync 读，部署在 Vercel 时跟着 git 一起发。
 * 失败不抛 5xx，找不到的文件就 return null，方便前端兜底。
 *
 * 这里只是纯数据汇总，不做鉴权 / CORS，调用方自行包 handler。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './env.js';

function safeRead(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function findLatest(dir, prefix) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  if (!files.length) return null;
  files.sort();
  return files[files.length - 1];
}

function summarizeSettled(settled) {
  if (!settled?.matches?.length) return null;
  const m = settled.matches;
  return {
    total: m.length,
    generated_at: settled.generated_at,
    by_league: m.reduce((acc, x) => {
      acc[x.league] = (acc[x.league] || 0) + 1;
      return acc;
    }, {}),
    sample: m.slice(-3).map((x) => ({
      code: x.code, home: x.home, away: x.away, kickoff: x.kickoff,
      final_score: x.final_score,
    })),
  };
}

function summarizeViews() {
  const dir = resolve(PROJECT_ROOT, 'data/views');
  if (!existsSync(dir)) return null;
  const out = {};
  let wcOnly = true; // 站点全部围绕世界杯正赛，过滤掉国际赛混入的全量视图
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    if (wcOnly && !file.includes('_wc_')) continue; // 过滤 spf_view / rqspf_view / bf_view / zjq_view / bqc_view
    const v = safeRead(resolve(dir, file));
    if (!v) continue;
    if (file === 'index.json') {
      out.index = { generated_at: v.generated_at, counts: v.counts };
    } else {
      const rows = v.rows || [];
      // 统计每个 key 出现次数
      // 注：BF 的 result 是 {score, other} 对象，需特殊处理
      const freq = {};
      for (const r of rows) {
        let k = r.result;
        if (k && typeof k === 'object') {
          k = k.other || k.score || 'unknown';
        }
        if (!k) continue;
        freq[k] = (freq[k] || 0) + 1;
      }
      out[file.replace('.json', '')] = {
        count: rows.length,
        top: Object.entries(freq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => ({ key: String(k), n: v, pct: Number((v / rows.length * 100).toFixed(1)) })),
      };
    }
  }
  return out;
}

function summarizePredict(prefix) {
  const dir = resolve(PROJECT_ROOT, 'modeling/artifacts');
  const file = findLatest(dir, prefix);
  if (!file) return null;
  const data = safeRead(resolve(dir, file));
  if (!data) return null;
  if (prefix.startsWith('chat_predict')) {
    return {
      file, date: data.date, match_count: data.match_count,
      matches: (data.matches || []).map((m) => ({
        code: m.code, home: m.home, away: m.away, kickoff: m.kickoff,
        handicap: m.handicap, picks: m.picks, reason: m.reason,
      })),
      parlays_3x1: data.parlays_3x1 || [],
      pairs_2x1: data.pairs_2x1 || [],
    };
  }
  if (prefix.startsWith('predict_31')) {
    return {
      file, date: data.date,
      matches: (data.matches || []).map((m) => ({
        code: m.code, home: m.home, away: m.away, kickoff: m.kickoff,
        handicap: m.handicap, spf: m.spf, rqspf: m.rqspf,
        mainPicks: m.mainPicks, singleBets: m.singleBets,
        score: m.score, confidence: m.confidence,
      })),
      comboCount: (data.combos || []).length,
    };
  }
  return { file, summary: 'present' };
}

function summarizeRoiInsights() {
  const dir = resolve(PROJECT_ROOT, 'modeling/artifacts');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('roi_insights') && f.endsWith('.json'));
  if (!files.length) return null;
  const data = safeRead(resolve(dir, files[0]));
  if (!data) return null;
  return {
    file: files[0],
    generated_at: data.generated_at,
    n_matches: data.n_matches,
    top_advices: (data.top_advices || []).slice(0, 8),
  };
}

function summarizeMatchesStatus() {
  const data = safeRead(resolve(PROJECT_ROOT, 'data/matches_status.json'));
  if (!data) return null;
  const all = Object.values(data);
  const byStatus = all.reduce((acc, x) => {
    acc[x.status] = (acc[x.status] || 0) + 1;
    return acc;
  }, {});
  const upcoming = all
    .filter((x) => x.status === 'on_sale' || x.status === 'scheduled')
    .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)))
    .slice(0, 10)
    .map((x) => ({ code: x.code, home: x.home, away: x.away, kickoff: x.kickoff, status: x.status }));
  return { total: all.length, by_status: byStatus, upcoming };
}

/**
 * 一次返回所有摘要，供 admin/data 和公开 /api/data 共用
 */
export function summarizeAll() {
  return {
    fetched_at: new Date().toISOString(),
    settled: summarizeSettled(safeRead(resolve(PROJECT_ROOT, 'data/settled_matches.json'))),
    views: summarizeViews(),
    matches_status: summarizeMatchesStatus(),
    predict_31: summarizePredict('predict_31_'),
    chat_predict: summarizePredict('chat_predict_'),
    roi_insights: summarizeRoiInsights(),
  };
}
