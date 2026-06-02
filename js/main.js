// 入口脚本：所有页面都引入
import '../css/main.css';
import { mountHeader, mountFooter, getActiveKeyFromPath } from './components.js';

mountHeader(getActiveKeyFromPath());
mountFooter();

// 暴露到 window 以便页面级脚本调用
window.WC = { mountHeader, mountFooter };
