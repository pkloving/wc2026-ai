// 动态 import 顶层 await
const { default: handler } = await import('../api/data.js');

const req = { method: 'GET', headers: {} };
const headers = {};
let statusCode = 200;
let body = null;
let jsonCalled = false;
const res = {};
res.setHeader = (k, v) => { headers[k] = v; return res; };
res.status = (c) => { statusCode = c; return res; };
res.json = (b) => { jsonCalled = true; body = b; return res; };
res.end = () => res;

await handler(req, res);
console.log('status:', statusCode, 'json:', jsonCalled);
console.log('cache-control:', headers['Cache-Control']);
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
