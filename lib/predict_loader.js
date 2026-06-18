/**
 * Loader for the AI-bot-friendly predict files.
 * Reads the latest `chat_predict_YYYY-MM-DD.json` produced by
 * `scripts/build_chat_predict.js`. These files are intentionally tiny
 * (no prob/tier/internal labels) to keep DeepSeek tokens low.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './env.js';

const DIR = resolve(PROJECT_ROOT, 'modeling/artifacts');
const PREFIX = 'chat_predict_';
const SUFFIX = '.json';

/**
 * Return the latest chat_predict file (by date-sorted filename), or null.
 * Shape: { file, date, generated_at, matches, parlays_3x1, pairs_2x1, ... }
 */
export function loadLatestChatPredict() {
  if (!existsSync(DIR)) return null;
  const files = readdirSync(DIR)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
    .sort()
    .reverse();
  if (!files.length) return null;
  const file = files[0];
  try {
    const data = JSON.parse(readFileSync(resolve(DIR, file), 'utf8'));
    return { file, ...data };
  } catch (err) {
    console.error('[predict_loader] failed to read', file, err.message);
    return null;
  }
}

/**
 * Convert a loaded chat_predict into a short, AI-friendly markdown block.
 * Keep this tight — every line costs tokens. Designed so the model can
 * paraphrase a clear "today's picks" answer without re-reading JSON.
 */
export function chatPredictToPrompt(predict) {
  if (!predict?.matches?.length) return '';
  const lines = [];
  lines.push(`【AI 今日推荐单 · ${predict.date}】`);

  for (const m of predict.matches) {
    const sign = m.handicap > 0 ? `+${m.handicap}` : `${m.handicap}`;
    const rq = m.rqspf
      ? `让${sign}(主${m.rqspf.home}/平${m.rqspf.draw}/客${m.rqspf.away})`
      : '让球数据缺';
    const dir = m.rqspf_direction ? ` · 方向: ${m.rqspf_direction}` : '';
    const ko = m.kickoff ? ` · ${m.kickoff}` : '';
    const spf = m.spf
      ? `主${m.spf.home}/平${m.spf.draw}/客${m.spf.away}`
      : '胜平负数据缺';
    lines.push(`• ${m.code} ${m.home} vs ${m.away}${ko}`);
    lines.push(`  spf: ${spf} · ${rq}${dir}`);
    if (m.picks?.length) {
      const picksStr = m.picks.map((p) => `${p.pick}@${p.odds}`).join('、');
      lines.push(`  推荐比分: ${picksStr}`);
    }
    if (m.reason) lines.push(`  理由: ${m.reason}`);
  }

  if (predict.parlays_3x1?.length) {
    lines.push('\n【3串1 rqspf 串关（仅供参考）】');
    predict.parlays_3x1.slice(0, 3).forEach((p, i) => {
      const legs = p.picks.map((x) => `${x.code} ${x.pickLabel}`).join('×');
      lines.push(`  ${i + 1}. ${legs} = @${p.totalOdds}`);
    });
  }
  if (predict.pairs_2x1?.length) {
    lines.push('\n【2串1 比分（高赔率，命中率低）】');
    predict.pairs_2x1.slice(0, 3).forEach((p, i) => {
      lines.push(`  ${i + 1}. ${p.a.code} ${p.a.pick} × ${p.b.code} ${p.b.pick} = @${p.totalOdds}`);
    });
  }

  lines.push('\n声明: 由本地 modeling 脚本生成，仅供研究；不构成投注建议。');
  return lines.join('\n');
}

/**
 * Friendly message when no predict file is found.
 */
export function noPredictMessage() {
  return (
    '今日推荐单暂未生成。\n\n' +
    '推荐单通常在北京时间每天 17:00 左右更新（赔率变化收敛后由站长本地建模生成）。\n\n' +
    '如果长时间没看到，可能是：\n' +
    '• 当日没有未完赛的世界杯比赛\n' +
    '• 赔率数据源异常，建模脚本未跑成功\n' +
    '• 站长还没来得及跑当天的建模\n\n' +
    '如需了解详情或催更，请联系站长：/contact.html\n' +
    '你的 10 积分不会扣除，请放心。'
  );
}
