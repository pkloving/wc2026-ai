/**
 * Email sending via Resend (https://resend.com).
 * Falls back to console.log when RESEND_API_KEY is missing (dev mode).
 */
import { env } from './env.js';

const FROM = 'WC2026 AI 助手 <noreply@wc2026-ai.com>'; // 用户部署时改成自己的域名

export async function sendOtpEmail({ to, code, ttlMinutes = 5 }) {
  const apiKey = env('RESEND_API_KEY');
  const subject = `【WC2026 AI】您的登录验证码：${code}`;
  const html = `
    <div style="font-family:'PingFang SC',Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#0B1F3A;margin:0 0 16px">⚽ WC2026 AI 助手</h2>
      <p style="color:#334155;font-size:14px;line-height:1.6">
        您的登录验证码（${ttlMinutes} 分钟内有效）：
      </p>
      <div style="background:#0B1F3A;color:#D4AF37;font-size:32px;font-weight:700;letter-spacing:8px;
                  text-align:center;padding:20px;border-radius:8px;margin:20px 0">
        ${code}
      </div>
      <p style="color:#64748b;font-size:12px;line-height:1.5">
        如果不是您本人操作，请忽略此邮件。<br>
        验证码仅用于登录，不会以任何形式索取您的密码。
      </p>
    </div>
  `.trim();

  if (!apiKey) {
    // Dev fallback: print to console
    console.log(`\n📧 [DEV MODE] OTP for ${to}: ${code}  (expires in ${ttlMinutes}m)\n`);
    return { delivered: false, devMode: true };
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Resend error ${resp.status}: ${txt}`);
  }
  return { delivered: true, devMode: false };
}
