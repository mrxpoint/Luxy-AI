/**
 * Meme Agent Screener — main loop (BLUEPRINT.md §6.2).
 *
 * Pure bot layer, 24/7, no LLM in the hot path:
 *   fetch (DexScreener) → rule-score → persist → LLM filter (above 0.45)
 *   → strong/moderate push to the signals queue.
 *
 * Run: pnpm dev:screener
 */
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { signalQueue, notify } from '../redis/queues.js';
import { seenRecently } from '../redis/connection.js';
import { logger } from '../utils/logger.js';
import {
  fetchPairsForChains,
  fetchPairsByTokens,
  fetchLatestProfiles,
  SCREENER_CHAINS,
  type DexPair,
  type DexChainId,
} from './dexscreener.js';
import { scorePair, SCORING_THRESHOLD } from './scoring.js';
import { filterCandidate } from './llm-filter.js';
import type { Chain, ScoredCandidate } from '../types/index.js';

const log = logger.child({ module: 'screener' });
const DEDUPE_TTL_S = 3 * 60 * 60; // don't re-queue the same token within 3h

/** Discovery queries per chain — short/meme-centric terms that hit DEX search. */
const SEARCH_QUERIES: Record<DexChainId, string[]> = {
  solana: ['SOL', 'USDC', 'BONK', 'WIF'],
  base: ['AERO', 'DEGEN', 'BRETT', 'USDC'],
  ethereum: ['PEPE', 'SHIB', 'USDC', 'WETH'],
};

function toCandidate(pair: DexPair, score: number): ScoredCandidate | null {
  if (!(SCREENER_CHAINS as string[]).includes(pair.chainId)) return null;
  return {
    id: `${pair.chainId}:${pair.baseToken.address}`,
    source: 'screener',
    agent: 'meme',
    chain: pair.chainId as Chain,
    token: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    priceUsd: Number(pair.priceUsd ?? 0),
    liquidityUsd: pair.liquidity?.usd ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    txns24h: (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
    marketCap: pair.marketCap ?? pair.fdv,
    score,
    rawData: pair as unknown as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  };
}

async function persistCandidate(c: ScoredCandidate): Promise<number | null> {
  try {
    const res = await query<{ id: number }>(
      `INSERT INTO signals (source, agent, chain, token, symbol, score, llm_verdict, llm_reason, llm_evaluated, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)
       RETURNING id`,
      [
        c.source,
        c.agent,
        c.chain,
        c.token,
        c.symbol,
        c.score,
        c.llmVerdict ?? null,
        c.llmReason ?? null,
        JSON.stringify(c.rawData),
      ],
    );
    return res.rows[0]?.id ?? null;
  } catch (err) {
    log.warn({ err }, 'failed to persist signal (continuing)');
    return null;
  }
}

async function screenOnce(): Promise<void> {
  // Discovery per chain (Phase 3: Solana + Base + Ethereum — BLUEPRINT §9.3).
  const pairMaps = new Map<string, DexPair>();
  for (const chain of SCREENER_CHAINS) {
    for (const q of SEARCH_QUERIES[chain]) {
      try {
        for (const p of await fetchPairsForChains(q, [chain])) {
          if (p.baseToken?.address && !pairMaps.has(`${p.chainId}:${p.baseToken.address}`)) {
            pairMaps.set(`${p.chainId}:${p.baseToken.address}`, p);
          }
        }
      } catch (err) {
        log.warn({ err, q, chain }, 'dexscreener search failed');
      }
    }
  }
  try {
    const profiles = await fetchLatestProfiles(SCREENER_CHAINS);
    const addresses = profiles.slice(0, 60).map((p) => p.tokenAddress);
    for (const p of await fetchPairsByTokens(addresses, SCREENER_CHAINS)) {
      if (p.baseToken?.address && !pairMaps.has(`${p.chainId}:${p.baseToken.address}`)) {
        pairMaps.set(`${p.chainId}:${p.baseToken.address}`, p);
      }
    }
  } catch (err) {
    log.debug({ err }, 'boosted profiles unavailable');
  }

  const pairs = [...pairMaps.values()];
  const perChain = pairs.reduce<Record<string, number>>((acc, p) => {
    acc[p.chainId] = (acc[p.chainId] ?? 0) + 1;
    return acc;
  }, {});
  log.info({ discovered: pairs.length, perChain }, 'screener cycle start');

  let queued = 0;
  for (const pair of pairs) {
    const { score } = scorePair(pair);
    if (score < SCORING_THRESHOLD) continue;

    const candidate = toCandidate(pair, score);
    if (!candidate) continue;

    // Tier-2 LLM filter — only strong/moderate proceed.
    const { verdict, reason } = await filterCandidate(candidate);
    candidate.llmVerdict = verdict;
    candidate.llmReason = reason;
    if (verdict !== 'strong' && verdict !== 'moderate') continue;

    // Cross-process dedupe.
    const dupeKey = `luxy:seen:meme:${candidate.token}`;
    if (await seenRecently(dupeKey, DEDUPE_TTL_S)) continue;

    const signalId = await persistCandidate(candidate);
    if (signalId !== null) {
      await query('UPDATE signals SET pushed_to_queue = TRUE WHERE id = $1', [signalId]);
    }
    await signalQueue.add('candidate', { kind: 'candidate', candidate });
    queued++;

    await notify(
      `[SIGNAL] ${candidate.symbol} score=${candidate.score.toFixed(2)} ${verdict} — ` +
        `V/L ${(candidate.volume24h / Math.max(candidate.liquidityUsd, 1)).toFixed(1)}x, ` +
        `${candidate.txns24h} txns/24h`,
      'signal',
    );
    await audit('screener', 'signal_emitted', { token: candidate.token, symbol: candidate.symbol, score, verdict });
  }

  log.info({ queued }, 'screener cycle done');
}

async function main(): Promise<void> {
  log.info({ intervalMin: config.SCREENER_INTERVAL_MIN }, 'meme screener starting');
  // Immediate first pass, then fixed cadence.
  await screenOnce().catch((err) => log.error({ err }, 'screener pass failed'));
  setInterval(() => {
    screenOnce().catch((err) => log.error({ err }, 'screener pass failed'));
  }, config.SCREENER_INTERVAL_MIN * 60_000);
}

main().catch((err) => {
  log.fatal({ err }, 'screener crashed');
  process.exit(1);
});
