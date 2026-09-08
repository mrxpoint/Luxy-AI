/**
 * Portfolio state reader for risk checks.
 *
 * DRY_RUN: paper balance + realized PnL (simulated book) — unchanged.
 * LIVE: real equity = on-chain/exchange balances where the venue exposes it
 * (Hyperliquid account value incl. unrealized perps PnL, Solana agent-wallet
 * USDC), falling back to the paper basis only when no live source is
 * configured, so the 3% / 8% guards never operate on a zero basis.
 */
import { Connection } from '@solana/web3.js';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { USDC_MINT, loadAgentKeypair } from './jupiter.js';
import { fetchAccountValue } from '../agents/perps/hyperliquid.js';
import { logger } from '../utils/logger.js';
import type { PortfolioState } from '../types/index.js';

const log = logger.child({ module: 'portfolio' });

/** Best-effort real equity in USD; null when no live source is usable. */
async function liveEquityUsd(): Promise<number | null> {
  if (config.DRY_RUN) return null;
  let total = 0;
  let anySource = false;

  // Hyperliquid account value (includes unrealized perps PnL).
  if (config.HYPERLIQUID_WALLET_ADDRESS) {
    try {
      const v = await fetchAccountValue(config.HYPERLIQUID_WALLET_ADDRESS);
      if (v > 0) {
        total += v;
        anySource = true;
      }
    } catch {
      log.debug('hyperliquid account value unreachable');
    }
  }

  // Solana agent-wallet USDC balance (read via JSON RPC — no spl-token dep).
  if (config.SOLANA_PRIVATE_KEY) {
    try {
      const conn = new Connection(config.SOLANA_RPC_URL, 'confirmed');
      const owner = loadAgentKeypair().publicKey.toBase58();
      const res = await fetch(config.SOLANA_RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            owner,
            { mint: USDC_MINT },
            { encoding: 'jsonParsed' },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json()) as {
        result?: { value?: Array<{ account: { data: { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } } }> };
      };
      for (const acc of json.result?.value ?? []) {
        const amt = acc.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        total += amt;
        if (amt > 0) anySource = true;
      }
    } catch {
      log.debug('solana USDC balance unreachable');
    }
  }

  return anySource && total > 0 ? total : null;
}

export async function getPortfolioState(): Promise<PortfolioState> {
  const openRes = await query<{ n: number; open_usd: number }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(size_usd), 0)::float AS open_usd
     FROM positions WHERE status = 'open'`,
  );
  const openPositions = openRes.rows[0]?.n ?? 0;
  const openUsd = openRes.rows[0]?.open_usd ?? 0;

  const pnlRes = await query<{ pnl: number }>(
    `SELECT COALESCE(SUM(pnl_usd), 0)::float AS pnl
     FROM positions
     WHERE status = 'closed' AND closed_at >= date_trunc('day', NOW())`,
  );
  const todayRealizedPnlUsd = pnlRes.rows[0]?.pnl ?? 0;

  // LIVE: prefer real equity; fall back to the paper basis (never 0).
  const live = await liveEquityUsd();
  const basis = live ?? config.PAPER_PORTFOLIO_USD;
  if (live !== null) {
    log.debug({ liveEquityUsd: live }, 'live portfolio basis');
  }

  const portfolioUsd = basis + todayRealizedPnlUsd - openUsd;
  const startOfDayValue = basis;
  const dailyDrawdownPct =
    startOfDayValue > 0 ? Math.max(0, -todayRealizedPnlUsd / startOfDayValue) : 0;

  return { portfolioUsd, openPositions, todayRealizedPnlUsd, dailyDrawdownPct };
}
