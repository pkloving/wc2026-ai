/**
 * GET /api/admin/data  (admin only)
 *
 * 调 lib/data_summary.js 汇总本地文件返回 JSON。
 * requireAdminKey 鉴权（ADMIN_KEY 头）。
 */
import { requireAdminKey } from '../../lib/admin.js';
import { applyCors, handleOptions } from '../../lib/api_helpers.js';
import { summarizeAll } from '../../lib/data_summary.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  applyCors(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    requireAdminKey(req);
  } catch {
    return res.status(401).json({ error: 'admin key required' });
  }

  const out = summarizeAll();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(out);
}
