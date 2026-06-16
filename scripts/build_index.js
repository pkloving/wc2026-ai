// scripts/build_index.js
// 扫描 data/odds/<mid>.json + data/matches_status.json
// 生成 data/matches_index.json（按状态分组的轻量索引）
//
// 运行：node scripts/build_index.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const ODDS_DIR = path.join(DATA_DIR, 'odds');
const HISTORY_DIR = path.join(DATA_DIR, 'odds_history');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const STATUS_PATH = path.join(DATA_DIR, 'matches_status.json');
const INDEX_PATH = path.join(DATA_DIR, 'matches_index.json');

if (!fs.existsSync(STATUS_PATH)) {
  console.error('matches_status.json not found, run migrate_v1_to_v2.js first');
  process.exit(1);
}

const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
const index = {
  generated_at: new Date().toISOString(),
  total: statusDoc.matches.length,
  by_status: {
    scheduled: [],
    on_sale: [],
    in_progress: [],
    finished: [],
    cancelled: [],
    postponed: []
  },
  by_league: {},
  by_kickoff_date: {}
};

let totalHistory = 0;
for (const m of statusDoc.matches) {
  // 历史快照数
  const histFile = m.history_file ? path.join(DATA_DIR, m.history_file) : null;
  let histCount = 0;
  if (fs.existsSync(histFile)) {
    const h = JSON.parse(fs.readFileSync(histFile, 'utf8'));
    histCount = (h.spf_history?.length || 0) + (h.rqspf_history?.length || 0);
    totalHistory += histCount;
  }

  const entry = {
    mid: m.mid,
    code: m.code,
    league: m.league,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    status: m.status,
    spf: m.spf,
    handicap: m.handicap,
    rqspf: m.rqspf,
    final_score: m.final_score,
    scraped_at: m.scraped_at,
    history_snapshots: histCount,
    odds_file: m.odds_file
  };

  // 按状态分组
  if (!index.by_status[m.status]) index.by_status[m.status] = [];
  index.by_status[m.status].push(entry);

  // 按联赛分组
  if (!index.by_league[m.league]) index.by_league[m.league] = [];
  index.by_league[m.league].push(entry);

  // 按开赛日期分组（取 YYYY-MM-DD 部分）
  const dateKey = (m.kickoff || '').slice(0, 10);
  if (dateKey) {
    if (!index.by_kickoff_date[dateKey]) index.by_kickoff_date[dateKey] = [];
    index.by_kickoff_date[dateKey].push(entry);
  }
}

// 排序每个分组（按 kickoff）
const sortByKickoff = (a, b) => (a.kickoff || '').localeCompare(b.kickoff || '');
Object.values(index.by_status).forEach(arr => arr.sort(sortByKickoff));
Object.values(index.by_league).forEach(arr => arr.sort(sortByKickoff));
Object.values(index.by_kickoff_date).forEach(arr => arr.sort(sortByKickoff));

fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');

console.log(`Indexed ${index.total} matches`);
console.log(`  by status: scheduled=${index.by_status.scheduled.length}, on_sale=${index.by_status.on_sale.length}, finished=${index.by_status.finished.length}`);
console.log(`  by league: ${Object.entries(index.by_league).map(([k, v]) => `${k}=${v.length}`).join(', ')}`);
console.log(`Total history snapshots: ${totalHistory}`);
console.log(`Index: ${INDEX_PATH}`);
