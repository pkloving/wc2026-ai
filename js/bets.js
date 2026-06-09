import { getBets, getTeams } from './data.js';
import { teamChip, fmtDate } from './util.js';
import { t, teamDisplayName } from './i18n.js';

function lineCost(line, unit) {
  return safeNum(line.multiplier) * safeNum(unit, 2);
}

function safeNum(n, d = 0) {
  if (n == null || Number.isNaN(Number(n))) return d;
  return Number(n);
}

function betCost(bet, unit) {
  if (bet.totalCost != null) return safeNum(bet.totalCost);
  if (Array.isArray(bet.picks) && bet.unitCost != null && bet.combinations != null) {
    return safeNum(bet.unitCost) * safeNum(bet.combinations) * safeNum(bet.stakeMultiplier, 1);
  }
  const lines = bet.lines || [];
  return lines.reduce((sum, ln) => sum + lineCost(ln, unit), 0) * safeNum(bet.stakeMultiplier, 1);
}

function fmtMoney(n) {
  return `${n.toFixed(0)} 元`;
}

function totalSpent(bets, unit) {
  return (bets || []).reduce((sum, b) => sum + betCost(b, unit), 0);
}

function lineStatusBadge(result) {
  if (!result || result === 'pending') return { label: t('bets.line.pending'), tone: 'badge-slate' };
  if (result === 'won') return { label: t('bets.line.win'), tone: 'badge-pitch' };
  if (result === 'lost') return { label: t('bets.line.lose'), tone: 'badge-flame' };
  return { label: result, tone: 'badge-slate' };
}

function typeLabel(type) {
  return t(`bets.type.${type}`) || t('bets.type.other');
}

function renderBudgetCard(budget, spent) {
  const cap = safeNum(budget?.cap, 0);
  const unit = safeNum(budget?.unit, 2);
  const remaining = Math.max(0, cap - spent);
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
  const over = spent > cap;
  return `
    <div class="card p-6 mb-6">
      <div class="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <h2 class="text-xl font-bold">${t('bets.budget.title')}</h2>
        <span class="text-xs text-slate-500">${escapeHtml(budget?.note || '')}</span>
      </div>
      <div class="grid grid-cols-3 gap-4 mt-4">
        <div>
          <div class="text-xs text-slate-500">${t('bets.budget.total')}</div>
          <div class="text-2xl font-black tabular-nums">${fmtMoney(cap)}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">${t('bets.budget.spent')}</div>
          <div class="text-2xl font-black text-ink tabular-nums">${fmtMoney(spent)}</div>
          <div class="text-[11px] text-slate-400">${t('bets.budget.percent', { n: pct, unit })}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">${t('bets.budget.remaining')}</div>
          <div class="text-2xl font-black tabular-nums ${over ? 'text-flame' : 'text-pitch'}">${fmtMoney(remaining)}</div>
          <div class="text-[11px] text-slate-400">${over ? t('bets.budget.over') : t('bets.budget.under')}</div>
        </div>
      </div>
      <div class="mt-4 w-full bg-slate-100 rounded-full h-3 overflow-hidden">
        <div class="${over ? 'bg-flame' : 'bg-pitch'} h-full transition-all" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function renderLineRow(line, teamMap, unit) {
  const team = teamMap.get(line.pick);
  const name = teamDisplayName(team) || line.pick;
  const cost = lineCost(line, unit);
  const odds = line.odds != null ? t('bets.odds', { n: line.odds }) : t('bets.oddsTbd');
  const badge = lineStatusBadge(line.result);
  return `
    <div class="flex items-center gap-2 sm:gap-3 text-sm py-1.5 border-b border-slate-100 last:border-0">
      ${teamChip(team, 'sm')}
      <span class="font-semibold truncate flex-1 min-w-0">${escapeHtml(name)}</span>
      <span class="text-xs text-slate-500 hidden md:inline whitespace-nowrap">${odds}</span>
      <span class="badge ${badge.tone} shrink-0">${badge.label}</span>
      <span class="text-xs text-slate-500 tabular-nums text-right whitespace-nowrap shrink-0 ml-auto"><b>${line.multiplier}</b> 倍 · ${fmtMoney(cost)}</span>
    </div>
  `;
}

function pickAccent(pickType) {
  if (pickType === 'home') return 'text-pitch';
  if (pickType === 'away') return 'text-flame';
  if (pickType === 'draw') return 'text-gold';
  return 'text-slate-700';
}

function hcapText(n) {
  if (n == null) return '';
  return n > 0 ? `+${n}` : `${n}`;
}

function renderParlayCard(bet, teamMap) {
  // R-004 #6：串关套餐展开规则
  // picks 长度 = 选号个数；parlayType = 套餐（如 ["2x1", "3x1"]）；
  // combinations = 系统按 parlayType 自动展开后的"注数"，**不要手填**。
  // 常见套餐注数公式：
  //   "3场-2关"   → C(3,2) = 3 注 2×1
  //   "3场-2,3关" → C(3,2) + C(3,3) = 3+1 = 4 注（最常见，6-8 那张票就是）
  //   "3场-3关"   → C(3,3) = 1 注 3×1
  //   "4场-2,3,4关" → C(4,2)+C(4,3)+C(4,4) = 6+4+1 = 11 注
  // 出票时如果发现 combinations 与 picks+parlayType 对不上，**直接报错**。
  const picks = bet.picks || [];
  const totalCost = safeNum(bet.totalCost, 0);
  const combinations = safeNum(bet.combinations, picks.length || 1);
  const maxReturn = bet.maxReturn;
  const badge = lineStatusBadge(bet.result);
  const parlayLabel = (bet.parlayType || []).map((tt) => tt.replace('x', '×')).join(' + ') || t('bets.parlay.combo');
  const date = bet.date ? fmtDate(bet.date) : null;
  const label = typeLabel(bet.type);
  const note = bet.note
    ? `<p class="text-xs text-slate-500 mt-3 italic">${t('bets.note', { n: escapeHtml(bet.note) })}</p>`
    : '';
  const pickRows = picks.map((p, i) => {
    const home = teamMap.get(p.home);
    const away = teamMap.get(p.away);
    const homeName = teamDisplayName(home) || p.home;
    const awayName = teamDisplayName(away) || p.away;
    const accent = pickAccent(p.pick);
    return `
      <div class="flex items-center gap-2 text-sm py-1.5 border-b border-slate-100 last:border-0">
        <span class="text-[11px] text-slate-400 font-mono shrink-0 w-4">${i + 1}</span>
        <span class="font-mono text-[11px] text-slate-500 shrink-0 w-12">${escapeHtml(p.match || '')}</span>
        ${teamChip(home, 'xs')}
        <span class="font-semibold truncate">${escapeHtml(homeName)}<span class="text-slate-400"> ${hcapText(p.handicap)}</span></span>
        <span class="text-slate-400 text-[11px]">vs</span>
        ${teamChip(away, 'xs')}
        <span class="font-semibold truncate">${escapeHtml(awayName)}</span>
        <span class="ml-auto ${accent} font-bold whitespace-nowrap">→ ${escapeHtml(p.pickLabel || '')}</span>
        <span class="text-slate-500 tabular-nums whitespace-nowrap">${t('bets.oddsAt', { n: p.odds })}</span>
      </div>
    `;
  }).join('');
  return `
    <div class="card p-5 mb-4">
      <div class="flex items-start justify-between gap-2 flex-wrap mb-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="badge badge-gold">${label}</span>
            <h3 class="text-lg font-bold">${escapeHtml(bet.title || t('bets.parlay.combo'))}</h3>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            ${bet.matchLabel ? escapeHtml(bet.matchLabel) + ' · ' : ''}${date ? `${date.date} ${date.time}` : ''}
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs text-slate-500">${t('bets.cost')}</div>
          <div class="text-xl font-black tabular-nums">${fmtMoney(totalCost)}</div>
          <div class="text-[11px] text-slate-400">${t('bets.picks', { n: picks.length, c: combinations })}</div>
        </div>
      </div>
      <div class="rounded-lg bg-slate-100 px-3 py-2 mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>${t('bets.parlay.comboLabel', { n: `<b class="text-ink">${escapeHtml(parlayLabel)}</b>` })}</span>
        <span>${t('bets.parlay.stake', { n: `<b class="text-ink">${safeNum(bet.stakeMultiplier, 1)}</b>` })}</span>
        ${maxReturn != null ? `<span>${t('bets.parlay.maxReturn', { n: `<b class="text-ink">${fmtMoney(maxReturn)}</b>` })}</span>` : ''}
        <span class="badge ${badge.tone}">${badge.label}</span>
      </div>
      <div class="rounded-lg bg-slate-50 p-2">
        ${pickRows}
      </div>
      ${note}
    </div>
  `;
}

function renderBet(bet, teamMap, unit) {
  if (Array.isArray(bet.picks) && bet.picks.length > 0) {
    return renderParlayCard(bet, teamMap);
  }
  return renderBetCard(bet, teamMap, unit);
}

function renderBetCard(bet, teamMap, unit) {
  const lines = bet.lines || [];
  const cost = betCost(bet, unit);
  const date = bet.date ? fmtDate(bet.date) : null;
  const label = typeLabel(bet.type);
  const note = bet.note
    ? `<p class="text-xs text-slate-500 mt-3 italic">${t('bets.note', { n: escapeHtml(bet.note) })}</p>`
    : '';
  return `
    <div class="card p-5 mb-4">
      <div class="flex items-start justify-between gap-2 flex-wrap mb-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="badge badge-gold">${label}</span>
            <h3 class="text-lg font-bold">${escapeHtml(bet.title || '投注单')}</h3>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            ${bet.matchLabel ? escapeHtml(bet.matchLabel) + ' · ' : ''}${date ? `${date.date} ${date.time}` : ''}
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs text-slate-500">${t('bets.cost')}</div>
          <div class="text-xl font-black tabular-nums">${fmtMoney(cost)}</div>
          <div class="text-[11px] text-slate-400">${t('bets.tickets', { n: lines.length, m: lines.reduce((s, l) => s + safeNum(l.multiplier), 0) })}</div>
        </div>
      </div>
      <div class="rounded-lg bg-slate-50 p-2">
        ${lines.map((ln) => renderLineRow(ln, teamMap, unit)).join('')}
      </div>
      ${note}
    </div>
  `;
}

function renderEmpty() {
  return `<div class="text-slate-500 text-sm">${t('bets.empty')}</div>`;
}

// 排序：未中的（lost）放最后；其他保持原顺序（一般 JSON 里按时间倒序）
function sortBetsForDisplay(bets) {
  const rank = (r) => (r === 'lost' ? 2 : r === 'won' ? 0 : 1); // pending/null 中间，won 最前，lost 最后
  return [...(bets || [])]
    .map((b, i) => ({ b, i }))
    .sort((a, b2) => {
      const ra = rank(a.b.result);
      const rb = rank(b2.b.result);
      if (ra !== rb) return ra - rb;
      return a.i - b2.i; // 同分组内保持原顺序（时间倒序）
    })
    .map((x) => x.b);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function renderBetsPage() {
  const root = document.getElementById('bets-root');
  if (!root) return;
  const [betsData, teams] = await Promise.all([getBets(), getTeams()]);
  if (!betsData) return;
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const unit = safeNum(betsData.budget?.unit, 2);
  const spent = totalSpent(betsData.bets || [], unit);
  const orderedBets = sortBetsForDisplay(betsData.bets || []);
  const betsHtml = (orderedBets || []).length === 0
    ? renderEmpty()
    : orderedBets.map((b) => renderBet(b, teamMap, unit)).join('');
  const disclaimerHtml = `
    <div class="card p-4 mb-6 bg-slate-100 border-l-4 border-flame">
      <div class="flex items-start gap-3">
        <div class="text-2xl shrink-0">🧪</div>
        <div class="text-sm text-slate-700 leading-relaxed">
          <p class="font-bold text-flame mb-1">${t('bets.disclaimer.title')}</p>
          <p>${betsData.disclaimer || t('bets.disclaimer.default')}</p>
        </div>
      </div>
    </div>
  `;
  root.innerHTML = `
    <section class="mb-6">
      <div class="text-xs uppercase tracking-widest text-slate-500 mb-1">${t('bets.kicker')}</div>
      <h1 class="text-3xl sm:text-4xl font-black">${betsData.title || '🧪 个人足彩模拟'}</h1>
      <p class="text-slate-500 text-sm mt-2">${betsData.subtitle || ''}</p>
    </section>
    ${disclaimerHtml}
    ${renderBudgetCard(betsData.budget, spent)}
    <div>${betsHtml}</div>
  `;
}
