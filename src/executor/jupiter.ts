/**
 * Jupiter v6 swap client (BLUEPRINT.md §9.1).
 *
 * quote   GET  {base}/quote?inputMint&outputMint&amount&slippageBps
 * swap    POST {base}/swap  (unsigned tx built by Jupiter; signed locally)
 *
 * In DRY_RUN no transaction is ever built or sent — fills are simulated at
 * the quoted price with the quoted slippage so PnL accounting behaves
 * realistically.
 */
import { config } from '../config/index.js';
import { getJson } from '../utils/http.js';

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

/**
 * Simulated or real execution.
 * DRY_RUN: returns a synthetic fill record derived from the quote.
 * LIVE: (Phase 1 stub — requires funded keypair; guarded, never silent.)
 */
export async function executeSwap(
  quote: JupiterQuote,
  dryRun: boolean,
): Promise<{ signature: string | null; filled: boolean; note: string }> {
  if (dryRun) {
    return {
      signature: null,
      filled: true,
      note: `dry-run fill at quoted outAmount=${quote.outAmount} (impact ${(Number(quote.priceImpactPct) * 100).toFixed(2)}%)`,
    };
  }
  // Live swap requires building + signing the Jupiter swap transaction with
  // the agent wallet keypair (sops-encrypted secret). Deliberately left as a
  // hard stop so an accidental DRY_RUN=false without key management in place
  // can never move funds.
  throw new Error(
    'live Jupiter swap not enabled in this build — provision wallets and enable signing first',
  );
}
