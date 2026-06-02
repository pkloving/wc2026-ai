export function fmtDate(iso, opts = {}) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', ...opts.date });
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return { date, time, raw: d };
}

export function fmtDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function fmtWeekday(iso) {
  const d = new Date(iso);
  const map = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return map[d.getDay()];
}

export function relTime(target) {
  const now = Date.now();
  const t = new Date(target).getTime();
  const diff = t - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const future = diff > 0;
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  parts.push(`${mins} 分`);
  return (future ? '还有 ' : '已过 ') + parts.join(' ');
}

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
  // 检测是否为真正的 emoji flag（regional indicator 序列）
  const hasFlag = /\p{Regional_Indicator}/u.test(code);
  if (hasFlag) return { code, label: team.code, tone: 'emoji' };
  return { code, label: team.code, tone: 'text' };
}

export function flagOrCode(team) {
  // 返回首选项：flag emoji 若可能失败则用 code 方块
  if (!team) return { primary: '🏳️', secondary: '?', isText: false };
  if (!team.flag) return { primary: team.code, secondary: team.name, isText: true };
  // 用 object 判断 emoji 是否会被识别
  return { primary: team.flag, secondary: team.code, isText: false };
}

export function teamChip(team, size = 'md') {
  const sc = sizeClass(size);
  if (!team) {
    return `<span class="flag-frame ${sc} flag-frame-fallback" title="未知球队">?</span>`;
  }
  const iso = (team.iso2 || '').toLowerCase();
  const placeholder = team.placeholder || !iso;
  if (placeholder) {
    const colors = team.color ? `background:linear-gradient(135deg, ${team.color}, ${team.color}cc);` : 'background:linear-gradient(135deg,#94a3b8,#64748b);';
    return `<span class="flag-frame ${sc} flag-frame-fallback" style="${colors}" title="${team.name}"><span class="flag-code">${team.code}</span></span>`;
  }
  const fallback = `this.parentElement.classList.add('flag-frame-fallback');var s='background:linear-gradient(135deg, ${team.color || '%230B1F3A'}, ${team.color ? team.color + 'cc' : '%231A3461'};';this.parentElement.setAttribute('style',s);this.insertAdjacentHTML('afterend','<span class=&quot;flag-code&quot;>${team.code}</span>');this.remove();`;
  return `<span class="flag-frame ${sc}" title="${team.name}">
    <img class="flag-img" src="https://flagcdn.com/w80/${iso}.png" srcset="https://flagcdn.com/w160/${iso}.png 2x" alt="${team.name}" loading="lazy" referrerpolicy="no-referrer" onerror="${fallback}" />
  </span>`;
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
  if (!result) return { label: '待开赛', tone: 'badge-slate' };
  if (!prediction) return { label: '无预测', tone: 'badge-slate' };
  const ph = safeNumber(prediction.predictedHome);
  const pa = safeNumber(prediction.predictedAway);
  const rh = safeNumber(result.homeScore);
  const ra = safeNumber(result.awayScore);
  if (ph === rh && pa === ra) return { label: '✅ 比分命中', tone: 'badge-pitch' };
  const pw = ph > pa ? 'home' : ph < pa ? 'away' : 'draw';
  const rw = rh > ra ? 'home' : rh < ra ? 'away' : 'draw';
  if (pw === rw) return { label: '⚠️ 胜负命中', tone: 'badge-gold' };
  return { label: '❌ 未中', tone: 'badge-flame' };
}

export const STAGE_LABEL = {
  group: '小组赛',
  r32: '1/16 决赛',
  r16: '1/8 决赛',
  qf: '1/4 决赛',
  sf: '半决赛',
  third: '三四名决赛',
  final: '决赛',
};
