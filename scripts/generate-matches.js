#!/usr/bin/env node
/**
 * 生成 2026 世界杯完整赛程到 data/matches.json
 * 72 场小组赛 + 16 + 8 + 4 + 2 + 1 + 1 = 104 场
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const groups = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/groups.json'), 'utf-8'));

const pad = (n) => String(n).padStart(3, '0');

const VENUES = [
  'Estadio Azteca, Mexico City',
  'Estadio BBVA, Monterrey',
  'Estadio Akron, Guadalajara',
  'SoFi Stadium, Los Angeles',
  'MetLife Stadium, New York/New Jersey',
  'AT&T Stadium, Dallas',
  'NRG Stadium, Houston',
  'Hard Rock Stadium, Miami',
  'Mercedes-Benz Stadium, Atlanta',
  'Lincoln Financial Field, Philadelphia',
  'Arrowhead Stadium, Kansas City',
  'Lumen Field, Seattle',
  'BC Place, Vancouver',
  'BMO Field, Toronto',
  'Gillette Stadium, Boston',
  'Geha Field, Kansas City',
];
const pickVenue = (i) => VENUES[i % VENUES.length];

// 3 个比赛日 (matchday)，每个 4 时段 × 3 组 × 2 场 = 24 场
const MATCHDAYS = [
  {
    label: 'MD1',
    slots: [
      '2026-06-11T22:00:00Z',
      '2026-06-12T01:00:00Z',
      '2026-06-12T22:00:00Z',
      '2026-06-13T01:00:00Z',
    ],
  },
  {
    label: 'MD2',
    slots: [
      '2026-06-16T22:00:00Z',
      '2026-06-17T01:00:00Z',
      '2026-06-17T22:00:00Z',
      '2026-06-18T01:00:00Z',
    ],
  },
  {
    label: 'MD3',
    slots: [
      '2026-06-21T22:00:00Z',
      '2026-06-22T01:00:00Z',
      '2026-06-22T22:00:00Z',
      '2026-06-23T01:00:00Z',
    ],
  },
];

const GROUPS_PER_SLOT = 3;
const TEMPLATES = [
  [[0, 1], [2, 3]],
  [[0, 2], [3, 1]],
  [[0, 3], [1, 2]],
];

const matches = [];
let mid = 1;

// ---- 小组赛 72 场 ----
for (let mdIndex = 0; mdIndex < 3; mdIndex += 1) {
  const md = MATCHDAYS[mdIndex];
  const template = TEMPLATES[mdIndex];
  for (let s = 0; s < md.slots.length; s += 1) {
    for (let g = 0; g < GROUPS_PER_SLOT; g += 1) {
      const groupIdx = s * GROUPS_PER_SLOT + g;
      if (groupIdx >= groups.length) break;
      const group = groups[groupIdx];
      template.forEach((tpl, t) => {
        const home = group.teams[tpl[0]];
        const away = group.teams[tpl[1]];
        // 揭幕战：MD1 第 1 时段 第 1 组 第 1 场
        let date = md.slots[s];
        if (mdIndex === 0 && groupIdx === 0 && t === 0) {
          date = '2026-06-11T19:00:00Z';
        }
        matches.push({
          id: `M${pad(mid++)}`,
          stage: 'group',
          group: group.id,
          date,
          venue: pickVenue(matches.length),
          home,
          away,
          status: 'scheduled',
        });
      });
    }
  }
}

// ---- 32 强 16 场 ----
// 2 天 × 4 时段 × 2 场 = 16
const R32_DATES = [
  ['2026-06-28T22:00:00Z', '2026-06-29T01:00:00Z', '2026-06-29T22:00:00Z', '2026-06-30T01:00:00Z'],
  ['2026-06-30T22:00:00Z', '2026-07-01T01:00:00Z', '2026-07-01T22:00:00Z', '2026-07-02T01:00:00Z'],
];
R32_DATES.forEach((day, di) => {
  day.forEach((d, si) => {
    for (let k = 0; k < 2; k += 1) {
      const slot = di * 8 + si * 2 + k + 1;
      matches.push({
        id: `M${pad(mid++)}`,
        stage: 'r32',
        group: null,
        date: d,
        venue: pickVenue(matches.length),
        home: `TBD_R32_${slot}_W`,
        away: `TBD_R32_${slot}_3RD`,
        status: 'scheduled',
        note: '32 强：组第 1 vs 另一组第 3',
      });
    }
  });
});

// ---- 16 强 8 场：2 天 × 4 时段 = 8 ----
const R16_DATES = [
  ['2026-07-03T22:00:00Z', '2026-07-04T01:00:00Z', '2026-07-04T22:00:00Z', '2026-07-05T01:00:00Z'],
  ['2026-07-05T22:00:00Z', '2026-07-06T01:00:00Z', '2026-07-06T22:00:00Z', '2026-07-07T01:00:00Z'],
];
R16_DATES.forEach((day, di) => {
  day.forEach((d, si) => {
    matches.push({
      id: `M${pad(mid++)}`,
      stage: 'r16',
      group: null,
      date: d,
      venue: pickVenue(matches.length),
      home: `TBD_R16_${di * 4 + si + 1}_W`,
      away: `TBD_R16_${di * 4 + si + 1}_L`,
      status: 'scheduled',
    });
  });
});

// ---- 8 强 4 场：2 天 × 2 时段 = 4 ----
const QF_DATES = [
  ['2026-07-09T22:00:00Z', '2026-07-10T01:00:00Z'],
  ['2026-07-10T22:00:00Z', '2026-07-11T01:00:00Z'],
];
QF_DATES.forEach((day, di) => {
  day.forEach((d, si) => {
    matches.push({
      id: `M${pad(mid++)}`,
      stage: 'qf',
      group: null,
      date: d,
      venue: pickVenue(matches.length),
      home: `TBD_QF_${di * 2 + si + 1}_W`,
      away: `TBD_QF_${di * 2 + si + 1}_L`,
      status: 'scheduled',
    });
  });
});

// ---- 半决赛 2 场 ----
['2026-07-14T22:00:00Z', '2026-07-15T22:00:00Z'].forEach((d, i) => {
  matches.push({
    id: `M${pad(mid++)}`,
    stage: 'sf',
    group: null,
    date: d,
    venue: pickVenue(matches.length),
    home: `TBD_SF_${i + 1}_W`,
    away: `TBD_SF_${i + 1}_L`,
    status: 'scheduled',
  });
});

// 三四名决赛
matches.push({
  id: `M${pad(mid++)}`,
  stage: 'third',
  group: null,
  date: '2026-07-18T22:00:00Z',
  venue: pickVenue(matches.length),
  home: 'TBD_SF_L1',
  away: 'TBD_SF_L2',
  status: 'scheduled',
});

// 决赛
matches.push({
  id: `M${pad(mid++)}`,
  stage: 'final',
  group: null,
  date: '2026-07-19T22:00:00Z',
  venue: 'MetLife Stadium, New York/New Jersey',
  home: 'TBD_FINAL_W1',
  away: 'TBD_FINAL_W2',
  status: 'scheduled',
});

fs.writeFileSync(
  path.join(__dirname, '../data/matches.json'),
  JSON.stringify(matches, null, 2) + '\n',
  'utf-8',
);

const counts = matches.reduce((acc, m) => {
  acc[m.stage] = (acc[m.stage] || 0) + 1;
  return acc;
}, {});

console.log(`✅ 已生成 ${matches.length} 场比赛到 data/matches.json`);
console.log('   ', JSON.stringify(counts));
