import { getMatches, getResults, getTeams } from '../data.js';
import { fmtDate, STAGE_LABEL, teamChip } from '../util.js';
import { boot } from '../page-boot.js';

boot(async () => {
  const [matches, results, teams] = await Promise.all([getMatches(), getResults(), getTeams()]);
  const resultMap = new Map(results.map((r) => [r.matchId, r]));
  const teamMap = new Map(teams.map((t) => [t.code, t]));

  const state = { stage: '', group: '', status: '', team: '' };

  function applyFilters() {
    return matches.filter((m) => {
      if (state.stage && m.stage !== state.stage) return false;
      if (state.group && m.group !== state.group) return false;
      const r = resultMap.get(m.id);
      const mStatus = r ? 'finished' : 'scheduled';
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
    document.getElementById('f-count').textContent = `共 ${list.length} 场`;
    const grouped = groupByDate(list);
    const el = document.getElementById('schedule-list');
    if (list.length === 0) {
      el.innerHTML = '<div class="text-slate-500 text-sm">无匹配比赛</div>';
      return;
    }
    el.innerHTML = grouped.map(([date, ms]) => {
      // date 是北京时区日期键（YYYY-MM-DD），按北京时区解析避免跨时区偏差
      const [yy, mm, dd] = date.split('-').map(Number);
      const d = new Date(yy, mm - 1, dd);
      const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
      const cardsHtml = ms.map((m) => {
        const home = teamMap.get(m.home);
        const away = teamMap.get(m.away);
        const r = resultMap.get(m.id);
        const stageBadge = m.stage === 'group'
          ? `<span class="badge badge-ink">${m.group} 组</span>`
          : `<span class="badge badge-gold">${STAGE_LABEL[m.stage] || m.stage}</span>`;
        const statusBadge = r
          ? `<span class="badge badge-pitch">已结束</span>`
          : `<span class="badge badge-slate">未开赛</span>`;
        const score = r
          ? `<div class="text-2xl font-black tabular-nums">${r.homeScore} - ${r.awayScore}</div>`
          : '<div class="text-slate-400 text-sm">待开赛</div>';
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
                    <span class="font-semibold truncate">${home?.name || m.home}</span>
                  </div>
                  <div class="px-2 text-slate-300 font-bold">vs</div>
                  <div class="flex-1 flex items-center justify-end gap-2 min-w-0">
                    <span class="font-semibold truncate">${away?.name || m.away}</span>
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
            <h2 class="text-lg font-bold">${d.getMonth() + 1} 月 ${d.getDate()} 日</h2>
            <span class="text-xs text-slate-500">${weekday}</span>
            <span class="text-xs text-slate-400">${ms.length} 场</span>
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
