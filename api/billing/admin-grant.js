/**
 * POST /api/billing/admin-grant
 * Body: { email, credits, note? }
 * Auth: x-admin-key header
 * Side effect: adds credits to user (no license key involved)
 */
import { requireAdminKey } from '../../lib/admin.js';
import { grantCredits } from '../../lib/auth.js';
import { applyCors, handleOptions, readJson, jsonError } from '../../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  try {
    requireAdminKey(req);
    const { email, credits, note = '' } = await readJson(req);
    if (!email || !credits) return jsonError(res, 400, 'email + credits required');
    const balance = await grantCredits(email, Number(credits), `admin:${note || 'manual'}`);
    return res.status(200).json({ ok: true, balance, granted: Number(credits) });
  } catch (err) {
    console.error('[admin-grant]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}
