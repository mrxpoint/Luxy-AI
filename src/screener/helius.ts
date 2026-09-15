/**
 * Helius RPC wrapper (BLUEPRINT.md §9.1) — on-chain velocity proxy.
 * Free tier: 1M credits/month. Falls back to the public RPC without a key.
 */
import { postJson } from '../utils/http.js';
import { config } from '../config/index.js';

function rpcUrl(): string {
  return config.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`
    : config.SOLANA_RPC_URL;
}

interface RpcResp<T> {
  result?: T;
  error?: { message: string };
}

/** Count recent swap signatures for a token's pool/mint in the last `minutes`. */
export async function countRecentSwaps(accountAddress: string, minutes = 60): Promise<number> {
  const until = Math.floor(Date.now() / 1000);
  const since = until - minutes * 60;
  try {
    const data = await postJson<{ result?: Array<{ blockTime: number | null }> }>(
      rpcUrl(),
      {
        jsonrpc: '2.0',
        id: 'luxy',
        method: 'getSignaturesForAddress',
        params: [accountAddress, { until, limit: 1000 }],
      },
      { 'content-type': 'application/json' },
    );
    const sigs = data.result ?? [];
    return sigs.filter((s) => s.blockTime !== null && s.blockTime >= since).length;
  } catch {
    return 0;
  }
}

/** Current SOL/USD price via Jupiter price API (free, cached upstream ~30s). */
export async function fetchSolPriceUsd(): Promise<number | null> {
  try {
    const data = await postJson<{ sol?: { usdPrice?: number } } | Record<string, never>>(
      'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112',
      undefined,
      {},
    );
    const sol = (data as { sol?: { usdPrice?: number } }).sol;
    return sol?.usdPrice ?? null;
  } catch {
    return null;
  }
}
