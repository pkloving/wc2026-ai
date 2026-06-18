import handler from '../[...route].js';

export default async function (req, res) {
  try {
    if (!req.url.includes('/api/billing')) {
      req.url = '/api/billing' + (req.url === '/' ? '' : req.url);
    }
    return handler(req, res);
  } catch (err) {
    return handler(req, res);
  }
}
