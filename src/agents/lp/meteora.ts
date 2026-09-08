/**
 * Meteora DLMM Data API client (BLUEPRINT.md §9.1: dlmm.datapi.meteora.ag,
 * free, 30 RPS). Read-only pool discovery for the Hunter.
 */
import { getJson } from '../../utils/http.js';

const BASE = 'https://dlmm.datapi.meteora.ag';

export interface MeteoraPool {
  address: string;
  name: string;
  bin_step: number;
  tvl?: number;
  tvl_usd?: number;
  cumulative_fee_volume?: number;
  volume?: { h24?: number };
  fees?: { h24?: number };
  trade_volume_24h?: number;
  fees_24h?: number;
 apr?: number;
  liquidity?: string;
  [k: string]: unknown;
}

/** Fetch DLMM pools (sorted by liquidity by default). */
export async function fetchPools(limit = 60): Promise<MeteoraPool[]> {
  const data = await getJson<MeteoraPool[]>(`${BASE}/pools/all?sort_by=liquidity&order=desc&limit=${limit}`);
  return Array.isArray(data) ? data : [];
}

export function poolTvlUsd(p: MeteoraPool): number {
  return Number(p.tvl_usd ?? p.tvl ?? 0);
}

export function poolVolume24h(p: MeteoraPool): number {
  return Number(p.volume?.h24 ?? p.trade_volume_24h ?? 0);
}

export function poolFees24h(p: MeteoraPool): number {
  return Number(p.fees?.h24 ?? p.fees_24h ?? 0);
}

// ---------------------------------------------------------------------------
// Position reading (Healer) — real on-chain position state via the DLMM API
// ---------------------------------------------------------------------------

export interface MeteoraPosition {
  /** Upper/lower bin boundaries of the position's liquidity distribution. */
  lowerBinId: number;
  upperBinId: number;
  /** Current active bin of the pool (price sits inside the range when between bounds). */
  activeBinId: number | null;
  /** Total position value in USD across both sides (when provided by the API). */
  positionValueUsd: number | null;
  /** Unclaimed fee USD (when provided by the API). */
  feeUsd: number | null;
}

interface MeteoraPositionApiResponse {
  position?: {
    lower_bin_id?: number | string;
    upper_bin_id?: number | string;
  };
  pairs?: Array<{ active_bin_id?: number | string }>;
  x_amount?: string | number;
  y_amount?: string | number;
  fee_x?: string | number;
  fee_y?: string | number;
  [k: string]: unknown;
}

/**
 * Read the agent's DLMM position for a pool via the public position API.
 * Endpoint: GET /position/{owner}/{position_address} — returns bin bounds,
 * active bin, amounts, and fees. Throws on failure so the caller can fall
 * back to time-based estimation (dry-run) rather than guessing blindly.
 */
export async function fetchPosition(
  owner: string,
  positionAddress: string,
): Promise<MeteoraPosition> {
  const raw = await getJson<MeteoraPositionApiResponse>(
    `${BASE}/position/${owner}/${positionAddress}`,
  );
  const lowerBinId = Number(raw.position?.lower_bin_id ?? NaN);
  const upperBinId = Number(raw.position?.upper_bin_id ?? NaN);
  if (!Number.isFinite(lowerBinId) || !Number.isFinite(upperBinId)) {
    throw new Error(`meteora position ${positionAddress}: missing bin bounds`);
  }
  const activeBinId =
    raw.pairs?.[0]?.active_bin_id !== undefined ? Number(raw.pairs[0].active_bin_id) : null;
  // Valuation: DLMM positions expose amounts in token units; without a price
  // feed here we report null and let the caller decide. Fee fields, when
  // present, are raw lamport-scale values and likewise informational.
  return {
    lowerBinId,
    upperBinId,
    activeBinId: activeBinId !== null && Number.isFinite(activeBinId) ? activeBinId : null,
    positionValueUsd: null,
    feeUsd: null,
  };
}

/** True when the current active bin sits within the position's bin range. */
export function isInRange(pos: MeteoraPosition): boolean {
  if (pos.activeBinId === null) return true; // unknown → assume in-range (dry-run stays permissive)
  return pos.activeBinId >= pos.lowerBinId && pos.activeBinId <= pos.upperBinId;
}
