/**
 * Robinhood Crypto API client — Ed25519-signed orders (BLUEPRINT.md §14 P3).
 *
 * Auth scheme (trading.robinhood.com):
 *   - Ed25519 keypair registered with the Robinhood API (base64 public key).
 *   - Every request is signed over `timestamp + method + path + body` and
 *     sent with `x-api-key`, `x-timestamp`, `x-signature` headers.
 *
 * Node's built-in crypto supports Ed25519 natively — no new dependencies.
 *
 *   DRY_RUN → simulated fill recorded at the executor (default).
 *   LIVE    → requires ROBINHOOD_API_KEY + ROBINHOOD_PRIVATE_KEY_B64;
 *             fails loud otherwise, consistent with all other venues.
 */
import { createPrivateKey, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { LuxyIntent } from '../types/index.js';

const log = logger.child({ module: 'robinhood' });

export interface RobinhoodFill {
  orderId: string | null;
  note: string;
}

/** One-time helper: generate an Ed25519 keypair for Robinhood registration. */
export function generateRobinhoodKeypair(): { publicKeyB64: string; privateKeyB64: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

function loadPrivateKey(): KeyObject {
  const b64 = config.ROBINHOOD_PRIVATE_KEY_B64;
  if (!b64) throw new Error('ROBINHOOD_PRIVATE_KEY_B64 not set — live Robinhood execution unavailable');
  const der = Buffer.from(b64, 'base64');
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function signedHeaders(method: string, path: string, body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now()).toString();
  const message = `${timestamp}${method.toUpperCase()}${path}${body}`;
  const signer = createSign('sha512');
  // Ed25519 ignores the digest algorithm; sha512 keeps other key types valid.
  signer.update(message);
  const privateKey = loadPrivateKey();
  const signature = signer.sign(privateKey).toString('base64');
  return {
    'x-api-key': config.ROBINHOOD_API_KEY,
    'x-timestamp': timestamp,
    'x-signature': signature,
    'content-type': 'application/json',
  };
}

export async function robinhoodExecute(intent: LuxyIntent): Promise<RobinhoodFill> {
  const symbol = (intent.symbol ?? intent.market ?? '').toUpperCase();
  if (!symbol) {
    return { orderId: null, note: 'no symbol on robinhood intent — skipped' };
  }

  if (config.DRY_RUN) {
    return {
      orderId: null,
      note: `dry-run fill (robinhood ${intent.side ?? 'buy'} ${symbol} $${(intent.sizeUsd ?? 0).toFixed(2)})`,
    };
  }

  if (!config.ROBINHOOD_API_KEY || !config.ROBINHOOD_PRIVATE_KEY_B64) {
    throw new Error(
      'LIVE Robinhood execution requires ROBINHOOD_API_KEY + ROBINHOOD_PRIVATE_KEY_B64 — refusing to proceed',
    );
  }

  const path = '/api/v1/crypto/trading/orders/';
  const body = JSON.stringify({
    symbol,
    side: intent.side === 'short' ? 'sell' : 'buy',
    type: 'market',
    market_order_config: { amount: (intent.sizeUsd ?? 0).toFixed(2) }, // USD notional
  });
  const headers = signedHeaders('POST', path, body);
  const res = await fetch(`${config.ROBINHOOD_API_BASE}${path}`, {
    method: 'POST',
    headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`robinhood order failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id?: string };
  log.info({ orderId: data.id, symbol }, 'robinhood order placed');
  return { orderId: data.id ?? null, note: 'live robinhood order' };
}
