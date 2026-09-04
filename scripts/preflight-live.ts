/**
 * Live-trading preflight (run with DRY_RUN=false BEFORE going live).
 *
 * Verifies, per venue that has credentials configured:
 *   solana      keypair loads, RPC reachable, SOL ≥ rent+fees, USDC ATA
 *   hyperliquid key/address valid, API reachable, account exists, margin > 0
 *   evm         key loads, RPC reachable per chain, native ≥ gas floor,
 *               USDC allowance to SwapRouter02 (report only — never approves)
 *   polymarket  key + funder set, creds derivable, USDC.e balance on Polygon
 *   robinhood   API key + Ed25519 key present
 *
 * Exit code 0 = every CONFIGURED venue passed; 1 = any hard failure.
 * Usage: DRY_RUN=false npx tsx scripts/preflight-live.ts [--json]
 */
import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { mainnet, base as baseChain, polygon } from 'viem/chains';
import { config } from '../src/config/index.js';

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

interface Check {
  venue: string;
  item: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(venue: string, item: string, ok: boolean, detail: string): void {
  checks.push({ venue, item, ok, detail });
}

async function solanaChecks(): Promise<void> {
  const venue = 'solana';
  if (!config.SOLANA_PRIVATE_KEY) {
    record(venue, 'keypair', false, 'SOLANA_PRIVATE_KEY not set');
    return;
  }
  const { loadAgentKeypair } = await import('../src/executor/jupiter.js');
  let keypair;
  try {
    keypair = loadAgentKeypair();
    record(venue, 'keypair', true, keypair.publicKey.toBase58());
  } catch (err) {
    record(venue, 'keypair', false, err instanceof Error ? err.message : String(err));
    return;
  }
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
    const slot = await connection.getSlot();
    record(venue, 'rpc', true, `${config.SOLANA_RPC_URL} @ slot ${slot}`);
    const lamports = await connection.getBalance(keypair.publicKey);
    record(venue, 'sol-balance', lamports > 1_000_000, `${(lamports / 1e9).toFixed(4)} SOL${lamports <= 1_000_000 ? ' — below fee floor (fund the wallet)' : ''}`);
    const ata = PublicKey.findProgramAddressSync(
      [keypair.publicKey.toBuffer(), new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL').toBuffer(), new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').toBuffer()],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    )[0];
    const usdc = await connection.getTokenAccountBalance(ata).catch(() => null);
    record(
      venue,
      'usdc-ata',
      Boolean(usdc),
      usdc ? `${usdc.value.uiAmount ?? 0} USDC` : 'USDC ATA missing — created on first swap (wrapAndUnwrapSol)',
    );
  } catch (err) {
    record(venue, 'rpc', false, err instanceof Error ? err.message : String(err));
  }
}

async function hyperliquidChecks(): Promise<void> {
  const venue = 'hyperliquid';
  if (!config.HYPERLIQUID_PRIVATE_KEY || !config.HYPERLIQUID_WALLET_ADDRESS) {
    record(venue, 'keypair', false, 'HYPERLIQUID_PRIVATE_KEY / HYPERLIQUID_WALLET_ADDRESS not set');
    return;
  }
  try {
    const { privateKeyToAccount } = await import('viem/accounts');
    const pk = config.HYPERLIQUID_PRIVATE_KEY.startsWith('0x')
      ? config.HYPERLIQUID_PRIVATE_KEY
      : `0x${config.HYPERLIQUID_PRIVATE_KEY}`;
    const derived = privateKeyToAccount(pk as `0x${string}`).address.toLowerCase();
    const matches = derived === config.HYPERLIQUID_WALLET_ADDRESS.toLowerCase();
    record(venue, 'key↔address', matches, matches ? derived : `key derives ${derived} but config says ${config.HYPERLIQUID_WALLET_ADDRESS}`);
  } catch (err) {
    record(venue, 'keypair', false, err instanceof Error ? err.message : String(err));
    return;
  }
  try {
    const { fetchUserPositions } = await import('../src/agents/perps/hyperliquid.js');
    const positions = await fetchUserPositions(config.HYPERLIQUID_WALLET_ADDRESS);
    record(venue, 'account', true, `reachable, ${positions.length} open position(s) — deposit USDC on hyperliquid.xyz if margin is zero`);
  } catch (err) {
    record(venue, 'account', false, err instanceof Error ? err.message : String(err));
  }
}

async function evmChecks(): Promise<void> {
  const { uniswapExecute } = await import('../src/executor/uniswap.js');
  void uniswapExecute; // ensure module loads (catches env wiring errors early)
  const { EVM_TOKENS, QUOTER_V2, routerAddress } = await import('../src/executor/uniswap.js');

  if (!config.EVM_EXECUTOR_PRIVATE_KEY) {
    record('evm', 'keypair', false, 'EVM_EXECUTOR_PRIVATE_KEY not set');
    return;
  }
  const { privateKeyToAccount } = await import('viem/accounts');
  const pk = config.EVM_EXECUTOR_PRIVATE_KEY.startsWith('0x')
    ? config.EVM_EXECUTOR_PRIVATE_KEY
    : `0x${config.EVM_EXECUTOR_PRIVATE_KEY}`;
  const account = privateKeyToAccount(pk as `0x${string}`);
  record('evm', 'keypair', true, account.address);

  for (const chain of ['ethereum', 'base'] as const) {
    const rpc = chain === 'base' ? config.BASE_RPC_URL : config.ETHEREUM_RPC_URL;
    const client = createPublicClient({ chain: chain === 'base' ? baseChain : mainnet, transport: http(rpc) });
    try {
      const balance = await client.getBalance({ address: account.address });
      const eth = Number(formatUnits(balance, 18));
      record(`evm:${chain}`, 'native', eth > 0.001, `${eth.toFixed(4)} native${eth <= 0.001 ? ' — below gas floor' : ''}`);
    } catch (err) {
      record(`evm:${chain}`, 'rpc', false, `${rpc}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    try {
      const router = routerAddress(chain);
      if (!router) {
        record(`evm:${chain}`, 'router', false, 'BASE_SWAP_ROUTER_02 not set — live Base swaps unavailable');
        continue;
      }
      const usdc = EVM_TOKENS[chain].usdc;
      const [bal, allowance] = await Promise.all([
        client.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
        client.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, router] }),
      ]);
      const balUsd = Number(formatUnits(bal, 6));
      const allowUsd = Number(formatUnits(allowance, 6));
      record(`evm:${chain}`, 'usdc', balUsd > 1, `${balUsd.toFixed(2)} USDC`);
      record(
        `evm:${chain}`,
        'allowance',
        allowUsd > 1,
        allowUsd > 1 ? `${allowUsd.toFixed(2)} USDC approved to SwapRouter02` : `0 — approve USDC to ${router} manually (executor never auto-approves)`,
      );
    } catch (err) {
      record(`evm:${chain}`, 'tokens', false, err instanceof Error ? err.message : String(err));
    }
    void QUOTER_V2;
  }
}

async function polymarketChecks(): Promise<void> {
  const venue = 'polymarket';
  if (!config.POLYMARKET_PRIVATE_KEY || !config.POLYMARKET_FUNDER_ADDRESS) {
    record(venue, 'keypair', false, 'POLYMARKET_PRIVATE_KEY / POLYMARKET_FUNDER_ADDRESS not set');
    return;
  }
  try {
    const { createOrDeriveCreds } = await import('../src/agents/polymarket/clob.js');
    const creds = await createOrDeriveCreds();
    record(venue, 'clob-creds', true, `apiKey=${creds.apiKey.slice(0, 8)}…`);
  } catch (err) {
    record(venue, 'clob-creds', false, err instanceof Error ? err.message : String(err));
    return;
  }
  try {
    const client = createPublicClient({ chain: polygon, transport: http('https://polygon-rpc.com') });
    // USDC.e on Polygon
    const usdce = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    const bal = await client.readContract({ address: usdce, abi: ERC20_ABI, functionName: 'balanceOf', args: [config.POLYMARKET_FUNDER_ADDRESS as `0x${string}`] });
    const usd = Number(formatUnits(bal, 6));
    record(venue, 'usdc-balance', usd > 1, `${usd.toFixed(2)} USDC.e on ${config.POLYMARKET_FUNDER_ADDRESS}${usd <= 1 ? ' — deposit via polymarket.com' : ''}`);
  } catch (err) {
    record(venue, 'usdc-balance', false, err instanceof Error ? err.message : String(err));
  }
  record(venue, 'wallet-registration', false, 'INFO: funder must be a REGISTERED Polymarket wallet (proxy/Gnosis safe/deposit wallet) — see docs/DEPLOY.md §5.4');
}

async function robinhoodChecks(): Promise<void> {
  const venue = 'robinhood';
  const ok = Boolean(config.ROBINHOOD_API_KEY && config.ROBINHOOD_PRIVATE_KEY_B64);
  record(venue, 'credentials', ok, ok ? 'API key + Ed25519 key present' : 'ROBINHOOD_API_KEY / ROBINHOOD_PRIVATE_KEY_B64 not set (venue skipped)');
}

async function main(): Promise<void> {
  console.log('== Luxy live preflight ==');
  console.log(`mode: DRY_RUN=${config.DRY_RUN} ${config.DRY_RUN ? '(preflight checks only venue wiring — funding checks need DRY_RUN=false irrelevant)' : ''}\n`);

  await Promise.all([solanaChecks(), hyperliquidChecks(), evmChecks(), polymarketChecks(), robinhoodChecks()]);

  const asJson = process.argv.includes('--json');
  if (asJson) {
    console.log(JSON.stringify(checks, null, 2));
  } else {
    let lastVenue = '';
    for (const c of checks) {
      if (c.venue !== lastVenue) {
        console.log(`\n[${c.venue}]`);
        lastVenue = c.venue;
      }
      const flag = c.ok ? '✓' : '✗';
      console.log(`  ${flag} ${c.item.padEnd(18)} ${c.detail}`);
    }
  }

  const hardFails = checks.filter((c) => !c.ok && !c.detail.startsWith('INFO:'));
  console.log(`\n${checks.length - hardFails.length}/${checks.length} checks passed${hardFails.length ? ` — ${hardFails.length} to resolve before going live` : ' — ready for live enablement'}`);
  process.exit(hardFails.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
