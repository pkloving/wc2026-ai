#!/usr/bin/env node
/**
 * 新增一场比赛的 AI 预测
 * 用法：node scripts/add-prediction.js <matchId> --model=NAME --home=N --away=N [--winner=home|away|draw] [--prompt="..."] [--note="..."] [--shot=path/to/img.png]
 * 例：
 *   node scripts/add-prediction.js M002 --model=Claude --home=2 --away=1 --winner=home --shot=public/assets/predictions/M002/claude-1.png
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('用法：node scripts/add-prediction.js <matchId> [选项]');
  console.error('必填：--model=NAME --home=N --away=N');
  console.error('可选：--winner=home|away|draw --prompt="..." --note="..." --shot=path');
  process.exit(1);
}

const matchId = args[0];
const opts = {};
for (let i = 1; i < args.length; i += 1) {
  const a = args[i];
  const m = a.match(/^--(\w+)=(.*)$/);
  if (!m) continue;
  const key = m[1];
  const val = m[2];
  if (key === 'home') {
    opts.predictedHome = parseInt(val, 10);
  } else if (key === 'away') {
    opts.predictedAway = parseInt(val, 10);
  } else {
    opts[key] = val;
  }
}

if (!opts.model || opts.predictedHome == null || opts.predictedAway == null) {
  console.error('必填：--model=NAME --home=N --away=N');
  process.exit(1);
}

const file = path.join(__dirname, '../data/predictions.json');
const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
let entry = data.find((x) => x.matchId === matchId);
if (!entry) { entry = { matchId, models: [] }; data.push(entry); }

// 同一模型覆盖
const mi = entry.models.findIndex((m) => m.model === opts.model);
const modelEntry = {
  model: opts.model,
  predictedHome: opts.predictedHome,
  predictedAway: opts.predictedAway,
  predictedWinner: opts.winner || (opts.predictedHome > opts.predictedAway ? 'home' : opts.predictedHome < opts.predictedAway ? 'away' : 'draw'),
  note: opts.note || '',
};
if (mi >= 0) entry.models[mi] = modelEntry; else entry.models.push(modelEntry);

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');

console.log(`✅ ${matchId} · ${opts.model} · ${opts.predictedHome}-${opts.predictedAway} 已记录`);
