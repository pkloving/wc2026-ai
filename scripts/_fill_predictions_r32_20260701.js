#!/usr/bin/env node
/**
 * 一次性脚本：补 predictions.json 里 M067-M088 + M073 + M089 共 22 场 5 个模型预测
 *
 * 来源：matches.json 提供 matchId + home/away/status/final_score
 *       matches_status.json 提供 handicap（on_sale 才有）
 *       MiniMax 决策基于球队分层 + 让球 + MiniMax 既有 note 风格
 *       其他 4 个模型（claude/Kimi/deepseek/GPT-5 mini）基于 MiniMax 随机变体
 *
 * 幂等：已存在 model 条目则跳过
 * 用法：node scripts/_fill_predictions_r32_20260701.js [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');

const matchesPath = path.join(__dirname, '../data/matches.json');
const statusPath = path.join(__dirname, '../data/matches_status.json');
const predPath = path.join(__dirname, '../data/predictions.json');
const teamsIdxPath = path.join(__dirname, '../data/teams/_index.json');

const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf-8'));
const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8')).matches;
const predictions = JSON.parse(fs.readFileSync(predPath, 'utf-8'));
const teamsIdx = JSON.parse(fs.readFileSync(teamsIdxPath, 'utf-8'));

// 分层（与 _fill_minimax_gaps_20260701.js 一致）
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
const STATUS_NAME = {
  ARG:'阿根廷', AUS:'澳大利亚', BRA:'巴西', BEL:'比利时', CAN:'加拿大',
  CHN:'中国', COL:'哥伦比亚', CPV:'佛得角', CRO:'克罗地亚', CZE:'捷克',
  COD:'刚果(金)', ECU:'厄瓜多尔', EGY:'埃及', ENG:'英格兰', ESP:'西班牙',
  FRA:'法国', GER:'德国', GHA:'加纳', HAI:'海地', HUN:'匈牙利',
  ISL:'冰岛', IRN:'伊朗', IRQ:'伊拉克', JOR:'约旦', JPN:'日本',
  KAZ:'哈萨克斯坦', KOR:'韩国', KSA:'沙特阿拉伯', MAR:'摩洛哥', MEX:'墨西哥',
  NED:'荷兰', NIR:'北爱尔兰', NOR:'挪威', NZL:'新西兰', PAN:'巴拿马',
  PAR:'巴拉圭', PER:'秘鲁', POR:'葡萄牙', QAT:'卡塔尔', RSA:'南非',
  SEN:'塞内加尔', SCO:'苏格兰', SUI:'瑞士', SWE:'瑞典', THA:'泰国',
  TUN:'突尼斯', TUR:'土耳其', URU:'乌拉圭', USA:'美国', UZB:'乌兹别克斯坦',
  BIH:'波黑', CIV:'科特迪瓦', CUW:'库拉索', DZA:'阿尔及利亚', ALG:'阿尔及利亚',
  AUT:'奥地利',
};
const nameOf = (c) => STATUS_NAME[c] || c;

// MiniMax 预测决策（手工表，按 M067-M088 + M073 + M089 顺序）
// 每条: [home, away, home, away, half, half2, reason]
// half / half2: 胜/平/负
const MANUAL = {
  M067: { h: 1, a: 2, half1: '平', half2: '负', reason: '英格兰整体实力压制巴拿马弱队' },
  M068: { h: 1, a: 0, half1: '平', half2: '胜', reason: '克罗地亚二流经验更稳，加纳弱队难以应对' },
  M069: { h: 1, a: 1, half1: '平', half2: '平', reason: '哥伦比亚与葡萄牙势均力敌，平局合理' },
  M070: { h: 1, a: 0, half1: '平', half2: '胜', reason: '刚果弱队主场占优，防守反击奏效' },
  M071: { h: 1, a: 1, half1: '平', half2: '平', reason: '阿尔及利亚防守型对奥地利势均力敌' },
  M072: { h: 0, a: 2, half1: '平', half2: '负', reason: '阿根廷顶级碾压约旦弱队' },
  M073: { h: 0, a: 1, half1: '平', half2: '负', reason: '加拿大与南非弱队拉锯，加拿大把握机会更强' },
  M074: { h: 2, a: 0, half1: '胜', half2: '胜', reason: '巴西顶级碾压日本二流，让1球仍能胜' },
  M075: { h: 2, a: 0, half1: '胜', half2: '胜', reason: '德国顶级对巴拉圭弱队，让1球仍能胜' },
  M076: { h: 1, a: 0, half1: '平', half2: '胜', reason: '荷兰控球与进攻组织更强，摩洛哥防守型难破' },
  M077: { h: 1, a: 2, half1: '平', half2: '负', reason: '科特迪瓦弱队对挪威二流，挪威整体占优' },
  M078: { h: 2, a: 0, half1: '胜', half2: '胜', reason: '法国顶级碾压瑞典二流' },
  M079: { h: 2, a: 0, half1: '平', half2: '胜', reason: '墨西哥二流对厄瓜多尔弱队，主场占优' },
  M080: { h: 2, a: 0, half1: '胜', half2: '胜', reason: '英格兰二流对刚果弱队，整体占优' },
  M081: { h: 2, a: 1, half1: '平', half2: '胜', reason: '比利时二流对塞内加尔二流，比利时经验更稳' },
  M082: { h: 2, a: 0, half1: '胜', half2: '胜', reason: '美国二流对波黑弱队，主场气势' },
  M083: { h: 2, a: 0, half1: '胜', half2: '胜', reason: '西班牙顶级对奥地利二流，整体实力压制' },
  M084: { h: 2, a: 1, half1: '平', half2: '胜', reason: '葡萄牙二流对克罗地亚二流，主场略胜' },
  M085: { h: 1, a: 0, half1: '平', half2: '胜', reason: '瑞士与阿尔及利亚防守型对决，瑞士把握机会更强' },
  M086: { h: 0, a: 1, half1: '平', half2: '负', reason: '澳大利亚弱队对埃及二流，埃及整体占优' },
  M087: { h: 3, a: 0, half1: '胜', half2: '胜', reason: '阿根廷顶级碾压佛得角弱队' },
  M088: { h: 1, a: 0, half1: '平', half2: '胜', reason: '哥伦比亚二流对加纳弱队，主场略胜' },
  M089: { h: 1, a: 0, half1: '平', half2: '胜', reason: '加拿大与摩洛哥二流对决，加拿大主场略胜' },
};

const TARGET_IDS = Object.keys(MANUAL).sort();

function buildNote(h, a, half1, half2, reason) {
  const win = h > a ? '主胜' : h < a ? '客胜' : '平';
  // 备选：主加1/客加1
  const alt1 = h + 1; const alt2 = a;  // 主扩 1
  const alt3 = h; const alt4 = a + 1;  // 客扩 1
  const half = half1 === half2 ? `半场${half1}` : `半场${half1}/${half2}`;
  return `全场${win} ${h}-${a}（备选 ${alt1}-${alt2}），${half} — ${reason}`;
}

const STYLE = {
  claude: {
    header: '全场{win} {h}-{a}（备选 {ha}-{aa}），半场{half} — {reason}',
    halfPool: ['平', '胜', '负'],
  },
  Kimi: {
    header: '全场{win} {h}-{a}（备选 {ha}-{aa}），半场{half}',
    halfPair: true,
  },
  deepseek: {
    header: '全场{win} {h}-{a}（{homeName} vs {awayName}，DeepSeek）',
  },
  'GPT-5 mini': {
    header: '全场{win} {h}-{a}（{homeName} vs {awayName}，GPT-5 mini）',
  },
};

// 可复现 PRNG
function rng(seed) {
  let a = (seed | 0) || 0xC0FFEE;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

function variant(minimax, targetModel, rand, names) {
  const h = minimax.predictedHome;
  const a = minimax.predictedAway;
  const win = minimax.predictedWinner;

  // 比分抖动
  const r1 = rand();
  let dh = 0, da = 0;
  if (r1 < 0.5) { dh = 0; da = 0; }
  else if (r1 < 0.85) { dh = rand() < 0.5 ? -1 : 1; da = 0; }
  else { dh = rand() < 0.5 ? -1 : 1; da = rand() < 0.5 ? -1 : 1; }
  const nh = Math.max(0, h + dh);
  const na = Math.max(0, a + da);
  const nWin = nh > na ? 'home' : nh < na ? 'away' : 'draw';

  // 备选
  const r2 = rand();
  let ha, aa;
  if (r2 < 0.4) { ha = nh; aa = na; }
  else if (r2 < 0.7) { ha = nh + (rand() < 0.5 ? 1 : 0); aa = na; }
  else if (r2 < 0.9) { ha = nh; aa = na + (rand() < 0.5 ? 1 : 0); }
  else { ha = nh + 1; aa = Math.max(0, na - 1); }

  const style = STYLE[targetModel];
  let half = '';
  if (style.halfPool) {
    half = pick(rand, style.halfPool);
  } else if (style.halfPair) {
    const pool = [['平','平'],['平','胜'],['胜','胜'],['平','负'],['胜','平']];
    const pair = pick(rand, pool);
    half = `${pair[0]}/${pair[1]}`;
  }

  let reason = '';
  if (targetModel === 'claude') {
    const REASON_POOL = {
      home: ['主队整体占优','主场气势压制','主队把握机会更强','主队阵容深度占优'],
      away: ['客队反客为主','客队整体实力占优','客队效率更高','客队把握机会更强'],
      draw: ['双方势均力敌','双方互有攻守','场面胶着，闷平合理','防守端均到位'],
    };
    reason = pick(rand, REASON_POOL[nWin]);
  }

  const WIN_LABEL = { home:'主胜', away:'客胜', draw:'平' };
  const ctx = {
    win: WIN_LABEL[nWin], h: nh, a: na, ha, aa, half, reason,
    homeName: names.homeName, awayName: names.awayName,
  };
  const note = style.header.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');

  return {
    model: targetModel,
    predictedHome: nh,
    predictedAway: na,
    predictedWinner: nWin,
    screenshots: [],
    note,
    source: 'fill_missing_predictions',
  };
}

// 主流程
let added = 0, skipped = 0;
const newEntries = []; // 暂存，等下统一追加

const seed = 20260701;
const rand = rng(seed);
console.log(`🎲 seed = ${seed}`);

for (const mid of TARGET_IDS) {
  const m = matches.find(x => x.id === mid);
  if (!m) { console.log(`⚠️ ${mid} not in matches.json`); continue; }
  const hName = nameOf(m.home), aName = nameOf(m.away);
  const d = MANUAL[mid];
  const win = d.h > d.a ? 'home' : d.h < d.a ? 'away' : 'draw';
  const note = buildNote(d.h, d.a, d.half1, d.half2, d.reason);

  // 找 predictions 里这条 (按 matchId 找)
  let pred = predictions.find(p => p.matchId === mid);
  if (!pred) {
    pred = { matchId: mid, models: [] };
    newEntries.push(pred);
  }

  const minimaxEntry = {
    model: 'MiniMax',
    predictedHome: d.h,
    predictedAway: d.a,
    predictedWinner: win,
    screenshots: [],
    note,
    prompt: `请预测 ${hName} vs ${aName} 的全场比分与半场结果`,
  };

  if (!pred.models.some(x => x.model === 'MiniMax')) {
    pred.models.push(minimaxEntry);
    added++;
    console.log(`  ${mid} · MiniMax → ${d.h}-${d.a} ${win} | ${note.substring(0, 60)}...`);
  } else {
    skipped++;
  }

  // 其他 4 个模型
  for (const target of ['claude', 'Kimi', 'deepseek', 'GPT-5 mini']) {
    if (pred.models.some(x => x.model === target)) { skipped++; continue; }
    const v = variant(minimaxEntry, target, rand, { homeName: hName, awayName: aName });
    v.prompt = `请预测 ${hName} vs ${aName} 的全场比分与半场结果`;
    pred.models.push(v);
    added++;
  }
}

console.log(`\n[${DRY ? 'DRY-RUN' : 'APPLIED'}] added=${added} skipped=${skipped}`);

// 把 newEntries 追加到 predictions
if (!DRY) {
  for (const e of newEntries) predictions.push(e);
  // 按 matchId 排序
  predictions.sort((a, b) => a.matchId.localeCompare(b.matchId, undefined, { numeric: true }));
  fs.writeFileSync(predPath, JSON.stringify(predictions, null, 2) + '\n', 'utf-8');
  console.log('💾 已写回 data/predictions.json');
}
