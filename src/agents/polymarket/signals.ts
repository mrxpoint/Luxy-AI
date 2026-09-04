/**
 * Polymarket signal generation — LLM edge detection (BLUEPRINT.md §14 P3).
 *
 * For each liquid candidate market, the Tier-2 LLM estimates the true
 * probability of the binary outcome. When the estimate diverges from the
 * CLOB midpoint by more than POLYMARKET_MIN_EDGE, an order intent is
 * considered: buy the underpriced side (GTC, marketable limit).
 */
import { getJson, postJson } from '../../utils/http.js';
import { config } from '../../config/index.js';
import { subagentLLM, tryChat } from '../../llm/adapter.js';
import { fetchOpenMarkets, fetchMidpoint, fetchOutcomeTokenIds, signalFromMarket } from './gamma.js';
import type { PolymarketSignal } from '../../types/index.js';

/** Estimate P(outcome=true) with the sub-agent LLM; null when unavailable. */
async function modelProbability(question: string, outcome: string): Promise<number | null> {
  const res = await tryChat(
    subagentLLM(),
    [
      {
        role: 'user',
        content: `Prediction market: "${question}"
Estimate the current probability that the outcome "${outcome}" occurs.
Consider base rates, timelines, and observable momentum. Respond ONLY with JSON:
{"probability": <0.0-1.0>, "confidence": <0.0-1.0>}`,
      },
    ],
    'You are a calibrated probabilistic forecaster. Output JSON only.',
  );
  if (!res) return null;
  try {
    const parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim()) as { probability?: number };
    const p = Number(parsed.probability);
    return Number.isFinite(p) ? Math.min(Math.max(p, 0.01), 0.99) : null;
  } catch {
    return null;
  }
}

export async function scanPolymarketSignals(limit = 8): Promise<PolymarketSignal[]> {
  let markets;
  try {
    markets = await fetchOpenMarkets(limit);
  } catch {
    return []; // gamma unreachable — silent skip, next cycle retries
  }

  const signals: PolymarketSignal[] = [];
  for (const m of markets) {
    if (!m.outcomes || m.outcomes.length !== 2) continue;
    const tokenIds = await fetchOutcomeTokenIds(m.conditionId);
    if (!tokenIds?.clobTokenIds || tokenIds.clobTokenIds.length !== 2) continue;

    const idx = 0 as const; // evaluate the first outcome; edge on the other side mirrors
    let marketPrice: number;
    try {
      marketPrice = await fetchMidpoint(tokenIds.clobTokenIds[idx]);
    } catch {
      continue;
    }
    const model = await modelProbability(m.question, m.outcomes[idx]);
    if (model === null) continue;
    const signal = signalFromMarket(m, idx, marketPrice, model);
    if (Math.abs(signal.edge) >= config.POLYMARKET_MIN_EDGE && signal.liquidityUsd >= 10_000) {
      signals.push(signal);
    }
  }
  return signals.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
}

/** Placeholder re-export to keep imports narrow (postJson retained for future L2 HMAC auth). */
export { postJson };
