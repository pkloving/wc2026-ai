import { summarizeAll } from '../lib/data_summary.js';
import { applyCors, handleOptions } from '../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const out = await summarizeAll();
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(out);
  } catch (err) {
    console.error('[api/data]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}