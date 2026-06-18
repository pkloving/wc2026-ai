/**
 * POST /api/search (auth required)
 * Body: { query: string, count?: number }
 * Returns: { query, results: [{ name, url, snippet }] }
 */
import { bochaSearch } from '../lib/bocha.js';
import { spendCredits } from '../lib/auth.js';
import {
  applyCors, handleOptions, readJson, jsonError,
  requireUser, applyRateLimit,
} from '../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const COST = 1;

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  try {
    const { email } = await requireUser(req);
    await applyRateLimit(req, email);

    const { query, count = 5 } = await readJson(req);
    if (!query || typeof query !== 'string') {
      return jsonError(res, 400, 'query is required');
    }
    await spendCredits(email, COST);
    const results = await bochaSearch(query, count);
    return res.status(200).json({ query, results, cost: COST });
  } catch (err) {
    console.error('[api/search]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}
