import { mountNextMatchCountdown } from '../countdown.js';
import { getMatches, getResults, getPredictions, getTeams } from '../data.js';
import { fmtDate, stageLabel, hitBadge, teamChip, teamDisplayName } from '../util.js';
import { t } from '../i18n.js';

(async () => {
  try {
    // 1) 并行：拉所有数据 + 挂载下场比赛倒计时
    const [matches, results, predictions, teams] = await Promise.all([
      getMatches(),
      getResults(),
      getPredictions(),
      getTeams(),
      mountNextMatchCountdown('countdown-next'),
    ]);
    const resultMap = new Map(results.map((r) => [r.matchId, r]));
    const teamMap = new Map(teams.map((t) => [t.code, t]));

    // 3) 今日 / 即将开赛
    const now = Date.now();
    const upcoming = matches
      .filter((m) => new Date(m.date).getTime() > now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 6);
    const todayEl = document.getElementById('today-matches');
    if (todayEl) {
      todayEl.removeAttribute('aria-busy');
      todayEl.innerHTML = upcoming.length === 0
        ? `<div class="col-span-full text-slate-500 text-sm">${t('home.today.empty')}</div>`
        : upcoming.map((m) => {
            const home = teamMap.get(m.home);
            const away = teamMap.get(m.away);
            const r = resultMap.get(m.id);
            const stageBadge = m.stage === 'group'
              ? `<span class="badge badge-ink">${m.group} ${t('stage.groupShort')}</span>`
              : `<span class="badge badge-gold">${stageLabel(m.stage)}</span>`;
            const d = fmtDate(m.date);
            return `
              <a href="/match.html?id=${m.id}" class="card p-4 hover:-translate-y-0.5 transition-transform block">
                <div class="flex items-center justify-between text-xs text-slate-500 mb-3">
                  ${stageBadge}
                  <span>${d.date} ${d.time}</span>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <div class="flex-1 flex items-center gap-2 min-w-0">
                    ${teamChip(home, 'sm')}
                    <span class="font-semibold truncate">${teamDisplayName(home) || m.home}</span>
                  </div>
                  <div class="px-2 text-slate-300 font-bold text-sm">${t('common.vs')}</div>
                  <div class="flex-1 flex items-center justify-end gap-2 min-w-0">
                    <span class="font-semibold truncate">${teamDisplayName(away) || m.away}</span>
                    ${teamChip(away, 'sm')}
                  </div>
                </div>
                <div class="mt-3 text-xs text-slate-500 truncate">${m.venue || ''}</div>
              </a>
            `;
          }).join('');
    }

    // 4) AI 预测速览
    const predMap = new Map(predictions.map((p) => [p.matchId, p]));
    const sample = predictions.slice(0, 3);
    const aiEl = document.getElementById('ai-overview');
    if (aiEl) {
      aiEl.removeAttribute('aria-busy');
      if (sample.length === 0) {
        aiEl.innerHTML = `<div class="col-span-full text-slate-500 text-sm">${t('home.ai.empty')}</div>`;
      } else {
        aiEl.innerHTML = sample.map((p) => {
          const m = matches.find((x) => x.id === p.matchId);
          if (!m) return '';
          const home = teamMap.get(m.home);
          const away = teamMap.get(m.away);
          const r = resultMap.get(m.id);
          const chipsHtml = p.models.slice(0, 4).map((mm) => {
            const badge = hitBadge(r, mm);
            return `<span class="badge ${badge.tone}">${mm.model.split(' ')[0]} ${mm.predictedHome}-${mm.predictedAway}</span>`;
          }).join(' ');
          const score = r
            ? `${r.homeScore} - ${r.awayScore}`
            : `<span class="text-slate-400">${t('common.pending')}</span>`;
          return `
            <a href="/match.html?id=${m.id}" class="card p-5 hover:-translate-y-0.5 transition-transform block">
              <div class="flex items-center justify-between text-xs text-slate-500 mb-2">
                <span>${m.group ? m.group + ' ' + t('stage.groupShort') + ' · ' : ''}${stageLabel(m.stage)}</span>
                <span>${r ? t('home.ai.finished') : t('home.ai.pending')}</span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  ${teamChip(home, 'sm')}
                  <span class="font-semibold truncate">${teamDisplayName(home) || m.home}</span>
                </div>
                <div class="text-2xl font-bold tabular-nums">${score}</div>
                <div class="flex items-center gap-2 min-w-0">
                  <span class="font-semibold truncate">${teamDisplayName(away) || m.away}</span>
                  ${teamChip(away, 'sm')}
                </div>
              </div>
              <div class="mt-4 flex flex-wrap gap-1.5">${chipsHtml}</div>
            </a>
          `;
        }).join('');
      }
    }
  } catch (e) {
    console.error('[index] init failed:', e);
  }
})();
