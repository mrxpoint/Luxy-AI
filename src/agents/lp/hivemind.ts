/**
 * HiveMind — persistent cross-session learning (BLUEPRINT.md §6.3).
 *
 * Structured lessons from every closed LP position are stored in
 * lp_lessons and primed into the Healer/Luxy context. Every 5 closed
 * positions the winner/loser distribution nudges scoring thresholds
 * toward optimal values (capped at 20% change per step).
 */
import { query } from '../../db/pool.js';
import { audit } from '../../db/audit.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'hivemind' });

export interface LpLessonInput {
  chain: string;
  poolId: string;
  action: 'stay' | 'close' | 'redeploy';
  feeTvlRatio?: number;
  yieldRealized?: number;
  rangeShiftReason?: string;
  gasCostAtAction?: number;
  outcomeSummary: string;
}

export async function recordLesson(l: LpLessonInput): Promise<void> {
  await query(
    `INSERT INTO lp_lessons (chain, pool_id, action, fee_tvl_ratio, yield_realized, range_shift_reason, gas_cost_at_action, outcome_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      l.chain,
      l.poolId,
      l.action,
      l.feeTvlRatio ?? null,
      l.yieldRealized ?? null,
      l.rangeShiftReason ?? null,
      l.gasCostAtAction ?? null,
      l.outcomeSummary,
    ],
  );
  log.info({ pool: l.poolId, action: l.action }, 'lesson recorded');
  await audit('lp-agent', 'hivemind_lesson', l);
}

export async function getRecentLessons(limit = 10): Promise<string[]> {
  try {
    const res = await query<{
      pool_id: string;
      action: string;
      fee_tvl_ratio: number | null;
      yield_realized: number | null;
      outcome_summary: string | null;
    }>(
      `SELECT pool_id, action, fee_tvl_ratio, yield_realized, outcome_summary
       FROM lp_lessons ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => {
      const outcome = /good|profit|\+/.test(r.outcome_summary ?? '') ? 'Good' : 'Review';
      return `[HIVEMIND] Pool ${r.pool_id}: ${r.action.toUpperCase()} — yield=${((r.yield_realized ?? 0) * 100).toFixed(2)}%, feeTvl=${(r.fee_tvl_ratio ?? 0).toFixed(3)} — ${r.outcome_summary ?? ''} ${outcome === 'Good' ? '✓ good decision at these conditions' : ''}`;
    });
  } catch {
    return [];
  }
}

export interface HealerThresholds {
  stopLossPct: number; // -0.15
  takeProfitPct: number; // +0.20
  outOfRangeMin: number; // 30
  minFeeTvl: number; // 0.05
}

export const DEFAULT_THRESHOLDS: HealerThresholds = {
  stopLossPct: -0.15,
  takeProfitPct: 0.2,
  outOfRangeMin: 30,
  minFeeTvl: 0.05,
};

/**
 * Threshold evolution: every 5 closed lessons, nudge thresholds toward the
 * distribution of winners (BLUEPRINT §6.3), capped at ±20% per step.
 */
export async function evolveThresholds(): Promise<HealerThresholds> {
  try {
    const countRes = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM lp_lessons WHERE action IN ('close','redeploy')`,
    );
    const closed = countRes.rows[0]?.n ?? 0;
    if (closed === 0 || closed % 5 !== 0) return DEFAULT_THRESHOLDS;

    const win = await query<{ wr: number }>(
      `SELECT COALESCE(AVG(CASE WHEN yield_realized > 0 THEN 1.0 ELSE 0.0 END), 0)::float AS wr
       FROM lp_lessons WHERE action IN ('close','redeploy')`,
    );
    const winRate = win.rows[0]?.wr ?? 0.5;

    // Losing more than winning → tighten stop by up to 20%.
    // Winning a lot → allow more room (loosen stop) up to 20%.
    const drift = (winRate - 0.5) * 0.4; // ±0.2 max
    const evolved: HealerThresholds = {
      ...DEFAULT_THRESHOLDS,
      stopLossPct: clamp(DEFAULT_THRESHOLDS.stopLossPct * (1 - drift), -0.30, -0.08),
    };
    await audit('lp-agent', 'threshold_evolution', { winRate, evolved });
    log.info({ winRate, evolved }, 'hivemind thresholds evolved');
    return evolved;
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
