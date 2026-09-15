/**
 * On-chain LP position state reader for Healer (BLUEPRINT.md §6.3).
 * Falls back to time-based simulation when keys/address are missing.
 */
import { fetchPosition, isInRange as meteoraIsInRange, type MeteoraPosition } from './meteora.js';
import { loadAgentKeypair } from '../../executor/jupiter.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'lp-position-reader' });

export interface OnChainPositionState {
  inRange: boolean;
  source: 'on-chain' | 'simulated';
  pnlPct: number | null;
}

interface PositionIntentShape {
  fill?: { positionAddress?: string };
  bins?: [number, number];
  lowerBin?: number;
  upperBin?: number;
}

export function loadAgentKeypairAddress(): string | undefined {
  try {
    return loadAgentKeypair().publicKey.toBase58();
  } catch {
    return undefined;
  }
}

export async function readOnChainState(
  ownerAddress: string | undefined,
  poolId: string | null,
  openedAt: string,
  intent: PositionIntentShape | null,
  simulatePnlPct: () => number,
): Promise<OnChainPositionState> {
  const positionAddress = intent?.fill?.positionAddress;
  if (!ownerAddress || !positionAddress) {
    return { inRange: simulateInRange(openedAt), source: 'simulated', pnlPct: simulatePnlPct() };
  }
  try {
    const pos: MeteoraPosition = await fetchPosition(ownerAddress, positionAddress);
    const inRange = meteoraIsInRange(pos);
    return { inRange, source: 'on-chain', pnlPct: pos.positionValueUsd ?? simulatePnlPct() };
  } catch (err) {
    log.debug({ err, poolId, positionAddress }, 'on-chain position read failed — simulating');
    return { inRange: simulateInRange(openedAt), source: 'simulated', pnlPct: simulatePnlPct() };
  }
}

function simulateInRange(openedAt: string): boolean {
  return (Date.now() - new Date(openedAt).getTime()) / 60_000 < 40;
}
