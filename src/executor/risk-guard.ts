/**
 * Risk Guard — hardcoded, LLM-proof (BLUEPRINT.md §7).
 *
 * This layer operates OUTSIDE LLM control. No reasoning chain, hallucination
 * or adversarial prompt can bypass it. Checks are applied in order:
 *   pause flag → daily drawdown kill switch → position size →
 *   concurrent positions → slippage.
 */
import type { LuxyIntent, RiskCheckResult } from '../types/index.js';
import { config } from '../config/index.js';
import { isPaused } from '../redis/connection.js';
import { getPortfolioState } from './portfolio.js';

function ok(reason = 'all risk checks passed'): RiskCheckResult {
  return { allowed: true, reason };
}
function block(reason: string): RiskCheckResult {
  return { allowed: false, reason };
}

export async function checkPause(): Promise<RiskCheckResult> {
  return (await isPaused()) ? block('executor paused via luxy:paused flag') : ok('not paused');
}

export async function checkDailyDrawdown(): Promise<RiskCheckResult> {
  const p = await getPortfolioState();
  return p.dailyDrawdownPct >= config.RISK_MAX_DAILY_DRAWDOWN_PCT
    ? block(
        `daily drawdown ${(p.dailyDrawdownPct * 100).toFixed(1)}% >= kill switch ${(config.RISK_MAX_DAILY_DRAWDOWN_PCT * 100).toFixed(0)}% — all new entries halted`,
      )
    : ok('drawdown within limits');
}

export async function checkPositionSize(intent: LuxyIntent): Promise<RiskCheckResult> {
  const p = await getPortfolioState();
  const size = intent.sizeUsd ?? 0;
  const maxSize = p.portfolioUsd * config.RISK_MAX_POSITION_PCT;
  if (intent.action === 'entry' && size > maxSize) {
    return block(
      `position size $${size.toFixed(2)} > max $${maxSize.toFixed(2)} (${(config.RISK_MAX_POSITION_PCT * 100).toFixed(0)}% of $${p.portfolioUsd.toFixed(2)})`,
    );
  }
  return ok('size within limits');
}

export async function checkConcurrentPositions(): Promise<RiskCheckResult> {
  const p = await getPortfolioState();
  return p.openPositions >= config.RISK_MAX_CONCURRENT_POSITIONS
    ? block(`open positions ${p.openPositions} >= max ${config.RISK_MAX_CONCURRENT_POSITIONS}`)
    : ok('concurrency within limits');
}

export function checkSlippage(estimatedSlippage: number): RiskCheckResult {
  return estimatedSlippage > config.RISK_MAX_SLIPPAGE_PCT
    ? block(
        `estimated slippage ${(estimatedSlippage * 100).toFixed(2)}% > cap ${(config.RISK_MAX_SLIPPAGE_PCT * 100).toFixed(0)}%`,
      )
    : ok('slippage within limits');
}

/** Full gate for an intent. Returns the first blocking reason. */
export async function runAllChecks(
  intent: LuxyIntent,
  estimatedSlippage = 0,
): Promise<RiskCheckResult> {
  const pause = await checkPause();
  if (!pause.allowed) return pause;

  if (intent.action === 'entry') {
    const dd = await checkDailyDrawdown();
    if (!dd.allowed) return dd;

    const size = await checkPositionSize(intent);
    if (!size.allowed) return size;

    const conc = await checkConcurrentPositions();
    if (!conc.allowed) return conc;

    const slip = checkSlippage(estimatedSlippage);
    if (!slip.allowed) return slip;
  }

  return ok();
}
