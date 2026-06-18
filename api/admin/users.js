import handler from '../[...route].js';

export default async function (req, res) {
  try {
    if (!req.url.includes('/api/admin')) {
      req.url = '/api/admin' + (req.url === '/' ? '' : req.url);
    }
    return handler(req, res);
  } catch (err) {
    return handler(req, res);
  }
}
