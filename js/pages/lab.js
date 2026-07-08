// js/pages/lab.js — 回测实验室页面逻辑
// 流程:
//   1. 读 data/lab_dataset.json
//   2. 渲染 6 预设卡（含实时双届 ROI chip + n 徽章）
//   3. 监听 play/scenario 切换 → 渲染 pick 选项
//   4. 监听 rounds chip 切换
//   5. 监听「跑回测」 → 本地引擎计算（免费、免登录）
//   6. 渲染结果表 + 双届 equity 折线 + 0 场空态
//   7. 「AI 解读」→ 调 chat 面板（扣 5 credits, 未登录弹登录）
//   8. 「导出 CSV」→ 调 /api/router?action=lab/export（扣 1 credit, 失败不扣）

import labDataset from '../../data/lab_dataset.json';
import { runBacktest, PRESETS, encodeCfg, decodeCfg, filterMatches, makeLegs, buildTickets, simulate, breakdown, detectBadges, legsToCsvRows } from '../lab/engine.js';
import { drawEquity, drawROI } from '../lab/chart.js';
import { boot } from '../page-boot.js';
import { applyI18n, t } from '../i18n.js';

const I18N_LAB_KEYS = ['masthead', 'ctrl', 'opt', 'result', 'ai', 'export', 'honest', 'footer'];

const PLAY_PICKS = {
  spf: [
    { value: 'fav', label: { zh: '热门 (最低赔率)', en: 'Favorite (lowest odds)' } },
    { value: 'dog', label: { zh: '冷门 (最高赔率)', en: 'Underdog (highest odds)' } },
    { value: 'draw', label: { zh: '平局', en: 'Draw' } },
    { value: 'home', label: { zh: '主胜', en: 'Home win' } },
    { value: 'away', label: { zh: '客胜', en: 'Away win' } },
    { value: 'all-outcomes', label: { zh: '三门 (退水基线)', en: 'All three (vig baseline)' } },
  ],
  rqspf: [
    { value: 'fav', label: { zh: '让球热门', en: 'Handicap favorite' } },
    { value: 'dog', label: { zh: '让球冷门', en: 'Handicap underdog' } },
    { value: 'draw', label: { zh: '让平', en: 'Handicap draw' } },
    { value: 'cover-low', label: { zh: '覆盖·去顶 (低 2 门)', en: 'Cover (low 2)' } },
    { value: 'cover-high', label: { zh: '覆盖·对冲 (低+高)', en: 'Cover (low+high)' } },
    { value: 'all-outcomes', label: { zh: '三门', en: 'All three' } },
  ],
  zjq: [
    { value: 'ev-mid', label: { zh: '2 球 (本届指纹)', en: '2 goals (fingerprint)' } },
    { value: 'fav', label: { zh: '热门 (隐含最高概率)', en: 'Favorite (highest implied)' } },
    { value: '0', label: { zh: '0 球', en: '0 goals' } },
    { value: '1', label: { zh: '1 球', en: '1 goal' } },
    { value: '3', label: { zh: '3 球', en: '3 goals' } },
    { value: '4', label: { zh: '4 球', en: '4 goals' } },
    { value: '5', label: { zh: '5 球', en: '5 goals' } },
    { value: '6', label: { zh: '6 球', en: '6 goals' } },
    { value: '7+', label: { zh: '7+ 球', en: '7+ goals' } },
  ],
  bqc: [
    { value: 'cover', label: { zh: '胜胜 + 平平 (覆盖胆)', en: 'Win/Win + Draw/Draw' } },
    { value: 'fav', label: { zh: '热门 (隐含最高概率)', en: 'Favorite (highest implied)' } },
    { value: '胜胜', label: { zh: '胜胜', en: 'Win/Win' } },
    { value: '胜平', label: { zh: '胜平', en: 'Win/Draw' } },
    { value: '平胜', label: { zh: '平胜', en: 'Draw/Win' } },
    { value: '平平', label: { zh: '平平', en: 'Draw/Draw' } },
    { value: '负平', label: { zh: '负平', en: 'Loss/Draw' } },
  ],
};

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return [...document.querySelectorAll(sel)]; }

// 2026-07-08 bugfix: <select id="cfg-spread"> 的 option value 集合是
//   ["0", "1.0", "1.5", "2.0", "3.0"] (字符串), 预设 cfg 里 rqspfSpreadMin 可能是
//   3 / 3.0 / 2.5。直接 String(n) 写回 select, 3 找不到 "3" 会浏览器静默回退到 "0",
//   导致 spread 过滤失效, 全部场都过。
// 这里把任意数字规范成 select 接受的字符串 (匹配 .0 优先, 找最近 option, 找不到回退 "0")。
const SPREAD_OPT_VALUES = ['0', '1.0', '1.5', '2.0', '3.0'];
function spreadToSelectValue(n) {
  if (n == null) return '0';
  const num = +n;
  if (!Number.isFinite(num) || num <= 0) return '0';
  // 优先精确匹配 ("3" → "3.0", "1.5" → "1.5")
  const exact = SPREAD_OPT_VALUES.find((v) => Math.abs(+v - num) < 1e-9);
  if (exact) return exact;
  // 否则找最近的 option (向下圆整到 .0 / .5), 仍找不到回退 "0"
  const rounded = (Math.round(num * 2) / 2).toFixed(1);  // 2.3 → "2.5", 1.4 → "1.5"
  return SPREAD_OPT_VALUES.includes(rounded) ? rounded : '0';
}

function lang() { return document.documentElement.lang || 'zh-CN'; }
function isEn() { return lang().startsWith('en'); }

let lastResult = null;   // 缓存最近一次回测（导出用）

// ---------- 预设卡渲染（实时双届 ROI chip + n 徽章） ----------
function renderPresets() {
  const root = $('#lab-presets');
  root.replaceChildren();
  for (const p of PRESETS) {
    const card = document.createElement('div');
    card.className = 'lab-preset';
    card.dataset.id = p.id;
    const title = isEn() ? p.title.en : p.title.zh;
    const sub = isEn() ? p.sub.en : p.sub.zh;

    // 实时算两届 ROI（用于 chip 显示）
    const r2022 = runBacktest(labDataset, 2022, p.cfg);
    const r2026 = runBacktest(labDataset, 2026, p.cfg);
    const chip = (r) => r && r.n > 0
      ? `<span class="lab-chip-roi ${r.roi >= 0 ? 'pos' : 'neg'}">${(r.roi > 0 ? '+' : '') + r.roi.toFixed(1)}% <em>n=${r.n}</em></span>`
      : `<span class="lab-chip-roi empty" title="${isEn() ? 'no data' : '无数据'}">—</span>`;

    card.innerHTML = `
      <div class="lab-preset-id">${p.id}</div>
      <div class="lab-preset-title">${title}</div>
      <div class="lab-preset-sub">${sub}</div>
      <div class="lab-preset-chips">
        <span class="lab-preset-yr">2022</span>${chip(r2022)}
        <span class="lab-preset-yr">2026</span>${chip(r2026)}
      </div>
    `;
    card.addEventListener('click', () => loadPreset(p));
    root.appendChild(card);
  }
}

function loadPreset(p) {
  $$('.lab-preset').forEach((c) => c.classList.toggle('active', c.dataset.id === p.id));
  $('#cfg-play').value = p.cfg.play;
  refreshPickOptions();
  $('#cfg-pick').value = p.cfg.pick;
  $('#cfg-stage').value = p.cfg.filters?.stage || 'all';
  $$('#cfg-rounds .lab-chip').forEach((c) => c.classList.remove('active'));
  for (const r of (p.cfg.filters?.rounds || [])) {
    $(`#cfg-rounds .lab-chip[data-val="${r}"]`)?.classList.add('active');
  }
  $('#cfg-spread').value = spreadToSelectValue(p.cfg.filters?.rqspfSpreadMin);
  $('#cfg-scenario').value = p.cfg.filters?.scenario || '';
  const s = p.cfg.structure?.kind || 'single';
  const legs = p.cfg.structure?.legs || 0;
  if (s === 'parlay') $('#cfg-struct').value = legs >= 3 ? 'parlay3' : 'parlay2';
  else $('#cfg-struct').value = s;
  run();
}

// ---------- 配置 / pick 选项 ----------
function refreshPickOptions() {
  const play = $('#cfg-play').value;
  const picks = PLAY_PICKS[play] || [];
  const sel = $('#cfg-pick');
  sel.replaceChildren();
  for (const p of picks) {
    const opt = document.createElement('option');
    opt.value = p.value;
    opt.textContent = isEn() ? p.label.en : p.label.zh;
    sel.appendChild(opt);
  }
}

function readCfg() {
  const play = $('#cfg-play').value;
  const pick = $('#cfg-pick').value;
  const stage = $('#cfg-stage').value;
  const rounds = $$('#cfg-rounds .lab-chip.active').map((c) => +c.dataset.val);
  const spread = +$('#cfg-spread').value || 0;
  const scenario = $('#cfg-scenario').value || null;
  const struct = $('#cfg-struct').value;
  let structure = { kind: 'single' };
  if (struct === 'parlay2') structure = { kind: 'parlay', legs: 2 };
  else if (struct === 'parlay3') structure = { kind: 'parlay', legs: 3 };
  else if (struct === 'cover') structure = { kind: 'cover' };
  const filters = { stage };
  if (rounds.length) filters.rounds = rounds;
  if (spread > 0) filters.rqspfSpreadMin = spread;
  if (scenario) filters.scenario = scenario;
  return { play, pick, filters, structure };
}

function applyCfg(cfg) {
  $('#cfg-play').value = cfg.play;
  refreshPickOptions();
  $('#cfg-pick').value = cfg.pick;
  $('#cfg-stage').value = cfg.filters?.stage || 'all';
  $$('#cfg-rounds .lab-chip').forEach((c) => c.classList.remove('active'));
  for (const r of (cfg.filters?.rounds || [])) {
    $(`#cfg-rounds .lab-chip[data-val="${r}"]`)?.classList.add('active');
  }
  $('#cfg-spread').value = spreadToSelectValue(cfg.filters?.rqspfSpreadMin);
  $('#cfg-scenario').value = cfg.filters?.scenario || '';
  const s = cfg.structure?.kind || 'single';
  const legs = cfg.structure?.legs || 0;
  if (s === 'parlay') $('#cfg-struct').value = legs >= 3 ? 'parlay3' : 'parlay2';
  else $('#cfg-struct').value = s;
}

// ---------- 跑回测（本地纯前端，免费免登录） ----------
async function run() {
  const cfg = readCfg();
  const btn = $('#cfg-run');
  btn.disabled = true;
  btn.textContent = isEn() ? '⏳ Running…' : '⏳ 计算中…';

  // URL 同步（便于分享/收藏）
  const qs = encodeCfg(cfg);
  const newUrl = `${location.pathname}?${qs}`;
  history.replaceState(null, '', newUrl);

  // 本地算
  const r2022 = runBacktest(labDataset, 2022, cfg);
  const r2026 = runBacktest(labDataset, 2026, cfg);
  // detectBadges 会在 r.badges 写入 smallSample / inSample2026；regimeFlip 全局返回
  const globalBadges = detectBadges([r2022, r2026]) || [];

  lastResult = { cfg, r2022, r2026, globalBadges };
  renderResult({ cfg, r2022, r2026, globalBadges });

  btn.disabled = false;
  btn.textContent = isEn() ? '▶ Run backtest (free)' : '▶ 跑回测（免费）';
}

// ---------- 结果渲染 ----------
function fmtRoi(roi) {
  const cls = roi >= 0 ? 'lab-roi-pos' : 'lab-roi-neg';
  return `<span class="${cls}">${(roi > 0 ? '+' : '') + roi.toFixed(1)}%</span>`;
}
function fmtPct(p) { return p.toFixed(1) + '%'; }
function fmtN(n) { return n.toLocaleString(); }

function renderResult({ cfg, r2022, r2026, globalBadges = [] }) {
  const root = $('#lab-result');
  const errs = [r2022, r2026].filter((r) => !r);
  if (errs.length) {
    root.innerHTML = `<div class="lab-result-empty" data-i18n="lab.result.err">计算失败</div>`;
    return;
  }

  // 0 场命中诚实空态
  if (r2022.n === 0 && r2026.n === 0) {
    root.innerHTML = `<div class="lab-result-empty">
      <div style="font-size:14px;color:#D4AF37;margin-bottom:8px">⚠ ${isEn() ? 'No matching matches' : '无匹配比赛'}</div>
      <div>${isEn()
        ? 'Your filter (stage / rounds / scenario / spread) did not match any of the 155 settled matches. Try widening filters.'
        : '当前筛选（阶段 / 轮次 / 情景 / 让差）在 155 场已完赛中无匹配。试着放宽筛选项。'}</div>
    </div>`;
    return;
  }

  const badgeHtml = (r) => (r.badges || []).map((b) => `<span class="lab-badge ${b.severity}">${b.label}</span>`).join('');
  const globalBadgeHtml = (globalBadges || []).map((b) => `<span class="lab-badge ${b.severity}" style="margin-left:6px">${b.label}</span>`).join('');

  // 串关尾腿丢弃提示
  const droppedMsg = (r2022.dropped || r2026.dropped)
    ? `<div class="lab-dropped-warn">⚠ ${isEn() ? 'Tail legs dropped' : '尾腿已弃用'}：2022 弃 ${r2022.dropped} 腿 / 2026 弃 ${r2026.dropped} 腿（凑不满 ${cfg.structure.legs || 2} 串一注）</div>`
    : '';

  // 单年缺失（一边 n=0）单独显示
  const emptyCol = (r, yr) => r.n === 0
    ? `<span class="lab-sample-warn">${isEn() ? 'no match' : '无匹配'}</span>`
    : `${fmtN(r.n)}`;

  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px">
      <div>
        <strong style="color:#D4AF37">${cfgLabel(cfg)}</strong>
        <span style="font-size:11px; color:#A0A8B8; margin-left:8px">${cfgDesc(cfg)}</span>
      </div>
      <div>${badgeHtml(r2022)} ${badgeHtml(r2026)} ${globalBadgeHtml}</div>
    </div>
    ${droppedMsg}
    <table class="lab-roi-table">
      <thead>
        <tr>
          <th>${isEn() ? 'Edition' : '届'}</th>
          <th>n</th>
          <th>cost</th>
          <th>ret</th>
          <th>net</th>
          <th>ROI</th>
          <th>${isEn() ? 'Hit' : '命中'}</th>
          <th>${isEn() ? 'Max DD' : '最大回撤'}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>2022</td>
          <td>${emptyCol(r2022, 2022)}</td>
          <td>${r2022.n === 0 ? '—' : r2022.cost.toFixed(0)}</td>
          <td>${r2022.n === 0 ? '—' : r2022.ret.toFixed(2)}</td>
          <td>${r2022.n === 0 ? '—' : r2022.net.toFixed(2)}</td>
          <td>${r2022.n === 0 ? '—' : fmtRoi(r2022.roi)}</td>
          <td>${r2022.n === 0 ? '—' : fmtPct(r2022.hitRate)}</td>
          <td>${r2022.n === 0 ? '—' : r2022.maxDrawdown.toFixed(2)}</td>
        </tr>
        <tr>
          <td>2026</td>
          <td>${emptyCol(r2026, 2026)}</td>
          <td>${r2026.n === 0 ? '—' : r2026.cost.toFixed(0)}</td>
          <td>${r2026.n === 0 ? '—' : r2026.ret.toFixed(2)}</td>
          <td>${r2026.n === 0 ? '—' : r2026.net.toFixed(2)}</td>
          <td>${r2026.n === 0 ? '—' : fmtRoi(r2026.roi)}</td>
          <td>${r2026.n === 0 ? '—' : fmtPct(r2026.hitRate)}</td>
          <td>${r2026.n === 0 ? '—' : r2026.maxDrawdown.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
    <div class="lab-charts">
      <div>
        <div style="font-size:10px; color:#A0A8B8; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px">2022 累计净值曲线</div>
        <div id="chart-2022"></div>
      </div>
      <div>
        <div style="font-size:10px; color:#A0A8B8; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px">2026 累计净值曲线</div>
        <div id="chart-2026"></div>
      </div>
    </div>
    <div class="lab-action-bar">
      <a id="btn-ai" class="lab-action primary" data-i18n="lab.ai.cta">🧠 AI 解读（5 credits）</a>
      <a id="btn-export" class="lab-action" data-i18n="lab.export.cta">⬇ CSV 明细（1 credit）</a>
      <span class="lab-action-hint" data-i18n="lab.export.hint">导出 {n} 票明细</span>
    </div>
    <div class="lab-ai-result" id="lab-ai-result"></div>
  `;
  if (r2022.n > 0) drawEquity($('#chart-2022'), r2022.equity, { width: 600, height: 160 });
  else $('#chart-2022').innerHTML = `<div class="lab-result-empty" style="padding:60px 8px">${isEn() ? 'No data' : '无数据'}</div>`;
  if (r2026.n > 0) drawEquity($('#chart-2026'), r2026.equity, { width: 600, height: 160 });
  else $('#chart-2026').innerHTML = `<div class="lab-result-empty" style="padding:60px 8px">${isEn() ? 'No data' : '无数据'}</div>`;
  $('#btn-ai')?.addEventListener('click', askAI);
  $('#btn-export')?.addEventListener('click', exportCsv);
  applyI18n();
  // 替换 {n}
  const hint = root.querySelector('.lab-action-hint');
  if (hint) hint.textContent = (isEn() ? `Export ${(r2022.n + r2026.n)} ticket details` : `导出 ${r2022.n + r2026.n} 票明细`);
}

function cfgLabel(cfg) {
  const p = cfg.play.toUpperCase();
  const pick = cfg.pick === 'all-outcomes' ? '三门' : cfg.pick;
  return `${p} · ${pick}`;
}
function cfgDesc(cfg) {
  const parts = [];
  if (cfg.filters.stage && cfg.filters.stage !== 'all') parts.push(cfg.filters.stage);
  if (cfg.filters.rounds?.length) parts.push('R' + cfg.filters.rounds.join('/'));
  if (cfg.filters.rqspfSpreadMin) parts.push('让差≥' + cfg.filters.rqspfSpreadMin);
  if (cfg.structure.kind === 'parlay') parts.push(cfg.structure.legs + '串1');
  else if (cfg.structure.kind === 'cover') parts.push('覆盖');
  return parts.join(' · ');
}

// ---------- 导出 CSV（前端本地生成 + 扣 1 credit 便利费，失败不扣） ----------
async function exportCsv() {
  if (!lastResult) return;
  // 1. 扣费先（便利费口径，明细本就在客户端；失败/取消不下载）
  try {
    if (window.WC?.auth) {
      await window.WC.auth.withCredits('export', { silent: false });
    } else {
      alert(isEn() ? 'Sign in to export CSV.' : '请先登录再导出 CSV。');
      return;
    }
  } catch (e) {
    // withCredits 已自己弹「积分不足」或「登录」，这里只兜底
    console.warn('[lab.exportCsv] withCredits failed', e?.message);
    return;
  }
  // 2. 本地生成 CSV
  const cfg = lastResult.cfg;
  const rows = [['year', 'mid', 'id', 'home', 'away', 'play', 'side', 'odds', 'hit']];
  for (const yr of [2022, 2026]) {
    const ms = (yr === 2022 ? labDataset.y2022 : labDataset.y2026).matches;
    const filt = filterMatches(ms, cfg.filters);
    const legs = makeLegs(filt, cfg);
    for (const l of legs) rows.push([yr, l.mid, l.id, l.home, l.away, l.play, l.side, l.odds.toFixed(2), l.hit ? '1' : '0']);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lab_${cfg.play}_${cfg.pick}_${cfg.structure.kind}${cfg.structure.legs || ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- AI 解读（5 credits 走真实 LLM 流式） ----------
async function askAI() {
  if (!lastResult) {
    alert(isEn() ? 'Run a backtest first.' : '请先跑一次回测。');
    return;
  }
  // 未登录 → 弹登录
  if (!window.WC?.auth?.isAuthed || !window.WC.auth.isAuthed()) {
    window.WC.auth?.openAuth?.();
    return;
  }
  const box = $('#lab-ai-result');
  if (!box) return;
  box.classList.add('active');
  box.innerHTML = `<div class="lab-ai-loading">⏳ ${isEn() ? 'AI interpreting (5 credits)…' : 'AI 解读中（5 credits）…'}</div>`;
  // 滚动到 AI 框
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const { cfg, r2022, r2026, globalBadges } = lastResult;
  const summary = buildAiSummary(cfg, r2022, r2026, globalBadges);
  const prompt = isEn()
    ? `Please interpret the following backtest result on real sporttery odds:\n\n${summary}\n\nFocus: (1) sample size / small-sample warnings, (2) overfit signs (2026 in-sample vs 2022 out-of-sample), (3) vigorish and structural caveats. Do not give betting advice.`
    : `请基于以下用竞彩网真实赔率跑的回测结果给出诚实解读：\n\n${summary}\n\n重点：(1) 样本量与「样本过小」警示，(2) 过拟合迹象（2026 样本内 vs 2022 样本外），(3) 退水与结构注意事项。不给投注建议。`;

  let resp;
  try {
    resp = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], mode: 'backtest' }),
    });
  } catch (e) {
    box.innerHTML = `<div class="lab-ai-error">⚠ ${isEn() ? 'Network error' : '网络错误'}：${e.message}</div>`;
    return;
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 401 || resp.status === 403) {
      window.WC.auth?.openAuth?.();
      box.innerHTML = `<div class="lab-ai-error">⚠ ${isEn() ? 'Please sign in first' : '请先登录'}</div>`;
      return;
    }
    if (resp.status === 402) {
      box.innerHTML = `<div class="lab-ai-error">⚠ ${isEn() ? 'Insufficient credits. Please top up.' : '积分不足，请先兑换 license key。'}</div>`;
      window.WC.auth?.showRedeem?.();
      return;
    }
    box.innerHTML = `<div class="lab-ai-error">⚠ ${isEn() ? 'AI failed' : 'AI 解读失败'}：${err.error || resp.status}</div>`;
    return;
  }

  // SSE 流式读
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let acc = '';
  let buf = '';
  box.innerHTML = `<div class="lab-ai-content"></div><span class="lab-ai-cursor"></span>`;
  const contentEl = box.querySelector('.lab-ai-content');
  const cursorEl = box.querySelector('.lab-ai-cursor');

  function appendAcc(text) {
    acc += text;
    if (contentEl) contentEl.textContent = acc;
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE 事件以 \n\n 分隔
      const events = buf.split('\n\n');
      buf = events.pop() || '';
      for (const evt of events) {
        const lines = evt.split('\n');
        let eventName = '';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        let j;
        try { j = JSON.parse(dataStr); } catch { continue; }
        if (eventName === 'token' && j.content) appendAcc(j.content);
        else if (eventName === 'error') {
          box.innerHTML = `<div class="lab-ai-error">⚠ ${j.message || (isEn() ? 'AI error' : 'AI 出错')}</div>`;
          // 退款回滚
          window.WC.auth?.checkSession?.();
          return;
        }
        else if (eventName === 'meta' && typeof j.credits_remaining === 'number') {
          const u = window.WC.auth?.getUser?.();
          if (u) { u.credits = j.credits_remaining; }
        }
      }
    }
  } catch (e) {
    box.innerHTML = `<div class="lab-ai-error">⚠ ${isEn() ? 'Stream error' : '流读取错误'}：${e.message}</div>`;
    return;
  }
  if (cursorEl) cursorEl.remove();
  if (cursorEl) {} // noop
  // 刷新余额
  window.WC.auth?.checkSession?.();
}

function buildAiSummary(cfg, r2022, r2026, globalBadges) {
  const safe = (r) => r ? `n=${r.n}, ROI=${r.roi.toFixed(2)}%, 命中=${r.hitRate.toFixed(1)}%, 最大回撤=${r.maxDrawdown.toFixed(2)}` : 'n/a';
  return [
    `策略: ${cfgLabel(cfg)} — ${cfgDesc(cfg)}`,
    `2022: ${safe(r2022)}`,
    `2026: ${safe(r2026)}${r2026?.year === 2026 ? ' [样本内]' : ''}`,
    `全局徽章: ${(globalBadges || []).map((b) => b.label).join(', ') || '无'}`,
    `单届徽章: 2022[${(r2022?.badges || []).map((b) => b.label).join(', ') || '无'}] / 2026[${(r2026?.badges || []).map((b) => b.label).join(', ') || '无'}]`,
    `串关尾腿丢弃: 2022=${r2022?.dropped || 0}, 2026=${r2026?.dropped || 0}`,
  ].join('\n');
}

// ---------- boot ----------
async function main() {
  $('#upd-at').textContent = new Date(labDataset.generated_at).toLocaleString();

  // 尝试读 URL cfg
  const qs = location.search.slice(1);
  if (qs) {
    const cfg = decodeCfg(qs);
    if (cfg.play && cfg.pick) {
      applyCfg(cfg);
    }
  }

  refreshPickOptions();
  renderPresets();
  applyI18n();

  // 绑定事件
  $('#cfg-play').addEventListener('change', refreshPickOptions);
  $$('#cfg-rounds .lab-chip').forEach((c) => c.addEventListener('click', () => c.classList.toggle('active')));
  $('#cfg-run').addEventListener('click', run);

  // 第一次自动跑（如果有 cfg）
  if (qs && decodeCfg(qs).play) {
    run();
  }
  // 核心回测免费、免登录；lab-body 永远显示
  // 仅在调 AI 解读 / 导出 CSV 时弹登录（按钮内 askAI / exportCsv 自处理）
}

boot(main);
