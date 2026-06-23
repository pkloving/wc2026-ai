// frequency.js — 频率图谱页面
// 数据源: data/frequency_atlas.json （由 scripts/build_frequency_atlas.js 预生成）
// 2026 默认展开，2022 默认折叠（首次展开再渲染）
import frequencyAtlas from '../../data/frequency_atlas.json';
import { t } from '../i18n.js';
import { boot } from '../page-boot.js';

boot(() => {
  const data = frequencyAtlas;
  if (!data) {
    document.getElementById('body-2026').innerHTML = `<div class="freq-empty">frequency_atlas.json 缺失，请先运行 <code>node scripts/build_frequency_atlas.js</code></div>`;
    return;
  }

  // 顶部更新时间
  const upd = document.getElementById('upd-at');
  if (upd) upd.textContent = (data.generated_at || '').replace('T', ' ').replace(/\..*$/, '') + ' UTC';

  // 渲染 2026 (默认 open)
  renderYear('2026', data.y2026);
  updateMeta('2026', data.y2026);

  // 折叠/展开交互
  document.querySelectorAll('.freq-year').forEach((head) => {
    const year = head.getAttribute('data-year');
    const onToggle = () => {
      const isOpen = head.getAttribute('data-open') === 'true';
      const next = !isOpen;
      head.setAttribute('data-open', String(next));
      head.setAttribute('aria-expanded', String(next));
      // 2022 默认折叠，body 初始是空的，首次展开时才渲染（节省首屏）
      if (next && year === '2022') {
        const body = document.getElementById('body-2022');
        if (body && body.children.length === 0) {
          renderYear('2022', data.y2022);
        }
      }
    };
    head.addEventListener('click', onToggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
    });
  });
}, { errorTarget: 'body-2026' });

// ============== 渲染单个年份 ==============
function renderYear(year, stat) {
  const body = document.getElementById(`body-${year}`);
  if (!body) return;
  if (!stat || !stat.byPlay) {
    body.innerHTML = `<div class="freq-empty">无数据</div>`;
    return;
  }
  const spf = stat.byPlay.spf || { counts: {}, total: 0 };
  const rqspf = stat.byPlay.rqspf || { counts: {}, total: 0 };
  const bf = stat.byPlay.bf || { top: [], others: {}, total: 0 };
  const zjq = stat.byPlay.zjq || { buckets: [], total: 0 };
  const bqc = stat.byPlay.bqc || { buckets: [], total: 0 };

  // ----- 顶部 5 卡：SPF / RQSPF / ZJQ / BQC / Insights -----
  const spfMax = Math.max(spf.counts.home || 0, spf.counts.draw || 0, spf.counts.away || 0, 1);
  const rqspfMax = Math.max(rqspf.counts.home || 0, rqspf.counts.draw || 0, rqspf.counts.away || 0, 1);
  const zjqMax = Math.max(1, ...(zjq.buckets || []).map((b) => b.pct));
  const bqcMax = Math.max(1, ...(bqc.buckets || []).map((b) => b.pct));

  body.innerHTML = `
    <div class="freq-grid-5">

      <!-- SPF -->
      <div class="freq-card">
        <div class="freq-card-header">01 / ${t('frequency.play.spf')}</div>
        <div class="freq-card-title">SPF<span class="freq-card-title-en">${t('frequency.play.spfEn')}</span></div>
        ${barRow('主胜', spf.counts.home, spf.total, '#f0883e', spfMax)}
        ${barRow('平局', spf.counts.draw, spf.total, '#8b949e', spfMax)}
        ${barRow('客胜', spf.counts.away, spf.total, '#58a6ff', spfMax)}
        <div class="freq-legend">n = ${spf.total} 场${spf.total < (stat.total || 0) ? `（${(stat.total - spf.total)} 场无 spf 玩法）` : ''}</div>
      </div>

      <!-- RQSPF -->
      <div class="freq-card">
        <div class="freq-card-header">02 / ${t('frequency.play.rqspf')}</div>
        <div class="freq-card-title">RQSPF<span class="freq-card-title-en">${t('frequency.play.rqspfEn')}</span></div>
        ${barRow('让胜', rqspf.counts.home, rqspf.total, '#f0883e', rqspfMax)}
        ${barRow('让平', rqspf.counts.draw, rqspf.total, '#8b949e', rqspfMax)}
        ${barRow('让负', rqspf.counts.away, rqspf.total, '#58a6ff', rqspfMax)}
        <div class="freq-legend">n = ${rqspf.total} 场</div>
      </div>

      <!-- ZJQ -->
      <div class="freq-card">
        <div class="freq-card-header">04 / ${t('frequency.play.zjq')}</div>
        <div class="freq-card-title">ZJQ<span class="freq-card-title-en">${t('frequency.play.zjqEn')}</span></div>
        ${(zjq.buckets || []).map((b) => barRowPct(b.label, b.count, b.pct, b.pct, '#388bfd', zjqMax)).join('')}
        <div class="freq-legend">n = ${zjq.total} 场</div>
      </div>

      <!-- BQC -->
      <div class="freq-card">
        <div class="freq-card-header">05 / ${t('frequency.play.bqc')}</div>
        <div class="freq-card-title">BQC<span class="freq-card-title-en">${t('frequency.play.bqcEn')}</span></div>
        <div class="freq-bqc-grid">
          ${(bqc.buckets || []).map((b) => `
            <div class="freq-bqc-row">
              <div class="freq-bqc-dot" style="background:${bqcColor(b.pct, bqcMax)};"></div>
              <div class="freq-bqc-name">${b.label}</div>
              <div class="freq-bqc-pct" style="color:${bqcColor(b.pct, bqcMax)};">${b.pct}%</div>
            </div>`).join('')}
        </div>
        <div class="freq-legend" style="margin-top:12px;">n = ${bqc.total} 场</div>
      </div>

      <!-- Insights -->
      <div class="freq-card freq-insight">
        <div class="freq-card-header">KEY INSIGHTS</div>
        <div class="freq-card-title">核心规律<span class="freq-card-title-en">Market Patterns · ${year}</span></div>
        <div class="freq-insight-list">
          ${insightLine('SPF 主胜', spf.counts.home, spf.total)}
          ${insightLine('RQSPF 让胜', rqspf.counts.home, rqspf.total)}
          ${insightLineTop('ZJQ 2球', zjq.buckets?.find((b) => b.label === '2球'))}
          ${insightLineTop('BQC 胜胜', bqc.buckets?.find((b) => b.label === '胜胜'))}
          <div class="sub">胜胜 > 平胜 > 平平 ≈ 负负</div>
          <div class="sub">主胜 > 让胜 > 让负 > 让平</div>
          <div class="sub">2球 > 4球 > 1球 > 3球 > 0/5+</div>
        </div>
      </div>

    </div>

    <!-- BF 全宽 -->
    <div class="freq-full">
      <div class="freq-card">
        <div class="freq-card-header">03 / ${t('frequency.play.bf')}</div>
        <div class="freq-card-title">BF — ${t('frequency.play.bfEn')}<span class="freq-card-title-en">${bf.top.length} 个不同比分 · n=${bf.total}</span></div>

        ${bf.top.length === 0 ? '<div class="freq-empty">无 BF 数据</div>' : `
          <div class="freq-bf-row">
            ${bf.top.slice(0, 7).map((t) => bfCell(t, 'top')).join('')}
          </div>
          ${bf.top.length > 7 ? `
            <div class="freq-bf-row">
              ${bf.top.slice(7, 19).map((t) => bfCell(t, 'rest')).join('')}
            </div>
          ` : ''}
          ${hasOthers(bf.others) ? `
            <div class="freq-bf-row">
              ${Object.entries(bf.others).filter(([, c]) => c > 0).map(([k, c]) => otherCell(k, c, bf.total)).join('')}
            </div>
          ` : ''}
        `}

        <div class="freq-bf-note">热力分层：琥珀 = 高频（≥9%）· 蓝色 = 中频（≥4%）· 灰色 = 低频（<4%）</div>
      </div>
    </div>
  `;
}

function updateMeta(year, stat) {
  const el = document.getElementById(`meta-${year}`);
  if (!el || !stat) return;
  const total = stat.total || 0;
  const plays = ['spf', 'rqspf', 'bf', 'zjq', 'bqc'].map((p) => {
    const t = stat.byPlay[p];
    return `${p.toUpperCase()}=${t?.total || 0}`;
  }).join(' · ');
  el.textContent = `已完赛 ${total} 场（WC only） · ${plays}`;
}

// ============== helpers ==============
function barRow(label, count, total, color, maxCount) {
  const pct = total > 0 ? +(count / total * 100).toFixed(1) : 0;
  const widthPct = maxCount > 0 ? Math.max(0, (count / maxCount) * 100) : 0;
  return `
    <div class="freq-bar-row">
      <div class="freq-bar-label">${label}</div>
      <div class="freq-bar-track"><div class="freq-bar-fill" style="width:${widthPct}%;background:${color};"></div></div>
      <div class="freq-bar-pct" style="color:${color};">${pct}%</div>
      <div class="freq-bar-count">${count}</div>
    </div>
  `;
}

// 用于 ZJQ/BQC（pct 已有，直接用）
function barRowPct(label, count, pct, _unused, color, maxPct) {
  const widthPct = maxPct > 0 ? Math.max(0, (pct / maxPct) * 100) : 0;
  return `
    <div class="freq-bar-row">
      <div class="freq-bar-label">${label}</div>
      <div class="freq-bar-track"><div class="freq-bar-fill" style="width:${widthPct}%;background:${color};"></div></div>
      <div class="freq-bar-pct" style="color:${color};">${pct}%</div>
      <div class="freq-bar-count">${count}</div>
    </div>
  `;
}

function bqcColor(pct, maxPct) {
  if (pct === 0) return '#484f58';
  if (pct >= maxPct * 0.7) return '#f0883e';
  if (pct >= maxPct * 0.4) return '#e3b341';
  if (pct >= maxPct * 0.2) return '#d29922';
  return '#8b949e';
}

function bfCell(t, kind) {
  // 颜色: 16% 琥珀, 7% 蓝, < 4% 灰
  const color = t.pct >= 9 ? '#f0883e' : t.pct >= 4 ? '#58a6ff' : '#8b949e';
  const bg = kind === 'top' && t.pct >= 9
    ? 'rgba(240,136,62,0.25)'
    : kind === 'top' && t.pct >= 4
      ? 'rgba(240,136,62,0.15)'
      : kind === 'top'
        ? 'rgba(88,166,255,0.15)'
        : kind === 'rest' ? '#1c2128' : '#21262d';
  const border = kind === 'top' && t.pct >= 9
    ? '#f0883e'
    : kind === 'top' ? '#f0883e50' : kind === 'rest' ? '#21262d' : '#30363d';
  return `
    <div class="freq-bf-cell freq-bf-${kind}-cell" style="background:${bg};border:1px solid ${border};">
      <span class="freq-bf-cell-score" style="color:${color};">${t.score}</span>
      <span class="freq-bf-cell-pct">${t.count}场 · ${t.pct}%</span>
    </div>
  `;
}

function otherCell(name, count, total) {
  const pct = total > 0 ? +(count / total * 100).toFixed(1) : 0;
  return `
    <div class="freq-bf-cell freq-bf-other-cell" style="border:1px dashed #d29922;">
      <span class="freq-bf-cell-score" style="color:#d29922;">${name}</span>
      <span class="freq-bf-cell-pct">${count}场 · ${pct}%</span>
    </div>
  `;
}

function hasOthers(others) {
  return others && Object.values(others).some((c) => c > 0);
}

function insightLine(label, count, total) {
  if (!total) return `<div>${label} — 数据不足</div>`;
  const pct = +(count / total * 100).toFixed(1);
  const strong = pct >= 30;
  return `<div>${strong ? `<strong>${label} ${pct}%</strong>` : `${label} ${pct}%`}</div>`;
}

function insightLineTop(label, bucket) {
  if (!bucket || !bucket.count) return `<div>${label} — 数据不足</div>`;
  const strong = bucket.pct >= 25;
  return `<div>${strong ? `<strong>${label} ${bucket.pct}%</strong>` : `${label} ${bucket.pct}%`}</div>`;
}
