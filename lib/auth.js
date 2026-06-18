/**
 * Auth: OTP-based passwordless email login.
 * - Redis keys:
 *   otp:{email}                 = JSON {code, expiresAt, attempts}        TTL 5min
 *   user:{email}                = JSON {email, createdAt, lastSeenAt,
 *                                       totalSpent, totalGranted}         (no TTL)
 *   credits:{email}             = int (余额)                              (no TTL)
 *   used:{email}                = int (累计消耗)                          (no TTL)
 *   freebie_granted:{email}     = "1"                                     (no TTL)
 *   session:{token}             = JSON {email, createdAt, lastSeenAt}    TTL 30d
 */
import { randomBytes, randomInt } from 'node:crypto';
import { redis } from './upstash.js';

const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const OTP_TTL_SEC = 5 * 60; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const FREEBIE_CREDITS = 3;
export const RECOMMEND_COST = 10;  // 出推荐单按钮每次扣 10 积分

export const COOKIE_NAME = 'wc_session';

/* ----- OTP ----- */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function createOtp(email) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw httpErr(400, 'invalid email');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const payload = JSON.stringify({
    code,
    expiresAt: Date.now() + OTP_TTL_SEC * 1000,
    attempts: 0,
  });
  await redis().set(`otp:${e}`, payload, { ex: OTP_TTL_SEC });
  return { email: e, code };
}

export async function verifyOtp(email, code) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw httpErr(400, 'invalid email');
  if (!/^\d{6}$/.test(String(code || ''))) throw httpErr(400, 'invalid code');

  const raw = await redis().get(`otp:${e}`);
  if (!raw) throw httpErr(400, '验证码已过期或不存在');
  const otp = JSON.parse(raw);
  if (Date.now() > otp.expiresAt) {
    await redis().del(`otp:${e}`);
    throw httpErr(400, '验证码已过期');
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await redis().del(`otp:${e}`);
    throw httpErr(429, '尝试次数过多，请重新获取验证码');
  }
  if (otp.code !== String(code)) {
    otp.attempts += 1;
    const remaining = OTP_TTL_SEC;
    await redis().set(`otp:${e}`, JSON.stringify(otp), { ex: remaining });
    throw httpErr(400, `验证码错误（还剩 ${OTP_MAX_ATTEMPTS - otp.attempts} 次）`);
  }

  // 验证码正确 → 删 OTP + 创建/更新用户 + 发 session
  await redis().del(`otp:${e}`);
  const user = await ensureUser(e);
  const token = await issueSession(e);
  return { user, token };
}

/* ----- User ----- */

async function ensureUser(email) {
  const key = `user:${email}`;
  const existing = await redis().get(key);
  const now = Date.now();
  if (existing) {
    const u = JSON.parse(existing);
    u.lastSeenAt = now;
    await redis().set(key, JSON.stringify(u));
    return u;
  }
  const user = {
    email,
    createdAt: now,
    lastSeenAt: now,
    totalSpent: 0,
    totalGranted: 0,
  };
  await redis().set(key, JSON.stringify(user));
  // first-time freebie
  await grantCredits(email, FREEBIE_CREDITS, 'freebie');
  await redis().set(`freebie_granted:${email}`, '1');
  return user;
}

export async function getUser(email) {
  const raw = await redis().get(`user:${email}`);
  return raw ? JSON.parse(raw) : null;
}

export async function getCredits(email) {
  const v = await redis().get(`credits:${email}`);
  return Number(v || 0);
}

export async function getUserStats(email) {
  const [user, credits, used] = await Promise.all([
    getUser(email),
    getCredits(email),
    redis().get(`used:${email}`).then((v) => Number(v || 0)),
  ]);
  return { user, credits, used };
}

/* ----- Session ----- */

function newToken() {
  return randomBytes(32).toString('hex');
}

async function issueSession(email) {
  const token = newToken();
  const payload = JSON.stringify({ email, createdAt: Date.now(), lastSeenAt: Date.now() });
  await redis().set(`session:${token}`, payload, { ex: SESSION_TTL_SEC });
  return token;
}

export async function getSessionUser(token) {
  if (!token) return null;
  const raw = await redis().get(`session:${token}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function destroySession(token) {
  if (!token) return;
  await redis().del(`session:${token}`);
}

/* ----- HTTP helpers ----- */

function httpErr(status, message) {
  const e = new Error(message);
  e.statusCode = status;
  return e;
}

/**
 * Parse `wc_session` cookie from a request. Works with Vercel req (Node API).
 * Supports either `req.headers.cookie` (Vercel Node) or Web `Headers.get('cookie')`.
 */
export function readSessionCookie(req) {
  const raw = req.headers?.cookie || req.headers?.get?.('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Build a Set-Cookie header. maxAge in seconds.
 */
export function buildSessionCookie(token, { maxAge = SESSION_TTL_SEC } = {}) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
}

export function buildClearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/* ----- Billing primitives (used internally + by lib/billing.js) ----- */

export async function grantCredits(email, amount, reason = 'manual') {
  const e = normalizeEmail(email);
  if (!Number.isFinite(amount) || amount <= 0) throw httpErr(400, 'amount must be > 0');
  // Use pipeline-ish: INCRBY doesn't exist in our client; use eval to do both at once
  await redis().eval(
    `
      local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
      local new = cur + tonumber(ARGV[1])
      redis.call('SET', KEYS[1], tostring(new))
      local granted = tonumber(redis.call('GET', KEYS[2]) or '0')
      redis.call('SET', KEYS[2], tostring(granted + tonumber(ARGV[1])))
      return new
    `,
    [`credits:${e}`, `granted:${e}`],
    [String(amount), String(amount)],
  );
  // touch user totals
  const u = await getUser(e);
  if (u) {
    u.totalGranted = (u.totalGranted || 0) + amount;
    u.lastSeenAt = Date.now();
    await redis().set(`user:${e}`, JSON.stringify(u));
  }
  return await getCredits(e);
}

export async function spendCredits(email, amount) {
  const e = normalizeEmail(email);
  if (!Number.isFinite(amount) || amount <= 0) throw httpErr(400, 'amount must be > 0');
  // atomic: check + decrement
  const remaining = await redis().eval(
    `
      local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
      local need = tonumber(ARGV[1])
      if cur < need then return -1 end
      local new = cur - need
      redis.call('SET', KEYS[1], tostring(new))
      local spent = tonumber(redis.call('GET', KEYS[2]) or '0')
      redis.call('SET', KEYS[2], tostring(spent + need))
      return new
    `,
    [`credits:${e}`, `used:${e}`],
    [String(amount)],
  );
  if (remaining === -1 || remaining === '-1') {
    throw httpErr(402, '积分不足，请充值');
  }
  return Number(remaining);
}
