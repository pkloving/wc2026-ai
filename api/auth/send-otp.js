/**
 * POST /api/auth/send-otp
 * Body: { email }
 * Returns: { sent: true, devMode?: bool, previewCode?: string } // devMode 时回显 code
 */
import { createOtp } from '../../lib/auth.js';
import { sendOtpEmail } from '../../lib/email.js';
import { applyCors, handleOptions, readJson, jsonError } from '../../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  try {
    const { email } = await readJson(req);
    const { email: e, code } = await createOtp(email);
    const result = await sendOtpEmail({ to: e, code, ttlMinutes: 5 });
    return res.status(200).json({
      sent: true,
      devMode: result.devMode,
      previewCode: result.devMode ? code : undefined,
    });
  } catch (err) {
    console.error('[send-otp]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}
