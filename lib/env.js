/**
 * Env loader that works in both Vercel serverless functions and Node scripts.
 * Prefers process.env, falls back to .env file in dev.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(here, '..');

let loaded = false;
function loadDotEnv() {
  if (loaded) return;
  loaded = true;
  const envPath = resolve(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue; // don't overwrite real env
    let val = raw;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

export function env(key) {
  loadDotEnv();
  return process.env[key] || '';
}

export { PROJECT_ROOT };
