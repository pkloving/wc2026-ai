/**
 * gen_model_accuracy.js
 * 生成各模型命中率对比 JSON，供前端展示
 *
 * 用法：
 *   node scripts/gen_model_accuracy.js
 *
 * 输出：
 *   data/model_accuracy.json
 *
 * 结构：
 * {
 *   generated_at: '2026-06-19T...',
 *   sample_size: 24,
 *   models: [
 *     { name: 'deepseek', dir_acc: 58.3, score_acc: 12.5, zjq_acc: 25.0, dir_hits: 14, total: 24 },
 *     ...
 *   ],
 *   baselines: {
 *     odds_driven: { dir_acc: 55.0, dir_hits: 11, total: 20 },
 *     strategy_31: { dir_acc: 60.0, dir_hits: 12, total: 20 },
 *     majority_vote: { dir_acc: 52.2, dir_hits: 12, total: 23 },
 *     all_home: { dir_acc: 54.2, dir_hits: 13, total: 24 },
 *     all_draw: { dir_acc: 37.5, dir_hits: 9, total: 24 }
 *   },
 *   distribution: { home: 54, draw: 38, away: 8 },
 *   disclaimer: '...'
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MATCHES_FILE = path.join(__dirname, '../data/matches.json');
const PREDS_FILE = path.join(__dirname, '../data/predictions.json');
const ODDS_DIR = path.join(__dirname, '../data/odds');
const RESULTS_DIR = path.join(__dirname, '../data/results');
const OUTPUT_FILE = path.join(__dirname, '../data/model_accuracy.json');

function main() {
  // 1. 读 matches.json → M001 ↔ mid
  const matches = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf-8'));
  const idMap = {};
  for (const m of matches) idMap[m.id] = m.mid;

  // 2. 读 predictions.json
  const preds = JSON.parse(fs.readFileSync(PREDS_FILE, 'utf-8'));

  // 3. 读已完赛结果
  function getResult(mid) {
    const fp = path.join(RESULTS_DIR, mid + '.json');
    if (!fs.existsSync(fp)) return null;
    const r = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    if (typeof r.homeScore === 'number') return { home: r.homeScore, away: r.awayScore };
    return null;
  }

  function winnerOf(h, a) {
    return h > a ? 'home' : (h < a ? 'away' : 'draw');
  }

  // 4. 构造已完赛列表
  const finished = [];
  for (const p of preds) {
    const mid = idMap[p.matchId];
    if (!mid) continue;
    const r = getResult(mid);
    if (!r) continue;
    finished.push({ id: p.matchId, mid, actual: r, models: p.models });
  }

  if (finished.length === 0) {
    console.error('⚠️ 无已完赛比赛可对比');
    process.exit(1);
  }

  // 5. 各大模型统计
  const modelNames = ['deepseek', 'claude', 'MiniMax', 'Kimi', 'GPT-5 mini'];
  const models = [];
  for (const name of modelNames) {
    let t = 0, h = 0, s = 0, z = 0;
    for (const m of finished) {
      const p = m.models.find(x => x.model === name);
      if (!p) continue;
      t++;
      if (winnerOf(p.predictedHome, p.predictedAway) === winnerOf(m.actual.home, m.actual.away)) h++;
      if (p.predictedHome === m.actual.home && p.predictedAway === m.actual.away) s++;
      if ((p.predictedHome + p.predictedAway) === (m.actual.home + m.actual.away)) z++;
    }
    models.push({
      name,
      dir_acc: t > 0 ? Math.round(h / t * 1000) / 10 : 0,
      score_acc: t > 0 ? Math.round(s / t * 1000) / 10 : 0,
      zjq_acc: t > 0 ? Math.round(z / t * 1000) / 10 : 0,
      dir_hits: h,
      score_hits: s,
      zjq_hits: z,
      total: t,
    });
  }

  // 6. 基线模型
  // A. 赔率驱动（spf 最低赔率方向）
  let oddsT = 0, oddsH = 0;
  for (const m of finished) {
    const fp = path.join(ODDS_DIR, m.mid + '.json');
    if (!fs.existsSync(fp)) continue;
    const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const spf = d.odds?.spf_latest;
    if (!spf || !spf.home || !spf.draw || !spf.away) continue;
    oddsT++;
    let min = Math.min(spf.home, spf.draw, spf.away);
    let dir = spf.home === min ? 'home' : (spf.away === min ? 'away' : 'draw');
    if (dir === winnerOf(m.actual.home, m.actual.away)) oddsH++;
  }
  const oddsDriven = {
    dir_acc: oddsT > 0 ? Math.round(oddsH / oddsT * 1000) / 10 : 0,
    dir_hits: oddsH,
    total: oddsT,
  };

  // B. 31 号策略简化版（赔率 + 让球规则）
  let s31T = 0, s31H = 0;
  for (const m of finished) {
    const fp = path.join(ODDS_DIR, m.mid + '.json');
    if (!fs.existsSync(fp)) continue;
    const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const hc = d.odds?.handicap;
    const spf = d.odds?.spf_latest;
    if (typeof hc !== 'number' || !spf || !spf.home || !spf.draw || !spf.away) continue;
    s31T++;
    let dir;
    if (spf.home < 1.5 || hc <= -2) dir = 'home';
    else if (spf.away < 1.5 || hc >= 2) dir = 'away';
    else dir = 'draw';
    if (dir === winnerOf(m.actual.home, m.actual.away)) s31H++;
  }
  const strategy31 = {
    dir_acc: s31T > 0 ? Math.round(s31H / s31T * 1000) / 10 : 0,
    dir_hits: s31H,
    total: s31T,
  };

  // C. 多数模型一致方向（>=3 个模型同方向）
  let majT = 0, majH = 0;
  for (const m of finished) {
    const counts = { home: 0, draw: 0, away: 0 };
    for (const p of m.models) counts[winnerOf(p.predictedHome, p.predictedAway)]++;
    const max = Math.max(counts.home, counts.draw, counts.away);
    if (max >= 3) {
      majT++;
      let chosen = 'home';
      for (const k of ['home', 'draw', 'away']) if (counts[k] === max) chosen = k;
      if (chosen === winnerOf(m.actual.home, m.actual.away)) majH++;
    }
  }
  const majorityVote = {
    dir_acc: majT > 0 ? Math.round(majH / majT * 1000) / 10 : 0,
    dir_hits: majH,
    total: majT,
  };

  // D. 全选主胜 / 全选平局
  const total = finished.length;
  const homeCnt = finished.filter(m => winnerOf(m.actual.home, m.actual.away) === 'home').length;
  const drawCnt = finished.filter(m => winnerOf(m.actual.home, m.actual.away) === 'draw').length;
  const awayCnt = finished.filter(m => winnerOf(m.actual.home, m.actual.away) === 'away').length;

  const allHome = {
    dir_acc: Math.round(homeCnt / total * 1000) / 10,
    dir_hits: homeCnt,
    total,
  };
  const allDraw = {
    dir_acc: Math.round(drawCnt / total * 1000) / 10,
    dir_hits: drawCnt,
    total,
  };

  // 7. 输出 JSON
  const output = {
    generated_at: new Date().toISOString(),
    sample_size: total,
    models,
    baselines: {
      odds_driven: oddsDriven,
      strategy_31: strategy31,
      majority_vote: majorityVote,
      all_home: allHome,
      all_draw: allDraw,
    },
    distribution: {
      home: Math.round(homeCnt / total * 100),
      draw: Math.round(drawCnt / total * 100),
      away: Math.round(awayCnt / total * 100),
    },
    disclaimer: '本数据基于历史比赛对比，仅供参考，不构成投注建议。样本量较小（n=' + total + '），后续可能波动。',
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log('✅ 已生成 ' + OUTPUT_FILE);
  console.log('   样本量: ' + total + ' 场');
  console.log('   31号策略: ' + strategy31.dir_acc + '% (' + strategy31.dir_hits + '/' + strategy31.total + ')');
  console.log('   赔率驱动: ' + oddsDriven.dir_acc + '% (' + oddsDriven.dir_hits + '/' + oddsDriven.total + ')');
  console.log('   最佳大模型: ' + models[0].name + ' ' + models[0].dir_acc + '%');
}

main();