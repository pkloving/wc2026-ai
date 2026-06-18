// scripts/_e2e_admin_data.js — 模拟 admin 调用 /api/admin/data
import { readFileSync } from 'node:fs';

// 拿 ADMIN_KEY
const env = readFileSync('.env', 'utf8');
const m = env.match(/^ADMIN_KEY=(.+)$/m);
const ADMIN_KEY = m ? m[1].trim() : null;
if (!ADMIN_KEY) { console.log('no ADMIN_KEY in .env'); process.exit(1); }

// 直接调底层 handler（不经过 HTTP），手造 req/res
const { default: handler } = await import('../api/admin/data.js');

const req = { method: 'GET', headers: { 'x-admin-key': ADMIN_KEY } };
let statusCode = 200;
let body = null;
let jsonCalled = false;
const headers = {};
const res = {};
res.setHeader = (k, v) => { headers[k] = v; return res; };
res.status = (c) => { statusCode = c; return res; };
res.json = (b) => { jsonCalled = true; body = b; return res; };
res.end = () => res;
console.log('res type:', typeof res, 'has setHeader:', typeof res.setHeader);

await handler(req, res);
console.log('status:', statusCode, 'json:', jsonCalled);
console.log('top keys:', body ? Object.keys(body) : 'null');
if (body) {
  console.log('settled total:', body.settled?.total);
  console.log('matches_status total:', body.matches_status?.total);
  console.log('predict_31 file:', body.predict_31?.file);
  console.log('chat_predict file:', body.chat_predict?.file);
  console.log('roi_insights file:', body.roi_insights?.file);
  console.log('views keys:', body.views ? Object.keys(body.views) : null);
  if (body.views) {
    for (const [k, v] of Object.entries(body.views)) {
      if (k === 'index') continue;
      console.log(`  ${k}: top=${v.top.slice(0, 3).map(t => `${t.key}=${t.pct}%`).join(',')}`);
    }
  }
}
