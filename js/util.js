// js/util.js
// ---------------------------------------------------------------
// 通用工具函数（i18n-aware）
// 日期/时间/球队展示等使用 js/i18n.js 的 locale 设置。
// ---------------------------------------------------------------
import {
  formatDate as _fmtDate,
  formatDateShort as _fmtDateShort,
  formatWeekday as _fmtWeekday,
  formatRelative as _relTime,
  teamName as _teamName,
  stageLabel as _stageLabel,
  hitLabel as _hitLabel,
  t,
} from './i18n.js';

// 保留原命名，向后兼容
export function fmtDate(iso, opts) { return _fmtDate(iso, opts); }
export function fmtDateShort(iso) { return _fmtDateShort(iso); }
export function fmtWeekday(iso) { return _fmtWeekday(iso); }
export function relTime(target) { return _relTime(target); }
export function teamDisplayName(team) { return _teamName(team); }

export function groupBy(arr, keyFn) {
  const out = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(x);
  }
  return out;
}

export function teamFlag(team) {
  if (!team) return { code: '🏳️', label: '?', tone: 'slate' };
  const code = team.flag || '🏳️';
  const hasFlag = /\p{Regional_Indicator}/u.test(code);
  if (hasFlag) return { code, label: team.code, tone: 'emoji' };
  return { code, label: team.code, tone: 'text' };
}

export function flagOrCode(team) {
  if (!team) return { primary: '🏳️', secondary: '?', isText: false };
  if (!team.flag) return { primary: team.code, secondary: team.name, isText: true };
  return { primary: team.flag, secondary: team.code, isText: false };
}

export function teamChip(team, size = 'md') {
  const sc = sizeClass(size);
  if (!team) {
    return `<span class="flag-frame ${sc} flag-frame-fallback" title="?">?</span>`;
  }
  const iso = (team.iso2 || '').toLowerCase();
  const placeholder = team.placeholder || !iso;
  if (placeholder) {
    const colors = team.color ? `background:linear-gradient(135deg, ${team.color}, ${team.color}cc);` : 'background:linear-gradient(135deg,#94a3b8,#64748b);';
    return `<span class="flag-frame ${sc} flag-frame-fallback" style="${colors}" title="${escapeAttr(_teamName(team))}"><span class="flag-code">${team.code}</span></span>`;
  }
  const fallback = `this.parentElement.classList.add('flag-frame-fallback');var s='background:linear-gradient(135deg, ${team.color || '#0B1F3A'}, ${team.color ? team.color + 'cc' : '#1A3461'};';this.parentElement.setAttribute('style',s);this.insertAdjacentHTML('afterend','<span class=&quot;flag-code&quot;>${team.code}</span>');this.remove();`;
  return `<span class="flag-frame ${sc}" title="${escapeAttr(_teamName(team))}">
    <img class="flag-img" src="https://flagcdn.com/w80/${iso}.png" srcset="https://flagcdn.com/w160/${iso}.png 2x" alt="${escapeAttr(_teamName(team))}" loading="lazy" referrerpolicy="no-referrer" onerror="${fallback}" />
  </span>`;
}

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sizeClass(size) {
  switch (size) {
    case 'xs': return 'w-5 h-5 text-[10px]';
    case 'sm': return 'w-7 h-7 text-xs';
    case 'md': return 'w-9 h-9 text-sm';
    case 'lg': return 'w-12 h-12 text-base';
    case 'xl': return 'w-16 h-16 text-xl';
    default: return 'w-9 h-9 text-sm';
  }
}

export function teamFlagInline(team) {
  if (!team) return '🏳️';
  return team.flag || '🏳️';
}

export function safeNumber(n, d = 0) {
  if (n == null || Number.isNaN(Number(n))) return d;
  return Number(n);
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function hitBadge(result, prediction) {
  return _hitLabel(result, prediction);
}

// 兼容旧调用：直接给一个 stage code 返回 label
export function stageLabel(stage) { return _stageLabel(stage); }

// 旧的 STAGE_LABEL 常量：保留导出（一些图表会直接用）
export const STAGE_LABEL = new Proxy({}, {
  get(_, stage) { return _stageLabel(stage); },
  has() { return true; },
});
