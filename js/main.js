// 入口脚本：所有页面都引入
import '../css/main.css';
import { initI18n, applyI18n, t, subscribeLocaleChange } from './i18n.js';
import { mountHeader, mountFooter, mountBeian, getActiveKeyFromPath } from './components.js';

// 1) 解析 locale 并立刻设到 <html lang>
initI18n();

// 2) 扫一遍静态 [data-i18n] 元素（body 中的标题、描述等）
applyI18n();

// 3) 挂载布局
mountHeader(getActiveKeyFromPath());
mountFooter();

// 4) 备案号：拿到工信部 / 公网安备案号后填这里，不填就不显示
mountBeian({
  icp: '',     // 例如 '京ICP备2024xxxxxx号-1'
  gongan: '',  // 例如 '京公网安备 11010xxxxxxxxx号'
});

// 5) 站点 AI 助手浮窗（所有页面共用）
(async () => {
  try {
    const authMod = await import('./components/auth.js');
    const chatMod = await import('./components/chatbot.js');

    // 右上角登录入口：根据登录态显示「登录」或用户名 + 余额
    const authBtn = document.querySelector('[data-auth-btn]');
    let auth;
    function renderAuthBtn() {
      if (!authBtn) return;
      const u = auth?.getUser?.();
      if (u) {
        const name = (u.email || '').split('@')[0] || '账户';
        authBtn.innerHTML = `<span style="width:6px;height:6px;border-radius:9999px;background:#22c55e;display:inline-block"></span><span>${name}</span>`;
        authBtn.title = `${u.email} · ${u.credits} 问`;
      } else {
        authBtn.textContent = t('nav.login');
        authBtn.title = t('nav.login');
      }
    }

    auth = authMod.mountAuth({
      onLogin: renderAuthBtn,
      onLogout: renderAuthBtn,
      onCreditsChange: renderAuthBtn,
    });
    authBtn?.addEventListener('click', () => {
      if (auth?.getUser?.()) auth.showAccount();
      else auth?.show();
    });

    await auth.checkSession();
    renderAuthBtn();
    chatMod.mountChatbot({ auth });
  } catch (e) {
    console.error('chatbot mount failed', e);
  }
})();

// 6) 暴露到 window 以便页面级脚本调用
window.WC = { mountHeader, mountFooter, mountBeian, t, applyI18n };

// 7) 监听 locale 变化（不重新加载的情况下，刷新动态内容）
//    现在 setLocale 默认 reload=true，所以这里只作为扩展入口。
subscribeLocaleChange(() => {
  applyI18n();
});
