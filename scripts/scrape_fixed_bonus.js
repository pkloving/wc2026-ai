// scripts/scrape_fixed_bonus.js
// 批量抓 5 玩法全量（spf/rqspf/bf/zjqs/bqc）+ 单关许可
// 数据源：https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=<mid>
//
// **关键新特性**：API 返回 matchResultList = 比赛已完赛
//   - 从 CRS combination 提取最终比分
//   - 从 HAFU combination 提取半全场方向（如 A:A = 半场客/全场客）
//   - 从 HAD/HHAD/TTG 获取其它玩法赛果
//   - 自动写入 data/results/<mid>.json（保留手动的 halfTime/scorers）
//   - 自动把 matches_status.json status 标为 finished + is_finished_odds=true
//
// 使用：node scripts/scrape_fixed_bonus.js
// 输出：data/odds/<mid>.json + data/odds_history/<mid>.json + data/results/<mid>.json
// 状态：更新 data/matches_status.json 的 status / is_finished_odds / final_score

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const ODDS_DIR = path.join(DATA_DIR, 'odds');
const HIST_DIR = path.join(DATA_DIR, 'odds_history');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const STATUS_PATH = path.join(DATA_DIR, 'matches_status.json');

const API = 'https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry';
const REFERER = 'https://www.sporttery.cn/jc/zqdz/index.html';

// 5 玩法 code 映射
const PLAY_CODE_TO_NAME = {
  HAD: 'spf',
  HHAD: 'rqspf',
  CRS: 'bf',
  TTG: 'zjqs',
  HAFU: 'bqc'
};

// 解析 CRS（比分）赔率
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

// 比较两组赔率 {home, draw, away}
function sameOdds(a, b) {
  if (!a || !b) return false;
  return a.home === b.home && a.draw === b.draw && a.away === b.away;
}

// 比较两个完整 odds dict
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

// history 快照策略：仅保留 first / latest_if_different 两条
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

// === 新增：从 matchResultList 提取赛果 ===
function parseMatchResultList(apiData) {
  const mrl = apiData?.matchResultList;
  if (!mrl || !Array.isArray(mrl) || mrl.length === 0) return null;

  const byCode = {};
  for (const item of mrl) {
    byCode[item.code] = item;
  }

  // 比分：CRS.combination = "1:3"
  let homeScore = null, awayScore = null;
  if (byCode.CRS?.combination) {
    const m = String(byCode.CRS.combination).match(/^(\d+):(\d+)$/);
    if (m) { homeScore = parseInt(m[1], 10); awayScore = parseInt(m[2], 10); }
  }
  // 兜底：sectionsNo999
  if (homeScore === null && apiData.sectionsNo999) {
    const m = String(apiData.sectionsNo999).match(/^(\d+):(\d+)$/);
    if (m) { homeScore = parseInt(m[1], 10); awayScore = parseInt(m[2], 10); }
  }

  // spf 方向
  const spfResult = (() => {
    const c = byCode.HAD?.combination;
    if (c === 'H') return 'home';
    if (c === 'D') return 'draw';
    if (c === 'A') return 'away';
    return null;
  })();

  // 让球方向
  const hhad = byCode.HHAD;
  const hhadResult = (() => {
    if (!hhad?.combination) return null;
    if (hhad.combination === 'H') return 'home';
    if (hhad.combination === 'D') return 'draw';
    if (hhad.combination === 'A') return 'away';
    return null;
  })();

  // 总进球
  const ttg = byCode.TTG?.combination;
  const totalGoals = ttg ? String(ttg) : null;

  // 半全场方向：HAFU.combination = "A:A"（半场:全场）
  const hafu = byCode.HAFU?.combination;
  let halfTimeResult = null;
  let fullTimeResult = null;
  if (hafu && hafu.includes(':')) {
    const [h, f] = hafu.split(':');
    const map = { H: 'home', D: 'draw', A: 'away' };
    halfTimeResult = map[h] || null;
    fullTimeResult = map[f] || null;
  }

  return {
    homeScore,
    awayScore,
    spfResult,
    hhadResult,
    hhadGoalLine: hhad?.goalLine || null,
    totalGoals,
    halfTimeResult,
    fullTimeResult,
    hafu: hafu || null,
    odds: {
      spf: byCode.HAD?.odds || null,
      hhad: byCode.HHAD?.odds || null,
      crs: byCode.CRS?.odds || null,
      ttg: byCode.TTG?.odds || null,
      hafu: byCode.HAFU?.odds || null,
    },
  };
}

// 用 sporttery 赛果写/更新 data/results/<mid>.json
// 幂等：已有完整 halfTime+scorers → 保留（这是手动维护的数据）
function writeResultFromApi(mid, result) {
  if (!result || result.homeScore === null || result.awayScore === null) {
    return { updated: false, reason: 'no_score' };
  }
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const resultFile = path.join(RESULTS_DIR, `${mid}.json`);

  let existing = null;
  if (fs.existsSync(resultFile)) {
    try { existing = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch (e) { /* ignore */ }
  }

  // 若已有完整手动数据 → 不覆盖
  if (existing && existing.halfTime && existing.scorers && existing.scorers.length > 0) {
    // 仅同步比分（若有变化），其它保留
    if (existing.homeScore !== result.homeScore || existing.awayScore !== result.awayScore) {
      existing.homeScore = result.homeScore;
      existing.awayScore = result.awayScore;
      fs.writeFileSync(resultFile, JSON.stringify(existing, null, 2), 'utf8');
      return { updated: true, score: `${result.homeScore}:${result.awayScore}`, mode: 'sync_score' };
    }
    return { updated: false, reason: 'manual_data_exists' };
  }

  const entry = {
    matchId: mid,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    halfTime: existing?.halfTime || null,
    scorers: existing?.scorers || [],
    wentToPenalties: existing?.wentToPenalties || false,
    penaltyScore: existing?.penaltyScore || null,
    _fromSporttery: true,
    _halfTimeResult: result.halfTimeResult,
    _spfResult: result.spfResult,
    _totalGoals: result.totalGoals,
  };

  fs.writeFileSync(resultFile, JSON.stringify(entry, null, 2), 'utf8');
  return { updated: true, score: `${result.homeScore}:${result.awayScore}`, mode: 'new' };
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
  const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  const MATCHES = statusDoc.matches.map(m => m.mid);
  const MAIN_LIST = {};
  for (const m of statusDoc.matches) {
    MAIN_LIST[m.mid] = {
      code: m.code, home: m.home, away: m.away,
      kickoff: m.kickoff, league: m.league, status: m.status,
      handicap: m.handicap,
      spf: m.spf ? { h: m.spf.home, d: m.spf.draw, a: m.spf.away } : null,
      rqspf: m.rqspf ? { h: m.rqspf.home, d: m.rqspf.draw, a: m.rqspf.away } : null
    };
  }
  const statusByMid = new Map(statusDoc.matches.map((m) => [m.mid, m]));

  console.log(`Scraping ${MATCHES.length} matches...`);

  // 跳过 is_finished_odds=true 的 mid
  const finishedOddsMids = new Set();
  for (const mid of MATCHES) {
    const oddsFile = path.join(ODDS_DIR, `${mid}.json`);
    if (fs.existsSync(oddsFile)) {
      try {
        const od = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
        if (od && od.basic && od.basic.is_finished_odds === true) {
          finishedOddsMids.add(mid);
        }
      } catch (e) { /* ignore */ }
    }
  }
  if (finishedOddsMids.size > 0) {
    console.log(`R-014 跳过已完赛赔率: ${finishedOddsMids.size} 场（已标 is_finished_odds=true）`);
  }

  const stats = {
    appended: 0, unchanged: 0, scheduled: 0, error: 0,
    finished_odds: 0, result_written: 0, result_skipped: 0
  };

  for (const mid of MATCHES) {
    if (finishedOddsMids.has(mid)) {
      stats.finished_odds += 1;
      continue;
    }
    const list = MAIN_LIST[mid];
    if (!list) {
      console.warn(`  No main list data for ${mid}, skipping`);
      stats.scheduled += 1;
      continue;
    }
    const st = statusByMid.get(mid);
    const isFinishedAlready = st && st.status === 'finished';

    const apiData = await fetchMatch(mid);
    if (apiData.error) {
      console.error(`  ${mid} (${list.code}): ${apiData.error}`);
      stats.error += 1;
      continue;
    }

    // === 检测 matchResultList → 自动写入 results + 标记 finished ===
    const parsedResult = parseMatchResultList(apiData);
    const apiSaysFinished = parsedResult !== null;
    let resultLog = '';

    if (apiSaysFinished) {
      const r = writeResultFromApi(mid, parsedResult);
      if (r.updated) {
        stats.result_written += 1;
        resultLog = ` 🏆result(${r.score}${r.mode === 'sync_score' ? ' sync' : ''})`;
      } else {
        stats.result_skipped += 1;
        resultLog = ` 🏆(result-${r.reason})`;
      }
    }

    // 是否"已完赛"：matches_status 说 finished，或 API 给出 matchResultList
    const isFinished = isFinishedAlready || apiSaysFinished;

    // 解析赔率
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

    // 写入 odds/<mid>.json
    const basic = {
      mid, code: list.code, league: list.league || '世界杯',
      home: list.home, away: list.away, kickoff: list.kickoff,
      url: `${REFERER}?showType=2&mid=${mid}`,
      scraped_at: new Date().toISOString(),
      sale_status: !spf && !odds.rqspf_latest ? '待开售' : '在售',
      single_supported: single,
      is_cancel: apiData.isCancel || 0,
      is_finished_odds: isFinished
    };

    const fullData = {
      basic, odds,
      source: {
        api: 'getFixedBonusV1.qry',
        fetched_at: new Date().toISOString(),
        snapshot_time: getLatestTime(apiData.oddsHistory?.hadList),
        has_match_result: apiSaysFinished,
        spf_result: parsedResult?.spfResult || null,
        half_time_result: parsedResult?.halfTimeResult || null,
      }
    };
    fs.writeFileSync(path.join(ODDS_DIR, `${mid}.json`), JSON.stringify(fullData, null, 2), 'utf8');

    // 写入 odds_history/<mid>.json
    const histFile = path.join(HIST_DIR, `${mid}.json`);
    let hist = { mid, spf_history: [], rqspf_history: [], bf_history: [], zjq_history: [], bqc_history: [] };
    if (fs.existsSync(histFile)) {
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
    fs.writeFileSync(histFile, JSON.stringify(hist, null, 2), 'utf8');
    if (anyAppended) stats.appended += 1; else stats.unchanged += 1;

    // 更新 matches_status.json
    const statusEntry = statusDoc.matches.find(m => m.mid === mid);
    if (statusEntry) {
      statusEntry.spf = spf;
      statusEntry.handicap = odds.handicap;
      statusEntry.rqspf = odds.rqspf_latest;
      statusEntry.scraped_at = basic.scraped_at;
      statusEntry.sale_status = basic.sale_status;
      statusEntry.single_supported = single;
      if (apiSaysFinished && statusEntry.status !== 'finished') {
        statusEntry.status = 'finished';
      } else if (statusEntry.status !== 'finished') {
        statusEntry.status = basic.sale_status === '待开售' ? 'scheduled' : 'on_sale';
      }
      statusEntry.is_finished_odds = isFinished;
      if (parsedResult && parsedResult.homeScore !== null) {
        statusEntry.final_score = `${parsedResult.homeScore}:${parsedResult.awayScore}`;
      }
    }

    const spfStr = spf ? `${spf.home}/${spf.draw}/${spf.away}` : 'null';
    const histTag = anyAppended ? '✓' : '·';
    const finishedTag = isFinished ? '🏁' : '  ';
    console.log(`  ${histTag}${finishedTag} ${mid} (${list.code}): spf=${spfStr} h=${odds.handicap}${resultLog}`);
  }

  fs.writeFileSync(STATUS_PATH, JSON.stringify(statusDoc, null, 2), 'utf8');
  console.log(`\nUpdated matches_status.json`);
  console.log(`Done.  appended=${stats.appended}  unchanged=${stats.unchanged}  finished_odds=${stats.finished_odds}  scheduled=${stats.scheduled}  error=${stats.error}  result_written=${stats.result_written}  result_skipped=${stats.result_skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
