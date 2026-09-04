/**
 * Hyperliquid exchange-action signing (BLUEPRINT.md §6.4 / §9.2).
 *
 * Mirrors hyperliquid-dex/hyperliquid-python-sdk `utils/signing.py` exactly:
 *
 *   1. wire order    { a: asset, b: isBuy, p: pxWire, s: szWire, r: reduceOnly, t: {limit:{tif}} }
 *   2. action        { type: "order", orders: [wire…], grouping: "na" }
 *   3. actionHash    keccak(msgpack(action) ‖ nonce(8B BE) ‖ 0x00)      — no vault, no expiry
 *   4. phantom agent { source: "a" mainnet | "b" testnet, connectionId: actionHash }
 *   5. EIP-712       domain { name:"Exchange", version:"1", chainId:1337, verifyingContract:0x0 }
 *                    primaryType Agent { source:string, connectionId:bytes32 }
 *   6. POST /exchange { action, nonce, signature: { r, s, v } }
 *
 * Wire-number formatting (`floatToWire`) matches the SDK: 8-decimal fixed
 * notation, trailing zeros stripped, "-0" normalised to "0". Prices obey the
 * exchange tick rules (5 significant figures, ≤ 6 - szDecimals decimals).
 */
import { encode } from '@msgpack/msgpack';
import { keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { postJson } from '../../utils/http.js';
import { config } from '../../config/index.js';

/** Wire-format a number exactly like the Python SDK's float_to_wire. */
export function floatToWire(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`floatToWire: non-finite ${x}`);
  const fixed = x.toFixed(8);
  let s = fixed.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/**
 * Round a perp price to exchange tick rules: at most 5 significant figures
 * and at most (6 - szDecimals) decimal places (MAX_DECIMALS = 6 for perps).
 */
export function roundPx(px: number, szDecimals: number): number {
  const maxDecimals = Math.max(0, 6 - szDecimals);
  let p = Number(px.toFixed(maxDecimals));
  p = Number(p.toPrecision(5));
  // guard: sig-fig rounding may have restored a trailing decimal beyond the cap
  p = Number(p.toFixed(maxDecimals));
  return p;
}

/** Round a size to the market's szDecimals. */
export function roundSz(sz: number, szDecimals: number): number {
  return Number(sz.toFixed(szDecimals));
}

export interface HLOrderWire {
  a: number; // asset index
  b: boolean; // isBuy
  p: string; // price wire
  s: string; // size wire
  r: boolean; // reduceOnly
  t: { limit: { tif: 'Alo' | 'Ioc' | 'Gtc' } } | { trigger: { triggerPx: string; isMarket: boolean; tpsl: 'tp' | 'sl' } };
}

export interface HLSignature {
  r: string;
  s: string;
  v: number;
}

export interface HLUniverseEntry {
  name: string;
  szDecimals: number;
}

/** Universe (asset index + szDecimals), cached in-process for 1 hour. */
let universeCache: { entries: HLUniverseEntry[]; at: number } | null = null;

export async function fetchUniverse(): Promise<HLUniverseEntry[]> {
  if (universeCache && Date.now() - universeCache.at < 3_600_000) return universeCache.entries;
  const meta = await postJson<{ universe?: HLUniverseEntry[] }>(
    `${config.HYPERLIQUID_API_URL}/info`,
    { type: 'meta' },
  );
  const entries = (meta.universe ?? []).map((u) => ({ name: u.name, szDecimals: Number(u.szDecimals ?? 2) }));
  if (entries.length === 0) throw new Error('hyperliquid /info meta returned empty universe');
  universeCache = { entries, at: Date.now() };
  return entries;
}

/** Resolve (assetIndex, szDecimals) for a coin, e.g. "BTC". */
export async function resolveAsset(coin: string): Promise<{ index: number; szDecimals: number }> {
  const entries = await fetchUniverse();
  const index = entries.findIndex((e) => e.name === coin);
  if (index < 0) throw new Error(`coin ${coin} not in hyperliquid universe`);
  return { index, szDecimals: entries[index].szDecimals };
}

/**
 * keccak action hash — byte-exact port of the SDK's action_hash for the
 * no-vault, no-expiry case (the only shape order placement needs).
 */
export function actionHash(action: unknown, nonce: number): Hex {
  const packed = encode(action);
  const tail = new Uint8Array(packed.length + 9);
  tail.set(packed, 0);
  const view = new DataView(tail.buffer);
  view.setBigUint64(packed.length, BigInt(nonce), false); // 8 bytes big-endian
  tail[packed.length + 8] = 0x00; // no vault address
  return keccak256(tail);
}

/** EIP-712 sign the L1 Agent payload (mainnet source "a"). */
export async function signL1Action(
  privateKey: string,
  action: unknown,
  nonce: number,
  isMainnet = true,
): Promise<HLSignature> {
  const connectionId = actionHash(action, nonce);
  const account = privateKeyToAccount(
    privateKey.startsWith('0x') ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`),
  );
  const sig = await account.signTypedData({
    domain: {
      name: 'Exchange',
      version: '1',
      chainId: 1337,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    },
    types: {
      Agent: [
        { name: 'source', type: 'string' },
        { name: 'connectionId', type: 'bytes32' },
      ],
    },
    primaryType: 'Agent',
    message: { source: isMainnet ? 'a' : 'b', connectionId },
  });
  // viem returns 0x-prefixed concatenated r(32) s(32) v(1)
  const hex = sig.slice(2);
  return {
    r: `0x${hex.slice(0, 64)}`,
    s: `0x${hex.slice(64, 128)}`,
    v: parseInt(hex.slice(128, 130), 16),
  };
}

export interface HLExchangeResponse {
  status: string;
  response?: { data?: { statuses?: Array<Record<string, unknown>> } };
}

/** Build, sign and POST an order action; returns the raw exchange response. */
export async function postSignedOrder(
  privateKey: string,
  orders: HLOrderWire[],
  opts: { grouping?: string; nonce?: number } = {},
): Promise<HLExchangeResponse> {
  const action = {
    type: 'order',
    orders,
    grouping: opts.grouping ?? 'na',
  };
  const nonce = opts.nonce ?? Date.now();
  const signature = await signL1Action(privateKey, action, nonce, true);
  return postJson<HLExchangeResponse>(`${config.HYPERLIQUID_API_URL}/exchange`, {
    action,
    nonce,
    signature,
  });
}

/** Human-readable summary of the statuses array returned by /exchange. */
export function describeStatuses(res: HLExchangeResponse): string {
  if (res.status !== 'ok') {
    const resp = (res as unknown as { response?: string }).response;
    return resp ? `err: ${resp}` : `err: ${JSON.stringify(res)}`;
  }
  const statuses = res.response?.data?.statuses ?? [];
  return statuses
    .map((s) => {
      if ('filled' in s) {
        const f = s.filled as { totalSz?: string; avgPx?: string };
        return `filled ${f.totalSz ?? '?'} @ ${f.avgPx ?? '?'}`;
      }
      if ('resting' in s) return `resting oid ${String((s.resting as { oid?: number }).oid)}`;
      if ('error' in s) return `error: ${String(s.error)}`;
      return JSON.stringify(s);
    })
    .join('; ');
}
