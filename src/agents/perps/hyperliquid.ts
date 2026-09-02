/**
 * Hyperliquid REST client (BLUEPRINT.md §9.2).
 *
 * Info endpoints (public, no auth):
 *   POST /info { type: "allMids" }
 *   POST /info { type: "candleSnapshot", req: { coin, interval, startTime, endTime } }
 *   POST /info { type: "clearinghouseState", user: address }
 *
 * Orders (POST /exchange, EIP-712 signed) are stubbed: Phase 2 runs in
 * dry-run — the stub records intent-level fills so the whole pipeline is
 * exercisable end-to-end before any live signing is enabled.
 */
import { postJson } from '../../utils/http.js';
import { config } from '../../config/index.js';
import type { Candle } from '../../types/index.js';

const BASE = config.HYPERLIQUID_API_URL;

export interface HyperliquidCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

export async function fetchAllMids(): Promise<Record<string, string>> {
  const data = await postJson<{ allMids?: Record<string, string>; [k: string]: unknown }>(
    `${BASE}/info`,
    { type: 'allMids' },
  );
  return (data as { allMids?: Record<string, string> }).allMids ?? {};
}

export async function fetchCandles(coin: string, interval = '1h', hours = 24): Promise<Candle[]> {
  const endTime = Date.now();
  const startTime = endTime - hours * 3600_000;
  const data = await postJson<Array<HyperliquidCandle> | { candles?: HyperliquidCandle[] }>(
    `${BASE}/info`,
    { type: 'candleSnapshot', req: { coin, interval, startTime, endTime } },
  );
  const items = Array.isArray(data) ? data : data.candles ?? [];
  return items
    .map((c) => ({
      t: Number(c.t),
      o: Number(c.o),
      h: Number(c.h),
      l: Number(c.l),
      c: Number(c.c),
      v: Number(c.v),
    }))
    .sort((a, b) => a.t - b.t);
}

export interface HyperliquidPosition {
  coin: string;
  szi: number; // signed position size
  entryPx: number;
  unrealizedPnl: number;
  returnOnEquity: number;
}

export async function fetchUserPositions(address: string): Promise<HyperliquidPosition[]> {
  const data = await postJson<{
    assetPositions?: Array<{ position: { coin: string; szi: string; entryPx: string; unrealizedPnl: string; returnOnEquity: string } }>;
  }>(`${BASE}/info`, { type: 'clearinghouseState', user: address });
  return (data.assetPositions ?? []).map((a) => ({
    coin: a.position.coin,
    szi: Number(a.position.szi),
    entryPx: Number(a.position.entryPx),
    unrealizedPnl: Number(a.position.unrealizedPnl),
    returnOnEquity: Number(a.position.returnOnEquity),
  }));
}

/**
 * Order execution — dry-run aware (BLUEPRINT §6.4: EIP-712 signed at executor).
 * DRY_RUN: simulates the fill. LIVE: hard stop until signing is provisioned
 * (identical safety stance to the Jupiter path).
 */
export async function hyperliquidExecute(intent: {
  action: string;
  market?: string;
  side?: 'long' | 'short';
  sizeUsd?: number;
}): Promise<{ filled: boolean; note: string }> {
  if (config.DRY_RUN) {
    return {
      filled: true,
      note: `dry-run ${intent.action} ${intent.side ?? ''} ${intent.market ?? ''} $${(intent.sizeUsd ?? 0).toFixed(2)}`,
    };
  }
  if (!config.HYPERLIQUID_PRIVATE_KEY || !config.HYPERLIQUID_WALLET_ADDRESS) {
    throw new Error('hyperliquid live trading requires wallet provisioning (sops-encrypted key)');
  }
  // EIP-712 signing arrives with the live-trading enablement milestone;
  // failing loudly here is safer than a partial signing implementation.
  throw new Error('live hyperliquid signing not enabled in this build');
}
