/**
 * Meteora DLMM LP deploy / close (BLUEPRINT.md §6.3).
 *
 * LIVE path uses @meteora-ag/dlmm (optional dependency):
 *   pnpm add @meteora-ag/dlmm bn.js
 *
 * Amount sizing uses pool token decimals + active-bin price so X/Y deposits
 * match the Spot strategy range (not a hard-coded 6-decimal 50/50 guess).
 *
 * DRY_RUN simulates a position without sending txs.
 */
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { config } from '../config/index.js';
import { loadAgentKeypair, USDC_MINT } from './jupiter.js';
import { logger } from '../utils/logger.js';
import type { LuxyIntent } from '../types/index.js';

const log = logger.child({ module: 'meteora-lp' });

export interface LpDeployResult {
  signature: string | null;
  positionAddress: string;
  lowerBin: number;
  upperBin: number;
  amountX: string;
  amountY: string;
  decimalsX: number;
  decimalsY: number;
  priceXy: number | null;
  note: string;
  dryRun: boolean;
}

const DEFAULT_BIN_RANGE = 10;

/** Known USD-ish mints on Solana (6 decimals typically). */
const STABLE_MINTS = new Set([
  USDC_MINT, // EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USDH1MD1NW6CgsEyQQMLbH1i5B1bY3pQ2YhYw1G8sJ8', // USDH (if present)
]);

export interface PoolTokenMeta {
  mint: string;
  decimals: number;
}

export interface SizedAmounts {
  totalXAmount: { toString(): string }; // BN-like
  totalYAmount: { toString(): string };
  amountXUi: number;
  amountYUi: number;
  decimalsX: number;
  decimalsY: number;
  priceXy: number | null; // Y per 1 X (human units)
  note: string;
}

/**
 * Derive human + raw deposit amounts from sizeUsd, pool token decimals,
 * and active-bin price (Y per X in human units when available).
 *
 * Strategy:
 *   - If Y is stable → sizeUsd is mostly in Y; X = (sizeUsd/2) / price
 *   - If X is stable → mirror
 *   - Else 50/50 notional in USD using price when known
 */
export function sizeDlmmAmounts(
  sizeUsd: number,
  tokenX: PoolTokenMeta,
  tokenY: PoolTokenMeta,
  priceXy: number | null,
  BN: new (n: string | number) => { toString(): string },
): SizedAmounts {
  const decX = clampDecimals(tokenX.decimals);
  const decY = clampDecimals(tokenY.decimals);
  const xStable = STABLE_MINTS.has(tokenX.mint);
  const yStable = STABLE_MINTS.has(tokenY.mint);

  let amountXUi: number;
  let amountYUi: number;
  let note: string;

  // priceXy = human Y per human X (active bin), when available.
  // Target: ~50/50 USD notional on each side.
  if (priceXy !== null && priceXy > 0 && Number.isFinite(priceXy)) {
    if (yStable && !xStable) {
      // Y = USDC: each X costs priceXy USD
      amountYUi = sizeUsd / 2;
      amountXUi = sizeUsd / 2 / priceXy;
      note = `Y-stable 50/50 USD @ priceY/X=${priceXy.toPrecision(6)}`;
    } else if (xStable && !yStable) {
      // X = USDC: each X ≈ $1; Y scaled by inverse of priceY/X
      amountXUi = sizeUsd / 2;
      amountYUi = sizeUsd / 2 / priceXy;
      note = `X-stable 50/50 USD @ priceY/X=${priceXy.toPrecision(6)}`;
    } else {
      amountYUi = sizeUsd / 2;
      amountXUi = sizeUsd / 2 / priceXy;
      note = `balanced 50/50 USD @ priceY/X=${priceXy.toPrecision(6)}`;
    }
  } else if (yStable) {
    amountYUi = sizeUsd / 2;
    amountXUi = 0;
    note = 'no price + Y-stable → single-sided Y (sizeUsd/2)';
  } else if (xStable) {
    amountXUi = sizeUsd / 2;
    amountYUi = 0;
    note = 'no price + X-stable → single-sided X (sizeUsd/2)';
  } else {
    amountYUi = sizeUsd / 2;
    amountXUi = sizeUsd / 2;
    note = 'no price, no stable — equal human units (imbalance risk)';
  }

  // Guard dust / overflow
  amountXUi = Math.max(0, amountXUi);
  amountYUi = Math.max(0, amountYUi);

  const rawX = toRawAmount(amountXUi, decX);
  const rawY = toRawAmount(amountYUi, decY);

  return {
    totalXAmount: new BN(rawX),
    totalYAmount: new BN(rawY),
    amountXUi,
    amountYUi,
    decimalsX: decX,
    decimalsY: decY,
    priceXy,
    note,
  };
}

function clampDecimals(d: number): number {
  if (!Number.isFinite(d) || d < 0) return 6;
  return Math.min(12, Math.max(0, Math.floor(d)));
}

/** Convert human amount → integer base units as decimal string (no float BN ctor issues). */
export function toRawAmount(uiAmount: number, decimals: number): string {
  if (!Number.isFinite(uiAmount) || uiAmount <= 0) return '0';
  const s = uiAmount.toFixed(Math.min(decimals + 2, 12));
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+(\d)/, '$1');
  // strip leading zeros but keep at least one digit
  const cleaned = combined.replace(/^0+/, '') || '0';
  return cleaned;
}

/**
 * Read token mint/decimals and active-bin price from a DLMM pool instance.
 * Handles several SDK field shapes across versions.
 */
export function readPoolMeta(pool: any, activeBin: any): {
  tokenX: PoolTokenMeta;
  tokenY: PoolTokenMeta;
  priceXy: number | null;
  activeBinId: number;
} {
  const mintX =
    pool?.tokenX?.publicKey?.toBase58?.() ??
    pool?.tokenX?.mint?.toBase58?.() ??
    pool?.lbPair?.tokenXMint?.toBase58?.() ??
    String(pool?.tokenX?.mint ?? pool?.lbPair?.tokenXMint ?? '');
  const mintY =
    pool?.tokenY?.publicKey?.toBase58?.() ??
    pool?.tokenY?.mint?.toBase58?.() ??
    pool?.lbPair?.tokenYMint?.toBase58?.() ??
    String(pool?.tokenY?.mint ?? pool?.lbPair?.tokenYMint ?? '');

  const decX = Number(
    pool?.tokenX?.decimal ??
      pool?.tokenX?.decimals ??
      pool?.tokenXMintDecimals ??
      6,
  );
  const decY = Number(
    pool?.tokenY?.decimal ??
      pool?.tokenY?.decimals ??
      pool?.tokenYMintDecimals ??
      6,
  );

  let priceXy: number | null = null;
  // Prefer SDK helpers when present
  try {
    if (typeof pool.fromPricePerLamport === 'function' && activeBin?.price != null) {
      priceXy = Number(pool.fromPricePerLamport(Number(activeBin.price)));
    } else if (activeBin?.price != null) {
      // raw price often in per-lamport space; scale by decimals
      const raw = Number(activeBin.price);
      if (Number.isFinite(raw) && raw > 0) {
        priceXy = raw * Math.pow(10, decX - decY);
      }
    } else if (typeof activeBin?.pricePerToken === 'number') {
      priceXy = activeBin.pricePerToken;
    }
  } catch {
    priceXy = null;
  }
  if (priceXy !== null && (!Number.isFinite(priceXy) || priceXy <= 0)) priceXy = null;

  const activeBinId = Number(activeBin?.binId ?? 0);

  return {
    tokenX: { mint: mintX, decimals: clampDecimals(decX) },
    tokenY: { mint: mintY, decimals: clampDecimals(decY) },
    priceXy,
    activeBinId: Number.isFinite(activeBinId) ? activeBinId : 0,
  };
}

export async function deployDlmmPosition(intent: LuxyIntent): Promise<LpDeployResult> {
  const poolId = intent.poolId;
  if (!poolId) throw new Error('LP deploy requires intent.poolId');

  const sizeUsd = intent.sizeUsd ?? 0;
  if (sizeUsd <= 0) throw new Error('LP deploy requires positive sizeUsd');

  if (config.DRY_RUN) {
    const positionAddress = `dry_lp_${poolId.slice(0, 8)}_${Date.now()}`;
    // Best-effort dry sizing without chain (equal split, 6 dec assumption)
    const half = sizeUsd / 2;
    return {
      signature: null,
      positionAddress,
      lowerBin: -DEFAULT_BIN_RANGE,
      upperBin: DEFAULT_BIN_RANGE,
      amountX: toRawAmount(half, 6),
      amountY: toRawAmount(half, 6),
      decimalsX: 6,
      decimalsY: 6,
      priceXy: null,
      note: `dry-run DLMM deploy pool=${poolId} size=$${sizeUsd.toFixed(2)} (decimals resolved on LIVE)`,
      dryRun: true,
    };
  }

  let DLMM: any;
  let StrategyType: any;
  let BN: any;
  try {
    const mod = await import('@meteora-ag/dlmm');
    DLMM = mod.default ?? mod;
    StrategyType = mod.StrategyType ?? mod.default?.StrategyType;
    BN = (await import('bn.js')).default;
  } catch {
    throw new Error(
      'LIVE LP deploy requires @meteora-ag/dlmm and bn.js — run: pnpm add @meteora-ag/dlmm bn.js',
    );
  }

  const user = loadAgentKeypair();
  const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
  const pool = await DLMM.create(connection, new PublicKey(poolId), {
    cluster: 'mainnet-beta',
  });

  const activeBin = await pool.getActiveBin();
  const meta = readPoolMeta(pool, activeBin);
  const minBinId = meta.activeBinId - DEFAULT_BIN_RANGE;
  const maxBinId = meta.activeBinId + DEFAULT_BIN_RANGE;

  const sized = sizeDlmmAmounts(sizeUsd, meta.tokenX, meta.tokenY, meta.priceXy, BN);

  // Optional: SDK autoFillYByStrategy when available for better Y matching
  let totalXAmount = sized.totalXAmount;
  let totalYAmount = sized.totalYAmount;
  try {
    const autoFill =
      (await import('@meteora-ag/dlmm')).autoFillYByStrategy ??
      (DLMM as any).autoFillYByStrategy;
    if (typeof autoFill === 'function' && meta.priceXy != null) {
      const yFilled = autoFill(
        meta.activeBinId,
        pool.lbPair?.binStep ?? pool.binStep ?? 1,
        totalXAmount,
        activeBin.xAmount ?? new BN(0),
        activeBin.yAmount ?? new BN(0),
        minBinId,
        maxBinId,
        StrategyType?.Spot ?? 0,
      );
      if (yFilled) totalYAmount = yFilled;
      log.info({ autoFillY: totalYAmount.toString() }, 'autoFillYByStrategy applied');
    }
  } catch (err) {
    log.debug({ err }, 'autoFillYByStrategy unavailable — using sized amounts');
  }

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

  const txs = Array.isArray(tx) ? tx : [tx];
  let lastSig: string | null = null;
  for (const t of txs) {
    lastSig = await sendAndConfirmTransaction(connection, t, [user, position], {
      commitment: 'confirmed',
      skipPreflight: false,
    });
  }

  const note =
    `live DLMM deploy position=${position.publicKey.toBase58()} ` +
    `bins=[${minBinId},${maxBinId}] X=${sized.amountXUi.toPrecision(6)}(${meta.tokenX.decimals}d) ` +
    `Y=${sized.amountYUi.toPrecision(6)}(${meta.tokenY.decimals}d) ${sized.note}`;

  log.info(
    {
      poolId,
      position: position.publicKey.toBase58(),
      sig: lastSig,
      mintX: meta.tokenX.mint,
      mintY: meta.tokenY.mint,
      decX: meta.tokenX.decimals,
      decY: meta.tokenY.decimals,
      priceXy: meta.priceXy,
      rawX: totalXAmount.toString(),
      rawY: totalYAmount.toString(),
    },
    'DLMM position deployed',
  );

  return {
    signature: lastSig,
    positionAddress: position.publicKey.toBase58(),
    lowerBin: minBinId,
    upperBin: maxBinId,
    amountX: totalXAmount.toString(),
    amountY: totalYAmount.toString(),
    decimalsX: meta.tokenX.decimals,
    decimalsY: meta.tokenY.decimals,
    priceXy: meta.priceXy,
    note,
    dryRun: false,
  };
}

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
  const positionPubKey = new PublicKey(input.positionAddress);
  let signature: string | null = null;

  if (typeof pool.removeLiquidity === 'function') {
    try {
      const removeTx = await pool.removeLiquidity({
        user: user.publicKey,
        position: positionPubKey,
        fromBinId: undefined,
        toBinId: undefined,
        bps: 10_000,
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
