import { getBets, getTeams } from './data.js';
import { teamChip, fmtDate } from './util.js';
import { t, teamDisplayName } from './i18n.js';

// ---------- 模块状态：仅保留单张 bet 卡片展开状态 ----------
const state = {
  // 哪些 bet.id 当前处于展开状态；默认是排序后第一张
  expandedIds: new Set(),
  initialExpandedSet: false,
};

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
  if (n == null || Number.isNaN(Number(n))) return '0 元';
  const v = Number(n);
  // 整数不带小数；非整数（如 11.53）显示 2 位小数，避免丢失精度
  if (Number.isInteger(v)) return `${v.toFixed(0)} 元`;
  return `${v.toFixed(2)} 元`;
}

function totalSpent(bets, unit) {
  return (bets || []).reduce((sum, b) => sum + betCost(b, unit), 0);
}

function totalWon(bets) {
  return (bets || [])
    .filter((b) => b.result === 'won' && b.actualReturn != null)
    .reduce((sum, b) => sum + safeNum(b.actualReturn), 0);
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

function renderBudgetCard(budget, spent, won) {
  const cap = safeNum(budget?.cap, 0);
  const unit = safeNum(budget?.unit, 2);
  const wonAmt = safeNum(won, 0);
  // 净投入 = 已投入 - 中奖回吐；剩余 = 上限 - 净投入
  const netSpent = Math.max(0, spent - wonAmt);
  const remaining = Math.max(0, cap - netSpent);
  const pct = cap > 0 ? Math.min(100, Math.round((netSpent / cap) * 100)) : 0;
  const over = netSpent > cap;
  return `
    <div class="card p-6 mb-6">
      <div class="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <h2 class="text-xl font-bold">${t('bets.budget.title')}</h2>
        <span class="text-xs text-slate-500">${escapeHtml(budget?.note || '')}</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
        <div>
          <div class="text-xs text-slate-500">${t('bets.budget.total')}</div>
          <div class="text-2xl font-black tabular-nums">${fmtMoney(cap)}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">${t('bets.budget.spent')}</div>
          <div class="text-2xl font-black text-ink tabular-nums">${fmtMoney(spent)}</div>
          <div class="text-[11px] text-slate-400">${t('bets.budget.percent', { n: cap > 0 ? Math.round((spent / cap) * 100) : 0, unit })}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">${t('bets.budget.won')}</div>
          <div class="text-2xl font-black text-pitch tabular-nums">+${fmtMoney(wonAmt)}</div>
          <div class="text-[11px] text-slate-400">${t('bets.budget.wonHint')}</div>
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

function renderParlayCard(bet, teamMap, expanded) {
  // R-004 #6：串关套餐展开规则
  // picks 长度 = 选号个数；parlayType = 套餐（如 ["2x1", "3x1"]）；
  // combinations = 系统按 parlayType 自动展开后的"注数"，**不要手填**。
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
  const source = bet.source
    ? `<p class="text-[11px] text-slate-400 mt-1">📎 ${escapeHtml(bet.source)}</p>`
    : '';
  // 同场多 pick（如比分大包围）按 match 字段合并成 1 行，pickLabel 用 " / " 拼接。
  // data/picks 数组本身保持原样，combinations / totalCost 不动。
  const groups = new Map();
  picks.forEach((p) => {
    const key = p.match || `__nogroup_${groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  const pickRows = Array.from(groups.entries()).map(([matchKey, groupPicks], idx) => {
    const p = groupPicks[0];
    const home = teamMap.get(p.home);
    const away = teamMap.get(p.away);
    const homeName = teamDisplayName(home) || p.home;
    const awayName = teamDisplayName(away) || p.away;
    const accent = pickAccent(p.pick);
    const labels = groupPicks
      .map((gp) => escapeHtml(gp.pickLabel || gp.pick || ''))
      .join(' / ');
    return `
      <div class="flex items-center gap-2 text-sm py-1.5 border-b border-slate-100 last:border-0">
        <span class="text-[11px] text-slate-400 font-mono shrink-0 w-4">${idx + 1}</span>
        <span class="font-mono text-[11px] text-slate-500 shrink-0 w-12">${escapeHtml(p.match || '')}</span>
        ${teamChip(home, 'xs')}
        <span class="font-semibold truncate">${escapeHtml(homeName)}<span class="text-slate-400"> ${hcapText(p.handicap)}</span></span>
        <span class="text-slate-400 text-[11px]">vs</span>
        ${teamChip(away, 'xs')}
        <span class="font-semibold truncate">${escapeHtml(awayName)}</span>
        <span class="ml-auto ${accent} font-bold whitespace-nowrap">→ ${labels}</span>
        ${p.odds != null ? `<span class="text-slate-500 tabular-nums whitespace-nowrap">${t('bets.oddsAt', { n: p.odds })}</span>` : ''}
      </div>
    `;
  }).join('');
  const collapseIcon = expanded ? '▾' : '▸';
  const ariaLabel = expanded ? t('bets.collapse.collapse') : t('bets.collapse.expand');
  return `
    <div class="card p-0 mb-4 bet-card overflow-hidden" data-expanded="${expanded}" data-bet-id="${escapeHtml(bet.id)}">
      <div class="bet-header p-5 cursor-pointer select-none hover:bg-slate-50 transition-colors" data-action="toggle-bet" role="button" tabindex="0" aria-expanded="${expanded}" aria-label="${escapeAttr(ariaLabel)}">
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
          <div class="flex items-start gap-3">
            <div class="text-right">
              <div class="text-xs text-slate-500">${t('bets.cost')}</div>
              <div class="text-xl font-black tabular-nums">${fmtMoney(totalCost)}</div>
              <div class="text-[11px] text-slate-400">${t('bets.picks', { n: picks.length, c: combinations })}</div>
            </div>
            <span class="bet-collapse-icon text-slate-400 text-2xl leading-none mt-1 select-none" aria-hidden="true">${collapseIcon}</span>
          </div>
        </div>
        <div class="rounded-lg bg-slate-100 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>${t('bets.parlay.comboLabel', { n: `<b class="text-ink">${escapeHtml(parlayLabel)}</b>` })}</span>
          <span>${t('bets.parlay.stake', { n: `<b class="text-ink">${safeNum(bet.stakeMultiplier, 1)}</b>` })}</span>
          ${maxReturn != null ? `<span>${t('bets.parlay.maxReturn', { n: `<b class="text-ink">${fmtMoney(maxReturn)}</b>` })}</span>` : ''}
          ${bet.actualReturn != null ? `<span>${t('bets.payout.actual', { n: `<b class="text-pitch">${fmtMoney(bet.actualReturn)}</b>` })}</span>` : ''}
          ${bet.actualReturn != null ? (() => {
            const net = Number(bet.actualReturn) - Number(totalCost);
            const sign = net >= 0 ? '+' : '−';
            const absVal = fmtMoney(Math.abs(net));
            const tone = net >= 0 ? 'text-pitch' : 'text-flame';
            return `<span>${t('bets.payout.net', { n: `<b class="${tone}">${sign}${absVal}</b>` })}</span>`;
          })() : ''}
          <span class="badge ${badge.tone}">${badge.label}</span>
        </div>
      </div>
      <div class="bet-details px-5 pb-5">
        <div class="rounded-lg bg-slate-50 p-2">
          ${pickRows}
        </div>
        ${note}
        ${source}
      </div>
    </div>
  `;
}

function renderBet(bet, teamMap, unit, expanded) {
  if (Array.isArray(bet.picks) && bet.picks.length > 0) {
    return renderParlayCard(bet, teamMap, expanded);
  }
  return renderBetCard(bet, teamMap, unit, expanded);
}

function renderBetCard(bet, teamMap, unit, expanded) {
  const lines = bet.lines || [];
  const cost = betCost(bet, unit);
  const date = bet.date ? fmtDate(bet.date) : null;
  const label = typeLabel(bet.type);
  const note = bet.note
    ? `<p class="text-xs text-slate-500 mt-3 italic">${t('bets.note', { n: escapeHtml(bet.note) })}</p>`
    : '';
  const collapseIcon = expanded ? '▾' : '▸';
  return `
    <div class="card p-0 mb-4 bet-card overflow-hidden" data-expanded="${expanded}" data-bet-id="${escapeHtml(bet.id)}">
      <div class="bet-header p-5 cursor-pointer select-none hover:bg-slate-50 transition-colors" data-action="toggle-bet" role="button" tabindex="0" aria-expanded="${expanded}">
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
          <div class="flex items-start gap-3">
            <div class="text-right">
              <div class="text-xs text-slate-500">${t('bets.cost')}</div>
              <div class="text-xl font-black tabular-nums">${fmtMoney(cost)}</div>
              <div class="text-[11px] text-slate-400">${t('bets.tickets', { n: lines.length, m: lines.reduce((s, l) => s + safeNum(l.multiplier), 0) })}</div>
            </div>
            <span class="bet-collapse-icon text-slate-400 text-2xl leading-none mt-1 select-none">${collapseIcon}</span>
          </div>
        </div>
      </div>
      <div class="bet-details px-5 pb-5">
        <div class="rounded-lg bg-slate-50 p-2">
          ${lines.map((ln) => renderLineRow(ln, teamMap, unit)).join('')}
        </div>
        ${note}
      </div>
    </div>
  `;
}

function renderEmpty(filtered) {
  if (filtered) return `<div class="text-slate-500 text-sm card p-6 text-center">${t('bets.empty.filtered')}</div>`;
  return `<div class="text-slate-500 text-sm">${t('bets.empty')}</div>`;
}

// 按结果分组（顺序：待结算 → 中奖 → 未中）；同结果内按 date 倒序
function groupBetsByResult(bets) {
  const order = ['pending', 'won', 'lost'];
  const groups = new Map(order.map((k) => [k, []]));
  for (const b of bets || []) {
    const key = b.result === 'won' || b.result === 'lost' ? b.result : 'pending';
    groups.get(key).push(b);
  }
  for (const [, list] of groups) {
    list.sort((a, b) => {
      // date 倒序（新的在前）；date 缺失或解析失败则维持原顺序
      const ta = Date.parse(a.date || '') || 0;
      const tb = Date.parse(b.date || '') || 0;
      if (tb !== ta) return tb - ta;
      return 0;
    });
  }
  // 按预设顺序输出，且只保留非空分组
  return order
    .map((k) => [k, groups.get(k)])
    .filter(([, list]) => list.length > 0);
}

function countInGroup(bets) {
  const c = { pending: 0, won: 0, lost: 0 };
  for (const b of bets) {
    if (b.result === 'won') c.won++;
    else if (b.result === 'lost') c.lost++;
    else c.pending++; // null / pending
  }
  return c;
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

function escapeAttr(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function countByResult(bets) {
  const c = { all: bets.length, won: 0, pending: 0, lost: 0 };
  for (const b of bets) {
    if (b.result === 'won') c.won += 1;
    else if (b.result === 'lost') c.lost += 1;
    else c.pending += 1; // null / pending
  }
  return c;
}

function renderResultPanel(result, bets, teamMap, unit, isFirstPanel) {
  const label = t(`bets.group.${result}`);
  const tone = result === 'pending' ? 'badge-slate' : result === 'won' ? 'badge-pitch' : 'badge-flame';
  return `
    <details open class="card overflow-hidden mb-4 group" data-result-panel="${result}">
      <summary class="cursor-pointer select-none p-4 hover:bg-slate-50 flex items-center justify-between gap-3 list-none">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-slate-400 inline-block chevron text-xs">▸</span>
          <span class="text-lg font-bold">${label}</span>
          <span class="text-sm text-slate-500">（${bets.length}）</span>
        </div>
        <div class="flex items-center gap-1.5 text-xs shrink-0">
          <span class="badge ${tone}">${t('bets.filter.subtotal')} ${fmtTotalForGroup(bets, unit)}</span>
        </div>
      </summary>
      <div class="px-4 pb-4 pt-3 space-y-3 border-t border-slate-100">
        ${bets.map((b, i) => renderBet(b, teamMap, unit, isFirstPanel && i === 0)).join('')}
      </div>
    </details>
  `;
}

function fmtTotalForGroup(bets, unit) {
  const spent = bets.reduce((s, b) => s + betCost(b, unit), 0);
  const won = bets
    .filter((b) => b.result === 'won' && b.actualReturn != null)
    .reduce((s, b) => s + safeNum(b.actualReturn), 0);
  const net = won - spent;
  if (won > 0) {
    return `${fmtMoney(spent)} · 返 ${fmtMoney(won)} · 净 ${net >= 0 ? '+' : ''}${fmtMoney(net)}`;
  }
  return fmtMoney(spent);
}

function renderBetsList(orderedBets, teamMap, unit) {
  const listEl = document.getElementById('bets-list');
  if (!listEl) return;
  const groups = groupBetsByResult(orderedBets);
  const html = groups.length === 0
    ? renderEmpty(false)
    : groups.map(([result, bets], i) => renderResultPanel(result, bets, teamMap, unit, i === 0)).join('');
  listEl.innerHTML = html;
  listEl.dataset.region = 'bets-list';
  listEl.dataset.filteredCount = String(orderedBets.length);
}

export async function renderBetsPage() {
  const root = document.getElementById('bets-root');
  if (!root) return;
  const [betsData, teams] = await Promise.all([getBets(), getTeams()]);
  if (!betsData) return;
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const unit = safeNum(betsData.budget?.unit, 2);
  const spent = totalSpent(betsData.bets || [], unit);
  const won = totalWon(betsData.bets || []);
  const orderedBets = betsData.bets || []; // groupBetsByResult 内会再按结果/时间排
  // 写入模块级缓存，供 refreshList 在筛选切换时复用
  _cache = { orderedBets, teamMap, unit, spent, won, betsData };
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
    ${renderBudgetCard(betsData.budget, spent, won)}
    <div id="bets-list"></div>
  `;
  renderBetsList(orderedBets, teamMap, unit);
  bindListEvents();
}

function bindListEvents() {
  const listEl = document.getElementById('bets-list');
  if (!listEl) return;
  if (listEl.dataset.bound === '1') return;
  listEl.dataset.bound = '1';
  listEl.addEventListener('click', (e) => {
    const header = e.target.closest('[data-action="toggle-bet"]');
    if (header) {
      const card = header.closest('.bet-card');
      if (!card) return;
      const id = card.dataset.betId;
      if (state.expandedIds.has(id)) {
        state.expandedIds.delete(id);
        card.dataset.expanded = 'false';
        card.querySelector('.bet-collapse-icon').textContent = '▸';
        card.querySelector('[data-action="toggle-bet"]').setAttribute('aria-expanded', 'false');
      } else {
        state.expandedIds.add(id);
        card.dataset.expanded = 'true';
        card.querySelector('.bet-collapse-icon').textContent = '▾';
        card.querySelector('[data-action="toggle-bet"]').setAttribute('aria-expanded', 'true');
      }
    }
  });
  // 键盘可达：Enter / Space 切换
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const header = e.target.closest('[data-action="toggle-bet"]');
    if (header) {
      e.preventDefault();
      header.click();
    }
  });
}

// 全局缓存，供 refreshList 复用，避免重新拉取
let _cache = null;
function refreshList() {
  if (!_cache) return;
  const { orderedBets, teamMap, unit } = _cache;
  renderBetsList(orderedBets, teamMap, unit);
}

export async function renderBetsPageCached() {
  // 占位：保留以防其它模块引用
  return renderBetsPage();
}

// 把数据缓存挂到模块上，避免依赖全局
const origRender = renderBetsPage;
export async function renderBetsPageFinal() {
  const root = document.getElementById('bets-root');
  if (!root) return;
  const [betsData, teams] = await Promise.all([getBets(), getTeams()]);
  if (!betsData) return;
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const unit = safeNum(betsData.budget?.unit, 2);
  const spent = totalSpent(betsData.bets || [], unit);
  const won = totalWon(betsData.bets || []);
  const orderedBets = betsData.bets || []; // groupBetsByResult 内会再按结果/时间排
  _cache = { orderedBets, teamMap, unit, spent, won, betsData };
  // 直接复用上面的渲染逻辑
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
    ${renderBudgetCard(betsData.budget, spent, won)}
    <div id="bets-list"></div>
  `;
  renderBetsList(orderedBets, teamMap, unit);
  bindListEvents();
  // 静默抑制未使用的 origRender 引用
  void origRender;
}
