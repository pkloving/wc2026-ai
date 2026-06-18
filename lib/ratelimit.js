/**
 * Rate limiter: per-user and global, using Redis INCR + EXPIRE.
 * Returns { ok, remaining, resetInSec, limit }.
 */
import { redis } from './upstash.js';

async function take(key, limit, windowSec) {
  // atomic: INCR + (if first hit) EXPIRE
  const count = await redis().eval(
    `
      local n = redis.call('INCR', KEYS[1])
      if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
      local ttl = redis.call('TTL', KEYS[1])
      if ttl < 0 then ttl = tonumber(ARGV[2]) end
      return {n, ttl}
    `,
    [key],
    ['1', String(windowSec)],
  );
  const [n, ttl] = Array.isArray(count) ? count : [Number(count), windowSec];
  return {
    ok: n <= limit,
    remaining: Math.max(0, limit - n),
    resetInSec: Number(ttl),
    limit,
  };
}

export async function rateLimitUser(email, { limit = 10, windowSec = 60 } = {}) {
  const minute = Math.floor(Date.now() / 1000 / windowSec);
  return take(`rl:u:${email}:${minute}`, limit, windowSec);
}

export async function rateLimitGlobal({ limit = 50, windowSec = 1 } = {}) {
  const sec = Math.floor(Date.now() / 1000);
  return take(`rl:g:${sec}`, limit, windowSec);
}
