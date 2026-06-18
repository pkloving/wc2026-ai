/**
 * Upstash Redis client (REST).
 * Works in Vercel Serverless / Node scripts with the same API.
 * Docs: https://docs.upstash.com/redis/features/restapi
 */
import { env } from './env.js';

const URL_KEY = 'UPSTASH_REDIS_REST_URL';
const TOKEN_KEY = 'UPSTASH_REDIS_REST_TOKEN';

let cached = null;

export function redis() {
  if (cached) return cached;
  const url = env(URL_KEY);
  const token = env(TOKEN_KEY);
  if (!url || !token) {
    throw new Error(`${URL_KEY} / ${TOKEN_KEY} not set. Add them to Vercel env / .env`);
  }
  cached = makeClient(url, token);
  return cached;
}

function makeClient(url, token) {
  // Minimal command runner for the small subset we need.
  // Each command is an array; Upstash returns [result, ...] where result is the value.
  async function run(command) {
    const resp = await fetch(`${url}/${command}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Upstash error ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    return data.result;
  }

  // Pipeline endpoint: body is an array of command arrays ([[cmd, ...args], ...]).
  // 注意：必须 POST 到 `${url}/pipeline`，而不是 base url。
  // base url 是「单命令」端点，期望 body 是一条扁平命令数组 ["SET","k","v"]；
  // 把 [["SET",...]] 发到 base url 时，服务端会把内层数组当成命令名，
  // Go 端报 `unsupported arg type: ["json.Delim"]`。
  async function exec(commands) {
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands), // [[cmd, ...args], ...]
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Upstash error ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    return data; // [{result}, {result}, ...]
  }

  // Friendly methods (single-command shortcuts using GET path-style)
  return {
    get: (key) => run(`get/${encodeURIComponent(key)}`),
    set: (key, value, opts = {}) => {
      // Use POST exec for SET with options
      const args = ['SET', key, String(value)];
      if (opts.ex) args.push('EX', String(opts.ex));
      if (opts.nx) args.push('NX');
      return exec([args]).then((r) => r[0]?.result);
    },
    del: (key) => exec([['DEL', key]]).then((r) => r[0]?.result),
    exists: (key) => run(`exists/${encodeURIComponent(key)}`),
    incr: (key) => exec([['INCR', key]]).then((r) => r[0]?.result),
    expire: (key, seconds) =>
      exec([['EXPIRE', key, String(seconds)]]).then((r) => r[0]?.result),
    ttl: (key) => exec([['TTL', key]]).then((r) => r[0]?.result),
    hgetall: (key) => exec([['HGETALL', key]]).then((r) => r[0]?.result || {}),
    hset: (key, obj) => {
      const args = ['HSET', key];
      for (const [k, v] of Object.entries(obj)) {
        args.push(k, String(v));
      }
      return exec([args]).then((r) => r[0]?.result);
    },
    hget: (key, field) =>
      exec([['HGET', key, field]]).then((r) => r[0]?.result),
    hdel: (key, field) =>
      exec([['HDEL', key, field]]).then((r) => r[0]?.result),
    scan: async (cursor = '0', match = null, count = 100) => {
      // Upstash Pipeline (POST) 对 SCAN 有 bug：服务端解析参数时
      // 误把 MATCH 当成 list 类型，固定报 "unsupported arg type: \"[\""
      // 单命令 GET path 模式能正常工作。
      const parts = ['scan', encodeURIComponent(cursor)];
      if (match) parts.push('match', encodeURIComponent(match));
      parts.push('count', String(count));
      return run(parts.join('/'));
    },
    eval: async (script, keys = [], args = []) => {
      const fullArgs = ['EVAL', script, String(keys.length), ...keys, ...args];
      const r = await exec([fullArgs]);
      return r[0]?.result;
    },
    // raw passthrough for one-off commands
    send: exec,
  };
}
