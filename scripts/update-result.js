#!/usr/bin/env node
/**
 * 更新一场比赛的结果
 * 用法：node scripts/update-result.js <matchId> <homeScore> <awayScore> [--penalties=home:away] [--scorer=team:player:minute:type ...]
 * 例：
 *   node scripts/update-result.js M001 2 1
 *   node scripts/update-result.js M088 1 1 --penalties=4:3 --scorer=ARG:Messi:23:goal
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.length < 3) {
  console.error('用法：node scripts/update-result.js <matchId> <homeScore> <awayScore> [选项]');
  console.error('选项：');
  console.error('  --penalties=h:a     点球大战比分（淘汰赛平局时）');
  console.error('  --scorer=team:player:minute:type  进球者（type: goal/penalty/og）');
  process.exit(1);
}

const matchId = args[0];
const homeScore = parseInt(args[1], 10);
const awayScore = parseInt(args[2], 10);

if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
  console.error('比分必须是整数');
  process.exit(1);
}

const resultFile = path.join(__dirname, '../data/results.json');
const results = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));

let wentToPenalties = false;
let penaltyScore = null;
const scorers = [];
for (let i = 3; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--penalties=')) {
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

const entry = {
  matchId,
  homeScore,
  awayScore,
  scorers,
  wentToPenalties,
  penaltyScore,
};
const idx = results.findIndex((r) => r.matchId === matchId);
if (idx >= 0) {
  // 保留原有 scorers，新传入的 scorers 追加在末尾（去重 by team+player+minute）
  const existing = results[idx].scorers || [];
  const seen = new Set(existing.map((s) => `${s.team}|${s.player}|${s.minute}|${s.type}`));
  const merged = existing.slice();
  for (const s of scorers) {
    const k = `${s.team}|${s.player}|${s.minute}|${s.type}`;
    if (!seen.has(k)) { seen.add(k); merged.push(s); }
  }
  results[idx] = { ...results[idx], ...entry, scorers: merged };
} else {
  results.push(entry);
}

fs.writeFileSync(resultFile, JSON.stringify(results, null, 2) + '\n', 'utf-8');

console.log(`✅ ${matchId} 已更新为 ${homeScore}-${awayScore}${wentToPenalties ? ` (点球 ${penaltyScore.home}-${penaltyScore.away})` : ''}`);
console.log(`   进球者：${scorers.length > 0 ? scorers.map((s) => `${s.player} ${s.minute}'`).join(', ') : '无'}`);
