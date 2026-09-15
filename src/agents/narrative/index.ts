/**
 * Narrative/Alert Agent — process entrypoint (BLUEPRINT.md §6.5).
 * 20-minute loop: Reddit hot posts + Telegram channels → mention tally →
 * LLM hype detection → high-hype signals pushed to the signals queue.
 * Run: pnpm dev:narrative
 */
import { config } from '../../config/index.js';
import { query } from '../../db/pool.js';
import { signalQueue, notify } from '../../redis/queues.js';
import { seenRecently } from '../../redis/connection.js';
import { logger } from '../../utils/logger.js';
import type { NarrativeSignal, ScoredCandidate } from '../../types/index.js';
import { fetchHotPosts, tallyMentions, redditConfigured } from './reddit.js';
import { pollChannelPosts, telegramMonitorConfigured } from './telegram-monitor.js';
import { detectHype } from './hype.js';

const log = logger.child({ module: 'narrative-agent' });

async function cycle(): Promise<void> {
  const posts = await fetchHotPosts();
  const channelPosts = await pollChannelPosts();
  log.info({ posts: posts.length, channelPosts: channelPosts.length }, 'narrative scan');

  if (posts.length === 0 && channelPosts.length === 0) return;

  const tally = tallyMentions(posts);
  const signals = await detectHype(tally, posts, channelPosts.map((p) => p.text));

  for (const s of signals) {
    if (s.hypeLevel !== 'high') continue;
    const dupeKey = `luxy:seen:narrative:${s.token}`;
    if (await seenRecently(dupeKey, 3 * 60 * 60)) continue;

    const candidate: ScoredCandidate = {
      id: `narrative:${s.token}`,
      source: 'narrative',
      agent: 'narrative',
      chain: 'solana',
      token: s.token, // symbol-level until a mint resolver matches it
      symbol: s.token,
      priceUsd: 0,
      liquidityUsd: 0,
      volume24h: 0,
      txns24h: 0,
      score: s.confidence,
      llmVerdict: s.hypeLevel === 'high' ? 'strong' : 'weak',
      llmReason: s.summary,
      rawData: { signal: s, source: 'narrative' },
      createdAt: new Date().toISOString(),
    };

    // persist + queue
    try {
      await query(
        `INSERT INTO signals (source, agent, chain, token, symbol, score, llm_verdict, llm_reason, llm_evaluated, pushed_to_queue, raw_data)
         VALUES ('narrative', 'narrative', 'solana', $1, $1, $2, $3, $4, TRUE, TRUE, $5)`,
        [s.token, s.confidence, s.hypeLevel === 'high' ? 'strong' : 'weak', s.summary, JSON.stringify(s)],
      );
    } catch (err) {
      log.warn({ err }, 'failed to persist narrative signal');
    }
    await signalQueue.add('narrative', { kind: 'narrative', candidate });
    await notify(
      `[HYPE] ${s.token} trending on Reddit (${s.hypeLevel} hype, ${s.sentiment}) — ${s.sourceCount} sources`,
      'hype',
    );
  }
}

async function main(): Promise<void> {
  log.info(
    {
      intervalMin: config.NARRATIVE_INTERVAL_MIN,
      reddit: redditConfigured(),
      telegram: telegramMonitorConfigured(),
    },
    'narrative agent starting',
  );
  await cycle().catch((err) => log.error({ err }, 'narrative cycle failed'));
  setInterval(() => cycle().catch((err) => log.error({ err }, 'narrative cycle failed')),
    config.NARRATIVE_INTERVAL_MIN * 60_000);
}

main().catch((err) => {
  log.fatal({ err }, 'narrative agent crashed');
  process.exit(1);
});

export type { NarrativeSignal };
