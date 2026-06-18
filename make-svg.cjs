const fs = require('fs');
const path = require('path');

// 数据准备
const data = [
  {code:'周四001', date:'06-12', home:'墨西哥', away:'南非', score:'2-0', bfKey:'02:00', bf:4.00, spf:'1.26/4.45/9.00', hc:'-1', rqspf:'2.00/3.25/3.11'},
  {code:'周四002', date:'06-12', home:'韩国', away:'捷克', score:'2-1', bfKey:'02:01', bf:7.00, spf:'2.49/2.75/2.75', hc:'-1', rqspf:'6.25/4.00/1.39'},
  {code:'周五003', date:'06-13', home:'加拿大', away:'波黑', score:'1-1', bfKey:'01:01', bf:4.75, spf:'1.62/3.32/4.75', hc:'-1', rqspf:'3.58/2.90/1.98'},
  {code:'周五004', date:'06-13', home:'美国', away:'巴拉圭', score:'4-1', bfKey:'04:01', bf:65.00, spf:'1.79/3.25/3.80', hc:'-1', rqspf:'4.02/3.08/1.80'},
  {code:'周六005', date:'06-14', home:'卡塔尔', away:'瑞士', score:'1-1', bfKey:'01:01', bf:14.50, spf:'-/-/-', hc:'+2', rqspf:'2.35/3.42/2.43'},
  {code:'周六006', date:'06-14', home:'巴西', away:'摩洛哥', score:'1-1', bfKey:'01:01', bf:6.05, spf:'1.50/3.60/5.40', hc:'-1', rqspf:'2.95/2.91/2.24'},
  {code:'周六007', date:'06-14', home:'海地', away:'苏格兰', score:'0-1', bfKey:'00:01', bf:8.25, spf:'7.40/4.12/1.33', hc:'+1', rqspf:'2.70/3.75/2.03'},
  {code:'周六008', date:'06-14', home:'澳大利亚', away:'土耳其', score:'2-0', bfKey:'02:00', bf:32.00, spf:'5.55/3.78/1.46', hc:'+1', rqspf:'2.28/2.95/2.84'},
  {code:'周日009', date:'06-15', home:'德国', away:'库拉索', score:'7-1', bfKey:'胜其它', bf:3.80, spf:'-/-/-', hc:'-3', rqspf:'1.65/4.85/3.15'},
  {code:'周日010', date:'06-15', home:'荷兰', away:'日本', score:'2-2', bfKey:'02:02', bf:11.00, spf:'1.86/3.33/3.43', hc:'-1', rqspf:'4.00/3.40/1.71'},
  {code:'周日011', date:'06-15', home:'科特迪瓦', away:'厄瓜多尔', score:'1-0', bfKey:'01:00', bf:7.25, spf:'3.15/2.65/2.30', hc:'+1', rqspf:'1.45/3.80/5.65'},
  {code:'周日012', date:'06-15', home:'瑞典', away:'突尼斯', score:'5-1', bfKey:'05:01', bf:100.00, spf:'1.74/3.10/4.30', hc:'-1', rqspf:'3.55/3.30/1.84'},
  {code:'周一013', date:'06-16', home:'西班牙', away:'佛得角', score:'0-0', bfKey:'00:00', bf:42.00, spf:'-/-/-', hc:'-2', rqspf:'1.46/4.70/4.32'},
  {code:'周一014', date:'06-16', home:'比利时', away:'埃及', score:'1-1', bfKey:'01:01', bf:6.70, spf:'1.43/3.85/5.86', hc:'-1', rqspf:'2.35/3.42/2.43'},
  {code:'周一015', date:'06-16', home:'沙特', away:'乌拉圭', score:'1-1', bfKey:'01:01', bf:6.90, spf:'7.20/4.30/1.32', hc:'+1', rqspf:'2.83/3.10/2.21'},
  {code:'周一016', date:'06-16', home:'伊朗', away:'新西兰', score:'2-2', bfKey:'02:02', bf:19.00, spf:'1.55/3.38/5.30', hc:'-1', rqspf:'2.87/3.30/2.09'},
  {code:'周二017', date:'06-17', home:'法国', away:'塞内加尔', score:'3-1', bfKey:'03:01', bf:8.75, spf:'1.32/4.20/7.45', hc:'-1', rqspf:'2.07/3.45/2.81'},
  {code:'周二018', date:'06-17', home:'伊拉克', away:'挪威', score:'1-4', bfKey:'01:04', bf:15.00, spf:'-/-/-', hc:'+2', rqspf:'2.30/3.88/2.29'},
  {code:'周二019', date:'06-17', home:'阿根廷', away:'阿尔及利亚', score:'3-0', bfKey:'03:00', bf:8.50, spf:'1.29/4.20/8.60', hc:'-1', rqspf:'2.09/3.17/2.98'},
  {code:'周二020', date:'06-17', home:'奥地利', away:'约旦', score:'3-1', bfKey:'03:01', bf:8.50, spf:'1.25/4.75/8.40', hc:'-1', rqspf:'1.78/3.90/3.21'},
];

// 使用svg尺寸: 2400x3200 (高清晰)
const W = 2400, H = 3200;
const margin = 80;
const colW = (W - margin*2) / 8;

// 颜色
const C = {
  bg: '#0a1628',
  bg2: '#0f1e35',
  card: '#142943',
  border: '#1e3a5f',
  text: '#e8eef7',
  textDim: '#7a8fa8',
  gold: '#ffd700',
  goldDim: '#b8941f',
  red: '#ff4757',
  green: '#2ed573',
  cyan: '#00d4ff',
  purple: '#a55eea',
};

function getOddsTier(odds) {
  if (odds === '-' || odds === null) return 'na';
  const v = parseFloat(odds);
  if (isNaN(v)) return 'na';
  if (v < 8) return 'low';
  if (v <= 15) return 'mid';
  return 'high';
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
svg += `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.bg}"/>
    <stop offset="1" stop-color="${C.bg2}"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#ffd700"/>
    <stop offset="1" stop-color="#ffaa00"/>
  </linearGradient>
</defs>`;

// 背景
svg += `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;

// 装饰圆
svg += `<circle cx="${W-200}" cy="200" r="300" fill="${C.gold}" opacity="0.04"/>`;
svg += `<circle cx="200" cy="${H-200}" r="400" fill="${C.cyan}" opacity="0.03"/>`;

// 顶部 Header
svg += `<text x="${margin}" y="180" font-family="Arial Black, sans-serif" font-size="96" font-weight="900" fill="url(#gold)" letter-spacing="2">FIFA WORLD CUP 2026</text>`;
svg += `<text x="${margin}" y="240" font-family="Arial, sans-serif" font-size="36" font-weight="400" fill="${C.textDim}" letter-spacing="8">FINISHED MATCHES · SCORE ODDS</text>`;
svg += `<line x1="${margin}" y1="280" x2="${W-margin}" y2="280" stroke="${C.gold}" stroke-width="2"/>`;

// 数据统计
const total = data.length;
const homeWins = data.filter(d => parseInt(d.score.split('-')[0]) > parseInt(d.score.split('-')[1])).length;
const draws = data.filter(d => parseInt(d.score.split('-')[0]) === parseInt(d.score.split('-')[1])).length;
const awayWins = data.filter(d => parseInt(d.score.split('-')[0]) < parseInt(d.score.split('-')[1])).length;

svg += `<g transform="translate(${margin},310)">
  <rect width="540" height="90" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
  <text x="20" y="35" font-family="Arial, sans-serif" font-size="20" fill="${C.textDim}">已完赛场次</text>
  <text x="20" y="75" font-family="Arial Black, sans-serif" font-size="44" font-weight="900" fill="${C.text}">${total}</text>
  <text x="220" y="35" font-family="Arial, sans-serif" font-size="20" fill="${C.textDim}">主胜</text>
  <text x="220" y="75" font-family="Arial Black, sans-serif" font-size="44" font-weight="900" fill="${C.green}">${homeWins}</text>
  <text x="340" y="35" font-family="Arial, sans-serif" font-size="20" fill="${C.textDim}">平局</text>
  <text x="340" y="75" font-family="Arial Black, sans-serif" font-size="44" font-weight="900" fill="${C.cyan}">${draws}</text>
  <text x="460" y="35" font-family="Arial, sans-serif" font-size="20" fill="${C.textDim}">客胜</text>
  <text x="460" y="75" font-family="Arial Black, sans-serif" font-size="44" font-weight="900" fill="${C.red}">${awayWins}</text>
</g>`;

const statsX = margin + 580;
svg += `<g transform="translate(${statsX},310)">
  <rect width="600" height="90" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
  <text x="20" y="35" font-family="Arial, sans-serif" font-size="20" fill="${C.textDim}">数据源</text>
  <text x="20" y="75" font-family="Arial Black, sans-serif" font-size="28" font-weight="700" fill="${C.text}">sporttery.cn</text>
  <text x="260" y="35" font-family="Arial, sans-serif" font-size="20" fill="${C.textDim}">赔率档位</text>
  <text x="260" y="60" font-family="Arial, sans-serif" font-size="18" fill="${C.green}">● 低 &lt; 8</text>
  <text x="370" y="60" font-family="Arial, sans-serif" font-size="18" fill="${C.gold}">● 中 8-15</text>
  <text x="480" y="60" font-family="Arial, sans-serif" font-size="18" fill="${C.red}">● 高 &gt; 15</text>
  <text x="260" y="85" font-family="Arial, sans-serif" font-size="16" fill="${C.textDim}">截止 2026-06-18</text>
</g>`;

// 图例
const legendX = margin + 1220;
svg += `<g transform="translate(${legendX},310)">
  <rect width="440" height="90" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
  <text x="20" y="35" font-family="Arial, sans-serif" font-size="20" fill="${C.textDim}">最高比分赔率</text>
  <text x="20" y="75" font-family="Arial Black, sans-serif" font-size="32" font-weight="900" fill="${C.red}">100.00</text>
  <text x="200" y="70" font-family="Arial, sans-serif" font-size="18" fill="${C.text}">瑞典 5-1 突尼斯</text>
  <text x="200" y="90" font-family="Arial, sans-serif" font-size="16" fill="${C.textDim}">05:01 · 周日012</text>
</g>`;

// 表头
const tableY = 460;
const headers = [
  {label:'场次', x: margin + colW*0, align:'left'},
  {label:'日期', x: margin + colW*1, align:'center'},
  {label:'主队', x: margin + colW*2, align:'left'},
  {label:'客队', x: margin + colW*3, align:'left'},
  {label:'比分', x: margin + colW*4, align:'center'},
  {label:'比分赔率', x: margin + colW*5, align:'center'},
  {label:'让球', x: margin + colW*6, align:'center'},
  {label:'RQSPF', x: margin + colW*7, align:'left'},
];

svg += `<rect x="${margin}" y="${tableY}" width="${W-margin*2}" height="60" fill="${C.card}" stroke="${C.gold}" stroke-width="2"/>`;
headers.forEach((h, i) => {
  const tx = h.align === 'left' ? h.x + 20 : (h.align === 'center' ? h.x + colW/2 : h.x + colW - 20);
  svg += `<text x="${tx}" y="${tableY+38}" text-anchor="${h.align === 'left' ? 'start' : (h.align === 'center' ? 'middle' : 'end')}" font-family="Arial Black, sans-serif" font-size="24" font-weight="900" fill="${C.gold}" letter-spacing="2">${h.label}</text>`;
});

// 数据行
const rowH = 110;
let y = tableY + 60;
data.forEach((d, i) => {
  const tier = getOddsTier(d.bf);
  let oddsColor = C.text;
  if (tier === 'low') oddsColor = C.green;
  else if (tier === 'mid') oddsColor = C.gold;
  else if (tier === 'high') oddsColor = C.red;

  // 行背景交替
  const rowBg = i % 2 === 0 ? C.card : C.bg2;
  svg += `<rect x="${margin}" y="${y}" width="${W-margin*2}" height="${rowH}" fill="${rowBg}" stroke="${C.border}" stroke-width="1"/>`;

  // 场次
  svg += `<text x="${margin + colW*0 + 20}" y="${y+45}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="${C.text}">${d.code}</text>`;
  svg += `<text x="${margin + colW*0 + 20}" y="${y+75}" font-family="Arial, sans-serif" font-size="16" fill="${C.textDim}">NO.${String(i+1).padStart(2,'0')}</text>`;

  // 日期
  svg += `<text x="${margin + colW*1 + colW/2}" y="${y+60}" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="28" font-weight="900" fill="${C.text}">${d.date}</text>`;

  // 主队
  svg += `<text x="${margin + colW*2 + 20}" y="${y+60}" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${C.text}">${d.home}</text>`;

  // 客队
  svg += `<text x="${margin + colW*3 + 20}" y="${y+60}" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${C.text}">${d.away}</text>`;

  // 比分
  const [h,a] = d.score.split('-');
  svg += `<text x="${margin + colW*4 + colW/2 - 30}" y="${y+65}" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="36" font-weight="900" fill="${C.gold}">${h}</text>`;
  svg += `<text x="${margin + colW*4 + colW/2}" y="${y+65}" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="${C.textDim}">:</text>`;
  svg += `<text x="${margin + colW*4 + colW/2 + 30}" y="${y+65}" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="36" font-weight="900" fill="${C.gold}">${a}</text>`;

  // 比分赔率
  svg += `<text x="${margin + colW*5 + colW/2}" y="${y+45}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="${C.textDim}">${d.bfKey}</text>`;
  svg += `<text x="${margin + colW*5 + colW/2}" y="${y+80}" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="32" font-weight="900" fill="${oddsColor}">${d.bf}</text>`;

  // 让球
  svg += `<text x="${margin + colW*6 + colW/2}" y="${y+60}" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="28" font-weight="900" fill="${C.cyan}">${d.hc}</text>`;

  // RQSPF
  svg += `<text x="${margin + colW*7 + 20}" y="${y+45}" font-family="Arial, sans-serif" font-size="18" fill="${C.textDim}">主/平/客</text>`;
  svg += `<text x="${margin + colW*7 + 20}" y="${y+75}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="${C.text}">${d.rqspf}</text>`;

  y += rowH;
});

// 底部Footer
svg += `<line x1="${margin}" y1="${y+30}" x2="${W-margin}" y2="${y+30}" stroke="${C.gold}" stroke-width="1"/>`;
svg += `<text x="${margin}" y="${y+80}" font-family="Arial, sans-serif" font-size="22" fill="${C.textDim}">WC2026-AI · Sporttery Odds Analytics</text>`;
svg += `<text x="${W-margin}" y="${y+80}" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="${C.textDim}">Generated 2026-06-18 · Page 01</text>`;

svg += `</svg>`;

const outPath = path.join(__dirname, 'worldcup-score-odds.svg');
const buf = Buffer.from(svg, 'utf8');
fs.writeFileSync(outPath, buf);
console.log('Saved to', outPath, 'Size:', buf.length, 'bytes');
