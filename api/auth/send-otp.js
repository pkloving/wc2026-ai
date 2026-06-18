import handler from '../[...route].js';

export default async function (req, res) {
  // Ensure pathname is set so the catch-all dispatches correctly
  try {
    await handler(new Request(req.url || '/api/auth/send-otp', { method: req.method, headers: req.headers }), res);
  } catch (err) {
    // fallback: call handler directly
    await handler(req, res);
  }
}
