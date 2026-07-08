// js/components/auth.js
// ---------------------------------------------------------------
// 登录弹窗 + license key 兑换弹窗。挂在 body，chatbot 调用。
// ---------------------------------------------------------------

const STYLE = `
.wc-auth-backdrop {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(11,31,58,.55); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  animation: wcAuthFade .15s ease-out;
}
@keyframes wcAuthFade { from { opacity: 0 } to { opacity: 1 } }
.wc-auth-card {
  background: #fff; border-radius: 1rem; width: min(380px, 92vw);
  padding: 1.5rem; box-shadow: 0 20px 50px -10px rgba(0,0,0,.4);
  animation: wcAuthPop .2s ease-out;
}
@keyframes wcAuthPop {
  from { opacity: 0; transform: translateY(8px) scale(.97) }
  to   { opacity: 1; transform: translateY(0) scale(1) }
}
.wc-auth-title { font-size: 1.1rem; font-weight: 700; color: #0B1F3A; margin: 0 0 .25rem; }
.wc-auth-sub { color: #64748b; font-size: .8rem; margin: 0 0 1rem; }
.wc-auth-input {
  width: 100%; padding: .6rem .75rem; border: 1px solid #e2e8f0; border-radius: .5rem;
  font-size: .9rem; outline: none; box-sizing: border-box;
  font-family: inherit;
}
.wc-auth-input:focus { border-color: #D4AF37; box-shadow: 0 0 0 3px rgba(212,175,55,.15); }
.wc-auth-actions { display: flex; gap: .5rem; margin-top: 1rem; }
.wc-auth-btn {
  flex: 1; padding: .6rem; border-radius: .5rem; border: none; font-weight: 600;
  font-size: .875rem; cursor: pointer; transition: background .15s;
}
.wc-auth-btn-primary { background: #0B1F3A; color: #D4AF37; }
.wc-auth-btn-primary:hover:not(:disabled) { background: #1e3a8a; }
.wc-auth-btn-primary:disabled { opacity: .4; cursor: not-allowed; }
.wc-auth-btn-ghost { background: #f1f5f9; color: #0B1F3A; }
.wc-auth-btn-ghost:hover { background: #e2e8f0; }
.wc-auth-error { color: #b91c1c; font-size: .8rem; margin-top: .5rem; }
.wc-auth-tip { color: #64748b; font-size: .75rem; margin-top: .75rem; }
.wc-auth-tip code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; color: #0B1F3A; }
.wc-auth-devcode { background: #fef9c3; border: 1px dashed #facc15; border-radius: .5rem; padding: .5rem .75rem; font-size: .8rem; margin-top: .5rem; color: #713f12; }
.wc-auth-close {
  position: absolute; top: 1rem; right: 1rem; background: none; border: none;
  color: #94a3b8; cursor: pointer; padding: 4px; line-height: 0;
}
.wc-auth-close:hover { color: #0B1F3A; }
.wc-auth-user {
  display: flex; align-items: center; justify-content: space-between;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: .5rem;
  padding: .5rem .75rem; margin-top: 1rem; font-size: .8rem;
}
.wc-auth-user-email { color: #0B1F3A; font-weight: 600; }
.wc-auth-user-credits { color: #D4AF37; font-weight: 700; }
.wc-auth-tabs { display: flex; border-bottom: 1px solid #e2e8f0; margin: -1.5rem -1.5rem 1rem; }
.wc-auth-tab {
  flex: 1; padding: .85rem; background: none; border: none; font-size: .875rem;
  color: #64748b; cursor: pointer; font-weight: 500;
  border-bottom: 2px solid transparent; transition: all .15s;
}
.wc-auth-tab.active { color: #0B1F3A; border-bottom-color: #D4AF37; font-weight: 700; }
.wc-auth-link { color: #1d4ed8; text-decoration: none; font-size: .75rem; }
.wc-auth-link:hover { text-decoration: underline; }
.wc-auth-help {
  color: #64748b; font-size: .75rem; margin-top: 1rem; padding-top: .75rem;
  border-top: 1px dashed #e2e8f0; line-height: 1.6;
}
.wc-auth-help a { font-weight: 600; }
`.trim();

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function apiGet(path) {
  const r = await fetch(path, { credentials: 'include' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export function mountAuth({ onLogin, onLogout, onCreditsChange } = {}) {
  if (document.getElementById('wc-auth-style')) return { show: () => {}, hide: () => {}, checkSession: () => null };

  const style = document.createElement('style');
  style.id = 'wc-auth-style';
  style.textContent = STYLE;
  document.head.appendChild(style);

  let currentUser = null;
  let activeModal = null;

  async function checkSession() {
    try {
      const { user } = await apiGet('/api/auth/me');
      currentUser = user;
      onLogin?.(user);
      return user;
    } catch {
      currentUser = null;
      return null;
    }
  }

  async function logout() {
    try { await apiPost('/api/auth/logout'); } catch { /* ignore */ }
    currentUser = null;
    onLogout?.();
    onCreditsChange?.(null);
  }

  function openModal(build) {
    if (activeModal) activeModal.remove();
    const backdrop = el('div', { class: 'wc-auth-backdrop' });
    const card = el('div', { class: 'wc-auth-card', style: 'position:relative' });
    const closeBtn = el('button', { class: 'wc-auth-close', 'aria-label': '关闭' }, '✕');
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    card.appendChild(closeBtn);
    build(card);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    activeModal = backdrop;
  }

  function closeModal() {
    if (activeModal) { activeModal.remove(); activeModal = null; }
  }

  // ----- login flow -----
  function showLogin() {
    openModal((card) => {
      const titleEl = el('h3', { class: 'wc-auth-title' }, '登录 WC2026 AI');
      const subEl = el('p', { class: 'wc-auth-sub' }, '用邮箱收验证码，无密码、5 分钟有效');
      const input = el('input', {
        class: 'wc-auth-input', type: 'email', placeholder: 'your@email.com',
        autocomplete: 'email', required: true,
      });
      const errEl = el('div', { class: 'wc-auth-error', style: 'display:none' });
      const tipEl = el('div', { class: 'wc-auth-tip', style: 'display:none' });
      const submitBtn = el('button', { class: 'wc-auth-btn wc-auth-btn-primary' }, '发送验证码');
      const helpEl = el('div', { class: 'wc-auth-help' });
      helpEl.append(
        '新用户自动到账 3 问免费额度。',
        el('br'),
        '需要更多额度？',
        el('a', { href: '/contact.html', class: 'wc-auth-link' }, '联系站长获取 license key →'),
      );

      submitBtn.addEventListener('click', async () => {
        const email = input.value.trim();
        if (!email) { errEl.textContent = '请填写邮箱'; errEl.style.display = 'block'; return; }
        errEl.style.display = 'none';
        submitBtn.disabled = true; submitBtn.textContent = '发送中…';
        try {
          const r = await apiPost('/api/auth/send-otp', { email });
          tipEl.innerHTML = `验证码已发送至 <code>${email}</code>，5 分钟内有效。${r.devMode ? '<br><span style="color:#b45309">[开发模式] 控制台已打印验证码</span>' : ''}`;
          tipEl.style.display = 'block';
          showOtpStep(card, email, r.previewCode);
        } catch (e) {
          errEl.textContent = e.message; errEl.style.display = 'block';
          submitBtn.disabled = false; submitBtn.textContent = '发送验证码';
        }
      });

      const actions = el('div', { class: 'wc-auth-actions' }, [submitBtn]);
      card.append(titleEl, subEl, input, errEl, tipEl, actions, helpEl);
      setTimeout(() => input.focus(), 50);
    });
  }

  function showOtpStep(card, email, previewCode) {
    // Replace content of card with step 2
    card.innerHTML = '';
    const closeBtn = el('button', { class: 'wc-auth-close' }, '✕');
    closeBtn.addEventListener('click', closeModal);
    card.appendChild(closeBtn);

    const titleEl = el('h3', { class: 'wc-auth-title' }, '输入验证码');
    const subEl = el('p', { class: 'wc-auth-sub' }, `已发送至 ${email}`);
    const input = el('input', {
      class: 'wc-auth-input', type: 'text', inputmode: 'numeric', pattern: '\\d{6}',
      placeholder: '6 位数字', maxlength: 6, autocomplete: 'one-time-code',
      style: 'letter-spacing: 8px; text-align: center; font-size: 1.25rem; font-weight: 700;',
    });
    const errEl = el('div', { class: 'wc-auth-error', style: 'display:none' });
    const tipEl = el('div', { class: 'wc-auth-tip' });
    if (previewCode) {
      tipEl.innerHTML = `<div class="wc-auth-devcode">[开发模式] 验证码：<code>${previewCode}</code></div>`;
    }
    const submitBtn = el('button', { class: 'wc-auth-btn wc-auth-btn-primary' }, '登录');
    const backBtn = el('button', { class: 'wc-auth-btn wc-auth-btn-ghost' }, '返回');

    submitBtn.addEventListener('click', verify);
    backBtn.addEventListener('click', showLogin);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });

    async function verify() {
      const code = input.value.trim();
      if (code.length !== 6) { errEl.textContent = '请输入 6 位数字验证码'; errEl.style.display = 'block'; return; }
      errEl.style.display = 'none';
      submitBtn.disabled = true; submitBtn.textContent = '验证中…';
      try {
        const { user } = await apiPost('/api/auth/verify-otp', { email, code });
        currentUser = user;
        onLogin?.(user);
        onCreditsChange?.(user);
        closeModal();
      } catch (e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
        submitBtn.disabled = false; submitBtn.textContent = '登录';
      }
    }

    card.append(titleEl, subEl, input, errEl, tipEl);
    const actions = el('div', { class: 'wc-auth-actions' }, [backBtn, submitBtn]);
    card.appendChild(actions);
    setTimeout(() => input.focus(), 50);
  }

  // ----- redeem license key -----
  function showRedeem() {
    openModal((card) => {
      const tabs = el('div', { class: 'wc-auth-tabs' });
      const tabLogin = el('button', { class: 'wc-auth-tab' }, '登录');
      const tabRedeem = el('button', { class: 'wc-auth-tab active' }, '兑换 license key');
      tabs.append(tabLogin, tabRedeem);
      tabLogin.addEventListener('click', () => { closeModal(); showLogin(); });
      card.appendChild(tabs);

      card.appendChild(el('h3', { class: 'wc-auth-title' }, '兑换 license key'));
      card.appendChild(el('p', { class: 'wc-auth-sub' }, '联系站长获取 key（手动充值，零抽成）'));

      const input = el('input', {
        class: 'wc-auth-input', type: 'text', placeholder: 'WC26-XXXXXXXXXXXXXXXX',
        style: 'text-transform: uppercase;',
      });
      const errEl = el('div', { class: 'wc-auth-error', style: 'display:none' });
      const tipEl = el('div', { class: 'wc-auth-tip' });
      const submitBtn = el('button', { class: 'wc-auth-btn wc-auth-btn-primary' }, '兑换');

      submitBtn.addEventListener('click', async () => {
        const key = input.value.trim().toUpperCase();
        if (!key) { errEl.textContent = '请填写 license key'; errEl.style.display = 'block'; return; }
        errEl.style.display = 'none';
        submitBtn.disabled = true; submitBtn.textContent = '兑换中…';
        try {
          const r = await apiPost('/api/billing/redeem', { key });
          tipEl.innerHTML = `✅ 兑换成功，到账 <b>${r.credits}</b> 问，余额 <b>${r.balance}</b>`;
          // refresh me
          const me = await apiGet('/api/auth/me');
          currentUser = me.user;
          onLogin?.(me.user);
          onCreditsChange?.(me.user);
          setTimeout(closeModal, 1500);
        } catch (e) {
          errEl.textContent = e.message; errEl.style.display = 'block';
          submitBtn.disabled = false; submitBtn.textContent = '兑换';
        }
      });

      card.append(input, errEl, tipEl, submitBtn);
      setTimeout(() => input.focus(), 50);
    });
  }

  // ----- account panel (called by chatbot header) -----
  function showAccount() {
    if (!currentUser) return showLogin();
    openModal((card) => {
      const tabs = el('div', { class: 'wc-auth-tabs' });
      const tabInfo = el('button', { class: 'wc-auth-tab active' }, '账户');
      const tabRedeem = el('button', { class: 'wc-auth-tab' }, '兑换 key');
      tabs.append(tabInfo, tabRedeem);
      tabRedeem.addEventListener('click', () => { closeModal(); showRedeem(); });
      card.appendChild(tabs);

      card.appendChild(el('h3', { class: 'wc-auth-title' }, '账户信息'));
      card.appendChild(el('p', { class: 'wc-auth-sub' }, '登录后可继续对话；兑换 key 充值积分'));

      const userBox = el('div', { class: 'wc-auth-user' });
      userBox.innerHTML = `
        <span class="wc-auth-user-email">${currentUser.email}</span>
        <span class="wc-auth-user-credits">⚡ ${currentUser.credits} 问</span>
      `;
      card.appendChild(userBox);

      const statBox = el('div', { class: 'wc-auth-tip' });
      statBox.innerHTML = `累计已用：<b>${currentUser.used || 0}</b> 问<br>注册时间：${new Date(currentUser.createdAt).toLocaleString('zh-CN')}`;
      card.appendChild(statBox);

      const actions = el('div', { class: 'wc-auth-actions' });
      const redeemBtn = el('button', { class: 'wc-auth-btn wc-auth-btn-primary' }, '兑换 license key');
      redeemBtn.addEventListener('click', () => { closeModal(); showRedeem(); });
      const logoutBtn = el('button', { class: 'wc-auth-btn wc-auth-btn-ghost' }, '退出登录');
      logoutBtn.addEventListener('click', async () => { await logout(); closeModal(); });
      actions.append(redeemBtn, logoutBtn);
      card.appendChild(actions);
    });
  }

  return {
    show: showLogin,
    showLogin,
    showRedeem,
    showAccount,
    openAuth: showLogin,
    logout,
    checkSession,
    getUser: () => currentUser,
    isAuthed: () => Boolean(currentUser),
    /** 扣 credits 统一入口（与 api/router.js COSTS 同步）
     *  kind: 'backtest' | 'export' | 'message'
     *  { silent: true } = 失败不弹窗（用于内部自动扣费）
     *  返回 { ok, balance, mode } 或 throw
     */
    async withCredits(kind = 'message', { silent = false } = {}) {
      if (!currentUser) {
        if (!silent) showLogin();
        throw new Error('not signed in');
      }
      // 后端用 /api/chat?mode=backtest 扣 5 / /api/lab/export 扣 1
      // 简化：所有扣费都走 /api/chat (kind→mode 映射)
      const mode = kind === 'backtest' ? 'backtest' : (kind === 'export' ? 'export' : 'chat');
      try {
        if (mode === 'export') {
          // 纯扣费端点；CSV 由前端本地生成，不经网络
          const r = await fetch('/api/lab/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            if (r.status === 402) {
              if (!silent) alert('积分不足，请先兑换 license key。');
              throw new Error('insufficient credits');
            }
            throw new Error(err?.error || 'http ' + r.status);
          }
          const j = await r.json();
          if (typeof j.credits_remaining === 'number') {
            currentUser = { ...currentUser, credits: j.credits_remaining, used: (currentUser.used || 0) + (j.cost || 0) };
            onCreditsChange?.(currentUser);
          }
          return { ok: true, balance: j.credits_remaining, mode };
        }
        // backtest / message 都走 /api/chat
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: '__' + mode }], mode }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          if (r.status === 402) {
            if (!silent) alert('积分不足，请先兑换 license key。');
            throw new Error('insufficient credits');
          }
          throw new Error(err?.error || 'http ' + r.status);
        }
        const j = await r.json();
        if (typeof j.credits_remaining === 'number') {
          currentUser = { ...currentUser, credits: j.credits_remaining, used: (currentUser.used || 0) + (j.cost || 0) };
          onCreditsChange?.(currentUser);
        }
        return { ok: true, balance: j.credits_remaining, mode };
      } catch (e) {
        console.warn('[auth.withCredits]', kind, e.message);
        throw e;
      }
    },
  };
}
