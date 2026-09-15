/**
 * Perps position monitor — enforces TP/SL at the bot layer (BLUEPRINT §6.4).
 * Exit when unrealized PnL < -8% OR > +15%. These exits are intents the
 * executor still risk-checks, but they are computed deterministically here.
 */
import { config } from '../../config/index.js';
import { intentQueue } from '../../redis/queues.js';
import { fetchUserPositions } from './hyperliquid.js';
import { PERPS_EXIT_LOSS_PCT, PERPS_EXIT_PROFIT_PCT } from './signals.js';
import { logger } from '../../utils/logger.js';
import type { LuxyIntent } from '../../types/index.js';

const log = logger.child({ module: 'perps-monitor' });

export async function monitorPositions(): Promise<number> {
  if (!config.HYPERLIQUID_WALLET_ADDRESS) return 0;
  const positions = await fetchUserPositions(config.HYPERLIQUID_WALLET_ADDRESS);
  let exits = 0;

  for (const p of positions) {
    if (p.szi === 0) continue;
    const side: 'long' | 'short' = p.szi > 0 ? 'long' : 'short';
    // returnOnEquity is leverage-included ROE; approximate price move via pnl/notional
    const pnlPct = p.entryPx > 0 ? (side === 'long' ? 1 : -1) * (p.unrealizedPnl / (Math.abs(p.szi) * p.entryPx)) : 0;

    const shouldExit = pnlPct <= PERPS_EXIT_LOSS_PCT || pnlPct >= PERPS_EXIT_PROFIT_PCT;
    if (!shouldExit) continue;

    const intent: LuxyIntent = {
      action: 'exit',
      agent: 'perps',
      chain: 'hyperliquid',
      market: p.coin,
      side,
      reasoning: `deterministic exit: pnl ${(pnlPct * 100).toFixed(1)}% crossed threshold [SL ${(PERPS_EXIT_LOSS_PCT * 100).toFixed(0)}% / TP +${(PERPS_EXIT_PROFIT_PCT * 100).toFixed(0)}%]`,
      confidence: 1,
      createdAt: new Date().toISOString(),
    };
    await intentQueue.add('intent', intent);
    exits++;
    log.info({ market: p.coin, pnlPct }, 'exit intent emitted by monitor');
  }
  return exits;
}
