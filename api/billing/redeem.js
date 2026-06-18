/**
 * POST /api/billing/redeem
 * Body: { key }
 * Side effect: charges `lic:{key}` to current user, grants credits
 * Returns: { credits, balance }
 */
import { requireUser, applyRateLimit, applyCors, handleOptions, readJson, jsonError } from '../../lib/api_helpers.js';
import { redeemLicense } from '../../lib/billing.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  try {
    const { email } = await requireUser(req);
    await applyRateLimit(req, email);
    const { key } = await readJson(req);
    const result = await redeemLicense(key, email);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[redeem]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}
