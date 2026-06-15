import { getMatches, getResults, getPredictions, getTeams, getResultForMatch } from '../data.js';
import { fmtDate, STAGE_LABEL, hitBadge, escapeHtml, teamChip } from '../util.js';
import { t, teamDisplayName } from '../i18n.js';
import { boot } from '../page-boot.js';

boot(async () => {
  // 灯箱交互：必须 DOM 准备好后才能绑
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('.shot-btn');
    if (!btn) return;
    const img = btn.querySelector('img');
    const lb = document.getElementById('lightbox');
    const lbImg = document.getElementById('lightbox-img');
    if (img && img.src && !img.style.display) {
      lbImg.src = img.src;
      lbImg.alt = img.alt || '';
      lb.classList.remove('hidden');
      lb.classList.add('flex');
    }
  });

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    document.querySelector('main').innerHTML = `<div class="text-slate-500">${escapeHtml(t('match.noId'))}</div>`;
    return;
  }

  const [matches, results, predictions, teams] = await Promise.all([
    getMatches(), getResults(), getPredictions(), getTeams(),
  ]);
  const m = matches.find((x) => x.id === id);
  if (!m) {
    document.querySelector('main').innerHTML = `<div class="text-slate-500">${escapeHtml(t('match.notFound'))}</div>`;
    return;
  }
  const r = getResultForMatch(m, results) || null;
  const p = predictions.find((x) => x.matchId === id) || null;
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const home = teamMap.get(m.home);
  const away = teamMap.get(m.away);
  const d = fmtDate(m.date);
  const homeName = teamDisplayName(home) || m.home;
  const awayName = teamDisplayName(away) || m.away;

  const stageBadge = m.stage === 'group'
    ? `<span class="badge badge-ink">${escapeHtml(m.group)} ${escapeHtml(t('stage.groupShort'))}</span>`
    : `<span class="badge badge-gold">${escapeHtml(STAGE_LABEL[m.stage] || m.stage)}</span>`;

  const headerEl = document.getElementById('match-header');
  headerEl.innerHTML = `
    <div class="flex items-center gap-2 text-xs mb-3">
      ${stageBadge}
      <span class="text-slate-500">${escapeHtml(d.date)} ${escapeHtml(d.time)}</span>
      <span class="text-slate-400">· ${escapeHtml(m.venue || '')}</span>
    </div>
    <div class="card p-6 sm:p-8">
      <div class="grid grid-cols-[1fr_auto_1fr] gap-4 sm:gap-6 items-center">
        <div class="flex flex-col items-center">
          ${teamChip(home, 'xl')}
          <div class="font-bold text-lg sm:text-xl mt-3">${escapeHtml(homeName)}</div>
          <div class="text-xs text-slate-400 mt-1">${escapeHtml(m.home)}</div>
        </div>
        <div class="text-center">
          ${r
            ? `<div class="text-5xl sm:text-6xl font-black tabular-nums">${r.homeScore} - ${r.awayScore}</div>
               <div class="text-xs text-slate-400 mt-1">${r.wentToPenalties ? escapeHtml(t('match.penaltyScore', { h: r.penaltyScore.home, a: r.penaltyScore.away })) : escapeHtml(t('common.finished'))}</div>`
            : `<div class="text-3xl sm:text-4xl font-black text-slate-300">${escapeHtml(t('common.vs'))}</div>
               <div class="text-xs text-slate-400 mt-1">${escapeHtml(t('common.pending'))}</div>`}
        </div>
        <div class="flex flex-col items-center">
          ${teamChip(away, 'xl')}
          <div class="font-bold text-lg sm:text-xl mt-3">${escapeHtml(awayName)}</div>
          <div class="text-xs text-slate-400 mt-1">${escapeHtml(m.away)}</div>
        </div>
      </div>
    </div>
  `;

  const resultEl = document.getElementById('match-result');
  if (r && r.scorers && r.scorers.length > 0) {
    resultEl.innerHTML = `
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-slate-500 mb-3">${escapeHtml(t('match.scorers'))}</h3>
        <div class="grid sm:grid-cols-2 gap-2 text-sm">
          ${r.scorers.map((s) => `
            <div class="flex items-center gap-2 p-2 rounded-lg bg-slate-50">
              <span class="font-mono text-slate-500 text-xs w-8 text-right">${s.minute}'</span>
              <span class="font-semibold flex-1">${escapeHtml(s.player)}</span>
              ${s.team === m.home ? `<span class="text-xs text-slate-400">${escapeHtml(homeName)}</span>` : `<span class="text-xs text-slate-400">${escapeHtml(awayName)}</span>`}
              ${s.type === 'penalty' ? `<span class="badge badge-gold">${escapeHtml(t('common.penalty'))}</span>` : ''}
              ${s.type === 'og' ? `<span class="badge badge-flame">${escapeHtml(t('common.og'))}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else if (r) {
    resultEl.innerHTML = '';
  } else {
    resultEl.innerHTML = '';
  }

  const listEl = document.getElementById('model-list');
  if (!p || p.models.length === 0) {
    listEl.innerHTML = `<div class="card p-8 text-center text-slate-500">${escapeHtml(t('match.noPredictions'))}<br><br>${escapeHtml(t('match.noPredictionsNote'))}</div>`;
  } else {
    document.getElementById('model-count').textContent = t('match.modelCount', { n: p.models.length });
    listEl.innerHTML = p.models.map((m) => {
      const badge = hitBadge(r, m);
      const ph = m.predictedHome, pa = m.predictedAway;
      const pw = ph > pa ? t('match.predHomeWin') : ph < pa ? t('match.predAwayWin') : t('match.predDraw');
      const rw = r ? (r.homeScore > r.awayScore ? t('match.predHomeWin') : r.homeScore < r.awayScore ? t('match.predAwayWin') : t('match.predDraw')) : '—';
      const winnerMatch = r && ((ph > pa && r.homeScore > r.awayScore) || (ph < pa && r.homeScore < r.awayScore) || (ph === pa && r.homeScore === r.awayScore));
      const scoreMatch = r && ph === r.homeScore && pa === r.awayScore;
      const hitText = scoreMatch
        ? `<span class="text-pitch">${escapeHtml(t('match.hitScore'))}</span>`
        : winnerMatch
        ? `<span class="text-gold">${escapeHtml(t('match.hitWinner'))}</span>`
        : r
        ? `<span class="text-flame">${escapeHtml(t('match.miss'))}</span>`
        : '—';
      const screenshots = m.screenshots || [];
      return `
        <article class="card p-5 sm:p-6">
          <div class="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-2xl">🤖</span>
                <h3 class="text-xl font-bold">${escapeHtml(m.model)}</h3>
                <span class="badge ${badge.tone}">${escapeHtml(badge.label)}</span>
              </div>
              ${m.prompt ? `<div class="text-xs text-slate-500 mt-2"><span class="text-slate-400">${escapeHtml(t('match.prompt'))}</span>${escapeHtml(m.prompt)}</div>` : ''}
            </div>
          </div>
          <div class="grid sm:grid-cols-3 gap-3 mt-3">
            <div class="p-3 rounded-lg bg-slate-50">
              <div class="text-xs text-slate-500 mb-1">${escapeHtml(t('match.predicted'))}</div>
              <div class="text-2xl font-black tabular-nums">${ph} - ${pa}</div>
              <div class="text-xs text-slate-500 mt-1">${escapeHtml(pw)}</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-50">
              <div class="text-xs text-slate-500 mb-1">${escapeHtml(t('match.actual'))}</div>
              <div class="text-2xl font-black tabular-nums">${r ? `${r.homeScore} - ${r.awayScore}` : '—'}</div>
              <div class="text-xs text-slate-500 mt-1">${escapeHtml(rw)}</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-50">
              <div class="text-xs text-slate-500 mb-1">${escapeHtml(t('match.hit'))}</div>
              <div class="text-sm font-semibold">${hitText}</div>
              ${m.note ? `<div class="text-xs text-slate-500 mt-1">${escapeHtml(m.note)}</div>` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');
  }
}, { errorTarget: 'match-header' });
