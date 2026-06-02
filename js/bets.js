import { getBets, getTeams } from './data.js';
import { teamChip, fmtDate } from './util.js';

const TYPE_LABEL = {
  champion: '🏆 冠军',
  match: '⚽ 比赛',
  group: '🅰️ 小组',
  other: '🎯 其它',
};

function lineCost(line, unit) {
  return safeNum(line.multiplier) * safeNum(unit, 2);
}

function safeNum(n, d = 0) {
  if (n == null || Number.isNaN(Number(n))) return d;
  return Number(n);
}

function betCost(bet, unit) {
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
  if (!result || result === 'pending') return { label: '⏳ 待结算', tone: 'badge-slate' };
  if (result === 'won') return { label: '✅ 中奖', tone: 'badge-pitch' };
  if (result === 'lost') return { label: '❌ 未中', tone: 'badge-flame' };
  return { label: result, tone: 'badge-slate' };
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
        <h2 class="text-xl font-bold">💰 投入预算</h2>
        <span class="text-xs text-slate-500">${escapeHtml(budget?.note || '')}</span>
      </div>
      <div class="grid grid-cols-3 gap-4 mt-4">
        <div>
          <div class="text-xs text-slate-500">总上限</div>
          <div class="text-2xl font-black tabular-nums">${fmtMoney(cap)}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">已投入</div>
          <div class="text-2xl font-black text-ink tabular-nums">${fmtMoney(spent)}</div>
          <div class="text-[11px] text-slate-400">${pct}% · 每倍 ${unit} 元</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">剩余</div>
          <div class="text-2xl font-black tabular-nums ${over ? 'text-flame' : 'text-pitch'}">${fmtMoney(remaining)}</div>
          <div class="text-[11px] text-slate-400">${over ? '⚠️ 已超支' : '✓ 在预算内'}</div>
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
  const name = team?.name || line.pick;
  const cost = lineCost(line, unit);
  const odds = line.odds != null ? `赔率 <b>${line.odds}</b>` : '赔率待补';
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

function renderBetCard(bet, teamMap, unit) {
  const lines = bet.lines || [];
  const cost = betCost(bet, unit);
  const date = bet.date ? fmtDate(bet.date) : null;
  const typeLabel = TYPE_LABEL[bet.type] || TYPE_LABEL.other;
  const note = bet.note
    ? `<p class="text-xs text-slate-500 mt-3 italic">📝 ${escapeHtml(bet.note)}</p>`
    : '';
  return `
    <div class="card p-5 mb-4">
      <div class="flex items-start justify-between gap-2 flex-wrap mb-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="badge badge-gold">${typeLabel}</span>
            <h3 class="text-lg font-bold">${escapeHtml(bet.title || '投注单')}</h3>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            ${bet.matchLabel ? escapeHtml(bet.matchLabel) + ' · ' : ''}${date ? `${date.date} ${date.time}` : ''}
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs text-slate-500">投入</div>
          <div class="text-xl font-black tabular-nums">${fmtMoney(cost)}</div>
          <div class="text-[11px] text-slate-400">${lines.length} 票 · ${lines.reduce((s, l) => s + safeNum(l.multiplier), 0)} 倍</div>
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
  return '<div class="text-slate-500 text-sm">暂无投注记录</div>';
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
  const betsHtml = (betsData.bets || []).length === 0
    ? renderEmpty()
    : betsData.bets.map((b) => renderBetCard(b, teamMap, unit)).join('');
  const disclaimerHtml = `
    <div class="card p-4 mb-6 bg-slate-100 border-l-4 border-flame">
      <div class="flex items-start gap-3">
        <div class="text-2xl shrink-0">🧪</div>
        <div class="text-sm text-slate-700 leading-relaxed">
          <p class="font-bold text-flame mb-1">本页为「足彩玩法」沙盘推演 / 模拟数据</p>
          <p>${betsData.disclaimer || '本页面所有金额、倍数、球队选择、命中结果均为虚构/模拟数据，不构成任何投注建议。竞彩有风险，未满 18 周岁请勿参与。'}</p>
        </div>
      </div>
    </div>
  `;
  root.innerHTML = `
    <section class="mb-6">
      <div class="text-xs uppercase tracking-widest text-slate-500 mb-1">Lottery Simulation</div>
      <h1 class="text-3xl sm:text-4xl font-black">${betsData.title || '🧪 个人足彩模拟'}</h1>
      <p class="text-slate-500 text-sm mt-2">${betsData.subtitle || ''}</p>
    </section>
    ${disclaimerHtml}
    ${renderBudgetCard(betsData.budget, spent)}
    <div>${betsHtml}</div>
  `;
}
