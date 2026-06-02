// 倒计时：到开幕 + 到下一场比赛
import { getMatches, getResults } from './data.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function diff(target) {
  const now = Date.now();
  const t = new Date(target).getTime();
  let d = Math.max(0, t - now);
  const days = Math.floor(d / 86400000);
  d -= days * 86400000;
  const hours = Math.floor(d / 3600000);
  d -= hours * 3600000;
  const mins = Math.floor(d / 60000);
  d -= mins * 60000;
  const secs = Math.floor(d / 1000);
  return { days, hours, mins, secs };
}

function renderChips(d) {
  // > 1 天时秒级粒度无意义，直接隐藏
  const showSecs = d.days === 0;
  const items = [
    ['天', d.days],
    ['时', d.hours],
    ['分', d.mins],
  ];
  if (showSecs) items.push(['秒', d.secs]);
  return `
    <div class="flex flex-wrap gap-2">
      ${items.map(([u, v]) => `
        <div class="flex-1 min-w-[52px] sm:min-w-[64px] bg-white/10 backdrop-blur rounded-lg sm:rounded-xl px-2 py-1.5 sm:px-3 sm:py-2 text-center">
          <div class="text-xl sm:text-3xl font-bold tabular-nums text-white leading-none">${pad(v)}</div>
          <div class="text-[10px] sm:text-xs text-slate-300 mt-0.5 sm:mt-1">${u}</div>
        </div>
      `).join('')}
    </div>
  `;
}

export async function mountNextMatchCountdown(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const [matches, results] = await Promise.all([getMatches(), getResults()]);
  const resultMap = new Map(results.map((r) => [r.matchId, r]));
  const now = Date.now();
  const next = matches
    .filter((m) => !resultMap.has(m.id) && new Date(m.date).getTime() > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  if (!next) {
    el.innerHTML = `<div class="text-slate-400 text-sm">所有比赛均已结束</div>`;
    return;
  }
  const teams = await import('./data.js').then((m) => m.getTeams());
  const tMap = new Map(teams.map((t) => [t.code, t]));
  const home = tMap.get(next.home);
  const away = tMap.get(next.away);
  el.innerHTML = `
    <div class="text-xs uppercase tracking-widest text-slate-400 mb-2">距下场比赛</div>
    <div class="text-sm sm:text-base text-white mb-2 flex items-center gap-2">
      ${home?.flag || '🏳️'} <span>${home?.name || next.home}</span>
      <span class="text-slate-400 mx-1">vs</span>
      <span>${away?.name || next.away}</span> ${away?.flag || '🏳️'}
    </div>
    <div id="${elId}-chips"></div>
  `;
  const chips = document.getElementById(`${elId}-chips`);
  const tick = () => {
    const d = diff(next.date);
    chips.innerHTML = renderChips(d);
  };
  tick();
  setInterval(tick, 1000);
}
