// js/pages/matches.js — matches.html segmented control + hash 路由
// 3 个原 page module (schedule/standings/results) 已 mount 各自固定 ID 的容器,
// 这里只负责: hash 路由切 visible view, 同步 active tab 样式, 写 history.

import { applyI18n } from '../i18n.js';

const TABS = ['schedule', 'standings', 'results'];

function getTabFromHash() {
  const h = (location.hash || '').replace(/^#/, '').toLowerCase();
  return TABS.includes(h) ? h : 'schedule';
}

function setActiveTab(tab) {
  document.querySelectorAll('.matches-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.matches-view').forEach((s) => s.classList.toggle('is-active', s.dataset.view === tab));
  // 更新 hash (无 scroll 跳)
  if (location.hash !== '#' + tab) {
    history.replaceState(null, '', '#' + tab);
  }
}

function bind() {
  document.querySelectorAll('.matches-tab').forEach((b) => {
    b.addEventListener('click', () => setActiveTab(b.dataset.tab));
  });
  window.addEventListener('hashchange', () => setActiveTab(getTabFromHash()));
}

function main() {
  bind();
  setActiveTab(getTabFromHash());
  applyI18n();
}

main();
