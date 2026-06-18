// js/components.js
// ---------------------------------------------------------------
// 共享布局：Header / Footer / 备案号 注入（i18n-aware）
// ---------------------------------------------------------------
import { t, getLocale, setLocale, LOCALES } from './i18n.js';

const NAV_ITEMS = [
  { href: '/', labelKey: 'nav.home', key: 'index' },
  { href: '/schedule.html', labelKey: 'nav.schedule', key: 'schedule' },
  { href: '/standings.html', labelKey: 'nav.standings', key: 'standings' },
  { href: '/results.html', labelKey: 'nav.results', key: 'results' },
  { href: '/predictions.html', labelKey: 'nav.predictions', key: 'predictions' },
  { href: '/stats.html', labelKey: 'nav.stats', key: 'stats' },
  { href: '/teams.html', labelKey: 'nav.teams', key: 'teams' },
  { href: '/bets.html', labelKey: 'nav.bets', key: 'bets' },
  { href: '/about.html', labelKey: 'nav.about', key: 'about' },
  { href: '/contact.html', labelKey: 'nav.contact', key: 'contact' },
];

function langSwitcherHtml() {
  const cur = getLocale();
  return `
    <div class="lang-switcher relative" data-lang-switcher>
      <button type="button" class="lang-btn" aria-haspopup="listbox" aria-expanded="false">
        <span>${cur === 'zh-CN' ? '中' : 'EN'}</span>
        <svg class="w-3 h-3 opacity-70" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5L6 7.5L9 4.5"/></svg>
      </button>
      <ul class="lang-menu hidden absolute right-0 mt-1 z-50" role="listbox">
        ${LOCALES.map((loc) => `
          <li>
            <button type="button" data-lang="${loc}" class="lang-option ${loc === cur ? 'is-active' : ''}">
              ${loc === 'zh-CN' ? '中文（简体）' : 'English'}
            </button>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function bindLangSwitcher(root) {
  const wrap = root.querySelector('[data-lang-switcher]');
  if (!wrap || wrap.dataset.bound === '1') return;
  wrap.dataset.bound = '1';
  const btn = wrap.querySelector('.lang-btn');
  const menu = wrap.querySelector('.lang-menu');
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !menu.classList.contains('hidden');
    if (open) {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    } else {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }
  });
  menu?.querySelectorAll('[data-lang]').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const loc = opt.getAttribute('data-lang');
      if (loc && loc !== getLocale()) setLocale(loc, { reload: true });
    });
  });
  // 点击外部关闭
  document.addEventListener('click', () => {
    if (!menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

export function mountHeader(activeKey = '') {
  const el = document.getElementById('app-header');
  if (!el) return;
  const navHtml = NAV_ITEMS.map((it) => {
    const isActive = it.key === activeKey;
    return `<a href="${it.href}" class="nav-link ${isActive ? 'nav-link-active' : ''}">${t(it.labelKey)}</a>`;
  }).join('');

  el.innerHTML = `
    <header class="sticky top-0 z-30 bg-ink/95 backdrop-blur text-white border-b border-white/10">
      <div class="container-page flex items-center gap-4 h-14">
        <a href="/" class="flex items-center gap-2 font-bold text-white">
          <span class="text-gold text-lg">⚽</span>
          <span class="hidden sm:inline">${t('footer.siteName')}</span>
          <span class="sm:hidden">WC26</span>
        </a>
        <nav class="hidden md:flex items-center gap-1 ml-2">${navHtml}</nav>
        <div class="flex-1"></div>
        <a href="https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/26" target="_blank" rel="noopener" class="hidden sm:inline text-xs text-slate-300 hover:text-gold">${t('nav.fifa')} ↗</a>
        ${langSwitcherHtml()}
        <button type="button" data-auth-btn class="inline-flex items-center gap-1.5 rounded-full bg-gold text-ink text-xs font-bold px-3 py-1.5 hover:opacity-90 transition whitespace-nowrap">${t('nav.login')}</button>
      </div>
      <div class="md:hidden border-t border-white/10 overflow-x-auto scrollbar-thin">
        <div class="container-page flex items-center gap-1 py-2 whitespace-nowrap">${navHtml}</div>
      </div>
    </header>
  `;
  bindLangSwitcher(el);
}

export function mountFooter() {
  const el = document.getElementById('app-footer');
  if (!el) return;
  el.innerHTML = `
    <footer class="mt-16 bg-night text-slate-300">
      <div class="container-page py-10 grid gap-8 md:grid-cols-3">
        <div>
          <div class="flex items-center gap-2 mb-3">
            <span class="text-gold text-lg">⚽</span>
            <span class="font-bold text-white">${t('footer.siteName')}</span>
          </div>
          <p class="text-sm leading-6 text-slate-400">
            ${t('footer.tagline')}
            <br>${t('footer.tagline2')}
          </p>
        </div>
        <div>
          <div class="font-semibold text-white mb-3">${t('footer.quickLinks')}</div>
          <ul class="space-y-2 text-sm">
            <li><a class="hover:text-gold" href="/schedule.html">${t('nav.schedule')}</a></li>
            <li><a class="hover:text-gold" href="/standings.html">${t('nav.standings')}</a></li>
            <li><a class="hover:text-gold" href="/predictions.html">${t('nav.predictions')}</a></li>
            <li><a class="hover:text-gold" href="/stats.html">${t('nav.stats')}</a></li>
            <li><a class="hover:text-gold" href="/bets.html">${t('nav.bets')}</a></li>
            <li><a class="hover:text-gold" href="/contact.html">${t('nav.contact')}</a></li>
          </ul>
        </div>
        <div>
          <div class="font-semibold text-white mb-3">${t('footer.dataSources')}</div>
          <ul class="space-y-2 text-sm text-slate-400">
            <li>${t('footer.sourceSchedule')}</li>
            <li>${t('footer.sourceResults')}</li>
          </ul>
        </div>
      </div>
      <div class="border-t border-white/10">
        <div class="container-page py-4 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>${t('footer.copyright')}</span>
            <a id="beian-link" class="hover:text-gold hidden" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
              <span id="beian-icon">${t('footer.beianIc')}</span> <span id="beian-no">—</span>
            </a>
            <a id="beian-gongan" class="hover:text-gold hidden" href="https://beian.mps.gov.cn/" target="_blank" rel="noopener noreferrer">
              <span id="beian-gongan-icon">${t('footer.beianGongan')}</span> <span id="beian-gongan-no">—</span>
            </a>
          </div>
          <span>${t('footer.disclaimer')}</span>
        </div>
      </div>
    </footer>
  `;
}

/**
 * 配置备案号：拿到工信部备案号后调用
 *
 *   <script type="module">
 *     import { mountBeian } from '/js/components.js';
 *     mountBeian({ icp: '京ICP备2024xxxxxx号-1', gongan: '京公网安备 11010xxxxxxxxx号' });
 *   </script>
 *
 * 不传就不显示，整站非侵入。
 */
export function mountBeian({ icp, gongan } = {}) {
  if (icp) {
    const a = document.getElementById('beian-link');
    const no = document.getElementById('beian-no');
    if (a && no) {
      no.textContent = icp;
      a.classList.remove('hidden');
    }
  }
  if (gongan) {
    const a = document.getElementById('beian-gongan');
    const no = document.getElementById('beian-gongan-no');
    if (a && no) {
      no.textContent = gongan;
      a.classList.remove('hidden');
    }
  }
}

export function getActiveKeyFromPath() {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p.endsWith('/index.html')) return 'index';
  for (const it of NAV_ITEMS) {
    if (p.endsWith(it.href)) return it.key;
  }
  return '';
}
