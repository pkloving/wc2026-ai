// js/pages/contact.js
// ---------------------------------------------------------------
// 联系页：表单校验 + 提交到 Formspree (https://formspree.io/f/xrevqpyv)
//   - 客户端校验：必填 / 邮箱格式 / 留言 ≥ 10 字
//   - 提交中禁用按钮
//   - 200 → 成功提示 + reset；非 2xx → 错误提示，可重试
//   - 内置 _gotcha 蜜罐字段（机器人过滤）
//   - 全部文案走 t()，跟着 i18n 切换
// ---------------------------------------------------------------
import { t, getLocale } from '../i18n.js';
import { boot } from '../page-boot.js';

const FORMSPREE_URL = 'https://formspree.io/f/xrevqpyv';
const MIN_MESSAGE_LEN = 10;
const MAX_MESSAGE_LEN = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = ['name', 'email', 'message'];

function $(sel) { return document.querySelector(sel); }

function showFieldError(field, msg) {
  const input = $(`#contact-${field}`);
  const err = $(`#contact-${field}-error`);
  if (input) input.classList.toggle('border-flame', Boolean(msg));
  if (input) input.classList.toggle('border-slate-300', !msg);
  if (err) {
    err.textContent = msg || '';
    err.classList.toggle('hidden', !msg);
  }
}

function clearAllErrors() {
  FIELDS.forEach((f) => showFieldError(f, ''));
}

function validate(values) {
  const errors = {};
  if (!values.name) errors.name = t('contact.form.errorRequired');
  if (!values.email) {
    errors.email = t('contact.form.errorRequired');
  } else if (!EMAIL_RE.test(values.email)) {
    errors.email = t('contact.form.errorEmail');
  }
  if (!values.message) {
    errors.message = t('contact.form.errorRequired');
  } else if (values.message.length < MIN_MESSAGE_LEN) {
    errors.message = t('contact.form.errorMessage');
  } else if (values.message.length > MAX_MESSAGE_LEN) {
    errors.message = t('contact.form.errorMessage');
  }
  return errors;
}

function setStatus(kind, msg) {
  const el = $('#contact-status');
  if (!el) return;
  const tone = {
    success: 'bg-pitch/10 text-pitch border border-pitch/30',
    error: 'bg-flame/10 text-flame border border-flame/30',
  }[kind] || '';
  el.className = `mt-4 p-4 rounded-lg text-sm ${tone}`;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

boot(async () => {
  const form = $('#contact-form');
  const submitBtn = $('#contact-submit');
  const nameInput = $('#contact-name');
  const emailInput = $('#contact-email');
  const messageInput = $('#contact-message');
  if (!form || !submitBtn) return;

  // 用户开始输入 → 实时清掉该字段错误
  FIELDS.forEach((f) => {
    const el = $(`#contact-${f}`);
    el?.addEventListener('input', () => showFieldError(f, ''));
  });

  // 把当前 locale 加到提交里，方便回信时知道对方用的语言
  const subject = (getLocale() === 'zh-CN' ? 'WC 2026 站点留言' : 'WC 2026 site message');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();
    setStatus(null);

    const values = {
      name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      message: messageInput.value.trim(),
    };
    const errors = validate(values);
    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([f, m]) => showFieldError(f, m));
      // 滚到第一个出错的地方
      const first = Object.keys(errors)[0];
      $(`#contact-${first}`)?.focus();
      return;
    }

    submitBtn.disabled = true;
    const submitLabel = submitBtn.querySelector('[data-i18n]');
    const originalText = submitLabel?.textContent;
    if (submitLabel) submitLabel.textContent = t('contact.form.sending');

    try {
      const res = await fetch(FORMSPREE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          message: values.message,
          subject,
          locale: getLocale(),
          _gotcha: form.elements.namedItem('_gotcha')?.value || '',
        }),
      });

      if (res.ok) {
        setStatus('success', t('contact.form.success'));
        form.reset();
      } else {
        // Formspree 在 4xx 时也会返回 JSON { errors: [...] }
        let detail = '';
        try {
          const data = await res.json();
          if (data && Array.isArray(data.errors) && data.errors[0]?.message) {
            detail = ` (${data.errors[0].message})`;
          }
        } catch (_) { /* ignore */ }
        setStatus('error', t('contact.form.error') + detail);
      }
    } catch (err) {
      setStatus('error', t('contact.form.error'));
    } finally {
      submitBtn.disabled = false;
      if (submitLabel && originalText != null) submitLabel.textContent = originalText;
    }
  });
}, { errorTarget: 'contact-form' });
