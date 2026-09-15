/**
 * Polymarket CLOB live client (BLUEPRINT.md §9.4).
 *
 * Auth is two-level (mirrors Polymarket/clob-client 5.x byte-for-byte):
 *
 *   L1  EIP-712 "ClobAuthDomain" signature → GET /auth/derive-api-key
 *       headers: POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_NONCE
 *
 *   L2  HMAC-SHA256 over `timestamp + method + requestPath + body`, keyed with
 *       the base64url secret; result re-encoded base64url (keep "=").
 *       headers: POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_API_KEY,
 *                POLY_PASSPHRASE
 *
 * Order signing (EIP-712):
 *   domain  { name: "Polymarket CTF Exchange", version: "1", chainId: 137,
 *             verifyingContract: <exchange | negRiskExchange> }
 *   struct  Order(salt, maker, signer, taker, tokenId, makerAmount,
 *                 takerAmount, expiration, nonce, feeRateBps, side, signatureType)
 *   side: BUY=0, SELL=1 · signatureType: EOA=0, POLY_PROXY=1, GNOSIS_SAFE=2
 *   Exchange:      0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
 *   NegRisk:       0xC5d563A36AE78145C45a50134d48A1215220f80a
 */
import { createHmac } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../../config/index.js';
import { getJson } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'polymarket-clob' });

const CHAIN_ID = 137;
const MSG_TO_SIGN = 'This message attests that I control the given wallet';

export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'; // v1
export const NEG_RISK_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a'; // v1
// Order v2 contracts (clob-client-v2 §config) — the current CLOB order format.
export const CTF_EXCHANGE_V2 = '0xE111180000d2663C0091e4f400237545B87B996B';
export const NEG_RISK_EXCHANGE_V2 = '0xe2222d279d744050d28e00520010520000310F59';
export const CTF_EXCHANGE_V3 = '0xe3333700cA9d93003F00f0F71f8515005F6c00Aa';
export const BYTES32_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const SIDE_BUY = 0;
export const SIDE_SELL = 1;

export interface ApiCreds {
  apiKey: string;
  secret: string;
  passphrase: string;
}

// ---------------------------------------------------------------------------
// L1 auth — EIP-712 ClobAuth
// ---------------------------------------------------------------------------

async function l1Headers(timestamp: number): Promise<Record<string, string>> {
  const account = privateKeyToAccount(
    normalizePk(config.POLYMARKET_PRIVATE_KEY),
  );
  const signature = await account.signTypedData({
    domain: { name: 'ClobAuthDomain', version: '1', chainId: CHAIN_ID },
    types: {
      ClobAuth: [
        { name: 'address', type: 'address' },
        { name: 'timestamp', type: 'string' },
        { name: 'nonce', type: 'uint256' },
        { name: 'message', type: 'string' },
      ],
    },
    primaryType: 'ClobAuth',
    message: {
      address: account.address,
      timestamp: String(timestamp),
      nonce: 0n,
      message: MSG_TO_SIGN,
    },
  });
  return {
    POLY_ADDRESS: account.address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: String(timestamp),
    POLY_NONCE: '0',
  };
}

function normalizePk(pk: string): `0x${string}` {
  return (pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`;
}

/**
 * Create (or derive) the deterministic API credentials for the wallet.
 *
 * Matches the official client's createOrDeriveApiKey: POST /auth/api-key
 * creates credentials for a fresh wallet (200) and returns the same
 * deterministic set for a wallet that already has keys; GET
 * /auth/derive-api-key only works on wallets with existing keys.
 * (Verified live: derive on a fresh wallet → 400, create → 200.)
 */
export async function createOrDeriveCreds(): Promise<ApiCreds> {
  if (!config.POLYMARKET_PRIVATE_KEY) {
    throw new Error('POLYMARKET_PRIVATE_KEY not set — cannot derive CLOB credentials');
  }
  const ts = Math.floor(Date.now() / 1000);
  const headers = await l1Headers(ts);

  const created = await fetch(`${config.POLYMARKET_CLOB_API}/auth/api-key`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ nonce: 0 }),
  });
  if (created.ok) {
    const res = (await created.json()) as ApiCreds;
    if (res?.apiKey && res?.secret && res?.passphrase) return res;
  }

  const derived = await getJson<ApiCreds>(
    `${config.POLYMARKET_CLOB_API}/auth/derive-api-key`,
    headers,
  );
  if (!derived?.apiKey || !derived?.secret || !derived?.passphrase) {
    throw new Error(`could not create or derive CLOB credentials: ${JSON.stringify(Object.keys(derived ?? {}))}`);
  }
  return derived;
}

// ---------------------------------------------------------------------------
// L2 auth — HMAC-SHA256 (base64url, keep '=')
// ---------------------------------------------------------------------------

function hmacSignature(secret: string, timestamp: number, method: string, path: string, body?: string): string {
  const message = `${timestamp}${method}${path}${body ?? ''}`;
  // Secret arrives base64(-url); Node accepts both via 'base64'.
  const key = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sig = createHmac('sha256', key).update(message).digest('base64');
  return sig.replaceAll('+', '-').replaceAll('/', '_');
}

function l2Headers(creds: ApiCreds, method: string, path: string, body?: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const account = privateKeyToAccount(normalizePk(config.POLYMARKET_PRIVATE_KEY));
  return {
    POLY_ADDRESS: account.address,
    POLY_SIGNATURE: hmacSignature(creds.secret, ts, method, path, body),
    POLY_TIMESTAMP: String(ts),
    POLY_API_KEY: creds.apiKey,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

/** GET with L2 headers. */
export async function l2Get<T>(creds: ApiCreds, path: string): Promise<T> {
  return getJson<T>(`${config.POLYMARKET_CLOB_API}${path}`, l2Headers(creds, 'GET', path));
}

// ---------------------------------------------------------------------------
// Public market metadata
// ---------------------------------------------------------------------------

export async function fetchTickSize(tokenId: string): Promise<string> {
  const res = await getJson<{ minimum_tick_size: string }>(
    `${config.POLYMARKET_CLOB_API}/tick-size?token_id=${tokenId}`,
  );
  return res.minimum_tick_size ?? '0.01';
}

export async function fetchNegRisk(tokenId: string): Promise<boolean> {
  const res = await getJson<{ neg_risk: boolean }>(
    `${config.POLYMARKET_CLOB_API}/neg-risk?token_id=${tokenId}`,
  );
  return Boolean(res.neg_risk);
}

/** Public midpoint for a CLOB token id ("0.54" → 0.54). */
export async function fetchMidpoint(tokenId: string): Promise<number> {
  const res = await getJson<{ mid: string }>(
    `${config.POLYMARKET_CLOB_API}/midpoint?token_id=${tokenId}`,
  );
  return Number(res.mid);
}

// ---------------------------------------------------------------------------
// Order building + signing
// ---------------------------------------------------------------------------

export interface OrderRequest {
  tokenId: string;
  side: 'BUY' | 'SELL';
  /** BUY: dollars of USDC to spend. SELL: shares to sell. */
  amount: number;
  price: number;
  orderType: 'GTC' | 'GTD' | 'FOK' | 'FAK';
  expiration?: number; // unix seconds, GTD only
}

/** ROUNDING_CONFIG for the 0.001 tick — price 3dp, size 2dp, amount 5dp. */
function roundTo(x: number, dp: number, mode: 'down' | 'up' | 'normal'): number {
  const f = 10 ** dp;
  const scaled = x * f;
  const rounded = mode === 'down' ? Math.floor(scaled) : mode === 'up' ? Math.ceil(scaled) : Math.round(scaled);
  return rounded / f;
}

function decimalPlaces(x: number): number {
  const s = String(x);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * Compute (makerAmount, takerAmount) raw strings (6dp units) for a limit
 * order at `price`, following the official getOrderRawAmounts rounding.
 * BUY  → maker = USDC in,  taker = shares out (min accepted)
 * SELL → maker = shares in, taker = USDC out (min accepted)
 */
export function orderAmounts(side: 'BUY' | 'SELL', amount: number, price: number, tickSize: string) {
  const cfg =
    tickSize === '0.1'
      ? { price: 1, size: 2, amount: 3 }
      : tickSize === '0.01'
        ? { price: 2, size: 2, amount: 4 }
        : tickSize === '0.001'
          ? { price: 3, size: 2, amount: 5 }
          : { price: 4, size: 2, amount: 6 };

  const rawPrice = roundTo(price, cfg.price, 'normal');
  const clampPrice = Math.min(Math.max(rawPrice, Number(tickSize)), 1 - Number(tickSize));

  if (side === 'BUY') {
    // amount = USDC to spend → shares = amount / price
    let shares = roundTo(amount / clampPrice, cfg.size, 'down');
    let usdc = shares * clampPrice;
    if (decimalPlaces(usdc) > cfg.amount) usdc = roundTo(usdc, cfg.amount, 'down');
    if (shares <= 0 || usdc <= 0) throw new Error('order amounts round to zero');
    return { rawMaker: usdc, rawTaker: shares };
  }
  // SELL: amount = shares to sell
  const shares = roundTo(amount, cfg.size, 'down');
  let usdc = shares * clampPrice;
  if (decimalPlaces(usdc) > cfg.amount) usdc = roundTo(usdc, cfg.amount, 'down');
  if (shares <= 0 || usdc <= 0) throw new Error('order amounts round to zero');
  return { rawMaker: shares, rawTaker: usdc };
}

/**
 * Resolve the exchange order version the live CLOB currently accepts
 * (GET /version, cached 10 min — mirrors the official resolveVersion).
 */
let versionCache: { version: number; at: number } | null = null;

export async function resolveOrderVersion(): Promise<number> {
  if (versionCache && Date.now() - versionCache.at < 600_000) return versionCache.version;
  try {
    const res = await getJson<{ version?: number }>(`${config.POLYMARKET_CLOB_API}/version`);
    versionCache = { version: Math.max(2, Math.round(res.version ?? 2)), at: Date.now() };
  } catch {
    versionCache = { version: 2, at: Date.now() };
  }
  return versionCache.version;
}

/**
 * Build + EIP-712 sign a CTF Exchange order (order format v2 — the current
 * protocol version, mirrors clob-client-v2 ExchangeOrderBuilderV2).
 *
 * v2 struct drops taker/nonce/feeRateBps/expiration and adds timestamp,
 * metadata and builder (bytes32 zero for non-builder flows). Expiration
 * travels in the JSON payload only.
 *
 * Signature types:
 *   0 EOA / 1 POLY_PROXY / 2 POLY_GNOSIS_SAFE → plain EIP-712 Order signature.
 *   3 POLY_1271 ("deposit wallet flow" — maker = signer = the wallet contract)
 *     → EIP-1271 bundle: innerSig ‖ appDomainSep ‖ contentsHash ‖ contentsType
 *       ‖ uint16BE(contentsTypeLen), per ExchangeOrderBuilderV2.
 */
export async function buildSignedOrder(
  req: OrderRequest,
  credsHint?: { negRisk?: boolean; tickSize?: string },
): Promise<{ order: Record<string, unknown>; negRisk: boolean; tickSize: string; version: number }> {
  if (!config.POLYMARKET_PRIVATE_KEY) throw new Error('POLYMARKET_PRIVATE_KEY not set');
  if (!config.POLYMARKET_FUNDER_ADDRESS) throw new Error('POLYMARKET_FUNDER_ADDRESS not set');

  const tickSize = credsHint?.tickSize ?? (await fetchTickSize(req.tokenId));
  const negRisk = credsHint?.negRisk ?? (await fetchNegRisk(req.tokenId));
  const version = await resolveOrderVersion();
  const { rawMaker, rawTaker } = orderAmounts(req.side, req.amount, req.price, tickSize);

  const account = privateKeyToAccount(normalizePk(config.POLYMARKET_PRIVATE_KEY));
  const signatureType = Math.round(config.POLYMARKET_SIGNATURE_TYPE);
  // POLY_1271 (3): maker AND signer are both the wallet contract (funder).
  // Other types: maker = funder, signer = the EOA key.
  const maker = config.POLYMARKET_FUNDER_ADDRESS;
  const signer = signatureType === 3 ? config.POLYMARKET_FUNDER_ADDRESS : account.address;

  const orderMessage = {
    salt: BigInt(Math.floor(Math.random() * 2 ** 53)),
    maker: maker as `0x${string}`,
    signer: signer as `0x${string}`,
    tokenId: BigInt(req.tokenId),
    makerAmount: BigInt(Math.round(rawMaker * 1e6)),
    takerAmount: BigInt(Math.round(rawTaker * 1e6)),
    side: req.side === 'BUY' ? SIDE_BUY : SIDE_SELL,
    signatureType,
    timestamp: BigInt(Date.now()),
    metadata: BYTES32_ZERO as `0x${string}`,
    builder: BYTES32_ZERO as `0x${string}`,
  };

  const verifyingContract =
    version >= 3
      ? CTF_EXCHANGE_V3
      : negRisk
        ? NEG_RISK_EXCHANGE_V2
        : CTF_EXCHANGE_V2;
  const domainVersion = String(version);
  const domain = {
    name: 'Polymarket CTF Exchange',
    version: domainVersion,
    chainId: CHAIN_ID,
    verifyingContract,
  } as const;

  let signature: string;
  if (signatureType === 3) {
    // ---- Deposit-wallet (EIP-1271) bundle ----
    const { encodeAbiParameters, keccak256, toHex } = await import('viem');
    const ORDER_TYPE_STRING =
      'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)';
    const ORDER_TYPE_HASH = keccak256(toHex(ORDER_TYPE_STRING));
    const DOMAIN_TYPE_HASH = keccak256(
      toHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
    );
    const appDomainSep = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'address' },
        ],
        [DOMAIN_TYPE_HASH, keccak256(toHex('Polymarket CTF Exchange')), keccak256(toHex(domainVersion)), BigInt(CHAIN_ID), verifyingContract],
      ),
    );
    const contentsHash = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint8' },
          { type: 'uint8' },
          { type: 'uint256' },
          { type: 'bytes32' },
          { type: 'bytes32' },
        ],
        [
          ORDER_TYPE_HASH,
          orderMessage.salt,
          orderMessage.maker,
          orderMessage.signer,
          orderMessage.tokenId,
          orderMessage.makerAmount,
          orderMessage.takerAmount,
          orderMessage.side,
          orderMessage.signatureType,
          orderMessage.timestamp,
          orderMessage.metadata,
          orderMessage.builder,
        ],
      ),
    );
    const innerSig = await account.signTypedData({
      domain,
      types: {
        TypedDataSign: [
          { name: 'contents', type: 'Order' },
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
          { name: 'salt', type: 'bytes32' },
        ],
        Order: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'signer', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'makerAmount', type: 'uint256' },
          { name: 'takerAmount', type: 'uint256' },
          { name: 'side', type: 'uint8' },
          { name: 'signatureType', type: 'uint8' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'metadata', type: 'bytes32' },
          { name: 'builder', type: 'bytes32' },
        ],
      },
      primaryType: 'TypedDataSign',
      message: {
        contents: orderMessage,
        name: 'DepositWallet',
        version: '1',
        chainId: BigInt(CHAIN_ID),
        verifyingContract: orderMessage.signer,
        salt: BYTES32_ZERO,
      } as never,
    });
    const ctLen = ORDER_TYPE_STRING.length;
    const lenHex = ctLen.toString(16).padStart(4, '0');
    signature = `0x${innerSig.slice(2)}${appDomainSep.slice(2)}${contentsHash.slice(2)}${toHex(ORDER_TYPE_STRING).slice(2)}${lenHex}`;
  } else {
    signature = await account.signTypedData({
      domain,
      types: {
        Order: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'signer', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'makerAmount', type: 'uint256' },
          { name: 'takerAmount', type: 'uint256' },
          { name: 'side', type: 'uint8' },
          { name: 'signatureType', type: 'uint8' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'metadata', type: 'bytes32' },
          { name: 'builder', type: 'bytes32' },
        ],
      },
      primaryType: 'Order',
      message: orderMessage,
    });
  }

  // JSON payload (orderToJsonV2): bigints stringified, taker omitted.
  const orderJson = {
    salt: orderMessage.salt.toString(),
    maker: orderMessage.maker,
    signer: orderMessage.signer,
    tokenId: req.tokenId,
    makerAmount: orderMessage.makerAmount.toString(),
    takerAmount: orderMessage.takerAmount.toString(),
    side: req.side,
    signatureType,
    timestamp: orderMessage.timestamp.toString(),
    expiration: String(req.orderType === 'GTD' ? (req.expiration ?? Math.floor(Date.now() / 1000) + 86400) : 0),
    metadata: BYTES32_ZERO,
    builder: BYTES32_ZERO,
    signature,
  };

  return { order: orderJson, negRisk, tickSize, version };
}

// ---------------------------------------------------------------------------
// Order placement
// ---------------------------------------------------------------------------

export interface PostOrderResult {
  success: boolean;
  orderId?: string;
  errorMsg?: string;
  raw: unknown;
}

/** POST /order with L2 headers. Path + exact body string are included in the HMAC. */
export async function postOrder(creds: ApiCreds, signed: Record<string, unknown>, orderType: string): Promise<PostOrderResult> {
  const path = '/order';
  // Payload shape mirrors orderToJsonV2: salt is a NUMBER, side is a
  // "BUY"/"SELL" string; deferExec/postOnly sit at the top level.
  const payload = {
    deferExec: false,
    postOnly: false,
    order: {
      salt: Number(signed.salt),
      maker: signed.maker,
      signer: signed.signer,
      tokenId: signed.tokenId,
      makerAmount: signed.makerAmount,
      takerAmount: signed.takerAmount,
      side: signed.side,
      signatureType: Number(signed.signatureType),
      timestamp: signed.timestamp,
      expiration: signed.expiration,
      metadata: signed.metadata,
      builder: signed.builder,
      signature: signed.signature,
    },
    owner: creds.apiKey,
    orderType,
  };
  const body = JSON.stringify(payload);
  const headers = {
    ...l2Headers(creds, 'POST', path, body),
    'Content-Type': 'application/json',
  };
  const res = await fetch(`${config.POLYMARKET_CLOB_API}${path}`, {
    method: 'POST',
    headers,
    body, // exact string the HMAC covered
  });
  const raw = (await res.json().catch(() => null)) as
    | { success?: boolean; orderId?: string; errorMsg?: string }
    | null;
  if (!res.ok) {
    throw new Error(
      `POST /order -> ${res.status}: ${raw?.errorMsg ?? JSON.stringify(raw)}`,
    );
  }
  log.info({ orderId: raw?.orderId, errorMsg: raw?.errorMsg }, 'postOrder response');
  return {
    success: Boolean(raw?.success),
    orderId: raw?.orderId,
    errorMsg: raw?.errorMsg,
    raw,
  };
}
