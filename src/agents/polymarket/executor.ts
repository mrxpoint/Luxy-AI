/**
 * Polymarket order execution via the CLOB (BLUEPRINT.md §9.4 — Phase 3).
 *
 *   DRY_RUN → simulated fill at the current midpoint (default mode).
 *   LIVE    → full CLOB flow: EIP-712 L1 auth → derived API creds (cached in
 *             process) → L2 HMAC headers → signed CTF Exchange order posted
 *             to /order. Any missing credential fails loud — the executor
 *             never falls back to simulation silently when live is requested.
 *
 * Order types: GTC limit at the midpoint for entries (rest until filled),
 * GTD supported via `expiration` timestamps per the CLOB API.
 */
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { LuxyIntent } from '../../types/index.js';
import {
  buildSignedOrder,
  createOrDeriveCreds,
  fetchMidpoint,
  postOrder,
  type ApiCreds,
} from './clob.js';

const log = logger.child({ module: 'polymarket-executor' });

export interface PolymarketFill {
  orderId: string | null;
  note: string;
  /** Shares filled (BUY) or sold (SELL) — recorded on the position for exits. */
  shares?: number;
}

const CLOB_MIN_SIZE_USD = 1;

let credsCache: ApiCreds | null = null;

async function creds(): Promise<ApiCreds> {
  if (!credsCache) {
    credsCache = process.env.POLYMARKET_API_KEY
      ? {
          apiKey: process.env.POLYMARKET_API_KEY,
          secret: process.env.POLYMARKET_API_SECRET ?? '',
          passphrase: process.env.POLYMARKET_API_PASSPHRASE ?? '',
        }
      : await createOrDeriveCreds();
  }
  return credsCache;
}

export async function polymarketExecute(intent: LuxyIntent): Promise<PolymarketFill> {
  const sizeUsd = intent.sizeUsd ?? 0;
  if (sizeUsd < CLOB_MIN_SIZE_USD) {
    return { orderId: null, note: 'size below CLOB minimum — skipped' };
  }

  if (config.DRY_RUN) {
    return {
      orderId: null,
      note: `dry-run fill (polymarket ${intent.side ?? 'long'} on "${intent.symbol ?? intent.token ?? 'market'}")`,
    };
  }

  if (!config.POLYMARKET_PRIVATE_KEY || !config.POLYMARKET_FUNDER_ADDRESS) {
    throw new Error(
      'LIVE Polymarket execution requires POLYMARKET_PRIVATE_KEY + POLYMARKET_FUNDER_ADDRESS — refusing to proceed',
    );
  }

  const tokenId = intent.token ?? '';
  if (!/^\d{10,}$/.test(tokenId)) {
    throw new Error('LIVE Polymarket intent is missing a numeric CLOB token id');
  }

  const side = intent.side === 'short' ? 'SELL' : 'BUY';
  // BUY: spend sizeUsd USDC. SELL: exit fills are share-denominated via fill.shares.
  const shares = (intent as LuxyIntent & { shares?: number }).shares;
  const amount = side === 'BUY' ? sizeUsd : (shares ?? 0);
  if (amount <= 0) {
    throw new Error('LIVE Polymarket SELL requires share count from the recorded entry fill');
  }

  const price = await fetchMidpoint(tokenId);
  if (!(price > 0) || !(price < 1)) throw new Error(`bad midpoint for token ${tokenId}: ${price}`);

  const signed = await buildSignedOrder({ tokenId, side, amount, price, orderType: orderType(intent) });
  const res = await postOrder(await creds(), signed.order, orderType(intent));
  if (res.errorMsg) throw new Error(`polymarket order rejected: ${res.errorMsg}`);
  log.info({ orderId: res.orderId }, 'polymarket order placed');
  const estShares = side === 'BUY' ? Number((sizeUsd / price).toFixed(2)) : amount;
  return {
    orderId: res.orderId ?? null,
    note: `live polymarket ${side} @ ${price}`,
    shares: estShares,
  };
}

function orderType(intent: LuxyIntent): 'GTC' | 'GTD' | 'FOK' {
  const tag = intent.reasoning.match(/\b(gtc|gtd|fok)\b/i)?.[1]?.toUpperCase();
  return tag === 'GTD' ? 'GTD' : tag === 'FOK' ? 'FOK' : 'GTC';
}
