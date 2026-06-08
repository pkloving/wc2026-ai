// 扫描 data/{date}/*.json，生成 matches_index.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_PATH = path.join(DATA_DIR, 'matches_index.json');

function scanDateFolder(dateStr) {
  const dateDir = path.join(DATA_DIR, dateStr);
  if (!fs.existsSync(dateDir)) return [];

  const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const filePath = path.join(dateDir, f);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const b = content.basic || {};
      const o = content.odds || {};

      return {
        file: `${dateStr}/${f}`,
        scraped_at: b.scraped_at,
        mid: b.mid,
        code: b.code,
        league: b.league,
        home: b.home,
        away: b.away,
        kickoff: b.kickoff,
        spf: o.spf_latest,
        handicap: o.handicap,
        rqspf: o.rqspf_latest,
        sale_status: b.sale_status || '在售'
      };
    } catch (e) {
      return { file: `${dateStr}/${f}`, error: e.message };
    }
  });
}

function buildIndex() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error('Data dir not found:', DATA_DIR);
    process.exit(1);
  }

  const dates = fs.readdirSync(DATA_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  const index = {
    generated_at: new Date().toISOString(),
    total_dates: dates.length,
    dates: {}
  };

  let totalMatches = 0;
  for (const date of dates) {
    const matches = scanDateFolder(date);
    index.dates[date] = {
      count: matches.length,
      matches
    };
    totalMatches += matches.length;
  }

  index.total_matches = totalMatches;

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  console.log(`Indexed ${totalMatches} matches across ${dates.length} dates`);
  console.log(`Index: ${INDEX_PATH}`);
}

buildIndex();
