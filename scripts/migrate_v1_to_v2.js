// scripts/migrate_v1_to_v2.js
// 一次性迁移：data/{2026-06-08,2026-06-09}/*.json
//   → data/odds/<mid>.json（最新，单一来源）
//   → data/odds_history/<mid>.json（合并时序）
//   → data/results/<mid>.json（按 mid 拆）
//   → data/matches_status.json（总表，标状态）
//   → 删除旧目录 data/2026-06-08 data/2026-06-09
//
// 运行：node scripts/migrate_v1_to_v2.js
// 验证后（OK 删；不 OK git checkout . 恢复）

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const OLD_DIRS = ['2026-06-08', '2026-06-09'];
const NEW_ODDS_DIR = path.join(DATA_DIR, 'odds');
const NEW_HIST_DIR = path.join(DATA_DIR, 'odds_history');
const NEW_RESULTS_DIR = path.join(DATA_DIR, 'results');
const STATUS_PATH = path.join(DATA_DIR, 'matches_status.json');
const RESULTS_JSON_PATH = path.join(DATA_DIR, 'results.json');

// 1. 创建新目录
for (const d of [NEW_ODDS_DIR, NEW_HIST_DIR, NEW_RESULTS_DIR]) {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
    console.log(`Created dir: ${path.relative(DATA_DIR, d)}/`);
  } else {
    console.log(`Dir exists: ${path.relative(DATA_DIR, d)}/`);
  }
}

// 2. 扫描所有旧文件
const allFiles = [];
for (const oldDir of OLD_DIRS) {
  const dir = path.join(DATA_DIR, oldDir);
  if (!fs.existsSync(dir)) {
    console.log(`Old dir not found, skipping: ${oldDir}`);
    continue;
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    allFiles.push({ oldDir, file: f, fullPath: path.join(dir, f) });
  }
}
console.log(`Scanned ${allFiles.length} old json files`);

// 3. 按 mid 分组
const byMid = {};
for (const { oldDir, file, fullPath } of allFiles) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (e) {
    console.warn(`Parse failed: ${oldDir}/${file} - ${e.message}`);
    continue;
  }
  const mid = data.basic?.mid;
  if (!mid) {
    console.warn(`No mid in ${oldDir}/${file}, skipping`);
    continue;
  }
  if (!byMid[mid]) byMid[mid] = [];
  byMid[mid].push({ oldDir, file, data });
}
console.log(`Found ${Object.keys(byMid).length} unique matches`);

// 4. 处理每场比赛
const statusEntries = [];
let mergedSnapshots = 0;
for (const mid of Object.keys(byMid)) {
  const entries = byMid[mid];
  // 按时间排序（旧→新）
  entries.sort((a, b) => a.oldDir.localeCompare(b.oldDir));

  // 4a. 写入 data/odds/<mid>.json（最新 = 最后一个 entry）
  const latest = entries[entries.length - 1].data;
  const oddsOnly = JSON.parse(JSON.stringify(latest));
  if (oddsOnly.odds) {
    // 去掉 _history，保留 _latest
    delete oddsOnly.odds.spf_history;
    delete oddsOnly.odds.rqspf_history;
  }
  fs.writeFileSync(
    path.join(NEW_ODDS_DIR, `${mid}.json`),
    JSON.stringify(oddsOnly, null, 2),
    'utf8'
  );

  // 4b. 写入 data/odds_history/<mid>.json（合并所有历史快照）
  const spfHistory = [];
  const rqspfHistory = [];
  const seen = new Set();
  for (const { data } of entries) {
    if (data.odds?.spf_history) {
      for (const snap of data.odds.spf_history) {
        const key = `spf|${snap.time}|${snap.home}|${snap.draw}|${snap.away}`;
        if (!seen.has(key)) {
          seen.add(key);
          spfHistory.push(snap);
        }
      }
    }
    if (data.odds?.rqspf_history) {
      for (const snap of data.odds.rqspf_history) {
        const key = `rqspf|${snap.time}|${snap.home}|${snap.draw}|${snap.away}`;
        if (!seen.has(key)) {
          seen.add(key);
          rqspfHistory.push(snap);
        }
      }
    }
  }
  // 按时间排序
  spfHistory.sort((a, b) => a.time.localeCompare(b.time));
  rqspfHistory.sort((a, b) => a.time.localeCompare(b.time));
  mergedSnapshots += spfHistory.length + rqspfHistory.length;
  fs.writeFileSync(
    path.join(NEW_HIST_DIR, `${mid}.json`),
    JSON.stringify(
      {
        mid,
        spf_history: spfHistory,
        rqspf_history: rqspfHistory
      },
      null,
      2
    ),
    'utf8'
  );

  // 4c. 加入 status
  const b = latest.basic || {};
  const o = latest.odds || {};
  statusEntries.push({
    mid,
    code: b.code,
    league: b.league,
    home: b.home,
    away: b.away,
    kickoff: b.kickoff,
    status: deriveStatus(b, o, latest),
    spf: o.spf_latest || null,
    handicap: o.handicap ?? null,
    rqspf: o.rqspf_latest || null,
    scraped_at: b.scraped_at,
    sale_status: b.sale_status || '在售',
    odds_file: `odds/${mid}.json`,
    history_file: `odds_history/${mid}.json`
  });
}

function deriveStatus(b, o) {
  if (b.sale_status === '待开售') return 'scheduled';
  if (!o.spf_latest && !o.rqspf_latest) return 'scheduled';
  return 'on_sale';
}

// 5. 处理 results
let resultsCount = 0;
if (fs.existsSync(RESULTS_JSON_PATH)) {
  const results = JSON.parse(fs.readFileSync(RESULTS_JSON_PATH, 'utf8'));
  for (const r of results) {
    fs.writeFileSync(
      path.join(NEW_RESULTS_DIR, `${r.matchId}.json`),
      JSON.stringify(r, null, 2),
      'utf8'
    );
    resultsCount++;
    // 同步更新 status
    const entry = statusEntries.find(e => e.mid === r.matchId);
    if (entry) {
      entry.status = 'finished';
      entry.final_score = `${r.homeScore}-${r.awayScore}`;
      entry.result_file = `results/${r.matchId}.json`;
    }
  }
}
console.log(`Migrated ${resultsCount} results to data/results/<mid>.json`);

// 6. 写入 matches_status.json（按 kickoff 排序）
statusEntries.sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || ''));
const statusOutput = {
  generated_at: new Date().toISOString(),
  total: statusEntries.length,
  status_definitions: {
    scheduled: '未开售（odds 都 null）',
    on_sale: '已开售（有 spf 或 rqspf 任一）',
    in_progress: '比赛中（kickoff 已过未完赛）',
    finished: '已完赛（有 results/<mid>.json）',
    cancelled: '取消',
    postponed: '延期'
  },
  matches: statusEntries
};
fs.writeFileSync(STATUS_PATH, JSON.stringify(statusOutput, null, 2), 'utf8');
console.log(`Wrote ${statusEntries.length} matches to matches_status.json`);
console.log(`Merged ${mergedSnapshots} total history snapshots`);

// 7. 删除旧目录
console.log('\n--- Deleting old directories ---');
for (const oldDir of OLD_DIRS) {
  const dir = path.join(DATA_DIR, oldDir);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Deleted: ${oldDir}/`);
  }
}

console.log('\n=== Migration complete ===');
console.log(`Status: ${STATUS_PATH}`);
console.log(`Odds: ${NEW_ODDS_DIR}/ (${Object.keys(byMid).length} files)`);
console.log(`History: ${NEW_HIST_DIR}/ (${Object.keys(byMid).length} files)`);
console.log(`Results: ${NEW_RESULTS_DIR}/ (${resultsCount} files)`);
