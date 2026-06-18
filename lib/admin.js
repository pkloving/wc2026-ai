/**
 * Admin key check. Single env var ADMIN_KEY protects the admin API + page.
 * Returns true if the request's `x-admin-key` header matches.
 */
import { env } from './env.js';

export function checkAdminKey(req) {
  const expected = env('ADMIN_KEY');
  if (!expected) return false; // not configured → deny
  const provided = req.headers?.['x-admin-key'] || req.headers?.get?.('x-admin-key');
  return provided === expected;
}

export function requireAdminKey(req) {
  if (!checkAdminKey(req)) {
    const err = new Error('admin key required');
    err.statusCode = 401;
    throw err;
  }
}
