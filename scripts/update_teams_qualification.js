/**
 * 更新各队晋级压力分析 + 晋级对位分析
 * 输入：data/groups.json, data/matches.json, data/teams/_index.json, data/teams/*.json
 * 输出：更新 data/teams/*.json 的 wc2026.qualification_pressure 和 wc2026.knockout_matchup
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const TEAMS_DIR = path.join(DATA_DIR, 'teams');

// 1. 读取数据
const groups = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'groups.json'), 'utf-8'));
const matches = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'matches.json'), 'utf-8'));
const teamsIndex = JSON.parse(fs.readFileSync(path.join(TEAMS_DIR, '_index.json'), 'utf-8'));

// 2. 建立小组 -> 球队信息映射
const groupMap = {};
for (const g of groups) {
  // groups.json 的 standings 没有 position 字段，按数组索引推断排名
  const standingsWithPos = g.standings.map((s, i) => ({
    ...s,
    position: i + 1
  }));
  groupMap[g.id] = {
    name: g.name,
    teams: g.teams,
    standings: standingsWithPos
  };
}

// 3. 建立球队 code -> 中文名映射（从 _index.by_name）
const codeToName = {};
for (const [name, code] of Object.entries(teamsIndex.by_name)) {
  codeToName[code] = name;
}
for (const [name, code] of Object.entries(teamsIndex.name_variants_to_code || {})) {
  if (!codeToName[code]) codeToName[code] = name;
}

// 4. 计算晋级压力
function calcPressure(team, groupStandings) {
  const pos = team.position;
  const pts = team.pts;
  const played = team.played;
  const remaining = 3 - played;

  const teamsAhead = groupStandings.filter(t => t.pts > pts).length;
  const teamsBehind = groupStandings.filter(t => t.pts < pts).length;
  const samePts = groupStandings.filter(t => t.pts === pts && t.code !== team.code).length;

  const minQualifyPts = remaining > 0 ? Math.max(0, 4 - pts) : 0;

  let pressureLevel;
  let pressureText;

  if (played === 0) {
    pressureLevel = 'low';
    pressureText = '首轮未踢，暂无积分压力';
  } else if (pts >= 6 && remaining <= 1) {
    pressureLevel = 'low';
    pressureText = '已积6分，基本锁定出线资格，只需避免大比分失利';
  } else if (pts >= 6 && remaining >= 2) {
    pressureLevel = 'low';
    pressureText = '两连胜积6分，形势大好，可轮换调整状态';
  } else if (pts >= 4 && remaining >= 1) {
    pressureLevel = 'low-medium';
    pressureText = '积分形势良好，再拿1-2分即可确保出线';
  } else if (pts === 3 && remaining >= 1) {
    pressureLevel = 'medium';
    pressureText = '3分处于晋级边缘，下一场比赛至关重要，需争取不败';
  } else if (pts >= 1 && pts <= 2) {
    pressureLevel = 'medium-high';
    pressureText = '积分不足，剩余比赛必须全力争胜，平局可能都不够';
  } else if (pts === 0 && remaining >= 2) {
    pressureLevel = 'high';
    pressureText = '尚未拿分，出线形势严峻，需连胜或至少拿4分才有希望';
  } else if (pts === 0 && remaining === 1) {
    pressureLevel = 'very-high';
    pressureText = '只剩一场比赛且0分，理论上仅存数学希望，必须赢球且看其他队脸色';
  } else {
    pressureLevel = 'medium';
    pressureText = '积分形势需根据剩余比赛结果判断';
  }

  // 下一场比赛（同组内的 scheduled/on_sale 比赛）
  const nextMatch = matches.find(m => {
    if (m.status !== 'scheduled' && m.status !== 'on_sale') return false;
    return m.home === team.code || m.away === team.code;
  });

  let nextMatchInfo = null;
  if (nextMatch) {
    const isHome = nextMatch.home === team.code;
    const oppCode = isHome ? nextMatch.away : nextMatch.home;
    const oppStanding = groupStandings.find(t => t.code === oppCode);
    const oppPos = oppStanding ? oppStanding.position : '?';
    const oppPts = oppStanding ? oppStanding.pts : '?';
    nextMatchInfo = {
      match_id: nextMatch.id,
      mid: nextMatch.mid || null,
      date: nextMatch.date,
      opponent_code: oppCode,
      opponent_name: codeToName[oppCode] || oppCode,
      opponent_position: oppPos,
      opponent_pts: oppPts,
      venue: nextMatch.venue || null,
      importance: calcMatchImportance(team, oppStanding, remaining),
    };
  }

  return {
    pressure_level: pressureLevel,
    pressure_text: pressureText,
    position: pos,
    points: pts,
    played: played,
    remaining_matches: remaining,
    teams_ahead: teamsAhead,
    teams_behind: teamsBehind,
    same_points_teams: samePts,
    min_points_to_qualify: minQualifyPts,
    next_match: nextMatchInfo,
  };
}

function calcMatchImportance(team, oppStanding, remaining) {
  if (!oppStanding) return 'general';
  const ptsDiff = team.pts - oppStanding.pts;
  if (remaining === 1) return 'must-win';
  if (Math.abs(ptsDiff) <= 1) return 'critical';
  if (ptsDiff >= 3) return 'consolidation';
  if (ptsDiff <= -3) return 'must-win';
  return 'important';
}

// 5. 计算晋级对位分析
function getKnockoutMatchup(groupId, position) {
  const pairings = {
    1: {
      would_play_description: '若以第一出线，1/8决赛大概率对阵其他组第二名或成绩较好的第三名，淘汰赛起步相对轻松',
      bracket_note: '小组第一通常被分在种子对位区，避开过早与其他强队相遇',
    },
    2: {
      would_play_description: '若以第二出线，1/8决赛可能对阵其他小组第一或成绩较好的第三名，很可能遭遇强敌',
      bracket_note: '第二出线的淘汰赛对手通常更强，需做好硬仗准备',
    },
    3: {
      would_play_description: '若以最好的8个第三名之一出线，将对阵其他组第一，大概率是硬仗，但爆冷机会也存在',
      bracket_note: '第三名晋级通常需在首轮对阵强队',
    }
  };
  return pairings[position] || pairings[2];
}

function calcMatchup(team, groupId, groupStandings) {
  const pos = team.position;
  const pts = team.pts;
  const gd = team.gd;
  const remaining = 3 - team.played;

  const diffTo2nd = pos <= 2 ? 0 : Math.abs(pts - (groupStandings[1]?.pts || 0));
  const diffTo1st = pos === 1 ? 0 : Math.abs(pts - (groupStandings[0]?.pts || 0));

  const bestCase = {
    best_possible_position: remaining >= 1 ? 1 : pos,
    best_possible_pts: pts + remaining * 3,
    scenario: `全胜可积${pts + remaining * 3}分，${remaining >= 1 ? '有机会争小组第一' : '排名已锁定'}`,
  };
  const worstCase = {
    worst_possible_position: remaining >= 1 ? 4 : pos,
    worst_possible_pts: pts,
    scenario: `剩余比赛全败将停留在${pts}分，大概率无法出线`,
  };

  let qualification_chance;
  if (pts >= 6) qualification_chance = 'high';
  else if (pts >= 4) qualification_chance = 'medium-high';
  else if (pts >= 3) qualification_chance = 'medium';
  else if (pts >= 1) qualification_chance = 'low-medium';
  else qualification_chance = 'low';

  const knockout = getKnockoutMatchup(groupId, pos);

  return {
    current_position: pos,
    points: pts,
    goal_diff: gd,
    remaining_matches: remaining,
    diff_to_1st: diffTo1st,
    diff_to_2nd: diffTo2nd,
    target_position: pos === 1 ? '保1争1' : pos === 2 ? '保2争1' : pos === 3 ? '争前2保3' : '全力争前2',
    best_case: bestCase,
    worst_case: worstCase,
    qualification_chance: qualification_chance,
    knockout_potential: knockout,
    strategy_notes: generateStrategyNotes(team, groupStandings, remaining),
  };
}

function generateStrategyNotes(team, groupStandings, remaining) {
  const notes = [];
  const pos = team.position;
  const pts = team.pts;

  if (pos === 1 && pts >= 6) {
    notes.push('排名第一且积分领先，策略上可适度轮换，保持状态即可');
    notes.push('需警惕最后一轮"放水"心态，避免冷门影响士气');
  } else if (pos === 1) {
    notes.push('暂居第一但领先优势不大，需继续全力争胜巩固头名');
    notes.push('小组第一将在淘汰赛获得更有利的对位');
  } else if (pos === 2) {
    notes.push('排名第二，处于直接晋级区，需保持不败避免被反超');
    notes.push('与第三名的积分差距需要关注，保持进攻效率');
  } else if (pos === 3) {
    notes.push('排名第三，处于晋级边缘，必须全力争取前2或最佳第三名资格');
    notes.push('净胜球可能成为决定性因素，不应保守');
  } else {
    notes.push('排名暂时靠后，剩余比赛必须改变策略全力进攻');
    notes.push('可能需要大比分取胜才能靠净胜球竞争出线');
  }

  if (remaining === 1) {
    notes.push('小组赛最后一轮，必须根据实时比分调整策略');
  } else if (remaining === 2) {
    notes.push('还有2场比赛，足够扭转局面但不能再输');
  }

  return notes;
}

// 6. 遍历所有球队，计算并更新
let updatedCount = 0;
const codes = Object.keys(teamsIndex.by_code);

for (const code of codes) {
  const teamFile = path.join(TEAMS_DIR, code + '.json');
  if (!fs.existsSync(teamFile)) continue;

  const team = JSON.parse(fs.readFileSync(teamFile, 'utf-8'));

  if (!team.wc2026 || !team.wc2026.group) continue;

  const groupId = team.wc2026.group;
  const groupInfo = groupMap[groupId];
  if (!groupInfo) continue;

  const standing = groupInfo.standings.find(s => s.code === code);
  if (!standing) continue;

  const pressure = calcPressure(standing, groupInfo.standings);
  const matchup = calcMatchup(standing, groupId, groupInfo.standings);

  team.wc2026 = team.wc2026 || {};
  team.wc2026.qualification_pressure = pressure;
  team.wc2026.knockout_matchup = matchup;
  team._updated_at = new Date().toISOString();

  fs.writeFileSync(teamFile, JSON.stringify(team, null, 2), 'utf-8');
  updatedCount++;
}

console.log(`\u2705 更新了 ${updatedCount} 支球队的晋级分析`);
console.log(`\n\ud83d\udcca 小组积分榜速览：`);
for (const g of groups) {
  console.log(`\n【${g.id}组】`);
  for (const s of g.standings) {
    const name = codeToName[s.code] || s.code;
    console.log(`  ${s.position}. ${name}(${s.code}) \u2014 ${s.played}场 ${s.win}胜${s.draw}平${s.lose}负 ${s.pts}分 (净胜${s.gd >= 0 ? '+' : ''}${s.gd})`);
  }
}
