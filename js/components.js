// 共享布局：Header / Footer 注入
const NAV_ITEMS = [
  { href: '/', label: '首页', key: 'index' },
  { href: '/schedule.html', label: '赛程', key: 'schedule' },
  { href: '/standings.html', label: '积分榜', key: 'standings' },
  { href: '/results.html', label: '比分', key: 'results' },
  { href: '/predictions.html', label: 'AI 预测', key: 'predictions' },
  { href: '/stats.html', label: '统计', key: 'stats' },
  { href: '/teams.html', label: '球队', key: 'teams' },
  { href: '/bets.html', label: '足彩模拟', key: 'bets' },
  { href: '/about.html', label: '关于', key: 'about' },
];

export function mountHeader(activeKey = '') {
  const el = document.getElementById('app-header');
  if (!el) return;
  const navHtml = NAV_ITEMS.map((it) => {
    const isActive = it.key === activeKey;
    return `<a href="${it.href}" class="nav-link ${isActive ? 'nav-link-active' : ''}">${it.label}</a>`;
  }).join('');

  el.innerHTML = `
    <header class="sticky top-0 z-30 bg-ink/95 backdrop-blur text-white border-b border-white/10">
      <div class="container-page flex items-center gap-4 h-14">
        <a href="/" class="flex items-center gap-2 font-bold text-white">
          <span class="text-gold text-lg">⚽</span>
          <span class="hidden sm:inline">WC 2026 · AI 预测</span>
          <span class="sm:hidden">WC26</span>
        </a>
        <nav class="hidden md:flex items-center gap-1 ml-2">${navHtml}</nav>
        <div class="flex-1"></div>
        <a href="https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/26" target="_blank" rel="noopener" class="hidden sm:inline text-xs text-slate-300 hover:text-gold">FIFA 官网 ↗</a>
      </div>
      <div class="md:hidden border-t border-white/10 overflow-x-auto scrollbar-thin">
        <div class="container-page flex items-center gap-1 py-2 whitespace-nowrap">${navHtml}</div>
      </div>
    </header>
  `;
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
            <span class="font-bold text-white">WC 2026 · AI 预测</span>
          </div>
          <p class="text-sm leading-6 text-slate-400">
            一个静态站点：聚合 2026 美加墨世界杯赛程 + 我的 AI 大模型预测聊天记录。
            <br>每场比赛结束后，比分与命中情况会被更新到本站。
          </p>
        </div>
        <div>
          <div class="font-semibold text-white mb-3">快速链接</div>
          <ul class="space-y-2 text-sm">
            <li><a class="hover:text-gold" href="/schedule.html">完整赛程</a></li>
            <li><a class="hover:text-gold" href="/standings.html">积分榜</a></li>
            <li><a class="hover:text-gold" href="/predictions.html">AI 预测总览</a></li>
            <li><a class="hover:text-gold" href="/stats.html">AI 准确率榜</a></li>
            <li><a class="hover:text-gold" href="/bets.html">个人足彩模拟</a></li>
          </ul>
        </div>
        <div>
          <div class="font-semibold text-white mb-3">数据来源</div>
          <ul class="space-y-2 text-sm text-slate-400">
            <li>赛程：FIFA 2026 官方</li>
            <li>AI 预测：本人本地多模型对话截图</li>
            <li>比分：现场更新</li>
          </ul>
        </div>
      </div>
      <div class="border-t border-white/10">
        <div class="container-page py-4 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>© 2026 WC 2026 AI 预测 · 非商业项目</span>
            <a id="beian-link" class="hover:text-gold hidden" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
              <span id="beian-icon">🛡</span> <span id="beian-no">—</span>
            </a>
            <a id="beian-gongan" class="hover:text-gold hidden" href="https://beian.mps.gov.cn/" target="_blank" rel="noopener noreferrer">
              <span id="beian-gongan-icon">⚠️</span> <span id="beian-gongan-no">—</span>
            </a>
          </div>
          <span>本页所有 AI 预测内容仅代表大模型当时输出，不代表事实</span>
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
