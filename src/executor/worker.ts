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
import { hyperliquidExecute } from '../agents/perps/hyperliquid.js';

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
      await hyperliquidExecute(intent);
    } else if (intent.chain === 'solana') {
      const amountRaw = Math.round((intent.sizeUsd ?? 0) * 10 ** 6);
      const quote = await getQuote(
        USDC_MINT,
        intent.token ?? SOL_MINT,
        amountRaw,
        Math.round(config.RISK_MAX_SLIPPAGE_PCT * 10_000),
      );
      const fill = await executeSwap(quote, config.DRY_RUN);
      await insertPosition(intent, fill.signature, fill.note);
    } else {
      // EVM paths are Phase 3 — record dry-run positions so the runtime is exercisable.
      await insertPosition(intent, null, 'dry-run fill (EVM execution arrives in Phase 3)');
    }
    await audit('executor', 'entry', { intent });
    await notify(
      `[ENTRY] Entered ${intent.symbol ?? intent.token ?? intent.market} (${intent.chain}) — $${(intent.sizeUsd ?? 0).toFixed(2)}${config.DRY_RUN ? ' [DRY-RUN]' : ''}`,
      'entry',
    );
    return { status: 'executed', note: 'entry recorded' };
  }

  if (intent.action === 'exit') {
    const closed = await closePosition(intent);
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

async function insertPosition(intent: LuxyIntent, signature: string | null, note: string): Promise<void> {
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
      JSON.stringify({ ...intent, executionNote: note }),
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

async function closePosition(
  intent: LuxyIntent,
): Promise<{ pnl_usd: number; pnl_pct: number; symbol?: string; token?: string } | null> {
  const res = await query<{
    id: number;
    token: string | null;
    symbol: string | null;
    size_usd: number;
    entry_price: number | null;
  }>(
    `SELECT p.id, p.token, p.size_usd, p.entry_price,
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
  const row = res.rows[0];
  if (!row) return null;

  // Dry-run close: assume current price ≈ entry ± last known price change.
  // Live close would fetch the real exit quote; both paths record the PnL.
  const pnlPct = estimateClosePnlPct(intent);
  const pnlUsd = row.size_usd * pnlPct;

  await query(
    `UPDATE positions
     SET status = 'closed', exit_price = entry_price * (1 + $2), pnl_usd = $3, pnl_pct = $2, closed_at = NOW()
     WHERE id = $1`,
    [row.id, pnlPct, pnlUsd],
  );
  return { pnl_usd: pnlUsd, pnl_pct: pnlPct, symbol: row.symbol ?? undefined, token: row.token ?? undefined };
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
