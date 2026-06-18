/**
 * DeepSeek Chat Completions client (with streaming).
 * Docs: https://api-docs.deepseek.com/api/create-chat-completion
 */
import { env } from './env.js';

const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat'; // V3.2; can override with DEEPSEEK_MODEL env

export function buildDeepseekStream({ system, messages, temperature = 0.5, maxTokens = 1500 }) {
  const apiKey = env('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');
  const model = env('DEEPSEEK_MODEL') || DEFAULT_MODEL;

  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  return fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Format retrieved chunks into a compact system context section.
 * Skips low-score hits (below threshold).
 */
export function chunksToContext(chunks, minScore = 0.2) {
  const kept = chunks.filter((c) => c.score >= minScore);
  if (kept.length === 0) return '';
  const lines = kept.map((c, i) => {
    const tag = `[#${i + 1} ${c.meta?.type || 'data'} ${c.meta?.id || ''}]`.trim();
    return `${tag}\n${c.text}`;
  });
  return `【检索到的项目数据（按相关度排序）】\n${lines.join('\n\n---\n\n')}`;
}
