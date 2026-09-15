/**
 * LP Agent — Hunter/Healer/HiveMind process (BLUEPRINT.md §6.3).
 *
 * Solana: Hunter loop (30 min) scans Meteora DLMM pools; Healer loop
 *   (10 min) monitors open LP positions, applying the decision ladder.
 * EVM (Phase 3, LP_EVM_ENABLED=true): same pattern over Uniswap v3 on
 *   Base/Ethereum with the gas cost optimizer gating every redeploy.
 * HiveMind: lessons recorded on close (via executor PnL paths) and primed
 *   into Healer LLM confirmations.
 *
 * Run: pnpm dev:lp
 */
import { config } from '../../config/index.js';
import { intentQueue, notify } from '../../redis/queues.js';
import { audit } from '../../db/audit.js';
import { logger } from '../../utils/logger.js';
import type { Chain, LuxyIntent } from '../../types/index.js';
import { huntCandidates } from './hunter.js';
import { healOnce } from './healer.js';
import { recordLesson } from './hivemind.js';
import { huntEvmCandidates } from './evm/hunter-evm.js';
import { healEvmOnce } from './evm/healer-evm.js';

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

/** Phase 3 EVM hunter — Uniswap v3 on Base/Ethereum. */
async function evmHunterCycle(): Promise<void> {
  const candidates = await huntEvmCandidates();
  log.info({ found: candidates.length }, 'evm hunter cycle');
  for (const c of candidates.slice(0, 2)) {
    const intent: LuxyIntent = {
      action: 'entry',
      agent: 'lp',
      chain: c.chain as Chain,
      poolId: c.poolId,
      sizeUsd: 100,
      reasoning: `uniswap v3 pool ${c.pairLabel}: feeTvl=${c.feeTvlRatio.toFixed(4)}, tvl=$${Math.round(c.tvlUsd)}, vol/tvl=${(c.volume24h / Math.max(c.tvlUsd, 1)).toFixed(2)}, feeTierBps=${c.binStep * 100}, organic=${c.organicScore.toFixed(2)}`,
      confidence: c.score,
      createdAt: new Date().toISOString(),
    };
    await intentQueue.add('intent', intent);
    await notify(
      `[LP] EVM candidate ${c.pairLabel} (${c.chain}) — feeTvl ${c.feeTvlRatio.toFixed(4)}, TVL $${Math.round(c.tvlUsd / 1000)}k`,
      'lp',
    );
    await audit('lp-agent', 'pool_candidate_evm', { candidate: c });
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
      evmEnabled: config.LP_EVM_ENABLED,
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
  if (config.LP_EVM_ENABLED) {
    await evmHunterCycle().catch((err) => log.error({ err }, 'evm hunter cycle failed'));
    await healEvmOnce().catch((err) => log.error({ err }, 'evm healer cycle failed'));
  }

  setInterval(() => hunterCycle().catch((err) => log.error({ err }, 'hunter cycle failed')),
    config.LP_HUNTER_INTERVAL_MIN * 60_000);
  setInterval(() => healerCycle().catch((err) => log.error({ err }, 'healer cycle failed')),
    config.LP_HEALER_INTERVAL_MIN * 60_000);
  if (config.LP_EVM_ENABLED) {
    setInterval(() => evmHunterCycle().catch((err) => log.error({ err }, 'evm hunter cycle failed')),
      config.LP_HUNTER_INTERVAL_MIN * 60_000);
    setInterval(() => healEvmOnce().catch((err) => log.error({ err }, 'evm healer cycle failed')),
      config.LP_HEALER_INTERVAL_MIN * 60_000);
  }
}

main().catch((err) => {
  log.fatal({ err }, 'lp agent crashed');
  process.exit(1);
});
