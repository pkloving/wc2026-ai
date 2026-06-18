/**
 * POST /api/auth/verify-otp
 * Body: { email, code }
 * Side effect: sets HTTPOnly cookie `wc_session`
 * Returns: { user: {email, credits, used, createdAt} }
 */
import { verifyOtp, buildSessionCookie, getCredits } from '../../lib/auth.js';
import { applyCors, handleOptions, readJson, jsonError } from '../../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  try {
    const { email, code } = await readJson(req);
    const { user, token } = await verifyOtp(email, code);
    res.setHeader('Set-Cookie', buildSessionCookie(token));
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
    console.error('[verify-otp]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}
