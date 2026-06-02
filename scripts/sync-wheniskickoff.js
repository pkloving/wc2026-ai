#!/usr/bin/env node
/**
 * 把 wheniskickoff.com 拉来的 data/*-remote.json 整理成本项目
 * data/teams.json / data/groups.json / data/matches.json 的格式。
 *
 * 用法：node scripts/sync-wheniskickoff.js
 * 依赖：data/*-remote.json 必须已经存在（由 curl 拉下来）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../data');

const remoteTeams = JSON.parse(fs.readFileSync(path.join(DATA, 'teams-remote.json'), 'utf-8'));
const remoteGroups = JSON.parse(fs.readFileSync(path.join(DATA, 'groups-remote.json'), 'utf-8'));
const remoteMatches = JSON.parse(fs.readFileSync(path.join(DATA, 'matches-remote.json'), 'utf-8'));
const remoteVenues = JSON.parse(fs.readFileSync(path.join(DATA, 'venues-remote.json'), 'utf-8'));

// 国家代码 -> ISO2 / 中文名 / 配色
// 仅列出官方 48 队里、本地尚未存在的、以及需要修正映射的条目
const TEAM_META = {
  // 已有但需要修正的
  ARG: { nameZh: '阿根廷', iso2: 'ar', color: '#75AADB' },
  AUS: { nameZh: '澳大利亚', iso2: 'au', color: '#00008B' },
  AUT: { nameZh: '奥地利', iso2: 'at', color: '#ED2939' },
  BEL: { nameZh: '比利时', iso2: 'be', color: '#FAE042' },
  BRA: { nameZh: '巴西', iso2: 'br', color: '#009C3B' },
  CAN: { nameZh: '加拿大', iso2: 'ca', color: '#FF0000' },
  CIV: { nameZh: '科特迪瓦', iso2: 'ci', color: '#F77F00' },
  CPV: { nameZh: '佛得角', iso2: 'cv', color: '#003893' },
  CRO: { nameZh: '克罗地亚', iso2: 'hr', color: '#171796' },
  CUW: { nameZh: '库拉索', iso2: 'cw', color: '#002B7F' },
  CZE: { nameZh: '捷克', iso2: 'cz', color: '#11457E' },
  DZA: { nameZh: '阿尔及利亚', iso2: 'dz', color: '#006233' },
  ECU: { nameZh: '厄瓜多尔', iso2: 'ec', color: '#FFD100' },
  EGY: { nameZh: '埃及', iso2: 'eg', color: '#CE1126' },
  ENG: { nameZh: '英格兰', iso2: 'gb-eng', color: '#CF142B' },
  ESP: { nameZh: '西班牙', iso2: 'es', color: '#AA151B' },
  FRA: { nameZh: '法国', iso2: 'fr', color: '#0055A4' },
  GER: { nameZh: '德国', iso2: 'de', color: '#000000' },
  GHA: { nameZh: '加纳', iso2: 'gh', color: '#006B3F' },
  HAI: { nameZh: '海地', iso2: 'ht', color: '#00209F' },
  IRN: { nameZh: '伊朗', iso2: 'ir', color: '#239F40' },
  IRQ: { nameZh: '伊拉克', iso2: 'iq', color: '#CE1126' },
  JOR: { nameZh: '约旦', iso2: 'jo', color: '#000000' },
  JPN: { nameZh: '日本', iso2: 'jp', color: '#BC002D' },
  KOR: { nameZh: '韩国', iso2: 'kr', color: '#003478' },
  KSA: { nameZh: '沙特阿拉伯', iso2: 'sa', color: '#006C35' },
  MAR: { nameZh: '摩洛哥', iso2: 'ma', color: '#C1272D' },
  MEX: { nameZh: '墨西哥', iso2: 'mx', color: '#006847' },
  NED: { nameZh: '荷兰', iso2: 'nl', color: '#FF6F00' },
  NOR: { nameZh: '挪威', iso2: 'no', color: '#EF2B2D' },
  NZL: { nameZh: '新西兰', iso2: 'nz', color: '#00247D' },
  PAN: { nameZh: '巴拿马', iso2: 'pa', color: '#DA121A' },
  PAR: { nameZh: '巴拉圭', iso2: 'py', color: '#D52B1E' },
  POR: { nameZh: '葡萄牙', iso2: 'pt', color: '#006600' },
  QAT: { nameZh: '卡塔尔', iso2: 'qa', color: '#8D1B3D' },
  RSA: { nameZh: '南非', iso2: 'za', color: '#007749' },
  SCO: { nameZh: '苏格兰', iso2: 'gb-sct', color: '#0065BD' },
  SEN: { nameZh: '塞内加尔', iso2: 'sn', color: '#00853F' },
  SUI: { nameZh: '瑞士', iso2: 'ch', color: '#D52B1E' },
  SWE: { nameZh: '瑞典', iso2: 'se', color: '#006AA7' },
  TUN: { nameZh: '突尼斯', iso2: 'tn', color: '#E70013' },
  TUR: { nameZh: '土耳其', iso2: 'tr', color: '#E30A17' },
  URU: { nameZh: '乌拉圭', iso2: 'uy', color: '#0038A8' },
  USA: { nameZh: '美国', iso2: 'us', color: '#002868' },
  BIH: { nameZh: '波黑', iso2: 'ba', color: '#002395' },
  COD: { nameZh: '刚果（金）', iso2: 'cd', color: '#007FFF' },
  UZB: { nameZh: '乌兹别克斯坦', iso2: 'uz', color: '#1EB53A' },
  COL: { nameZh: '哥伦比亚', iso2: 'co', color: '#FCD116' },
};

// 1) teams.json
const teamsOut = [];
const seen = new Set();
// known duplicates in source: URY 是 URU 的别名（一个空 matches 的占位条目 + 一个实际参赛的条目）
const DUP = { URY: 'URU' };
for (const t of remoteTeams.data) {
  if (seen.has(t.code)) continue; // 跳过重复条目
  if (DUP[t.code]) continue; // 跳过已知别名
  if (!TEAM_META[t.code]) {
    console.warn(`⚠️  ${t.code} 没有 TEAM_META 映射，跳过`);
    continue;
  }
  seen.add(t.code);
  const meta = TEAM_META[t.code];
  teamsOut.push({
    code: t.code,
    name: meta.nameZh,
    nameEn: t.name,
    confederation: t.confederation,
    flag: t.flag,
    iso2: meta.iso2,
    color: meta.color,
  });
}
// 通用 TBD 占位（淘汰赛用）
teamsOut.push({
  code: 'TBD',
  name: '待定',
  nameEn: 'TBD',
  confederation: 'FIFA',
  flag: '🏳️',
  iso2: '',
  color: '#6B7280',
  placeholder: true,
});
fs.writeFileSync(path.join(DATA, 'teams.json'), JSON.stringify(teamsOut, null, 2) + '\n', 'utf-8');
console.log(`✅ teams.json: ${teamsOut.length} 队`);

// 2) groups.json
const groupsOut = remoteGroups.data.map((g) => {
  const teams = g.teams.filter((c) => c !== 'URY'); // 去掉 URY 重复
  // 如果去掉 URY 后不足 4 队，说明 URU 被误写，尝试用 URU 补位
  if (teams.length < 4 && g.teams.includes('URY')) {
    const idx = teams.length;
    teams.push('URU');
  }
  // 去重保序
  const dedup = [...new Set(teams)];
  if (dedup.length !== 4) {
    console.warn(`⚠️  ${g.group} 组只有 ${dedup.length} 队：${dedup.join(',')}`);
  }
  return { id: g.group, name: `${g.group} 组`, teams: dedup };
});
fs.writeFileSync(path.join(DATA, 'groups.json'), JSON.stringify(groupsOut, null, 2) + '\n', 'utf-8');
console.log(`✅ groups.json: ${groupsOut.length} 组`);

// 3) matches.json
const venueMap = Object.fromEntries(remoteVenues.data.map((v) => [v.id, `${v.name}, ${v.city}`]));
const phaseMap = {
  group: 'group',
  'last-32': 'r32',
  'round-of-16': 'r16',
  'quarter-finals': 'qf',
  'semi-finals': 'sf',
  'third-place-play-off': 'third',
  final: 'final',
};

const matchesOut = remoteMatches.data.map((m, i) => {
  const id = `M${String(i + 1).padStart(3, '0')}`;
  // 官方数据把乌拉圭同时写成 URU 和 URY（一个空 matches 的占位条目 + 一个有 matches 的实际条目）
  // 统一用 URU
  const fixTeam = (c) => (c === 'URY' ? 'URU' : c);
  // 淘汰赛阶段官方 API 不预测对阵，落到通用 TBD 占位
  const home = fixTeam(m.home) || (m.phase === 'group' ? null : 'TBD');
  const away = fixTeam(m.away) || (m.phase === 'group' ? null : 'TBD');
  return {
    id,
    stage: phaseMap[m.phase] || m.phase,
    group: m.phase === 'group' ? m.group : null,
    date: m.datetime_utc,
    venue: venueMap[m.venue] || m.venue_name,
    home,
    away,
    status: 'scheduled',
  };
});
fs.writeFileSync(path.join(DATA, 'matches.json'), JSON.stringify(matchesOut, null, 2) + '\n', 'utf-8');
console.log(`✅ matches.json: ${matchesOut.length} 场`);

const counts = matchesOut.reduce((acc, m) => {
  acc[m.stage] = (acc[m.stage] || 0) + 1;
  return acc;
}, {});
console.log('   ', JSON.stringify(counts));
