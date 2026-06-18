import handler from '../[...route].js';

export default async function (req, res) {
  try {
    await handler(new Request(req.url || '/api/admin', { method: req.method, headers: req.headers }), res);
  } catch (err) {
    await handler(req, res);
  }
}
