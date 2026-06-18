// js/pages/simulate.js — WC2026 公开数据看板
// ---------------------------------------------------------------
// 任何访问者（含未登录用户）都能看到的本地项目数据：
//   - 已完赛汇总
//   - matches_status 概览
//   - ROI 规律 TOP 建议
//   - 最新 R-031 推荐单
//   - 喂给 AI 的精简推荐单（chat_predict）
//   - 5 玩法频率视图（仅世界杯正赛）
//
// 数据源：GET /api/data（公开端点，无需 ADMIN_KEY）
// ---------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

function fmtDateTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function pctBar(n, max, width = 20) {
  if (!max) return '';
  const filled = Math.round((n / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function renderViewsBlock(views) {
  if (!views) return '<div style="color:#94a3b8;font-size:.85rem;">无 data/views/ 数据</div>';
  const keys = Object.keys(views).filter((k) => k !== 'index');
  if (!keys.length) return '<div style="color:#94a3b8;font-size:.85rem;">视图文件为空</div>';
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem;">
      ${keys.map((k) => {
        const v = views[k];
        const maxN = Math.max(...v.top.map((t) => t.n), 1);
        const niceName = k.replace('_wc_view', '').toUpperCase().replace('VIEW', '');
        return `
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;padding:.75rem;">
            <div style="font-weight:700;font-size:.85rem;margin-bottom:.4rem;">⚽ ${niceName} <span style="color:#94a3b8;font-size:.75rem;">(${v.count} 场 · 世界杯正赛)</span></div>
            ${v.top.map((t) => `
              <div style="font-size:.75rem;display:flex;gap:.5rem;align-items:baseline;line-height:1.7;">
                <span style="width:90px;color:#0B1F3A;font-weight:600;">${t.key}</span>
                <span style="color:#64748b;font-family:monospace;font-size:.7rem;">${pctBar(t.n, maxN, 12)}</span>
                <span style="margin-left:auto;color:#475569;">${t.n} · ${t.pct}%</span>
              </div>
            `).join('')}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderSettledBlock(s) {
  if (!s) return '';
  const leagueChips = Object.entries(s.by_league)
    .map(([k, v]) => `<span style="background:#f1f5f9;color:#0B1F3A;padding:.2rem .55rem;border-radius:.25rem;margin-right:.3rem;font-size:.75rem;">${k} ${v}</span>`)
    .join('');
  return `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <div style="font-weight:700;font-size:.9rem;margin-bottom:.4rem;">📅 已完赛汇总 <span style="color:#94a3b8;font-weight:400;">(${s.total} 场)</span></div>
      <div style="font-size:.75rem;margin-bottom:.5rem;">${leagueChips}</div>
      <div style="font-size:.7rem;color:#94a3b8;line-height:1.6;">最近 3 场：${
        s.sample.map((x) => `${x.code} ${x.home} vs ${x.away} → ${x.final_score?.home ?? '-'}:${x.final_score?.away ?? '-'}`).join('；')
      }</div>
    </div>
  `;
}

function renderMatchesStatusBlock(ms) {
  if (!ms) return '';
  const statusChips = Object.entries(ms.by_status)
    .map(([k, v]) => `<span style="background:#f1f5f9;color:#0B1F3A;padding:.2rem .55rem;border-radius:.25rem;margin-right:.3rem;font-size:.75rem;">${k} ${v}</span>`)
    .join('');
  return `
    <details style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <summary style="cursor:pointer;font-weight:700;font-size:.9rem;">📋 赛程状态 <span style="color:#94a3b8;font-weight:400;">(${ms.total} 场)</span></summary>
      <div style="font-size:.75rem;margin-top:.5rem;">${statusChips}</div>
      ${ms.upcoming?.length ? `
        <div style="font-size:.7rem;color:#475569;margin-top:.5rem;line-height:1.6;">
          <b>未来 10 场：</b><br>
          ${ms.upcoming.map((x) => `${x.code} ${x.home} vs ${x.away} · ${x.kickoff}`).join('；')}
        </div>
      ` : ''}
    </details>
  `;
}

function renderPredict31Block(p) {
  if (!p) return '<div style="color:#94a3b8;font-size:.85rem;">暂无最新 R-031 推荐文件（通常每天 17:00 更新）</div>';
  return `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <div style="font-weight:700;font-size:.9rem;margin-bottom:.4rem;">🤖 最新 R-031 推荐 <span style="color:#94a3b8;font-weight:400;">(${p.date} · ${p.matches.length} 场 · ${p.comboCount} 串关)</span></div>
      ${p.matches.slice(0, 8).map((m) => {
        const sp = m.spf || {};
        const rq = m.rqspf || {};
        const mp = (m.mainPicks || []).slice(0, 3).map((x) => `${x.score}@${x.odds}`).join('、');
        return `
          <div style="font-size:.78rem;line-height:1.7;border-bottom:1px dashed #e2e8f0;padding:.4rem 0;">
            <b>${m.code}</b> ${m.home} vs ${m.away} <span style="color:#94a3b8;">(${m.kickoff || ''})</span>
            <div style="color:#64748b;">spf: ${sp.home ?? '-'}/${sp.draw ?? '-'}/${sp.away ?? '-'} | 让${m.handicap >= 0 ? '+' : ''}${m.handicap}: ${rq.home ?? '-'}/${rq.draw ?? '-'}/${rq.away ?? '-'}</div>
            ${mp ? `<div style="color:#0B1F3A;">📌 ${mp}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderChatPredictBlock(p) {
  if (!p) return '<div style="color:#94a3b8;font-size:.85rem;">暂无 chat_predict 文件（每天 17:00 由本地 modeling 生成）</div>';
  return `
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <div style="font-weight:700;font-size:.9rem;margin-bottom:.4rem;">📊 AI 喂的精简推荐单 <span style="color:#94a3b8;font-weight:400;">(${p.date} · ${p.match_count} 场)</span></div>
      ${p.matches.map((m) => {
        const picks = (m.picks || []).map((x) => `${x.pick}@${x.odds}`).join('、');
        return `
          <div style="font-size:.78rem;line-height:1.7;border-bottom:1px dashed #e2e8f0;padding:.4rem 0;">
            <b>${m.code}</b> ${m.home} vs ${m.away} <span style="color:#94a3b8;">(${m.kickoff || '无时间'})</span>
            ${picks ? `<div style="color:#0B1F3A;">${picks}</div>` : ''}
            ${m.reason ? `<div style="color:#475569;font-style:italic;">${m.reason}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderRoiInsightsBlock(r) {
  if (!r) return '';
  return `
    <details style="background:#fdf4ff;border:1px solid #f5d0fe;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <summary style="cursor:pointer;font-weight:700;font-size:.9rem;">💡 ROI 规律 TOP 建议 <span style="color:#94a3b8;font-weight:400;">(${r.n_matches} 场样本)</span></summary>
      <ol style="font-size:.78rem;margin:.5rem 0 0 1.2rem;padding:0;line-height:1.7;">
        ${r.top_advices.map((a) => `<li style="margin-bottom:.3rem;">${a}</li>`).join('')}
      </ol>
    </details>
  `;
}

async function loadData() {
  const status = $('[data-data-status]');
  const body = $('[data-data-body]');
  if (!body) return;
  status.textContent = '加载中…';
  body.innerHTML = '<div style="color:#94a3b8;font-size:.85rem;">⏳</div>';
  try {
    const r = await fetch('/api/data');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    status.textContent = `更新于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    body.innerHTML = [
      renderSettledBlock(data.settled),
      renderMatchesStatusBlock(data.matches_status),
      renderRoiInsightsBlock(data.roi_insights),
      renderPredict31Block(data.predict_31),
      renderChatPredictBlock(data.chat_predict),
      '<h3 style="font-size:1rem;margin:1rem 0 .5rem;">📈 5 玩法频率视图 <span style="font-size:.75rem;color:#94a3b8;font-weight:400;">（仅世界杯正赛，过滤掉国际赛数据）</span></h3>',
      renderViewsBlock(data.views),
    ].filter(Boolean).join('');
  } catch (e) {
    status.textContent = '加载失败';
    body.innerHTML = `<div style="color:#dc2626;font-size:.85rem;">❌ ${e.message}</div>`;
  }
}

const refreshBtn = document.querySelector('[data-data-refresh]');
if (refreshBtn) refreshBtn.addEventListener('click', loadData);

loadData();
