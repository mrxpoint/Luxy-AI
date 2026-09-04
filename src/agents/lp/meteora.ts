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
