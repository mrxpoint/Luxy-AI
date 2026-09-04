/**
 * LLM hype detection (BLUEPRINT.md §6.5).
 * Input: reddit tally + channel posts. Output: NarrativeSignal[].
 */
import { subagentLLM, tryChat } from '../../llm/adapter.js';
import { logger } from '../../utils/logger.js';
import type { NarrativeSignal } from '../../types/index.js';
import type { RedditPost } from './reddit.js';

const log = logger.child({ module: 'hype' });

const SYSTEM = `You detect crypto narrative hype from social posts.
Given a tally of token mentions and recent post samples, produce hype signals.
Respond with ONLY JSON:
{"signals":[{"token":"WIF","hypeLevel":"low|medium|high","sentiment":"bullish|bearish|neutral","summary":"<one concrete sentence>","confidence":0.0-1.0,"sourceCount":12}]}
Rules: only include tokens with >=3 mentions; cap 5 signals; no invented tokens.`;

export async function detectHype(
  tally: Map<string, { count: number; sources: Set<string> }>,
  posts: RedditPost[],
  channelSnippets: string[],
): Promise<NarrativeSignal[]> {
  const candidates = [...tally.entries()]
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([token, v]) => ({ token, mentions: v.count, subreddits: [...v.sources] }));

  if (candidates.length === 0) return [];

  const samples = posts.slice(0, 20).map((p) => p.title);
  const res = await tryChat(
    subagentLLM(),
    [
      {
        role: 'user',
        content: JSON.stringify({ candidates, sampleTitles: samples, channelSnippets: channelSnippets.slice(0, 10) }),
      },
    ],
    SYSTEM,
  );
  if (!res) return [];

  try {
    const cleaned = res.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as { signals?: NarrativeSignal[] };
    return (parsed.signals ?? []).slice(0, 5);
  } catch (err) {
    log.warn({ err, text: res.text.slice(0, 120) }, 'hype detection returned unparseable output');
    return [];
  }
}
