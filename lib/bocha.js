/**
 * BoCha AI Search client
 * Docs: https://open.bochaai.com/document/search
 */
import { env } from './env.js';

const SEARCH_URL = 'https://api.bochaai.com/v1/web-search';

export async function bochaSearch(query, count = 5) {
  const apiKey = env('BOCHA_API_KEY');
  if (!apiKey) throw new Error('BOCHA_API_KEY is not set');

  const response = await fetch(`${SEARCH_URL}?query=${encodeURIComponent(query)}&count=${count}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`BoCha search error ${response.status}: ${err}`);
  }

  const data = await response.json();
  // BoCha response: { code: 0, data: { webPages: { webpage: [...] } } }
  return data?.data?.webPages?.webpage ?? [];
}
