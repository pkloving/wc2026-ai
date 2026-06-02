import { getTeams, getGroups, getMatches, getResults } from '../data.js';
import { teamChip } from '../util.js';
import { boot } from '../page-boot.js';

boot(async () => {
  const [teams, groups, matches, results] = await Promise.all([
    getTeams(), getGroups(), getMatches(), getResults(),
  ]);
  const resultMap = new Map(results.map((r) => [r.matchId, r]));

  // 球队属于哪个组
  const groupByTeam = new Map();
  for (const g of groups) for (const c of g.teams) groupByTeam.set(c, g.id);

  // 该队已赛场次 / 战绩
  const teamStats = new Map();
  teams.forEach((t) => teamStats.set(t.code, { played: 0, win: 0, draw: 0, lose: 0, gf: 0, ga: 0 }));
  for (const m of matches) {
    const r = resultMap.get(m.id);
    if (!r) continue;
    const h = teamStats.get(m.home);
    const a = teamStats.get(m.away);
    if (!h || !a) continue;
    h.played += 1; a.played += 1;
    h.gf += r.homeScore; h.ga += r.awayScore;
    a.gf += r.awayScore; a.ga += r.homeScore;
    if (r.homeScore > r.awayScore) { h.win += 1; a.lose += 1; }
    else if (r.homeScore < r.awayScore) { a.win += 1; h.lose += 1; }
    else { h.draw += 1; a.draw += 1; }
  }

  let activeConf = '';
  function render() {
    const realTeams = teams.filter((t) => !t.placeholder);
    const list = activeConf ? realTeams.filter((t) => t.confederation === activeConf) : realTeams;
    const el = document.getElementById('teams-grid');
    el.innerHTML = list.map((t) => {
      const s = teamStats.get(t.code);
      const group = groupByTeam.get(t.code);
      return `
        <div class="card p-4 flex flex-col items-center text-center">
          ${teamChip(t, 'lg')}
          <div class="font-bold mt-2">${t.name}</div>
          <div class="text-xs text-slate-500 mt-1">${t.nameEn}</div>
          <div class="mt-2 flex items-center gap-1.5 text-xs flex-wrap justify-center">
            ${group ? `<span class="badge badge-ink">${group} 组</span>` : ''}
            <span class="badge badge-slate">${t.confederation}</span>
          </div>
          ${s.played > 0 ? `<div class="mt-2 text-xs text-slate-500">${s.played} 场 · ${s.win}胜${s.draw}平${s.lose}负</div>` : ''}
        </div>
      `;
    }).join('');
  }

  document.querySelectorAll('.conf-btn').forEach((b) => {
    b.addEventListener('click', () => {
      activeConf = b.dataset.conf;
      document.querySelectorAll('.conf-btn').forEach((x) => {
        x.classList.remove('bg-ink', 'text-white');
        x.classList.add('bg-slate-100', 'hover:bg-slate-200');
      });
      b.classList.remove('bg-slate-100', 'hover:bg-slate-200');
      b.classList.add('bg-ink', 'text-white');
      render();
    });
  });
  render();
}, { errorTarget: 'teams-grid' });
