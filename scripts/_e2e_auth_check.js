// 验证 admin 端无 key 时返回 401
const { default: handler } = await import('../api/admin/data.js');

const req = { method: 'GET', headers: {} };
let statusCode = 200;
let body = null;
const res = {};
res.setHeader = () => res;
res.status = (c) => { statusCode = c; return res; };
res.json = (b) => { body = b; return res; };
res.end = () => res;

await handler(req, res);
console.log('admin-no-key status:', statusCode, 'body:', body);

// 公开端点不带 key 也能 200
const { default: pubHandler } = await import('../api/data.js');
let pubStatus = 200;
let pubBody = null;
const res2 = {};
res2.setHeader = () => res2;
res2.status = (c) => { pubStatus = c; return res2; };
res2.json = (b) => { pubBody = b; return res2; };
res2.end = () => res2;
await pubHandler({ method: 'GET', headers: {} }, res2);
console.log('public-no-key status:', pubStatus, 'top keys:', pubBody ? Object.keys(pubBody) : 'null');
