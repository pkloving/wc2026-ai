/**
 * Cosine similarity search over the pre-built embedding index.
 * Index format: { model, dim, chunks: [{ id, text, meta, vector: number[] }] }
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './env.js';

const INDEX_PATH = resolve(PROJECT_ROOT, 'data/embeddings/index.json');

let cache = null;

export function loadIndex() {
  if (cache) return cache;
  if (!existsSync(INDEX_PATH)) {
    throw new Error(
      `Embedding index not found at ${INDEX_PATH}. Run: node scripts/build_embeddings.js`,
    );
  }
  cache = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
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

export function searchIndex(queryVec, topK = 6) {
  const idx = loadIndex();
  const scored = idx.chunks.map((c) => ({ ...c, score: cosine(queryVec, c.vector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
