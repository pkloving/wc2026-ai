// scripts/scrape_fixed_bonus.js
// 批量抓 6-12~6-17 小组赛的 5 玩法全量（spf/rqspf/bf/zjqs/bqc）+ 单关许可
// 数据源：https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=<mid>
//
// 使用：node scripts/scrape_fixed_bonus.js
// 输出：data/odds/<mid>.json + 追加到 data/odds_history/<mid>.json
// 状态：更新 data/matches_status.json 的 status 字段

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

// 14 场未抓的小组赛（2040168-2040181）
const MATCHES = [
  '2040168', // 周六007 海地 vs 苏格兰 6-14 09:00
  '2040169', // 周六008 澳大利亚 vs 土耳其 6-14 12:00
  '2040170', // 周日009 德国 vs 库拉索 6-15 01:00
  '2040171', // 周日010 荷兰 vs 日本 6-15 04:00
  '2040172', // 周日011 科特迪瓦 vs 厄瓜多尔 6-15 07:00
  '2040173', // 周日012 瑞典 vs 突尼斯 6-15 10:00
  '2040174', // 周一013 西班牙 vs 佛得角 6-16 00:00
  '2040175', // 周一014 比利时 vs 埃及 6-16 03:00
  '2040176', // 周一015 沙特 vs 乌拉圭 6-16 06:00
  '2040177', // 周一016 伊朗 vs 新西兰 6-16 09:00
  '2040178', // 周二017 法国 vs 塞内加尔 6-17 03:00
  '2040179', // 周二018 伊拉克 vs 挪威 6-17 06:00
  '2040180', // 周二019 阿根廷 vs 阿尔及利 6-17 09:00
  '2040181', // 周二020 奥地利 vs 约旦 6-17 12:00
];

// 主列表里已有的 basic 信息（避免重复抓 getMatchHeadV1）
const MAIN_LIST = {
  '2040168': { code: '周六007', home: '海地', away: '苏格兰', kickoff: '2026-06-14 09:00', handicap: 1, spf: { h: 7.65, d: 4.25, a: 1.31 }, rqspf: { h: 2.81, d: 3.35, a: 2.11 } },
  '2040169': { code: '周六008', home: '澳大利亚', away: '土耳其', kickoff: '2026-06-14 12:00', handicap: 1, spf: { h: 5.15, d: 3.45, a: 1.55 }, rqspf: { h: 2.11, d: 3.25, a: 2.88 } },
  '2040170': { code: '周日009', home: '德国', away: '库拉索', kickoff: '2026-06-15 01:00', handicap: -3, spf: null, rqspf: { h: 1.94, d: 4.60, a: 2.52 } },
  '2040171': { code: '周日010', home: '荷兰', away: '日本', kickoff: '2026-06-15 04:00', handicap: -1, spf: { h: 1.72, d: 3.30, a: 4.10 }, rqspf: { h: 3.42, d: 3.42, a: 1.84 } },
  '2040172': { code: '周日011', home: '科特迪瓦', away: '厄瓜多尔', kickoff: '2026-06-15 07:00', handicap: 1, spf: { h: 3.36, d: 2.65, a: 2.20 }, rqspf: { h: 1.51, d: 3.60, a: 5.30 } },
  '2040173': { code: '周日012', home: '瑞典', away: '突尼斯', kickoff: '2026-06-15 10:00', handicap: -1, spf: { h: 1.74, d: 3.10, a: 4.30 }, rqspf: { h: 3.55, d: 3.30, a: 1.84 } },
  '2040174': { code: '周一013', home: '西班牙', away: '佛得角', kickoff: '2026-06-16 00:00', handicap: -2, spf: null, rqspf: { h: 1.85, d: 4.00, a: 2.95 } },
  '2040175': { code: '周一014', home: '比利时', away: '埃及', kickoff: '2026-06-16 03:00', handicap: -1, spf: { h: 1.46, d: 3.65, a: 5.85 }, rqspf: { h: 2.65, d: 3.15, a: 2.30 } },
  '2040176': { code: '周一015', home: '沙特', away: '乌拉圭', kickoff: '2026-06-16 06:00', handicap: 1, spf: { h: 8.45, d: 4.35, a: 1.28 }, rqspf: { h: 2.95, d: 3.30, a: 2.05 } },
  '2040177': { code: '周一016', home: '伊朗', away: '新西兰', kickoff: '2026-06-16 09:00', handicap: -1, spf: { h: 1.56, d: 3.30, a: 5.40 }, rqspf: { h: 3.10, d: 3.10, a: 2.07 } },
  '2040178': { code: '周二017', home: '法国', away: '塞内加尔', kickoff: '2026-06-17 03:00', handicap: -1, spf: { h: 1.38, d: 3.90, a: 6.75 }, rqspf: { h: 2.35, d: 3.20, a: 2.56 } },
  '2040179': { code: '周二018', home: '伊拉克', away: '挪威', kickoff: '2026-06-17 06:00', handicap: 2, spf: null, rqspf: { h: 2.03, d: 3.89, a: 2.64 } },
  '2040180': { code: '周二019', home: '阿根廷', away: '阿尔及利', kickoff: '2026-06-17 09:00', handicap: -1, spf: { h: 1.28, d: 4.25, a: 8.90 }, rqspf: { h: 2.07, d: 3.25, a: 2.95 } },
  '2040181': { code: '周二020', home: '奥地利', away: '约旦', kickoff: '2026-06-17 12:00', handicap: -1, spf: { h: 1.23, d: 4.90, a: 8.90 }, rqspf: { h: 1.86, d: 3.45, a: 3.32 } }
};

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
  console.log(`Scraping ${MATCHES.length} matches...`);
  const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  // mid → 完赛状态 查表（用于跳过已完赛）
  const statusByMid = new Map(statusDoc.matches.map((m) => [m.mid, m]));

  // 统计：appended / skipped(unchanged) / skipped(finished) / no_data
  const stats = { appended: 0, unchanged: 0, finished: 0, nodata: 0, error: 0 };

  for (const mid of MATCHES) {
    const list = MAIN_LIST[mid];
    if (!list) {
      console.warn(`  No main list data for ${mid}, skipping`);
      stats.nodata += 1;
      continue;
    }
    // 跳过已完赛：避免浪费 API，且不需要再为"赔率变动"积累
    const st = statusByMid.get(mid);
    if (st && st.status === 'finished') {
      console.log(`  ${mid} (${list.code}): 跳过（已完赛 ${st.final_score || ''}）`);
      stats.finished += 1;
      continue;
    }
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
      league: '世界杯',
      home: list.home,
      away: list.away,
      kickoff: list.kickoff,
      url: `${REFERER}?showType=2&mid=${mid}`,
      scraped_at: new Date().toISOString(),
      sale_status: !spf && !odds.rqspf_latest ? '待开售' : '在售',
      single_supported: single,
      is_cancel: apiData.value?.isCancel || 0
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
    const histFile = path.join(HIST_DIR, `${mid}.json`);
    let hist = { mid, spf_history: [], rqspf_history: [] };
    if (fs.existsSync(histFile)) {
      hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
      // 兜底：旧文件可能没有空数组
      hist.spf_history = Array.isArray(hist.spf_history) ? hist.spf_history : [];
      hist.rqspf_history = Array.isArray(hist.rqspf_history) ? hist.rqspf_history : [];
    }
    const now = new Date().toISOString();
    let spfAppended = false, rqAppended = false;
    if (spf) {
      const prev = lastOf(hist.spf_history);
      // 首次 OR 与上次赔率不一致 → 追加
      if (!prev || !sameOdds(prev, spf)) {
        hist.spf_history.push({ time: now, ...spf });
        spfAppended = true;
      }
    }
    if (odds.rqspf_latest) {
      const prev = lastOf(hist.rqspf_history);
      if (!prev || !sameOdds(prev, odds.rqspf_latest)) {
        hist.rqspf_history.push({ time: now, ...odds.rqspf_latest });
        rqAppended = true;
      }
    }
    fs.writeFileSync(histFile, JSON.stringify(hist, null, 2), 'utf8');
    if (spfAppended || rqAppended) stats.appended += 1;
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
      statusEntry.status = basic.sale_status === '待开售' ? 'scheduled' : 'on_sale';
    }

    const spfStr = spf ? `${spf.home}/${spf.draw}/${spf.away}` : 'null';
    const rqspfStr = odds.rqspf_latest ? `${odds.rqspf_latest.home}/${odds.rqspf_latest.draw}/${odds.rqspf_latest.away}` : 'null';
    const singleStr = Object.entries(single).filter(([k, v]) => v).map(([k]) => k).join(',') || 'none';
    const histTag = spfAppended || rqAppended ? '✓' : '·';
    console.log(`  ${histTag} ${mid} (${list.code}): spf=${spfStr} rqspf=${rqspfStr} h=${odds.handicap} single=[${singleStr}]`);
  }

  // 写回 status
  fs.writeFileSync(STATUS_PATH, JSON.stringify(statusDoc, null, 2), 'utf8');
  console.log(`\nUpdated matches_status.json`);
  console.log(`Done.  appended=${stats.appended}  unchanged=${stats.unchanged}  finished=${stats.finished}  error=${stats.error}  no_data=${stats.nodata}`);
}

main().catch(e => { console.error(e); process.exit(1); });
