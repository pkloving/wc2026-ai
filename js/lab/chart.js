// js/lab/chart.js — 简单 SVG 图表（无依赖）
// 用法:  import { drawEquity, drawROI } from './chart.js';
//        drawEquity(svgEl, [{x,y}, ...], { width, height });
//
// 风格:  深色 #0B1F3A 背景, 金色 #D4AF37 折线, 灰线 baseline, 0 分割线

const COLORS = {
  bg: '#0B1F3A',
  fg: '#D4AF37',
  grid: '#1F3A5F',
  baseline: '#7A8FA8',
  neg: '#E63946',
  pos: '#06D6A0',
  text: '#E8E8E8',
  dimText: '#A0A8B8',
};

function svgEl(w, h) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('role', 'img');
  return svg;
}

function path(pts) {
  if (!pts.length) return '';
  return 'M ' + pts.map((p) => `${p.x},${p.y}`).join(' L ');
}

function scale(points, opts) {
  const { width, height, padX = 40, padY = 20, xMin, xMax, yMin, yMax } = opts;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = xMin ?? Math.min(...xs);
  const x1 = xMax ?? Math.max(...xs);
  const y0 = yMin ?? Math.min(0, ...ys);
  const y1 = yMax ?? Math.max(0, ...ys);
  const dx = x1 - x0 || 1;
  const dy = y1 - y0 || 1;
  return points.map((p) => ({
    x: padX + ((p.x - x0) / dx) * (width - 2 * padX),
    y: height - padY - ((p.y - y0) / dy) * (height - 2 * padY),
  }));
}

/** 累计净收益折线图 */
export function drawEquity(svgTarget, points, opts = {}) {
  const w = opts.width || 600;
  const h = opts.height || 200;
  const svg = svgEl(w, h);
  svg.style.background = COLORS.bg;
  svg.style.borderRadius = '6px';
  svg.style.display = 'block';

  if (!points.length) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', w / 2); t.setAttribute('y', h / 2);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', COLORS.dimText);
    t.textContent = '— no data —';
    svg.appendChild(t);
    svgTarget.replaceChildren(svg);
    return;
  }

  const y0 = Math.min(0, ...points.map((p) => p.y));
  const y1 = Math.max(0, ...points.map((p) => p.y));
  const x0 = points[0].x;
  const x1 = points[points.length - 1].x;

  // 0 分割线
  const sc = scale(points, { width: w, height: h, xMin: x0, xMax: x1, yMin: y0, yMax: y1 });
  const zeroY = h - 20 - ((0 - y0) / (y1 - y0 || 1)) * (h - 40);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', 0); line.setAttribute('x2', w);
  line.setAttribute('y1', zeroY); line.setAttribute('y2', zeroY);
  line.setAttribute('stroke', COLORS.baseline); line.setAttribute('stroke-dasharray', '4 4');
  line.setAttribute('stroke-width', 1);
  svg.appendChild(line);

  // 0 label
  const zeroLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  zeroLbl.setAttribute('x', 4); zeroLbl.setAttribute('y', zeroY - 4);
  zeroLbl.setAttribute('fill', COLORS.dimText);
  zeroLbl.setAttribute('font-size', '10');
  zeroLbl.textContent = '0';
  svg.appendChild(zeroLbl);

  // y-axis min/max
  [y0, y1].forEach((y, i) => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const ty = i === 0 ? h - 6 : 12;
    t.setAttribute('x', 4); t.setAttribute('y', ty);
    t.setAttribute('fill', COLORS.dimText); t.setAttribute('font-size', '10');
    t.textContent = (y > 0 ? '+' : '') + y.toFixed(0);
    svg.appendChild(t);
  });

  // 折线
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path(sc));
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', COLORS.fg);
  p.setAttribute('stroke-width', 2);
  svg.appendChild(p);

  // 终值
  const last = sc[sc.length - 1];
  const finalT = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  finalT.setAttribute('x', last.x - 4); finalT.setAttribute('y', last.y - 6);
  finalT.setAttribute('text-anchor', 'end');
  finalT.setAttribute('fill', last.y < zeroY ? COLORS.pos : COLORS.neg);
  finalT.setAttribute('font-size', '12'); finalT.setAttribute('font-weight', 'bold');
  finalT.textContent = (last.y < zeroY ? '+' : '') + points[points.length - 1].y.toFixed(0);
  svg.appendChild(finalT);

  // x-axis label
  const xLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  xLbl.setAttribute('x', w - 4); xLbl.setAttribute('y', h - 4);
  xLbl.setAttribute('text-anchor', 'end');
  xLbl.setAttribute('fill', COLORS.dimText); xLbl.setAttribute('font-size', '10');
  xLbl.textContent = `n = ${points.length}`;
  svg.appendChild(xLbl);

  svgTarget.replaceChildren(svg);
}

/** 双届 ROI 条形图 */
export function drawROI(svgTarget, rows, opts = {}) {
  const w = opts.width || 320;
  const h = opts.height || 100;
  const svg = svgEl(w, h);
  svg.style.background = COLORS.bg;
  svg.style.borderRadius = '6px';
  svg.style.display = 'block';

  if (!rows.length) {
    svgTarget.replaceChildren(svg);
    return;
  }
  const yMax = Math.max(...rows.map((r) => Math.abs(r.value)), 10);
  const barH = 22;
  const gap = 8;
  const labelW = 60;
  const valueW = 60;
  const barAreaW = w - labelW - valueW - 20;
  const zeroX = labelW + barAreaW / 2;

  rows.forEach((r, i) => {
    const y = 10 + i * (barH + gap);
    const v = r.value;
    const barW = (Math.abs(v) / yMax) * (barAreaW / 2);
    // 标签
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', 8); t.setAttribute('y', y + barH / 2 + 4);
    t.setAttribute('fill', COLORS.text); t.setAttribute('font-size', '11');
    t.textContent = r.label;
    svg.appendChild(t);
    // 0 分割
    const zeroLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    zeroLine.setAttribute('x1', zeroX); zeroLine.setAttribute('x2', zeroX);
    zeroLine.setAttribute('y1', y); zeroLine.setAttribute('y2', y + barH);
    zeroLine.setAttribute('stroke', COLORS.baseline); zeroLine.setAttribute('stroke-width', 1);
    svg.appendChild(zeroLine);
    // bar
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bar.setAttribute('x', v >= 0 ? zeroX : zeroX - barW);
    bar.setAttribute('y', y + 2);
    bar.setAttribute('width', barW); bar.setAttribute('height', barH - 4);
    bar.setAttribute('fill', v >= 0 ? COLORS.pos : COLORS.neg);
    bar.setAttribute('opacity', '0.85');
    svg.appendChild(bar);
    // value
    const vt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    vt.setAttribute('x', w - 4); vt.setAttribute('y', y + barH / 2 + 4);
    vt.setAttribute('text-anchor', 'end');
    vt.setAttribute('fill', v >= 0 ? COLORS.pos : COLORS.neg);
    vt.setAttribute('font-size', '11'); vt.setAttribute('font-weight', 'bold');
    vt.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    svg.appendChild(vt);
  });
  svgTarget.replaceChildren(svg);
}

export const ChartColors = COLORS;
