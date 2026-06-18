// js/pages/bets.js — 足彩模拟页入口
// ---------------------------------------------------------------
// 身份分流：
//   - admin（sessionStorage 'wc_admin_key' 有效） → 调 renderBetsPage()
//     展示 data/bets.json 的 1000 元预算 / 各笔 bet / 命中率 / ROI
//   - 其他（普通登录 / 未登录） → 渲染"模拟记录 v0.4 即将上线"宣传页
//     避免把站长本人的私人投注数据暴露给外人
//
// 验证方式：先 ping /api/admin/data（带 sessionStorage 里的 key），
// 200 才认定是 admin；否则降级为宣传页（顺带清掉失效的 key）。
// ---------------------------------------------------------------
import { renderBetsPage } from '../bets.js';
import { boot } from '../page-boot.js';

function renderMarketing(root) {
  root.removeAttribute('aria-busy');
  root.innerHTML = `
    <header style="background:linear-gradient(135deg,#0B1F3A 0%,#1e3a5f 100%);color:white;padding:3rem 1.5rem 2.5rem;text-align:center;">
      <span style="display:inline-block;background:#D4AF37;color:#0B1F3A;padding:.3rem 1rem;border-radius:9999px;font-weight:700;font-size:.85rem;letter-spacing:.05em;margin-bottom:.75rem;">即将上线 · v0.4</span>
      <h1 style="font-size:2.25rem;font-weight:900;margin:0 0 .5rem;">⚽ 你的 <span style="color:#D4AF37;">足球预测账本</span></h1>
      <p style="font-size:1.05rem;opacity:.9;max-width:640px;margin:0 auto 1.5rem;line-height:1.6;">
        记录每一笔预测 · 自动算命中率 / ROI / 串关命中 · 让你看清自己到底是真懂球还是靠运气
      </p>
    </header>

    <main class="container-page py-8">
      <h2 style="text-align:center;font-size:1.6rem;font-weight:800;margin:0 0 .5rem;">🛠️ 三大核心能力</h2>
      <p style="text-align:center;color:#64748b;margin:0 0 2rem;font-size:.9rem;">v0.4 计划交付，每项都有原型设计</p>

      <div style="display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:.75rem;padding:1.5rem;">
          <div style="font-size:2rem;margin-bottom:.5rem;">📝</div>
          <h3 style="margin:0 0 .5rem;font-size:1.05rem;font-weight:700;">快速录入</h3>
          <p style="color:#64748b;font-size:.88rem;line-height:1.6;margin:0;">
            3 步完成：选比赛 → 选玩法（胜平负/让球/比分/总进球/半全场）→ 选方向。支持单关、2串1、3串1、混合过关。
          </p>
        </div>
        <div style="background:white;border:1px solid #e2e8f0;border-radius:.75rem;padding:1.5rem;">
          <div style="font-size:2rem;margin-bottom:.5rem;">📊</div>
          <h3 style="margin:0 0 .5rem;font-size:1.05rem;font-weight:700;">自动算账</h3>
          <p style="color:#64748b;font-size:.88rem;line-height:1.6;margin:0;">
            完赛 1 小时内自动结算：单关命中、串关几中几、净盈利、命中率、连胜连败。按玩法 / 球队拆 ROI。
          </p>
        </div>
        <div style="background:white;border:1px solid #e2e8f0;border-radius:.75rem;padding:1.5rem;">
          <div style="font-size:2rem;margin-bottom:.5rem;">🏆</div>
          <h3 style="margin:0 0 .5rem;font-size:1.05rem;font-weight:700;">排行 + 战绩</h3>
          <p style="color:#64748b;font-size:.88rem;line-height:1.6;margin:0;">
            跟其他玩家比 ROI、命中率、连胜天数。生成可分享的战绩卡，看你在世界杯周期到底赚了多少。
          </p>
        </div>
      </div>

      <div style="background:linear-gradient(135deg,#D4AF37 0%,#f4d35e 100%);border-radius:1rem;padding:2rem 1.5rem;text-align:center;color:#0B1F3A;margin-top:2.5rem;">
        <h2 style="font-size:1.5rem;font-weight:800;margin:0 0 .5rem;">🎯 想第一时间用上？</h2>
        <p style="margin:0 0 1rem;opacity:.9;font-size:.95rem;">留言告诉我们你最想要的功能，v0.4 优先级会参考用户投票</p>
        <a class="btn-primary" href="/contact.html"
           style="display:inline-block;background:#0B1F3A;color:white;padding:.7rem 1.6rem;border-radius:.5rem;font-weight:700;text-decoration:none;">
          📬 联系站长 · 登记意向
        </a>
      </div>

      <p style="text-align:center;color:#94a3b8;font-size:.78rem;margin-top:2rem;">
        💡 站长本人的 1000 元模拟预算仅 admin 后台可见，不在本站公开
      </p>
    </main>
  `;
}

boot(async () => {
  const root = document.getElementById('bets-root');
  if (!root) return;
  const adminKey = sessionStorage.getItem('wc_admin_key');
  if (adminKey) {
    try {
      const r = await fetch('/api/admin/data', {
        headers: { 'x-admin-key': adminKey },
        cache: 'no-store',
      });
      if (r.ok) {
        await renderBetsPage();
        return;
      }
      // 401/403：key 已失效，清掉避免下次还走错路
      sessionStorage.removeItem('wc_admin_key');
    } catch {
      // 网络问题降级为宣传页
    }
  }
  renderMarketing(root);
}, { errorTarget: 'bets-root' });
