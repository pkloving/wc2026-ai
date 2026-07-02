import { getMatches, getResults, getTeams, getResultForMatch } from '../data.js';
import { fmtDate, stageLabel, teamChip, teamDisplayName, escapeHtml } from '../util.js';
import { t, formatMonthDayCN, formatWeekdayCN } from '../i18n.js';
import { boot } from '../page-boot.js';

boot(async () => {
  const [matches, results, teams] = await Promise.all([getMatches(), getResults(), getTeams()]);
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const resultFor = (m) => getResultForMatch(m, results);

  const state = { stage: '', group: '', status: '', team: '' };

  // 兜底：result 缺失 + m.final_score="h-a" 也能渲染出比分（用于 mid 抓不到/5日窗口外的场次）
  function parseFinalScore(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d+)\s*[-:]\s*(\d+)/);
    return m ? { homeScore: Number(m[1]), awayScore: Number(m[2]) } : null;
  }

  function applyFilters() {
    return matches.filter((m) => {
      if (state.stage && m.stage !== state.stage) return false;
      if (state.group && m.group !== state.group) return false;
      const r = resultFor(m);
      const mStatus = r ? 'finished' : (m.status === 'finished' ? 'finished' : 'scheduled');
      if (state.status && mStatus !== state.status) return false;
      if (state.team) {
        const q = state.team.trim().toUpperCase();
        if (m.home !== q && m.away !== q) return false;
      }
      return true;
    });
  }

  function groupByDate(list) {
    const m = new Map();
    for (const x of list) {
      const d = new Date(x.date);
      // 使用北京时区 (UTC+8) 进行分组，避免 0/3/6 点的比赛被归到前一天
      const beijing = new Date(d.getTime() + 8 * 3600 * 1000);
      const key = beijing.toISOString().slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(x);
    }
    return [...m.entries()].sort();
  }

  function render() {
    const list = applyFilters();
    document.getElementById('f-count').textContent = t('schedule.count', { n: list.length });
    const grouped = groupByDate(list);
    const el = document.getElementById('schedule-list');
    if (list.length === 0) {
      el.innerHTML = `<div class="text-slate-500 text-sm">${t('schedule.empty')}</div>`;
      return;
    }
    el.innerHTML = grouped.map(([date, ms]) => {
      // date 是北京时区日期键（YYYY-MM-DD）
      const [yy, mm, dd] = date.split('-').map(Number);
      const d = new Date(yy, mm - 1, dd);
      const weekday = formatWeekdayCN(date);
      const dateLabel = formatMonthDayCN(date);
      const cardsHtml = ms.map((m) => {
        const home = teamMap.get(m.home);
        const away = teamMap.get(m.away);
        const r = resultFor(m);
        const stageBadge = m.stage === 'group'
          ? `<span class="badge badge-ink">${m.group} ${t('stage.groupShort')}</span>`
          : `<span class="badge badge-gold">${stageLabel(m.stage)}</span>`;
        const statusBadge = r
          ? `<span class="badge badge-pitch">${t('schedule.status.finishedShort')}</span>`
          : (m.status === 'finished'
              ? `<span class="badge badge-pitch">${t('schedule.status.finishedShort')}</span>`
              : `<span class="badge badge-slate">${t('schedule.status.scheduledShort')}</span>`);
        // 比分：r 优先；r 缺失但 m.status=finished 且 m.final_score 存在 → 兜底
        const fallback = (m.status === 'finished' && !r) ? parseFinalScore(m.final_score) : null;
        const hs = r ? r.homeScore : (fallback ? fallback.homeScore : null);
        const as = r ? r.awayScore : (fallback ? fallback.awayScore : null);
        const et = r?.extraTime || null;
        const ps = r?.wentToPenalties && r.penaltyScore
          ? `${r.penaltyScore.home ?? r.penaltyScore.split?.('-')?.[0]}-${r.penaltyScore.away ?? r.penaltyScore.split?.('-')?.[1]}`
          : null;
        const score = (hs !== null && as !== null)
          ? `<div class="text-2xl font-black tabular-nums">${hs} - ${as}</div>
             ${et ? `<div class="text-[10px] sm:text-xs text-slate-500 mt-0.5">${escapeHtml(t('match.extraTime', { score: et }))}</div>` : ''}
             ${ps ? `<div class="text-[10px] sm:text-xs text-amber-600 font-semibold mt-0.5">${escapeHtml(t('match.penaltyScore', { h: ps.split('-')[0], a: ps.split('-')[1] }))}</div>` : ''}`
          : `<div class="text-slate-400 text-sm">${t('common.pending')}</div>`;
        return `
          <a href="/match.html?id=${m.id}" class="card p-4 sm:p-5 flex items-center gap-3 sm:gap-4 hover:-translate-y-0.5 transition-transform block">
            <div class="flex flex-col items-center justify-center w-10 sm:w-12 text-xs text-slate-500 font-semibold">
              ${fmtDate(m.date).time}
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-2 text-xs">
                  ${stageBadge}${statusBadge}
                </div>
                <div class="flex items-center justify-between gap-3">
                  <div class="flex-1 flex items-center gap-2 min-w-0">
                    ${teamChip(home, 'sm')}
                    <span class="font-semibold truncate">${teamDisplayName(home) || m.home}</span>
                  </div>
                  <div class="px-2 text-slate-300 font-bold">${t('common.vs')}</div>
                  <div class="flex-1 flex items-center justify-end gap-2 min-w-0">
                    <span class="font-semibold truncate">${teamDisplayName(away) || m.away}</span>
                    ${teamChip(away, 'sm')}
                  </div>
                </div>
              </div>
            <div class="text-center w-16 sm:w-20">${score}</div>
          </a>
        `;
      }).join('');
      return `
        <section class="mb-8">
          <div class="flex items-baseline gap-3 mb-3">
            <h2 class="text-lg font-bold">${dateLabel}</h2>
            <span class="text-xs text-slate-500">${weekday}</span>
            <span class="text-xs text-slate-400">${t('schedule.dayCount', { n: ms.length })}</span>
          </div>
          <div class="grid lg:grid-cols-2 gap-3">${cardsHtml}</div>
        </section>
      `;
    }).join('');
  }

  ['f-stage', 'f-group', 'f-status'].forEach((id) => {
    document.getElementById(id).addEventListener('change', (e) => {
      state[id.slice(2)] = e.target.value;
      render();
    });
  });
  document.getElementById('f-team').addEventListener('input', (e) => {
    state.team = e.target.value;
    render();
  });
  document.getElementById('f-reset').addEventListener('click', () => {
    state.stage = ''; state.group = ''; state.status = ''; state.team = '';
    document.getElementById('f-stage').value = '';
    document.getElementById('f-group').value = '';
    document.getElementById('f-status').value = '';
    document.getElementById('f-team').value = '';
    render();
  });

  render();
}, { errorTarget: 'schedule-list' });
