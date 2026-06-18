/**
 * GET /api/data  (public, no auth)
 *
 * 调 lib/data_summary.js 汇总本地文件返回 JSON。
 * 供 /simulate.html 公开数据看板使用，无需 ADMIN_KEY。
 *
 * 注意：返回的是只读摘要，原始赔率 / 球队数据等敏感字段不暴露。
 */
import { applyCors, handleOptions } from '../lib/api_helpers.js';
import { summarizeAll } from '../lib/data_summary.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  applyCors(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const out = summarizeAll();
  // 5 分钟浏览器缓存 + 1 分钟 CDN 缓存（数据文件通常每天 17:00 更新一次）
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(out);
}
