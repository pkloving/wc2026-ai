import handler from '../[...route].js';

export default async function (req, res) {
  // Ensure pathname includes the api/auth prefix so the catch-all routes correctly
  try {
    if (!req.url.includes('/api/auth')) {
      req.url = '/api/auth' + (req.url === '/' ? '' : req.url);
    }
    return handler(req, res);
  } catch (err) {
    return handler(req, res);
  }
}
