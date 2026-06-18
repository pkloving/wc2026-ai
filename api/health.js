/**
 * GET /api/health — reports which API keys are configured (no values).
 * Also returns a Redis ping (OK / DOWN) so we know Upstash is reachable.
 */
import { env } from '../lib/env.js';
import { redis } from '../lib/upstash.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
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
