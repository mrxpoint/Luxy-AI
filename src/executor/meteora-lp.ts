/**
 * Meteora DLMM LP deploy / close (BLUEPRINT.md §6.3).
 *
 * LIVE path uses @meteora-ag/dlmm (optional dependency):
 *   pnpm add @meteora-ag/dlmm bn.js
 *
 * DRY_RUN simulates a position address + bin range without sending txs.
 * Failures are loud — never silent no-ops on LIVE.
 */
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { config } from '../config/index.js';
import { loadAgentKeypair } from './jupiter.js';
import { logger } from '../utils/logger.js';
import type { LuxyIntent } from '../types/index.js';

const log = logger.child({ module: 'meteora-lp' });

export interface LpDeployResult {
  signature: string | null;
  positionAddress: string;
  lowerBin: number;
  upperBin: number;
  note: string;
  dryRun: boolean;
}

const DEFAULT_BIN_RANGE = 10; // bins each side of active

export async function deployDlmmPosition(intent: LuxyIntent): Promise<LpDeployResult> {
  const poolId = intent.poolId;
  if (!poolId) throw new Error('LP deploy requires intent.poolId');

  const sizeUsd = intent.sizeUsd ?? 0;
  if (sizeUsd <= 0) throw new Error('LP deploy requires positive sizeUsd');

  if (config.DRY_RUN) {
    const positionAddress = `dry_lp_${poolId.slice(0, 8)}_${Date.now()}`;
    const mid = 0;
    return {
      signature: null,
      positionAddress,
      lowerBin: mid - DEFAULT_BIN_RANGE,
      upperBin: mid + DEFAULT_BIN_RANGE,
      note: `dry-run DLMM deploy pool=${poolId} size=$${sizeUsd.toFixed(2)}`,
      dryRun: true,
    };
  }

  // LIVE
  let DLMM: any;
  let StrategyType: any;
  let BN: any;
  try {
    const mod = await import('@meteora-ag/dlmm');
    DLMM = mod.default ?? mod;
    StrategyType = mod.StrategyType ?? mod.default?.StrategyType;
    BN = (await import('bn.js')).default;
  } catch (err) {
    throw new Error(
      'LIVE LP deploy requires @meteora-ag/dlmm and bn.js — run: pnpm add @meteora-ag/dlmm bn.js',
    );
  }

  const user = loadAgentKeypair();
  const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
  const poolPk = new PublicKey(poolId);
  const pool = await DLMM.create(connection, poolPk, { cluster: 'mainnet-beta' });

  const activeBin = await pool.getActiveBin();
  const minBinId = activeBin.binId - DEFAULT_BIN_RANGE;
  const maxBinId = activeBin.binId + DEFAULT_BIN_RANGE;

  // Split notional roughly 50/50 in raw units using token decimals when available
  const halfUsd = sizeUsd / 2;
  // Prefer Y (often stable) as USDC-like 6 decimals; X as 9 if unknown
  const totalXAmount = new BN(Math.max(1, Math.round(halfUsd * 1e6)));
  const totalYAmount = new BN(Math.max(1, Math.round(halfUsd * 1e6)));

  const position = Keypair.generate();
  const tx = await pool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: position.publicKey,
    user: user.publicKey,
    totalXAmount,
    totalYAmount,
    strategy: {
      minBinId,
      maxBinId,
      strategyType: StrategyType?.Spot ?? 0,
    },
    slippage: Math.round(config.RISK_MAX_SLIPPAGE_PCT * 10_000),
  });

  // tx may be Transaction or Transaction[] depending on SDK version
  const txs = Array.isArray(tx) ? tx : [tx];
  let lastSig: string | null = null;
  for (const t of txs) {
    lastSig = await sendAndConfirmTransaction(connection, t, [user, position], {
      commitment: 'confirmed',
      skipPreflight: false,
    });
  }

  log.info(
    { poolId, position: position.publicKey.toBase58(), sig: lastSig, minBinId, maxBinId },
    'DLMM position deployed',
  );

  return {
    signature: lastSig,
    positionAddress: position.publicKey.toBase58(),
    lowerBin: minBinId,
    upperBin: maxBinId,
    note: `live DLMM deploy position=${position.publicKey.toBase58()} bins=[${minBinId},${maxBinId}]`,
    dryRun: false,
  };
}

/**
 * Remove liquidity / close LP position when SDK is available.
 * DRY_RUN marks success without chain interaction.
 */
export async function closeDlmmPosition(input: {
  poolId: string;
  positionAddress: string;
}): Promise<{ signature: string | null; note: string; dryRun: boolean }> {
  if (config.DRY_RUN) {
    return {
      signature: null,
      note: `dry-run DLMM close position=${input.positionAddress}`,
      dryRun: true,
    };
  }

  let DLMM: any;
  try {
    const mod = await import('@meteora-ag/dlmm');
    DLMM = mod.default ?? mod;
  } catch {
    throw new Error(
      'LIVE LP close requires @meteora-ag/dlmm — run: pnpm add @meteora-ag/dlmm bn.js',
    );
  }

  const user = loadAgentKeypair();
  const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
  const pool = await DLMM.create(connection, new PublicKey(input.poolId), {
    cluster: 'mainnet-beta',
  });

  // Prefer removeAllLiquidity + closePosition when present
  const positionPubKey = new PublicKey(input.positionAddress);
  let signature: string | null = null;

  if (typeof pool.removeLiquidity === 'function') {
    try {
      const removeTx = await pool.removeLiquidity({
        user: user.publicKey,
        position: positionPubKey,
        fromBinId: undefined,
        toBinId: undefined,
        bps: 10_000, // 100%
        shouldClaimAndClose: true,
      });
      const txs = Array.isArray(removeTx) ? removeTx : [removeTx];
      for (const t of txs) {
        signature = await sendAndConfirmTransaction(connection, t, [user], {
          commitment: 'confirmed',
        });
      }
      return {
        signature,
        note: `live DLMM close position=${input.positionAddress}`,
        dryRun: false,
      };
    } catch (err) {
      log.warn({ err }, 'removeLiquidity path failed — try closePosition');
    }
  }

  if (typeof pool.closePosition === 'function') {
    const closeTx = await pool.closePosition({
      owner: user.publicKey,
      position: positionPubKey,
    });
    const txs = Array.isArray(closeTx) ? closeTx : [closeTx];
    for (const t of txs) {
      signature = await sendAndConfirmTransaction(connection, t, [user], {
        commitment: 'confirmed',
      });
    }
    return {
      signature,
      note: `live DLMM closePosition position=${input.positionAddress}`,
      dryRun: false,
    };
  }

  throw new Error(
    'DLMM SDK does not expose removeLiquidity/closePosition in this version — close manually',
  );
}
