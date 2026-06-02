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
  if (key === 'shot') {
    opts.screenshots = opts.screenshots || [];
    opts.screenshots.push(val);
  } else if (key === 'home') {
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
  prompt: opts.prompt || '',
  predictedHome: opts.predictedHome,
  predictedAway: opts.predictedAway,
  predictedWinner: opts.winner || (opts.predictedHome > opts.predictedAway ? 'home' : opts.predictedHome < opts.predictedAway ? 'away' : 'draw'),
  screenshots: opts.screenshots || [],
  note: opts.note || '',
};
if (mi >= 0) entry.models[mi] = modelEntry; else entry.models.push(modelEntry);

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');

// 复制截图到 public/assets/predictions
if (opts.screenshots && opts.screenshots.length > 0) {
  for (const s of opts.screenshots) {
    const src = path.resolve(s);
    if (!fs.existsSync(src)) {
      console.warn(`⚠️  截图不存在：${src}（请手动放到 public/assets/predictions/${matchId}/）`);
      continue;
    }
    const filename = path.basename(src);
    const destDir = path.join(__dirname, '../public/assets/predictions', matchId);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, filename);
    fs.copyFileSync(src, dest);
    console.log(`📷 已复制 ${filename} → public/assets/predictions/${matchId}/`);
  }
}

console.log(`✅ ${matchId} · ${opts.model} · ${opts.predictedHome}-${opts.predictedAway} 已记录`);
