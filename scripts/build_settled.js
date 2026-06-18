#!/usr/bin/env node
/**
 * build_settled.js — 增量更新已完赛比赛的汇总表
 *
 * 数据源：
 *   data/odds/<mid>.json          — 最新赔率（spf/rqspf/bf/zjq/bqc 的 _latest）
 *   data/odds_history/<mid>.json  — 时间序列（initial = history[0], last = history[len-1]）
 *   data/results/<mid>.json       — 完赛结果
 *
 * 输出：
 *   data/settled_matches.json — 一行一场，含 5 玩法 initial/last/result
 *
 * 用法：
 *   node scripts/build_settled.js            # 全量重建（已存在的会被覆盖）
 *   node scripts/build_settled.js --incremental  # 增量：只更新有结果但未在表里的 mid
 *
 * 设计要点：
 *   - 增量更新是 modeling 回测/拟合脚本的第一步（31_tight_anti_value.js / 33_fit_strategy.js 启动时 spawn）
 *   - 每场含 5 玩法（spf/rqspf/bf/zjq/bqc）initial/last，便于找赔率变化规律
 *   - 比分「其它」档位判定（2026-06-18 用户提醒）：
 *       胜其它 = 主队赢且主队进球 >= 6
 *       负其它 = 客队赢且客队进球 >= 6
 *       平其它 = 平局且总进球 >= 5
 *   - bqc 结果键 = "半场主客/全场主客"，如 '胜胜' '平负'
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const ODDS_DIR = path.join(PROJECT_ROOT, 'data', 'odds');
const HISTORY_DIR = path.join(PROJECT_ROOT, 'data', 'odds_history');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results');
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'data', 'settled_matches.json');

const INCREMENTAL = process.argv.includes('--incremental');

// ============== 工具 ==============
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

// 把 odds_history 的 spf/rqspf entry（平铺）转成 {home,draw,away}
function pick3Way(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return {
    time: history[history.length - 1].time,
    home: history[history.length - 1].home,
    draw: history[history.length - 1].draw,
    away: history[history.length - 1].away,
  };
}
function pick3WayFirst(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return {
    time: history[0].time,
    home: history[0].home,
    draw: history[0].draw,
    away: history[0].away,
  };
}
// 把 odds_history 的 bf/zjq/bqc entry（嵌套 odds）转成同一形式
function pickNested(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return { time: history[history.length - 1].time, odds: history[history.length - 1].odds };
}
function pickNestedFirst(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return { time: history[0].time, odds: history[0].odds };
}

// ============== 结算判定 ==============
// spf / rqspf（让球后）
function settleSpf(home, away) {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}
function settleRqspf(home, away, handicap) {
  // handicap 是让球数（主队让客队）。h + handicap - away 看结果
  // handicap 负数 = 主队让球（如 -1 意为客队 +1）
  // 主队让 -N → 等价于比较 home + |handicap| 与 away
  // 简化为：主队视角 = home + handicap - away
  const adjusted = home - away + handicap;
  if (adjusted > 0) return 'home';
  if (adjusted < 0) return 'away';
  return 'draw';
}
// 比分（含「其它」判定）
function settleBf(home, away) {
  const total = home + away;
  // 「其它」优先级最高（与 sporttery 规则一致：先比主客胜，再看是否落入其它）
  if (home > away && home >= 6) return { score: `${home}:${away}`, other: '胜其它' };
  if (away > home && away >= 6) return { score: `${home}:${away}`, other: '负其它' };
  if (home === away && total >= 5) return { score: `${home}:${away}`, other: '平其它' };
  return { score: `${home}:${away}`, other: null };
}
function settleZjq(home, away) {
  const t = home + away;
  return t >= 7 ? '7+' : String(t);
}
function settleBqc(halfHome, halfAway, home, away) {
  // 半场主客 / 全场主客
  const half = halfHome > halfAway ? '胜' : halfHome < halfAway ? '负' : '平';
  const full = home > away ? '胜' : home < away ? '负' : '平';
  return half + full;
}

// ============== 主流程 ==============
function buildOne(mid) {
  const oddsPath = path.join(ODDS_DIR, `${mid}.json`);
  const historyPath = path.join(HISTORY_DIR, `${mid}.json`);
  const resultPath = path.join(RESULTS_DIR, `${mid}.json`);

  if (!fs.existsSync(oddsPath)) return null;
  const odds = readJson(oddsPath);
  const b = odds.basic;
  const o = odds.odds;

  // 优先从 history 取 initial（更早期），缺则用 _latest
  let hist = null;
  if (fs.existsSync(historyPath)) hist = readJson(historyPath);

  const spfHist = hist?.spf_history || [];
  const rqspfHist = hist?.rqspf_history || [];
  const bfHist = hist?.bf_history || [];
  const zjqHist = hist?.zjq_history || [];
  const bqcHist = hist?.bqc_history || [];

  // initial
  const spfInit = pick3WayFirst(spfHist) || (o.spf_latest ? { time: null, ...o.spf_latest } : null);
  const rqspfInit = pick3WayFirst(rqspfHist) || (o.rqspf_latest ? { time: null, ...o.rqspf_latest } : null);
  const bfInit = pickNestedFirst(bfHist) || (o.bf_latest ? { time: null, odds: o.bf_latest } : null);
  const zjqInit = pickNestedFirst(zjqHist) || (o.zjq_latest ? { time: null, odds: o.zjq_latest } : null);
  const bqcInit = pickNestedFirst(bqcHist) || (o.bqc_latest ? { time: null, odds: o.bqc_latest } : null);

  // last
  const spfLast = pick3Way(spfHist) || (o.spf_latest ? { time: null, ...o.spf_latest } : null);
  const rqspfLast = pick3Way(rqspfHist) || (o.rqspf_latest ? { time: null, ...o.rqspf_latest } : null);
  const bfLast = pickNested(bfHist) || (o.bf_latest ? { time: null, odds: o.bf_latest } : null);
  const zjqLast = pickNested(zjqHist) || (o.zjq_latest ? { time: null, odds: o.zjq_latest } : null);
  const bqcLast = pickNested(bqcHist) || (o.bqc_latest ? { time: null, odds: o.bqc_latest } : null);

  // 完赛结果
  let result = null;
  if (fs.existsSync(resultPath)) {
    const r = readJson(resultPath);
    result = {
      home: r.homeScore,
      away: r.awayScore,
      half: r.halfTime,
      scorers_count: (r.scorers || []).length,
      went_to_penalties: r.wentToPenalties,
      penalty_score: r.penaltyScore,
    };
  }

  // 结算
  let spfResult = null, rqspfResult = null, bfResult = null, zjqResult = null, bqcResult = null;
  if (result) {
    const { home, away, half } = result;
    const handicap = b.handicap ?? o.handicap ?? null;
    if (spfLast) spfResult = settleSpf(home, away);
    if (rqspfLast) rqspfResult = settleRqspf(home, away, handicap);
    if (bfLast) bfResult = settleBf(home, away);
    if (zjqLast) zjqResult = settleZjq(home, away);
    if (bqcLast && half) bqcResult = settleBqc(half.home, half.away, home, away);
  }

  return {
    mid: b.mid,
    code: b.code,
    league: b.league,
    home: b.home,
    away: b.away,
    kickoff: b.kickoff,
    handicap: b.handicap ?? o.handicap ?? null,
    spf: {
      initial: spfInit,
      last: spfLast,
      result: spfResult,
    },
    rqspf: {
      initial: rqspfInit,
      last: rqspfLast,
      result: rqspfResult,
    },
    bf: {
      initial: bfInit,
      last: bfLast,
      result: bfResult,
    },
    zjq: {
      initial: zjqInit,
      last: zjqLast,
      result: zjqResult,
    },
    bqc: {
      initial: bqcInit,
      last: bqcLast,
      result: bqcResult,
    },
    result,
    meta: {
      scraped_at: b.scraped_at,
      source: odds.source,
      history_points: {
        spf: spfHist.length,
        rqspf: rqspfHist.length,
        bf: bfHist.length,
        zjq: zjqHist.length,
        bqc: bqcHist.length,
      },
    },
  };
}

function main() {
  // 已有的汇总（增量模式要读）
  let existing = { generated_at: null, total: 0, matches: [] };
  if (fs.existsSync(OUTPUT_FILE)) {
    try { existing = readJson(OUTPUT_FILE); } catch (e) { /* ignore */ }
  }
  const existingByMid = new Map((existing.matches || []).map(m => [m.mid, m]));

  // 扫 results 目录 — 只处理已完赛
  if (!fs.existsSync(RESULTS_DIR)) {
    console.error(`❌ ${RESULTS_DIR} 不存在`);
    process.exit(1);
  }
  const resultFiles = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));

  let added = 0, updated = 0, skipped = 0;
  for (const f of resultFiles) {
    const mid = f.replace(/\.json$/, '');
    const entry = buildOne(mid);
    if (!entry) { skipped++; continue; }
    if (existingByMid.has(mid)) {
      updated++;
    } else {
      added++;
    }
    existingByMid.set(mid, entry);
  }

  // 排序：按 kickoff 升序
  const matches = Array.from(existingByMid.values()).sort((a, b) => {
    if (a.kickoff < b.kickoff) return -1;
    if (a.kickoff > b.kickoff) return 1;
    return 0;
  });

  const out = {
    generated_at: new Date().toISOString(),
    total: matches.length,
    schema: {
      // 字段说明（让后续模型脚本不用猜）
      description: '已完赛比赛汇总：5 玩法 initial/last/result',
      spf: '胜平负：{home, draw, away}, result in {home, draw, away}',
      rqspf: '让球胜平负：{home, draw, away}, handicap 是让球数（主队让客队；-1 为主队让 1 球）',
      bf: '比分：{score: "h:a", other: "胜其它"|"负其它"|"平其它"|null}；other 命中时即结算',
      zjq: '总进球：{result: "0"|"1"|...|"6"|"7+"}',
      bqc: '半全场：{result: "胜胜"|"胜平"|...|"负负"}',
      result: '完赛原始：{home, away, half, scorers_count, went_to_penalties, penalty_score}',
    },
    settled_only: true,
    matches,
  };

  writeJson(OUTPUT_FILE, out);
  console.log(`✅ ${OUTPUT_FILE}`);
  console.log(`   总场次: ${matches.length} | 新增: ${added} | 更新: ${updated} | 跳过: ${skipped}`);
  console.log(`   模式: ${INCREMENTAL ? 'incremental' : 'full'}`);
}

main();
