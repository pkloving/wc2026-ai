// 入口脚本：所有页面都引入
import '../css/main.css';
import { mountHeader, mountFooter, mountBeian, getActiveKeyFromPath } from './components.js';

mountHeader(getActiveKeyFromPath());
mountFooter();

// 备案号：拿到工信部 / 公网安备案号后填这里，不填就不显示
mountBeian({
  icp: '',     // 例如 '京ICP备2024xxxxxx号-1'
  gongan: '',  // 例如 '京公网安备 11010xxxxxxxxx号'
});

// 暴露到 window 以便页面级脚本调用
window.WC = { mountHeader, mountFooter, mountBeian };
