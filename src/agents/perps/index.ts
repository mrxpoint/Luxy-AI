/**
 * Perps Agent — process entrypoint (BLUEPRINT.md §6.4).
 * 15-minute loop: scan 10 markets → strong signals become entry intents
 * directly on the intents queue; then the position monitor checks TP/SL.
 * Run: pnpm dev:perps
 */
import { config } from '../../config/index.js';
import { intentQueue, notify } from '../../redis/queues.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../../db/audit.js';
import type { LuxyIntent } from '../../types/index.js';
import { scanAllMarkets, PERPS_MAX_TRADE_USD, perpsDryRunFlag } from './signals.js';
import { monitorPositions } from './monitor.js';

const log = logger.child({ module: 'perps-agent' });

const SIGNAL_THRESHOLD = 0.6;

async function cycle(): Promise<void> {
  const signals = await scanAllMarkets();
  log.info({ scanned: signals.length }, 'perps scan done');

  for (const s of signals) {
    if (s.direction === 'neutral' || s.score < SIGNAL_THRESHOLD) continue;

    const intent: LuxyIntent = {
      action: 'entry',
      agent: 'perps',
      chain: 'hyperliquid',
      market: s.market,
      side: s.direction,
      sizeUsd: PERPS_MAX_TRADE_USD,
      reasoning: `momentum24h=${(s.momentum24h * 100).toFixed(1)}%, price ${s.price > s.sma12h ? 'above' : 'below'} SMA12, vol=${(s.volatility * 100).toFixed(2)}%/bar`,
      confidence: s.score,
      createdAt: new Date().toISOString(),
    };
    await intentQueue.add('intent', intent);
    await audit('perps-agent', 'signal_emitted', { signal: s, intent });
    await notify(
      `[SIGNAL] ${s.market} ${s.direction.toUpperCase()} score=${s.score.toFixed(2)} — momentum ${(s.momentum24h * 100).toFixed(1)}%/24h`,
      'signal',
    );
  }

  const exits = await monitorPositions();
  log.info({ exits }, 'perps cycle complete');
}

async function main(): Promise<void> {
  log.info({ intervalMin: config.PERPS_INTERVAL_MIN, dryRun: perpsDryRunFlag() }, 'perps agent starting');
  await cycle().catch((err) => log.error({ err }, 'perps cycle failed'));
  setInterval(() => {
    cycle().catch((err) => log.error({ err }, 'perps cycle failed'));
  }, config.PERPS_INTERVAL_MIN * 60_000);
}

main().catch((err) => {
  log.fatal({ err }, 'perps agent crashed');
  process.exit(1);
});
