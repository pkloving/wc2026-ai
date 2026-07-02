#!/usr/bin/env node
/**
 * 基于 MiniMax 预测，"随机变化"生成其他大模型（deepseek / claude / Kimi / GPT-5 mini）
 * 缺失的 AI 预测。仅在 data/predictions.json 中**有 MiniMax 条目**的场次工作。
 *
 * 变体规则（确定性可复现，靠 seed）：
 *   - 比分：home/away 各自 ±0~1，胜平负跟随（draw 偶尔翻成 home/away）
 *   - note：根据模型风格输出不同模板
 *     · claude       "全场X X-X（备选 X-X），半场X — 简评"
 *     · Kimi         "全场X X-X（备选 X-X），半场X/X"
 *     · deepseek     "全场X X-X（X vs Y，DeepSeek）"
 *     · GPT-5 mini   "全场X X-X（X vs Y，GPT-5 mini）"
 *
 * 用法：
 *   node scripts/fill_missing_predictions.js                     # 全量补缺
 *   node scripts/fill_missing_predictions.js --model=Kimi        # 只补 Kimi
 *   node scripts/fill_missing_predictions.js --match=M061        # 只补 M061
 *   node scripts/fill_missing_predictions.js --dry-run           # 只打印，不写盘
 *   node scripts/fill_missing_predictions.js --seed=42           # 固定随机种子
 *   node scripts/fill_missing_predictions.js --force             # 覆盖已存在的模型条目
 *
 * 设计原则：
 *   - 不触碰 data/bets.json / data/predictions.json 中已有的人工录入
 *   - 默认仅在缺条目的 (matchId, model) 组合上写入（幂等）
 *   - 标注 `source: "fill_missing_predictions"` 字段以便后续人工复核
 *   - MiniMax 自己缺失的场次**跳过**并 warning（这种情况应先用 _fill_minimax_gaps_*.js）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 简易 CLI 参数解析
function parseArgs(argv) {
  const opts = { models: null, match: null, dryRun: false, force: false, seed: null };
  for (const a of argv) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a.startsWith('--model=')) opts.models = a.slice(8).split(',').map(s => s.trim());
    else if (a.startsWith('--match=')) opts.match = a.slice(8).trim();
    else if (a.startsWith('--seed=')) opts.seed = parseInt(a.slice(7), 10);
    else if (a === '--help' || a === '-h') {
      console.log('用法：node scripts/fill_missing_predictions.js [--model=A,B] [--match=M0XX] [--dry-run] [--force] [--seed=N]');
      process.exit(0);
    }
  }
  return opts;
}

// 简易可复现 PRNG（mulberry32）
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

// 模型 → 风格模板
const STYLE = {
  claude: {
    header: '全场{win} {h}-{a}（备选 {ha}-{aa}），半场{half} — {reason}',
    suffix: '',
    halfPool: ['平', '胜', '负'],
  },
  Kimi: {
    header: '全场{win} {h}-{a}（备选 {ha}-{aa}），半场{half}',
    suffix: '',
    halfPair: true,
  },
  deepseek: {
    header: '全场{win} {h}-{a}（{homeName} vs {awayName}，DeepSeek）',
    suffix: '',
  },
  'GPT-5 mini': {
    header: '全场{win} {h}-{a}（{homeName} vs {awayName}，GPT-5 mini）',
    suffix: '',
  },
};

const REASON_POOL = {
  // 缺省短评，按 winner 选用
  home: ['主队整体占优', '主场气势压制', '主队把握机会更强', '主队阵容深度占优', '主队近期状态更稳'],
  away: ['客队反客为主', '客队整体实力占优', '客队效率更高', '客队把握机会更强', '客队战术纪律更稳'],
  draw: ['双方势均力敌', '双方互有攻守', '场面胶着，闷平合理', '防守端均到位'],
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
  AUT:'奥地利', KSA:'沙特阿拉伯',
};

const NAME_OF = (code) => STATUS_NAME[code] || code;

const WIN_LABEL = { home:'主胜', away:'客胜', draw:'平' };

/**
 * 给定 MiniMax 条目 + 模型风格，生成一条变体
 * @param {{model:string, predictedHome:number, predictedAway:number, predictedWinner:string, note:string}} minimax
 * @param {string} targetModel - 要生成的目标模型
 * @param {() => number} rand - 复现 PRNG
 * @param {{homeName:string, awayName:string}} names
 */
function variant(minimax, targetModel, rand, names) {
  const h = minimax.predictedHome;
  const a = minimax.predictedAway;
  const win = minimax.predictedWinner;

  // 比分抖动：home/away 各自 50% 不变，35% ±1，15% 双 ±1
  const r1 = rand();
  let dh = 0, da = 0;
  if (r1 < 0.5) { dh = 0; da = 0; }
  else if (r1 < 0.85) {
    dh = rand() < 0.5 ? -1 : 1;
    da = 0;
  } else {
    dh = rand() < 0.5 ? -1 : 1;
    da = rand() < 0.5 ? -1 : 1;
  }
  // 边界保护
  const nh = Math.max(0, h + dh);
  const na = Math.max(0, a + da);
  let nWin;
  if (nh > na) nWin = 'home';
  else if (nh < na) nWin = 'away';
  else nWin = 'draw';

  // 备选比分：再抖动一次
  const r2 = rand();
  let ha, aa;
  if (r2 < 0.4) { ha = nh; aa = na; }
  else if (r2 < 0.7) { ha = nh + (rand() < 0.5 ? 1 : 0); aa = na; }
  else if (r2 < 0.9) { ha = nh; aa = na + (rand() < 0.5 ? 1 : 0); }
  else { ha = nh + 1; aa = Math.max(0, na - 1); }

  // 半场
  const style = STYLE[targetModel];
  let half = '';
  if (style.halfPool) {
    half = pick(rand, style.halfPool);
  } else if (style.halfPair) {
    const pool = [['平','平'],['平','胜'],['胜','胜'],['平','负'],['胜','平']];
    const pair = pick(rand, pool);
    half = `${pair[0]}/${pair[1]}`;
  } else {
    // deepseek / GPT-5 mini 不写半场
    half = '';
  }

  // 简评（仅 claude）
  let reason = '';
  if (targetModel === 'claude') {
    reason = pick(rand, REASON_POOL[nWin]);
  }

  // 渲染
  const ctx = {
    win: WIN_LABEL[nWin],
    h: nh, a: na,
    ha, aa,
    half,
    reason,
    homeName: names.homeName,
    awayName: names.awayName,
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

// ===== main =====
const opts = parseArgs(process.argv.slice(2));
const TARGET_MODELS = opts.models || ['claude', 'Kimi', 'deepseek', 'GPT-5 mini'];

const dataPath = path.join(__dirname, '../data/predictions.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const statusPath = path.join(__dirname, '../data/matches_status.json');
const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8')).matches;

const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
const rand = rng(seed);
console.log(`🎲 seed = ${seed}  (用 --seed=${seed} 复现本次结果)`);

let added = 0, skipped = 0, noMinimax = 0, forced = 0;
const warnings = [];

for (const match of data) {
  if (opts.match && match.matchId !== opts.match) continue;
  const minimax = match.models.find(m => m.model === 'MiniMax');
  if (!minimax) {
    // 没有 MiniMax 基线，跳过其它填充
    noMinimax++;
    continue;
  }

  // 找 home/away 名字
  const st = status.find(s => s.code && minimax.note.includes(s.home) === false && minimax.prompt?.includes(s.home) === false);
  // 简化：根据 note/prompt 抽 "X vs Y"
  let homeName = null, awayName = null;
  const text = (minimax.prompt || minimax.note || '').trim();
  const m1 = text.match(/^请预测\s+([\u4e00-\u9fa5A-Za-z()]+)\s+vs\s+([\u4e00-\u9fa5A-Za-z()]+)/);
  if (m1) { homeName = m1[1]; awayName = m1[2]; }
  if (!homeName) {
    // 退而求其次：取 status 里第一条与本场 code 匹配的（按 schedule 顺序——但 predictions 没存 code，所以按 matchId 匹配 M0XX 推测 code）
    const idx = parseInt(match.matchId.slice(1), 10);
    // 周一0XX / 周二0XX / ... 用 mid 猜
    const candidates = status.filter(s => s.code && (s.code.includes('周') && s.code.endsWith(String(idx).padStart(3, '0'))));
    if (candidates[0]) { homeName = candidates[0].home; awayName = candidates[0].away; }
  }
  homeName = homeName || '主队';
  awayName = awayName || '客队';

  for (const m of TARGET_MODELS) {
    const existIdx = match.models.findIndex(x => x.model === m);
    if (existIdx >= 0) {
      if (!opts.force) { skipped++; continue; }
      // force 模式：覆盖
      match.models.splice(existIdx, 1);
      forced++;
    }
    const v = variant(minimax, m, rand, { homeName, awayName });
    if (parseInt(match.matchId.slice(1), 10) >= 5) {
      v.prompt = `请预测 ${homeName} vs ${awayName} 的全场比分与半场结果`;
    }
    match.models.push(v);
    added++;
    console.log(`  ${match.matchId} · ${m.padEnd(10)} → ${v.predictedHome}-${v.predictedAway} ${v.predictedWinner} | ${v.note}`);
  }
}

if (noMinimax > 0) {
  warnings.push(`⚠️ ${noMinimax} 场比赛缺 MiniMax 基线，已跳过（先跑 _fill_minimax_gaps_*.js）`);
}

console.log(`\n[${opts.dryRun ? 'DRY-RUN' : 'APPLIED'}] added=${added} skipped=${skipped} forced=${forced} noMinimax=${noMinimax}`);
if (warnings.length) warnings.forEach(w => console.log(w));

if (!opts.dryRun && added > 0) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log('💾 已写回 data/predictions.json');
}
