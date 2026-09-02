/**
 * LP Agent — Hunter/Healer/HiveMind process (BLUEPRINT.md §6.3).
 *
 * Hunter loop (30 min): scan Meteora DLMM pools → top candidates become
 *   dry-run LP deploy intents on the intents queue.
 * Healer loop (10 min): monitor open LP positions, apply decision ladder.
 * HiveMind: lessons recorded on close (via executor PnL paths) and primed
 *   into Healer LLM confirmations.
 *
 * Run: pnpm dev:lp
 */
import { config } from '../../config/index.js';
import { intentQueue, notify } from '../../redis/queues.js';
import { audit } from '../../db/audit.js';
import { logger } from '../../utils/logger.js';
import type { LuxyIntent } from '../../types/index.js';
import { huntCandidates } from './hunter.js';
import { healOnce } from './healer.js';
import { recordLesson } from './hivemind.js';

const log = logger.child({ module: 'lp-agent' });

async function hunterCycle(): Promise<void> {
  const candidates = await huntCandidates();
  log.info({ found: candidates.length }, 'hunter cycle');
  for (const c of candidates.slice(0, 3)) {
    const intent: LuxyIntent = {
      action: 'entry',
      agent: 'lp',
      chain: 'solana',
      poolId: c.poolId,
      sizeUsd: 150,
      reasoning: `pool ${c.pairLabel}: feeTvl=${c.feeTvlRatio.toFixed(4)}, tvl=$${Math.round(c.tvlUsd)}, vol/tvl=${(c.volume24h / Math.max(c.tvlUsd, 1)).toFixed(2)}, binStep=${c.binStep}, organic=${c.organicScore.toFixed(2)}`,
      confidence: c.score,
      createdAt: new Date().toISOString(),
    };
    await intentQueue.add('intent', intent);
    await notify(
      `[LP] Deploy candidate ${c.pairLabel} — feeTvl ${c.feeTvlRatio.toFixed(4)}, TVL $${Math.round(c.tvlUsd / 1000)}k`,
      'lp',
    );
    await audit('lp-agent', 'pool_candidate', { candidate: c });
  }
}

async function healerCycle(): Promise<void> {
  await healOnce();
  log.debug('healer cycle done');
}

async function main(): Promise<void> {
  log.info(
    {
      hunterMin: config.LP_HUNTER_INTERVAL_MIN,
      healerMin: config.LP_HEALER_INTERVAL_MIN,
      dryRun: config.DRY_RUN,
    },
    'lp agent starting (Hunter/Healer/HiveMind)',
  );

  // Seed one HiveMind lesson so context priming is demonstrable from day one.
  await recordLesson({
    chain: 'solana',
    poolId: 'GENESIS',
    action: 'stay',
    outcomeSummary: 'system bootstrap — no lessons yet; conservative defaults active',
  }).catch(() => undefined);

  await hunterCycle().catch((err) => log.error({ err }, 'hunter cycle failed'));
  await healerCycle().catch((err) => log.error({ err }, 'healer cycle failed'));

  setInterval(() => hunterCycle().catch((err) => log.error({ err }, 'hunter cycle failed')),
    config.LP_HUNTER_INTERVAL_MIN * 60_000);
  setInterval(() => healerCycle().catch((err) => log.error({ err }, 'healer cycle failed')),
    config.LP_HEALER_INTERVAL_MIN * 60_000);
}

main().catch((err) => {
  log.fatal({ err }, 'lp agent crashed');
  process.exit(1);
});
