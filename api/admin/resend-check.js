/**
 * GET /api/admin/resend-check  (header: x-admin-key)
 * 诊断用：拿「生产环境正在用的那把 RESEND_API_KEY」去问 Resend
 *   GET https://api.resend.com/domains
 * 返回这把 key 所属账号下能看到的域名 + 验证状态。
 *
 * 用途：发验证码报 403 "domain is not verified"，但 dashboard 又显示 verified 时，
 * 用它确认「生产 key 的账号里到底有没有 wc2026-ai.com、状态是不是 verified」。
 * 不回显 key 本身，只回显头尾几位做指纹，方便核对是否和你以为的那把一致。
 */
import { requireAdminKey } from '../../lib/admin.js';
import { env } from '../../lib/env.js';
import { applyCors, handleOptions, jsonError } from '../../lib/api_helpers.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

export default async function handler(req, res) {
  applyCors(res);
  if (handleOptions(req, res)) return;
  try {
    requireAdminKey(req);

    const apiKey = env('RESEND_API_KEY');
    if (!apiKey) return jsonError(res, 500, 'RESEND_API_KEY 未配置（生产环境降级为控制台打印）');

    const resp = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await resp.json().catch(() => ({}));

    return res.status(200).json({
      // key 指纹：只露头尾，确认生产用的是不是你以为的那把
      keyFingerprint: `${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (len=${apiKey.length})`,
      resendStatus: resp.status,
      // 这把 key 的账号能看到的域名 + 状态
      domains: (body?.data || []).map((d) => ({
        name: d.name,
        status: d.status,
        region: d.region,
        id: d.id,
      })),
      raw: resp.ok ? undefined : body,
    });
  } catch (err) {
    console.error('[admin/resend-check]', err);
    return jsonError(res, err.statusCode || 500, err.message);
  }
}
