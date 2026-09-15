/**
 * Jupiter v6 swap client (BLUEPRINT.md §9.1).
 *
 * quote   GET  {base}/quote?inputMint&outputMint&amount&slippageBps
 * swap    POST {base}/swap  (unsigned tx built by Jupiter; signed locally)
 *
 * In DRY_RUN no transaction is ever built or sent — fills are simulated at
 * the quoted price with the quoted slippage so PnL accounting behaves
 * realistically. LIVE builds the swap transaction from the quote, signs it
 * locally with the agent keypair (SOLANA_PRIVATE_KEY, base58 — the exact
 * format `pnpm bootstrap-wallet` prints) and submits it via RPC.
 */
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config/index.js';
import { getJson, postJson } from '../utils/http.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'jupiter' });

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: Array<{ swapInfo: { label?: string } }>;
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Fetch a quote for an exact-in swap. `amountRaw` is in input mint base units. */
export async function getQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: number,
  slippageBps: number,
): Promise<JupiterQuote> {
  const url =
    `${config.JUPITER_API_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amountRaw}&slippageBps=${slippageBps}`;
  return getJson<JupiterQuote>(url);
}

/** Estimated slippage of a quote (price impact as a fraction). */
export function quoteSlippage(q: JupiterQuote): number {
  return Number(q.priceImpactPct ?? '0');
}

/** Decode the agent keypair from SOLANA_PRIVATE_KEY (base58 or [int] JSON). */
export function loadAgentKeypair(): Keypair {
  const raw = config.SOLANA_PRIVATE_KEY;
  if (!raw) throw new Error('SOLANA_PRIVATE_KEY not set — run `pnpm bootstrap-wallet` and store the secret in sops');
  if (raw.trim().startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw.trim())));
  }
  return Keypair.fromSecretKey(bs58.decode(raw.trim()));
}

/**
 * Simulated or real execution.
 * DRY_RUN: returns a synthetic fill record derived from the quote.
 * LIVE: builds + signs the Jupiter swap transaction and submits it on-chain.
 */
export async function executeSwap(
  quote: JupiterQuote,
  dryRun: boolean,
): Promise<{ signature: string | null; filled: boolean; note: string; outAmount?: string }> {
  if (dryRun) {
    return {
      signature: null,
      filled: true,
      outAmount: quote.outAmount,
      note: `dry-run fill at quoted outAmount=${quote.outAmount} (impact ${(Number(quote.priceImpactPct) * 100).toFixed(2)}%)`,
    };
  }

  const keypair = loadAgentKeypair();
  // Build the swap transaction with Jupiter (aggregator handles routing,
  // ATA creation and SOL wrapping); we only ever sign locally.
  const swapResponse = await postJson<{ swapTransaction: string }>(`${config.JUPITER_API_BASE}/swap`, {
    quoteResponse: quote,
    userPublicKey: keypair.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { priorityLevel: 'high', maxLamports: 1_000_000 } },
  });

  const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.swapTransaction, 'base64'));
  tx.sign([keypair]);

  const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  log.info({ signature }, 'jupiter swap submitted');
  await connection.confirmTransaction(signature, 'confirmed');
  return {
    signature,
    filled: true,
    outAmount: quote.outAmount,
    note: `live jupiter swap ${signature}`,
  };
}
