/**
 * One-time wallet bootstrap (BLUEPRINT.md §12.2).
 *
 * Generates a fresh keypair for (agent × chain), stores the PUBLIC address
 * in the wallets table, and prints the secret to the terminal exactly once.
 *
 * Solana:
 *   pnpm bootstrap-wallet --agent=meme --chain=solana
 *   pnpm bootstrap-wallet --agent=lp   --chain=solana
 *
 * EVM (Base / Ethereum — same secp256k1 EOA works on both):
 *   pnpm bootstrap-wallet --agent=meme --chain=base
 *   pnpm bootstrap-wallet --agent=lp   --chain=ethereum
 *   pnpm bootstrap-wallet --agent=meme --chain=evm
 *     → generates one key, registers address for both base + ethereum
 *
 * Safety rules:
 *  - Refuses if a wallet already exists for (agent, chain)
 *  - Secret is NEVER written to disk by this script — put it in sops / .env
 *  - EVM secret → EVM_EXECUTOR_PRIVATE_KEY (shared executor key today)
 *  - Solana secret → SOLANA_PRIVATE_KEY
 */
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { query, pool } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';

const log = logger.child({ module: 'bootstrap-wallet' });

const AGENTS = new Set(['meme', 'lp', 'perps', 'reserve', 'narrative', 'polymarket']);
const CHAINS = new Set(['solana', 'base', 'ethereum', 'evm']);

type ChainArg = 'solana' | 'base' | 'ethereum' | 'evm';

function parseArgs(): { agent: string; chain: ChainArg } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const agent = get('--agent');
  const chain = (get('--chain') ?? 'solana') as ChainArg;

  if (!agent || !AGENTS.has(agent)) {
    console.error(
      [
        'Usage:',
        '  pnpm bootstrap-wallet --agent=<meme|lp|perps|reserve|narrative|polymarket> --chain=<solana|base|ethereum|evm>',
        '',
        'Examples:',
        '  pnpm bootstrap-wallet --agent=meme --chain=solana',
        '  pnpm bootstrap-wallet --agent=lp   --chain=base',
        '  pnpm bootstrap-wallet --agent=meme --chain=evm   # base + ethereum, one key',
      ].join('\n'),
    );
    process.exit(1);
  }
  if (!CHAINS.has(chain)) {
    console.error(`Unsupported chain "${chain}". Use: solana | base | ethereum | evm`);
    process.exit(1);
  }
  return { agent, chain };
}

async function assertNoWallet(agent: string, chain: string): Promise<void> {
  const existing = await query<{ address: string }>(
    'SELECT address FROM wallets WHERE agent = $1 AND chain = $2',
    [agent, chain],
  );
  if (existing.rows.length > 0) {
    log.error(
      { agent, chain, address: existing.rows[0]!.address },
      'wallet already exists — refusing to generate a duplicate',
    );
    process.exit(1);
  }
}

async function insertWallet(agent: string, chain: string, address: string): Promise<void> {
  await query('INSERT INTO wallets (agent, chain, address) VALUES ($1, $2, $3)', [
    agent,
    chain,
    address,
  ]);
}

function printSecretBox(lines: string[]): void {
  const bar = '═'.repeat(72);
  console.log('\n' + bar);
  for (const line of lines) console.log(line);
  console.log(bar + '\n');
}

async function bootstrapSolana(agent: string): Promise<void> {
  await assertNoWallet(agent, 'solana');

  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const secretBs58 = bs58.encode(keypair.secretKey);

  await insertWallet(agent, 'solana', address);
  log.info({ agent, chain: 'solana', address }, 'wallet created (public address stored)');

  printSecretBox([
    `SOLANA wallet for agent=${agent}`,
    `Address:  ${address}`,
    `Secret:   ${secretBs58}`,
    '',
    '→ Put secret in .env / sops as:',
    '   SOLANA_PRIVATE_KEY=<secret above>',
    '→ Fund with SOL (fees) + USDC if swapping / LP.',
    '→ Secret is shown ONCE. It is not saved by this script.',
  ]);
}

async function bootstrapEvm(agent: string, chains: Array<'base' | 'ethereum'>): Promise<void> {
  for (const c of chains) {
    await assertNoWallet(agent, c);
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const address = account.address;

  for (const c of chains) {
    await insertWallet(agent, c, address);
    log.info({ agent, chain: c, address }, 'wallet created (public address stored)');
  }

  const chainLabel = chains.join(' + ');
  printSecretBox([
    `EVM wallet for agent=${agent} (${chainLabel})`,
    `Address:  ${address}`,
    `Secret:   ${privateKey}`,
    '',
    '→ Put secret in .env / sops as:',
    '   EVM_EXECUTOR_PRIVATE_KEY=<secret above>',
    '→ Same EOA works on Base and Ethereum (and other EVM chains).',
    '→ Fund with native gas (ETH) + USDC on each chain you trade.',
    '→ Approve SwapRouter02 allowances manually before LIVE swaps',
    '   (executor never auto-approves).',
    '→ Secret is shown ONCE. It is not saved by this script.',
  ]);
}

async function main(): Promise<void> {
  const { agent, chain } = parseArgs();

  if (chain === 'solana') {
    await bootstrapSolana(agent);
  } else if (chain === 'evm') {
    await bootstrapEvm(agent, ['base', 'ethereum']);
  } else if (chain === 'base' || chain === 'ethereum') {
    await bootstrapEvm(agent, [chain]);
  } else {
    console.error(`Unhandled chain: ${chain}`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    log.error({ err }, 'bootstrap-wallet failed');
    process.exit(1);
  })
  .finally(() => pool.end().catch(() => undefined));
