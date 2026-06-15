import { getMatches, getResults, getTeams, getPredictions, getResultForMatch } from '../data.js';
import { fmtDate, stageLabel, hitBadge, teamChip, teamDisplayName } from '../util.js';
import { t } from '../i18n.js';
import { renderChampionSection } from '../champion.js';
import { boot } from '../page-boot.js';

boot(async () => {
  const [matches, results, teams, predictions] = await Promise.all([
    getMatches(), getResults(), getTeams(), getPredictions(),
  ]);
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const resultFor = (m) => getResultForMatch(m, results);
  function computeModelStats() {
    const stats = new Map();
    for (const p of predictions) {
      const m = matches.find((x) => x.id === p.matchId);
      const r = m ? resultFor(m) : null;
      for (const m of p.models) {
        if (!stats.has(m.model)) {
          stats.set(m.model, { model: m.model, total: 0, scoreHit: 0, winnerHit: 0, miss: 0 });
        }
        const s = stats.get(m.model);
        s.total += 1;
        if (!r) continue;
        const ph = m.predictedHome, pa = m.predictedAway;
        if (ph === r.homeScore && pa === r.awayScore) {
          s.scoreHit += 1; s.winnerHit += 1;
        } else {
          const pw = ph > pa ? 'home' : ph < pa ? 'away' : 'draw';
          const rw = r.homeScore > r.awayScore ? 'home' : r.homeScore < r.awayScore ? 'away' : 'draw';
          if (pw === rw) s.winnerHit += 1; else s.miss += 1;
        }
      }
    }
    return [...stats.values()].sort((a, b) => b.scoreHit / Math.max(1, b.total) - a.scoreHit / Math.max(1, a.total));
  }

  function renderDashboard() {
    const stats = computeModelStats();
    const el = document.getElementById('model-dashboard');
    if (stats.length === 0) {
      el.innerHTML = `<div class="col-span-full text-slate-500 text-sm">${t('predictions.dashboard.empty')}</div>`;
      return;
    }
    el.innerHTML = stats.map((s) => {
      const finished = s.scoreHit + s.winnerHit + s.miss;
      const scorePct = finished > 0 ? Math.round((s.scoreHit / finished) * 100) : 0;
      const winnerPct = finished > 0 ? Math.round((s.winnerHit / finished) * 100) : 0;
      return `
        <div class="card p-4">
          <div class="font-semibold truncate">${s.model}</div>
          <div class="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <div class="text-xs text-slate-500">${t('predictions.dashboard.scorePct')}</div>
              <div class="text-2xl font-black text-pitch tabular-nums">${scorePct}%</div>
              <div class="text-xs text-slate-400">${s.scoreHit} / ${finished}</div>
            </div>
            <div>
              <div class="text-xs text-slate-500">${t('predictions.dashboard.winnerPct')}</div>
              <div class="text-2xl font-black text-gold tabular-nums">${winnerPct}%</div>
              <div class="text-xs text-slate-400">${s.winnerHit} / ${finished}</div>
            </div>
          </div>
          <div class="mt-3 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div class="bg-pitch h-full" style="width:${scorePct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ---- 列表 ----
  let activeFilter = 'all';
  let activeModelFilter = '__all__';
  function applyFilter(list) {
    return list.filter((p) => {
      const r = p.result;
      if (activeFilter === 'all') {
        // 全部：不做状态筛选
      } else if (activeFilter === 'finished') {
        if (!r) return false;
      } else if (activeFilter === 'pending') {
        if (r) return false;
      } else if (r) {
        const hits = p.models.map((m) => hitBadge(r, m));
        if (activeFilter === 'hit' && !hits.some((h) => h.tone === 'badge-pitch')) return false;
        if (activeFilter === 'winner' && !hits.some((h) => h.tone === 'badge-gold')) return false;
        if (activeFilter === 'miss' && !hits.every((h) => h.tone === 'badge-flame')) return false;
      } else {
        return false;
      }
      // 模型筛选
      if (activeModelFilter !== '__all__') {
        const hasModel = p.models.some((m) => m.model === activeModelFilter);
        if (!hasModel) return false;
      }
      return true;
    });
  }

  // 收集所有出现过的模型名，按出现频次排序
  function getAllModels() {
    const counts = new Map();
    for (const p of predictions) {
      for (const m of p.models) {
        counts.set(m.model, (counts.get(m.model) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([model]) => model);
  }

  function renderModelChips() {
    const models = getAllModels();
    const el = document.getElementById('model-filter-chips');
    if (!el) return;
    el.innerHTML = models.map((m) => {
      const active = activeModelFilter === m;
      return `<button data-model="${escapeHtml(m)}" class="model-btn px-3 py-1.5 rounded-lg text-sm font-semibold ${active ? 'bg-pitch text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">${escapeHtml(m)}</button>`;
    }).join('');
  }

  function renderList() {
    const enriched = predictions
      .map((p) => {
        const m = matches.find((x) => x.id === p.matchId);
        if (!m) return null;
        return { match: m, result: resultFor(m), prediction: p };
      })
      .filter(Boolean)
      .sort((a, b) => {
        // 待开赛置顶，组内按开赛时间升序；其余按时间降序
        const aS = a.match.status === 'scheduled' ? 0 : 1;
        const bS = b.match.status === 'scheduled' ? 0 : 1;
        if (aS !== bS) return aS - bS;
        return aS === 0
          ? new Date(a.match.date) - new Date(b.match.date)
          : new Date(b.match.date) - new Date(a.match.date);
      });

    const filtered = applyFilter(enriched);
    document.getElementById('filter-count').textContent = t('predictions.summary', { n: filtered.length });

    const el = document.getElementById('prediction-list');
    if (filtered.length === 0) {
      el.innerHTML = `<div class="text-slate-500 text-sm">${t('predictions.empty')}</div>`;
      return;
    }
    el.innerHTML = filtered.map(({ match, result, prediction }) => {
      const home = teamMap.get(match.home);
      const away = teamMap.get(match.away);
      const stageBadge = match.stage === 'group'
        ? `<span class="badge badge-ink">${match.group} ${t('stage.groupShort')}</span>`
        : `<span class="badge badge-gold">${stageLabel(match.stage)}</span>`;
      const d = fmtDate(match.date);
      const score = result
        ? `<span class="font-black text-2xl tabular-nums">${result.homeScore} - ${result.awayScore}</span>`
        : `<span class="text-slate-400 text-sm">${t('common.pending')}</span>`;
      const modelChips = prediction.models.map((m) => {
        const badge = hitBadge(result, m);
        const dim = activeModelFilter !== '__all__' && m.model !== activeModelFilter;
        return `<span class="badge ${badge.tone} ${dim ? 'opacity-30' : ''}">${m.model.split(' ')[0]} ${m.predictedHome}-${m.predictedAway}</span>`;
      }).join(' ');
      return `
        <a href="/match.html?id=${match.id}" class="card p-5 hover:-translate-y-0.5 transition-transform block">
          <div class="flex items-center gap-2 text-xs mb-3 flex-wrap">
            ${stageBadge}
            <span class="text-slate-500">${d.date} ${d.time}</span>
            <span class="ml-auto text-slate-400">${t('predictions.modelCount', { n: prediction.models.length })}</span>
          </div>
          <div class="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
            <div class="flex items-center gap-2 min-w-0">
              ${teamChip(home, 'md')}
              <div class="min-w-0">
                <div class="font-bold truncate">${teamDisplayName(home) || match.home}</div>
              </div>
            </div>
            <div class="px-3">${score}</div>
            <div class="flex items-center gap-2 min-w-0 justify-end">
              <div class="min-w-0 text-right">
                <div class="font-bold truncate">${teamDisplayName(away) || match.away}</div>
              </div>
              ${teamChip(away, 'md')}
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-1.5">${modelChips}</div>
          <div class="mt-3 text-xs text-slate-400">${t('predictions.viewDetail')}</div>
        </a>
      `;
    }).join('');
  }

  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.addEventListener('click', () => {
      activeFilter = b.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach((x) => {
        x.classList.remove('bg-ink', 'text-white');
        x.classList.add('bg-slate-100', 'hover:bg-slate-200');
      });
      b.classList.remove('bg-slate-100', 'hover:bg-slate-200');
      b.classList.add('bg-ink', 'text-white');
      renderList();
    });
  });

  // 模型筛选：使用事件代理（chips 是动态渲染的）
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.model-btn');
    if (!btn) return;
    const m = btn.dataset.model;
    activeModelFilter = m || '__all__';
    // 重置"全部"按钮样式
    document.querySelectorAll('.model-btn').forEach((x) => {
      if (x.dataset.model === '__all__') {
        x.classList.toggle('bg-ink', activeModelFilter === '__all__');
        x.classList.toggle('text-white', activeModelFilter === '__all__');
        x.classList.toggle('bg-slate-100', activeModelFilter !== '__all__');
        x.classList.toggle('hover:bg-slate-200', activeModelFilter !== '__all__');
        x.classList.toggle('text-slate-700', activeModelFilter !== '__all__');
      } else {
        const active = x.dataset.model === activeModelFilter;
        x.classList.toggle('bg-pitch', active);
        x.classList.toggle('text-white', active);
        x.classList.toggle('bg-slate-100', !active);
        x.classList.toggle('hover:bg-slate-200', !active);
        x.classList.toggle('text-slate-700', !active);
      }
    });
    renderList();
  });

  renderChampionSection('champion-section');
  renderDashboard();
  renderModelChips();
  renderList();
}, { errorTarget: 'prediction-list' });

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
