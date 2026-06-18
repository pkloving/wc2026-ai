#!/usr/bin/env node
/**
 * 根据 data/results/*.json 的已完赛比分，**重算** data/groups.json 的小组 standings
 * 同时更新 data/matches.json 的 status=finished（若对应 mid 已完赛）
 *
 * 用法：
 *   node scripts/update-groups-standings.js         # 重算所有小组
 *   node scripts/update-groups-standings.js --dry-run # 预览，不写回
 *
 * 逻辑：
 *   1. 读取 matches.json → 每场比赛 { id, mid, stage, group, home, away, status }
 *   2. 从 results/ 目录找 mid.json：若存在且含 homeScore/awayScore → 视为"已完赛"
 *   3. 对每个小组，遍历该小组内所有"已完赛"比赛 → 累加积分：
 *        - 胜：win+1, pts+3, gf+本方进球, ga+对方进球
 *        - 平：draw+1, pts+1, gf/ga 同上
 *        - 负：lose+1, pts+0, gf/ga 同上
 *      注：点球大战仅用于淘汰赛晋级，小组赛不可能有点球
 *   4. standings 排序：pts 降序 → gd(gf-ga) 降序 → gf 降序 → code 字母序
 *   5. 写回 groups.json（仅 standings 字段被覆写，id/name/teams 保持不变）
 *   6. 写回 matches.json（status 字段从 scheduled → finished）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DRY_RUN = process.argv.includes('--dry-run');

// ============== 读基础数据 ==============
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const groups = readJson(path.join(DATA_DIR, 'groups.json'));
const matches = readJson(path.join(DATA_DIR, 'matches.json'));

// ============== 找出所有"已完赛"比赛 ==============
const resultsDir = path.join(DATA_DIR, 'results');
const finishedByMid = new Map();     // mid → { homeScore, awayScore }
if (fs.existsSync(resultsDir)) {
  for (const f of fs.readdirSync(resultsDir)) {
    if (!f.endsWith('.json')) continue;
    const mid = f.slice(0, -5);
    try {
      const r = readJson(path.join(resultsDir, f));
      if (typeof r.homeScore === 'number' && typeof r.awayScore === 'number') {
        finishedByMid.set(mid, { homeScore: r.homeScore, awayScore: r.awayScore });
      }
    } catch (e) {
      // ignore corrupt files
    }
  }
}

// ============== 按小组聚合积分 ==============
// groupCode -> teamCode -> { played, win, draw, lose, gf, ga }
const groupStats = {};
for (const g of groups) {
  groupStats[g.id] = {};
  for (const code of g.teams) {
    groupStats[g.id][code] = { played: 0, win: 0, draw: 0, lose: 0, gf: 0, ga: 0 };
  }
}

// 遍历 matches.json，按 group 归类完赛
let matchesStatusChanged = 0;
let matchesTouched = [];
for (const m of matches) {
  const res = finishedByMid.get(m.mid);
  if (!res) continue;

  // 累加积分（仅限小组赛；淘汰赛不影响积分榜）
  if (m.stage === 'group' && m.group && groupStats[m.group]) {
    const homeCode = m.home;
    const awayCode = m.away;
    const hs = res.homeScore;
    const as = res.awayScore;

    if (groupStats[m.group][homeCode] && groupStats[m.group][awayCode]) {
      // 主队
      groupStats[m.group][homeCode].played += 1;
      groupStats[m.group][homeCode].gf += hs;
      groupStats[m.group][homeCode].ga += as;
      if (hs > as) groupStats[m.group][homeCode].win += 1;
      else if (hs === as) groupStats[m.group][homeCode].draw += 1;
      else groupStats[m.group][homeCode].lose += 1;

      // 客队
      groupStats[m.group][awayCode].played += 1;
      groupStats[m.group][awayCode].gf += as;
      groupStats[m.group][awayCode].ga += hs;
      if (as > hs) groupStats[m.group][awayCode].win += 1;
      else if (as === hs) groupStats[m.group][awayCode].draw += 1;
      else groupStats[m.group][awayCode].lose += 1;
    }
  }

  // 同步 matches.json 的 status
  if (m.status !== 'finished') {
    m.status = 'finished';
    matchesStatusChanged += 1;
    matchesTouched.push(`${m.id}(mid=${m.mid}) ${m.home}-${m.away} ${res.homeScore}-${res.awayScore}`);
  }
}

// ============== 生成新 standings ==============
function computeStandings(groupId) {
  const teams = groupStats[groupId];
  const arr = [];
  for (const code of Object.keys(teams)) {
    const s = teams[code];
    const gd = s.gf - s.ga;
    const pts = s.win * 3 + s.draw * 1;
    arr.push({
      code,
      played: s.played,
      win: s.win,
      draw: s.draw,
      lose: s.lose,
      gf: s.gf,
      ga: s.ga,
      gd,
      pts,
    });
  }
  // 排序：pts 降序 → gd 降序 → gf 降序 → code 字母序（保持确定性）
  arr.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.code.localeCompare(b.code);
  });
  return arr;
}

// 写入 groups.json
let groupsChanged = 0;
const groupsTouched = [];
for (let gi = 0; gi < groups.length; gi++) {
  const g = groups[gi];
  const newStandings = computeStandings(g.id);

  // 比较是否变化（JSON 序列化比较）
  const oldStr = JSON.stringify(g.standings);
  const newStr = JSON.stringify(newStandings);
  if (oldStr !== newStr) {
    groups[gi].standings = newStandings;
    groupsChanged += 1;
    groupsTouched.push(`${g.id} 组: ${newStandings.map(s => `${s.code}(${s.pts})`).join(', ')}`);
  }
}

// ============== 写回 ==============
if (DRY_RUN) {
  console.log('=== DRY-RUN 预览 ===');
  console.log(`已找到 ${finishedByMid.size} 场已完赛比赛`);
  console.log(`会更新 matches.json status: ${matchesStatusChanged} 场`);
  if (matchesTouched.length) console.log('  变更场次:');
  for (const t of matchesTouched) console.log(`    - ${t}`);
  console.log(`会更新 groups.json standings: ${groupsChanged} 组`);
  for (const t of groupsTouched) console.log(`    - ${t}`);
  console.log('\n不写回文件（移除 --dry-run 即可生效）');
  process.exit(0);
}

fs.writeFileSync(
  path.join(DATA_DIR, 'groups.json'),
  JSON.stringify(groups, null, 2) + '\n',
  'utf-8'
);
fs.writeFileSync(
  path.join(DATA_DIR, 'matches.json'),
  JSON.stringify(matches, null, 2) + '\n',
  'utf-8'
);

console.log(`✅ 已扫描 ${finishedByMid.size} 场已完赛比赛`);
console.log(`✅ matches.json: status 翻 finished → ${matchesStatusChanged} 场`);
if (matchesTouched.length) {
  for (const t of matchesTouched) console.log(`   - ${t}`);
}
console.log(`✅ groups.json: standings 重算 → ${groupsChanged} 组变化`);
if (groupsTouched.length) {
  for (const t of groupsTouched) console.log(`   - ${t}`);
}
