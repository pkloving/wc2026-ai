// 一次性补丁: 给 matches_status.json 加 M073-M088 共 16 条 (r32 淘汰赛)
// 12:00 改过 patch_note 但未提交, 15:00 重做
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'data', 'matches_status.json');
const data = JSON.parse(fs.readFileSync(file, 'utf-8'));

// 现有 mid 集合, 防止重复
const existingMids = new Set();
const existingCodes = new Set();
for (const m of data.matches) {
  if (m.mid) existingMids.add(m.mid);
  if (m.code) existingCodes.add(m.code);
}

// 新加 16 场 (M073-M088)
const newMatches = [
  { mid: null,        code: null,      league: '世界杯', home: 'TBD', away: 'TBD', kickoff: '2026-06-29 03:00', status: 'in_progress',   spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'unknown', single_supported: false, final_score: null, odds_file: 'odds/null.json', history_file: 'odds_history/null.json', result_file: null, _note: 'M073 已开赛 12h, sporttery 5日窗口外 (businessDate 2026-06-28) — 2040309-2040336 mid 全部 567 不可查; 待 chrome-devtools-mcp 历史赛程或 sporttery 历史接口补' },
  { mid: '2040337', code: '周一074', league: '世界杯', home: 'BRA', away: 'JPN', kickoff: '2026-06-30 01:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040337.json', history_file: 'odds_history/2040337.json', result_file: null },
  { mid: '2040344', code: '周一075', league: '世界杯', home: 'GER', away: 'PAR', kickoff: '2026-06-30 04:30', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040344.json', history_file: 'odds_history/2040344.json', result_file: null },
  { mid: '2040338', code: '周一076', league: '世界杯', home: 'NED', away: 'MAR', kickoff: '2026-06-30 09:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040338.json', history_file: 'odds_history/2040338.json', result_file: null },
  { mid: '2040345', code: '周二077', league: '世界杯', home: 'CIV', away: 'NOR', kickoff: '2026-07-01 01:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040345.json', history_file: 'odds_history/2040345.json', result_file: null },
  { mid: '2040346', code: '周二078', league: '世界杯', home: 'FRA', away: 'SWE', kickoff: '2026-07-01 05:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040346.json', history_file: 'odds_history/2040346.json', result_file: null },
  { mid: '2040351', code: '周二079', league: '世界杯', home: 'MEX', away: 'ECU', kickoff: '2026-07-01 09:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040351.json', history_file: 'odds_history/2040351.json', result_file: null },
  { mid: '2040352', code: '周三080', league: '世界杯', home: 'ENG', away: 'COD', kickoff: '2026-07-02 00:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040352.json', history_file: 'odds_history/2040352.json', result_file: null },
  { mid: '2040353', code: '周三081', league: '世界杯', home: 'BEL', away: 'SEN', kickoff: '2026-07-02 04:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040353.json', history_file: 'odds_history/2040353.json', result_file: null },
  { mid: '2040339', code: '周三082', league: '世界杯', home: 'USA', away: 'BIH', kickoff: '2026-07-02 08:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'on_sale', single_supported: false, final_score: null, odds_file: 'odds/2040339.json', history_file: 'odds_history/2040339.json', result_file: null },
  { mid: '2040354', code: '周四083', league: '世界杯', home: 'ESP', away: 'AUT', kickoff: '2026-07-03 03:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'define',  single_supported: false, final_score: null, odds_file: 'odds/2040354.json', history_file: 'odds_history/2040354.json', result_file: null },
  { mid: '2040355', code: '周四084', league: '世界杯', home: 'POR', away: 'CRO', kickoff: '2026-07-03 07:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'define',  single_supported: false, final_score: null, odds_file: 'odds/2040355.json', history_file: 'odds_history/2040355.json', result_file: null },
  { mid: '2040356', code: '周四085', league: '世界杯', home: 'SUI', away: 'DZA', kickoff: '2026-07-03 11:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'define',  single_supported: false, final_score: null, odds_file: 'odds/2040356.json', history_file: 'odds_history/2040356.json', result_file: null },
  { mid: '2040347', code: '周五086', league: '世界杯', home: 'AUS', away: 'EGY', kickoff: '2026-07-04 02:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'define',  single_supported: false, final_score: null, odds_file: 'odds/2040347.json', history_file: 'odds_history/2040347.json', result_file: null },
  { mid: '2040348', code: '周五087', league: '世界杯', home: 'ARG', away: 'CPV', kickoff: '2026-07-04 06:00', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'define',  single_supported: false, final_score: null, odds_file: 'odds/2040348.json', history_file: 'odds_history/2040348.json', result_file: null },
  { mid: '2040357', code: '周五088', league: '世界杯', home: 'COL', away: 'GHA', kickoff: '2026-07-04 09:30', status: 'scheduled',  spf: null, handicap: null, rqspf: null, is_finished_odds: false, is_finished_odds_marked_at: null, scraped_at: null, sale_status: 'define',  single_supported: false, final_score: null, odds_file: 'odds/2040357.json', history_file: 'odds_history/2040357.json', result_file: null }
];

// 过滤掉已存在 mid / code 的 (idempotent)
let added = 0, skipped = 0;
for (const m of newMatches) {
  if (m.mid && existingMids.has(m.mid)) { skipped++; continue; }
  if (m.code && existingCodes.has(m.code)) { skipped++; continue; }
  data.matches.push(m);
  added++;
}

// 升级索引
data.generated_at = new Date().toISOString();
if (!data.patch_note) data.patch_note = [];
data.patch_note.push({
  at: data.generated_at,
  scope: 'M073-M088 r32 淘汰赛',
  changes: [
    'M073: TBD-TBD (kickoff 2026-06-29 03:00 CST, sporttery 5日窗口外, mid 不可查, 标 in_progress)',
    'M074-M082: 9场 on_sale, 已抓 mid+code+home/away, 等 6-30 之后跑赔率',
    'M083-M088: 6场 define (待开售), 已抓 mid, 等 sporttery 开售后再跑赔率',
    'spf/handicap/rqspf 全 null, is_finished_odds=false, scraped_at=null',
    'odds_file/history_file 已写占位路径等下次 build_index 后实际拉取'
  ],
  source: 'sporttery getMatchListV1.qry leagueId=72 (Referer+UA), lastUpdateTime 2026-06-29 11:00:02, 5天窗口 = 6-29~7-03',
  author: 'code模式 15:00 自动 patch'
});

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
console.log(`OK: added=${added}, skipped=${skipped}, total_matches=${data.matches.length}, generated_at=${data.generated_at}`);
console.log('patch_note (last):', JSON.stringify(data.patch_note[data.patch_note.length - 1], null, 2));
