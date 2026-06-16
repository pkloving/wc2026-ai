#!/usr/bin/env node
/**
 * 更新一场比赛的结果
 * 写入 data/results/<matchId>.json（per-mid 单一来源，前端用 Vite glob 读）
 *
 * 用法：node scripts/update-result.js <matchId> <homeScore> <awayScore> \
 *         --half-time=h:a  --scorer=team:player:minute:type ...  [--penalties=h:a]
 *
 * 例：
 *   node scripts/update-result.js M001 2 1 --half-time=1:0 --scorer=ARG:Messi:23:goal --scorer=ARG:Messi:67:penalty
 *   node scripts/update-result.js M088 1 1 --half-time=1:1 --scorer=ARG:Messi:90:goal --penalties=4:3
 *
 * 校验（红线）：
 *   - --half-time 必填（bqc 玩法结算需要半场比分）
 *   - 比分非 0:0 时 --scorer 至少 1 个（保证 scorers[] 不为空，前端"进球者"区块才有内容）
 *   - --penalties 时 penaltyScore 必填
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.length < 3) {
  console.error('用法：node scripts/update-result.js <matchId> <homeScore> <awayScore> [选项]');
  console.error('选项：');
  console.error('  --half-time=h:a     半场比分（必填）');
  console.error('  --scorer=team:player:minute:type  进球者（type: goal/penalty/og；非 0:0 至少 1 个）');
  console.error('  --penalties=h:a     点球大战比分（淘汰赛平局时；--penalties 必带 penaltyScore）');
  process.exit(1);
}

const matchId = args[0];
const homeScore = parseInt(args[1], 10);
const awayScore = parseInt(args[2], 10);

if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
  console.error('比分必须是整数');
  process.exit(1);
}

let wentToPenalties = false;
let penaltyScore = null;
let halfTime = null;
const scorers = [];
for (let i = 3; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--half-time=')) {
    const v = a.slice('--half-time='.length);
    const [h, aw] = v.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(aw)) {
      console.error('--half-time 格式：--half-time=1:0');
      process.exit(1);
    }
    halfTime = { home: h, away: aw };
  } else if (a.startsWith('--penalties=')) {
    const v = a.slice('--penalties='.length);
    const [h, aw] = v.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(aw)) {
      console.error('--penalties 格式：--penalties=4:3');
      process.exit(1);
    }
    wentToPenalties = true;
    penaltyScore = { home: h, away: aw };
  } else if (a.startsWith('--scorer=')) {
    const v = a.slice('--scorer='.length);
    const [team, player, minute, type] = v.split(':');
    if (!team || !player || !minute) {
      console.error('--scorer 格式：--scorer=ARG:Messi:23:goal');
      process.exit(1);
    }
    scorers.push({ team, player, minute: parseInt(minute, 10), type: type || 'goal' });
  }
}

// 必填校验
if (halfTime === null) {
  console.error('❌ 缺半场比分：必须传 --half-time=h:a（bqc 玩法结算需要）');
  process.exit(1);
}
if (homeScore + awayScore > 0 && scorers.length === 0) {
  console.error(`❌ 比分 ${homeScore}-${awayScore} 非 0:0，但 scorers 为空：必须传至少一个 --scorer`);
  process.exit(1);
}
if (wentToPenalties && penaltyScore === null) {
  console.error('❌ --penalties 必须带比分（--penalties=h:a）');
  process.exit(1);
}

const entry = {
  matchId,
  homeScore,
  awayScore,
  halfTime,
  scorers,
  wentToPenalties,
  penaltyScore,
};

// per-mid 单一来源：写到 data/results/<matchId>.json
const resultsDir = path.join(__dirname, '..', 'data', 'results');
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
const resultFile = path.join(resultsDir, `${matchId}.json`);

let merged = entry;
if (fs.existsSync(resultFile)) {
  const existing = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
  // 保留原有 scorers（去重 by team+player+minute+type），新传入的追加
  const oldScorers = existing.scorers || [];
  const seen = new Set(oldScorers.map((s) => `${s.team}|${s.player}|${s.minute}|${s.type}`));
  const mergedScorers = oldScorers.slice();
  for (const s of scorers) {
    const k = `${s.team}|${s.player}|${s.minute}|${s.type}`;
    if (!seen.has(k)) { seen.add(k); mergedScorers.push(s); }
  }
  merged = { ...existing, ...entry, scorers: mergedScorers };
}

fs.writeFileSync(resultFile, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

// 同时更新 matches_status.json 的 status 为 finished
const statusFile = path.join(__dirname, '..', 'data', 'matches_status.json');
if (fs.existsSync(statusFile)) {
  const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
  const idx = status.matches.findIndex(m => m.mid === matchId);
  if (idx !== -1 && status.matches[idx].status !== 'finished') {
    status.matches[idx].status = 'finished';
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2) + '\n', 'utf-8');
    console.log(`${matchId} matches_status.json -> finished`);
  }
}



console.log(`✅ ${matchId} 已写入 ${path.relative(process.cwd(), resultFile)}`);
console.log(`   比分：${homeScore}-${awayScore}（半场 ${halfTime.home}-${halfTime.away}）`);
if (wentToPenalties) console.log(`   点球：${penaltyScore.home}-${penaltyScore.away}`);
console.log(`   进球者：${merged.scorers.length > 0 ? merged.scorers.map((s) => `${s.player} ${s.minute}'(${s.type})`).join(', ') : '无'}`);
