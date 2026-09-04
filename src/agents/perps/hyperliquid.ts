/**
 * Hyperliquid REST client (BLUEPRINT.md §9.2).
 *
 * Info endpoints (public, no auth):
 *   POST /info { type: "allMids" }
 *   POST /info { type: "candleSnapshot", req: { coin, interval, startTime, endTime } }
 *   POST /info { type: "clearinghouseState", user: address }
 *
 * Orders (POST /exchange) are EIP-712 signed locally — see ./signing.ts for
 * the exact spec (mirrors the official Python SDK byte-for-byte).
 */
import { postJson } from '../../utils/http.js';
import { config } from '../../config/index.js';
import type { Candle } from '../../types/index.js';
import {
  describeStatuses,
  postSignedOrder,
  resolveAsset,
  floatToWire,
  roundPx,
  roundSz,
  type HLOrderWire,
} from './signing.js';

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
  // Hyperliquid returns a FLAT map { BTC: "77168.5", ... } — verified live.
  const data = await postJson<Record<string, string>>(`${BASE}/info`, { type: 'allMids' });
  return data ?? {};
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
 *
 * LIVE: EIP-712-signed IoC limit orders priced 2% through the mid (marketable
 * enough for a $200-capped book, priced enough to avoid crossing a full
 * ladder). Exits are reduce-only and sized from the exchange position, not
 * from bookkeeping.
 */

/** IoC limit price offset through the mid. */
const IOC_THROUGH_MID = 0.02;

export interface HLIntent {
  action: string; // entry | exit
  market?: string;
  side?: 'long' | 'short';
  sizeUsd?: number;
  reasoning?: string;
}

async function liveOrder(coin: string, isBuy: boolean, sz: number, mid: number, reduceOnly: boolean): Promise<string> {
  const { index, szDecimals } = await resolveAsset(coin);
  const px = roundPx(mid * (1 + (isBuy ? IOC_THROUGH_MID : -IOC_THROUGH_MID)), szDecimals);
  const wire: HLOrderWire = {
    a: index,
    b: isBuy,
    p: floatToWire(px),
    s: floatToWire(roundSz(sz, szDecimals)),
    r: reduceOnly,
    t: { limit: { tif: 'Ioc' } },
  };
  if (!config.HYPERLIQUID_PRIVATE_KEY) {
    throw new Error('hyperliquid live trading requires HYPERLIQUID_PRIVATE_KEY (sops-encrypted)');
  }
  const res = await postSignedOrder(config.HYPERLIQUID_PRIVATE_KEY, [wire]);
  const summary = describeStatuses(res);
  if (res.status !== 'ok' || summary.includes('error:')) {
    throw new Error(`hyperliquid order rejected — ${summary}`);
  }
  return summary;
}

export async function hyperliquidExecute(intent: HLIntent): Promise<{ filled: boolean; note: string }> {
  if (config.DRY_RUN) {
    return {
      filled: true,
      note: `dry-run ${intent.action} ${intent.side ?? ''} ${intent.market ?? ''} $${(intent.sizeUsd ?? 0).toFixed(2)}`,
    };
  }
  if (!config.HYPERLIQUID_PRIVATE_KEY || !config.HYPERLIQUID_WALLET_ADDRESS) {
    throw new Error('hyperliquid live trading requires wallet provisioning (sops-encrypted key)');
  }
  const coin = intent.market;
  if (!coin) throw new Error('hyperliquid intent missing market');

  if (intent.action === 'exit') {
    // Close the FULL live position — size comes from the exchange itself.
    const positions = await fetchUserPositions(config.HYPERLIQUID_WALLET_ADDRESS);
    const pos = positions.find((p) => p.coin === coin);
    if (!pos || Math.abs(pos.szi) < 1e-12) {
      return { filled: false, note: `no live ${coin} position to close` };
    }
    const mids = await fetchAllMids();
    const mid = Number(mids[coin]);
    if (!Number.isFinite(mid) || mid <= 0) throw new Error(`no mid for ${coin}`);
    const note = await liveOrder(coin, pos.szi < 0, Math.abs(pos.szi), mid, true);
    return { filled: true, note: `live reduce-only close — ${note}` };
  }

  // Entry: long → buy, short → sell.
  const sizeUsd = intent.sizeUsd ?? 0;
  if (sizeUsd <= 0) throw new Error('hyperliquid entry missing sizeUsd');
  const mids = await fetchAllMids();
  const mid = Number(mids[coin]);
  if (!Number.isFinite(mid) || mid <= 0) throw new Error(`no mid for ${coin}`);
  const { szDecimals } = await resolveAsset(coin);
  const px = roundPx(mid * (1 + (intent.side === 'short' ? -IOC_THROUGH_MID : IOC_THROUGH_MID)), szDecimals);
  const sz = roundSz(sizeUsd / px, szDecimals);
  if (sz <= 0) throw new Error(`size rounds to zero (${coin} szDecimals=${szDecimals}, $${sizeUsd})`);
  const note = await liveOrder(coin, intent.side !== 'short', sz, mid, false);
  return { filled: true, note: `live entry — ${note}` };
}
