const fs = require('fs');
const txt = fs.readFileSync('modeling/2022wc/scripts/build_teams_2022wc.js', 'utf-8');
const lines = txt.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let single = 0, double = 0, backtick = 0;
  let inStr = null;
  for (let j = 0; j < line.length; j++) {
    const c = line[j], n = line[j + 1];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && n === '/') break;
    if (c === '"') { double++; inStr = '"'; continue; }
    if (c === "'") { single++; inStr = "'"; continue; }
    if (c === '`') { backtick++; inStr = '`'; continue; }
  }
  if (single % 2 !== 0) console.log('行', i + 1, '单引号未配对 count=', single, '内容:', JSON.stringify(line.slice(0, 120)));
  if (double % 2 !== 0) console.log('行', i + 1, '双引号未配对 count=', double);
  if (backtick % 2 !== 0) console.log('行', i + 1, '反引号未配对 count=', backtick);
}
