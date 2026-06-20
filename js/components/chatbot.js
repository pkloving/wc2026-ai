// js/components/chatbot.js
// ---------------------------------------------------------------
// 站点内嵌的 AI 预测助手浮窗（v0.2：登录 + 积分 + 退款 + 限流）
// ---------------------------------------------------------------
// 接受 auth 实例（mountAuth 返回）用于登录态 + 余额展示
// ---------------------------------------------------------------

const STORAGE_KEY = 'wc2026_chat_history_v1';
const AUTO_OPEN_KEY = 'wc2026_chat_autoopened_v1'; // 首次访问滚动后主动弹窗，弹过即不再弹
const MAX_HISTORY = 12; // 只带最近 N 条进 API

const ICON_CHAT = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-6 h-6">
  <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICON_CLOSE = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-5 h-5">
  <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/>
</svg>`;

const ICON_SEND = `
<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
  <path d="M3 11.5 21 4l-7.5 18-2.5-7.5L3 11.5Z"/>
</svg>`;

const ICON_CLEAR = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="w-4 h-4">
  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const STYLE = `
[hidden] { display: none !important; }
.wc-chat-fab {
  position: fixed; right: 1.25rem; bottom: 1.25rem; z-index: 60;
  width: 56px; height: 56px; border-radius: 50%;
  background: linear-gradient(135deg, #0B1F3A 0%, #1e3a8a 100%);
  color: #D4AF37; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10px 25px -5px rgba(11,31,58,.5), 0 0 0 1px rgba(212,175,55,.3) inset;
  cursor: pointer; transition: transform .2s, box-shadow .2s;
}
.wc-chat-fab:hover { transform: translateY(-2px); box-shadow: 0 15px 30px -5px rgba(11,31,58,.6), 0 0 0 1px rgba(212,175,55,.5) inset; }
.wc-chat-fab-badge {
  position: absolute; top: -2px; right: -2px;
  background: #E63946; color: #fff; font-size: 10px; font-weight: 700;
  padding: 2px 6px; border-radius: 9999px;
}
.wc-chat-panel {
  position: fixed; right: 1.25rem; bottom: 5.5rem; z-index: 60;
  width: min(380px, calc(100vw - 2.5rem)); height: min(560px, calc(100vh - 8rem));
  background: #fff; border-radius: 1rem; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 50px -10px rgba(11,31,58,.35), 0 0 0 1px rgba(11,31,58,.08);
  transform-origin: bottom right;
  animation: wcChatPop .18s ease-out;
}
@keyframes wcChatPop { from { opacity: 0; transform: scale(.96) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.wc-chat-header {
  background: linear-gradient(135deg, #0B1F3A 0%, #1e3a8a 100%);
  color: #fff; padding: .85rem 1rem;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid rgba(212,175,55,.3);
}
.wc-chat-header-title { font-weight: 700; font-size: .95rem; display: flex; align-items: center; gap: .5rem; }
.wc-chat-header-sub { font-size: .7rem; opacity: .75; }
.wc-chat-header-credits { font-size: .75rem; opacity: .9; }
.wc-chat-header-credits b { color: #D4AF37; font-weight: 700; }
.wc-chat-msgs { flex: 1 1 auto; overflow-y: auto; padding: 1rem; background: #f8fafc; }
.wc-chat-msg { margin-bottom: .85rem; max-width: 85%; }
.wc-chat-msg-user { margin-left: auto; }
.wc-chat-msg-bubble {
  padding: .55rem .8rem; border-radius: 1rem; line-height: 1.5;
  font-size: .875rem; word-break: break-word; white-space: pre-wrap;
}
.wc-chat-msg-bot .wc-chat-msg-bubble { background: #fff; color: #0B1F3A; border: 1px solid #e2e8f0; border-top-left-radius: .35rem; }
.wc-chat-msg-user .wc-chat-msg-bubble { background: #0B1F3A; color: #fff; border-top-right-radius: .35rem; }
.wc-chat-msg-meta { font-size: .65rem; color: #94a3b8; margin-top: .25rem; padding: 0 .25rem; }
.wc-chat-msg-bot .wc-chat-msg-meta { text-align: left; }
.wc-chat-msg-user .wc-chat-msg-meta { text-align: right; }
.wc-chat-msg-bubble a { color: #1d4ed8; text-decoration: underline; }
.wc-chat-msg-bubble code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: .8em; }
.wc-chat-msg-bubble pre { background: #0B1F3A; color: #e2e8f0; padding: .5rem .75rem; border-radius: .5rem; overflow-x: auto; font-size: .75rem; margin: .5rem 0; }
.wc-chat-msg-bubble table { border-collapse: collapse; margin: .5rem 0; font-size: .75rem; }
.wc-chat-msg-bubble th, .wc-chat-msg-bubble td { border: 1px solid #cbd5e1; padding: .25rem .5rem; }
.wc-chat-msg-bubble th { background: #f1f5f9; }
.wc-chat-cursor::after { content: '▊'; animation: wcBlink 1s steps(2) infinite; color: #94a3b8; }
@keyframes wcBlink { 50% { opacity: 0; } }
.wc-chat-input {
  border-top: 1px solid #e2e8f0; background: #fff;
  padding: .65rem; display: flex; gap: .5rem; align-items: flex-end;
}
.wc-chat-input textarea {
  flex: 1; resize: none; border: 1px solid #e2e8f0; border-radius: .5rem;
  padding: .5rem .65rem; font-size: .875rem; line-height: 1.4;
  max-height: 7rem; min-height: 2.4rem;
  font-family: inherit; outline: none;
}
.wc-chat-input textarea:focus { border-color: #D4AF37; box-shadow: 0 0 0 3px rgba(212,175,55,.15); }
.wc-chat-send {
  background: #0B1F3A; color: #D4AF37; border: none; border-radius: .5rem;
  padding: .55rem .75rem; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.wc-chat-send:disabled { opacity: .4; cursor: not-allowed; }
.wc-chat-send:hover:not(:disabled) { background: #1e3a8a; }
.wc-chat-clear {
  background: transparent; color: #94a3b8; border: none; cursor: pointer;
  display: flex; align-items: center; padding: 4px; border-radius: 4px;
}
.wc-chat-clear:hover { color: #E63946; background: #fef2f2; }
.wc-chat-welcome { padding: 1rem; text-align: center; color: #64748b; font-size: .85rem; }
.wc-chat-welcome strong { color: #0B1F3A; }
.wc-chat-welcome ul { text-align: left; margin-top: .75rem; font-size: .8rem; }
.wc-chat-welcome li { margin: .25rem 0; }
.wc-chat-error { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: .5rem; padding: .5rem .75rem; font-size: .8rem; margin: .5rem 1rem; }
.wc-chat-suggestions { display: flex; flex-wrap: wrap; gap: .35rem; padding: 0 1rem .75rem; }
.wc-chat-suggestion {
  background: #f1f5f9; border: 1px solid #e2e8f0; color: #0B1F3A;
  padding: .3rem .65rem; border-radius: 9999px; font-size: .75rem; cursor: pointer;
  transition: background .15s;
}
.wc-chat-suggestion:hover { background: #D4AF37; color: #0B1F3A; }
.wc-chat-suggestion-simulate {
  background: #f1f5f9; border: 1px dashed #D4AF37; color: #0B1F3A;
  padding: .4rem .8rem; font-size: .8rem; font-weight: 600;
  position: relative;
}
.wc-chat-suggestion-simulate .soontag {
  display: inline-block; background: #D4AF37; color: #0B1F3A;
  font-size: .6rem; padding: .05rem .35rem; border-radius: 9999px;
  margin-left: .3rem; vertical-align: middle; font-weight: 700;
}
.wc-chat-locked {
  text-align: center; padding: 2rem 1rem; color: #64748b; font-size: .875rem;
}
.wc-chat-locked-icon { font-size: 2.5rem; margin-bottom: .5rem; }
.wc-chat-locked strong { display: block; color: #0B1F3A; font-size: 1rem; margin-bottom: .35rem; }
.wc-chat-locked-intro { color: #475569; }
.wc-chat-locked-feats { text-align: left; max-width: 290px; margin: .85rem auto 0; padding-left: 1.15rem; font-size: .8rem; color: #334155; }
.wc-chat-locked-feats li { margin: .35rem 0; }
.wc-chat-locked-feats b { color: #0B1F3A; }
.wc-chat-locked-free { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: .5rem; padding: .5rem .65rem; font-size: .75rem; color: #475569; margin-top: 1rem; }
.wc-chat-locked-free b { color: #D4AF37; }
.wc-chat-locked-btn {
  display: inline-block; background: #0B1F3A; color: #D4AF37; border: none;
  padding: .55rem 1.25rem; border-radius: .5rem; font-size: .875rem;
  font-weight: 600; cursor: pointer; margin-top: 1rem;
}
.wc-chat-locked-btn:hover { background: #1e3a8a; }
.wc-chat-locked-btn-secondary { background: #f1f5f9; color: #0B1F3A; margin-left: .5rem; }
.wc-chat-locked-btn-secondary:hover { background: #e2e8f0; }
.wc-chat-low-credits {
  background: #fef9c3; border: 1px solid #fde68a; border-radius: .5rem;
  padding: .5rem .75rem; font-size: .8rem; margin: .5rem 1rem; color: #713f12;
}
@media (max-width: 480px) {
  .wc-chat-panel { right: .5rem; left: .5rem; width: auto; bottom: 5rem; height: calc(100vh - 6.5rem); }
  .wc-chat-fab { right: 1rem; bottom: 1rem; }
}
`.trim();

const SUGGESTIONS = [
  '明天有哪些世界杯比赛？赔率如何？',
  '德国队本届世界杯的晋级前景？',
  '解释一下让球胜平负怎么算',
];

const WELCOME_HTML = `
<div class="wc-chat-welcome">
  <div style="font-size:1.5rem;margin-bottom:.4rem;">⚽</div>
  <strong>WC2026 AI 预测助手</strong>
  <div>基于项目竞彩数据 + 建模推荐 + 实时联网</div>
  <ul>
    <li>📊 <b>赔率分析</b>：胜平负/让球/比分/总进球</li>
    <li>🤖 <b>建模推荐</b>：基于 R-013 / R-031 已验证策略</li>
    <li>🌍 <b>联网信息</b>：伤停、首发、突发新闻</li>
    <li>🚫 非世界杯相关问题会礼貌拒绝</li>
  </ul>
</div>
`.trim();

const LOCKED_HTML = `
<div class="wc-chat-locked">
  <div class="wc-chat-locked-icon">⚽</div>
  <strong>WC2026 世界杯 AI 助手</strong>
  <div class="wc-chat-locked-intro">问它任何世界杯问题，它结合本站赔率库 + 建模推荐 + 实时联网作答：</div>
  <ul class="wc-chat-locked-feats">
    <li>📊 <b>赔率分析</b>：胜平负 / 让球 / 比分 / 总进球</li>
    <li>🤖 <b>建模推荐</b>：基于 R-013 / R-031 已验证策略出推荐单</li>
    <li>🌍 <b>联网信息</b>：伤停、首发、突发新闻</li>
  </ul>
  <div class="wc-chat-locked-free">📧 邮箱收验证码即可登录 · 新用户自动送 <b>3 次</b>免费提问 · 无需密码</div>
  <div style="margin-top: 1rem">
    <button class="wc-chat-locked-btn" data-act="login">免费开始对话</button>
    <button class="wc-chat-locked-btn wc-chat-locked-btn-secondary" data-act="redeem">兑换 key</button>
  </div>
</div>
`.trim();

/* ----- markdown 轻量渲染 ----- */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderMarkdown(text) {
  const codeBlocks = [];
  let safe = text.replace(/```([\s\S]*?)```/g, (m, code) => {
    codeBlocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    return ` CODE${codeBlocks.length - 1} `;
  });
  safe = escapeHtml(safe);
  safe = safe.replace(/(^\|.+\|\n\|[-:|\s]+\|\n(\|.+\|\n?)+)/gm, (block) => {
    const lines = block.trim().split('\n');
    const head = lines[0].split('|').slice(1, -1).map((s) => s.trim());
    const rows = lines.slice(2).map((l) => l.split('|').slice(1, -1).map((s) => s.trim()));
    return `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${
      rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
    }</table>`;
  });
  safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\n/g, '<br>');
  safe = safe.replace(/ CODE(\d+) /g, (_, i) => codeBlocks[+i]);
  return safe;
}

/* ----- history persistence (localStorage) ----- */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveHistory(msgs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_HISTORY * 2))); } catch { /* ignore */ }
}
function clearHistory() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/* ----- SSE streaming ----- */
async function streamChat({ messages, mode = 'chat', onToken, onMeta, onError, onDone }) {
  let resp;
  try {
    resp = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, mode }),
    });
  } catch (e) {
    onError?.('网络连接失败，请检查网络后重试。');
    return;
  }
  if (resp.status === 401) { onError?.('请先登录后再发送消息'); return; }
  if (resp.status === 402) { onError?.('积分不足，请兑换 license key 或联系站长充值'); return; }
  if (resp.status === 404) {
    // 推荐单缺失的友好提示（API 端把多行 message 放在 error 字段）
    try { const j = await resp.json(); if (j.error) { onError?.(j.error); return; } } catch { /* ignore */ }
    onError?.('推荐单暂未生成');
    return;
  }
  if (resp.status === 429) { onError?.('操作太快，请稍候再试'); return; }
  if (!resp.ok || !resp.body) {
    let msg = `服务异常 (HTTP ${resp.status})`;
    try { const j = await resp.json(); if (j.error) msg = j.error; } catch { /* ignore */ }
    onError?.(msg);
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let currentEvent = '';
  let currentData = '';
  let doneCalled = false;
  const flush = () => {
    if (!currentEvent) return;
    try {
      const payload = JSON.parse(currentData);
      if (currentEvent === 'token') onToken?.(payload.content || '');
      else if (currentEvent === 'meta') onMeta?.(payload);
      else if (currentEvent === 'error') onError?.(payload.message || 'unknown error');
      else if (currentEvent === 'done') { doneCalled = true; onDone?.(payload); }
    } catch { /* ignore */ }
    currentEvent = ''; currentData = '';
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (!line) { flush(); continue; }
      if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
      else if (line.startsWith('data:')) currentData += line.slice(5).trim();
    }
  }
  flush();
  if (!doneCalled) onDone?.({ ok: true });
}

/* ----- mount ----- */
export function mountChatbot({ auth } = {}) {
  if (document.getElementById('wc-chatbot-root')) return;

  // inject style
  const style = document.createElement('style');
  style.id = 'wc-chatbot-style';
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'wc-chatbot-root';
  root.innerHTML = `
    <button class="wc-chat-fab" aria-label="打开 AI 助手" title="WC2026 AI 助手">
      ${ICON_CHAT}
    </button>
    <div class="wc-chat-panel" hidden>
      <div class="wc-chat-header">
        <div>
          <div class="wc-chat-header-title">⚽ WC2026 AI 助手</div>
          <div class="wc-chat-header-sub" data-sub>赔率 · 建模 · 联网</div>
        </div>
        <div style="display:flex;gap:.25rem;align-items:center;">
          <span class="wc-chat-header-credits" data-credits hidden></span>
          <button class="wc-chat-clear" data-action="account" title="账户" aria-label="账户">👤</button>
          <button class="wc-chat-clear" data-action="clear" title="清空对话" aria-label="清空对话">${ICON_CLEAR}</button>
          <button class="wc-chat-clear" data-action="close" title="关闭" aria-label="关闭">${ICON_CLOSE}</button>
        </div>
      </div>
      <div class="wc-chat-msgs" data-msgs></div>
      <div data-tools-row style="padding: 0 1rem .5rem; display: flex; flex-wrap: wrap; gap: .5rem;">
        <a class="wc-chat-suggestion wc-chat-suggestion-simulate" href="/simulate.html" target="_blank" rel="noopener">
          ⚽ 模拟记录<span class="soontag">v0.4</span>
        </a>
      </div>
      <div class="wc-chat-suggestions" data-suggestions>
        ${SUGGESTIONS.map((s) => `<button class="wc-chat-suggestion" data-suggestion>${s}</button>`).join('')}
      </div>
      <form class="wc-chat-input" data-form>
        <textarea data-input rows="1" placeholder="问点关于世界杯的……（Shift+Enter 换行）"></textarea>
        <button type="submit" class="wc-chat-send" data-send aria-label="发送">${ICON_SEND}</button>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const fab = root.querySelector('.wc-chat-fab');
  const panel = root.querySelector('.wc-chat-panel');
  const msgsEl = root.querySelector('[data-msgs]');
  const form = root.querySelector('[data-form]');
  const input = root.querySelector('[data-input]');
  const sendBtn = root.querySelector('[data-send]');
  const creditsEl = root.querySelector('[data-credits]');
  const subEl = root.querySelector('[data-sub]');
  const suggestionsEl = root.querySelector('[data-suggestions]');
  const suggestions = root.querySelectorAll('[data-suggestion]');
  const toolsRow = root.querySelector('[data-tools-row]');

  let isStreaming = false;
  let history = loadHistory();

  function renderHeader() {
    const u = auth?.getUser?.();
    if (u) {
      creditsEl.innerHTML = `⚡ <b>${u.credits}</b> 问`;
      creditsEl.hidden = false;
      subEl.textContent = u.email;
    } else {
      creditsEl.hidden = true;
      subEl.textContent = '点击右上角登录';
    }
  }

  // 仅刷新推荐/建议按钮的显隐，不重建消息列表（重建会清掉未入 history 的推荐对话）
  function refreshControls() {
    const u = auth?.getUser?.();
    if (!u) return;
    if (toolsRow) toolsRow.style.display = '';
    suggestionsEl.style.display = u.credits <= 0 ? 'none' : '';
  }

  function renderHistory() {
    msgsEl.innerHTML = '';
    const u = auth?.getUser?.();
    if (!u) {
      msgsEl.innerHTML = LOCKED_HTML;
      // wire locked buttons
      msgsEl.querySelectorAll('[data-act]').forEach((b) => {
        b.addEventListener('click', () => {
          if (b.dataset.act === 'login') auth?.show();
          else if (b.dataset.act === 'redeem') auth?.showRedeem();
        });
      });
      suggestionsEl.style.display = 'none';
      if (toolsRow) toolsRow.style.display = 'none';
      form.style.display = 'none';
      return;
    }
    form.style.display = '';
    refreshControls();
    if (history.length === 0) {
      msgsEl.innerHTML = WELCOME_HTML;
    } else {
      for (const m of history) appendMessage(m.role, m.content, false);
    }
  }

  function appendMessage(role, content, scroll = true) {
    if (msgsEl.firstElementChild?.classList?.contains('wc-chat-welcome') ||
        msgsEl.firstElementChild?.classList?.contains('wc-chat-locked')) {
      msgsEl.innerHTML = '';
    }
    const wrap = document.createElement('div');
    wrap.className = `wc-chat-msg wc-chat-msg-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'wc-chat-msg-bubble';
    if (role === 'bot') bubble.innerHTML = renderMarkdown(content);
    else bubble.textContent = content;
    const meta = document.createElement('div');
    meta.className = 'wc-chat-msg-meta';
    meta.textContent = role === 'user' ? '你' : 'AI 助手';
    wrap.append(bubble, meta);
    msgsEl.appendChild(wrap);
    if (scroll) msgsEl.scrollTop = msgsEl.scrollHeight;
    return bubble;
  }

  function showLowCredits() {
    if (msgsEl.querySelector('.wc-chat-low-credits')) return;
    const el = document.createElement('div');
    el.className = 'wc-chat-low-credits';
    el.innerHTML = `⚠️ <b>积分不足</b>，无法继续对话。<a href="#" data-redeem style="color:#1d4ed8">兑换 license key</a> 或联系站长充值。`;
    msgsEl.appendChild(el);
    el.querySelector('[data-redeem]').addEventListener('click', (e) => {
      e.preventDefault();
      auth?.showRedeem();
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function showError(text) {
    const el = document.createElement('div');
    el.className = 'wc-chat-error';
    el.textContent = text;
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    setTimeout(() => el.remove(), 6000);
  }

  function setStreaming(on) {
    isStreaming = on;
    sendBtn.disabled = on;
    input.disabled = on;
    input.placeholder = on ? 'AI 正在思考…' : '问点关于世界杯的……（Shift+Enter 换行）';
  }

  async function send(text) {
    const q = (text || '').trim();
    if (!q || isStreaming) return;

    const u = auth?.getUser?.();
    if (!u) { auth?.show(); return; }
    if (u.credits <= 0) { showLowCredits(); auth?.showRedeem(); return; }

    appendMessage('user', q);
    history.push({ role: 'user', content: q });
    saveHistory(history);

    const bubble = appendMessage('bot', '');
    bubble.classList.add('wc-chat-cursor');
    setStreaming(true);

    let acc = '';
    await streamChat({
      messages: history.slice(-MAX_HISTORY),
      onMeta: (m) => {
        const used = m.used_chunks?.length;
        const searched = m.web_search_used;
        if (used || searched) {
          const meta = document.createElement('div');
          meta.className = 'wc-chat-msg-meta';
          meta.textContent = `引用 ${used} 条数据${searched ? ' · 联网搜索' : ''}`;
          bubble.parentElement.appendChild(meta);
        }
        if (typeof m.credits_remaining === 'number') {
          // refresh user credits
          const cur = auth?.getUser?.();
          if (cur) {
            cur.credits = m.credits_remaining;
            renderHeader();
            if (m.credits_remaining <= 0) showLowCredits();
          }
        }
      },
      onToken: (t) => {
        acc += t;
        bubble.textContent = acc;
        msgsEl.scrollTop = msgsEl.scrollHeight;
      },
      onError: (msg) => {
        bubble.classList.remove('wc-chat-cursor');
        if (acc) {
          bubble.innerHTML = renderMarkdown(acc);
        } else {
          bubble.textContent = `⚠️ ${msg}`;
        }
        showError(msg);
        // refresh me in case the server side refunded
        auth?.checkSession?.();
      },
      onDone: () => {
        bubble.classList.remove('wc-chat-cursor');
        if (acc) {
          bubble.innerHTML = renderMarkdown(acc);
          history.push({ role: 'assistant', content: acc });
          saveHistory(history);
        }
        setStreaming(false);
        renderHeader();
        input.focus();
      },
    });
    setStreaming(false);
  }

  function openPanel({ focus = true } = {}) {
    if (!panel.hidden) return;
    panel.hidden = false;
    renderHeader();
    renderHistory();
    if (focus) setTimeout(() => input.focus(), 50);
  }

  // 首次访问：用户滚动页面后主动弹出一次（每个浏览器只弹一次）
  function setupAutoOpen() {
    try { if (localStorage.getItem(AUTO_OPEN_KEY)) return; } catch { return; }
    let triggered = false;
    const onScroll = () => {
      if (triggered) return;
      if (window.scrollY > 300) {
        triggered = true;
        try { localStorage.setItem(AUTO_OPEN_KEY, '1'); } catch { /* ignore */ }
        window.removeEventListener('scroll', onScroll);
        openPanel({ focus: false }); // 不抢焦点，避免移动端弹键盘 / 页面跳动
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // events
  fab.addEventListener('click', () => {
    if (panel.hidden) openPanel();
    else panel.hidden = true;
  });
  root.querySelector('[data-action="close"]').addEventListener('click', () => {
    panel.hidden = true;
  });
  root.querySelector('[data-action="account"]').addEventListener('click', () => {
    if (auth?.getUser?.()) auth.showAccount();
    else auth?.show();
  });
  root.querySelector('[data-action="clear"]').addEventListener('click', () => {
    if (!confirm('清空所有对话历史？')) return;
    clearHistory();
    history = [];
    renderHistory();
  });
  suggestions.forEach((btn) => {
    btn.addEventListener('click', () => send(btn.textContent));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 112) + 'px';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    input.style.height = 'auto';
    send(v);
  });

  // initial render
  renderHeader();
  renderHistory();
  setupAutoOpen();
}
