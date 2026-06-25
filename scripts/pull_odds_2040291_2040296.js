// scripts/pull_odds_2040291_2040296.js
// 一次性脚本：拉 M055-M060 (mid 2040291-2040296) 6 场比赛的赔率
// 由 2026-06-25 9:00 CST code 模式 daily 流程触发
// 数据源：getFixedBonusV1.qry?clientCode=3001&matchId=<mid>
// 输出：data/odds/<mid>.json + data/odds_history/<mid>.json + 更新 matches_status.json
//
// 用法：node scripts/pull_odds_2040291_2040296.js
//      或 node scripts/pull_odds_2040291_2040296.js --dry-run

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const ODDS_DIR = path.join(DATA_DIR, 'odds');
const HIST_DIR = path.join(DATA_DIR, 'odds_history');
const STATUS_PATH = path.join(DATA_DIR, 'matches_status.json');

const API = 'https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry';
const REFERER = 'https://www.sporttery.cn/jc/zqdz/index.html';

const ARGV = process.argv.slice(2);
const DRY_RUN = ARGV.includes('--dry-run');

// 本次要拉的 6 个 mid（M055-M060 世界杯第二轮 6-26 段）
const TARGET_MIDS = ['2040291', '2040292', '2040293', '2040294', '2040295', '2040296'];

// === 复制自 scrape_fixed_bonus.js 的解析函数（保持一致） ===
function parseCrs(crsList) {
  if (!crsList || !crsList.length) return null;
  const latest = crsList[crsList.length - 1];
  const bf = {};
  for (const [key, val] of Object.entries(latest)) {
    if (key.startsWith('s') && key !== 'updateDate' && key !== 'updateTime' && key !== 'goalLine') {
      const m = key.match(/^s(-?\d+)s(-?\d+|h|d|a)$/);
      if (m) {
        const home = m[1];
        const away = m[2];
        let label;
        if (home === '-1' && away === 'h') label = '胜其它';
        else if (home === '-1' && away === 'd') label = '平其它';
        else if (home === '-1' && away === 'a') label = '负其它';
        else label = `${home}:${away}`;
        if (parseFloat(val) > 0) bf[label] = parseFloat(val);
      }
    }
  }
  return bf;
}

function parseTtgs(ttgList) {
  if (!ttgList || !ttgList.length) return null;
  const latest = ttgList[ttgList.length - 1];
  const zjqs = {};
  for (let i = 0; i <= 7; i++) {
    const key = i === 7 ? 's7' : `s${i}`;
    if (latest[key] && parseFloat(latest[key]) > 0) {
      zjqs[i === 7 ? '7+' : String(i)] = parseFloat(latest[key]);
    }
  }
  return zjqs;
}

function parseHafu(hafuList) {
  if (!hafuList || !hafuList.length) return null;
  const latest = hafuList[hafuList.length - 1];
  const map = { hh: '胜胜', hd: '胜平', ha: '胜负', dh: '平胜', dd: '平平', da: '平负', ah: '负胜', ad: '负平', aa: '负负' };
  const bqc = {};
  for (const [k, label] of Object.entries(map)) {
    if (latest[k] && parseFloat(latest[k]) > 0) {
      bqc[label] = parseFloat(latest[k]);
    }
  }
  return bqc;
}

function parseHad(hadList) {
  if (!hadList || !hadList.length) return null;
  const latest = hadList[hadList.length - 1];
  if (!latest.h || parseFloat(latest.h) === 0) return null;
  return { home: parseFloat(latest.h), draw: parseFloat(latest.d), away: parseFloat(latest.a) };
}

function parseHhad(hhadList) {
  if (!hhadList || !hhadList.length) return null;
  const latest = hhadList[hhadList.length - 1];
  if (!latest.h || parseFloat(latest.h) === 0) return null;
  return {
    handicap: parseInt(latest.goalLine || 0),
    home: parseFloat(latest.h),
    draw: parseFloat(latest.d),
    away: parseFloat(latest.a)
  };
}

function parseSingleList(singleList) {
  const map = {};
  for (const s of singleList || []) {
    map[s.poolCode] = s.single === 1;
  }
  return map;
}

function sameOdds(a, b) {
  if (!a || !b) return false;
  return a.home === b.home && a.draw === b.draw && a.away === b.away;
}

function sameDict(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function pushOrKeepLatest(arr, entry, compareFn) {
  if (arr.length === 0) { arr.push(entry); return true; }
  if (arr.length === 1) {
    if (compareFn(arr[0], entry)) return false;
    arr.push(entry); return true;
  }
  if (compareFn(arr[0], entry)) { arr.splice(1); return true; }
  const last = arr[arr.length - 1];
  if (compareFn(last, entry)) return false;
  arr.length = 1;
  arr.push(entry);
  return true;
}

function getLatestTime(arr) {
  if (!arr || !arr.length) return null;
  const last = arr[arr.length - 1];
  if (!last) return null;
  return `${last.updateDate} ${last.updateTime}`;
}

function parseMatchResultList(apiData) {
  const mrl = apiData?.matchResultList;
  if (!mrl || !Array.isArray(mrl) || mrl.length === 0) return null;
  const byCode = {};
  for (const item of mrl) byCode[item.code] = item;
  let homeScore = null, awayScore = null;
  if (byCode.CRS?.combination) {
    const m = String(byCode.CRS.combination).match(/^(\d+):(\d+)$/);
    if (m) { homeScore = parseInt(m[1], 10); awayScore = parseInt(m[2], 10); }
  }
  if (homeScore === null && apiData.sectionsNo999) {
    const m = String(apiData.sectionsNo999).match(/^(\d+):(\d+)$/);
    if (m) { homeScore = parseInt(m[1], 10); awayScore = parseInt(m[2], 10); }
  }
  return { homeScore, awayScore };
}

async function fetchMatch(mid) {
  const url = `${API}?clientCode=3001&matchId=${mid}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Referer': REFERER,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errorCode !== '0') throw new Error(`API error: ${json.errorMessage}`);
    return json.value;
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  if (!fs.existsSync(ODDS_DIR)) fs.mkdirSync(ODDS_DIR, { recursive: true });
  if (!fs.existsSync(HIST_DIR)) fs.mkdirSync(HIST_DIR, { recursive: true });

  const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  const statusByMid = new Map(statusDoc.matches.map((m) => [m.mid, m]));

  const stats = { appended: 0, unchanged: 0, error: 0 };
  console.log(`=== pull_odds_2040291_2040296 ===`);
  console.log(`target mids: ${TARGET_MIDS.join(', ')}`);
  if (DRY_RUN) console.log('  [DRY RUN] 不写盘');
  console.log();

  for (const mid of TARGET_MIDS) {
    const st = statusByMid.get(mid);
    if (!st) {
      console.error(`  ${mid}: 在 matches_status.json 找不到 mid 记录`);
      stats.error += 1;
      continue;
    }

    const apiData = await fetchMatch(mid);
    if (apiData.error) {
      console.error(`  ${mid} (${st.code}): ${apiData.error}`);
      stats.error += 1;
      continue;
    }

    const parsedResult = parseMatchResultList(apiData);
    const apiSaysFinished = parsedResult !== null;

    const spf = parseHad(apiData.oddsHistory?.hadList);
    const hhad = parseHhad(apiData.oddsHistory?.hhadList);
    const bf = parseCrs(apiData.oddsHistory?.crsList);
    const zjqs = parseTtgs(apiData.oddsHistory?.ttgList);
    const bqc = parseHafu(apiData.oddsHistory?.hafuList);
    const single = parseSingleList(apiData.oddsHistory?.singleList || apiData.singleList);

    const odds = {
      spf_latest: spf, spf_history: [],
      handicap: hhad ? hhad.handicap : null,
      rqspf_latest: hhad ? { home: hhad.home, draw: hhad.draw, away: hhad.away } : null,
      rqspf_history: [],
      bf_latest: bf, zjq_latest: zjqs, bqc_latest: bqc
    };

    const basic = {
      mid, code: st.code, league: st.league || '世界杯',
      home: st.home, away: st.away, kickoff: st.kickoff,
      url: `${REFERER}?showType=2&mid=${mid}`,
      scraped_at: new Date().toISOString(),
      sale_status: !spf && !odds.rqspf_latest ? '待开售' : '在售',
      single_supported: single,
      is_cancel: apiData.isCancel || 0,
      is_finished_odds: apiSaysFinished
    };

    const fullData = {
      basic, odds,
      source: {
        api: 'getFixedBonusV1.qry',
        fetched_at: new Date().toISOString(),
        snapshot_time: getLatestTime(apiData.oddsHistory?.hadList),
        has_match_result: apiSaysFinished,
        spf_result: null,
        half_time_result: null,
      }
    };

    if (!DRY_RUN) {
      fs.writeFileSync(path.join(ODDS_DIR, `${mid}.json`), JSON.stringify(fullData, null, 2), 'utf8');
    }

    // 写 odds_history
    const histFile = path.join(HIST_DIR, `${mid}.json`);
    let hist = { mid, spf_history: [], rqspf_history: [], bf_history: [], zjq_history: [], bqc_history: [] };
    if (fs.existsSync(histFile) && !DRY_RUN) {
      try {
        const existing = JSON.parse(fs.readFileSync(histFile, 'utf8'));
        hist.mid = existing.mid || mid;
        hist.spf_history = Array.isArray(existing.spf_history) ? existing.spf_history : [];
        hist.rqspf_history = Array.isArray(existing.rqspf_history) ? existing.rqspf_history : [];
        hist.bf_history = Array.isArray(existing.bf_history) ? existing.bf_history : [];
        hist.zjq_history = Array.isArray(existing.zjq_history) ? existing.zjq_history : [];
        hist.bqc_history = Array.isArray(existing.bqc_history) ? existing.bqc_history : [];
      } catch (e) { /* ignore */ }
    }
    const now = new Date().toISOString();
    let anyAppended = false;
    if (spf) { const entry = { time: now, ...spf }; if (pushOrKeepLatest(hist.spf_history, entry, (a, b) => sameOdds(a, b))) anyAppended = true; }
    if (odds.rqspf_latest) { const entry = { time: now, ...odds.rqspf_latest }; if (pushOrKeepLatest(hist.rqspf_history, entry, (a, b) => sameOdds(a, b))) anyAppended = true; }
    if (bf && Object.keys(bf).length > 0) { const entry = { time: now, odds: bf }; if (pushOrKeepLatest(hist.bf_history, entry, (a, b) => sameDict(a.odds, b.odds))) anyAppended = true; }
    if (zjqs && Object.keys(zjqs).length > 0) { const entry = { time: now, odds: zjqs }; if (pushOrKeepLatest(hist.zjq_history, entry, (a, b) => sameDict(a.odds, b.odds))) anyAppended = true; }
    if (bqc && Object.keys(bqc).length > 0) { const entry = { time: now, odds: bqc }; if (pushOrKeepLatest(hist.bqc_history, entry, (a, b) => sameDict(a.odds, b.odds))) anyAppended = true; }
    if (!DRY_RUN) {
      fs.writeFileSync(histFile, JSON.stringify(hist, null, 2), 'utf8');
    }

    // 更新 matches_status.json
    st.spf = spf;
    st.handicap = odds.handicap;
    st.rqspf = odds.rqspf_latest;
    st.scraped_at = basic.scraped_at;
    st.sale_status = basic.sale_status;
    st.single_supported = single;
    st.is_finished_odds = apiSaysFinished;
    if (apiSaysFinished && st.status !== 'finished') {
      st.status = 'finished';
    } else if (st.status !== 'finished') {
      st.status = basic.sale_status === '待开售' ? 'scheduled' : 'on_sale';
    }
    if (parsedResult && parsedResult.homeScore !== null) {
      st.final_score = `${parsedResult.homeScore}:${parsedResult.awayScore}`;
    }

    const spfStr = spf ? `${spf.home}/${spf.draw}/${spf.away}` : 'null';
    const histTag = anyAppended ? '✓' : '·';
    console.log(`  ${histTag} ${mid} (${st.code}): spf=${spfStr} h=${odds.handicap}`);
    if (anyAppended) stats.appended += 1; else stats.unchanged += 1;
  }

  if (!DRY_RUN) {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(statusDoc, null, 2), 'utf8');
    console.log(`\nUpdated ${STATUS_PATH}`);
  }
  console.log(`\nDone. appended=${stats.appended} unchanged=${stats.unchanged} error=${stats.error}`);
}

main().catch(e => { console.error(e); process.exit(1); });
