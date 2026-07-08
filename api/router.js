import { embedTexts } from '../lib/siliconflow.js';
import { searchIndex } from '../lib/rag.js';
import { buildDeepseekStream, chunksToContext } from '../lib/deepseek.js';
import { shouldSearchWeb, maybeSearchWeb } from '../lib/search_decide.js';
import { WC_SYSTEM_PROMPT } from '../lib/system_prompt.js';
import { spendCredits, grantCredits, getCredits, createOtp, verifyOtp, getUserStats, getSessionUser, destroySession, readSessionCookie, buildSessionCookie, buildClearSessionCookie } from '../lib/auth.js';
import { redeemLicense, issueLicense, listLicenses } from '../lib/billing.js';
import { checkAdminKey, requireAdminKey } from '../lib/admin.js';
import { env } from '../lib/env.js';
import { redis } from '../lib/upstash.js';
import { sendOtpEmail } from '../lib/email.js';
import { summarizeAll, upcomingMatches, loadExportRows, rowsToCsv, EXPORT_DATASET_KEYS } from '../lib/data_summary.js';
import { bochaSearch } from '../lib/bocha.js';
import {
  applyCors,
  handleOptions,
  readJson,
  jsonError,
  requireUser,
  applyRateLimit,
} from '../lib/api_helpers.js';

// 计量制单一真源：一处改价，全站一致。与 pricing.html 的「Credits 怎么计量」表对齐。
// 已上线：message（研究问答）、web_search（联网检索附加）、export（数据导出，见 /api/export）。
// 即将上线：backtest（自助回测）—— 端点上线后接入此表。
const COSTS = {
  message: 1,
  web_search: 1,
  backtest: 5,
  export: 1,
};

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function getUserList() {
  const out = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis().scan(cursor, 'user:*', 100);
    cursor = next;
    for (const key of keys || []) {
      const raw = await redis().get(key);
      if (!raw) continue;
      const user = JSON.parse(raw);
      const email = user.email;
      const [credits, used] = await Promise.all([
        redis().get(`credits:${email}`).then((v) => Number(v || 0)),
        redis().get(`used:${email}`).then((v) => Number(v || 0)),
      ]);
      out.push({ ...user, credits, used });
    }
  } while (cursor !== '0' && cursor !== 0);
  out.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  return out;
}

async function getUserPayload(email) {
  const stats = await getUserStats(email);
  return {
    user: {
      email,
      ...stats.user,
      credits: stats.credits,
      used: stats.used,
    },
  };
}

async function streamResponse({ res, email, spent, system, messages, chunks = [], webContext = '', meta = {} }) {
  Object.entries({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  }).forEach(([k, v]) => res.setHeader(k, v));

  const upstream = await buildDeepseekStream({ system, messages });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text();
    sse(res, 'error', { message: `DeepSeek error ${upstream.status}: ${errText}` });
    if (spent > 0) {
      await grantCredits(email, spent, 'refund:deepseek-error').catch(() => {});
      spent = 0;
    }
    return res.end();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  sse(res, 'meta', {
    ...meta,
    used_chunks: chunks.length
      ? chunks.map((c) => ({ id: c.meta?.id, type: c.meta?.type, score: Number(c.score.toFixed(3)) }))
      : undefined,
    web_search_used: Boolean(webContext),
    cost: spent,
    credits_remaining: await getCredits(email),
  });

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') {
        sse(res, 'done', { ok: true, credits_remaining: await getCredits(email) });
        return res.end();
      }
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) sse(res, 'token', { content: delta });
      } catch {}
    }
  }

  sse(res, 'done', { ok: true, credits_remaining: await getCredits(email) });
  return res.end();
}

export async function handleRoute(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;

  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = host ? `${proto}://${host}` : '';
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const segments = requestUrl.pathname.split('?')[0].split('/').filter(Boolean);
  const route = segments[0] === 'api' ? segments.slice(1).join('/') : segments.join('/');

  try {
    if (route === 'chat') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      let email = null;
      let spent = 0;
      try {
        const { email: e } = await requireUser(req);
        email = e;
        await applyRateLimit(req, email);

        const { messages = [], mode = 'chat' } = await readJson(req);
        if (!Array.isArray(messages) || messages.length === 0) {
          return jsonError(res, 400, 'messages must be a non-empty array');
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (!lastUser?.content) {
          return jsonError(res, 400, 'last user message is empty');
        }

        // 模式分支：回测实验室解读（5 credits 代替 message，跳过联网，附回测解读 system）
        if (mode === 'backtest') {
          // 扣 5 替 1
          await spendCredits(email, COSTS.backtest);
          spent += COSTS.backtest;
          // 跳过联网（user 已自带 cfg 上下文）
          const BACKTEST_SYSTEM = [
            WC_SYSTEM_PROMPT,
            '【回测实验室模式】用户的最后一条消息包含一段回测策略 + 双届 ROI/命中/回撤摘要 + 徽章（样本过小/2026样本内/两届方向翻转）。',
            '你的任务：',
            '1. 解释「样本过小」徽章对结论可信度的影响（n<10 视为提示而非铁律）。',
            '2. 解释「2026 样本内」—— 该届数据在策略迭代时已可见，可能存在 overfit；请主动指出 2022 vs 2026 ROI 方向是否翻转。',
            '3. 解释「退水基线」—— 三门（all-outcomes）ROI ≈ -13.9% 是市场抽水基线，策略必须战胜它。',
            '4. 给结构化解读：哪个玩法 / 方向 / 场景最弱？哪类有微弱正 EV 但样本不够？',
            '【红线】不给投注建议；不暗示「跟单」；承认 2022+2026 两次样本不能推断 2030。',
            '【格式】3-6 段，每段一个观点；末尾用 1 行「样本提示」总结 n 限制。',
          ].join('\n');
          // 注入当前北京时间 + 即将开赛列表
          const { now, matches: upcoming } = upcomingMatches(6);
          const timeContext = upcoming.length
            ? `【当前北京时间】${now}\n【接下来即将开赛（按开赛时间升序）】\n${upcoming.map((m) => `• ${m.code} ${m.home} vs ${m.away} ${m.kickoff}`).join('\n')}`
            : `【当前北京时间】${now}\n（当前没有即将开赛的比赛）`;
          const system = [BACKTEST_SYSTEM, timeContext].join('\n\n');
          return streamResponse({ res, email, spent, system, messages, meta: { mode: 'backtest' } });
        }

        await spendCredits(email, COSTS.message);
        spent += COSTS.message;
        const [emb] = await embedTexts([lastUser.content]);
        const queryVec = emb.embedding;
        const chunks = await searchIndex(queryVec, 6, origin);
        const ragContext = chunksToContext(chunks, 0.2);

        let webContext = '';
        if (shouldSearchWeb(lastUser.content)) {
          await spendCredits(email, COSTS.web_search);
          spent += COSTS.web_search;
          webContext = await maybeSearchWeb(lastUser.content);
        }

        // 注入当前北京时间 + 即将开赛列表，作为"下一场/即将开赛"的权威依据
        const { now, matches: upcoming } = upcomingMatches(6);
        const timeContext = upcoming.length
          ? `【当前北京时间】${now}\n【接下来即将开赛（按开赛时间升序，最近的在最前；回答"下一场/即将开赛/最近哪场"时以此为准，不要凭检索片段的顺序猜测）】\n${upcoming.map((m) => `• ${m.code} ${m.home} vs ${m.away} ${m.kickoff}（${m.league || ''}）`).join('\n')}`
          : `【当前北京时间】${now}\n（当前没有即将开赛的比赛）`;

        const system = [WC_SYSTEM_PROMPT, timeContext, ragContext, webContext].filter(Boolean).join('\n\n');
        return streamResponse({ res, email, spent, system, messages, chunks, webContext });
      } catch (err) {
        console.error('[api/chat]', err);
        if (email && spent > 0) {
          await grantCredits(email, spent, 'refund:error').catch(() => {});
        }
        if (!res.headersSent) {
          return jsonError(res, err.statusCode || 500, err.message);
        }
        sse(res, 'error', { message: err.message });
        return res.end();
      }
    }

    if (route === 'data') {
      if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');
      const out = summarizeAll();
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(out);
    }

    // 计量制「数据导出」动作：?dataset=<key>&format=json|csv，扣 COSTS.export，出错退款
    if (route === 'export') {
      if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');
      let email = null;
      let spent = 0;
      try {
        const { email: e } = await requireUser(req);
        email = e;
        await applyRateLimit(req, email);

        const dataset = String(requestUrl.searchParams.get('dataset') || '');
        const format = String(requestUrl.searchParams.get('format') || 'json').toLowerCase();
        if (!EXPORT_DATASET_KEYS.includes(dataset)) {
          return jsonError(res, 400, `unknown dataset; valid: ${EXPORT_DATASET_KEYS.join(', ')}`);
        }
        if (format !== 'json' && format !== 'csv') {
          return jsonError(res, 400, 'format must be json or csv');
        }
        const data = loadExportRows(dataset);
        if (!data || !data.rows.length) {
          return jsonError(res, 404, 'dataset empty or missing');
        }

        await spendCredits(email, COSTS.export);
        spent += COSTS.export;

        const filename = `${dataset}.${format}`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Credits-Spent', String(spent));
        if (format === 'csv') {
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          return res.status(200).end(rowsToCsv(data.rows));
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).end(JSON.stringify({
          dataset,
          label: data.label,
          generated_at: data.generated_at,
          count: data.rows.length,
          cost: spent,
          rows: data.rows,
        }));
      } catch (err) {
        console.error('[api/export]', err);
        if (email && spent > 0) {
          await grantCredits(email, spent, 'refund:export-error').catch(() => {});
        }
        return jsonError(res, err.statusCode || 500, err.message);
      }
    }

    if (route === 'search') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      const { email } = await requireUser(req);
      await applyRateLimit(req, email);
      const { query, count = 5 } = await readJson(req);
      if (!query || typeof query !== 'string') return jsonError(res, 400, 'query is required');
      await spendCredits(email, 1);
      const results = await bochaSearch(query, count);
      return res.status(200).json({ query, results, cost: 1 });
    }

    // 回测实验室：导出 CSV 票池明细（扣 1 credit 便利费；明细本就在客户端）
    // 入参: {} （rows 由前端本地生成，不经网络）
    if (route === 'lab/export') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      let email = null;
      let spent = 0;
      try {
        const { email: e } = await requireUser(req);
        email = e;
        await applyRateLimit(req, email);
        await spendCredits(email, COSTS.export);
        spent += COSTS.export;
        res.setHeader('X-Credits-Spent', String(spent));
        return res.status(200).json({
          ok: true,
          mode: 'export',
          cost: COSTS.export,
          credits_remaining: await getCredits(email),
        });
      } catch (err) {
        console.error('[api/lab/export]', err);
        if (email && spent > 0) {
          await grantCredits(email, spent, 'refund:lab-export-error').catch(() => {});
        }
        if (!res.headersSent) return jsonError(res, err.statusCode || 500, err.message);
        return res.end();
      }
    }

    if (route === 'health') {
      if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');
      let redisOk = false;
      try { redisOk = Boolean(await redis().get('health:ping')); } catch { redisOk = false; }
      return res.status(200).json({
        ok: true,
        env: {
          DEEPSEEK_API_KEY: Boolean(env('DEEPSEEK_API_KEY')),
          SILICONFLOW_API_KEY: Boolean(env('SILICONFLOW_API_KEY')),
          BOCHA_API_KEY: Boolean(env('BOCHA_API_KEY')),
          RESEND_API_KEY: Boolean(env('RESEND_API_KEY')),
          ADMIN_KEY: Boolean(env('ADMIN_KEY')),
          UPSTASH: Boolean(env('UPSTASH_REDIS_REST_URL') && env('UPSTASH_REDIS_REST_TOKEN')),
        },
        deepseek_model: env('DEEPSEEK_MODEL') || 'deepseek-chat',
        upstash_ok: redisOk,
        timestamp: new Date().toISOString(),
      });
    }

    if (route === 'auth/me') {
      if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');
      const { email } = await requireUser(req);
      return res.status(200).json(await getUserPayload(email));
    }

    if (route === 'auth/logout') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      const { email, token } = await requireUser(req);
      await destroySession(token);
      return res.status(200).json({ ok: true, email });
    }

    if (route === 'auth/send-otp') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      const { email } = await readJson(req);
      if (!email || typeof email !== 'string') return jsonError(res, 400, 'email is required');
      const { code } = await createOtp(email);
      const info = await sendOtpEmail({ to: email, code });
      return res.status(200).json({
        ok: true,
        devMode: info.devMode,
        previewCode: info.devMode ? code : undefined,
      });
    }

    if (route === 'auth/verify-otp') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      const { email, code } = await readJson(req);
      if (!email || !code) return jsonError(res, 400, 'email and code are required');
      const { user, token } = await verifyOtp(email, code);
      res.setHeader('Set-Cookie', buildSessionCookie(token));
      return res.status(200).json({ user, token });
    }

    if (route === 'billing/redeem') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      const { email } = await requireUser(req);
      const { key } = await readJson(req);
      const result = await redeemLicense(key, email);
      return res.status(200).json(result);
    }

    if (route === 'billing/admin-grant') {
      if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
      requireAdminKey(req);
      const { email, credits } = await readJson(req);
      if (!email || !Number.isFinite(Number(credits))) return jsonError(res, 400, 'email and credits are required');
      const balance = await grantCredits(email, Number(credits), 'admin-panel');
      return res.status(200).json({ balance });
    }

    if (route === 'admin/users') {
      if (req.method === 'GET') {
        requireAdminKey(req);
        const [users, licenses] = await Promise.all([getUserList(), listLicenses(100)]);
        return res.status(200).json({ users, licenses });
      }
      if (req.method === 'POST') {
        requireAdminKey(req);
        const { credits } = await readJson(req);
        if (!Number.isFinite(Number(credits)) || Number(credits) <= 0) return jsonError(res, 400, 'credits must be > 0');
        const license = await issueLicense(Number(credits));
        return res.status(200).json({ license });
      }
      return jsonError(res, 405, 'Method not allowed');
    }

    if (route === 'admin/data') {
      if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');
      requireAdminKey(req);
      return res.status(200).json(summarizeAll());
    }

    if (route === 'admin/resend-check') {
      if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');
      const ok = Boolean(env('RESEND_API_KEY'));
      return res.status(200).json({ ok, configured: ok });
    }

    return res.status(404).json({ error: 'API route not found' });
  } catch (err) {
    console.error('[api/route]', err);
    return jsonError(res, err.statusCode || 500, err.message || 'Internal Server Error');
  }
}
