/**
 * Healer — LP position manager (BLUEPRINT.md §6.3).
 * Monitors open LP positions every 10 minutes and applies the decision
 * ladder in order; REDEPLOY decisions are LLM-confirmed with HiveMind
 * lessons in context. In dry-run, "positions" are simulated from any open
 * lp rows so the full loop is exercisable without Meteora SDK deposits.
 */
import { query } from '../../db/pool.js';
import { intentQueue, notify } from '../../redis/queues.js';
import { subagentLLM, tryChat } from '../../llm/adapter.js';
import { getRecentLessons, evolveThresholds, type HealerThresholds } from './hivemind.js';
import { logger } from '../../utils/logger.js';
import type { LuxyIntent } from '../../types/index.js';

const log = logger.child({ module: 'healer' });

interface OpenLpPosition {
  id: number;
  pool_id: string | null;
  size_usd: number;
  opened_at: string;
  intent: { bins?: [number, number]; lowerBin?: number; upperBin?: number } | null;
}

export async function healOnce(): Promise<void> {
  const thresholds = await evolveThresholds();
  const open = await query<OpenLpPosition>(
    `SELECT id, pool_id, size_usd, opened_at, intent
     FROM positions
     WHERE status = 'open' AND agent = 'lp' AND chain = 'solana'
     ORDER BY opened_at ASC`,
  );

  for (const pos of open.rows) {
    const pnlPct = await estimatePositionPnlPct(pos);
    const inRange = estimateInRange(pos);

    // Decision ladder, in order (BLUEPRINT §6.3):
    if (pnlPct < thresholds.stopLossPct) {
      await emitClose(pos, pnlPct, 'stop loss');
      continue;
    }
    if (feeYieldHealthy(pos, thresholds) && inRange) {
      await noteStay(pos);
      continue;
    }
    if (!inRange && minutesSince(pos.opened_at) > thresholds.outOfRangeMin) {
      const confirmed = await llmConfirmRedeploy(pos, pnlPct, inRange);
      if (confirmed) {
        await emitRedeploy(pos, pnlPct);
      } else {
        await noteStay(pos, 'redeploy rejected by llm confirmation');
      }
      continue;
    }
    if (pnlPct > thresholds.takeProfitPct) {
      await emitClose(pos, pnlPct, 'take profit');
      continue;
    }
    await noteStay(pos);
  }
}

// --- helpers ----------------------------------------------------------------

function estimatePositionPnlPct(pos: OpenLpPosition): number {
  // Dry-run estimation: fees accrue ~0.05%/h at healthy feeTvl; IL ignored.
  const hours = minutesSince(pos.opened_at) / 60;
  return Math.min(0.05 * hours, 0.08);
}

function estimateInRange(pos: OpenLpPosition): boolean {
  // Simulated range drift: out of range after ~40 minutes in dry-run.
  return minutesSince(pos.opened_at) < 40;
}

function feeYieldHealthy(pos: OpenLpPosition, t: HealerThresholds): boolean {
  const hours = Math.max(minutesSince(pos.opened_at) / 60, 0.1);
  const yieldPct = estimatePositionPnlPct(pos);
  return yieldPct / hours > t.minFeeTvl / 24;
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

async function emitClose(pos: OpenLpPosition, pnlPct: number, why: string): Promise<void> {
  const intent: LuxyIntent = {
    action: 'exit',
    agent: 'lp',
    chain: 'solana',
    poolId: pos.pool_id ?? undefined,
    reasoning: `${why}: pnl ${(pnlPct * 100).toFixed(1)}%`,
    confidence: 1,
    createdAt: new Date().toISOString(),
  };
  await intentQueue.add('intent', intent);
  await notify(`[LP] Close ${pos.pool_id} — ${why} (${(pnlPct * 100).toFixed(1)}%)`, 'lp');
  log.info({ pool: pos.pool_id, why }, 'close intent emitted');
}

async function emitRedeploy(pos: OpenLpPosition, pnlPct: number): Promise<void> {
  const intent: LuxyIntent = {
    action: 'exit',
    agent: 'lp',
    chain: 'solana',
    poolId: pos.pool_id ?? undefined,
    reasoning: `redeploy: out of range > threshold, pnl ${(pnlPct * 100).toFixed(1)}% — close and re-center`,
    confidence: 0.8,
    createdAt: new Date().toISOString(),
  };
  await intentQueue.add('intent', intent);
  await notify(`[LP] Redeploy ${pos.pool_id} — range shift detected`, 'lp');
  log.info({ pool: pos.pool_id }, 'redeploy intent emitted');
}

async function noteStay(pos: OpenLpPosition, why = 'healthy and in-range'): Promise<void> {
  log.debug({ pool: pos.pool_id, why }, 'position stays');
}

/** REDEPLOY decisions are LLM-confirmed against HiveMind lessons. */
async function llmConfirmRedeploy(pos: OpenLpPosition, pnlPct: number, inRange: boolean): Promise<boolean> {
  const lessons = await getRecentLessons(5);
  const res = await tryChat(
    subagentLLM(),
    [
      {
        role: 'user',
        content: JSON.stringify({
          decision: 'redeploy?',
          pool: pos.pool_id,
          sizeUsd: pos.size_usd,
          pnlPct,
          inRange,
          minutesOpen: Math.round(minutesSince(pos.opened_at)),
          lessons,
        }),
      },
    ],
    `You confirm LP redeploy decisions for an autonomous system. Given the position
state and past HiveMind lessons, respond with ONLY: {"confirm": true|false, "reason":"..."}.
Be conservative: confirm only when lessons support redeploying at these conditions.`,
  );
  if (!res) return false; // fail-safe: no confirmation → stay
  try {
    const parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim()) as { confirm?: boolean };
    return parsed.confirm === true;
  } catch {
    return false;
  }
}
