/**
 * Billing: license-key redemption (admin-issued) and admin-grant.
 * Keys:
 *   lic:{key}     = JSON {credits, createdAt, used, usedBy, usedAt}  TTL 180d
 */
import { randomBytes } from 'node:crypto';
import { redis } from './upstash.js';
import { grantCredits } from './auth.js';

const LIC_TTL_SEC = 180 * 24 * 60 * 60; // 180 days

function genKey() {
  return 'WC26-' + randomBytes(8).toString('hex').toUpperCase();
}

export async function issueLicense(credits) {
  if (!Number.isFinite(credits) || credits <= 0) {
    const e = new Error('credits must be > 0');
    e.statusCode = 400;
    throw e;
  }
  const key = genKey();
  const payload = JSON.stringify({
    credits,
    createdAt: Date.now(),
    used: false,
    usedBy: null,
    usedAt: null,
  });
  await redis().set(`lic:${key}`, payload, { ex: LIC_TTL_SEC });
  return { key, credits, createdAt: Date.now() };
}

export async function listLicenses(limit = 50) {
  // SCAN through lic:* and collect latest
  let cursor = '0';
  const items = [];
  do {
    const [next, keys] = await redis().scan(cursor, 'lic:*', 100);
    cursor = next;
    if (keys?.length) {
      const values = await Promise.all(keys.map((k) => redis().get(k)));
      for (let i = 0; i < keys.length; i++) {
        const v = values[i];
        if (!v) continue;
        const obj = JSON.parse(v);
        obj.key = keys[i].replace(/^lic:/, '');
        items.push(obj);
      }
    }
  } while (cursor !== '0' && cursor !== 0);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items.slice(0, limit);
}

export async function redeemLicense(key, email) {
  const k = String(key || '').trim().toUpperCase();
  if (!k.startsWith('WC26-')) {
    const e = new Error('无效的 license key');
    e.statusCode = 400;
    throw e;
  }
  const raw = await redis().get(`lic:${k}`);
  if (!raw) {
    const e = new Error('license key 不存在或已过期');
    e.statusCode = 404;
    throw e;
  }
  const lic = JSON.parse(raw);
  if (lic.used) {
    const e = new Error(`license key 已被使用（${lic.usedAt} by ${lic.usedBy}）`);
    e.statusCode = 409;
    throw e;
  }
  // 原子：标记 used + 充积分 + 延长 TTL 仅 1 天（防误用）
  // 用 Lua 保证 usedBy 只能被填一次
  const ok = await redis().eval(
    `
      local v = redis.call('GET', KEYS[1])
      if not v then return 0 end
      local lic = cjson.decode(v)
      if lic.used then return 0 end
      lic.used = true
      lic.usedBy = ARGV[1]
      lic.usedAt = ARGV[2]
      redis.call('SET', KEYS[1], cjson.encode(lic), 'EX', 86400)
      return 1
    `,
    [`lic:${k}`],
    [email, new Date().toISOString()],
  );
  if (!ok) {
    const e = new Error('license key 已被使用（并发竞争）');
    e.statusCode = 409;
    throw e;
  }
  const balance = await grantCredits(email, lic.credits, `license:${k}`);
  return { credits: lic.credits, balance };
}
