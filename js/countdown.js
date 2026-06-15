// 倒计时：到下一场比赛
import { getMatches, getResults, getTeams, getResultForMatch } from './data.js';
import { t, teamDisplayName } from './i18n.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function diff(target) {
  const now = Date.now();
  const t0 = new Date(target).getTime();
  let d = Math.max(0, t0 - now);
  const days = Math.floor(d / 86400000);
  d -= days * 86400000;
  const hours = Math.floor(d / 3600000);
  d -= hours * 3600000;
  const mins = Math.floor(d / 60000);
  d -= mins * 60000;
  const secs = Math.floor(d / 1000);
  return { days, hours, mins, secs };
}

function unitLabels() {
  return [t('countdown.day'), t('countdown.hour'), t('countdown.minute')];
}

function renderChips(d) {
  const showSecs = d.days === 0;
  const labels = unitLabels();
  const items = [
    [labels[0], d.days],
    [labels[1], d.hours],
    [labels[2], d.mins],
  ];
  if (showSecs) items.push([t('countdown.second'), d.secs]);
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
  const [matches, results, teams] = await Promise.all([getMatches(), getResults(), getTeams()]);
  const resultFor = (m) => getResultForMatch(m, results);
  const now = Date.now();
  const next = matches
    .filter((m) => !resultFor(m) && new Date(m.date).getTime() > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  if (!next) {
    el.innerHTML = `<div class="text-slate-400 text-sm">${t('countdown.allOver')}</div>`;
    return;
  }
  const tMap = new Map(teams.map((t) => [t.code, t]));
  const home = tMap.get(next.home);
  const away = tMap.get(next.away);
  const homeSpan = `${home?.flag || '🏳️'} <span>${escapeHtml(teamDisplayName(home) || next.home)}</span>`;
  const awaySpan = `<span>${escapeHtml(teamDisplayName(away) || next.away)}</span> ${away?.flag || '🏳️'}`;
  el.innerHTML = `
    <div class="text-xs uppercase tracking-widest text-slate-400 mb-2">${t('countdown.title')}</div>
    <div class="text-sm sm:text-base text-white mb-2 flex items-center gap-2">
      ${homeSpan} <span class="text-slate-400 mx-1">${t('common.vs')}</span> ${awaySpan}
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

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
