#!/usr/bin/env node
/**
 * build_teams_2022wc.js — 从 teams_2022wc.data.json 读 32 队数据, 写入
 *   data/2022wc/teams/_index.json
 *   data/2022wc/teams/<CODE>.json   × 32
 *
 * 用法: node modeling/2022wc/scripts/build_teams_2022wc.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEAMS_DIR = path.join(__dirname, '..', '..', '..', 'data', '2022wc', 'teams');
const DATA_FILE = path.join(__dirname, 'teams_2022wc.data.json');

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
const teams = data.teams;

console.log(`\n=== 32 队数据校验 ===`);
const seen = new Set();
const groups = {};
const tierCount = {};
for (const t of teams) {
  if (seen.has(t.code)) throw new Error(`重复 code: ${t.code}`);
  seen.add(t.code);
  groups[t.group] = (groups[t.group] || 0) + 1;
  tierCount[t.tier] = (tierCount[t.tier] || 0) + 1;
  if (!['top', 'second', 'defensive', 'weak'].includes(t.tier)) throw new Error(`${t.code} tier 非法: ${t.tier}`);
}
console.log(`✓ ${teams.length} 队无重复 code`);
console.log(`✓ 8 组分布: A=${groups.A} B=${groups.B} C=${groups.C} D=${groups.D} E=${groups.E} F=${groups.F} G=${groups.G} H=${groups.H}`);
console.log(`✓ tier 分布: top=${tierCount.top || 0} second=${tierCount.second || 0} defensive=${tierCount.defensive || 0} weak=${tierCount.weak || 0}`);
console.log(`✓ has_scorer_star: ${teams.filter(t => t.has_scorer_star).length} 队`);

if (!fs.existsSync(TEAMS_DIR)) fs.mkdirSync(TEAMS_DIR, { recursive: true });
const now = new Date().toISOString();

// 1) 写 32 个 team 文件
for (const t of teams) {
  const teamDoc = {
    code: t.code,
    name: t.name,
    nameEn: t.nameEn,
    confederation: t.confederation,
    flag: t.flag,
    iso2: t.iso2,
    color: t.color,
    meta: {
      tier: t.tier,
      has_scorer_star: t.has_scorer_star,
      stars: t.stars,
      is_host: t.code === 'QAT',
      fifa_rank: t.fifa_rank
    },
    wc2022: t.wc2022,
    _updated_at: now
  };
  fs.writeFileSync(path.join(TEAMS_DIR, `${t.code}.json`), JSON.stringify(teamDoc, null, 2) + '\n', 'utf-8');
}
console.log(`✓ 32 个 team 文件写入`);

// 2) 写 _index.json
const byCode = {}, byName = {}, byGroup = { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [] }, byTier = { top: [], second: [], defensive: [], weak: [] };
for (const t of teams) {
  byCode[t.code] = `${t.code}.json`;
  byName[t.name] = t.code;
  byGroup[t.group].push(t.code);
  byTier[t.tier].push(t.code);
}

const indexDoc = {
  generated_at: now,
  total_teams: teams.length,
  note: '2022 卡塔尔世界杯 32 队数据. 区别于 data/teams/_index.json (那是 2026 世界杯)',
  source: '2022 实际参赛 + 2022 当时 FIFA 排名 + 2022 实际赛果',
  by_code: byCode,
  by_name: byName,
  by_group: byGroup,
  by_tier: byTier,
  name_variants_to_code: { '沙特': 'KSA', '威尔士': 'WAL' },
  hosts: ['QAT']
};
fs.writeFileSync(path.join(TEAMS_DIR, '_index.json'), JSON.stringify(indexDoc, null, 2) + '\n', 'utf-8');
console.log(`✓ _index.json 写入`);

console.log(`\n=== 完成 ===`);
console.log(`输出: ${TEAMS_DIR}/`);
console.log(`文件: 1 个 _index.json + 32 个 <CODE>.json`);
