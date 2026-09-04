/**
 * Tier-2 LLM filter (BLUEPRINT.md §6.2 pipeline).
 *
 * Rule-scored candidates above threshold get a cheap sub-agent verdict:
 * strong | moderate | weak | skip. Only strong/moderate continue to the
 * signal queue. On any LLM failure the verdict defaults to 'weak' so a
 * broken API can never force trades through (fail-safe, not fail-open).
 */
import { subagentLLM, tryChat } from '../llm/adapter.js';
import type { LlmVerdict, ScoredCandidate } from '../types/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'llm-filter' });

const SYSTEM = `You are a strict crypto token screener filter for an autonomous trading system.
Given a token's metrics, classify its short-term trade worthiness:
- "strong": organic momentum, healthy volume/liquidity, no obvious red flags
- "moderate": interesting but needs confirmation
- "weak": mediocre metrics
- "skip": red flags (dead volume, honeypot-looking, absurd taxes, washed trading)

Respond with ONLY a JSON object: {"verdict":"strong|moderate|weak|skip","reason":"<one sentence>"}`;

export async function filterCandidate(c: ScoredCandidate): Promise<{ verdict: LlmVerdict; reason: string }> {
  const adapter = subagentLLM();
  const metrics = {
    symbol: c.symbol,
    chain: c.chain,
    priceUsd: c.priceUsd,
    liquidityUsd: c.liquidityUsd,
    volume24h: c.volume24h,
    txns24h: c.txns24h,
    marketCap: c.marketCap,
    ruleScore: c.score,
    priceDataSource: (c.rawData?.priceChange24hPercent as number | undefined) ?? null,
  };
  const res = await tryChat(
    adapter,
    [{ role: 'user', content: JSON.stringify(metrics) }],
    SYSTEM,
  );
  if (!res) {
    log.debug({ symbol: c.symbol }, 'llm filter unavailable — defaulting to weak');
    return { verdict: 'weak', reason: 'llm filter unavailable (fail-safe default)' };
  }
  try {
    const cleaned = res.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as { verdict?: string; reason?: string };
    const verdict = ['strong', 'moderate', 'weak', 'skip'].includes(parsed.verdict ?? '')
      ? (parsed.verdict as LlmVerdict)
      : 'weak';
    return { verdict, reason: parsed.reason ?? '' };
  } catch {
    log.warn({ text: res.text.slice(0, 120) }, 'llm filter returned unparseable output');
    return { verdict: 'weak', reason: 'unparseable llm verdict' };
  }
}
