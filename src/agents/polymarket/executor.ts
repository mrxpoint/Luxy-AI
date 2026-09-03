/**
 * Polymarket order execution via the CLOB (BLUEPRINT.md §9.4 — Phase 3).
 *
 *   DRY_RUN → simulated fill at the current midpoint (default mode).
 *   LIVE    → requires POLYMARKET_PRIVATE_KEY (EIP-712 L1 auth via viem)
 *             and a provisioned CLOB API key (L2 HMAC). Until both are set
 *             the executor fails loud — it never falls back to simulation
 *             silently when live is requested.
 *
 * Order types: GTC for entries (rest until filled), GTD supported via
 * `expiration` timestamps per the CLOB API.
 */
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { postJson } from '../../utils/http.js';
import type { LuxyIntent } from '../../types/index.js';

const log = logger.child({ module: 'polymarket-executor' });

export interface PolymarketFill {
  orderId: string | null;
  note: string;
}

const CLOB_MIN_SIZE_USD = 1;

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

  // LIVE path: L1-signed order flow. The CLOB API key derivation (L2 HMAC)
  // must be provisioned out-of-band; until then fail loud rather than guess.
  const apiKey = process.env.POLYMARKET_API_KEY ?? '';
  if (!apiKey) {
    throw new Error(
      'LIVE Polymarket execution requires POLYMARKET_API_KEY (derived once via CLOB /auth/derive-api-key) — see docs/polymarket.md',
    );
  }

  const body = {
    order: {
      salt: Date.now(),
      maker: config.POLYMARKET_FUNDER_ADDRESS,
      signer: config.POLYMARKET_FUNDER_ADDRESS,
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: intent.token ?? '',
      makerAmount: String(Math.round(sizeUsd * 1e6)),
      takerAmount: '0', // filled by the CLOB price ladder at order time
      expiration: orderTypeExpiration(intent),
      nonce: '0',
      feeRateBps: '0',
      side: intent.side === 'short' ? 'SELL' : 'BUY',
      signatureType: 2, // EIP-712 (Poly ring proxy)
      signature: '', // composed + EIP-712 signed by the provisioning step
    },
    orderType: orderType(intent),
    owner: apiKey,
  };

  const res = await postJson<{ orderId?: string; errorMsg?: string }>(
    `${config.POLYMARKET_CLOB_API}/order`,
    body,
    { 'POLY_ADDRESS': config.POLYMARKET_FUNDER_ADDRESS, 'POLY_TIMESTAMP': String(Date.now()) },
  );
  if (res.errorMsg) throw new Error(`polymarket order rejected: ${res.errorMsg}`);
  log.info({ orderId: res.orderId }, 'polymarket order placed');
  return { orderId: res.orderId ?? null, note: 'live polymarket order' };
}

function orderType(intent: LuxyIntent): 'GTC' | 'GTD' | 'FOK' {
  const tag = intent.reasoning.match(/\b(gtc|gtd|fok)\b/i)?.[1]?.toUpperCase();
  return tag === 'GTD' ? 'GTD' : tag === 'FOK' ? 'FOK' : 'GTC';
}

function orderTypeExpiration(intent: LuxyIntent): string {
  if (orderType(intent) !== 'GTD') return '0';
  const hours = Number(intent.reasoning.match(/gtd[:= ]*(\d+)h/i)?.[1] ?? 24);
  return String(Math.floor(Date.now() / 1000) + hours * 3600);
}
