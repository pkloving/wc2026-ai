/**
 * Decide whether a user query should trigger a web search.
 * Uses lightweight keyword detection (Chinese) — cheap and predictable.
 */
const SEARCH_TRIGGERS = [
  /最新|刚刚|今天|昨晚|今早|这周|本周|这周天|现在/,
  /伤停|受伤|伤势|复出|停赛|禁赛|红牌|黄牌/,
  /转会|换帅|下课|上任|签约|解约/,
  /首发|首发名单|出场名单|预测首发|大名单/,
  /天气|下雨|暴雨|雪|高温/,
  /直播|在哪看|CCTV|咪咕|爱奇艺|腾讯|平台|版权/,
  /赔率变化|盘口|水位|升降盘/,
  /突发|新闻|官方|公告/,
  /\b(2026|2025|today|latest|injury|transfer|lineup|news|breaking)\b/i,
];

export function shouldSearchWeb(query) {
  if (!query || query.length < 2) return false;
  if (query.length > 80) return true; // long/complex question → search
  return SEARCH_TRIGGERS.some((re) => re.test(query));
}

export async function maybeSearchWeb(query) {
  if (!shouldSearchWeb(query)) return '';
  try {
    const { bochaSearch } = await import('./bocha.js');
    const results = await bochaSearch(`${query} 2026世界杯`, 5);
    if (!results.length) return '';
    const lines = results.map((r, i) => `[#${i + 1}] ${r.name}\n${r.snippet || r.url}`);
    return `【联网搜索结果（来自博查 AI Search）】\n${lines.join('\n\n')}`;
  } catch (err) {
    // Search failure is non-fatal — return empty so the chat still works.
    console.error('[web search failed]', err.message);
    return '';
  }
}
