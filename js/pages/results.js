import { getMatches, getResults, getTeams, getPredictions } from '../data.js';
import { fmtDate, stageLabel, teamChip, hitBadge, teamDisplayName } from '../util.js';
import { t } from '../i18n.js';
import { boot } from '../page-boot.js';

boot(async () => {
  const [matches, results, teams, predictions] = await Promise.all([
    getMatches(), getResults(), getTeams(), getPredictions(),
  ]);
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const predMap = new Map(predictions.map((p) => [p.matchId, p]));

  const list = results
    .map((r) => {
      const m = matches.find((x) => x.id === r.matchId);
      return m ? { match: m, result: r, prediction: predMap.get(m.id) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.match.date) - new Date(a.match.date));

  const el = document.getElementById('results-list');
  if (list.length === 0) {
    el.innerHTML = `<div class="col-span-full text-slate-500 text-sm">${t('results.empty')}</div>`;
  } else {
    el.innerHTML = list.map(({ match, result, prediction }) => {
      const home = teamMap.get(match.home);
      const away = teamMap.get(match.away);
      const stageBadge = match.stage === 'group'
        ? `<span class="badge badge-ink">${match.group} ${t('stage.groupShort')}</span>`
        : `<span class="badge badge-gold">${stageLabel(match.stage)}</span>`;
      const d = fmtDate(match.date);
      const scorersHtml = result.scorers && result.scorers.length > 0
        ? `<div class="mt-3 text-xs text-slate-600 space-y-1">${result.scorers.map((s) => `<div class="flex items-center gap-2"><span class="font-mono text-slate-400">${s.minute}'</span><span class="font-semibold">${escapeHtml(s.player)}</span>${s.type === 'penalty' ? `<span class="badge badge-gold">${t('common.penalty')}</span>` : ''}${s.type === 'og' ? `<span class="badge badge-flame">${t('common.og')}</span>` : ''}</div>`).join('')}</div>`
        : '';
      const pensHtml = result.wentToPenalties ? `<div class="mt-2 text-xs text-flame font-semibold">${t('common.wentToPenalties')}：${result.penaltyScore.home} - ${result.penaltyScore.away}</div>` : '';
      const predChips = prediction ? prediction.models.slice(0, 4).map((mm) => {
        const badge = hitBadge(result, mm);
        return `<span class="badge ${badge.tone}">${mm.model.split(' ')[0]} ${mm.predictedHome}-${mm.predictedAway}</span>`;
      }).join(' ') : '';
      return `
        <a href="/match.html?id=${match.id}" class="card p-5 hover:-translate-y-0.5 transition-transform block">
          <div class="flex items-center gap-2 text-xs mb-3">
            ${stageBadge}
            <span class="text-slate-500">${d.date} ${d.time}</span>
          </div>
          <div class="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
            <div class="flex items-center gap-2 min-w-0">
              ${teamChip(home, 'md')}
              <div class="min-w-0">
                <div class="font-bold truncate">${teamDisplayName(home) || match.home}</div>
              </div>
            </div>
            <div class="text-3xl font-black tabular-nums px-3">${result.homeScore} - ${result.awayScore}</div>
            <div class="flex items-center gap-2 min-w-0 justify-end">
              <div class="min-w-0 text-right">
                <div class="font-bold truncate">${teamDisplayName(away) || match.away}</div>
              </div>
              ${teamChip(away, 'md')}
            </div>
          </div>
          ${scorersHtml}
          ${pensHtml}
          ${predChips ? `<div class="mt-3 flex flex-wrap gap-1.5 text-xs">${predChips}</div>` : ''}
          <div class="mt-3 text-xs text-slate-400 truncate">${match.venue || ''}</div>
        </a>
      `;
    }).join('');
  }
}, { errorTarget: 'results-list' });

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
