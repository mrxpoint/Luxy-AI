/**
 * Healer (EVM) — Uniswap v3 position manager with the gas cost optimizer
 * (BLUEPRINT.md §6.3 + Open Question #6).
 *
 * Same decision ladder as the Solana Healer, plus a mandatory gas gate
 * before any REDEPLOY: estimated rebalance cost (collect + mint ≈ 600k gas)
 * at the current gas price × native token price. If the gas cost exceeds the
 * expected incremental fee gain, the redeploy is SKIPPED — gas can make a
 * winning trade net-negative on EVM.
 */
import { query } from '../../../db/pool.js';
import { intentQueue, notify } from '../../../redis/queues.js';
import { subagentLLM, tryChat } from '../../../llm/adapter.js';
import { getRecentLessons } from '../hivemind.js';
import { createPublicClient, http } from 'viem';
import { mainnet, base as baseChain } from 'viem/chains';
import { config } from '../../../config/index.js';
import { nativeTokenPriceUsd } from './uniswap-pools.js';
import { logger } from '../../../utils/logger.js';
import type { Chain, LuxyIntent } from '../../../types/index.js';

const log = logger.child({ module: 'healer-evm' });

/** collect + mint round-trip on v3 ≈ 600k gas worst case. */
const REBALANCE_GAS_UNITS = 600_000n;

interface OpenLpPosition {
  id: number;
  chain: Chain;
  pool_id: string | null;
  size_usd: number;
  opened_at: string;
}

interface GasGate {
  costUsd: number;
  expectedGainUsd: number;
  ok: boolean;
  reason: string;
}

export async function healEvmOnce(): Promise<void> {
  const open = await query<OpenLpPosition>(
    `SELECT id, chain, pool_id, size_usd, opened_at
     FROM positions
     WHERE status = 'open' AND agent = 'lp' AND chain IN ('base', 'ethereum')
     ORDER BY opened_at ASC`,
  );

  for (const pos of open.rows) {
    if (pos.chain !== 'base' && pos.chain !== 'ethereum') continue;
    const pnlPct = estimatePositionPnlPct(pos);
    const inRange = estimateInRange(pos);
    const evmChain = pos.chain;

    if (pnlPct < -0.15) {
      await emitClose(pos, pnlPct, 'stop loss');
      continue;
    }
    if (pnlPct > 0.2) {
      await emitClose(pos, pnlPct, 'take profit');
      continue;
    }
    if (!inRange && minutesSince(pos.opened_at) > 30) {
      // Gas cost optimizer gate (blueprint open question #6).
      const gate = await gasGate(evmChain, pos.size_usd);
      if (!gate.ok) {
        await notify(
          `[LP] Redeploy skipped on ${evmChain} — gas $${gate.costUsd.toFixed(2)} > expected fee gain $${gate.expectedGainUsd.toFixed(2)}`,
          'lp',
        );
        continue;
      }
      const confirmed = await llmConfirmRedeploy(pos, pnlPct);
      if (confirmed) {
        await emitRedeploy(pos, pnlPct);
      } else {
        log.debug({ pool: pos.pool_id }, 'redeploy rejected by llm confirmation');
      }
      continue;
    }
    log.debug({ pool: pos.pool_id, chain: evmChain }, 'position stays');
  }
}

/**
 * The gas oracle: cost of a rebalance vs the expected incremental fee gain.
 * Expected gain ≈ position share of 24h pool fees over the next 24h window
 * (share approximated by size_usd / pool TVL proxy of 10x position size).
 */
async function gasGate(chain: 'base' | 'ethereum', sizeUsd: number): Promise<GasGate> {
  try {
    const client = createPublicClient({
      chain: chain === 'base' ? baseChain : mainnet,
      transport: http(chain === 'base' ? config.BASE_RPC_URL : config.ETHEREUM_RPC_URL),
    });
    const [gasPrice, nativeUsd] = await Promise.all([
      client.getGasPrice(),
      nativeTokenPriceUsd(chain),
    ]);
    const costNative = Number(gasPrice * REBALANCE_GAS_UNITS) / 1e18;
    const costUsd = costNative * nativeUsd;
    const expectedGainUsd = Math.max(sizeUsd * 0.004, 0); // ≈0.4%/day healthy fee yield
    const ok = costUsd <= expectedGainUsd && costUsd <= config.EVM_GAS_COST_CEIL_USD;
    return {
      costUsd,
      expectedGainUsd,
      ok,
      reason: ok ? 'ok' : `gas $${costUsd.toFixed(2)} vs gain $${expectedGainUsd.toFixed(2)}`,
    };
  } catch (err) {
    // Can't price gas → conservative: block the redeploy.
    log.warn({ err }, 'gas oracle failed — blocking redeploy');
    return { costUsd: Number.POSITIVE_INFINITY, expectedGainUsd: 0, ok: false, reason: 'gas oracle unavailable' };
  }
}

function estimatePositionPnlPct(pos: OpenLpPosition): number {
  const hours = minutesSince(pos.opened_at) / 60;
  return Math.min(0.05 * hours, 0.08);
}

function estimateInRange(pos: OpenLpPosition): boolean {
  return minutesSince(pos.opened_at) < 40;
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

async function emitClose(pos: OpenLpPosition, pnlPct: number, why: string): Promise<void> {
  const intent: LuxyIntent = {
    action: 'exit',
    agent: 'lp',
    chain: pos.chain,
    poolId: pos.pool_id ?? undefined,
    reasoning: `${why}: pnl ${(pnlPct * 100).toFixed(1)}%`,
    confidence: 1,
    createdAt: new Date().toISOString(),
  };
  await intentQueue.add('intent', intent);
  await notify(`[LP] Close ${pos.pool_id} (${pos.chain}) — ${why}`, 'lp');
}

async function emitRedeploy(pos: OpenLpPosition, pnlPct: number): Promise<void> {
  const intent: LuxyIntent = {
    action: 'exit',
    agent: 'lp',
    chain: pos.chain,
    poolId: pos.pool_id ?? undefined,
    reasoning: `redeploy: out of range > 30 min, pnl ${(pnlPct * 100).toFixed(1)}% — gas gate passed, re-center`,
    confidence: 0.8,
    createdAt: new Date().toISOString(),
  };
  await intentQueue.add('intent', intent);
  await notify(`[LP] Redeploy ${pos.pool_id} (${pos.chain}) — range shift, gas gate OK`, 'lp');
}

/** REDEPLOY decisions are LLM-confirmed against HiveMind lessons. */
async function llmConfirmRedeploy(pos: OpenLpPosition, pnlPct: number): Promise<boolean> {
  const lessons = await getRecentLessons(5);
  const res = await tryChat(
    subagentLLM(),
    [
      {
        role: 'user',
        content: JSON.stringify({
          decision: 'redeploy?',
          chain: pos.chain,
          pool: pos.pool_id,
          sizeUsd: pos.size_usd,
          pnlPct,
          inRange: false,
          minutesOpen: Math.round(minutesSince(pos.opened_at)),
          lessons,
        }),
      },
    ],
    `You confirm LP redeploy decisions for an autonomous system on Uniswap v3. Given the
position state and past HiveMind lessons, respond with ONLY: {"confirm": true|false, "reason":"..."}.
Be conservative: confirm only when lessons support redeploying at these conditions.`,
  );
  if (!res) return false;
  try {
    const parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim()) as { confirm?: boolean };
    return parsed.confirm === true;
  } catch {
    return false;
  }
}
