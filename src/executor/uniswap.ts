/**
 * Uniswap v3 execution path — Phase 3 EVM (BLUEPRINT.md §9.3 / §14 P3).
 *
 * Quotes are REAL: `quoteExactInput` static-call against the canonical
 * QuoterV2 on Ethereum (0x61fFE014…) and Base (0x3d4e44Eb…), verified live
 * (100 USDC → WETH both chains). The bytes-path API is used instead of the
 * struct `quoteExactInputSingle` — the struct variant reverted on public
 * RPCs during integration testing, the path variant did not.
 *
 * Execution is dry-run aware, mirroring the Jupiter/Hyperliquid stance:
 *   DRY_RUN  → simulated fill recorded at the executor.
 *   LIVE     → requires EVM_EXECUTOR_PRIVATE_KEY + a funded EOA + a
 *              pre-approved SwapRouter02 allowance. Allowances are NEVER
 *              auto-opened — the executor fails loud with instructions
 *              instead of silently approving token spends.
 */
import {
  createPublicClient,
  http,
  parseAbi,
  encodeFunctionData,
  type Address,
  type PublicClient,
  type Chain,
} from 'viem';
import { mainnet, base as baseChain } from 'viem/chains';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'uniswap' });

/** Canonical QuoterV2 deployments (verified: code exists + live quote OK). */
export const QUOTER_V2: Record<'base' | 'ethereum', Address> = {
  ethereum: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  base: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
};

/** Well-known token addresses (defaults; overridable via env). */
export const EVM_TOKENS: Record<'base' | 'ethereum', { usdc: Address; weth: Address }> = {
  ethereum: {
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  base: {
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    weth: '0x4200000000000000000000000000000000000006',
  },
};

const QUOTER_ABI = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterArray,uint32[] initializedTicksCrossedArray,uint256 gasEstimate)',
]);

const ROUTER_ABI = parseAbi([
  'function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)',
]);

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
]);

function chainDef(chain: 'base' | 'ethereum'): Chain {
  return chain === 'base' ? baseChain : mainnet;
}

function rpcUrl(chain: 'base' | 'ethereum'): string {
  return chain === 'base' ? config.BASE_RPC_URL : config.ETHEREUM_RPC_URL;
}

export function routerAddress(chain: 'base' | 'ethereum'): Address | null {
  if (chain === 'ethereum') {
    return (process.env.ETHEREUM_SWAP_ROUTER_02 ??
      '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45') as Address;
  }
  const configured = process.env.BASE_SWAP_ROUTER_02 ?? '';
  return configured.length > 0 ? (configured as Address) : null;
}

const clients = new Map<string, PublicClient>();

function client(chain: 'base' | 'ethereum'): PublicClient {
  const key = `${chain}:${rpcUrl(chain)}`;
  let c = clients.get(key);
  if (!c) {
    c = createPublicClient({ chain: chainDef(chain), transport: http(rpcUrl(chain)) });
    clients.set(key, c);
  }
  return c;
}

/** Uniswap v3 path encoding: tokenIn (20b) + fee (3b) + tokenOut (20b). */
function buildPath(tokenIn: Address, fee: number, tokenOut: Address): `0x${string}` {
  return (
    '0x' +
    tokenIn.slice(2) +
    fee.toString(16).padStart(6, '0') +
    tokenOut.slice(2)
  ) as `0x${string}`;
}

export interface UniswapQuote {
  outRaw: bigint;
  /** Estimated price impact from a size ladder (two quotes). */
  priceImpactPct: number;
}

/**
 * Real QuoterV2 quote. Price impact is estimated by comparing the quote at
 * the intended size against a 10x smaller probe — a dependency-free ladder
 * that measures marginal price degradation.
 */
export async function uniswapQuote(
  chain: 'base' | 'ethereum',
  tokenIn: Address,
  tokenOut: Address,
  amountInRaw: bigint,
  feeTier = 3000,
): Promise<UniswapQuote> {
  const c = client(chain);
  const quote = (amount: bigint) =>
    c.readContract({
      address: QUOTER_V2[chain],
      abi: QUOTER_ABI,
      functionName: 'quoteExactInput',
      args: [buildPath(tokenIn, feeTier, tokenOut), amount],
    });

  const [full, probe] = await Promise.all([quote(amountInRaw), quote(amountInRaw / 10n)]);

  const outFull = full[0];
  const outProbe = probe[0] * 10n;
  const priceImpactPct = outProbe > 0n ? Math.max(0, 1 - Number(outFull) / Number(outProbe)) : 0;

  return { outRaw: outFull, priceImpactPct };
}

export interface UniswapFillResult {
  txHash: string | null;
  outRaw: string;
  note: string;
}

/**
 * Swap exact-in USDC → token via SwapRouter02 `exactInput` (same path
 * encoding as the verified quote). Live path verifies allowance first and
 * NEVER opens it automatically.
 */
export async function uniswapExecute(input: {
  chain: 'base' | 'ethereum';
  tokenOut: Address;
  sizeUsd: number;
  maxSlippagePct: number;
  dryRun: boolean;
  feeTier?: number;
}): Promise<UniswapFillResult> {
  const { chain, tokenOut, sizeUsd, maxSlippagePct, dryRun } = input;
  const feeTier = input.feeTier ?? 3000;
  const tokenIn = EVM_TOKENS[chain].usdc;

  const quote = await uniswapQuote(chain, tokenIn, tokenOut, BigInt(Math.round(sizeUsd * 1e6)), feeTier);
  if (quote.priceImpactPct > maxSlippagePct) {
    throw new Error(
      `uniswap quote impact ${(quote.priceImpactPct * 100).toFixed(2)}% exceeds ${(maxSlippagePct * 100).toFixed(1)}% cap`,
    );
  }

  if (dryRun) {
    return {
      txHash: null,
      outRaw: quote.outRaw.toString(),
      note: 'dry-run fill (uniswap v3 quoted path, live signing disabled)',
    };
  }

  // ---- LIVE path: fail loud unless fully provisioned ----
  const pk = config.EVM_EXECUTOR_PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      'LIVE EVM execution requires EVM_EXECUTOR_PRIVATE_KEY — refusing to proceed (dry-run remains available)',
    );
  }
  const router = routerAddress(chain);
  if (!router) {
    throw new Error(
      `LIVE EVM execution on ${chain} requires BASE_SWAP_ROUTER_02 to be set to a verified SwapRouter02 address`,
    );
  }

  const { createWalletClient, http: httpTransport } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(pk.startsWith('0x') ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`));

  // Allowance must already be open — no silent approvals.
  const allowance = await client(chain).readContract({
    address: tokenIn,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, router],
  });
  const needed = BigInt(Math.round(sizeUsd * 1e6));
  if (allowance < needed) {
    throw new Error(
      `USDC allowance to SwapRouter02 too low (${allowance} < ${needed}) — approve manually first; the executor never auto-approves spends`,
    );
  }

  const wallet = createWalletClient({
    account,
    chain: chainDef(chain),
    transport: httpTransport(rpcUrl(chain)),
  });
  const minOut = (quote.outRaw * BigInt(Math.round((1 - maxSlippagePct) * 10_000))) / 10_000n;
  const callData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'exactInput',
    args: [
      {
        path: buildPath(tokenIn, feeTier, tokenOut),
        recipient: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 120),
        amountIn: needed,
        amountOutMinimum: minOut,
      },
    ],
  });
  const hash = await wallet.sendTransaction({ to: router, data: callData });
  log.info({ chain, hash }, 'uniswap swap submitted');
  return { txHash: hash, outRaw: quote.outRaw.toString(), note: 'live uniswap v3 swap' };
}
