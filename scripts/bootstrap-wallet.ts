/**
 * One-time wallet bootstrap (BLUEPRINT.md §12.2).
 *
 * Generates a fresh Solana keypair for a given (agent × chain), stores the
 * PUBLIC address in the wallets table, and prints the secret key to the
 * terminal exactly once.
 *
 *   pnpm bootstrap-wallet --agent=meme --chain=solana
 *   pnpm bootstrap-wallet --agent=lp   --chain=solana
 *   pnpm bootstrap-wallet --agent=reserve --chain=solana
 *
 * Safety rules:
 *  - Refuses to run if a wallet already exists for (agent, chain)
 *    (prevents accidental double-generation).
 *  - The secret key is NEVER persisted by this script — encrypt it with
 *    sops + age immediately and put it in your secret manager / .env.
 *  - EVM/hyperliquid provisioning is Phase 3; this script currently
 *    supports --chain=solana only.
 */
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../src/config/index.js';
import { pool, query } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';

const log = logger.child({ module: 'bootstrap-wallet' });

function parseArgs(): { agent: string; chain: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const agent = get('--agent');
  const chain = get('--chain') ?? 'solana';
  if (!agent) {
    console.error('Usage: pnpm bootstrap-wallet --agent=<meme|lp|perps|reserve> --chain=solana');
    process.exit(1);
  }
  if (chain !== 'solana') {
    console.error(`Unsupported chain "${chain}". Only solana is supported in Phase 1-2.`);
    process.exit(1);
  }
  return { agent, chain };
}

async function main(): Promise<void> {
  const { agent, chain } = parseArgs();

  // Refuse duplicates — one wallet per (chain × agent) per BLUEPRINT §7.2.
  const existing = await query('SELECT address FROM wallets WHERE agent = $1 AND chain = $2', [
    agent,
    chain,
  ]);
  if (existing.rows.length > 0) {
    log.error(
      { agent, chain, address: existing.rows[0]!.address },
      'wallet already exists — refusing to generate a duplicate',
    );
    process.exit(1);
  }

  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const secretBs58 = bs58.encode(keypair.secretKey);

  await query(
    'INSERT INTO wallets (agent, chain, address) VALUES ($1, $2, $3)',
    [agent, chain, address],
  );

  log.info({ agent, chain, address }, 'wallet created and public address stored');

  console.log('\n============================================================');
  console.log('  WALLET CREATED — SECRET SHOWN EXACTLY ONCE');
  console.log('============================================================');
  console.log(`  agent:   ${agent}`);
  console.log(`  chain:   ${chain}`);
  console.log(`  address: ${address}`);
  console.log(`  secret:  ${secretBs58}`);
  console.log('------------------------------------------------------------');
  console.log('  1. Copy the secret NOW (it will not be shown again).');
  console.log('  2. Encrypt with sops + age before storing anywhere.');
  console.log(`  3. In production put it in your secret manager, e.g.:`);
  console.log(`     ${agent.toUpperCase()}_WALLET_SECRET_KEY=<bs58-secret>`);
  console.log('  4. Fund the address before switching DRY_RUN=false.');
  console.log('============================================================\n');

  await pool.end();
}

config; // force env validation before touching the DB
main().catch((err) => {
  log.error({ err }, 'bootstrap-wallet failed');
  process.exit(1);
});
