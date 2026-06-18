/**
 * Cosine similarity search over the pre-built embedding index.
 * Index format: { model, dim, chunks: [{ id, text, meta, vector: number[] }] }
 *
 * The index is shipped as a static asset at /data/embeddings/index.json
 * (see public/data/embeddings/index.json). On Vercel the serverless bundle
 * does NOT contain it, so we fetch it from the deployment's own origin.
 * Locally (vite dev / node scripts) we read it straight off disk.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT, env } from './env.js';

const INDEX_PATH = resolve(PROJECT_ROOT, 'public/data/embeddings/index.json');
const INDEX_URL_PATH = '/data/embeddings/index.json';

let cache = null;

function resolveBaseUrl(origin) {
  if (origin) return origin.replace(/\/$/, '');
  const explicit = env('EMBEDDINGS_BASE_URL') || env('PUBLIC_BASE_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return '';
}

export async function loadIndex(origin) {
  if (cache) return cache;

  // Dev / local: read the static asset directly off disk when present.
  if (existsSync(INDEX_PATH)) {
    cache = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    return cache;
  }

  // Production (Vercel function): fetch the static asset from our own origin.
  const base = resolveBaseUrl(origin);
  if (!base) {
    throw new Error(
      'Embedding index not on disk and no origin/base URL to fetch it from. ' +
        'Set EMBEDDINGS_BASE_URL or ensure the request origin is forwarded.',
    );
  }
  const url = `${base}${INDEX_URL_PATH}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch embedding index from ${url}: ${res.status} ${res.statusText}`);
  }
  cache = await res.json();
  return cache;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

export async function searchIndex(queryVec, topK = 6, origin) {
  const idx = await loadIndex(origin);
  const scored = idx.chunks.map((c) => ({ ...c, score: cosine(queryVec, c.vector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
