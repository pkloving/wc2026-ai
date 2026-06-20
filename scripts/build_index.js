import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATUS_PATH = path.join(DATA_DIR, 'matches_status.json');
const INDEX_PATH = path.join(DATA_DIR, 'matches_index.json');

const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));

const byStatus = { scheduled: [], on_sale: [], in_progress: [], finished: [], cancelled: [], postponed: [] };
const byLeague = {};
const byDate = {};

for (const m of statusDoc.matches) {
  const s = m.status || 'scheduled';
  if (byStatus[s]) byStatus[s].push(m);
  if (!byLeague[m.league]) byLeague[m.league] = [];
  byLeague[m.league].push(m);
  const date = (m.kickoff || '').split(' ')[0];
  if (date) {
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(m);
  }
}

const output = {
  generated_at: new Date().toISOString(),
  total: statusDoc.matches.length,
  by_status: byStatus,
  by_league: byLeague,
  by_kickoff_date: byDate,
};

fs.writeFileSync(INDEX_PATH, JSON.stringify(output, null, 2), 'utf8');
console.log(`[build_index] ${statusDoc.matches.length} matches indexed`);
console.log(`  finished: ${byStatus.finished.length}, on_sale: ${byStatus.on_sale.length}, scheduled: ${byStatus.scheduled.length}`);
