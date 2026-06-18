import { handleRoute } from './router.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req, res) {
  return handleRoute(req, res);
}
