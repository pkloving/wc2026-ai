// 临时脚本：补齐已完赛场次 odds_history 的 bf_history / zjq_history / bqc_history
// 用法：node scripts/patch_backfill_bf_zjq_bqc.js
// - 读取 matches_status.json，找出所有有 is_finished_odds=true 的 mid
// - 调用 sporttery getFixedBonusV1 API 拿最新 CRS/TTG/HAFU
// - 以 {time: 该次抓取的 snapshot_time} 作为该历史条目的唯一快照时间（=该场赛前定格赔率时刻）
// - 仅补全 bf_history / zjq_history / bqc_history（如已有相同值则不重复追加）
// - 不碰 spf_history / rqspf_history

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATUS_PATH = path.join(DATA_DIR, 'matches_status.json');
const HIST_DIR = path.join(DATA_DIR, 'odds_history');

const API = 'https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry';

// -------- 解析函数（与 scrape_fixed_bonus.js 保持一致） --------
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

function dictEqual(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

function latestUpdateTime(arr) {
  if (!arr || !arr.length) return null;
  const last = arr[arr.length - 1];
  if (!last) return null;
  const d = last.updateDate;
  const t = last.updateTime;
  if (d && t) return `${d} ${t}`;
  return null;
}

async function fetchMatch(mid) {
  const url = `${API}?clientCode=3001&matchId=${mid}`;
  try {
    const res = await fetch(url, {
      headers: {
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

// -------- 主流程 --------
async function main() {
  const statusDoc = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));

  // 1) 目标：is_finished_odds === true 的 mid
  //    额外：sale_status='待开售' 说明官方根本没有赔率数据，跳过
  const targets = statusDoc.matches
    .filter(m => m.is_finished_odds === true && m.sale_status !== '待开售')
    .map(m => m.mid);

  console.log(`共 ${targets.length} 个已完赛场次需要补 bf_history / zjq_history / bqc_history`);

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const mid of targets) {
    const histFile = path.join(HIST_DIR, `${mid}.json`);
    if (!fs.existsSync(histFile)) {
      console.warn(`  [skip] ${mid}: 没有 odds_history 文件`);
      skip++;
      continue;
    }
    const hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
    if (!hist.mid) hist.mid = mid;
    hist.bf_history = hist.bf_history || [];
    hist.zjq_history = hist.zjq_history || [];
    hist.bqc_history = hist.bqc_history || [];

    // 如果已有完整历史数据（比如 bf_history 长度 > 0 且最近条目 odds 非空），仍然会跑一遍确认；
    // 但如果 API 无法返回新值（sale_status=待开售），我们直接跳过
    const apiData = await fetchMatch(mid);
    if (apiData.error) {
      console.error(`  [fail] ${mid}: ${apiData.error}`);
      fail++;
      continue;
    }

    const bf = parseCrs(apiData.oddsHistory?.crsList);
    const zjq = parseTtgs(apiData.oddsHistory?.ttgList);
    const bqc = parseHafu(apiData.oddsHistory?.hafuList);

    // 用 API 第一条 crsList/ttgList/hafuList 的 update 时间作为"定格快照时刻"
    const snapTime =
      latestUpdateTime(apiData.oddsHistory?.crsList) ||
      latestUpdateTime(apiData.oddsHistory?.ttgList) ||
      latestUpdateTime(apiData.oddsHistory?.hafuList) ||
      new Date().toISOString();

    let appended = 0;

    if (bf) {
      // 如果 bf_history 里最近一条 odds 与当前 bf 完全一致 → 不再追加
      const last = hist.bf_history[hist.bf_history.length - 1];
      if (!last || !dictEqual(last.odds, bf)) {
        // 为了不污染，若历史里已经有一条与该 snapTime 相同的条目（赔率可能有变动），也覆盖最后一条
        hist.bf_history.push({ time: snapTime, odds: bf });
        appended++;
      }
    }
    if (zjq) {
      const last = hist.zjq_history[hist.zjq_history.length - 1];
      if (!last || !dictEqual(last.odds, zjq)) {
        hist.zjq_history.push({ time: snapTime, odds: zjq });
        appended++;
      }
    }
    if (bqc) {
      const last = hist.bqc_history[hist.bqc_history.length - 1];
      if (!last || !dictEqual(last.odds, bqc)) {
        hist.bqc_history.push({ time: snapTime, odds: bqc });
        appended++;
      }
    }

    if (appended > 0) {
      fs.writeFileSync(histFile, JSON.stringify(hist, null, 2), 'utf8');
      console.log(`  [ok] ${mid}: 追加 ${appended} 条 bf/zjq/bqc 历史条目（snapshot=${snapTime}）`);
      ok++;
    } else {
      console.log(`  [skip] ${mid}: API 无新赔率 或 值完全一致`);
      skip++;
    }

    // 轻微限速，避免请求过快
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n完成：ok=${ok}  skip=${skip}  fail=${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
