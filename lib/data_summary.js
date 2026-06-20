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

// 当前北京时间，格式 "YYYY-MM-DD HH:MM"，与 matches_status 的 kickoff 同格式，可直接字符串比较
export function beijingNowStr() {
  // sv-SE 区域输出 "2026-06-19 14:30" 这种零填充、可按字典序比较的格式
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return fmt.format(new Date());
}

/**
 * 接下来即将开赛的比赛：按开赛时间升序、只保留尚未开赛（kickoff >= 现在）的。
 * 用于给 AI 注入"下一场/即将开赛"的权威依据，避免模型瞎猜或漏掉更早的场次。
 */
export function upcomingMatches(limit = 8) {
  const now = beijingNowStr();
  const data = safeRead(resolve(PROJECT_ROOT, 'data/matches_status.json'));
  const list = Array.isArray(data?.matches) ? data.matches : Object.values(data?.matches || {});
  if (!list.length) return { now, matches: [] };
  const matches = list
    .filter((x) => x && x.kickoff && x.status !== 'finished' && String(x.kickoff) >= now)
    .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)))
    .slice(0, limit)
    .map((x) => ({ code: x.code, home: x.home, away: x.away, kickoff: x.kickoff, status: x.status, league: x.league }));
  return { now, matches };
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
  // 视图按届分两个目录: 本届 data/views/ + 上届 data/2022wc/views/
  // 合并读取维持原本"全样本频次"的语义
  const dirs = [
    resolve(PROJECT_ROOT, 'data/views'),
    resolve(PROJECT_ROOT, 'data/2022wc/views'),
  ].filter(existsSync);
  if (dirs.length === 0) return null;
  const out = {};
  let wcOnly = true; // 站点全部围绕世界杯正赛，过滤掉国际赛混入的全量视图
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      if (wcOnly && !file.includes('_wc_')) continue; // 过滤 spf_view / rqspf_view / bf_view / zjq_view / bqc_view
      const v = safeRead(resolve(dir, file));
      if (!v) continue;
      if (file === 'index.json') {
        // 上届/本届索引各写一份, 合并 plays
        out.index = out.index || { generated_at: v.generated_at, counts: {} };
        out.index.generated_at = v.generated_at;
        out.index.counts = { ...(out.index.counts || {}), ...(v.plays || {}) };
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
        const key = file.replace('.json', '');
        const prev = out[key] || { count: 0, topMap: new Map() };
        prev.count += rows.length;
        for (const [k, n] of Object.entries(freq)) {
          prev.topMap.set(k, (prev.topMap.get(k) || 0) + n);
        }
        out[key] = prev;
      }
    }
  }
  // 把 topMap 转成数组排序
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v && v.topMap) {
      out[k] = {
        count: v.count,
        top: [...v.topMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([key, n]) => ({ key: String(key), n, pct: Number((n / v.count * 100).toFixed(1)) })),
      };
    }
  }
  return out;
}

// combos 现为对象 { c2:[...], c3:[...] }；早期为数组。两种结构都计数。
function countCombos(combos) {
  if (Array.isArray(combos)) return combos.length;
  if (combos && typeof combos === 'object') {
    return Object.values(combos).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
  }
  return 0;
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
      comboCount: countCombos(data.combos),
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
  // matches_status.json 结构为 { generated_at, total, status_definitions, matches: [...] }
  const all = Array.isArray(data.matches) ? data.matches : Object.values(data.matches || {});
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

/* ----- 结构化数据导出（计量制 export 动作，见 api/router.js COSTS.export） ----- */

// 可导出数据集白名单：dataset key → 文件 + 取数组字段 + 标签。
// 只暴露世界杯正赛视图(_wc_)与已完赛赛果，与站点口径一致。
const EXPORT_DATASETS = {
  settled_2026: { file: 'data/settled_matches.json', arr: 'matches', label: '2026 已完赛（赛果）' },
  spf_2026:   { file: 'data/views/spf_wc_view.json',   arr: 'rows', label: '2026 胜平负（含初赔/即时赔率+赛果）' },
  rqspf_2026: { file: 'data/views/rqspf_wc_view.json', arr: 'rows', label: '2026 让球胜平负' },
  bf_2026:    { file: 'data/views/bf_wc_view.json',    arr: 'rows', label: '2026 比分' },
  zjq_2026:   { file: 'data/views/zjq_wc_view.json',   arr: 'rows', label: '2026 总进球' },
  bqc_2026:   { file: 'data/views/bqc_wc_view.json',   arr: 'rows', label: '2026 半全场' },
  spf_2022:   { file: 'data/2022wc/views/spf_wc_view.json',   arr: 'rows', label: '2022 胜平负' },
  rqspf_2022: { file: 'data/2022wc/views/rqspf_wc_view.json', arr: 'rows', label: '2022 让球胜平负' },
  bf_2022:    { file: 'data/2022wc/views/bf_wc_view.json',    arr: 'rows', label: '2022 比分' },
  zjq_2022:   { file: 'data/2022wc/views/zjq_wc_view.json',   arr: 'rows', label: '2022 总进球' },
  bqc_2022:   { file: 'data/2022wc/views/bqc_wc_view.json',   arr: 'rows', label: '2022 半全场' },
};

export const EXPORT_DATASET_KEYS = Object.keys(EXPORT_DATASETS);

export function loadExportRows(ds) {
  const def = EXPORT_DATASETS[ds];
  if (!def) return null;
  const data = safeRead(resolve(PROJECT_ROOT, def.file));
  const rows = data && Array.isArray(data[def.arr]) ? data[def.arr] : [];
  return { label: def.label, generated_at: data?.generated_at || null, rows };
}

// 一层展开嵌套对象（result/initial/last 等）成 dot key，数组/更深结构转 JSON 串
function flattenRow(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenRow(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows) {
  const flat = rows.map((r) => flattenRow(r));
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const head = cols.join(',');
  const body = flat.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${head}\n${body}\n`;
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
