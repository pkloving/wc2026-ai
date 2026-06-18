// scripts/build_teams_data.js
// 作用：
//   读取 data/teams.json / data/matches.json / data/groups.json / data/matches_status.json / data/results/*.json
//   以及 modeling 脚本里的写死知识（队伍分档、球星、上届爆冷、东道主）
//   为每个参赛队伍生成 data/teams/{CODE}.json，并生成 data/teams/_index.json
//
// 用法:
//   node scripts/build_teams_data.js
//
// JSON schema (每队一个文件):
// {
//   "code": "ARG",
//   "name": "阿根廷",
//   "nameEn": "Argentina",
//   "confederation": "CONMEBOL",
//   "flag": "🇦🇷",
//   "color": "#75AADB",
//   "meta": {
//     "tier": "top",              // top | second | defensive | weak | unknown
//     "style": "传控/强攻",         // 人工经验描述
//     "stars": ["梅西"],           // 球星列表
//     "has_scorer_star": true,    // 是否有"进球型"球星
//     "is_host": false,           // 2026 东道主？
//     "fifa_rank": null           // FIFA 排名，暂无则留空
//   },
//   "history_wc2022": {
//     "description": "2022冠军",   // 总体描述
//     "cold_history": "2022被沙特爆冷"  // 爆冷史
//   },
//   "wc2026": {
//     "group": "A",               // 所在小组，小组赛后为 null
//     "stage": "group",           // group | knockout_16 | quarter_final | semi_final | final | eliminated
//     "standings": {
//       "position": 1,
//       "played": 3,
//       "win": 3,
//       "draw": 0,
//       "lose": 0,
//       "gf": 6,
//       "ga": 0,
//       "gd": 6,
//       "pts": 9
//     },
//     "matches": [
//       {
//         "mid": "2040162",
//         "match_id": "M001",
//         "stage": "group",
//         "group": "A",
//         "date": "2026-06-11T19:00:00Z",
//         "role": "home",           // home | away
//         "opponent_code": "RSA",
//         "opponent_name": "南非",
//         "status": "finished",
//         "score_my": 2,
//         "score_opp": 0,
//         "half_my": 1,
//         "half_opp": 0,
//         "result": "win"           // win | draw | lose
//       },
//       ...
//     ]
//   },
//   "_updated_at": "2026-06-17Txx:xx:xxZ"
// }
//
// _index.json schema:
// {
//   "generated_at": "...",
//   "total_teams": 48,
//   "by_code": { "ARG": "teams/ARG.json", ... },
//   "by_name": { "阿根廷": "ARG", ... },
//   "by_group": { "A": ["MEX","RSA","KOR","CZE"], ... },
//   "by_tier": { "top": [...], "second": [...], "defensive": [...], "weak": [...] },
//   "hosts": ["USA","CAN","MEX"],
//   "name_to_code_variants": { "沙特": "KSA", "沙特阿拉伯": "KSA", ... }
// }
//

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const TEAMS_DIR = path.join(DATA_DIR, 'teams');

// 确保目录存在
if (!fs.existsSync(TEAMS_DIR)) fs.mkdirSync(TEAMS_DIR, { recursive: true });

// ============== 读取基础数据 ==============
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const teamsBase = readJson(path.join(DATA_DIR, 'teams.json'));
const matches = readJson(path.join(DATA_DIR, 'matches.json'));
const groups = readJson(path.join(DATA_DIR, 'groups.json'));
const matchesStatus = readJson(path.join(DATA_DIR, 'matches_status.json'));

// ============== 静态知识（从 12_r013_user_rules.js 提取）==============
// 注意：这里用中文队名做 key；下方会通过 teamsBase 的中文名映射到 code

// 队伍分档（中文名）
const TOP_TIER_ZH = ['德国', '巴西', '阿根廷', '法国'];
const SECOND_TIER_ZH = ['比利时', '葡萄牙', '荷兰', '英格兰', '西班牙',
  '奥地利', '瑞典', '瑞士', '韩国', '墨西哥', '克罗地亚',
  '乌拉圭', '哥伦比亚', '摩洛哥', '美国', '日本', '塞内加尔',
  '丹麦', '塞尔维亚', '挪威', '波兰', '埃及', '尼日利亚'];
const DEFENSIVE_ZH = ['沙特阿拉伯', '沙特', '伊朗', '突尼斯'];
const WEAK_TEAMS_ZH = ['南非', '捷克', '波黑', '巴拉圭', '海地', '库拉索',
  '阿尔及利亚', '约旦', '新西兰', '伊拉克', '苏格兰', '土耳其',
  '澳大利亚', '卡塔尔', '厄瓜多尔', '科特迪瓦',
  '乌兹别克', '秘鲁', '北爱尔兰', '匈牙利',
  '哈萨克', '冰岛', '哥斯达黎加',
  '威尔士', '喀麦隆', '加纳', '巴拿马', '刚果(金)'];

// 队伍风格（人工经验，粗粒度）
const STYLE_MAP = {
  '阿根廷': '传控/梅西驱动',
  '巴西': '技术流/边锋突击',
  '法国': '速度+身体/姆巴佩驱动',
  '德国': '组织+压制',
  '比利时': '德布劳内组织',
  '葡萄牙': 'C罗核心/技术流',
  '荷兰': '全攻全守/343',
  '英格兰': '凯恩+贝林/力量+技术',
  '西班牙': '传控/年轻阵容',
  '韩国': '体能+跑动/孙兴慜',
  '日本': '技术+组织/远藤航核心',
  '墨西哥': '东道主/快速反击',
  '美国': '东道主/年轻+冲击',
  '加拿大': '东道主/戴维斯冲击',
  '摩洛哥': '防守反击/身体强',
  '克罗地亚': '中场大师/莫德里奇',
  '乌拉圭': '传统中锋/努涅斯',
  '哥伦比亚': '技术+身体',
  '塞内加尔': '身体+冲击',
  '丹麦': '组织+埃里克森核心',
  '瑞士': '硬朗/组织防守',
  '奥地利': '组织型中场',
  '瑞典': '传统北欧/身体',
  '塞尔维亚': '米神中锋/身体',
  '挪威': '哈兰德驱动',
  '波兰': '莱万中锋',
  '埃及': '萨拉赫驱动',
  '尼日利亚': '身体+冲击',
  '沙特阿拉伯': '防守反击',
  '伊朗': '身体+防守',
  '突尼斯': '防守+组织',
  '澳大利亚': '身体+冲击',
  '卡塔尔': '东道主经验(2022)',
  '厄瓜多尔': '高原主场/冲击力',
  '哥斯达黎加': '防守组织',
  '南非': '身体对抗',
  '捷克': '传统东欧',
  '波黑': '中场技术',
  '巴拉圭': '防守型',
  '海地': '弱队/身体',
  '库拉索': '弱队',
  '阿尔及利亚': '防守+技术',
  '约旦': '弱队',
  '新西兰': '大洋洲代表',
  '伊拉克': '弱队/身体',
  '苏格兰': '英式冲击',
  '土耳其': '身体+跑动',
  '科特迪瓦': '非洲身体型',
  '乌兹别克': '中亚/组织',
  '秘鲁': '南美/技术',
  '北爱尔兰': '英式/防守',
  '匈牙利': '东欧/力量',
  '哈萨克': '中亚/组织',
  '冰岛': '身体+组织',
  '威尔士': '英式/已走下坡',
  '喀麦隆': '非洲身体',
  '加纳': '非洲技术',
  '巴拿马': '中北美/身体',
  '刚果(金)': '非洲身体',
  '加拿大': '东道主/边路冲击',
  '佛得角': '非洲弱旅',
  '中国': '防守/身体',
  '泰国': '东南亚技术',
  '阿尔及利亚': '防守/组织'
};

// 球星（中文名队名 -> 字符串，逗号分隔多球星）
const STARS_MAP = {
  '法国': '姆巴佩',
  '阿根廷': '梅西',
  '挪威': '哈兰德',
  '乌拉圭': '苏亚雷斯,努涅斯',
  '葡萄牙': 'C罗',
  '英格兰': '凯恩,贝林厄姆',
  '西班牙': '亚马尔,罗德里',
  '巴西': '维尼修斯,罗德里戈',
  '荷兰': '德容,加克波',
  '比利时': '德布劳内',
  '德国': '穆勒,维尔茨',
  '韩国': '孙兴慜',
  '日本': '远藤航,三苫薰',
  '加拿大': '阿方索·戴维斯',
  '美国': '普利西奇',
  '墨西哥': '希门尼斯',
  '埃及': '萨拉赫',
  '瑞士': '扎卡,沙奇里',
  '波兰': '莱万多夫斯基',
  '丹麦': '埃里克森,霍伊伦',
  '塞尔维亚': '米特罗维奇',
  '摩洛哥': '阿什拉夫',
  '克罗地亚': '莫德里奇',
  '中国': '武磊',
  '泰国': '当达',
  '佛得角': '无',
  '阿尔及利亚': '马赫雷斯'
};

// 进球型球星（直接参与/提升进球预测）
const SCORER_STAR_TEAMS_ZH = new Set([
  '法国', '阿根廷', '挪威', '乌拉圭', '葡萄牙', '英格兰', '西班牙', '巴西',
  '荷兰', '德国', '韩国', '日本', '美国', '墨西哥', '埃及', '波兰', '丹麦', '塞尔维亚',
  '加拿大', '阿尔及利亚',
]);

// 东道主（中文名）
const HOSTS_ZH = ['美国', '加拿大', '墨西哥'];

// 补充中文知识：未在 top/second/defensive/weak 中列出但 teams.json 有的队伍
//   加拿大（CAN）: 东道主/年轻冲击型，属 second
//   佛得角（CPV）: 非洲弱旅，weak
//   中国（CHN）: 亚洲弱旅/鱼腩，weak
//   泰国（THA）: 东南亚弱旅，weak
//   阿尔及利亚（ALG / DZA 都是阿尔及利亚的不同代码，DZA 为主）: 北非/防守，defensive
//   待定（TBD）: 留空/不分类
const EXTRA_SECOND_ZH = ['加拿大'];
const EXTRA_DEFENSIVE_ZH = ['阿尔及利亚'];
const EXTRA_WEAK_ZH = ['佛得角', '中国', '泰国'];

// 上届爆冷/整体战绩数据库（中文名）
const WC2022_MAP = {
  '西班牙': { desc: '2022 16强被摩洛哥淘汰', cold: '2022被日、摩爆冷' },
  '德国': { desc: '2022 小组赛未出线', cold: '2022被日本爆冷' },
  '巴西': { desc: '2022 8强被克罗地亚淘汰', cold: '2022被克罗爆冷' },
  '阿根廷': { desc: '2022 冠军', cold: '2022小组赛被沙特爆冷' },
  '法国': { desc: '2022 亚军', cold: '2022小组第2出线' },
  '沙特阿拉伯': { desc: '2022 小组赛未出线', cold: '2022爆冷胜阿根廷' },
  '日本': { desc: '2022 16强', cold: '2022胜德胜西' },
  '韩国': { desc: '2022 16强', cold: '2022逼平乌拉圭' },
  '摩洛哥': { desc: '2022 第4名', cold: '2022四强黑马' },
  '荷兰': { desc: '2022 8强', cold: '2022被阿根廷淘汰' },
  '乌拉圭': { desc: '2022 小组赛未出线', cold: '2022未出线' },
  '英格兰': { desc: '2022 8强', cold: '2022被法国淘汰' },
  '葡萄牙': { desc: '2022 8强', cold: '2022被摩洛哥淘汰' },
  '比利时': { desc: '2022 小组赛未出线', cold: '2022小组出局' },
  '美国': { desc: '2022 16强', cold: '2022平英格兰' },
  '加拿大': { desc: '2022 首秀/小组赛未出线', cold: '2022首秀' },
  '卡塔尔': { desc: '2022 东道主首秀/小组赛未出线', cold: '2022东道首秀' },
  '澳大利亚': { desc: '2022 16强', cold: '2022小组出线后被淘汰' },
  '墨西哥': { desc: '2022 小组赛未出线', cold: '2022小组出局' },
  '波兰': { desc: '2022 16强', cold: '2022小组第2' },
  '丹麦': { desc: '2022 小组赛未出线', cold: '2022小组出局' },
  '威尔士': { desc: '2022 小组赛未出线', cold: '2022小组出局' },
  '突尼斯': { desc: '2022 小组赛未出线', cold: '2022逼平丹麦' },
  '瑞士': { desc: '2022 16强', cold: '-' },
  '塞尔维亚': { desc: '2022 小组赛未出线', cold: '-' },
  '哥斯达黎加': { desc: '2022 小组赛未出线', cold: '-' },
  '厄瓜多尔': { desc: '2022 小组赛未出线', cold: '-' },
  '塞内加尔': { desc: '2022 16强', cold: '-' },
  '伊朗': { desc: '2022 小组赛未出线', cold: '-' },
  '克罗地亚': { desc: '2022 季军', cold: '-' },
  '哥伦比亚': { desc: '2022 未参赛（2026东道主外）', cold: '-' },
  '奥地利': { desc: '2022 未参赛', cold: '-' },
  '瑞典': { desc: '2022 附加赛出局', cold: '-' },
  '捷克': { desc: '2022 未参赛', cold: '-' },
  '挪威': { desc: '2022 未参赛', cold: '-' },
  '土耳其': { desc: '2022 未参赛', cold: '-' },
  '埃及': { desc: '2022 未参赛', cold: '-' },
  '尼日利亚': { desc: '2022 未参赛', cold: '-' },
  '南非': { desc: '2022 未参赛', cold: '-' },
  '波黑': { desc: '2022 未参赛', cold: '-' },
  '巴拉圭': { desc: '2022 未参赛', cold: '-' },
  '海地': { desc: '2022 未参赛', cold: '-' },
  '库拉索': { desc: '2022 未参赛', cold: '-' },
  '阿尔及利亚': { desc: '2022 未参赛', cold: '-' },
  '约旦': { desc: '2022 未参赛', cold: '-' },
  '新西兰': { desc: '2022 附加赛出局', cold: '-' },
  '伊拉克': { desc: '2022 未参赛', cold: '-' },
  '苏格兰': { desc: '2022 未参赛', cold: '-' },
  '科特迪瓦': { desc: '2022 未参赛', cold: '-' },
  '乌兹别克': { desc: '2022 未参赛', cold: '-' },
  '秘鲁': { desc: '2022 附加赛出局', cold: '-' },
  '北爱尔兰': { desc: '2022 未参赛', cold: '-' },
  '匈牙利': { desc: '2022 未参赛', cold: '-' },
  '哈萨克': { desc: '2022 未参赛', cold: '-' },
  '冰岛': { desc: '2022 未参赛', cold: '-' },
  '喀麦隆': { desc: '2022 小组赛未出线', cold: '-' },
  '加纳': { desc: '2022 小组赛未出线', cold: '-' },
  '巴拿马': { desc: '2022 未参赛', cold: '-' },
  '刚果(金)': { desc: '2022 未参赛', cold: '-' },
  '加拿大': { desc: '2022 首秀/小组赛未出线', cold: '2022 首次参加世界杯' },
  '佛得角': { desc: '2022 未参赛', cold: '-' },
  '中国': { desc: '2022 未参赛（仅 2002 一次）', cold: '-' },
  '泰国': { desc: '2022 未参赛', cold: '-' },
  '阿尔及利亚': { desc: '2022 未参赛（2014 参赛）', cold: '-' }
};

// 中文名变体（别名 -> 标准中文名），用于匹配 teamsBase 的 name 字段
// teamsBase 里一般有一个标准中文名；这里记录 modeling 脚本里使用的别名
const NAME_VARIANTS = {
  '沙特': '沙特阿拉伯',
  '乌兹别克': '乌兹别克斯坦',
  '刚果(金)': '刚果（金）'
};

// ============== 映射辅助 ==============

// 建中文名字典（teamsBase 中找匹配项；通过 NAME_VARIANTS 归一化）
function normalizeName(name) {
  if (NAME_VARIANTS[name]) return NAME_VARIANTS[name];
  return name;
}

// 构建 code <-> 中文名 双向索引
const codeToName = {};
const nameToCode = {};
for (const t of teamsBase) {
  codeToName[t.code] = t.name;
  nameToCode[normalizeName(t.name)] = t.code;
}

// 把中文列表映射成 code 集合
function zhListToCodes(zhList) {
  const codes = [];
  for (const zh of zhList) {
    const norm = normalizeName(zh);
    if (nameToCode[norm]) codes.push(nameToCode[norm]);
    else {
      // 允许通过 "中文名包含" 模糊匹配一次（例如 teamsBase 是"沙特阿拉伯"）
      const fuzzy = teamsBase.find(t => t.name.includes(zh) || zh.includes(t.name));
      if (fuzzy) codes.push(fuzzy.code);
    }
  }
  return [...new Set(codes)];
}

const TOP_TIER_CODES = new Set(zhListToCodes(TOP_TIER_ZH));
const SECOND_TIER_CODES = new Set([...zhListToCodes(SECOND_TIER_ZH), ...zhListToCodes(EXTRA_SECOND_ZH)]);
const DEFENSIVE_CODES = new Set([...zhListToCodes(DEFENSIVE_ZH), ...zhListToCodes(EXTRA_DEFENSIVE_ZH), 'ALG']);
const WEAK_TEAMS_CODES = new Set([...zhListToCodes(WEAK_TEAMS_ZH), ...zhListToCodes(EXTRA_WEAK_ZH)]);
const HOSTS_CODES = new Set(zhListToCodes(HOSTS_ZH));
const SCORER_STAR_CODES = new Set([...zhListToCodes(SCORER_STAR_TEAMS_ZH), 'ALG']);

function tierOfCode(code) {
  if (TOP_TIER_CODES.has(code)) return 'top';
  if (SECOND_TIER_CODES.has(code)) return 'second';
  if (DEFENSIVE_CODES.has(code)) return 'defensive';
  if (WEAK_TEAMS_CODES.has(code)) return 'weak';
  return 'unknown';
}

// ============== 构建 2026 分组/积分映射 ==============
// 每个 code -> { group, stage, standings }
const groupMapByCode = {};
const byGroup = {};
for (const g of groups) {
  byGroup[g.id] = g.teams.slice();
  for (let i = 0; i < g.standings.length; i++) {
    const s = g.standings[i];
    groupMapByCode[s.code] = {
      group: g.id,
      position: i + 1,
      played: s.played,
      win: s.win,
      draw: s.draw,
      lose: s.lose,
      gf: s.gf,
      ga: s.ga,
      gd: s.gd,
      pts: s.pts
    };
  }
  // 有些队伍可能在 teams 里但 standings 暂时没数据（罕见）
  for (const code of g.teams) {
    if (!groupMapByCode[code]) {
      groupMapByCode[code] = { group: g.id, position: null, played: 0, win: 0, draw: 0, lose: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
    }
  }
}

// ============== 合并 matchesStatus → matches（按 mid 错位修复）==============
// 背景：matches.json 用 mid 2040199-2040202 标 6-18 完赛 4 场，但 sporttery 实际 mid 是
//       2040182-2040185（与 data/results/*.json 一致）。matches.json 是手工录入，迁移期
//       留下错位。matchesStatus.json 才是权威完赛数据源。
// 这里按 (home_code, away_code) 配对，把 matchesStatus 的真 mid + status 覆盖到 matches 条目。
// 并把 matchesStatus 里有但 matches.json 没有的 mid（排除 TBD/历史 2022 赛事）补进 matches。
const _msByMid = new Map(matchesStatus.matches.map(ms => [ms.mid, ms]));
const _msByCodePair = new Map();
for (const ms of matchesStatus.matches) {
  const homeZh = normalizeName(ms.home);
  const awayZh = normalizeName(ms.away);
  const hc = nameToCode[homeZh] || (teamsBase.find(t => t.name === homeZh) || {}).code;
  const ac = nameToCode[awayZh] || (teamsBase.find(t => t.name === awayZh) || {}).code;
  if (!hc || !ac) continue;
  const key = `${hc}|${ac}`;
  // 同一对阵可能多次出现（不预期），后者覆盖前者
  _msByCodePair.set(key, ms);
}

const _matchesByIdSet = new Set(matches.filter(m => m.mid).map(m => m.mid));
let _mergedCount = 0;
let _appendedCount = 0;
const _mergedPairs = new Set();
const _appendedMids = new Set();
// 1) 更新已有 matches 条目：按 (home, away) 配对
for (const m of matches) {
  if (!m.home || !m.away) continue;
  const key = `${m.home}|${m.away}`;
  const ms = _msByCodePair.get(key);
  if (!ms || _mergedPairs.has(key)) continue;
  // 配对命中：覆盖 mid + status
  if (m.mid !== ms.mid) {
    _matchesByIdSet.delete(m.mid);  // 旧 mid 移除
    m.mid = ms.mid;
    _matchesByIdSet.add(ms.mid);    // 新 mid 加入
    _mergedCount++;
  }
  if (ms.status && m.status !== ms.status) {
    m.status = ms.status;
  }
  _mergedPairs.add(key);
  _appendedMids.add(ms.mid);
}
// 2) 追加 matches.json 没有的 mid（如 2040182-2040185 已通过配对覆盖；2040186-2040190 还没补）
//    排除 2022 历史赛事（mid 以 2022 开头）和未定义对阵
for (const ms of matchesStatus.matches) {
  if (ms.mid.startsWith('2022')) continue;
  if (!ms.home || !ms.away) continue;
  if (_matchesByIdSet.has(ms.mid)) continue;
  const homeZh = normalizeName(ms.home);
  const awayZh = normalizeName(ms.away);
  const hc = nameToCode[homeZh] || (teamsBase.find(t => t.name === homeZh) || {}).code;
  const ac = nameToCode[awayZh] || (teamsBase.find(t => t.name === awayZh) || {}).code;
  if (!hc || !ac) continue;
  // kickoff "2026-06-18 01:00" 北京时间 → 转 ISO（视为 +08:00）
  const kickoffToIso = (ko) => {
    if (!ko) return null;
    const m = ko.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`;
  };
  matches.push({
    id: null,  // 暂未排入 M 系列
    mid: ms.mid,
    stage: 'group',
    group: null,
    date: kickoffToIso(ms.kickoff),
    venue: null,
    home: hc,
    away: ac,
    status: ms.status,
    league: ms.league
  });
  _appendedCount++;
}

if (_mergedCount > 0 || _appendedCount > 0) {
  console.log(`  [merge] matchesStatus 覆盖 mid: ${_mergedCount} 场, 追加新 mid: ${_appendedCount} 场`);
}

// ============== 构建每队的 2026 比赛列表 ==============
// matches 里 home/away 是 code；status 是 'finished' 等
// 对已完赛场次，读取 data/results/{mid}.json 拿比分
const matchesByCode = {};
for (const m of matches) {
  for (const side of ['home', 'away']) {
    const code = m[side];
    if (!matchesByCode[code]) matchesByCode[code] = [];
    const opponent = side === 'home' ? m.away : m.home;
    const entry = {
      mid: m.mid,
      match_id: m.id,
      stage: m.stage,
      group: m.group || null,
      date: m.date,
      venue: m.venue || null,
      role: side,
      opponent_code: opponent,
      opponent_name: codeToName[opponent] || opponent,
      status: m.status
    };
    if (m.status === 'finished') {
      const resultPath = path.join(DATA_DIR, 'results', `${m.mid}.json`);
      if (fs.existsSync(resultPath)) {
        const r = readJson(resultPath);
        const myScore = side === 'home' ? r.homeScore : r.awayScore;
        const oppScore = side === 'home' ? r.awayScore : r.homeScore;
        entry.score_my = myScore;
        entry.score_opp = oppScore;
        if (r.halfTime) {
          entry.half_my = side === 'home' ? r.halfTime.home : r.halfTime.away;
          entry.half_opp = side === 'home' ? r.halfTime.away : r.halfTime.home;
        }
        if (myScore > oppScore) entry.result = 'win';
        else if (myScore === oppScore) entry.result = 'draw';
        else entry.result = 'lose';
        if (r.wentToPenalties) entry.penalties = true;
        if (r.penaltyScore) entry.penaltyScore = r.penaltyScore;
      }
    }
    matchesByCode[code].push(entry);
  }
}
// 按日期排序（升序）
for (const code of Object.keys(matchesByCode)) {
  matchesByCode[code].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// ============== 决定 stage（小组赛完了没有？进了16强？）==============
// 简化：若某队有 stage !== 'group' 的比赛，说明进入淘汰赛
// 这里用 matches 里存在的最高 stage 判断
function computeStage2026(code) {
  const list = matchesByCode[code] || [];
  let stage = 'group';
  for (const m of list) {
    if (m.stage === 'knockout_16') stage = 'knockout_16';
    if (m.stage === 'quarter_final') stage = 'quarter_final';
    if (m.stage === 'semi_final') stage = 'semi_final';
    if (m.stage === 'final') stage = 'final';
  }
  // 若小组比赛都完赛 + 积分排在前2之外，可能是 eliminated；这里保守不自动标 eliminated
  // （因为 matches 表可能还没更新后续比赛）
  return stage;
}

// ============== 输出每个队伍文件 ==============
const now = new Date().toISOString();
const byCodeIndex = {};
const byNameIndex = {};
const byTierIndex = { top: [], second: [], defensive: [], weak: [], unknown: [] };
const hostsList = [];

for (const t of teamsBase) {
  const code = t.code;
  const nameZh = t.name;
  const tier = tierOfCode(code);
  byTierIndex[tier].push(code);
  byCodeIndex[code] = `teams/${code}.json`;
  byNameIndex[nameZh] = code;
  if (HOSTS_CODES.has(code)) hostsList.push(code);

  // 找到对应中文知识库条目
  const normZh = normalizeName(nameZh);
  const starsRaw = STARS_MAP[normZh];
  const stars = starsRaw
    ? starsRaw.split(',').map(s => s.trim()).filter(s => s && s !== '无')
    : [];
  const wc2022Entry = WC2022_MAP[normZh] || { desc: null, cold: null };
  const style = STYLE_MAP[normZh] || null;

  const groupInfo = groupMapByCode[code];
  const matches2026 = matchesByCode[code] || [];

  const doc = {
    code: code,
    name: nameZh,
    nameEn: t.nameEn,
    confederation: t.confederation,
    flag: t.flag,
    iso2: t.iso2,
    color: t.color || null,
    meta: {
      tier: tier,
      style: style,
      stars: stars,
      has_scorer_star: stars.length > 0 && SCORER_STAR_CODES.has(code),
      is_host: HOSTS_CODES.has(code),
      fifa_rank: null
    },
    history_wc2022: {
      description: wc2022Entry.desc,
      cold_history: wc2022Entry.cold
    },
    wc2026: {
      group: groupInfo ? groupInfo.group : null,
      stage: computeStage2026(code),
      standings: groupInfo ? {
        position: groupInfo.position,
        played: groupInfo.played,
        win: groupInfo.win,
        draw: groupInfo.draw,
        lose: groupInfo.lose,
        gf: groupInfo.gf,
        ga: groupInfo.ga,
        gd: groupInfo.gd,
        pts: groupInfo.pts
      } : null,
      matches: matches2026
    },
    _updated_at: now
  };

  fs.writeFileSync(
    path.join(TEAMS_DIR, `${code}.json`),
    JSON.stringify(doc, null, 2) + '\n',
    'utf8'
  );
}

// ============== 输出 _index.json ==============
// 中文名变体（给未来预测脚本读取用）：别名 -> code
const nameVariantsToCode = {};
for (const [variant, standard] of Object.entries(NAME_VARIANTS)) {
  if (nameToCode[standard]) nameVariantsToCode[variant] = nameToCode[standard];
}
// 还有 modeling 脚本中使用的非标准名（例如上面 SECOND_TIER_ZH / DEFENSIVE_ZH 里的"乌兹别克"、"沙特"）
// 都通过 NAME_VARIANTS 覆盖了

const indexDoc = {
  generated_at: now,
  total_teams: teamsBase.length,
  by_code: byCodeIndex,
  by_name: byNameIndex,
  by_group: byGroup,
  by_tier: byTierIndex,
  hosts: hostsList,
  name_variants_to_code: nameVariantsToCode
};

fs.writeFileSync(
  path.join(TEAMS_DIR, '_index.json'),
  JSON.stringify(indexDoc, null, 2) + '\n',
  'utf8'
);

console.log(`✓ 生成 ${teamsBase.length} 个队伍文件于 data/teams/`);
console.log(`✓ 生成 data/teams/_index.json（队伍索引）`);
console.log(`  东道主: ${hostsList.map(c => `${c}(${codeToName[c]})`).join(', ')}`);
console.log(`  分组 A-H 共 ${Object.keys(byGroup).length} 组`);
console.log(`  档次分布: top=${byTierIndex.top.length}, second=${byTierIndex.second.length}, defensive=${byTierIndex.defensive.length}, weak=${byTierIndex.weak.length}, unknown=${byTierIndex.unknown.length}`);
