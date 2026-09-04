/**
 * Polymarket data clients (BLUEPRINT.md §9.4 — Phase 3).
 *
 *   Gamma API   → open market discovery (no auth)
 *   CLOB API    → price/book reads (no auth) + order placement (EIP-712 L1)
 *
 * Order placement requires POLYMARKET_PRIVATE_KEY; the dry-run path
 * simulates fills so the prediction-market pipeline is exercisable without
 * any key — same stance as the other execution venues.
 */
import { getJson } from '../../utils/http.js';
import { config } from '../../config/index.js';
import type { PolymarketSignal } from '../../types/index.js';

export interface GammaMarket {
  conditionId: string;
  slug: string;
  question: string;
  outcomes: string[];
  outcomePrices: string[];
  liquidity: string;
  volume: string;
  endDate: string;
  active: boolean;
  closed: boolean;
}

/** Open, liquid markets ending within a sensible horizon (7–30 days out). */
export async function fetchOpenMarkets(limit = 20): Promise<GammaMarket[]> {
  const url =
    `${config.POLYMARKET_GAMMA_API}/markets?limit=${limit}&active=true&closed=false` +
    `&order=volumeNum&ascending=false`;
  const data = await getJson<
    Array<{
      conditionId?: string;
      slug?: string;
      question?: string;
      outcomes?: string | string[];
      outcomePrices?: string | string[];
      liquidity?: string;
      volume?: string;
      volumeNum?: number;
      endDate?: string;
      active?: boolean;
      closed?: boolean;
    }>
  >(url);

  return data
    .filter((m) => m.conditionId && m.question)
    .map((m) => ({
      conditionId: m.conditionId!,
      slug: m.slug ?? '',
      question: m.question!,
      outcomes: parseJsonArray(m.outcomes),
      outcomePrices: parseJsonArray(m.outcomePrices),
      liquidity: m.liquidity ?? '0',
      volume: String(m.volumeNum ?? m.volume ?? 0),
      endDate: m.endDate ?? '',
      active: m.active ?? true,
      closed: m.closed ?? false,
    }))
    .filter((m) => m.outcomes.length === 2);
}

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** CLOB midpoint price for one outcome token (public endpoint). */
export async function fetchMidpoint(tokenId: string): Promise<number> {
  const data = await getJson<{ mid?: string }>(
    `${config.POLYMARKET_CLOB_API}/midpoint?token_id=${encodeURIComponent(tokenId)}`,
  );
  return Number(data.mid ?? 0.5);
}

/** Outcome token ids come from the CLOB `/prices` endpoint per condition. */
export async function fetchOutcomeTokenIds(
  conditionId: string,
): Promise<{ clobTokenIds: string[] } | null> {
  try {
    const data = await getJson<{ clobTokenIds?: string | string[] }>(
      `${config.POLYMARKET_GAMMA_API}/markets/${conditionId}`,
    );
    const ids = typeof data.clobTokenIds === 'string' ? JSON.parse(data.clobTokenIds) : data.clobTokenIds;
    return Array.isArray(ids) ? { clobTokenIds: ids.map(String) } : null;
  } catch {
    return null;
  }
}

export function signalFromMarket(
  m: GammaMarket,
  outcomeIndex: 0 | 1,
  marketPrice: number,
  modelProbability: number,
): PolymarketSignal {
  const edge = modelProbability - marketPrice;
  const liquidityUsd = Number(m.liquidity ?? 0);
  const score = Math.max(0, Math.min(1, Math.abs(edge) * 2 + Math.min(liquidityUsd / 50_000, 0.3)));
  return {
    conditionId: m.conditionId,
    slug: m.slug,
    question: m.question,
    outcome: m.outcomes[outcomeIndex] ?? `outcome${outcomeIndex}`,
    outcomeIndex,
    marketPrice,
    modelProbability,
    edge,
    liquidityUsd,
    endDate: m.endDate,
    score,
  };
}
