// 12_r013_user_rules.js
// R-013 用户规则版（2026-06-17 与用户讨论后整理）
//
// 规则体系：
// 1. 方向A 3串1 rqspf（让球玩法）
//    - spf<1.5 → 选 spf 对应方向（主胜/客胜）
//    - spf 1.5-1.7 → 看 rqspf 差值
//    - spf 1.7-2.5 → 选平
//    - spf>2.5 → 选客胜
//    - spf 无 + |handicap|<=1 → 选 rqspf 最低赔率（让胜或受让负，避开平）
//    - |handicap|>=2 → 买2边（让胜+让负）
//    - |handicap|>=3 → 让胜+让平
//
// 2. 方向B 2串1 比分（C22）
//    - 2场 × 每场2个比分 = 4注
//    - 1低(<8) + 1中(8-15) + 1高(>15)
//    - 比分必须与方向A一致
//    - 球风→进球数：
//      * 顶级强队(德巴阿法) → 2-3球
//      * 二流(比葡荷英西奥瑞韩墨) → 1-2球
//      * 防守型(沙瑞伊) → 0-1球
//      * 弱队 → 0-1球
//      * 势均力敌 → 双方0-1球
//
// 用法:
//   node 12_r013_user_rules.js 2026-06-16         # 回测某天
//   node 12_r013_user_rules.js 2026-06-17 --predict  # 推荐今天

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ============== CLI ==============
// 用法:
//   node 12_r013_user_rules.js                          → 默认: 今日 + 预测模式
//   node 12_r013_user_rules.js --predict                → 今日 + 预测模式
//   node 12_r013_user_rules.js 2026-06-18               → 指定日期(回测, 需结果)
//   node 12_r013_user_rules.js 2026-06-18 --predict     → 指定日期预测
function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
const argv = process.argv.slice(2);
const hasDateArg = argv.some(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const PREDICT_MODE = argv.includes('--predict') || !hasDateArg; // 无日期 = 预测今日
let TARGET_DATE = hasDateArg ? argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) : todayStr();
if (!TARGET_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error('用法: node 12_r013_user_rules.js [YYYY-MM-DD] [--predict]');
  process.exit(1);
}
console.log(`[12_r013] 目标日期: ${TARGET_DATE} (${PREDICT_MODE ? '预测' : '回测'}模式)`);

const UNIT_STAKE = 2;
const VIG = 0.13;

// ============== 工具 ==============
function impliedProbs3(odds) {
  if (!odds) return null;
  const inv = { home: 1/odds.home, draw: 1/odds.draw, away: 1/odds.away };
  const sum = inv.home + inv.draw + inv.away;
  return { home: inv.home/sum, draw: inv.draw/sum, away: inv.away/sum, vig: sum - 1 };
}
function argmax3(p) {
  let m = 'home', v = p.home;
  if (p.draw > v) { m = 'draw'; v = p.draw; }
  if (p.away > v) { m = 'away'; v = p.away; }
  return m;
}
function pickLabel(key) {
  return key === 'home' ? '主胜' : key === 'draw' ? '平' : '客胜';
}
function round(x, p = 4) { return Math.round(x * 10**p) / 10**p; }
function normalizeScore(s) {
  if (typeof s !== 'string') return s;
  return s.split(':').map(p => String(Number(p))).join(':');
}
function fairProbFromOdds(odds, vig = VIG) {
  return 1 / (odds * (1 + vig));
}

// ============== 球风→进球数规则 ==============
// 球队分档(2026世界杯实力梳理): TOP夺冠级[2,3]球 / SECOND强队[1,2] / DEFENSIVE防反型[0,1] / WEAK鱼腩[0,1]
const TOP_TIER = ['德国', '巴西', '阿根廷', '法国'];
// SECOND: 传统强队 + 有顶级射手/淘汰赛级别的队(摩洛哥22年4强、哥伦比亚、塞内加尔、日本、丹麦、挪威/波兰/埃及等有射手)
const SECOND_TIER = ['比利时', '葡萄牙', '荷兰', '英格兰', '西班牙',
                    '奥地利', '瑞典', '瑞士', '韩国', '墨西哥', '克罗地亚',
                    '乌拉圭', '哥伦比亚', '摩洛哥', '美国', '日本', '塞内加尔',
                    '丹麦', '塞尔维亚', '挪威', '波兰', '埃及', '尼日利亚'];
// DEFENSIVE: 纯防守反击、低进球风格
const DEFENSIVE = ['沙特阿拉伯', '沙特', '伊朗', '突尼斯'];
// WEAK: 真·鱼腩/实力明显偏弱
const WEAK_TEAMS = ['南非', '捷克', '波黑', '巴拉圭', '海地', '库拉索',
                   '阿尔及利亚', '约旦', '新西兰', '伊拉克', '苏格兰', '土耳其',
                   '澳大利亚', '卡塔尔', '厄瓜多尔', '科特迪瓦',
                   '乌兹别克', '秘鲁', '北爱尔兰', '匈牙利',
                   '哈萨克', '冰岛', '哥斯达黎加',
                   '威尔士', '喀麦隆', '加纳', '巴拿马', '刚果(金)'];

function getTeamTier(team) {
  if (TOP_TIER.includes(team)) return 'top';
  if (SECOND_TIER.includes(team)) return 'second';
  if (DEFENSIVE.includes(team)) return 'defensive';
  if (WEAK_TEAMS.includes(team)) return 'weak';
  return 'unknown';
}

function predictGoalRange(home, away) {
  const h = getTeamTier(home);
  const a = getTeamTier(away);
  // 主队进球预测
  let homeGoals;
  if (h === 'top') homeGoals = [2, 3];
  else if (h === 'second') homeGoals = [1, 2];
  else if (h === 'defensive') homeGoals = [0, 1];
  else homeGoals = [0, 1];
  // 客队进球预测
  let awayGoals;
  if (a === 'top') awayGoals = [2, 3];
  else if (a === 'second') awayGoals = [1, 2];
  else if (a === 'defensive') awayGoals = [0, 1];
  else awayGoals = [0, 1];
  return { homeGoals, awayGoals };
}

// ============== 1.5 球风/东道/球星/上届爆冷 标签 ==============
function getTeamInfo(home, away) {
  const homeTier = getTeamTier(home);
  const awayTier = getTeamTier(away);
  let style = '';
  if (homeTier === 'top' && awayTier === 'weak') style = `${home}强势`;
  else if (homeTier === 'top' && awayTier === 'second') style = '强vs中';
  else if (homeTier === 'second' && awayTier === 'weak') style = '中vs弱';
  else if (homeTier === 'second' && awayTier === 'second') style = '中vs中';
  else if (homeTier === 'top' && awayTier === 'top') style = '强vs强';
  else if (homeTier === 'defensive' || awayTier === 'defensive') style = '防守';
  else style = '势均';
  return { homeTier, awayTier, style };
}

// ============== 1.6 上届爆冷数据库 ==============
// 简化：标记有爆冷历史的球队
const COLD_HISTORY = {
  '西班牙': '2022被日、摩爆冷',
  '德国': '2022被日本爆冷',
  '巴西': '2022被克罗爆冷',
  '阿根廷': '2022被沙特爆冷',
  '法国': '2022小组第2',
  '沙特阿拉伯': '2022爆冷胜阿根廷',
  '日本': '2022胜德胜西',
  '韩国': '2022逼平乌拉圭',
  '摩洛哥': '2022第4名',
  '荷兰': '2022被阿根廷淘汰',
  '乌拉圭': '2022未出线',
  '英格兰': '2022被法国淘汰',
  '葡萄牙': '2022被摩洛哥淘汰',
  '比利时': '2022小组出局',
  '美国': '2022平英格兰',
  '加拿大': '2022首秀',
  '卡塔尔': '2022东道首秀',
  '海地': '2022未参赛',
  '库拉索': '2022未参赛',
  '苏格兰': '2022未参赛',
  '挪威': '2022未参赛',
  '埃及': '2022未参赛',
  '新西兰': '2022未参赛',
  '波黑': '2022未参赛',
  '巴拉圭': '2022未参赛',
  '澳大利亚': '2022小组出局',
  '土耳其': '2022未参赛',
  '厄瓜多尔': '2022小组出局',
  '科特迪瓦': '2022未参赛',
  '瑞典': '2022附加赛出局',
  '捷克': '2022未参赛',
  '南非': '2022未参赛',
  '墨西哥': '2022小组出局',
  '波兰': '2022小组出局',
  '丹麦': '2022小组出局',
  '威尔士': '2022小组出局',
  '突尼斯': '2022逼平丹麦',
};

function getColdHistory(home, away) {
  const h = COLD_HISTORY[home] || '-';
  const a = COLD_HISTORY[away] || '-';
  const coldEvents = ['爆冷', '被日', '被克罗', '被沙', '胜德', '胜西', '胜阿'];
  if (coldEvents.some(e => h.includes(e))) return `${home}:${h}`;
  if (coldEvents.some(e => a.includes(e))) return `${away}:${a}`;
  if (h.startsWith('2022') && !h.includes('小组') && !h.includes('未') && !h.includes('首')) return `${home}:${h}`;
  if (a.startsWith('2022') && !a.includes('小组') && !a.includes('未') && !a.includes('首')) return `${away}:${a}`;
  return '-';
}

// ============== 1.7 球星 ==============
const STARS = {
  '法国': '姆巴佩',
  '阿根廷': '梅西',
  '挪威': '哈兰德',
  '乌拉圭': '苏亚雷斯/努涅斯',
  '葡萄牙': 'C罗',
  '英格兰': '凯恩/贝林',
  '西班牙': '亚马尔/罗德里',
  '巴西': '维尼修斯/罗德里戈',
  '荷兰': '德容/加克波',
  '比利时': '德布劳内',
  '德国': '穆勒/维尔茨',
  '沙特阿拉伯': '无',
  '韩国': '孙兴慜',
  '日本': '远藤航/三苫薰',
  '海地': '无',
  '库拉索': '无',
  '加拿大': '戴维斯',
  '美国': '普利西奇',
  '墨西哥': '希门尼斯',
  '新西兰': '无',
  '埃及': '萨拉赫',
  '瑞士': '扎卡/沙奇里',
  '波兰': '莱万',
  '丹麦': '埃里克森/霍伊伦',
  '塞尔维亚': '米神',
  '威尔士': '贝尔已退役',
  '摩洛哥': '阿什拉夫',
};

function getStar(team) {
  return STARS[team] || '无';
}

// 进球型球星集合(前锋/边锋/影锋/射手型前腰) —— 仅这些才用于"抬进球预测"
// 排除: 后腰/组织核心/后卫/已退役等非射手("有名气≠会进球")
//   扎卡(后腰)/沙奇里(替补) → 瑞士不算; 戴维斯(边卫) → 加拿大不算;
//   德布劳内(组织核心,以助攻为主) → 比利时不算; 阿什拉夫(边卫) → 摩洛哥不算; 贝尔已退役 → 威尔士不算
const SCORER_STAR_TEAMS = new Set([
  '法国', '阿根廷', '挪威', '乌拉圭', '葡萄牙', '英格兰', '西班牙', '巴西',
  '荷兰', '德国', '韩国', '日本', '美国', '墨西哥', '埃及', '波兰', '丹麦', '塞尔维亚',
]);
function hasScorerStar(team) {
  return SCORER_STAR_TEAMS.has(team) && getStar(team) !== '无';
}

// ============== 1.8 赛前分析（不看赔率）==============
// 纯球队分析：排名/是否大热/球星/伤病/上届爆冷/东道主
function preAnalysis(m) {
  const parts = [];
  const homeTier = getTeamTier(m.home);
  const awayTier = getTeamTier(m.away);
  const homeStar = getStar(m.home);
  const awayStar = getStar(m.away);
  const isHost = HOSTS[m.home] || HOSTS[m.away] || false;
  const homeCold = COLD_HISTORY[m.home] || '';
  const awayCold = COLD_HISTORY[m.away] || '';
  const hasColdHome = ['爆冷', '被日', '被克罗', '被沙', '胜德', '胜西', '胜阿'].some(e => homeCold.includes(e));
  const hasColdAway = ['爆冷', '被日', '被克罗', '被沙', '胜德', '胜西', '胜阿'].some(e => awayCold.includes(e));

  // 球队排名对比
  const tierMap = { top: 1, second: 2, defensive: 3, weak: 4 };
  if (tierMap[homeTier] < tierMap[awayTier]) parts.push(`${m.home}实力强于${m.away}`);
  else if (tierMap[homeTier] > tierMap[awayTier]) parts.push(`${m.away}实力强于${m.home}`);
  else parts.push(`${m.home}与${m.away}势均力敌`);

  // 大热赛事
  if (m.home === '德国' || m.home === '巴西' || m.home === '阿根廷' || m.home === '法国') {
    parts.push(`${m.home}是大热球队`);
  }
  if (m.away === '德国' || m.away === '巴西' || m.away === '阿根廷' || m.away === '法国') {
    parts.push(`${m.away}是大热球队`);
  }

  // 球星
  if (homeStar !== '无') parts.push(`${m.home}有球星${homeStar}`);
  if (awayStar !== '无') parts.push(`${m.away}有球星${awayStar}`);

  // 东道主
  if (HOSTS[m.home]) parts.push(`${m.home}是东道主(高概率不败)`);
  if (HOSTS[m.away]) parts.push(`${m.away}是东道主`);

  // 爆冷史
  if (hasColdHome) parts.push(`${m.home}上届有爆冷史`);
  if (hasColdAway) parts.push(`${m.away}上届有爆冷史`);

  // 大热+有球星级对手的平局风险
  if ((homeStar !== '无' || awayStar !== '无') && (homeTier === 'top' || awayTier === 'top')) {
    parts.push('双方球星对位,需防平局');
  }

  return parts.join('; ');
}
const oddsDir = path.join(PROJECT_ROOT, 'data', 'odds');
const resultsDir = path.join(PROJECT_ROOT, 'data', 'results');

const allOddsFiles = fs.readdirSync(oddsDir).filter(f => f.endsWith('.json'));
const matches = [];

// 东道主数据库（2026世界杯在美国/加拿大/墨西哥）
const HOSTS = {
  // 美国场次
  '美国': true, '加拿大': true, '墨西哥': true,
  // 2026世界杯东道主 = 上述3国
};

for (const f of allOddsFiles) {
  const oddsDoc = JSON.parse(fs.readFileSync(path.join(oddsDir, f), 'utf-8'));
  const kickoff = oddsDoc.basic?.kickoff || '';
  if (!kickoff.startsWith(TARGET_DATE)) continue;
  // 只跑世界杯正赛，剔除国际友谊赛(league==='国际赛')。回测/预测两种模式统一过滤，保证口径一致
  if (oddsDoc.basic?.league !== '世界杯') continue;
  const mid = oddsDoc.basic.mid;
  const resultPath = path.join(resultsDir, `${mid}.json`);
  const hasResult = fs.existsSync(resultPath);
  if (!PREDICT_MODE && !hasResult) continue;
  matches.push({
    mid,
    code: oddsDoc.basic.code,
    home: oddsDoc.basic.home,
    away: oddsDoc.basic.away,
    kickoff,
    handicap: oddsDoc.odds.handicap,
    spf: oddsDoc.odds.spf_latest,
    rqspf: oddsDoc.odds.rqspf_latest,
    bf: oddsDoc.odds.bf_latest,
    zjq: oddsDoc.odds.zjq_latest,
    bqc: oddsDoc.odds.bqc_latest,         // 半全场胜平负赔率
    bf_history: oddsDoc.odds.bf_history,    // 比分赔率 first vs latest
    zjq_history: oddsDoc.odds.zjq_history,  // 总进球赔率 first vs latest
    bqc_history: oddsDoc.odds.bqc_history, // 半全场赔率 first vs latest
    isHost: HOSTS[oddsDoc.basic.home] || HOSTS[oddsDoc.basic.away] || false,
    actual: hasResult ? JSON.parse(fs.readFileSync(resultPath, 'utf-8')) : null,
  });
}

console.log(`[输入] ${matches.length} 场 ${TARGET_DATE} 比赛${PREDICT_MODE ? ' (预测模式)' : ''}`);
if (matches.length === 0) process.exit(1);

// ============== 读取赔率历史并计算变化 ==============
// 返回: { rqspf:{home,draw,away}, spf:{...}, bf:{n_changed, biggest_drop, biggest_rise, deltas}, zjq:{open_min,last_min,min_shifted,deltas}, bqc:{open_min,last_min,deltas} }
function getOddsMovement(mid) {
  const p = path.join(PROJECT_ROOT, 'data', 'odds_history', mid + '.json');
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  // rqspf: 主队让球胜平负趋势
  const rqspf = data.rqspf_history || [];
  const rqspfMov = rqspf.length >= 2 ? {
    home: +(rqspf[rqspf.length - 1].home - rqspf[0].home).toFixed(2),
    draw: +(rqspf[rqspf.length - 1].draw - rqspf[0].draw).toFixed(2),
    away: +(rqspf[rqspf.length - 1].away - rqspf[0].away).toFixed(2),
  } : null;
  // spf: 主胜平负趋势
  const spf = data.spf_history || [];
  const spfMov = spf.length >= 2 ? {
    home: +(spf[spf.length - 1].home - spf[0].home).toFixed(2),
    draw: +(spf[spf.length - 1].draw - spf[0].draw).toFixed(2),
    away: +(spf[spf.length - 1].away - spf[0].away).toFixed(2),
  } : null;
  // bf: 比分赔率 first vs latest
  const bfSeries = data.bf_history || [];
  let bfMov = null;
  if (bfSeries.length >= 2) {
    const openOdds = bfSeries[0].odds || {};
    const lastOdds = bfSeries[bfSeries.length - 1].odds || {};
    const deltas = {};
    let biggestDrop = null;
    let biggestRise = null;
    for (const k of Object.keys(openOdds)) {
      if (lastOdds[k] === undefined) continue;
      const d = +(lastOdds[k] - openOdds[k]).toFixed(2);
      if (Math.abs(d) < 0.1) continue;
      deltas[k] = d;
      if (biggestDrop === null || d < biggestDrop.val) biggestDrop = { key: k, val: d };
      if (biggestRise === null || d > biggestRise.val) biggestRise = { key: k, val: d };
    }
    bfMov = {
      first_time: bfSeries[0].time,
      last_time: bfSeries[bfSeries.length - 1].time,
      n_changed: Object.keys(deltas).length,
      biggest_drop: biggestDrop,
      biggest_rise: biggestRise,
      deltas: deltas,
    };
  }
  // zjq: 总进球 first vs latest
  const zjqSeries = data.zjq_history || [];
  let zjqMov = null;
  if (zjqSeries.length >= 2) {
    const openOdds = zjqSeries[0].odds || {};
    const lastOdds = zjqSeries[zjqSeries.length - 1].odds || {};
    const deltas = {};
    for (const k of Object.keys(openOdds)) {
      if (lastOdds[k] === undefined) continue;
      const d = +(lastOdds[k] - openOdds[k]).toFixed(2);
      if (Math.abs(d) < 0.1) continue;
      deltas[k] = d;
    }
    const openMin = Object.entries(openOdds).reduce((a, b) => a[1] < b[1] ? a : b, ['', Infinity]);
    const lastMin = Object.entries(lastOdds).reduce((a, b) => a[1] < b[1] ? a : b, ['', Infinity]);
    zjqMov = {
      first_time: zjqSeries[0].time,
      last_time: zjqSeries[zjqSeries.length - 1].time,
      open_min: openMin[0],
      last_min: lastMin[0],
      min_shifted: openMin[0] !== lastMin[0],
      deltas: deltas,
    };
  }
  // bqc: 半全场 first vs latest
  const bqcSeries = data.bqc_history || [];
  let bqcMov = null;
  if (bqcSeries.length >= 2) {
    const openOdds = bqcSeries[0].odds || {};
    const lastOdds = bqcSeries[bqcSeries.length - 1].odds || {};
    const deltas = {};
    for (const k of Object.keys(openOdds)) {
      if (lastOdds[k] === undefined) continue;
      const d = +(lastOdds[k] - openOdds[k]).toFixed(2);
      if (Math.abs(d) < 0.1) continue;
      deltas[k] = d;
    }
    const openMin = Object.entries(openOdds).reduce((a, b) => a[1] < b[1] ? a : b, ['', Infinity]);
    const lastMin = Object.entries(lastOdds).reduce((a, b) => a[1] < b[1] ? a : b, ['', Infinity]);
    bqcMov = {
      first_time: bqcSeries[0].time,
      last_time: bqcSeries[bqcSeries.length - 1].time,
      open_min: openMin[0],
      last_min: lastMin[0],
      deltas: deltas,
    };
  }
  if (!rqspfMov && !spfMov && !bfMov && !zjqMov && !bqcMov) return null;
  return { rqspf: rqspfMov, spf: spfMov, bf: bfMov, zjq: zjqMov, bqc: bqcMov };
}

// ============== 2. 方向A 3串1 rqspf 选法（v3.5 赔率变化+进球能力）==============
// 核心：rqspf 赔率 + 球星/东道主/爆冷 加减分 → 比较 → 选
// 特殊保底（不让赔率牵着走）：
//   主队东道主+让1球 → 必加让胜/让平 保底
//   客队赔率<1.6 且主队有东道主+球星 → 至少买2边
// 加减分：加到赔率值上（负数=更看好=赔率变低）
//   东道主 -0.5
//   球星 -0.4
//   顶级强队 -0.3
//   爆冷史 +0.4
function pickRqspf(m) {
  const { rqspf, handicap, spf } = m;
  if (!rqspf) return null;
  const h = handicap ?? 0;

  const topTeams = ['德国', '巴西', '阿根廷', '法国'];
  const homeIsHost = HOSTS[m.home] || false;
  const awayIsHost = HOSTS[m.away] || false;
  const homeStar = getStar(m.home);
  const awayStar = getStar(m.away);
  // 能制造爆冷的球队（弱队/黑马）：日本、韩国、摩洛哥、沙特
  // 被爆冷的强队：西班牙、德国、巴西、阿根廷
  const upsetMakers = ['爆冷胜', '胜德胜西', '逼平乌拉圭', '第4名'];
  const upsetVictims = ['被日', '被克罗', '被沙特', '被摩', '被阿根廷'];
  const hasColdHome = upsetMakers.some(e => (COLD_HISTORY[m.home] || '').includes(e)) || upsetVictims.some(e => (COLD_HISTORY[m.home] || '').includes(e));
  const hasColdAway = upsetMakers.some(e => (COLD_HISTORY[m.away] || '').includes(e)) || upsetVictims.some(e => (COLD_HISTORY[m.away] || '').includes(e));
  const isTopHome = topTeams.includes(m.home);
  const isTopAway = topTeams.includes(m.away);

  // 主队综合因素
  const homeBonus =
    (homeIsHost ? -0.5 : 0) +
    (homeStar !== '无' ? -0.4 : 0) +
    (isTopHome ? -0.3 : 0) +
    (hasColdHome ? 0.4 : 0);
  const awayBonus =
    (awayIsHost ? -0.5 : 0) +
    (awayStar !== '无' ? -0.4 : 0) +
    (isTopAway ? -0.3 : 0) +
    (hasColdAway ? 0.4 : 0);

  // 调整后赔率
  const adjusted = {
    home: rqspf.home + homeBonus,
    draw: rqspf.draw,
    away: rqspf.away + awayBonus,
  };

  // 大盘口 |h|>=3
  if (Math.abs(h) >= 3) {
    if (h < 0) return { picks: ['home'], reason: `让${Math.abs(h)}球, 必买让胜` };
    else return { picks: ['away'], reason: `受让${Math.abs(h)}球, 必买让负` };
  }

  // 大盘口 |h|>=2: 买两端(让胜+让负), 避开最不可能的"正好让平"
  //   h>0 时受让方是主队(弱队), 客队是让球方(强队): 强队大概率胜, 既可能小胜(让胜)也可能大胜(让负),
  //   "正好净胜=让球数"(让平)反而最不可能 → 买让胜+让负覆盖两极, 不漏掉强队大胜.
  //   (旧"改法②"曾在 h>0&&客队有球星时改买让胜+让平, 前提搞反了——客队是让球favorite而非受让爆冷方, 已删)
  if (Math.abs(h) >= 2) {
    return { picks: ['home', 'away'], reason: `|h|>=2大盘, 买两端(让胜+让负), 避开最不可能的正好让平` };
  }

  // |h|=1: 先看 spf 定方向（不看赔率，只看球队分析），再决定买几个
  // 特殊保底规则
  const hasHomeHost = homeIsHost || (homeStar !== '无' && homeStar);
  const strongHome = homeIsHost && (homeStar !== '无');

  // 东道主+球星 → 至少买2边（让胜+让平 或 让胜+让负）
  if (strongHome) {
    if (hasColdHome || hasColdAway) {
      // 有爆冷史 → 调整后赔率最低+第二低，只买2边
      const sorted = Object.entries(adjusted).sort((a, b) => a[1] - b[1]);
      const minPick = sorted[0][0];
      const secondPick = sorted[1][0];
      return { picks: [minPick, secondPick], reason: `东道主+球星+爆冷史, 买2边(${pickLabel(minPick)}+${pickLabel(secondPick)})` };
    }
    const sorted = Object.entries(adjusted).sort((a, b) => a[1] - b[1]);
    const firstKey = sorted[0][0];
    if (firstKey === 'away') {
      return { picks: ['home', 'away'], reason: `${m.home}东道主+球星, 赔率客胜低但有东道主保底, 买2边(让胜+让负)` };
    }
    return { picks: ['home', 'draw'], reason: `${m.home}东道主+球星, 买让胜+让平` };
  }

  // 只有东道主（没球星）→ 至少让胜+让平
  if (homeIsHost) {
    if (hasColdHome) {
      const sorted = Object.entries(adjusted).sort((a, b) => a[1] - b[1]);
      const minPick = sorted[0][0];
      const secondPick = sorted[1][0];
      return { picks: [minPick, secondPick], reason: `${m.home}东道主+爆冷史, 买2边(${pickLabel(minPick)}+${pickLabel(secondPick)})` };
    }
    return { picks: ['home', 'draw'], reason: `${m.home}东道主, 买让胜+让平` };
  }

  // 主队有球星（非东道主）→ 至少保底让胜+让平，不被客胜低赔率牵着走
  if (homeStar !== '无') {
    if (hasColdHome || hasColdAway) {
      // 优化规则C：主队有爆冷史 + 客胜赔率<1.5 + 客队少大胜 → 单选让平
      if (hasColdHome && rqspf.away < 1.5) {
        return { picks: ['draw'], reason: `${m.home}有球星${homeStar}+主队爆冷史+少大胜风格, 客胜赔率<1.5极热, 单选让平@${rqspf.draw}` };
      }
      // 优化规则B：主队有球星+客队爆冷史+客胜赔率<1.6 + 调整后客胜<主胜 → 让胜+让平（防客队爆买致热）
      if (hasColdAway && rqspf.away < 1.6 && adjusted.away < adjusted.home) {
        return { picks: ['home', 'draw'], reason: `${m.home}有球星${homeStar}+客队爆冷史, 客胜<1.6极热+调整后客胜<主胜, 买让胜+让平` };
      }
      // 有爆冷史 → 调整后赔率最低+第二低，只买2边
      const sorted = Object.entries(adjusted).sort((a, b) => a[1] - b[1]);
      const minPick = sorted[0][0];
      const secondPick = sorted[1][0];
      return { picks: [minPick, secondPick], reason: `${m.home}有球星${homeStar}+${hasColdHome ? '主队' : '客队'}爆冷史, 买2边(${pickLabel(minPick)}+${pickLabel(secondPick)})` };
    }
    // 客队同为强队(top/second), 或市场明显看好客队受让(rqspf受让最低) → 强强对话/市场反向,
    // 不靠主队球星无脑押主胜不败, 改买两端(让胜+让负), 让比分也覆盖到客队不败的情形
    const awayStrong = ['top', 'second'].includes(getTeamTier(m.away));
    const mktFavorsAway = rqspf.away <= rqspf.home && rqspf.away <= rqspf.draw;
    if (awayStrong || mktFavorsAway) {
      return { picks: ['home', 'away'], reason: `${m.home}有球星${homeStar}但${awayStrong ? `客队${m.away}同为强队` : '客队受让赔率最低(市场看好)'}, 买两端(让胜+让负)` };
    }
    return { picks: ['home', 'draw'], reason: `${m.home}有球星${homeStar}, 买让胜+让平` };
  }

  // spf 主队强优势（spf.home<1.5）→ 不被 rqspf 牵着走
  if (spf && spf.home < 1.5 && h < 0) {
    if (hasColdAway) {
      // 客队有爆冷史 → 调整后赔率最低+第二低，只买2边
      const sorted = Object.entries(adjusted).sort((a, b) => a[1] - b[1]);
      const minPick = sorted[0][0];
      const secondPick = sorted[1][0];
      return { picks: [minPick, secondPick], reason: `spf主胜${spf.home}<1.5 主队强优势, 客队爆冷史, 买2边(${pickLabel(minPick)}+${pickLabel(secondPick)})` };
    }
    return { picks: ['home', 'draw'], reason: `spf主胜${spf.home}<1.5 主队强优势, 不被rqspf牵着走, 买让胜+让平` };
  }

  // spf 1.5-2.5 中间区：主队有优势但不稳，看 rqspf 差距
  if (spf && spf.home >= 1.5 && spf.home <= 2.5 && h < 0) {
    const entries = Object.entries(adjusted);
    entries.sort((a, b) => a[1] - b[1]);
    const firstKey = entries[0][0];
    // 优化规则D：spf主胜<1.8 + rqspf让胜赔率最低 → 单选让胜（让胜赔率最低=被买入）
    if (spf.home < 1.8 && firstKey === 'home' && rqspf.home < rqspf.away) {
      return { picks: ['home'], reason: `spf主胜${spf.home}<1.8+让胜赔率最低(被买入), 单选让胜@${rqspf.home}` };
    }
    // spf 方向 vs rqspf 方向矛盾 → 买2边
    const spfHome = spf.home < 2.0; // spf 说主队赢
    const rqspfAway = firstKey === 'away'; // rqspf 最低是客胜
    if (spfHome && rqspfAway) {
      // 矛盾：spf看好主队赢, rqspf最低却是客胜. 让球盘三项有序(让胜=赢2+/让平=赢恰好1/让负=不赢).
      // 此时市场在"赢多少"上拿不准 → 结果向两极分化(热门赢2+ 或 弱队顶住平/爆冷), 中间"赢1球"被挤掉.
      // 故买两端(让胜+让负), 主动避开最危险的中间档让平. (回测 016/012 两场矛盾盘实际均落在两端, 验证此打法)
      return { picks: ['home', 'away'], reason: `spf${spf.home}说主队赢但rqspf说客队矛盾, 结果易两极分化, 买两端避开让平(让胜+让负)` };
    }
    const diff = entries[1][1] - entries[0][1];
    if (diff > 1.0) {
      return { picks: [firstKey], reason: `spf${spf.home} 1.5-2.5 调整后${pickLabel(firstKey)}领先${diff.toFixed(2)}, 单选` };
    } else if (diff > 0.5) {
      const drawKey = firstKey === 'draw' ? entries[1][0] : 'draw';
      return { picks: [firstKey, drawKey], reason: `spf${spf.home} 1.5-2.5 调整后差${diff.toFixed(2)}, 买${pickLabel(firstKey)}+让平` };
    } else {
      return { picks: ['home', 'away'], reason: `spf${spf.home} 1.5-2.5 调整后差${diff.toFixed(2)}很小, 买2边` };
    }
  }

  // spf 客队优势（spf.away<2.0 或 spf.home>2.5）→ 让平+让负
  if (spf && spf.home > 2.5 && h < 0) {
    return { picks: ['draw', 'away'], reason: `spf主胜${spf.home}>2.5 客队优势, 买让平+让负` };
  }

  // 客队有球星 → 让平+让负（防客队赢）
  if (awayStar !== '无' && (h < 0 || h === 0 || h === null)) {
    // 优化规则A：客队有球星+爆冷史 + 客胜赔率<1.6（极热）+ 调整后让负<让平 → 客队让平+让负（去掉让胜）
    if ((hasColdAway || hasColdHome) && rqspf.away < 1.6 && adjusted.away < adjusted.draw) {
      return { picks: ['draw', 'away'], reason: `客队${m.away}有球星${awayStar}+爆冷史, 客胜<1.6极热, 调整后让负<让平, 买让平+让负` };
    }
    return { picks: ['draw', 'away'], reason: `客队${m.away}有球星${awayStar}, 买让平+让负` };
  }

  // 客队有球星 → 受让盘（h>0）让胜+让平
  if (awayStar !== '无' && h > 0) {
    return { picks: ['home', 'draw'], reason: `客队${m.away}有球星${awayStar}(受让盘), 买让胜+让平` };
  }

  // 其他球队：比较调整后赔率
  const entries = Object.entries(adjusted);
  entries.sort((a, b) => a[1] - b[1]);
  const [firstKey, firstVal] = entries[0];
  const [secondKey, secondVal] = entries[1];
  const diff = secondVal - firstVal;

  if (diff > 1) {
    return { picks: [firstKey], reason: `调整后 ${pickLabel(firstKey)}@${firstVal.toFixed(2)} 领先${diff.toFixed(2)}, 单选` };
  } else if (diff > 0.5) {
    const drawKey = firstKey === 'draw' ? secondKey : 'draw';
    return { picks: [firstKey, drawKey], reason: `调整后 ${pickLabel(firstKey)}@${firstVal.toFixed(2)} 略低, 加让平` };
  } else {
    return { picks: ['home', 'away'], reason: `调整后赔率差${diff.toFixed(2)}很小, 买2边(让胜+让负)` };
  }
}

// ============== 赔率变化修正 ==============
// 在定了方向后，用赔率变化来减少2边中不太可能的方向
// 规则：某方向赔率上升>0.2（被卖出），而对方稳定/下降 → 去掉该方向
function applyOddsMovement(mid, picks, rqspf) {
  const mv = getOddsMovement(mid);
  if (!mv || !mv.rqspf) return { picks, reason: '无赔率变化数据' };

  const { home: dHome, draw: dDraw, away: dAway } = mv.rqspf;
  const moves = { home: dHome, draw: dDraw, away: dAway };

  // 如果是1边，不用修正
  if (picks.length <= 1) {
    return { picks, reason: `1边不变` };
  }

  // 找赔率下降最多的（被买入的方向）
  const rising = picks.filter(p => moves[p] > 0.15);  // 上升>0.15的被卖出
  const falling = picks.filter(p => moves[p] < -0.05); // 下降的被买入

  if (rising.length > 0 && falling.length > 0) {
    // 某方向被卖出（上升）且有替代 → 去掉上升的
    return { picks: falling, reason: `赔率变化: ${rising.map(p => pickLabel(p)+'+'+moves[p]).join(',')}被卖出 → 留${falling.map(p => pickLabel(p)).join('+')}` };
  }

  // 如果2边都是上升或都是下降，不改
  return { picks, reason: `变化小不改: ${picks.map(p => pickLabel(p)+moves[p]).join(',')}` };
}

function argminOdds(odds) {
  let m = 'home', v = odds.home;
  if (odds.draw < v) { m = 'draw'; v = odds.draw; }
  if (odds.away < v) { m = 'away'; v = odds.away; }
  return m;
}

function argmaxOdds(odds) {
  let m = 'home', v = odds.home;
  if (odds.draw > v) { m = 'draw'; v = odds.draw; }
  if (odds.away > v) { m = 'away'; v = odds.away; }
  return m;
}

// ============== 3. 方向B 2串1 比分选法 ==============
function pickScores(m, direction) {
  if (!m.bf) return [];
  const { home, away } = m;
  let { homeGoals, awayGoals } = predictGoalRange(home, away);

  // 进球目标修正(只动比分进球预测, 不碰方向A/pickRqspf):
  //   ① 让球热门方抬进球: 让球favorite(受让盘h>0=客队; 让球盘h<0=主队)现实该净胜约|h|球,
  //      其进球下限至少 ≈ 对手进球下限 + |h|, 避免被弱队 tier 压成 0 球
  //   ② 球星方抬进球: getStar≠'无'(哈兰德/姆巴佩等)进球下限 +1, 防顶级射手被预测进0球
  //   上限同步抬到 >= 下限, 防区间倒挂
  const hc = m.handicap ?? 0;
  // |h|≥2 时强队侧进球上限放宽到 7(v3: 德国 7:1 这种大胜需要 cap 7 才能覆盖 7 球)
  const favIsHome = hc <= -2;
  const favIsAway = hc >= 2;
  const GOAL_CAP = 4;
  const homeCap = favIsHome ? 7 : GOAL_CAP;
  const awayCap = favIsAway ? 7 : GOAL_CAP;
  const clampRangeFav = (r, cap) => [Math.min(r[0], cap), Math.min(Math.max(r[1], r[0]), cap)];
  // ① 让球幅度抬进球: 仅大盘 |h|>=2 时抬 favorite 一侧进球下限至少 ≈ 对手下限+|h|.
  //    上限也抬到 target+2(v3放宽): 大盘热门大概率胜且可能大胜, 允许其多进球覆盖 5-7 球范围
  if (hc <= -2) {
    const target = awayGoals[0] + Math.abs(hc); // 主队让大球=主队热门
    if (homeGoals[1] < target + 2) homeGoals = [Math.max(homeGoals[0], target), target + 2];
  } else if (hc >= 2) {
    const target = homeGoals[0] + Math.abs(hc); // 客队受让大球=客队热门
    if (awayGoals[1] < target + 2) awayGoals = [Math.max(awayGoals[0], target), target + 2];
  }
  // ② 进球型球星抬进球下限+1(防顶级射手被弱队 tier 压成0球). 仅抬下限, 上限随之不倒挂.
  //    只认"进球型球星"(SCORER_STAR_TEAMS); 后腰/组织核心/后卫(扎卡/德布劳内/戴维斯等)不抬.
  if (hasScorerStar(home) && homeGoals[0] < 1) homeGoals = [1, Math.max(homeGoals[1], 1)];
  if (hasScorerStar(away) && awayGoals[0] < 1) awayGoals = [1, Math.max(awayGoals[1], 1)];
  homeGoals = clampRangeFav(homeGoals, homeCap);
  awayGoals = clampRangeFav(awayGoals, awayCap);

  const allScores = Object.entries(m.bf)
    .filter(([k, v]) => v > 1 && !/其它$/.test(k))
    .map(([k, v]) => ({ score: normalizeScore(k), odds: v, prob: fairProbFromOdds(v) }));

  const hcap = m.handicap ?? 0;

  // 真实性约束(大盘): |h|>=2 时大热门让大球, 弱势方现实里只可能平或负, 不可能净胜
  //   h>=2 (主队受让大盘): 排除"主队净胜"比分(hg>ag), 只留平/主队负
  //   h<=-2 (主队让大球, 主队是大热门): 对称排除"客队净胜"比分(hg<ag), 只留主胜/平
  //   h==±1 不受此约束(受让1的弱队可以赢, 如科特迪瓦 1:0)
  let realScores = allScores;
  if (hcap >= 2) {
    const kept = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg <= ag; });
    if (kept.length > 0) realScores = kept; // 兜底: 砍空则不砍
  } else if (hcap <= -2) {
    const kept = allScores.filter(s => { const [hg, ag] = s.score.split(':').map(Number); return hg >= ag; });
    if (kept.length > 0) realScores = kept;
  }

  // 方案A: 按"让球后净胜差"筛真实比分(符号与脚本 handicapResult 一致: adjustedHome = homeScore + handicap)
  //   direction 来自方向A的让球胜平负方向; 受让盘(h>0,主队受让)时, "让胜"真实比分=主队小负/平/赢
  //   rqspf pick 是几边(如让胜+让平), 比分就覆盖几边: 满足任一被选方向即保留, 不漏掉另一半.
  const dirs = Array.isArray(direction) ? direction : [direction];
  const matchDir = (dir, adj, ag) =>
    dir === 'home' ? adj > ag : dir === 'draw' ? adj === ag : dir === 'away' ? adj < ag : false;
  const filtered = realScores.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    const adj = hg + hcap; // 让球后主队净胜差
    return dirs.some(dir => matchDir(dir, adj, ag));
  });

  // 按球风→进球数筛选(同时参考主队 homeGoals 和客队 awayGoals; 默认留 +1 容差)
  // 弱队(weak tier)且无进球型球星 + 大盘受让方(|h|>=2 被让大球) -> 进球数硬封顶(容差0),
  //   防止大热门让2球时弱队被预测进2+球(如伊拉克受让2 不可能 2:2).
  //   仅限大盘: |h|<=1 的接近盘弱队小爆进2合理(如澳大利亚受让1 实际2:0), 不封顶.
  const homeTol = (getTeamTier(home) === 'weak' && !hasScorerStar(home) && hc >= 2) ? 0 : 1;
  const awayTol = (getTeamTier(away) === 'weak' && !hasScorerStar(away) && hc <= -2) ? 0 : 1;
  const inRange = (g, range, tol) => (g >= range[0] && g <= range[1] + tol);
  const styleFiltered = filtered.filter(s => {
    const [hg, ag] = s.score.split(':').map(Number);
    return inRange(hg, homeGoals, homeTol) && inRange(ag, awayGoals, awayTol);
  });

  // 兜底: 加 awayGoals 后若清空, 退回只卡主队维度; 再空则退回纯方向 filtered
  const styleFallback = styleFiltered.length > 0
    ? styleFiltered
    : filtered.filter(s => inRange(Number(s.score.split(':')[0]), homeGoals, homeTol));
  const candidates = styleFallback.length > 0 ? styleFallback : filtered;
  if (candidates.length === 0) return [];

  // 分3档(用户口径): 低档 <8, 中/高档均 >8 (赔率正好=8 不接受, 两档都不收 → 丢弃).
  //   中/高分界 HIGH_MIN 可调(环境变量 R013_HIGH_MIN). 默认18: 16场回测扫描显示 17~18 时比分3中1最高(9/16, 优于15的8/16).
  const HIGH_MIN = Number(process.env.R013_HIGH_MIN || 18);
  let low = candidates.filter(s => s.odds < 8).sort((a, b) => a.odds - b.odds);
  let mid = candidates.filter(s => s.odds > 8 && s.odds <= HIGH_MIN).sort((a, b) => a.odds - b.odds);
  let high = candidates.filter(s => s.odds > HIGH_MIN).sort((a, b) => a.odds - b.odds);

  // 容错：如果某档空，从相邻档借
  if (mid.length === 0) {
    if (low.length >= 2) {
      mid = low.splice(1, 1);  // 从low借一个
    } else if (high.length > 0) {
      mid = high.splice(0, 1);  // 从high借一个最低的
    }
  }
  if (high.length === 0) {
    if (mid.length >= 2) {
      high = mid.splice(-1, 1);  // 从mid借一个最高的
    } else if (low.length > 0) {
      high = low.splice(-1, 1);  // 从low借一个最高的
    }
  }
  if (low.length === 0) {
    if (mid.length > 0) {
      low = mid.splice(0, 1);
    } else if (high.length > 0) {
      low = high.splice(0, 1);
    }
  }

  // 每档选1个: 不再取"最低赔", 而是取"最符合球风+方向"的比分
  // 度量: 按 direction 定球风目标比分 target=(hT,aT) —
  //   home(让胜): 主队取进球区间上限多进、客队取下限少进 -> (homeGoals[1], awayGoals[0])
  //   away(让负): 反之 -> (homeGoals[0], awayGoals[1])
  //   draw(让平): 各取区间中点
  // 贴合度 D = |hg-hT| + |ag-aT|, D 越小越符合; D 相同再用赔率(更低=市场更看好)做 tie-break.
  // (只用 predictGoalRange 球风锚 + 让球方向, 不偷看实际结果)
  const primary = dirs[0];
  let hT, aT;
  if (primary === 'home') { hT = homeGoals[1]; aT = awayGoals[0]; }
  else if (primary === 'away') { hT = homeGoals[0]; aT = awayGoals[1]; }
  else { hT = (homeGoals[0] + homeGoals[1]) / 2; aT = (awayGoals[0] + awayGoals[1]) / 2; }

  // v4 —— 核心思路（用户洞察 + 数据验证）：
  //   1. zjq 先读，给一个 "基础进球档位"（2-3 球通常最准，0/1/4/7+ 都不可靠）
  //   2. 球风组合 做"向上修正器"：zjq 唯一的系统性错误是"低估大球" —— 对以下场景要上调进球上限
  //      a) |h| ≥ 2 且强队有进球型球星 → 强队大胜 +3
  //      b) 双方都有进球型球星（荷兰+日本、法国+塞内加尔） → +2
  //      c) 中强队 vs 弱防守队（瑞典vs突尼斯、奥地利vs约旦） → +2
  //   3. 大球场景下：zjq 只罚低于 zjqMode 的（保持对"过于保守"0球的惩罚），对高进球比分不罚或轻罚
  //   4. 小球场景下：保持 zjq 原始档位不变
  const zjqW = Number(process.env.R013_ZJQ_W ?? 1);
  let zjqMode = null;
  if (m.zjq && zjqW > 0) {
    const ents = Object.entries(m.zjq).map(([k, v]) => ({ t: k === '7+' ? 7 : Number(k), odds: v })).filter(e => e.odds > 1 && !Number.isNaN(e.t));
    if (ents.length) zjqMode = ents.sort((a, b) => a.odds - b.odds)[0].t;
  }
  // zjq 小球(≤3)保留；≥4 按 v3 不强行过滤（因为 zjq≥4 本身就是庄家对大球有疑虑的信号）
  let zjqStrict = zjqMode != null && zjqMode <= 3;  // 用一个 boolean 控制是否启用"小球罚分"

  // ===== v4: 球风+让球 决定"进球上限上调量 goalUplift" =====
  const hTier = getTeamTier(m.home), aTier = getTeamTier(m.away);
  const homeHasStar = hasScorerStar(m.home);
  const awayHasStar = hasScorerStar(m.away);
  // 中强队 vs 弱防守：主队 is "强/中"且有进球能力，客队 tier='weak' 且无 star —— 反之亦然
  const homeIsWeak = hTier === 'weak' && !homeHasStar;
  const awayIsWeak = aTier === 'weak' && !awayHasStar;

  let goalUplift = 0;   // 对目标进球上限的上调量
  let bigBallBoost = 0; // 对 fitCost 中 zjq 大球惩罚的减免

  // 规则 a) |h|≥2 且 强队有进球型球星
  if (Math.abs(hc) >= 2) {
    const strongTeam = hc <= -2 ? m.home : m.away;
    const strongHasStar = hasScorerStar(strongTeam);
    goalUplift = Math.max(goalUplift, strongHasStar ? 3 : 2);
    bigBallBoost = Math.max(bigBallBoost, strongHasStar ? 2 : 1);
  }
  // 规则 b) 双方都有进球型球星
  if (homeHasStar && awayHasStar) {
    goalUplift = Math.max(goalUplift, 2);
    bigBallBoost = Math.max(bigBallBoost, 1);
  }
  // 规则 c) 中强队 vs 弱防守队
  if ((hTier !== 'weak' && awayIsWeak) || (aTier !== 'weak' && homeIsWeak)) {
    if (Math.abs(hc) < 2) { // |h|≥2 已覆盖
      goalUplift = Math.max(goalUplift, 2);
      bigBallBoost = Math.max(bigBallBoost, 1);
    }
  }

  // bqc 信号沿用 v3
  const bqcHotUpset = m.bqc && ((m.bqc['胜胜'] && m.bqc['胜胜'] < 1.5) || (m.bqc['负负'] && m.bqc['负负'] < 1.5));
  let bqcHomeBonus = 0, bqcAwayBonus = 0, bqcUpsetBonus = 0;
  if (m.bqc) {
    const ss = m.bqc['胜胜'];
    const ff = m.bqc['负负'];
    if (ss && ss < 2.0) bqcHomeBonus = 1;
    else if (ff && ff < 2.0) bqcAwayBonus = 1;
    if ((ss && ss < 1.5) || (ff && ff < 1.5)) bqcUpsetBonus = 1;
  }

  // 应用 bqc + goalUplift 到 hT/aT
  // v4: hT/aT 额外 + goalUplift（只往"增加"方向，不压低）
  if (bqcHomeBonus > 0 && primary !== 'away') {
    hT = Math.min(hc <= -2 ? homeGoals[1] + 1 : homeGoals[1], homeCap);
    aT = Math.max(0, aT - 0.5);
  } else if (bqcAwayBonus > 0 && primary !== 'home') {
    aT = Math.min(hc >= 2 ? awayGoals[1] + 1 : awayGoals[1], awayCap);
    hT = Math.max(0, hT - 0.5);
  }
  if (bqcUpsetBonus > 0) {
    hT = Math.max(1, Math.min(hT - 1, 2));
    aT = Math.max(0, Math.min(aT, 2));
  }
  // v4 关键: goalUplift 上调目标进球（仅主方向一侧，不强制对手进球=0）
  if (goalUplift > 0 && primary !== 'draw') {
    if (primary === 'home' && hc <= 0) hT = Math.min(hT + goalUplift, homeCap);
    else if (primary === 'away' && hc >= 0) aT = Math.min(aT + goalUplift, awayCap);
    else {
      // 非传统让球方向（受让的主胜/让负）→ 两个方向都上调一点
      hT = Math.min(hT + Math.ceil(goalUplift / 2), homeCap);
      aT = Math.min(aT + Math.ceil(goalUplift / 2), awayCap);
    }
  }
  const fitCost = (s) => {
    const [h, a] = s.score.split(':').map(Number);
    const styleD = Math.abs(h - hT) + Math.abs(a - aT);
    // v4: zjq 罚分只对"过低进球"起作用（防止全是 0:0 1:0）；
    //    若 bigBallBoost>0，高进球比分（h+a > zjqMode）不罚或轻罚
    let zjqD = 0;
    if (zjqMode != null) {
      const total = h + a;
      if (total < zjqMode - 1) zjqD = zjqW * (zjqMode - 1 - total); // 罚保守
      else if (total > zjqMode + 1) {
        // 高进球: 若有 bigBallBoost，减免惩罚
        zjqD = zjqW * Math.max(0, (total - zjqMode - 1) - bigBallBoost);
      }
    }
    // bqc bonus 沿用 v3
    let bqcD = ((bqcHomeBonus > 0 && h < 2) ? 2 : 0) + ((bqcAwayBonus > 0 && a < 2) ? 2 : 0);
    if (bqcUpsetBonus > 0 && h === a && h <= 2) bqcD = -1;
    return styleD + zjqD + bqcD;
  };
  const bestFit = (bucket) => {
    if (!bucket.length) return null;
    return bucket.slice().sort((x, y) => fitCost(x) - fitCost(y) || x.odds - y.odds)[0];
  };

  // 按真实赔率重新打 tier 标签(借档可能把分数挪进异名桶, 标签须以自身赔率为准, 不沿用借入桶名):
  //   低 <8 / 中 (8,HIGH_MIN] / 高 >HIGH_MIN. 去重(借档可能选到同一分数).
  const tierOf = (o) => (o < 8 ? 'low' : o <= HIGH_MIN ? 'mid' : 'high');
  const dFit = (s) => fitCost(s);
  const picks = [];
  const seen = new Set();
  for (const p of [bestFit(low), bestFit(mid), bestFit(high)]) {
    if (p && !seen.has(p.score)) { seen.add(p.score); picks.push({ ...p, tier: tierOf(p.odds) }); }
  }
  // 不足3个时回填到3个: 先从球风候选池补, 不够再从"方向过滤全池"(filtered: 只认让球方向+真实性, 放宽球风上限)补.
  //   方向是硬约束(必须与所买让球方向一致), 球风只是软偏好 → 保证始终给满3个比分(候选总数≥3时).
  if (picks.length < 3) {
    const pools = [candidates, filtered];
    for (const pool of pools) {
      if (picks.length >= 3) break;
      const rest = pool.filter(s => !seen.has(s.score)).sort((x, y) => dFit(x) - dFit(y) || x.odds - y.odds);
      for (const s of rest) {
        if (picks.length >= 3) break;
        seen.add(s.score); picks.push({ ...s, tier: tierOf(s.odds) });
      }
    }
  }
  picks.sort((a, b) => a.odds - b.odds); // 按赔率升序展示(低→高)
  return picks;
}

// ============== 4. 为每场比赛生成 picks ==============
for (const m of matches) {
  const rqspfPick = pickRqspf(m);

  // 赔率变化修正：基于历史赔率变动方向优化
  // 规则：让球盘市场方向往往是错的（庄家利用"热门赢"心理），应反向解读
  // |h|<1（无让球）：正常解读：下降=被买入=实际结果
  // h=1或h=2（主队受让）：反向解读：下降=庄家诱饵，避开
  // h=-1（主队让球）：正常解读
  const mv = getOddsMovement(m.mid);
  let finalPicks = rqspfPick;
  if (rqspfPick?.picks?.length >= 2 && mv && mv.rqspf) {
    const h_abs = Math.abs(m.handicap || 0);
    const { home: dHome, draw: dDraw, away: dAway } = mv.rqspf;
    const moves = { home: dHome, draw: dDraw, away: dAway };
    const { picks: origPicks, reason: origReason } = rqspfPick;

    // h=1或h=2（主队受让盘）：赔率变化反向解读
    if ((m.handicap || 0) > 0) {
      // 改法①: 客队(受让方)有球星 → 不做单边收窄, 维持双边覆盖
      //         (避免把哈兰德这类"受让热门+有球星"的场被反向解读一刀切成主胜)
      const awayStarGuard = getStar(m.away);
      if (awayStarGuard !== '无') {
        // 维持 origPicks 双边, 不收窄
      } else {
        // 按终盘-初盘移动量降序：移动较强(上升)边=庄家卖出=实际可能，移动较弱边=相对被买入=诱饵
        const sortedByRise = origPicks.slice().sort((a, b) => moves[b] - moves[a]);
        const risingPick = sortedByRise[0]; // 移动较强（庄家卖出=实际可能）→ 保留
        const fallingPick = sortedByRise[1]; // 移动较弱（相对被买入=诱饵）→ 避开

        // 条件：两边移动差 >0.2 → 去掉诱饵(移动较弱方)，保留可能被卖出的
        if (Math.abs(moves[risingPick] - moves[fallingPick]) > 0.2) {
          finalPicks = { picks: [risingPick], reason: `${origReason} | 让球盘反向:↓${fallingPick}${moves[fallingPick]}是庄家诱饵,↑${risingPick}${moves[risingPick]}被卖出=实际可能 → 单选${risingPick}@${m.rqspf[risingPick]}` };
        }
      }
    }
    // |h|<1（无让球）或h<0（主队让球）：正常解读
    else if (h_abs < 1) {
      const sortedByDecline = origPicks.slice().sort((a, b) => moves[a] - moves[b]);
      const fallingPick = sortedByDecline[0];
      const risingPick = sortedByDecline[1];

      if (moves[fallingPick] < -0.2 && moves[risingPick] >= 0) {
        finalPicks = { picks: [fallingPick], reason: `${origReason} | 赔率变化:${fallingPick}↓${moves[fallingPick]}被买入,${risingPick}↑${moves[risingPick]}被卖出 → 单选${fallingPick}@${m.rqspf[fallingPick]}` };
      }
      else if (moves[fallingPick] < 0 && moves[risingPick] > 0 && (moves[risingPick] - moves[fallingPick]) > 0.3) {
        finalPicks = { picks: [fallingPick], reason: `${origReason} | 赔率变化:降${fallingPick}↓${moves[fallingPick]}vs升${risingPick}↑${moves[risingPick]}, 差${(moves[risingPick] - moves[fallingPick]).toFixed(2)} → 单选${fallingPick}@${m.rqspf[fallingPick]}` };
      }
    }
  }

  m.rqspfPick = finalPicks;

  // 根据 rqspf 选法确定主方向
  let direction = 'draw';
  if (finalPicks?.picks.includes('home')) direction = 'home';
  else if (finalPicks?.picks.includes('away') && !finalPicks.picks.includes('home')) direction = 'away';
  else if (finalPicks?.picks.includes('draw') && finalPicks.picks.length === 1) direction = 'draw';
  else if (finalPicks?.picks.includes('home') && finalPicks.picks.includes('draw')) direction = 'home';

  m.direction = direction; // 展示用主方向
  // 比分覆盖 rqspf 实际所选的全部方向(如让胜+让平), 主方向(direction)排首位用于 bestFit 锚定
  const bfDirs = finalPicks?.picks?.length
    ? [direction, ...finalPicks.picks.filter(p => p !== direction)]
    : [direction];
  m.bfPicks = pickScores(m, bfDirs);
}

// ============== 5. 实际结果（回测模式）==============
for (const m of matches) {
  if (!m.actual) {
    m.actualSummary = null;
    continue;
  }
  const { homeScore, awayScore } = m.actual;
  const total = homeScore + awayScore;
  let actualWinner;
  if (homeScore > awayScore) actualWinner = 'home';
  else if (homeScore < awayScore) actualWinner = 'away';
  else actualWinner = 'draw';
  let actualHandicapResult = null;
  if (m.handicap !== null && m.handicap !== undefined) {
    const adjustedHome = homeScore + m.handicap;
    if (adjustedHome > awayScore) actualHandicapResult = 'home_win';
    else if (adjustedHome < awayScore) actualHandicapResult = 'away_win';
    else actualHandicapResult = 'draw';
  }
  m.actualSummary = {
    score: `${homeScore}:${awayScore}`,
    winner: actualWinner,
    handicapResult: actualHandicapResult,
  };
}

// ============== 6. 方向B 2串1 组合 ==============
const directionB = { pairs_2x1: [] };
for (let i = 0; i < matches.length; i++) {
  for (let j = i + 1; j < matches.length; j++) {
    const m1 = matches[i], m2 = matches[j];
    // 方向B(比分2串1博高赔): 每腿赔率必须 >8, 低档(<8)不入串. 每场取 >8 里 prob 最高的前2个.
    const legs1 = m1.bfPicks.filter(p => p.odds > 8).sort((a, b) => b.prob - a.prob).slice(0, 2);
    const legs2 = m2.bfPicks.filter(p => p.odds > 8).sort((a, b) => b.prob - a.prob).slice(0, 2);
    if (legs1.length < 1 || legs2.length < 1) continue;
    const p1s = legs1, p2s = legs2;
    for (const p1 of p1s) {
      for (const p2 of p2s) {
        const totalOdds = round(p1.odds * p2.odds);
        if (totalOdds < 16 || totalOdds > 144) continue;
        directionB.pairs_2x1.push({
          a: { mid: m1.mid, code: m1.code, play: 'bf', pick: p1.score, tier: p1.tier, odds: p1.odds },
          b: { mid: m2.mid, code: m2.code, play: 'bf', pick: p2.score, tier: p2.tier, odds: p2.odds },
          totalOdds,
        });
      }
    }
  }
}
directionB.pairs_2x1.sort((a, b) => b.totalOdds - a.totalOdds);
directionB.pairs_2x1 = directionB.pairs_2x1.slice(0, 4);

// ============== 7. 方向A 3串1 组合 ==============
const directionA = { parlays_3x1: [] };
// 每场展开 rqspfPick.picks 多个pick，组合3串1
const rqspfOptions = matches.filter(m => m.rqspfPick).map(m => ({
  mid: m.mid, code: m.code, play: 'rqspf',
  picks: m.rqspfPick.picks.map(p => ({
    pick: p, pickLabel: pickLabel(p), odds: m.rqspf[p],
  })),
}));
if (rqspfOptions.length >= 3) {
  // 3场组合（每场选1个pick）
  for (let i = 0; i < rqspfOptions.length; i++) {
    for (let j = i + 1; j < rqspfOptions.length; j++) {
      for (let k = j + 1; k < rqspfOptions.length; k++) {
        const m1 = rqspfOptions[i], m2 = rqspfOptions[j], m3 = rqspfOptions[k];
        for (const p1 of m1.picks) {
          for (const p2 of m2.picks) {
            for (const p3 of m3.picks) {
              const totalOdds = round(p1.odds * p2.odds * p3.odds);
              if (totalOdds < 8 || totalOdds > 50) continue;
              directionA.parlays_3x1.push({
                picks: [
                  { mid: m1.mid, code: m1.code, play: 'rqspf', pick: p1.pick, pickLabel: p1.pickLabel, odds: p1.odds },
                  { mid: m2.mid, code: m2.code, play: 'rqspf', pick: p2.pick, pickLabel: p2.pickLabel, odds: p2.odds },
                  { mid: m3.mid, code: m3.code, play: 'rqspf', pick: p3.pick, pickLabel: p3.pickLabel, odds: p3.odds },
                ],
                totalOdds,
              });
            }
          }
        }
      }
    }
  }
}
directionA.parlays_3x1.sort((a, b) => b.totalOdds - a.totalOdds);
directionA.parlays_3x1 = directionA.parlays_3x1.slice(0, 3);

// ============== 8. 输出表格 ==============
function printTable(matches, targetDate, mode) {
  const rows = [];
  for (const m of matches) {
    const info = getTeamInfo(m.home, m.away);
    const spfStr = m.spf ? `${m.spf.home}/${m.spf.draw}/${m.spf.away}` : '-';
    const rqspfStr = m.rqspf ? `${m.rqspf.home}/${m.rqspf.draw}/${m.rqspf.away}` : '-';

    // rqspf 预测
    const rqspfPred = m.rqspfPick?.picks.map(p => `${pickLabel(p)}@${m.rqspf[p]}`).join('+') || '-';

    // 比分预测: 展示全部 bfPicks(按赔率升序), 不再固定低/中/高三格(允许2中档/无高档等情形全部列出)
    const tierCN = { low: '低', mid: '中', high: '高' };
    const bfStr = m.bfPicks.length
      ? m.bfPicks.map(p => `${p.score}@${p.odds}(${tierCN[p.tier]})`).join(' | ')
      : '-';

    // 命中检查
    let rqspfHit = '-';
    let bfHit = '-';
    if (!PREDICT_MODE && m.actualSummary) {
      // rqspf 命中
      const r = m.actualSummary.handicapResult || m.actualSummary.winner;
      const rqMap = { home_win: 'home', away_win: 'away', draw: 'draw', home: 'home', away: 'away' };
      const actualRq = rqMap[r];
      if (m.rqspfPick && actualRq) {
        rqspfHit = m.rqspfPick.picks.includes(actualRq) ? '✅' : '❌';
      }
      // bf 命中（3中1即可）
      const actualScore = m.actualSummary.score;
      const hitBf = m.bfPicks.find(p => normalizeScore(p.score) === normalizeScore(actualScore));
      bfHit = hitBf ? `✅${hitBf.score}` : '❌';
    }

    rows.push({
      code: m.code,
      match: `${m.home}vs${m.away}`,
      h: m.handicap,
      spf: spfStr,
      rqspf: rqspfStr,
      style: info.style,
      host: m.isHost ? '东' : '-',
      star: getStar(m.home),
      cold: getColdHistory(m.home, m.away),
      preAnalysis: preAnalysis(m),
      direction: pickLabel(m.direction),
      rqspfPred,
      bfPred: bfStr,
      actual: m.actualSummary?.score || '-',
      rqspfHit,
      bfHit,
    });
  }

  // 输出表格
  console.log(`\n# R-013 ${mode} 报告 (${targetDate})\n`);
  console.log('| 场次 | 主vs客 | h | spf(主/平/客) | rqspf(让/平/受) | 球风 | 东道 | 球星 | 上届爆冷 | 赛前分析 | 方向 | rqspf预测 | 比分预测(低\|中\|高) | 实际 | rqspf命中 | 比分命中(3中1) |');
  console.log('|------|--------|---|---------------|------------------|------|------|------|----------|----------|------|-----------|----------------------|------|----------|-----------------|');
  for (const r of rows) {
    console.log(`| ${r.code} | ${r.match} | ${r.h} | ${r.spf} | ${r.rqspf} | ${r.style} | ${r.host} | ${r.star} | ${r.cold} | ${r.preAnalysis} | ${r.direction} | ${r.rqspfPred} | ${r.bfPred} | ${r.actual} | ${r.rqspfHit} | ${r.bfHit} |`);
  }
}

if (PREDICT_MODE) {
  printTable(matches, TARGET_DATE, '预测');
  console.log('\n## 方向A 3串1 (rqspf)');
  for (const p of directionA.parlays_3x1) {
    console.log(`- ${p.picks.map(x => `${x.code}:${x.pickLabel}@${x.odds}`).join(' × ')} = ${p.totalOdds}`);
  }
  console.log('\n## 方向B 2串1 比分 (C22)');
  for (const p of directionB.pairs_2x1) {
    console.log(`- ${p.a.code}:${p.a.pick}@${p.a.odds}(${p.a.tier}) × ${p.b.code}:${p.b.pick}@${p.b.odds}(${p.b.tier}) = ${p.totalOdds}`);
  }
  // 预测模式也写产物（便于自动化读取）
  const report = {
    generated_at: new Date().toISOString(),
    target_date: TARGET_DATE,
    mode: 'predict',
    source: `data/odds/<mid>.json (${matches.length} 场)`,
    algorithm: 'R-013 用户规则 v2 (2026-06-17 表格化版)',
    matches: matches.map(m => ({
      mid: m.mid, code: m.code, home: m.home, away: m.away,
      handicap: m.handicap, spf: m.spf, rqspf: m.rqspf,
      style: getTeamInfo(m.home, m.away).style,
      star: getStar(m.home),
      cold: getColdHistory(m.home, m.away),
      pre_analysis: m.rqspfPick?.reason,
      direction: m.direction,
      rqspf_picks: m.rqspfPick,
      bf_picks: m.bfPicks,
    })),
    direction_a: { parlays_3x1: directionA.parlays_3x1 },
    direction_b: { pairs_2x1: directionB.pairs_2x1 },
  };
  const reportPath = path.join(PROJECT_ROOT, 'modeling', 'artifacts', `predict_r013_${TARGET_DATE}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n报告写入: ${reportPath}`);
  process.exit(0);
}

printTable(matches, TARGET_DATE, '回测');

// 命中统计
let rqHit = 0, bfHit = 0, total = 0;
for (const m of matches) {
  if (!m.actualSummary) continue;
  total++;
  const r = m.actualSummary.handicapResult || m.actualSummary.winner;
  const rqMap = { home_win: 'home', away_win: 'away', draw: 'draw', home: 'home', away: 'away' };
  const actualRq = rqMap[r];
  if (m.rqspfPick && actualRq && m.rqspfPick.picks.includes(actualRq)) rqHit++;
  const actualScore = m.actualSummary.score;
  if (m.bfPicks.find(p => normalizeScore(p.score) === normalizeScore(actualScore))) bfHit++;
}
console.log(`\n## 汇总`);
console.log(`- 总场数: ${total}`);
console.log(`- rqspf 命中: ${rqHit}/${total} = ${total ? Math.round(rqHit/total*100) : 0}%`);
console.log(`- 比分命中(3中1): ${bfHit}/${total} = ${total ? Math.round(bfHit/total*100) : 0}%`);

// 方向A 3串1 命中
let aHit = 0;
for (const p of directionA.parlays_3x1) {
  let allHit = true;
  for (const pp of p.picks) {
    const m = matches.find(mm => mm.mid === pp.mid);
    if (!m?.actualSummary) { allHit = false; break; }
    const r = m.actualSummary.handicapResult || m.actualSummary.winner;
    const rqMap = { home_win: 'home', away_win: 'away', draw: 'draw', home: 'home', away: 'away' };
    const actualRq = rqMap[r];
    if (!(pp.pick === actualRq)) allHit = false;
  }
  if (allHit) aHit++;
}
console.log(`- 方向A 3串1 命中: ${aHit}/${directionA.parlays_3x1.length}`);

// 方向B 2串1 命中
let bHit = 0;
for (const p of directionB.pairs_2x1) {
  const m1 = matches.find(m => m.mid === p.a.mid);
  const m2 = matches.find(m => m.mid === p.b.mid);
  const hit1 = normalizeScore(p.a.pick) === normalizeScore(m1.actualSummary?.score);
  const hit2 = normalizeScore(p.b.pick) === normalizeScore(m2.actualSummary?.score);
  if (hit1 && hit2) bHit++;
}
console.log(`- 方向B 2串1 命中: ${bHit}/${directionB.pairs_2x1.length}`);

// 写入报告
const report = {
  generated_at: new Date().toISOString(),
  target_date: TARGET_DATE,
  source: `data/odds/<mid>.json (${matches.length} 场)`,
  algorithm: 'R-013 用户规则 v2 (2026-06-17 表格化版)',
  summary: {
    total,
    rqspf_hit: `${rqHit}/${total}`,
    bf_hit: `${bfHit}/${total}`,
    direction_a_3x1: `${aHit}/${directionA.parlays_3x1.length}`,
    direction_b_2x1: `${bHit}/${directionB.pairs_2x1.length}`,
  },
  matches: matches.map(m => ({
    mid: m.mid, code: m.code, home: m.home, away: m.away,
    handicap: m.handicap, spf: m.spf, rqspf: m.rqspf,
    style: getTeamInfo(m.home, m.away).style,
    star: getStar(m.home),
    cold: getColdHistory(m.home, m.away),
    pre_analysis: m.rqspfPick?.reason,
    direction: m.direction,
    rqspf_picks: m.rqspfPick,
    bf_picks: m.bfPicks,
    actual: m.actualSummary,
  })),
  direction_a: { parlays_3x1: directionA.parlays_3x1 },
  direction_b: { pairs_2x1: directionB.pairs_2x1 },
};
const reportPath = path.join(PROJECT_ROOT, 'modeling', 'artifacts', `backtest_r013_${TARGET_DATE}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(`\n报告写入: ${reportPath}`);
