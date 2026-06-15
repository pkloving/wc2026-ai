import { getMatches, getResults, getTeams, getGroups, getResultForMatch } from '../data.js';
import { teamChip, teamDisplayName } from '../util.js';
import { t, getLocale } from '../i18n.js';
import { boot } from '../page-boot.js';

boot(async () => {
  const [matches, results, teams, groups] = await Promise.all([
    getMatches(), getResults(), getTeams(), getGroups(),
  ]);
  const teamMap = new Map(teams.map((t) => [t.code, t]));

  // 算每组积分榜
  function computeStandings(groupId) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return [];
    const table = group.teams.map((code) => ({
      code,
      team: teamMap.get(code),
      played: 0, win: 0, draw: 0, lose: 0, gf: 0, ga: 0, pts: 0,
      status: 'pool',
    }));
    const idx = new Map(table.map((t, i) => [t.code, i]));
    const groupMatches = matches.filter((m) => m.group === groupId);
    for (const m of groupMatches) {
      const r = getResultForMatch(m, results);
      if (!r) continue;
      const hi = idx.get(m.home);
      const ai = idx.get(m.away);
      if (hi == null || ai == null) continue;
      table[hi].played += 1;
      table[ai].played += 1;
      table[hi].gf += r.homeScore;
      table[hi].ga += r.awayScore;
      table[ai].gf += r.awayScore;
      table[ai].ga += r.homeScore;
      if (r.homeScore > r.awayScore) {
        table[hi].win += 1; table[hi].pts += 3;
        table[ai].lose += 1;
      } else if (r.homeScore < r.awayScore) {
        table[ai].win += 1; table[ai].pts += 3;
        table[hi].lose += 1;
      } else {
        table[hi].draw += 1; table[ai].draw += 1;
        table[hi].pts += 1; table[ai].pts += 1;
      }
    }
    table.forEach((t) => { t.gd = t.gf - t.ga; });
    table.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    table.forEach((t, i) => {
      if (i < 2) t.status = 'qualify';
      else t.status = 'maybe';
    });
    return table;
  }

  // 算所有组的"第 3 名"
  function computeBestThirds() {
    const thirds = [];
    for (const g of groups) {
      const table = computeStandings(g.id);
      if (table.length >= 3 && table[2].played > 0) {
        thirds.push({ group: g.id, ...table[2] });
      }
    }
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    return thirds;
  }

  let activeGroup = 'A';

  function renderTabs() {
    const el = document.getElementById('group-tabs');
    el.innerHTML = groups.map((g) => `
      <button data-id="${g.id}" class="px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${g.id === activeGroup ? 'bg-ink text-white' : 'text-slate-600 hover:bg-slate-100'}">${getLocale() === 'zh-CN' ? g.id + ' 组' : 'Group ' + g.id}</button>
    `).join('');
    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        activeGroup = b.dataset.id;
        renderTabs();
        renderTable();
      });
    });
  }

  function renderTable() {
    const table = computeStandings(activeGroup);
    const el = document.getElementById('standings-table');
    const hasData = table.some((t) => t.played > 0);
    if (!hasData) {
      el.innerHTML = `<div class="card p-8 text-center text-slate-500">${t('standings.empty')}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="card overflow-hidden">
        <div class="overflow-x-auto scrollbar-thin">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th class="px-3 py-3 text-left">#</th>
                <th class="px-3 py-3 text-left">${t('standings.col.team')}</th>
                <th class="px-2 py-3 text-center" title="${t('standings.col.played')}">${t('standings.col.played')}</th>
                <th class="px-2 py-3 text-center" title="${t('standings.col.win')}">${t('standings.col.win')}</th>
                <th class="px-2 py-3 text-center" title="${t('standings.col.draw')}">${t('standings.col.draw')}</th>
                <th class="px-2 py-3 text-center" title="${t('standings.col.lose')}">${t('standings.col.lose')}</th>
                <th class="px-2 py-3 text-center" title="${t('standings.col.gf')}">${t('standings.col.gf')}</th>
                <th class="px-2 py-3 text-center" title="${t('standings.col.ga')}">${t('standings.col.ga')}</th>
                <th class="px-2 py-3 text-center" title="${t('standings.col.gd')}">${t('standings.col.gd')}</th>
                <th class="px-3 py-3 text-center font-bold">${t('standings.col.pts')}</th>
              </tr>
            </thead>
            <tbody>
              ${table.map((row, i) => `
                <tr class="border-t border-slate-100">
                  <td class="px-3 py-3 text-slate-400 font-semibold">${i + 1}</td>
                  <td class="px-3 py-3">
                    <div class="flex items-center gap-2">
                      ${teamChip(row.team, 'sm')}
                      <span class="font-semibold">${teamDisplayName(row.team) || row.code}</span>
                    </div>
                  </td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.played}</td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.win}</td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.draw}</td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.lose}</td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.gf}</td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.ga}</td>
                  <td class="px-2 py-3 text-center tabular-nums font-semibold ${row.gd > 0 ? 'text-pitch' : row.gd < 0 ? 'text-flame' : ''}">${row.gd > 0 ? '+' : ''}${row.gd}</td>
                  <td class="px-3 py-3 text-center font-black text-lg tabular-nums">${row.pts}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderBestThirds() {
    const thirds = computeBestThirds();
    const el = document.getElementById('third-place-table');
    if (thirds.length === 0) {
      el.innerHTML = `<div class="card p-6 text-center text-slate-500 text-sm">${t('standings.thirds.empty')}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="card overflow-hidden">
        <div class="overflow-x-auto scrollbar-thin">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th class="px-3 py-3 text-left">#</th>
                <th class="px-3 py-3 text-left">${t('standings.col.group')}</th>
                <th class="px-3 py-3 text-left">${t('standings.col.team')}</th>
                <th class="px-2 py-3 text-center">${t('standings.col.played')}</th>
                <th class="px-2 py-3 text-center">${t('standings.col.gf')}</th>
                <th class="px-2 py-3 text-center">${t('standings.col.ga')}</th>
                <th class="px-2 py-3 text-center">${t('standings.col.gd')}</th>
                <th class="px-3 py-3 text-center">${t('standings.col.pts')}</th>
              </tr>
            </thead>
            <tbody>
              ${thirds.map((row, i) => `
                <tr class="border-t border-slate-100 ${i < 8 ? 'bg-pitch/5' : ''}">
                  <td class="px-3 py-3 text-slate-400 font-semibold">${i + 1}</td>
                  <td class="px-3 py-3 font-semibold">${getLocale() === 'zh-CN' ? row.group + ' 组' : 'Group ' + row.group}</td>
                  <td class="px-3 py-3">
                    <div class="flex items-center gap-2">
                      ${teamChip(row.team, 'sm')}
                      <span class="font-semibold">${teamDisplayName(row.team) || row.code}</span>
                    </div>
                  </td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.played}</td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.gf}</td>
                  <td class="px-2 py-3 text-center tabular-nums">${row.ga}</td>
                  <td class="px-2 py-3 text-center tabular-nums font-semibold ${row.gd > 0 ? 'text-pitch' : row.gd < 0 ? 'text-flame' : ''}">${row.gd > 0 ? '+' : ''}${row.gd}</td>
                  <td class="px-3 py-3 text-center font-black text-lg tabular-nums">${row.pts}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderTabs();
  renderTable();
  renderBestThirds();
}, { errorTarget: 'standings-table' });
