// scripts/patch_single_supported.js
// 修补：用正确的 API 路径重新拿 single_supported 写回 14 场 odds 文件
// 不重复写历史快照

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const ODDS_DIR = path.join(DATA_DIR, 'odds');
const STATUS_PATH = path.join(DATA_DIR, 'matches_status.json');

const API = 'https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry';
const MIDS = ['2040168','2040169','2040170','2040171','2040172','2040173','2040174','2040175','2040176','2040177','2040178','2040179','2040180','2040181'];

async function fetchSingle(mid) {
  try {
    const res = await fetch(`${API}?clientCode=3001&matchId=${mid}`, {
      headers: { 'Referer': 'https://www.sporttery.cn/jc/zqdz/index.html' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = json.value?.oddsHistory?.singleList || json.value?.singleList || [];
    const map = {};
    for (const s of list) map[s.poolCode] = s.single === 1;
    return map;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log(`Patching single_supported for ${MIDS.length} matches...`);
  const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));

  for (const mid of MIDS) {
    const single = await fetchSingle(mid);
    if (!single) {
      console.log(`  ${mid}: fetch failed`);
      continue;
    }

    // 更新 odds/<mid>.json
    const oddsFile = path.join(ODDS_DIR, `${mid}.json`);
    if (fs.existsSync(oddsFile)) {
      const data = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
      data.basic.single_supported = single;
      fs.writeFileSync(oddsFile, JSON.stringify(data, null, 2), 'utf8');
    }

    // 更新 status
    const entry = statusDoc.matches.find(m => m.mid === mid);
    if (entry) entry.single_supported = single;

    const list = Object.entries(single).filter(([k, v]) => v).map(([k]) => k).join(',') || 'none';
    console.log(`  ${mid}: single=[${list}]`);
  }

  fs.writeFileSync(STATUS_PATH, JSON.stringify(statusDoc, null, 2), 'utf8');
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
