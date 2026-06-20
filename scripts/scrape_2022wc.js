#!/usr/bin/env node
/**
 * 抓 2022 卡塔尔世界杯 64 场比赛的赔率 + 开奖结果
 * 数据源：https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=<mid>
 *
 * 落盘（用 sporttery 新 ID 1016xxx 作主键）— 全部放在 data/2022wc/ 下，与 2026 数据隔离：
 *   data/2022wc/odds/<mid>.json         — 5 玩法最终赔率（与 2026 格式一致）
 *   data/2022wc/odds_history/<mid>.json  — 赔率历史快照
 *   data/2022wc/results/<mid>.json       — 完赛比分（最小集：比分 + 半场 + 进球者空 + 点球）
 *   data/2022wc/id_map.json              — 1016xxx ↔ 2022-A1~H6 等映射
 *   data/2022wc/status.json              — 64 场的 status 汇总（不污染 matches_status.json）
 *
 * 不动：
 *   data/odds/2022xxx.json 占位文件    — 一起搬到 data/2022wc/odds/ 下，但保持原文件名
 *   data/matches_status.json              — 那是 2026 世界杯用的，不混合
 *
 * 用法：node scripts/scrape_2022wc.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const WC2022_DIR = path.join(DATA_DIR, '2022wc');
const ODDS_DIR = path.join(WC2022_DIR, 'odds');
const HIST_DIR = path.join(WC2022_DIR, 'odds_history');
const RES_DIR = path.join(WC2022_DIR, 'results');

const API = 'https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry';
const REFERER = 'https://www.sporttery.cn/jc/zqdz/index.html';

// 64 场 mid（按赛事顺序：48 小组 + 8 R16 + 4 QF + 2 SF + 1 3rd + 1 final）
// label 用项目沿用的 2022-Xn 编号（与 data/odds/2022xxx.json 的 code 风格一致）
// kickoff 全部用 UTC+8 (中国时间)，与已有 data/odds/2022xxx.json 的 kickoff 字段一致
const MATCHES = [
  // ============ 小组赛 48 场 ============
  // A 组
  { mid: '1016184', label: '2022-A1',  home: '卡塔尔',     away: '厄瓜多尔',     kickoff: '2022-11-20 23:00', stage: 'group', group: 'A' },
  { mid: '1016186', label: '2022-A2',  home: '塞内加尔',   away: '荷兰',         kickoff: '2022-11-21 23:00', stage: 'group', group: 'A' },
  { mid: '1016201', label: '2022-A3',  home: '卡塔尔',     away: '塞内加尔',     kickoff: '2022-11-25 23:00', stage: 'group', group: 'A' },
  { mid: '1016202', label: '2022-A4',  home: '荷兰',       away: '厄瓜多尔',     kickoff: '2022-11-26 03:00', stage: 'group', group: 'A' },
  { mid: '1016216', label: '2022-A5',  home: '厄瓜多尔',   away: '塞内加尔',     kickoff: '2022-11-29 23:00', stage: 'group', group: 'A' },
  { mid: '1016217', label: '2022-A6',  home: '卡塔尔',     away: '荷兰',         kickoff: '2022-11-30 03:00', stage: 'group', group: 'A' },
  // B 组
  { mid: '1016185', label: '2022-B1',  home: '英格兰',     away: '伊朗',         kickoff: '2022-11-21 20:00', stage: 'group', group: 'B' },
  { mid: '1016187', label: '2022-B2',  home: '美国',       away: '威尔士',       kickoff: '2022-11-22 02:00', stage: 'group', group: 'B' },
  { mid: '1016200', label: '2022-B3',  home: '威尔士',     away: '伊朗',         kickoff: '2022-11-25 17:00', stage: 'group', group: 'B' },
  { mid: '1016203', label: '2022-B4',  home: '英格兰',     away: '美国',         kickoff: '2022-11-26 03:00', stage: 'group', group: 'B' },
  { mid: '1016218', label: '2022-B5',  home: '伊朗',       away: '美国',         kickoff: '2022-11-30 03:00', stage: 'group', group: 'B' },
  { mid: '1016219', label: '2022-B6',  home: '威尔士',     away: '英格兰',       kickoff: '2022-11-30 03:00', stage: 'group', group: 'B' },
  // C 组
  { mid: '1016188', label: '2022-C1',  home: '阿根廷',     away: '沙特阿拉伯',   kickoff: '2022-11-22 17:00', stage: 'group', group: 'C' },
  { mid: '1016190', label: '2022-C2',  home: '墨西哥',     away: '波兰',         kickoff: '2022-11-22 23:00', stage: 'group', group: 'C' },
  { mid: '1016205', label: '2022-C3',  home: '波兰',       away: '沙特阿拉伯',   kickoff: '2022-11-26 20:00', stage: 'group', group: 'C' },
  { mid: '1016207', label: '2022-C4',  home: '阿根廷',     away: '墨西哥',       kickoff: '2022-11-27 03:00', stage: 'group', group: 'C' },
  { mid: '1016222', label: '2022-C5',  home: '沙特阿拉伯', away: '墨西哥',       kickoff: '2022-11-30 23:00', stage: 'group', group: 'C' },
  { mid: '1016223', label: '2022-C6',  home: '波兰',       away: '阿根廷',       kickoff: '2022-12-01 03:00', stage: 'group', group: 'C' },
  // D 组
  { mid: '1016189', label: '2022-D1',  home: '丹麦',       away: '突尼斯',       kickoff: '2022-11-22 20:00', stage: 'group', group: 'D' },
  { mid: '1016191', label: '2022-D2',  home: '法国',       away: '澳大利亚',     kickoff: '2022-11-23 02:00', stage: 'group', group: 'D' },
  { mid: '1016204', label: '2022-D3',  home: '突尼斯',     away: '澳大利亚',     kickoff: '2022-11-26 17:00', stage: 'group', group: 'D' },
  { mid: '1016206', label: '2022-D4',  home: '法国',       away: '丹麦',         kickoff: '2022-11-27 00:00', stage: 'group', group: 'D' },
  { mid: '1016220', label: '2022-D5',  home: '突尼斯',     away: '法国',         kickoff: '2022-11-30 23:00', stage: 'group', group: 'D' },
  { mid: '1016221', label: '2022-D6',  home: '澳大利亚',   away: '丹麦',         kickoff: '2022-12-01 03:00', stage: 'group', group: 'D' },
  // E 组
  { mid: '1016193', label: '2022-E1',  home: '德国',       away: '日本',         kickoff: '2022-11-23 20:00', stage: 'group', group: 'E' },
  { mid: '1016194', label: '2022-E2',  home: '西班牙',     away: '哥斯达黎加',   kickoff: '2022-11-24 02:00', stage: 'group', group: 'E' },
  { mid: '1016208', label: '2022-E3',  home: '日本',       away: '哥斯达黎加',   kickoff: '2022-11-27 17:00', stage: 'group', group: 'E' },
  { mid: '1016211', label: '2022-E4',  home: '西班牙',     away: '德国',         kickoff: '2022-11-28 03:00', stage: 'group', group: 'E' },
  { mid: '1016226', label: '2022-E5',  home: '日本',       away: '西班牙',       kickoff: '2022-12-02 03:00', stage: 'group', group: 'E' },
  { mid: '1016227', label: '2022-E6',  home: '哥斯达黎加', away: '德国',         kickoff: '2022-12-02 03:00', stage: 'group', group: 'E' },
  // F 组
  { mid: '1016192', label: '2022-F1',  home: '摩洛哥',     away: '克罗地亚',     kickoff: '2022-11-23 17:00', stage: 'group', group: 'F' },
  { mid: '1016195', label: '2022-F2',  home: '比利时',     away: '加拿大',       kickoff: '2022-11-24 02:00', stage: 'group', group: 'F' },
  { mid: '1016209', label: '2022-F3',  home: '比利时',     away: '摩洛哥',       kickoff: '2022-11-27 20:00', stage: 'group', group: 'F' },
  { mid: '1016210', label: '2022-F4',  home: '克罗地亚',   away: '加拿大',       kickoff: '2022-11-28 00:00', stage: 'group', group: 'F' },
  { mid: '1016224', label: '2022-F5',  home: '加拿大',     away: '摩洛哥',       kickoff: '2022-12-01 23:00', stage: 'group', group: 'F' },
  { mid: '1016225', label: '2022-F6',  home: '克罗地亚',   away: '比利时',       kickoff: '2022-12-02 03:00', stage: 'group', group: 'F' },
  // G 组
  { mid: '1016196', label: '2022-G1',  home: '瑞士',       away: '喀麦隆',       kickoff: '2022-11-24 17:00', stage: 'group', group: 'G' },
  { mid: '1016199', label: '2022-G2',  home: '巴西',       away: '塞尔维亚',     kickoff: '2022-11-25 02:00', stage: 'group', group: 'G' },
  { mid: '1016212', label: '2022-G3',  home: '喀麦隆',     away: '塞尔维亚',     kickoff: '2022-11-28 17:00', stage: 'group', group: 'G' },
  { mid: '1016214', label: '2022-G4',  home: '巴西',       away: '瑞士',         kickoff: '2022-11-29 03:00', stage: 'group', group: 'G' },
  { mid: '1016230', label: '2022-G5',  home: '塞尔维亚',   away: '瑞士',         kickoff: '2022-12-03 03:00', stage: 'group', group: 'G' },
  { mid: '1016231', label: '2022-G6',  home: '喀麦隆',     away: '巴西',         kickoff: '2022-12-03 03:00', stage: 'group', group: 'G' },
  // H 组
  { mid: '1016197', label: '2022-H1',  home: '乌拉圭',     away: '韩国',         kickoff: '2022-11-24 20:00', stage: 'group', group: 'H' },
  { mid: '1016198', label: '2022-H2',  home: '葡萄牙',     away: '加纳',         kickoff: '2022-11-25 02:00', stage: 'group', group: 'H' },
  { mid: '1016213', label: '2022-H3',  home: '韩国',       away: '加纳',         kickoff: '2022-11-28 20:00', stage: 'group', group: 'H' },
  { mid: '1016215', label: '2022-H4',  home: '葡萄牙',     away: '乌拉圭',       kickoff: '2022-11-29 03:00', stage: 'group', group: 'H' },
  { mid: '1016228', label: '2022-H5',  home: '加纳',       away: '乌拉圭',       kickoff: '2022-12-02 23:00', stage: 'group', group: 'H' },
  { mid: '1016229', label: '2022-H6',  home: '韩国',       away: '葡萄牙',       kickoff: '2022-12-03 03:00', stage: 'group', group: 'H' },
  // ============ 1/8 决赛 8 场 ============
  { mid: '1016466', label: '2022-R16-1', home: '荷兰',      away: '美国',         kickoff: '2022-12-03 23:00', stage: 'r16' },
  { mid: '1016476', label: '2022-R16-2', home: '阿根廷',    away: '澳大利亚',     kickoff: '2022-12-04 03:00', stage: 'r16' },
  { mid: '1016467', label: '2022-R16-3', home: '英格兰',    away: '塞内加尔',     kickoff: '2022-12-04 23:00', stage: 'r16' },
  { mid: '1016477', label: '2022-R16-4', home: '法国',      away: '波兰',         kickoff: '2022-12-05 03:00', stage: 'r16' },
  { mid: '1016493', label: '2022-R16-5', home: '日本',      away: '克罗地亚',     kickoff: '2022-12-05 23:00', stage: 'r16' },
  { mid: '1016521', label: '2022-R16-6', home: '巴西',      away: '韩国',         kickoff: '2022-12-06 03:00', stage: 'r16' },
  { mid: '1016492', label: '2022-R16-7', home: '摩洛哥',    away: '西班牙',       kickoff: '2022-12-06 23:00', stage: 'r16' },
  { mid: '1016522', label: '2022-R16-8', home: '葡萄牙',    away: '瑞士',         kickoff: '2022-12-07 03:00', stage: 'r16' },
  // ============ 1/4 决赛 4 场 ============
  { mid: '1016536', label: '2022-QF-1',  home: '克罗地亚', away: '巴西',         kickoff: '2022-12-09 23:00', stage: 'qf' },
  { mid: '1016523', label: '2022-QF-2',  home: '荷兰',     away: '阿根廷',       kickoff: '2022-12-10 03:00', stage: 'qf' },
  { mid: '1016557', label: '2022-QF-3',  home: '摩洛哥',   away: '葡萄牙',       kickoff: '2022-12-10 23:00', stage: 'qf' },
  { mid: '1016532', label: '2022-QF-4',  home: '英格兰',   away: '法国',         kickoff: '2022-12-11 03:00', stage: 'qf' },
  // ============ 半决赛 2 场 ============
  { mid: '1016588', label: '2022-SF-1',  home: '阿根廷',   away: '克罗地亚',     kickoff: '2022-12-14 03:00', stage: 'sf' },
  { mid: '1016608', label: '2022-SF-2',  home: '法国',     away: '摩洛哥',       kickoff: '2022-12-15 03:00', stage: 'sf' },
  // ============ 三四名 ============
  { mid: '1016631', label: '2022-3RD',   home: '克罗地亚', away: '摩洛哥',       kickoff: '2022-12-17 23:00', stage: 'third' },
  // ============ 决赛 ============
  { mid: '1016632', label: '2022-FINAL', home: '阿根廷',   away: '法国',         kickoff: '2022-12-18 23:00', stage: 'final' },
];

// 点球大战的硬编码（API 不返回点球比分）
const PENALTY = {
  '1016492': { score: '3:0',   winner: 'MAR' }, // MAR vs ESP
  '1016493': { score: '1:3',   winner: 'CRO' }, // JPN vs CRO
  '1016632': { score: '4:2',   winner: 'ARG' }, // ARG vs FRA
};

// ============== 解析函数（与 scrape_fixed_bonus.js 保持一致） ==============
function parseCrs(crsList) {
  if (!crsList || !crsList.length) return null;
  const latest = crsList[crsList.length - 1];
  const bf = {};
  for (const [key, val] of Object.entries(latest)) {
    if (key.startsWith('s') && key !== 'updateDate' && !['updateTime', 'goalLine'].includes(key)) {
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
  return Object.keys(bf).length > 0 ? bf : null;
}

function parseTtgs(ttgList) {
  if (!ttgList || !ttgList.length) return null;
  const latest = ttgList[ttgList.length - 1];
  const zjq = {};
  for (let i = 0; i <= 7; i++) {
    const key = i === 7 ? 's7' : `s${i}`;
    if (latest[key] && parseFloat(latest[key]) > 0) {
      zjq[i === 7 ? '7+' : String(i)] = parseFloat(latest[key]);
    }
  }
  return Object.keys(zjq).length > 0 ? zjq : null;
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
  return Object.keys(bqc).length > 0 ? bqc : null;
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

// 从 matchResultList 提取 5 玩法的开奖结果
function parseLottery(matchResultList) {
  if (!matchResultList) return null;
  const out = {};
  for (const r of matchResultList) {
    out[r.code] = {
      combination: r.combination,
      combinationDesc: r.combinationDesc,
      odds: parseFloat(r.odds)
    };
  }
  return out;
}

// 解析全场比分（含加时，不含点球）从 sectionsNo999
function parseFinalScore(sectionsNo999) {
  if (!sectionsNo999) return null;
  const m = String(sectionsNo999).match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return { home: parseInt(m[1]), away: parseInt(m[2]) };
}

// ============== 网络拉取 ==============
async function fetchMatch(mid) {
  const url = `${API}?clientCode=3001&matchId=${mid}`;
  const res = await fetch(url, {
    headers: {
      'Referer': REFERER,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.startsWith('<')) throw new Error('WAF blocked');
  const json = JSON.parse(text);
  if (json.errorCode !== '0') throw new Error(`API: ${json.errorMessage}`);
  return json.value;
}

function getLatestTime(arr) {
  if (!arr || !arr.length) return null;
  const last = arr[arr.length - 1];
  if (!last) return null;
  return `${last.updateDate} ${last.updateTime}`;
}

// ============== 写文件 ==============
function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ============== 主流程 ==============
async function main() {
  const stats = { ok: 0, err: 0, skipped: 0 };
  const idMap = {};
  const statusList = [];

  for (const m of MATCHES) {
    process.stdout.write(`[${m.mid}] ${m.label} ${m.home} vs ${m.away} ... `);
    let value;
    try {
      value = await fetchMatch(m.mid);
    } catch (e) {
      console.log(`✗ ${e.message}`);
      stats.err += 1;
      continue;
    }

    const oh = value.oddsHistory;
    const lottery = parseLottery(value.matchResultList);
    const finalScore = parseFinalScore(value.sectionsNo999);

    // 5 玩法
    const spf = parseHad(oh.hadList);
    const hhad = parseHhad(oh.hhadList);
    const bf = parseCrs(oh.crsList);
    const zjqs = parseTtgs(oh.ttgList);
    const bqc = parseHafu(oh.hafuList);
    const single = parseSingleList(oh.singleList || value.singleList);

    const now = new Date().toISOString();
    const snapshot = getLatestTime(oh.hadList);

    // ---- 1) data/2022wc/odds/<mid>.json ----
    const oddsData = {
      basic: {
        mid: m.mid,
        code: m.label,
        league: '世界杯',
        home: oh.homeTeamAllName || m.home,
        away: oh.awayTeamAllName || m.away,
        kickoff: m.kickoff,
        url: `${REFERER}?showType=2&mid=${m.mid}`,
        scraped_at: now,
        sale_status: '已完赛',
        single_supported: single,
        is_cancel: value.isCancel || 0,
        is_finished_odds: true
      },
      odds: {
        spf_latest: spf,
        spf_history: oh.hadList || [],
        handicap: hhad ? hhad.handicap : null,
        rqspf_latest: hhad ? { home: hhad.home, draw: hhad.draw, away: hhad.away } : null,
        rqspf_history: oh.hhadList || [],
        bf_latest: bf,
        bf_history: oh.crsList || [],
        zjq_latest: zjqs,
        zjq_history: oh.ttgList || [],
        bqc_latest: bqc,
        bqc_history: oh.hafuList || []
      },
      lottery: lottery,
      source: {
        api: 'getFixedBonusV1.qry',
        fetched_at: now,
        snapshot_time: snapshot,
        full_time_score: value.sectionsNo999 || null
      }
    };
    writeJson(path.join(ODDS_DIR, `${m.mid}.json`), oddsData);

    // ---- 2) data/2022wc/odds_history/<mid>.json (精简版历史，结构同 2026) ----
    const hist = {
      mid: m.mid,
      spf_history: (oh.hadList || []).map(h => ({ time: `${h.updateDate} ${h.updateTime}`, home: parseFloat(h.h), draw: parseFloat(h.d), away: parseFloat(h.a) })),
      rqspf_history: (oh.hhadList || []).map(h => ({ time: `${h.updateDate} ${h.updateTime}`, handicap: parseInt(h.goalLine || 0), home: parseFloat(h.h), draw: parseFloat(h.d), away: parseFloat(h.a) })),
      bf_history: (oh.crsList || []).map(c => {
        const bfEntry = parseCrs([c]);
        return { time: `${c.updateDate} ${c.updateTime}`, odds: bfEntry || {} };
      }),
      zjq_history: (oh.ttgList || []).map(t => {
        const z = parseTtgs([t]);
        return { time: `${t.updateDate} ${t.updateTime}`, odds: z || {} };
      }),
      bqc_history: (oh.hafuList || []).map(h => {
        const b = parseHafu([h]);
        return { time: `${h.updateDate} ${h.updateTime}`, odds: b || {} };
      })
    };
    writeJson(path.join(HIST_DIR, `${m.mid}.json`), hist);

    // ---- 3) data/2022wc/results/<mid>.json ----
    const penalty = PENALTY[m.mid];
    const resultData = {
      matchId: m.mid,
      homeScore: finalScore ? finalScore.home : null,
      awayScore: finalScore ? finalScore.away : null,
      halfTime: null, // API 不返回半场比分
      scorers: [],    // API 不返回进球者名单
      wentToPenalties: !!penalty,
      penaltyScore: penalty ? penalty.score : null,
      penaltyWinner: penalty ? penalty.winner : null,
      lottery: lottery // 5 玩法赛果：HHAD / HAD / CRS / TTG / HAFU
    };
    writeJson(path.join(RES_DIR, `${m.mid}.json`), resultData);

    // ---- 4) id_map + status 收集 ----
    idMap[m.mid] = {
      label: m.label,
      stage: m.stage,
      group: m.group || null,
      home: oh.homeTeamAllName || m.home,
      away: oh.awayTeamAllName || m.away,
      kickoff: m.kickoff,
      full_time_score: value.sectionsNo999 || null,
      wentToPenalties: !!penalty,
      penaltyScore: penalty ? penalty.score : null
    };
    statusList.push({
      mid: m.mid,
      code: m.label,
      stage: m.stage,
      group: m.group || null,
      league: '世界杯',
      home: oh.homeTeamAllName || m.home,
      away: oh.awayTeamAllName || m.away,
      kickoff: m.kickoff,
      status: 'finished',
      spf,
      handicap: hhad ? hhad.handicap : null,
      rqspf: hhad ? { home: hhad.home, draw: hhad.draw, away: hhad.away } : null,
      scraped_at: now,
      sale_status: '已完赛',
      odds_file: `2022wc/odds/${m.mid}.json`,
      history_file: `2022wc/odds_history/${m.mid}.json`,
      final_score: value.sectionsNo999 || null,
      result_file: `2022wc/results/${m.mid}.json`,
      is_finished_odds: true,
      single_supported: single,
      lottery: lottery,
      wentToPenalties: !!penalty,
      penaltyScore: penalty ? penalty.score : null
    });

    const spfStr = spf ? `${spf.home}/${spf.draw}/${spf.away}` : 'null';
    console.log(`✓ spf=${spfStr} score=${value.sectionsNo999 || '-'}${penalty ? ' pen=' + penalty.score : ''}`);
    stats.ok += 1;
  }

  // ---- 5) 写 id_map + status ----
  writeJson(path.join(WC2022_DIR, 'id_map.json'), {
    generated_at: new Date().toISOString(),
    note: 'sporttery 新 ID (1016xxx) ↔ 项目沿用 label (2022-B4 / 2022-R16-2 / ...) 的映射。48 场小组赛 + 8 R16 + 4 QF + 2 SF + 1 3rd + 1 final = 64 场',
    source: 'sporttery.cn 2022 世界杯，5 玩法 getFixedBonusV1.qry API',
    total: Object.keys(idMap).length,
    by_stage: {
      group: Object.values(idMap).filter(x => x.stage === 'group').length,
      r16: Object.values(idMap).filter(x => x.stage === 'r16').length,
      qf: Object.values(idMap).filter(x => x.stage === 'qf').length,
      sf: Object.values(idMap).filter(x => x.stage === 'sf').length,
      third: Object.values(idMap).filter(x => x.stage === 'third').length,
      final: Object.values(idMap).filter(x => x.stage === 'final').length
    },
    matches: idMap
  });

  writeJson(path.join(WC2022_DIR, 'status.json'), {
    generated_at: new Date().toISOString(),
    total: statusList.length,
    note: '2022 世界杯 64 场状态汇总。区别于 matches_status.json（那是 2026 世界杯）',
    status_definitions: {
      finished: '已完赛'
    },
    matches: statusList
  });

  console.log(`\n=== 写盘完成 ===`);
  console.log(`data/2022wc/odds/:        ${stats.ok} 个文件`);
  console.log(`data/2022wc/odds_history/: ${stats.ok} 个文件`);
  console.log(`data/2022wc/results/:     ${stats.ok} 个文件`);
  console.log(`id_map + status: 2 个汇总文件（在 data/2022wc/）`);
  console.log(`errors: ${stats.err}, skipped: ${stats.skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
