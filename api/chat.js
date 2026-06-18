/**
 * POST /api/chat  (auth required)
 * Body: { messages: [{ role, content }], mode?: 'chat' | 'recommend' }
 * Returns: Server-Sent Events stream of DeepSeek tokens.
 *
 * Pipeline per request:
 *   1. auth check (401 if not logged in)
 *   2. rate limit (429 if too fast)
 *   3. spend credits (1 for chat, 10 for recommend; 402 if insufficient)
 *   4. for 'chat': embed → RAG top-K → optional web search (extra +1)
 *      for 'recommend': load latest chat_predict_<date>.json
 *   5. build system prompt (base + RAG/predict context)
 *   6. stream DeepSeek response as SSE
 *
 * On any error after credit spend → refund.
 */
import { embedTexts } from '../lib/siliconflow.js';
import { searchIndex } from '../lib/rag.js';
import { buildDeepseekStream, chunksToContext } from '../lib/deepseek.js';
import { shouldSearchWeb, maybeSearchWeb } from '../lib/search_decide.js';
import { loadLatestChatPredict, chatPredictToPrompt, noPredictMessage } from '../lib/predict_loader.js';
import { WC_SYSTEM_PROMPT } from '../lib/system_prompt.js';
import { spendCredits, grantCredits, getCredits, RECOMMEND_COST } from '../lib/auth.js';
import {
  applyCors, handleOptions, readJson, jsonError,
  requireUser, applyRateLimit,
} from '../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const COST_MESSAGE = 1;
const COST_WEB_SEARCH = 1;

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
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

    // ====== 分支：出今日推荐单（10 积分） ======
    if (mode === 'recommend') {
      const predict = loadLatestChatPredict();
      if (!predict?.matches?.length) {
        return jsonError(res, 404, noPredictMessage(), { noPredict: true });
      }
      await spendCredits(email, RECOMMEND_COST);
      spent += RECOMMEND_COST;
      return streamResponse({
        res, email, spent,
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

    // ====== 默认：普通聊天（1 积分） ======
    // 1) spend 1 credit
    await spendCredits(email, COST_MESSAGE);
    spent += COST_MESSAGE;

    // 2) RAG
    const [emb] = await embedTexts([lastUser.content]);
    const queryVec = emb.embedding;
    const chunks = searchIndex(queryVec, 6);
    const ragContext = chunksToContext(chunks, 0.2);

    // 3) optional web search
    let webContext = '';
    if (shouldSearchWeb(lastUser.content)) {
      await spendCredits(email, COST_WEB_SEARCH);
      spent += COST_WEB_SEARCH;
      webContext = await maybeSearchWeb(lastUser.content);
    }

    // 4) compose system prompt
    const system = [WC_SYSTEM_PROMPT, ragContext, webContext].filter(Boolean).join('\n\n');

    return streamResponse({
      res, email, spent, system, messages,
      chunks, webContext,
    });
  } catch (err) {
    console.error('[api/chat]', err);
    // refund on failure
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

async function getBalance(email) {
  try {
    return await getCredits(email);
  } catch {
    return null;
  }
}

/* ====== System prompt for "出今日推荐" mode ====== */
const RECOMMEND_PROMPT = [
  WC_SYSTEM_PROMPT,
  '',
  '【当前模式：今日推荐单解读】',
  '用户花 10 积分点了一次"出今日推荐"按钮，希望你用一段话解释下面的推荐单。',
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

/* ====== Shared SSE streamer ====== */
async function streamResponse({ res, email, spent, system, messages, chunks = [], webContext = '', meta = {} }) {
  // SSE headers
  Object.entries({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
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
    credits_remaining: await getBalance(email),
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
        sse(res, 'done', { ok: true, credits_remaining: await getBalance(email) });
        return res.end();
      }
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) sse(res, 'token', { content: delta });
      } catch { /* ignore */ }
    }
  }

  sse(res, 'done', { ok: true, credits_remaining: await getBalance(email) });
  return res.end();
}
