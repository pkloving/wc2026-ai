import { getChampion, getTeams } from './data.js';
import { teamChip } from './util.js';

function tallyEntries(entries) {
  const tally = new Map();
  for (const e of entries) {
    for (const code of [e.champion, e.runnerUp]) {
      const t = tally.get(code) || { code, count: 0, championCount: 0, runnerUpCount: 0 };
      t.count += 1;
      if (code === e.champion) t.championCount += 1;
      if (code === e.runnerUp) t.runnerUpCount += 1;
      tally.set(code, t);
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count);
}

function pickLayout(compact) {
  return compact
    ? { cardClass: 'card p-6', gridClass: 'grid sm:grid-cols-2 gap-3' }
    : { cardClass: 'card p-5', gridClass: 'grid sm:grid-cols-2 gap-3' };
}

function renderCards(entries, teamMap, compact) {
  return entries.map((e) => {
    const champ = teamMap.get(e.champion);
    const runUp = teamMap.get(e.runnerUp);
    const champTint = champ?.color ? `style="border-left:4px solid ${champ.color}"` : '';
    const note = e.note
      ? `<div class="text-[11px] text-slate-500 mt-2 italic">${e.note}</div>`
      : '';
    const authorTag = e.isAuthor
      ? '<span class="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded ml-1">本站作者使用</span>'
      : '';
    const modelsLine = e.models.map((m, i) => (
      `<span class="text-sm font-bold text-slate-800">${m}</span>${authorTag && i === 0 ? authorTag : ''}${i < e.models.length - 1 ? '<span class="text-slate-300 mx-1">/</span>' : ''}`
    )).join('');
    const chipSize = compact ? 'sm' : 'md';
    return `
      <div class="rounded-xl border border-slate-200 p-4 bg-slate-50" ${champTint}>
        <div class="flex flex-wrap items-center gap-y-1 mb-3">${modelsLine}</div>
        <div class="flex items-center gap-2 text-sm">
          <span class="badge badge-gold shrink-0">🥇 冠军</span>
          ${teamChip(champ, chipSize)}
          <span class="font-black text-base truncate">${champ?.name || e.champion}</span>
        </div>
        <div class="flex items-center gap-2 text-sm mt-2">
          <span class="badge badge-slate shrink-0">🥈 亚军</span>
          ${teamChip(runUp, chipSize)}
          <span class="font-bold truncate">${runUp?.name || e.runnerUp}</span>
        </div>
        ${note}
      </div>
    `;
  }).join('');
}

export async function renderChampionSection(targetId, opts = {}) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const { compact = false } = opts;
  const [championData, teams] = await Promise.all([getChampion(), getTeams()]);
  if (!championData || !championData.entries || championData.entries.length === 0) return;

  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const ranked = tallyEntries(championData.entries);
  const top = ranked[0];
  const topTeam = teamMap.get(top?.code);
  const topName = topTeam?.name || top?.code;
  const champions = ranked.filter((t) => t.championCount > 0).map((t) => teamMap.get(t.code)?.name || t.code);
  const consensus = top
    ? `<span class="font-bold text-ink">${topName}</span> 出现 <b>${top.count}</b> 次（🥇${top.championCount} / 🥈${top.runnerUpCount}）`
    : '';
  const raceLine = champions.length >= 3
    ? `${champions.join(' / ')} 三足鼎立`
    : champions.join(' / ');

  const { cardClass, gridClass } = pickLayout(compact);
  const titleTag = compact ? 'h2' : 'h2';
  const titleClass = compact ? 'text-xl font-bold mb-3' : 'text-lg font-bold';
  const subtitleClass = compact ? 'text-slate-600 mb-4' : 'text-slate-500 text-sm mb-4';

  el.innerHTML = `
    <div class="${cardClass}">
      <${titleTag} class="${titleClass}">${championData.title || '🏆 AI 冠亚军预测'}</${titleTag}>
      <p class="${subtitleClass}">${championData.subtitle || ''}</p>
      <div class="${gridClass}">${renderCards(championData.entries, teamMap, compact)}</div>
      <p class="text-xs text-slate-500 mt-4">📌 <b>多数票：</b>${consensus}，是最大公约数；冠军归属则出现 ${raceLine}。比赛结束后本站会按实际结果更新命中情况。</p>
    </div>
  `;
}
