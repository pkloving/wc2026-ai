// js/pages/admin.js — WC2026 AI admin 控制台
// ---------------------------------------------------------------
// 流程：
// 1. 登录门：让用户输入 ADMIN_KEY（环境变量里的密码）
// 2. 存到 sessionStorage（关浏览器清空）
// 3. 后续请求都带 x-admin-key 头
// ---------------------------------------------------------------

const STORAGE_KEY = 'wc_admin_key';

const $ = (sel) => document.querySelector(sel);

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function adminFetch(path, opts = {}) {
  const key = sessionStorage.getItem(STORAGE_KEY);
  if (!key) throw new Error('未登录');
  const r = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': key,
      ...(opts.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function fmtDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function fmtRelative(ts) {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function renderStats(users, licenses) {
  const totalUsers = users.length;
  const active7d = users.filter((u) => u.lastSeenAt && Date.now() - u.lastSeenAt < 7 * 86_400_000).length;
  const totalCreditsHeld = users.reduce((s, u) => s + (u.credits || 0), 0);
  const totalUsed = users.reduce((s, u) => s + (u.used || 0), 0);
  const unusedLic = licenses.filter((l) => !l.used).length;
  $('#stats').innerHTML = `
    <div class="stat"><div class="stat-value">${totalUsers}</div><div class="stat-label">总用户</div></div>
    <div class="stat"><div class="stat-value">${active7d}</div><div class="stat-label">7 日活跃</div></div>
    <div class="stat"><div class="stat-value">${totalCreditsHeld}</div><div class="stat-label">总余额</div></div>
    <div class="stat"><div class="stat-value">${totalUsed} / ${unusedLic}待用</div><div class="stat-label">已用 / 未用 key</div></div>
  `;
}

function renderUsers(users) {
  const tbody = $('#users-tbody');
  tbody.innerHTML = users.length === 0
    ? '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem;">暂无用户</td></tr>'
    : users.map((u) => `
        <tr>
          <td>${u.email}</td>
          <td><b style="color:#D4AF37">${u.credits}</b></td>
          <td>${u.used || 0}</td>
          <td>${u.totalGranted || 0}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>${fmtRelative(u.lastSeenAt)}</td>
          <td>
            <button class="btn btn-sm" data-act="grant" data-email="${u.email}">+50</button>
            <button class="btn btn-sm btn-secondary" data-act="key" data-email="${u.email}">生成 key</button>
          </td>
        </tr>
      `).join('');
  // wire actions
  tbody.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      const email = b.dataset.email;
      if (b.dataset.act === 'grant') {
        $('#grant-email').value = email;
        $('#grant-credits').value = '50';
        $('#grant-btn').click();
      } else if (b.dataset.act === 'key') {
        $('#lic-credits').value = '50';
        $('#lic-btn').click();
        $('#lic-result').scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

function renderLicenses(licenses) {
  const tbody = $('#lic-tbody');
  tbody.innerHTML = licenses.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:2rem;">暂无 key</td></tr>'
    : licenses.slice(0, 30).map((l) => {
      // need to map back to key string; the list endpoint doesn't return the key, so reconstruct from index
      // We just show "—" for key here and ask the user to copy from generation result
      const badge = l.used
        ? `<span class="badge badge-yellow">已用 ${l.usedBy || ''}</span>`
        : `<span class="badge badge-green">未用</span>`;
      return `
        <tr>
          <td class="key-mono">${l.key || '(生成时显示)'}</td>
          <td>${l.credits}</td>
          <td>${badge}</td>
          <td>${fmtDate(l.createdAt)}</td>
          <td>${l.usedBy || '-'}</td>
        </tr>
      `;
    }).join('');
}

async function loadAll() {
  try {
    const { users, licenses } = await adminFetch('/api/admin/users');
    renderStats(users, licenses);
    renderUsers(users);
    renderLicenses(licenses);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadHealth() {
  $('#health-output').textContent = '加载中…';
  try {
    const key = sessionStorage.getItem(STORAGE_KEY);
    const r = await fetch('/api/health', { headers: { 'x-admin-key': key } });
    const data = await r.json();
    $('#health-output').textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    $('#health-output').textContent = 'Error: ' + e.message;
  }
}

/* ----- 当前项目数据（本地文件渲染） ----- */
function pctBar(n, max, width = 20) {
  if (!max) return '';
  const filled = Math.round((n / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function renderViewsBlock(views) {
  if (!views) return '<div class="muted">无 data/views/ 数据</div>';
  const keys = Object.keys(views).filter((k) => k !== 'index');
  if (!keys.length) return '<div class="muted">视图文件为空</div>';
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;">
      ${keys.map((k) => {
        const v = views[k];
        const maxN = Math.max(...v.top.map((t) => t.n), 1);
        const niceName = k.replace('_wc_view', '').toUpperCase().replace('VIEW', '');
        return `
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;padding:.75rem;">
            <div style="font-weight:700;font-size:.85rem;margin-bottom:.4rem;">⚽ ${niceName} <span class="muted">(${v.count}场 · 世界杯正赛)</span></div>
            ${v.top.map((t) => `
              <div style="font-size:.75rem;display:flex;gap:.5rem;align-items:baseline;line-height:1.7;">
                <span style="width:90px;color:#0B1F3A;font-weight:600;">${t.key}</span>
                <span style="color:#64748b;font-family:monospace;">${pctBar(t.n, maxN, 12)}</span>
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
    .map(([k, v]) => `<span class="badge" style="background:#f1f5f9;color:#0B1F3A;padding:.2rem .5rem;border-radius:.25rem;margin-right:.3rem;">${k} ${v}</span>`)
    .join('');
  return `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <div style="font-weight:700;font-size:.85rem;margin-bottom:.4rem;">📅 已完赛汇总 <span class="muted">(${s.total} 场)</span></div>
      <div style="font-size:.75rem;margin-bottom:.5rem;">${leagueChips}</div>
      <div style="font-size:.7rem;color:#94a3b8;">最近 3 场：${
        s.sample.map((x) => `${x.code} ${x.home} vs ${x.away} → ${x.final_score?.home ?? '-'}:${x.final_score?.away ?? '-'}`).join('；')
      }</div>
    </div>
  `;
}

function renderMatchesStatusBlock(ms) {
  if (!ms) return '';
  const statusChips = Object.entries(ms.by_status)
    .map(([k, v]) => `<span class="badge" style="background:#f1f5f9;color:#0B1F3A;padding:.2rem .5rem;border-radius:.25rem;margin-right:.3rem;">${k} ${v}</span>`)
    .join('');
  return `
    <details style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <summary style="cursor:pointer;font-weight:700;font-size:.85rem;">📋 matches_status 概览 <span class="muted">(${ms.total} 场)</span></summary>
      <div style="font-size:.75rem;margin-top:.5rem;">${statusChips}</div>
      ${ms.upcoming?.length ? `
        <div style="font-size:.7rem;color:#475569;margin-top:.5rem;">
          <b>未来 10 场：</b><br>
          ${ms.upcoming.map((x) => `${x.code} ${x.home} vs ${x.away} · ${x.kickoff}`).join('；')}
        </div>
      ` : ''}
    </details>
  `;
}

function renderPredict31Block(p) {
  if (!p) return '<div class="muted">无最新 predict_31 文件</div>';
  return `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <div style="font-weight:700;font-size:.85rem;margin-bottom:.4rem;">🤖 最新 R-031 推荐（${p.date}） <span class="muted">(${p.matches.length} 场, ${p.comboCount} 串关)</span></div>
      ${p.matches.slice(0, 8).map((m) => {
        const sp = m.spf || {};
        const rq = m.rqspf || {};
        const mp = (m.mainPicks || []).slice(0, 3).map((x) => `${x.score}@${x.odds}`).join('、');
        return `
          <div style="font-size:.75rem;line-height:1.7;border-bottom:1px dashed #e2e8f0;padding:.3rem 0;">
            <b>${m.code}</b> ${m.home} vs ${m.away} <span class="muted">(${m.kickoff || ''})</span>
            <div style="color:#64748b;">spf: ${sp.home ?? '-'}/${sp.draw ?? '-'}/${sp.away ?? '-'} | 让${m.handicap >= 0 ? '+' : ''}${m.handicap}: ${rq.home ?? '-'}/${rq.draw ?? '-'}/${rq.away ?? '-'}</div>
            ${mp ? `<div style="color:#0B1F3A;">📌 ${mp}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderChatPredictBlock(p) {
  if (!p) return '<div class="muted">无最新 chat_predict 文件</div>';
  return `
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:.5rem;padding:.75rem;margin-bottom:1rem;">
      <div style="font-weight:700;font-size:.85rem;margin-bottom:.4rem;">📊 喂给 AI 的精简推荐单（${p.date}） <span class="muted">(${p.match_count} 场)</span></div>
      ${p.matches.map((m) => {
        const picks = (m.picks || []).map((x) => `${x.pick}@${x.odds}`).join('、');
        return `
          <div style="font-size:.75rem;line-height:1.7;border-bottom:1px dashed #e2e8f0;padding:.3rem 0;">
            <b>${m.code}</b> ${m.home} vs ${m.away} <span class="muted">(${m.kickoff || '无时间'})</span>
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
      <summary style="cursor:pointer;font-weight:700;font-size:.85rem;">💡 ROI 规律 TOP 建议 <span class="muted">(${r.n_matches} 场样本)</span></summary>
      <ol style="font-size:.75rem;margin:.5rem 0 0 1.2rem;padding:0;line-height:1.7;">
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
  body.innerHTML = '<div class="muted">⏳</div>';
  try {
    const data = await adminFetch('/api/admin/data');
    status.textContent = `更新于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    body.innerHTML = [
      renderSettledBlock(data.settled),
      renderMatchesStatusBlock(data.matches_status),
      renderRoiInsightsBlock(data.roi_insights),
      renderPredict31Block(data.predict_31),
      renderChatPredictBlock(data.chat_predict),
      '<h3 style="font-size:.95rem;margin:1rem 0 .5rem;">📈 5 玩法频率视图 <span style="font-size:.75rem;color:#94a3b8;">（仅世界杯正赛，过滤掉国际赛数据）</span></h3>',
      renderViewsBlock(data.views),
    ].filter(Boolean).join('');
  } catch (e) {
    status.textContent = '加载失败';
    body.innerHTML = `<div style="color:#dc2626;font-size:.85rem;">❌ ${e.message}</div>`;
  }
}

/* ----- login gate ----- */
async function tryLogin(key) {
  try {
    const r = await fetch('/api/admin/users', { headers: { 'x-admin-key': key } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    sessionStorage.setItem(STORAGE_KEY, key);
    $('#login-gate').hidden = true;
    $('#dashboard').hidden = false;
    await loadAll();
    await loadHealth();
    await loadData();
  } catch (e) {
    toast('admin key 无效: ' + e.message, 'error');
  }
}

$('#admin-login').addEventListener('click', () => {
  const v = $('#admin-key').value.trim();
  if (!v) return toast('请输入 key', 'error');
  tryLogin(v);
});
$('#admin-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#admin-login').click(); });

$('#refresh').addEventListener('click', loadAll);
$('#check-health').addEventListener('click', loadHealth);
const dataRefreshBtn = document.querySelector('[data-data-refresh]');
if (dataRefreshBtn) dataRefreshBtn.addEventListener('click', loadData);

$('#grant-btn').addEventListener('click', async () => {
  const email = $('#grant-email').value.trim();
  const credits = Number($('#grant-credits').value);
  if (!email || !credits) return toast('请填邮箱和积分', 'error');
  try {
    const r = await adminFetch('/api/billing/admin-grant', {
      method: 'POST',
      body: JSON.stringify({ email, credits, note: 'admin-panel' }),
    });
    toast(`✅ 已给 ${email} 充 ${credits} 积分，余额 ${r.balance}`);
    $('#grant-email').value = '';
    $('#grant-credits').value = '';
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
  }
});

$('#lic-btn').addEventListener('click', async () => {
  const credits = Number($('#lic-credits').value);
  if (!credits) return toast('请填积分数', 'error');
  try {
    const r = await adminFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ credits }),
    });
    $('#lic-result').innerHTML = `
      <div style="background:#dcfce7;border:1px solid #86efac;padding:.75rem;border-radius:.5rem;">
        <div style="font-size:.75rem;color:#166534;margin-bottom:.25rem;">新 key 已生成（${r.license.credits} 积分）</div>
        <div class="key-mono" style="font-size:1.1rem;font-weight:700;color:#0B1F3A;user-select:all;">${r.license.key}</div>
        <div style="font-size:.75rem;color:#166534;margin-top:.25rem;">点击全选复制，发给用户兑换</div>
      </div>
    `;
    await loadAll();
  } catch (e) {
    toast(e.message, 'error');
  }
});

// auto-login if key already in session
const savedKey = sessionStorage.getItem(STORAGE_KEY);
if (savedKey) {
  tryLogin(savedKey).catch(() => {
    sessionStorage.removeItem(STORAGE_KEY);
  });
}
