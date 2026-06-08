// 每日更新脚本：使用 chrome-devtools-mcp 抓取赔率/数据
// 用法：调用此函数时传入需要更新的 mid 列表

// 比赛ID列表（按需要增删）
const MATCH_IDS = [
  '2040162',  // 周四001 墨西哥 vs 南非
  '2040163',  // 周四002 韩国 vs 捷克
  '2040164',  // 周五003 加拿大 vs 波黑
  '2040165',  // 周五004 美国 vs 巴拉圭
  '2040166',  // 周六005 卡塔尔 vs 瑞士
  '2040167',  // 周六006 巴西 vs 摩洛哥
  '2040145',  // 周一201 荷兰 vs 乌兹别克
  '2040146',  // 周一202 法国 vs 北爱尔兰
  '2040147',  // 周一203 秘鲁 vs 西班牙
  '2040186',  // 周二201 中国 vs 泰国
  '2040187',  // 周二202 匈牙利 vs 哈萨克
  '2040188',  // 周二203 阿根廷 vs 冰岛
  '2040189',  // 周三201 葡萄牙 vs 尼日利亚
  '2040190',  // 周三202 英格兰 vs 哥斯达黎加
  // 热门世界杯
  // '2040170',  // 德国 vs 库拉索
  // '2040171',  // 荷兰 vs 日本
  // '2040172',  // 法国 vs 塞内加尔
  // '2040173',  // 阿根廷 vs 阿尔及利亚
  // '2040174',  // 英格兰 vs 克罗地亚
];

const BASE_URL = 'https://www.sporttery.cn/jc/zqdz/index.html';

/**
 * 抓取单个比赛的基础信息和赔率
 * @param {string} mid 比赛ID
 * @returns {object} 包含基础信息和赔率的对象
 */
async function scrapeMatchOdds(mid) {
  const url = `${BASE_URL}?showType=2&mid=${mid}`;
  if (location.href !== url) {
    location.href = url;
    await new Promise(r => setTimeout(r, 3000));
  }
  await new Promise(r => setTimeout(r, 1000));

  // 切换到固定奖金tab
  const tabs = document.querySelectorAll('.m-tabs li a');
  let oddsTab = null;
  tabs.forEach(t => {
    if (t.textContent.trim() === '固定奖金') oddsTab = t;
  });
  if (oddsTab) oddsTab.click();
  await new Promise(r => setTimeout(r, 800));

  // 抓取赔率
  const tables = document.querySelectorAll('table');
  const odds = {};

  if (tables[1]) {
    const row = tables[1].querySelectorAll('tr')[1];
    const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim());
    if (cells.length >= 4) {
      odds.spf_latest = {
        home: parseFloat(cells[1]),
        draw: parseFloat(cells[2]),
        away: parseFloat(cells[3])
      };
      odds.spf_history = [{ time: cells[0], ...odds.spf_latest }];
    }
  }

  if (tables[2]) {
    const headerCell = tables[2].querySelector('tr th, tr td');
    if (headerCell) {
      const m = headerCell.textContent.match(/让球(-?\d+)/);
      if (m) odds.handicap = parseInt(m[1]);
    }
    const row = tables[2].querySelectorAll('tr')[1];
    const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim());
    if (cells.length >= 4) {
      odds.rqspf_latest = {
        home: parseFloat(cells[1]),
        draw: parseFloat(cells[2]),
        away: parseFloat(cells[3])
      };
      odds.rqspf_history = [{ time: cells[0], ...odds.rqspf_latest }];
    }
  }

  if (tables[4]) {
    const row = tables[4].querySelectorAll('tr')[1];
    const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim());
    if (cells.length >= 9) {
      odds.zjq_latest = {
        '0': parseFloat(cells[1]),
        '1': parseFloat(cells[2]),
        '2': parseFloat(cells[3]),
        '3': parseFloat(cells[4]),
        '4': parseFloat(cells[5]),
        '5': parseFloat(cells[6]),
        '6': parseFloat(cells[7]),
        '7+': parseFloat(cells[8])
      };
    }
  }

  if (tables[5]) {
    const row = tables[5].querySelectorAll('tr')[1];
    const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim());
    if (cells.length >= 10) {
      odds.bqc_latest = {
        '胜胜': parseFloat(cells[1]),
        '胜平': parseFloat(cells[2]),
        '胜负': parseFloat(cells[3]),
        '平胜': parseFloat(cells[4]),
        '平平': parseFloat(cells[5]),
        '平负': parseFloat(cells[6]),
        '负胜': parseFloat(cells[7]),
        '负平': parseFloat(cells[8]),
        '负负': parseFloat(cells[9])
      };
    }
  }

  // 比分赔率：通过表头特征定位（避免让球+/- 时表格顺序变化）
  // 比分表头一定包含 "1 : 0"
  const homeScores = ['1:0','2:0','2:1','3:0','3:1','3:2','4:0','4:1','4:2','5:0','5:1','5:2','胜其它'];
  const drawScores = ['0:0','1:1','2:2','3:3','平其它'];
  const awayScores = ['0:1','0:2','1:2','0:3','1:3','2:3','0:4','1:4','2:4','0:5','1:5','2:5','负其它'];
  let bfTable = null;
  for (const t of tables) {
    const headerCells = Array.from(t.querySelectorAll('tr')[0]?.querySelectorAll('th, td') || [])
      .map(c => c.textContent.trim());
    if (headerCells.some(c => c.replace(/\s+/g, '') === '1:0')) {
      bfTable = t;
      break;
    }
  }
  if (bfTable) {
    const allCells = Array.from(bfTable.querySelectorAll('tr')).map(r =>
      Array.from(r.querySelectorAll('td, th')).map(c => c.textContent.trim())
    );
    // 第 1 行 = 主胜方向 13 个比分（1:0 ~ 5:2 + 胜其它）
    // 第 2 行 = 平方向 5 个比分（0:0 ~ 3:3 + 平其它）的标签
    // 第 3 行 = 平方向 5 个赔率
    // 第 4 行 = 客胜方向 13 个比分（0:1 ~ 2:5 + 负其它）的标签
    // 第 5 行 = 客胜方向 13 个赔率
    const r1 = allCells[1] || [];
    const r3 = allCells[3] || [];
    const r5 = allCells[5] || [];

    const bf = {};
    homeScores.forEach((s, i) => { if (r1[i + 1]) bf[s] = parseFloat(r1[i + 1]); });
    drawScores.forEach((s, i) => { if (r3[i]) bf[s] = parseFloat(r3[i]); });
    awayScores.forEach((s, i) => { if (r5[i]) bf[s] = parseFloat(r5[i]); });

    if (Object.keys(bf).length > 0) {
      odds.bf_latest = bf;
    }
  }

  return { mid, odds, scraped_at: new Date().toISOString() };
}

/**
 * 抓取赛事前瞻数据
 */
async function scrapeMatchPreview(mid) {
  const url = `${BASE_URL}?showType=2&mid=${mid}`;
  if (location.href !== url) {
    location.href = url;
    await new Promise(r => setTimeout(r, 3000));
  }
  await new Promise(r => setTimeout(r, 1000));

  // 切换到赛事前瞻tab
  const tabs = document.querySelectorAll('.m-tabs li a');
  let previewTab = null;
  tabs.forEach(t => {
    if (t.textContent.trim() === '赛事前瞻') previewTab = t;
  });
  if (previewTab) previewTab.click();
  await new Promise(r => setTimeout(r, 1500));

  const text = document.body.innerText;
  const recent10 = [];

  // 通过文本模式匹配战绩
  const homeMatch = text.match(/([\u4e00-\u9fa5]+)近10场(\d+)胜\s*\((\d+)%\)\s*\|\s*(\d+)平\s*\((\d+)%\)\s*\|\s*(\d+)负\s*\((\d+)%\)\s*进(\d+)球，失(\d+)球/);
  if (homeMatch) {
    recent10.push({
      team: homeMatch[1],
      wins: parseInt(homeMatch[2]),
      winPct: parseInt(homeMatch[3]),
      draws: parseInt(homeMatch[4]),
      drawPct: parseInt(homeMatch[5]),
      losses: parseInt(homeMatch[6]),
      lossPct: parseInt(homeMatch[7]),
      gf: parseInt(homeMatch[8]),
      ga: parseInt(homeMatch[9])
    });
  }

  const awayMatch = text.match(/([\u4e00-\u9fa5]+)近10场(\d+)胜\s*\((\d+)%\)\s*\|\s*(\d+)平\s*\((\d+)%\)\s*\|\s*(\d+)负\s*\((\d+)%\)\s*进(\d+)球，失(\d+)球/g);
  if (awayMatch && awayMatch[1]) {
    const m = awayMatch[1].match(/([\u4e00-\u9fa5]+)近10场(\d+)胜\s*\((\d+)%\)\s*\|\s*(\d+)平\s*\((\d+)%\)\s*\|\s*(\d+)负\s*\((\d+)%\)\s*进(\d+)球，失(\d+)球/);
    if (m) {
      recent10.push({
        team: m[1],
        wins: parseInt(m[2]),
        winPct: parseInt(m[3]),
        draws: parseInt(m[4]),
        drawPct: parseInt(m[5]),
        losses: parseInt(m[6]),
        lossPct: parseInt(m[7]),
        gf: parseInt(m[8]),
        ga: parseInt(m[9])
      });
    }
  }

  return { mid, recent_10: recent10, scraped_at: new Date().toISOString() };
}

export { MATCH_IDS, scrapeMatchOdds, scrapeMatchPreview };
