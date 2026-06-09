// 一次性脚本：解析 预测.md 中的小组赛预测，写入 data/predictions.json
// 用法：node scripts/parse-group-predictions.cjs
// 行为：
//  1. 读取 预测.md 中 # 2026-6-9 段的所有比赛
//  2. 按 team-code 映射匹配 matches.json 中的 matchId
//  3. 在 data/predictions.json 末尾追加新预测，已存在则跳过
//  4. 控制台输出每条 matchId + 模型摘要

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const mdPath = path.join(ROOT, '预测.md');
const matchesPath = path.join(ROOT, 'data', 'matches.json');
const predictionsPath = path.join(ROOT, 'data', 'predictions.json');

const nameToCode = {
  卡塔尔: 'QAT', 瑞士: 'SUI',
  巴西: 'BRA', 摩洛哥: 'MAR',
  海地: 'HAI', 苏格兰: 'SCO',
  澳大利亚: 'AUS', 土耳其: 'TUR',
  德国: 'GER', 库拉索: 'CUW',
  荷兰: 'NED', 日本: 'JPN',
  科特迪瓦: 'CIV', 厄瓜多尔: 'ECU',
  瑞典: 'SWE', 突尼斯: 'TUN',
  西班牙: 'ESP', 佛得角: 'CPV',
  比利时: 'BEL', 埃及: 'EGY',
  沙特: 'KSA', 乌拉圭: 'URU',
  伊朗: 'IRN', 新西兰: 'NZL',
};

const winnerMap = { 主胜: 'home', 客胜: 'away', 平: 'draw' };

function parsePredictionsMd(md) {
  // 找最后一个 # YYYY-M-D 段
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let dateIdx = -1, dateLabel = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^# (\d{4}-\d{1,2}-\d{1,2})\s*$/);
    if (m) { dateIdx = i; dateLabel = m[1]; break; }
  }
  if (dateIdx < 0) throw new Error('预测.md 找不到日期段');

  // 切出比赛段：每个 ## 块
  const matches = [];
  let cur = null;
  for (let i = dateIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const mHead = line.match(/^## (.+?)\s*$/);
    if (mHead) {
      if (cur) matches.push(cur);
      const [home, away] = mHead[1].split(/\s*vs\s*/).map(s => s.trim());
      cur = { home, away, homeCode: nameToCode[home], awayCode: nameToCode[away], models: [], curModel: null };
      continue;
    }
    if (!cur) continue;
    const mModel = line.match(/^### (.+?)\s*$/);
    if (mModel) {
      cur.curModel = { name: mModel[1], lines: [] };
      cur.models.push(cur.curModel);
      continue;
    }
    if (cur.curModel) cur.curModel.lines.push(line);
  }
  if (cur) matches.push(cur);

  // 解析每个模型块
  const out = [];
  for (const m of matches) {
    if (!m.homeCode || !m.awayCode) throw new Error(`未映射到 code: ${m.home} vs ${m.away}`);
    const parsed = [];
    for (const md of m.models) {
      const text = md.lines.join('\n');
      const verdict = (text.match(/^(主胜|客胜|平)\s*$/m) || [])[1];
      const score = (text.match(/比分：(\d+)-(\d+)\s*\/\s*(\d+)-(\d+)/) || []);
      const ht = (text.match(/半场胜负：(主胜|客胜|平|胜)/) || [])[1];
      if (!verdict || score.length < 5 || !ht) {
        throw new Error(`解析失败 ${m.home} vs ${m.away} / ${md.name}\n---\n${text}\n---`);
      }
      const htNorm = ht === '胜' ? '主胜' : ht;
      parsed.push({
        model: md.name,
        predictedHome: parseInt(score[1], 10),
        predictedAway: parseInt(score[2], 10),
        predictedWinner: winnerMap[verdict],
        htRaw: htNorm,
        altHome: parseInt(score[3], 10),
        altAway: parseInt(score[4], 10),
      });
    }
    if (parsed.length !== 5) throw new Error(`${m.home} vs ${m.away} 模型数 ${parsed.length} ≠ 5`);
    out.push({ home: m.home, away: m.away, homeCode: m.homeCode, awayCode: m.awayCode, models: parsed });
  }
  return { dateLabel, matches: out };
}

function main() {
  const md = fs.readFileSync(mdPath, 'utf8');
  const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf8'));

  const { dateLabel, matches: parsed } = parsePredictionsMd(md);
  console.log(`\n== ${dateLabel} 解析到 ${parsed.length} 场比赛 ==`);

  let appended = 0, skipped = 0;
  for (const p of parsed) {
    const m = matches.find(x => x.home === p.homeCode && x.away === p.awayCode);
    if (!m) { console.warn(`✗ ${p.home} vs ${p.away} (${p.homeCode} vs ${p.awayCode}) 在 matches.json 里找不到`); continue; }
    if (predictions.some(x => x.matchId === m.id)) { console.log(`· ${m.id} 已存在，跳过`); skipped++; continue; }
    const entry = {
      matchId: m.id,
      models: p.models.map(md => {
        const verdictZh = md.predictedWinner === 'home' ? '主胜' : md.predictedWinner === 'away' ? '客胜' : '平';
        return {
          model: md.model,
          prompt: `请预测 ${p.homeCode} vs ${p.awayCode} 的全场比分与半场结果`,
          predictedHome: md.predictedHome,
          predictedAway: md.predictedAway,
          predictedWinner: md.predictedWinner,
          screenshots: [],
          note: `全场${verdictZh} ${md.predictedHome}-${md.predictedAway}（备选 ${md.altHome}-${md.altAway}），半场${md.htRaw}`,
        };
      }),
    };
    predictions.push(entry);
    appended++;
    const summary = entry.models.map(x => x.model + ':' + x.predictedHome + '-' + x.predictedAway + '/' + x.predictedWinner).join('  ');
    console.log(`+ ${m.id} ${p.homeCode} vs ${p.awayCode}\n    ${summary}`);
  }

  fs.writeFileSync(predictionsPath, JSON.stringify(predictions, null, 2) + '\n', 'utf8');
  console.log(`\n完成：新增 ${appended} 条，跳过 ${skipped} 条，文件路径 ${path.relative(ROOT, predictionsPath)}`);
}

main();
