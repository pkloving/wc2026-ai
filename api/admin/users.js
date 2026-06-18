/**
 * GET  /api/admin/users      → list all users (with credits)
 * POST /api/admin/users      → issue a new license key { credits }
 * Auth: x-admin-key header
 */
import { requireAdminKey } from '../../lib/admin.js';
import { redis } from '../../lib/upstash.js';
import { issueLicense, listLicenses } from '../../lib/billing.js';
import { applyCors, handleOptions, readJson, jsonError } from '../../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 20 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  try {
    requireAdminKey(req);

    if (req.method === 'GET') {
      const users = await scanUsers();
      const licenses = await listLicenses(50);
      return res.status(200).json({ users, licenses });
    }
    if (req.method === 'POST') {
      const { credits } = await readJson(req);
      const lic = await issueLicense(Number(credits));
      return res.status(200).json({ license: lic });
    }
    return jsonError(res, 405, 'Method not allowed');
  } catch (err) {
    console.error('[admin/users]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}

async function scanUsers() {
  let cursor = '0';
  const out = [];
  do {
    const [next, keys] = await redis().scan(cursor, 'user:*', 100);
    cursor = next;
    if (!keys?.length) continue;
    const userVals = await Promise.all(keys.map((k) => redis().get(k)));
    for (let i = 0; i < keys.length; i++) {
      const v = userVals[i];
      if (!v) continue;
      const u = JSON.parse(v);
      const credits = Number(await redis().get(`credits:${u.email}`) || 0);
      const used = Number(await redis().get(`used:${u.email}`) || 0);
      out.push({
        email: u.email,
        credits,
        used,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        totalGranted: u.totalGranted || 0,
        totalSpent: u.totalSpent || 0,
      });
    }
  } while (cursor !== '0' && cursor !== 0);
  out.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  return out;
}
