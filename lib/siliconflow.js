/**
 * Silicon Flow bge-m3 embedding client
 * Docs: https://docs.siliconflow.cn/api-reference/embeddings-embeddings
 */
import { env } from './env.js';

const MODEL = 'BAAI/bge-m3';
const EMBEDDING_URL = 'https://api.siliconflow.cn/v1/embeddings';

export async function embedTexts(texts) {
  const apiKey = env('SILICONFLOW_API_KEY');
  if (!apiKey) throw new Error('SILICONFLOW_API_KEY is not set');

  const response = await fetch(EMBEDDING_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`SiliconFlow embedding error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.data; // [{object:"embedding",index:0,embedding:[...]}]
}
