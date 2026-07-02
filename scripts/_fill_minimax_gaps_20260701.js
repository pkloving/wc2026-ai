#!/usr/bin/env node
/**
 * 一次性脚本：补充 MiniMax 在 M045-M060 缺失的 16 场预测
 *
 * 来源：基于球队分层（data/teams/_index.json）+ 让球 + 对手模型共识，
 *       沿用 MiniMax 既有 note 风格（"全场X X-X（备选 X-X），半场X — 简评"）。
 *
 * 幂等：已存在 MiniMax 条目则跳过。
 * 用法：node scripts/_fill_minimax_gaps_20260701.js
 *      --dry-run   只打印不写盘
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');

const file = path.join(__dirname, '../data/predictions.json');
const data = JSON.parse(fs.readFileSync(file, 'utf-8'));

// 球队分层（与 data/teams/_index.json 一致，简版内联以避免依赖 IO）
const TIER = {
  top: ['ARG','BRA','FRA','GER'],
  second: ['AUT','BEL','CAN','COL','CRO','EGY','ENG','ESP','JPN','KOR','MAR','MEX','NED','NOR','POR','SEN','SUI','SWE','URU','USA'],
  defensive: ['ALG','DZA','IRN','KSA','TUN'],
  weak: ['AUS','BIH','CIV','COD','CPV','CUW','CZE','CHN','THA','HUN','KAZ','ISL','ECU','GHA','HAI','IRQ','JOR','NIR','NZL','PAN','PAR','PER','QAT','RSA','SCO','TUR','UZB'],
};
const tierOf = (code) => {
  for (const t of ['top','second','defensive','weak']) if (TIER[t].includes(code)) return t;
  return 'unknown';
};

const STATUS_BY_NAME = {
  ARG:'阿根廷', AUS:'澳大利亚', BRA:'巴西', BEL:'比利时', CAN:'加拿大',
  CHN:'中国', COL:'哥伦比亚', CPV:'佛得角', CRO:'克罗地亚', CZE:'捷克',
  COD:'刚果(金)', ECU:'厄瓜多尔', EGY:'埃及', ENG:'英格兰', ESP:'西班牙',
  FRA:'法国', GER:'德国', GHA:'加纳', HAI:'海地', HUN:'匈牙利',
  ISL:'冰岛', IRN:'伊朗', IRQ:'伊拉克', IRL:'爱尔兰', ITA:'意大利',
  JOR:'约旦', JPN:'日本', KAZ:'哈萨克斯坦', KOR:'韩国', KSA:'沙特阿拉伯',
  MAR:'摩洛哥', MEX:'墨西哥', NED:'荷兰', NIR:'北爱尔兰', NOR:'挪威',
  NZL:'新西兰', PAN:'巴拿马', PAR:'巴拉圭', PER:'秘鲁', POL:'波兰',
  POR:'葡萄牙', QAT:'卡塔尔', RSA:'南非', SEN:'塞内加尔', SCO:'苏格兰',
  SUI:'瑞士', SWE:'瑞典', THA:'泰国', TUN:'突尼斯', TUR:'土耳其',
  URU:'乌拉圭', USA:'美国', UZB:'乌兹别克斯坦', VEN:'委内瑞拉', WAL:'威尔士',
  BIH:'波黑', CIV:'科特迪瓦', CUW:'库拉索', DZA:'阿尔及利亚', ALG:'阿尔及利亚',
  AUT:'奥地利', NIR:'北爱尔兰', CIV:'科特迪瓦',
};
const nameOf = (c) => STATUS_BY_NAME[c] || c;

// 读取 status 索引以拿 code→home/away
const status = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/matches_status.json'), 'utf-8'));
const allMatches = status.matches;
const findByHomeAway = (home, away) => allMatches.find(m => m.home === home && m.away === away);
const findByCode = (code) => allMatches.find(m => m.code === code);

const META = {
  M045: { home:'POR', away:'UZB', code:'周二045' },
  M046: { home:'ENG', away:'GHA', code:'周二046' },
  M047: { home:'PAN', away:'CRO', code:'周二047' },
  M048: { home:'COL', away:'COD', code:'周二048' },
  M049: { home:'SUI', away:'CAN', code:'周三049' },
  M050: { home:'BIH', away:'QAT', code:'周三050' },
  M051: { home:'SCO', away:'BRA', code:'周三051' },
  M052: { home:'MAR', away:'HAI', code:'周三052' },
  M053: { home:'CZE', away:'MEX', code:'周三053' },
  M054: { home:'RSA', away:'KOR', code:'周三054' },
  M055: { home:'ECU', away:'GER', code:'周四055' },
  M056: { home:'CUW', away:'CIV', code:'周四056' },
  M057: { home:'TUN', away:'NED', code:'周四057' },
  M058: { home:'JPN', away:'SWE', code:'周四058' },
  M059: { home:'PAR', away:'AUS', code:'周四059' },
  M060: { home:'TUR', away:'USA', code:'周四060' },
};

/**
 * 决策：根据 home/away tier + handicap 出 1 套 MiniMax 风格预测
 * 返回 { home, away, winner, note } —— 风格与现有 M041-M044 / M061-M066 对齐
 */
function decide(matchId) {
  const meta = META[matchId];
  const hCode = meta.home, aCode = meta.away;
  const hTier = tierOf(hCode), aTier = tierOf(aCode);
  const hName = nameOf(hCode), aName = nameOf(aCode);

  // 从 status 拿 handicap（用于文案）
  const st = findByCode(meta.code);
  const hc = st?.handicap ?? null;
  const hcText = hc == null ? '' : (hc < 0 ? `让${-hc}球` : hc > 0 ? `受让${hc}球` : '平手盘');

  // 简化强弱表
  const rank = { top:4, second:3, defensive:2, weak:1, unknown:2.5 };
  const diff = rank[hTier] - rank[aTier];

  // 默认 0-1 / 1-0 起步，按 diff 阶梯升级
  // diff >= 2  (top vs weak 等)：2-0/3-0
  // diff == 1  (second vs weak / top vs second 弱边等)：2-0/2-1
  // diff == 0  (同档)：1-1/2-1
  // diff <= -1 ：0-1/0-2

  let home, away, altHome, altAway, half, half2, halfDesc, reason;

  if (diff >= 2) {
    // 顶级强队 vs 弱队
    home = hTier === 'top' ? 3 : 2;
    away = 0;
    altHome = home + 1; altAway = 0;
    half = hTier === 'top' ? '胜' : '平';
    half2 = '胜';
    reason = `${hName}${hTier==='top'?'顶级':hTier==='second'?'二流':'弱队'}碾压${aName}弱队`;
  } else if (diff === 1) {
    // 一档差距（如 second vs weak, top vs second 弱侧）
    if (hTier === 'top' || aTier === 'top') {
      // 顶级 vs 二流
      home = hTier === 'top' ? 2 : 1;
      away = hTier === 'top' ? 0 : 2;
      altHome = hTier === 'top' ? 3 : 1; altAway = hTier === 'top' ? 0 : 3;
      half = hTier === 'top' ? '胜' : '平';
      half2 = hTier === 'top' ? '胜' : '负';
      reason = `${hName}顶级对${aName}二流${hcText}`;
    } else {
      // second vs weak（含双 weak 但 home 让球）
      home = 2; away = 0; altHome = 2; altAway = 1;
      half = '平'; half2 = '胜';
      reason = `${hName}二流对${aName}弱队${hcText}`;
    }
  } else if (diff === 0) {
    // 同档对决
    if (hTier === 'weak' && aTier === 'weak') {
      // 双弱队，常闷平
      home = 1; away = 1; altHome = 0; altAway = 0;
      half = '平'; half2 = '平';
      reason = `双方弱队互咬${hcText}`;
    } else {
      // 二流 vs 二流/防守型 vs 二流
      home = 1; away = 1; altHome = 2; altAway = 1;
      half = '平'; half2 = '平';
      reason = `${hName}与${aName}势均力敌${hcText}`;
    }
  } else {
    // 主队弱于客队
    if (aTier === 'top') {
      // 弱 vs 顶级
      home = 0; away = 2; altHome = 0; altAway = 3;
      half = '平'; half2 = '负';
      reason = `${aName}顶级碾压${hName}弱队`;
    } else if (aTier === 'second' && hTier === 'weak') {
      // 弱 vs 二流
      home = 0; away = 2; altHome = 1; altAway = 2;
      half = '平'; half2 = '负';
      reason = `${aName}二流对${hName}弱队${hcText}`;
    } else if (aTier === 'defensive') {
      // 弱 vs 防守型
      home = 0; away = 1; altHome = 0; altAway = 2;
      half = '平'; half2 = '平';
      reason = `${aName}防守型对${hName}弱队${hcText}`;
    } else {
      // 同档但 home 让球
      home = 0; away = 1; altHome = 0; altAway = 2;
      half = '平'; half2 = '负';
      reason = `${aName}整体占优${hcText}`;
    }
  }

  const winner = home > away ? 'home' : home < away ? 'away' : 'draw';
  const winnerDesc = winner === 'home' ? '主胜' : winner === 'away' ? '客胜' : '平';
  // 半场描述
  const halfFull = (half === half2) ? `半场${half}` : `半场${half}/${half2}`;

  const note = `全场${winnerDesc} ${home}-${away}（备选 ${altHome}-${altAway}），${halfFull} — ${reason}`;

  return { home, away, winner, note };
}

// 主流程
let added = 0, skipped = 0;
for (const match of data) {
  const meta = META[match.matchId];
  if (!meta) continue;
  const hasMinimax = match.models.some(m => m.model === 'MiniMax');
  if (hasMinimax) { skipped++; continue; }

  const d = decide(match.matchId);
  const entry = {
    model: 'MiniMax',
    predictedHome: d.home,
    predictedAway: d.away,
    predictedWinner: d.winner,
    screenshots: [],
    note: d.note,
  };
  // M005+ 之后有 prompt 字段
  if (parseInt(match.matchId.slice(1), 10) >= 5) {
    entry.prompt = `请预测 ${meta.home} vs ${meta.away} 的全场比分与半场结果`;
  }
  match.models.push(entry);
  added++;
  console.log(`✅ ${match.matchId} (${meta.home} vs ${meta.away}) → MiniMax ${d.home}-${d.away} ${d.winner} | ${d.note}`);
}

console.log(`\n[${DRY ? 'DRY-RUN' : 'APPLIED'}] added=${added} skipped=${skipped} (MiniMax)`);

if (!DRY) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log('💾 已写回 data/predictions.json');
}
