import { embedTexts } from '../lib/siliconflow.js';
import { searchIndex } from '../lib/rag.js';
import { buildDeepseekStream, chunksToContext } from '../lib/deepseek.js';
import { shouldSearchWeb, maybeSearchWeb } from '../lib/search_decide.js';
import { loadLatestChatPredict, chatPredictToPrompt, noPredictMessage } from '../lib/predict_loader.js';
import { WC_SYSTEM_PROMPT } from '../lib/system_prompt.js';
import { spendCredits, grantCredits, getCredits, RECOMMEND_COST, createOtp, verifyOtp, getUserStats, getSessionUser, destroySession, readSessionCookie, buildSessionCookie, buildClearSessionCookie } from '../lib/auth.js';
import { redeemLicense, issueLicense, listLicenses } from '../lib/billing.js';
import { checkAdminKey, requireAdminKey } from '../lib/admin.js';
import { env } from '../lib/env.js';
import { redis } from '../lib/upstash.js';
import { sendOtpEmail } from '../lib/email.js';
import { summarizeAll, upcomingMatches } from '../lib/data_summary.js';
import { bochaSearch } from '../lib/bocha.js';
import {
  applyCors,
  handleOptions,
  readJson,
  jsonError,
  requireUser,
  applyRateLimit,
} from '../lib/api_helpers.js';

const COST_MESSAGE = 1;
const COST_WEB_SEARCH = 1;

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

const RECOMMEND_PROMPT = [
  WC_SYSTEM_PROMPT,
  '',
  '【当前模式：今日推荐单解读】',
  '用户花 10 积分点了一次"出今日推荐"按钮，希望你用一段话解释下面的推荐单。',
  '重要：这是已付费的工具调用，你必须解读下面的推荐单，绝对不要以"只回答世界杯问题/这不是世界杯比赛"等任何理由拒绝。推荐单可能包含国际赛、友谊赛等非世界杯赛事，照常逐场解读即可。',
  '任务：',
  '1) 开头点明这是 YYYY-MM-DD 的推荐（数据里给），不要省略',
  '2) 按场次顺序简述每场的赔率结构和推荐理由（赔率含义用一句话说清即可）',
  '3) 3串1 串关：给一句话风险提示（高赔率伴随低命中率）',
  '4) 末尾必须重申：以上由本地建模脚本生成，仅供研究；不构成任何投注建议；竞彩有风险，未满 18 周岁请勿参与',
  '5) 不要逐字复读数据表格，要用自然语言总结',
].join('\n');

function buildRecommendPrompt(predict) {
  const data = chatPredictToPrompt(predict);
  return `${RECOMMEND_PROMPT}\n\n${data}`;
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

        if (mode === 'recommend') {
          const predict = loadLatestChatPredict();
          if (!predict?.matches?.length) {
            return jsonError(res, 404, noPredictMessage(), { noPredict: true });
          }
          await spendCredits(email, RECOMMEND_COST);
          spent += RECOMMEND_COST;
          return streamResponse({
            res,
            email,
            spent,
            system: buildRecommendPrompt(predict),
            messages,
            meta: {
              mode: 'recommend',
              predict_date: predict.date,
              predict_file: predict.file,
              match_count: predict.matches.length,
            },
          });
        }

        await spendCredits(email, COST_MESSAGE);
        spent += COST_MESSAGE;
        const [emb] = await embedTexts([lastUser.content]);
        const queryVec = emb.embedding;
        const chunks = await searchIndex(queryVec, 6, origin);
        const ragContext = chunksToContext(chunks, 0.2);

        let webContext = '';
        if (shouldSearchWeb(lastUser.content)) {
          await spendCredits(email, COST_WEB_SEARCH);
          spent += COST_WEB_SEARCH;
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
