/**
 * Common API helpers: error responses, JSON parsing, auth check.
 */
import { readSessionCookie, getSessionUser } from './auth.js';
import { rateLimitGlobal, rateLimitUser } from './ratelimit.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

export function applyCors(res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(res);
    return res.status(204).end();
  }
  return null;
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  // Web Request style
  if (typeof req.json === 'function') return await req.json();
  return {};
}

export function jsonError(res, status, message, extra = {}) {
  return res.status(status).json({ error: message, ...extra });
}

/**
 * Read user email from session cookie; throws 401 if not logged in.
 */
export async function requireUser(req) {
  const token = readSessionCookie(req);
  const session = await getSessionUser(token);
  if (!session?.email) {
    const e = new Error('请先登录');
    e.statusCode = 401;
    throw e;
  }
  return { email: session.email, token };
}

export async function applyRateLimit(req, email) {
  const g = await rateLimitGlobal({ limit: 50, windowSec: 1 });
  if (!g.ok) {
    const e = new Error('服务繁忙，请稍后再试');
    e.statusCode = 429;
    e.retryAfter = g.resetInSec;
    throw e;
  }
  if (email) {
    const u = await rateLimitUser(email, { limit: 10, windowSec: 60 });
    if (!u.ok) {
      const e = new Error(`操作太快，请 ${u.resetInSec} 秒后再试`);
      e.statusCode = 429;
      e.retryAfter = u.resetInSec;
      throw e;
    }
  }
}
