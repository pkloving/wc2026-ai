/**
 * GET /api/auth/me
 * Returns: { user: { email, credits, used, createdAt } } or 401
 */
import { readSessionCookie, getSessionUser, getCredits, getUser } from '../../lib/auth.js';
import { applyCors, handleOptions, jsonError } from '../../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');

  try {
    const token = readSessionCookie(req);
    const session = await getSessionUser(token);
    if (!session?.email) {
      return res.status(200).json({ user: null });
    }
    const user = await getUser(session.email);
    if (!user) return res.status(200).json({ user: null });
    const credits = await getCredits(user.email);
    return res.status(200).json({
      user: {
        email: user.email,
        credits,
        used: user.totalSpent || 0,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error('[me]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}
