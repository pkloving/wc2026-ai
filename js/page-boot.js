/**
 * Page Boot Helper
 * ----------------
 * 把"需要 await 数据再渲染"的页面逻辑包成 IIFE，
 * 避免顶级 await 阻塞 module 解析，让浏览器可以先画出静态骨架。
 *
 * 用法:
 *   import { boot } from './page-boot.js';
 *   boot(async () => { ...你的页面初始化... });
 *
 *  - 自动捕获错误并在控制台打印
 *  - 自动移除 .is-loading / [aria-busy] 标记
 *  - 错误时把占位元素替换成错误提示
 */

import { t } from './i18n.js';

export function boot(initFn, options = {}) {
  const { errorTarget, removeBusy = true } = options;
  (async () => {
    try {
      await initFn();
    } catch (err) {
      console.error('[page-boot] init failed:', err);
      if (errorTarget) {
        const el = typeof errorTarget === 'string' ? document.getElementById(errorTarget) : errorTarget;
        if (el) el.innerHTML = `<div class="card p-6 text-center text-flame">${t('stats.error', { msg: escapeHtml(err?.message || String(err)) })}</div>`;
      }
    } finally {
      if (removeBusy) {
        document.querySelectorAll('[aria-busy="true"]').forEach((el) => el.removeAttribute('aria-busy'));
      }
    }
  })();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
