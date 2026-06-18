// scripts/scrape_fixed_bonus.js
// 批量抓 6-12~6-17 小组赛的 5 玩法全量（spf/rqspf/bf/zjqs/bqc）+ 单关许可
// 数据源：https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=<mid>
//
// 使用：node scripts/scrape_fixed_bonus.js
// 输出：data/odds/<mid>.json + 追加到 data/odds_history/<mid>.json
// 状态：更新 data/matches_status.json 的 status 字段
//
// 完赛赔率标注（R-014）：
//   - odds/<mid>.json 的 basic.is_finished_odds：true=完赛定格，false=未完赛会继续抓
//   - matches_status.json 同步 is_finished_odds 字段
//   - 启动时凡 is_finished_odds=true 永久跳过（不再入抓取列表）

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

// MATCHES / MAIN_LIST 改从 matches_status.json 动态生成
//   - MATCHES = 所有 mid（已完赛 + 未开赛，赛前的"定格赔率"也要拉一次最新）
//   - MAIN_LIST[mid] = { code, home, away, kickoff, handicap, spf, rqspf, status, league }
//   - 注意：MATCHES 取自 matches_status 已是 schema A 的中心索引

// 5 玩法 code 映射
const PLAY_CODE_TO_NAME = {
  HAD: 'spf',
  HHAD: 'rqspf',
  CRS: 'bf',
  TTG: 'zjqs',
  HAFU: 'bqc'
};

// 解析 CRS（比分）数据
function parseCrs(crsList) {
  if (!crsList || !crsList.length) return null;
  const latest = crsList[crsList.length - 1];
  const bf = {};
  for (const [key, val] of Object.entries(latest)) {
    if (key.startsWith('s') && key !== 'updateDate' && key !== 'updateTime' && key !== 'goalLine') {
      // 解析 s01s00 / s-1sh / s-1sd / s-1sa
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

// 比较两组赔率 {home, draw, away} 是否一致（用于去重 history 快照）
function sameOdds(a, b) {
  if (!a || !b) return false;
  return a.home === b.home && a.draw === b.draw && a.away === b.away;
}

// 比较两个完整赔率 dict 是否一致（bf/zjq/bqc 去重用）
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

// 向 history 数组写入一条快照。策略：
//   - 永远保留 first_ever 快照（arr[0]），用作基准对比
//   - 后续最新值如果跟 first_ever 不同 → 放在 arr[1]（覆盖式）
//   - 后续跟最新值相同 → 跳过
//   - 跟 first_ever 相同（后续赔率完全回到初始值） → 只保留 first，arr.length 变回 1
//   所以 arr 的可能长度：1（一直没变过）、2（有变化，latest 跟 first 不同）
function pushOrKeepLatest(arr, entry, compareFn) {
  if (arr.length === 0) { arr.push(entry); return true; }
  if (arr.length === 1) {
    if (compareFn(arr[0], entry)) return false; // 跟 first 一样 → 不存
    arr.push(entry); return true;
  }
  // 长度 >=2：arr[0] 永远是 first；arr[1] 一直覆盖
  // 如果 entry == first → 回到初始赔率，删 arr[1]
  if (compareFn(arr[0], entry)) { arr.splice(1); return true; }
  // 如果 entry == 当前 latest（arr[arr.length-1]） → 无变化
  const last = arr[arr.length - 1];
  if (compareFn(last, entry)) return false;
  // 否则覆盖掉 arr[1..-1] 的所有中间值，仅保留 [first, entry]
  arr.length = 1;
  arr.push(entry);
  return true;
}

// 取 history 数组最后一个快照
function lastOf(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[arr.length - 1];
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

function getLatestTime(arr) {
  if (!arr || !arr.length) return null;
  const last = arr[arr.length - 1];
  if (!last) return null;
  return `${last.updateDate} ${last.updateTime}`;
}

async function main() {
  // 从 matches_status.json 动态生成 MATCHES + MAIN_LIST
  const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  const MATCHES = statusDoc.matches.map(m => m.mid);
  const MAIN_LIST = {};
  for (const m of statusDoc.matches) {
    MAIN_LIST[m.mid] = {
      code: m.code,
      home: m.home,
      away: m.away,
      kickoff: m.kickoff,
      league: m.league,
      status: m.status,
      handicap: m.handicap,
      spf: m.spf ? { h: m.spf.home, d: m.spf.draw, a: m.spf.away } : null,
      rqspf: m.rqspf ? { h: m.rqspf.home, d: m.rqspf.draw, a: m.rqspf.away } : null
    };
  }
  // mid → status 查表
  const statusByMid = new Map(statusDoc.matches.map((m) => [m.mid, m]));

  console.log(`Scraping ${MATCHES.length} matches...`);

  // R-014 抓取策略（修正版 v2）：
  //   - 启动时扫 odds/<mid>.json：已标 is_finished_odds=true 的 mid **跳过**（避免重复拉定格赔率）
  //   - 其它 mid 全部拉一次最新赔率（已完赛未标 is_finished_odds 的也要拉 → 标完后下次跳过）
  //   - 拉完后根据 status 决定 is_finished_odds：已完赛 → true（下次跳过），未完赛 → false
  //   - 这样每个 mid 最多抓 2 次：完赛前 last update + 完赛后定格
  const finishedOddsMids = new Set();
  for (const mid of MATCHES) {
    const oddsFile = path.join(ODDS_DIR, `${mid}.json`);
    if (fs.existsSync(oddsFile)) {
      try {
        const od = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
        if (od && od.basic && od.basic.is_finished_odds === true) {
          finishedOddsMids.add(mid);
        }
      } catch (e) {
        // 损坏文件忽略，继续
      }
    }
  }
  if (finishedOddsMids.size > 0) {
    console.log(`R-014 跳过已完赛赔率: ${finishedOddsMids.size} 场（已标 is_finished_odds=true）`);
  }

  const stats = { appended: 0, unchanged: 0, scheduled: 0, error: 0, finished_odds: 0 };

  for (const mid of MATCHES) {
    // R-014 兜底：is_finished_odds=true 的 mid 跳过
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
    const isFinished = st && st.status === 'finished';

    const apiData = await fetchMatch(mid);
    if (apiData.error) {
      console.error(`  ${mid} (${list.code}): ${apiData.error}`);
      stats.error += 1;
      continue;
    }

    // 解析
    const spf = parseHad(apiData.oddsHistory?.hadList);
    const hhad = parseHhad(apiData.oddsHistory?.hhadList);
    const bf = parseCrs(apiData.oddsHistory?.crsList);
    const zjqs = parseTtgs(apiData.oddsHistory?.ttgList);
    const bqc = parseHafu(apiData.oddsHistory?.hafuList);
    const single = parseSingleList(apiData.oddsHistory?.singleList || apiData.singleList);

    // 5 玩法合并到 odds
    const odds = {
      spf_latest: spf,
      spf_history: [],
      handicap: hhad ? hhad.handicap : null,
      rqspf_latest: hhad ? { home: hhad.home, draw: hhad.draw, away: hhad.away } : null,
      rqspf_history: [],
      bf_latest: bf,
      zjq_latest: zjqs,
      bqc_latest: bqc
    };

    // 写入 odds/<mid>.json
    const basic = {
      mid,
      code: list.code,
      league: list.league || '世界杯',
      home: list.home,
      away: list.away,
      kickoff: list.kickoff,
      url: `${REFERER}?showType=2&mid=${mid}`,
      scraped_at: new Date().toISOString(),
      sale_status: !spf && !odds.rqspf_latest ? '待开售' : '在售',
      single_supported: single,
      is_cancel: apiData.value?.isCancel || 0,
      // R-014：已完赛场次标 is_finished_odds=true（定格赔率），未完赛标 false
      is_finished_odds: !!isFinished
    };

    const fullData = {
      basic,
      odds,
      source: {
        api: 'getFixedBonusV1.qry',
        fetched_at: new Date().toISOString(),
        snapshot_time: getLatestTime(apiData.oddsHistory?.hadList)
      }
    };
    fs.writeFileSync(
      path.join(ODDS_DIR, `${mid}.json`),
      JSON.stringify(fullData, null, 2),
      'utf8'
    );

    // 写入 odds_history/<mid>.json
    // 规则：① 保留第一次抓到的赔率（永远不删） ② 同场赔率未变则不追加 ③ 后续未完赛会再抓
    //      ④ bf/zjq/bqc 扩展：同样按上述规则写 bf_history/zjq_history/bqc_history
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
      } catch (e) {
        // 旧文件损坏：重新从零初始化
      }
    }
    const now = new Date().toISOString();
    let anyAppended = false;
    // spf（赔率 {home, draw, away}）
    if (spf) {
      const entry = { time: now, ...spf };
      if (pushOrKeepLatest(hist.spf_history, entry, (a, b) => sameOdds(a, b))) anyAppended = true;
    }
    // rqspf（让球胜平负）
    if (odds.rqspf_latest) {
      const entry = { time: now, ...odds.rqspf_latest };
      if (pushOrKeepLatest(hist.rqspf_history, entry, (a, b) => sameOdds(a, b))) anyAppended = true;
    }
    // bf (比分，完整 odds dict)
    if (bf && Object.keys(bf).length > 0) {
      const entry = { time: now, odds: bf };
      if (pushOrKeepLatest(hist.bf_history, entry, (a, b) => sameDict(a.odds, b.odds))) anyAppended = true;
    }
    // zjq (总进球)
    if (zjqs && Object.keys(zjqs).length > 0) {
      const entry = { time: now, odds: zjqs };
      if (pushOrKeepLatest(hist.zjq_history, entry, (a, b) => sameDict(a.odds, b.odds))) anyAppended = true;
    }
    // bqc (半全场)
    if (bqc && Object.keys(bqc).length > 0) {
      const entry = { time: now, odds: bqc };
      if (pushOrKeepLatest(hist.bqc_history, entry, (a, b) => sameDict(a.odds, b.odds))) anyAppended = true;
    }
    fs.writeFileSync(histFile, JSON.stringify(hist, null, 2), 'utf8');
    if (anyAppended) stats.appended += 1;
    else stats.unchanged += 1;

    // 更新 status
    const statusEntry = statusDoc.matches.find(m => m.mid === mid);
    if (statusEntry) {
      statusEntry.spf = spf;
      statusEntry.handicap = odds.handicap;
      statusEntry.rqspf = odds.rqspf_latest;
      statusEntry.scraped_at = basic.scraped_at;
      statusEntry.sale_status = basic.sale_status;
      statusEntry.single_supported = single;
      // 已完赛场次保持 finished（不要被覆盖为 on_sale）
      // 未完赛才按 sale_status 推算 on_sale / scheduled
      if (statusEntry.status !== 'finished') {
        statusEntry.status = basic.sale_status === '待开售' ? 'scheduled' : 'on_sale';
      }
      // R-014：同步 is_finished_odds 标记（已完赛 → true，未完赛 → false）
      statusEntry.is_finished_odds = !!isFinished;
    }

    const spfStr = spf ? `${spf.home}/${spf.draw}/${spf.away}` : 'null';
    const rqspfStr = odds.rqspf_latest ? `${odds.rqspf_latest.home}/${odds.rqspf_latest.draw}/${odds.rqspf_latest.away}` : 'null';
    const singleStr = Object.entries(single).filter(([k, v]) => v).map(([k]) => k).join(',') || 'none';
    const histTag = anyAppended ? '✓' : '·';
    const finishedTag = isFinished ? '🏁' : '  ';
    console.log(`  ${histTag}${finishedTag} ${mid} (${list.code}): spf=${spfStr} rqspf=${rqspfStr} h=${odds.handicap} single=[${singleStr}]`);
  }

  // 写回 status
  fs.writeFileSync(STATUS_PATH, JSON.stringify(statusDoc, null, 2), 'utf8');
  console.log(`\nUpdated matches_status.json`);
  console.log(`Done.  appended=${stats.appended}  unchanged=${stats.unchanged}  finished_odds=${stats.finished_odds}  scheduled=${stats.scheduled}  error=${stats.error}`);
}

main().catch(e => { console.error(e); process.exit(1); });
