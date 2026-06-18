/**
 * POST /api/auth/logout
 * Side effect: clears session cookie + revokes session in Redis
 */
import { readSessionCookie, destroySession, buildClearSessionCookie } from '../../lib/auth.js';
import { applyCors, handleOptions, jsonError } from '../../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  try {
    const token = readSessionCookie(req);
    if (token) await destroySession(token);
    res.setHeader('Set-Cookie', buildClearSessionCookie());
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[logout]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}
