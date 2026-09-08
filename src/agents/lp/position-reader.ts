/**
 * On-chain LP position reading for the Healer.
 *
 * LIVE: reads the real DLMM position (bin bounds + active bin) via the
 * Meteora Data API and derives true in-range state. The position address is
 * resolved from the recorded entry intent (fill.positionAddress) written by
 * the Hunter at entry time; PnL comes from real position value when the API
 * exposes it.
 *
 * DRY_RUN (no position address recorded, or API failure): falls back to the
 * time-based simulation so the full decision ladder stays exercisable.
 */
import { fetchPosition, isInRange as meteoraIsInRange, type MeteoraPosition } from './meteora.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'lp-position-reader' });

export interface OnChainPositionState {
  inRange: boolean;
  source: 'on-chain' | 'simulated';
  pnlPct: number | null; // null → caller falls back to its own estimator
}

interface PositionIntentShape {
  fill?: { positionAddress?: string };
  bins?: [number, number];
  lowerBin?: number;
  upperBin?: number;
}

/**
 * Resolve the real position state. Requires the agent wallet address (the
 * position owner) and a recorded position address on the entry intent.
 */
export async function readOnChainState(
  ownerAddress: string | undefined,
  poolId: string | null,
  openedAt: string,
  intent: PositionIntentShape | null,
  simulatePnlPct: () => number,
): Promise<OnChainPositionState> {
  const positionAddress = intent?.fill?.positionAddress;
  if (!ownerAddress || !positionAddress) {
    return { inRange: simulateInRange(openedAt, intent), source: 'simulated', pnlPct: simulatePnlPct() };
  }
  try {
    const pos: MeteoraPosition = await fetchPosition(ownerAddress, positionAddress);
    const inRange = meteoraIsInRange(pos);
    return { inRange, source: 'on-chain', pnlPct: pos.positionValueUsd ?? simulatePnlPct() };
  } catch (err) {
    log.debug({ err, poolId, positionAddress }, 'on-chain position read failed — simulating');
    return { inRange: simulateInRange(openedAt, intent), source: 'simulated', pnlPct: simulatePnlPct() };
  }
}

/** Legacy simulation: out of range after ~40 minutes. */
function simulateInRange(openedAt: string, intent: PositionIntentShape | null): boolean {
  // If the entry recorded explicit bins we still can't know the active bin
  // without a pool read, so keep the time-based approximation.
  void intent;
  return minutesSince(openedAt) < 40;
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

export { loadAgentKeypairAddress };
import { loadAgentKeypair } from '../../executor/jupiter.js';

/**
 * The LP agent trades from the same Solana agent wallet as the meme agent;
 * its public key is the DLMM position owner.
 */
function loadAgentKeypairAddress(): string | undefined {
  try {
    return loadAgentKeypair().publicKey.toBase58();
  } catch {
    return undefined; // no key configured — dry-run mode
  }
}
