/**
 * Executor — BullMQ intents worker (BLUEPRINT.md §2.2 / §5.2 / §7).
 *
 * The ONLY component allowed to open or close positions:
 *   intent → risk guard (hardcoded) → execute (dry-run or live)
 *          → positions DB → audit log → telegram notification.
 */
import { Worker, type Job } from 'bullmq';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { notify } from '../redis/queues.js';
import { logger } from '../utils/logger.js';
import type { LuxyIntent } from '../types/index.js';
import { runAllChecks } from './risk-guard.js';
import { getQuote, quoteSlippage, executeSwap, USDC_MINT, SOL_MINT } from './jupiter.js';
import { uniswapQuote, uniswapExecute, EVM_TOKENS, type UniswapQuote } from './uniswap.js';
import { hyperliquidExecute, fetchUserPositions } from '../agents/perps/hyperliquid.js';
import { robinhoodExecute } from './robinhood.js';
import { polymarketExecute } from '../agents/polymarket/executor.js';
const log = logger.child({ module: 'executor' });

const MINT_DECIMALS: Record<string, number> = {
  [SOL_MINT]: 9,
  [USDC_MINT]: 6,
};

type LuxyJob = LuxyIntent;

async function processIntent(job: Job<LuxyIntent>): Promise<{ status: string; note: string }> {
  const intent = job.data;
  log.info({ action: intent.action, agent: intent.agent, token: intent.token ?? intent.market }, 'processing intent');

  if (intent.action === 'hold') return { status: 'ignored', note: 'hold intent — no execution' };
  if (intent.action === 'alert') {
    await notify(`[ALERT] ${intent.reasoning}`, 'alert');
    return { status: 'notified', note: 'alert intent' };
  }

  // ---- Risk gate (hardcoded; blocks override everything) ----
  let estimatedSlippage = 0;
  if (intent.action === 'entry' && intent.chain === 'solana' && intent.sizeUsd) {
    const amountRaw = Math.round(intent.sizeUsd * 10 ** 6); // USDC (6dp) exact-in
    try {
      const quote = await getQuote(USDC_MINT, intent.token ?? SOL_MINT, amountRaw, Math.round(config.RISK_MAX_SLIPPAGE_PCT * 10_000));
      estimatedSlippage = quoteSlippage(quote);
      (intent as LuxyIntent & { _quote?: JupiterQuoteLite })._quote = {
        outAmount: quote.outAmount,
        inAmount: quote.inAmount,
        priceImpactPct: quote.priceImpactPct,
      };
    } catch (err) {
      log.warn({ err }, 'jupiter quote failed — proceeding with 0 slippage estimate (risk guard will still gate)');
    }
  }
  if (
    intent.action === 'entry' &&
    (intent.chain === 'base' || intent.chain === 'ethereum') &&
    intent.sizeUsd &&
    intent.token
  ) {
    // Real Uniswap v3 QuoterV2 ladder → genuine impact estimate for the guard.
    try {
      const q = await uniswapQuote(
        intent.chain,
        EVM_TOKENS[intent.chain].usdc,
        intent.token as `0x${string}`,
        BigInt(Math.round(intent.sizeUsd * 1e6)),
      );
      estimatedSlippage = q.priceImpactPct;
      (intent as LuxyIntent & { _uniQuote?: UniswapQuote })._uniQuote = q;
    } catch (err) {
      log.warn({ err }, 'uniswap quote failed — proceeding with 0 slippage estimate (risk guard will still gate)');
    }
  }

  const check = await runAllChecks(intent, estimatedSlippage);
  if (!check.allowed) {
    log.warn({ reason: check.reason }, 'risk guard blocked intent');
    await audit('risk-guard', 'risk_block', { intent, reason: check.reason });
    await notify(`[ALERT] Risk guard blocked: ${check.reason}`, 'alert');
    return { status: 'blocked', note: check.reason };
  }

  // ---- Execute per chain ----
  if (intent.action === 'entry') {
    if (intent.chain === 'hyperliquid') {
      const fill = await hyperliquidExecute(intent);
      await insertPosition(intent, null, fill.note);
    } else if (intent.chain === 'solana') {
      const amountRaw = Math.round((intent.sizeUsd ?? 0) * 10 ** 6);
      const quote = await getQuote(
        USDC_MINT,
        intent.token ?? SOL_MINT,
        amountRaw,
        Math.round(config.RISK_MAX_SLIPPAGE_PCT * 10_000),
      );
      const fill = await executeSwap(quote, config.DRY_RUN);
      await insertPosition(intent, fill.signature, fill.note, { outAmount: fill.outAmount });
    } else if (intent.chain === 'base' || intent.chain === 'ethereum') {
      // Phase 3: Uniswap v3 quoted path (dry-run simulated, live signed).
      const fill = await uniswapExecute({
        chain: intent.chain,
        tokenOut: intent.token as `0x${string}`,
        sizeUsd: intent.sizeUsd ?? 0,
        maxSlippagePct: config.RISK_MAX_SLIPPAGE_PCT,
        dryRun: config.DRY_RUN,
      });
      await insertPosition(intent, fill.txHash, fill.note, { outRaw: fill.outRaw });
    } else if (intent.chain === 'robinhood') {
      // Phase 3: Robinhood Crypto (Ed25519-signed; dry-run simulated).
      const fill = await robinhoodExecute(intent);
      await insertPosition(intent, fill.orderId, fill.note);
    } else if (intent.chain === 'polymarket') {
      // Phase 3: Polymarket CLOB (GTC/GTD; dry-run simulated, live signed).
      const fill = await polymarketExecute(intent);
      await insertPosition(intent, fill.orderId, fill.note, { shares: fill.shares });
    } else {
      await insertPosition(intent, null, 'dry-run fill (unhandled chain)');
    }
    await audit('executor', 'entry', { intent });
    await notify(
      `[ENTRY] Entered ${intent.symbol ?? intent.token ?? intent.market} (${intent.chain}) — $${(intent.sizeUsd ?? 0).toFixed(2)}${config.DRY_RUN ? ' [DRY-RUN]' : ''}`,
      'entry',
    );
    return { status: 'executed', note: 'entry recorded' };
  }

  if (intent.action === 'exit') {
    const closed = await executeLiveClose(intent);
    await audit('executor', 'exit', { intent, closed });
    if (closed) {
      await notify(
        `[EXIT] Closed ${closed.symbol ?? closed.token ?? 'position'} — PnL: ${closed.pnl_usd >= 0 ? '+' : ''}$${closed.pnl_usd.toFixed(2)} (${(closed.pnl_pct * 100).toFixed(1)}%)${config.DRY_RUN ? ' [DRY-RUN]' : ''}`,
        'exit',
      );
    }
    return { status: 'executed', note: closed ? 'position closed' : 'no matching open position' };
  }

  return { status: 'ignored', note: `unhandled action ${intent.action}` };
}

interface JupiterQuoteLite {
  outAmount: string;
  inAmount: string;
  priceImpactPct: string;
}

/** Fill metadata stashed on the position row for live exits. */
interface FillMeta {
  outAmount?: string; // solana: output token base units received at entry
  outRaw?: string; // evm: output token raw units received at entry
  shares?: number; // polymarket: shares bought at entry
}

async function insertPosition(
  intent: LuxyIntent,
  signature: string | null,
  note: string,
  fill?: FillMeta,
): Promise<void> {
  const quote = (intent as LuxyIntent & { _quote?: JupiterQuoteLite })._quote;
  const entryPrice = deriveEntryPrice(intent, quote);
  await query(
    `INSERT INTO positions (agent, chain, token, pool_id, side, status, size_usd, entry_price, tx_signature, dry_run, intent)
     VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10)`,
    [
      intent.agent,
      intent.chain,
      intent.token ?? null,
      intent.poolId ?? null,
      intent.side ?? null,
      intent.sizeUsd ?? 0,
      entryPrice,
      signature,
      config.DRY_RUN,
      JSON.stringify({ ...intent, executionNote: note, fill: fill ?? null }),
    ],
  );
  log.info({ note }, 'position opened');
}

function deriveEntryPrice(intent: LuxyIntent, quote?: JupiterQuoteLite): number | null {
  if (quote && intent.sizeUsd && Number(quote.outAmount) > 0) {
    // outAmount is in output-mint base units; price = usd in / token out (approx, decimals unknown here).
    return (intent.sizeUsd ?? 0) / (Number(quote.outAmount) / 1e6 || 1);
  }
  return null;
}

interface OpenPositionRow {
  id: number;
  chain: string;
  token: string | null;
  size_usd: number;
  entry_price: number | null;
  intent: { fill?: FillMeta } | null;
  symbol?: string | null;
}

async function findOpenPosition(intent: LuxyIntent): Promise<OpenPositionRow | null> {
  const res = await query<OpenPositionRow>(
    `SELECT p.id, p.chain, p.token, p.size_usd, p.entry_price, p.intent,
            (s.raw_data->>'baseToken'->>'symbol') AS symbol
     FROM positions p
     LEFT JOIN LATERAL (
       SELECT raw_data FROM signals WHERE token = p.token ORDER BY created_at DESC LIMIT 1
     ) s ON TRUE
     WHERE p.status = 'open' AND p.agent = $1 AND p.chain = $2
       AND ($3::text IS NULL OR p.token = $3)
     ORDER BY p.opened_at ASC
     LIMIT 1`,
    [intent.agent, intent.chain, intent.token ?? null],
  );
  return res.rows[0] ?? null;
}

async function markClosed(
  row: OpenPositionRow,
  pnlUsd: number,
  exitPrice: number | null,
): Promise<void> {
  const pnlPct = row.size_usd > 0 ? pnlUsd / row.size_usd : 0;
  await query(
    `UPDATE positions
     SET status = 'closed', exit_price = COALESCE($2, entry_price * (1 + $3)), pnl_usd = $4, pnl_pct = $3, closed_at = NOW()
     WHERE id = $1`,
    [row.id, exitPrice, pnlPct, pnlUsd],
  );
}

/**
 * Close a position. DRY_RUN: estimate PnL from the agent's reasoning hint
 * (existing behaviour). LIVE: close on the venue for real —
 *   hyperliquid → reduce-only IoC sized from the exchange position
 *   solana      → reverse Jupiter swap of the recorded entry output
 *   evm         → reverse Uniswap swap of the recorded entry output
 *   polymarket  → SELL the recorded shares at the live midpoint
 *   robinhood   → fail loud (USD-notional market sells cannot close an
 *                 exact position — handle manually until fill quantities
 *                 are recorded)
 */
async function executeLiveClose(
  intent: LuxyIntent,
): Promise<{ pnl_usd: number; pnl_pct: number; symbol?: string; token?: string } | null> {
  const row = await findOpenPosition(intent);
  if (!row) return null;

  if (config.DRY_RUN) {
    const pnlPct = estimateClosePnlPct(intent);
    const pnlUsd = row.size_usd * pnlPct;
    await markClosed(row, pnlUsd, null);
    return { pnl_usd: pnlUsd, pnl_pct: pnlPct, symbol: row.symbol ?? undefined, token: row.token ?? undefined };
  }

  // ---- LIVE close per venue ----
  if (row.chain === 'hyperliquid') {
    const coin = intent.market ?? row.token ?? undefined;
    if (!coin) throw new Error('live hyperliquid close: cannot resolve market');
    const before = await fetchUserPositions(config.HYPERLIQUID_WALLET_ADDRESS);
    const prior = before.find((p) => p.coin === coin);
    const fill = await hyperliquidExecute({ ...intent, action: 'exit', market: coin });
    if (!fill.filled) {
      return { pnl_usd: 0, pnl_pct: 0, symbol: row.symbol ?? undefined, token: row.token ?? undefined };
    }
    const avgPx = Number(fill.note.match(/filled [\d.]+ @ ([\d.]+)/)?.[1] ?? '0');
    const entryPx = prior?.entryPx ?? row.entry_price ?? 0;
    const szi = Math.abs(prior?.szi ?? 0);
    const pnlUsd = avgPx > 0 && entryPx > 0 && szi > 0 ? (avgPx - entryPx) * szi : row.size_usd * estimateClosePnlPct(intent);
    await markClosed(row, pnlUsd, avgPx > 0 ? avgPx : null);
    return { pnl_usd: pnlUsd, pnl_pct: row.size_usd > 0 ? pnlUsd / row.size_usd : 0, symbol: row.symbol ?? undefined, token: row.token ?? undefined };
  }

  if (row.chain === 'solana') {
    const outAmount = row.intent?.fill?.outAmount;
    if (!outAmount || !row.token) {
      throw new Error('live solana close: position lacks recorded entry output — close manually');
    }
    const quote = await getQuote(row.token, USDC_MINT, Number(outAmount), Math.round(config.RISK_MAX_SLIPPAGE_PCT * 10_000));
    const fill = await executeSwap(quote, false);
    const proceeds = Number(quote.outAmount) / 1e6; // USDC out, 6dp
    const pnlUsd = proceeds - row.size_usd;
    await markClosed(row, pnlUsd, null);
    log.info({ signature: fill.signature, proceeds }, 'live solana close swapped back to USDC');
    return { pnl_usd: pnlUsd, pnl_pct: row.size_usd > 0 ? pnlUsd / row.size_usd : 0, symbol: row.symbol ?? undefined, token: row.token ?? undefined };
  }

  if (row.chain === 'base' || row.chain === 'ethereum') {
    const outRaw = row.intent?.fill?.outRaw;
    if (!outRaw || !row.token) {
      throw new Error(`live ${row.chain} close: position lacks recorded entry output — close manually`);
    }
    const fill = await uniswapExecute({
      chain: row.chain,
      tokenOut: EVM_TOKENS[row.chain].usdc,
      tokenIn: row.token as `0x${string}`,
      amountInRaw: BigInt(outRaw),
      sizeUsd: row.size_usd,
      maxSlippagePct: config.RISK_MAX_SLIPPAGE_PCT,
      dryRun: false,
    });
    const proceeds = Number(fill.outRaw) / 1e6; // USDC out, 6dp
    const pnlUsd = proceeds - row.size_usd;
    await markClosed(row, pnlUsd, null);
    log.info({ txHash: fill.txHash, proceeds }, `live ${row.chain} close swapped back to USDC`);
    return { pnl_usd: pnlUsd, pnl_pct: row.size_usd > 0 ? pnlUsd / row.size_usd : 0, symbol: row.symbol ?? undefined, token: row.token ?? undefined };
  }

  if (row.chain === 'polymarket') {
    const shares = row.intent?.fill?.shares;
    if (!shares || shares <= 0) {
      throw new Error('live polymarket close: position lacks recorded share count — close manually');
    }
    const exitIntent: LuxyIntent & { shares?: number } = { ...intent, action: 'exit', side: 'short', shares };
    const fill = await polymarketExecute(exitIntent);
    const proceeds = shares * (Number(fill.note.match(/@ ([\d.]+)/)?.[1] ?? '0'));
    const pnlUsd = proceeds > 0 ? proceeds - row.size_usd : row.size_usd * estimateClosePnlPct(intent);
    await markClosed(row, pnlUsd, null);
    return { pnl_usd: pnlUsd, pnl_pct: row.size_usd > 0 ? pnlUsd / row.size_usd : 0, symbol: row.symbol ?? undefined, token: row.token ?? undefined };
  }

  throw new Error(
    `live close for chain "${row.chain}" is not automated (USD-notional venues need recorded fill quantities) — close manually, then resume dry-run`,
  );
}

function estimateClosePnlPct(intent: LuxyIntent): number {
  // The requesting agent supplies a hint in reasoning ("+16%") when known;
  // otherwise a neutral 0% is recorded for dry-run hygiene.
  const m = intent.reasoning.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  if (m) return Number(m[1]) / 100;
  return 0;
}

export async function startExecutorWorker(): Promise<Worker<LuxyIntent>> {
  const worker = new Worker<LuxyIntent>('intents', processIntent, {
    connection: { url: config.REDIS_URL },
    concurrency: 2,
  });
  worker.on('failed', (job, err) => {
    log.error({ err, jobId: job?.id }, 'intent processing failed');
  });
  log.info({ dryRun: config.DRY_RUN }, 'executor worker running on queue "intents"');
  return worker;
}
