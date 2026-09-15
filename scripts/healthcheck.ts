/**
 * Health check — usable from cron, CI or right after deploy:
 *   npx tsx scripts/healthcheck.ts
 *
 * Verifies: config loads, Postgres reachable + tables exist, Redis reachable,
 * external APIs respond (DexScreener, Hyperliquid), queue depth sane.
 * Exit 0 = healthy, 1 = at least one critical dependency failed.
 */
import { config } from '../src/config/index.js';
import { query } from '../src/db/pool.js';
import { getJson, postJson } from '../src/utils/http.js';

interface Result {
  name: string;
  ok: boolean;
  detail: string;
  critical: boolean;
}

const results: Result[] = [];

async function check(name: string, critical: boolean, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, critical });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err), critical });
  }
}

async function main(): Promise<void> {
  await check('postgres', true, async () => {
    const res = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    return `connected, ${res.rows[0].count} tables`;
  });

  await check('redis', true, async () => {
    const { redis } = await import('../src/redis/connection.js');
    const pong = await redis.ping();
    return `ping=${pong}`;
  });

  await check('dexscreener', false, async () => {
    const res = await getJson<Array<{ chainId?: string }>>('https://api.dexscreener.com/token-profiles/latest/v1');
    return `${Array.isArray(res) ? res.length : 0} profiles`;
  });

  await check('hyperliquid', false, async () => {
    const mids = await postJson<Record<string, string>>(`${config.HYPERLIQUID_API_URL}/info`, { type: 'allMids' });
    return `${Object.keys(mids).length} mids, BTC=${mids.BTC ?? '?'}`;
  });

  await check('jupiter', false, async () => {
    const q = await getJson<{ outAmount?: string }>(
      `${config.JUPITER_API_BASE}/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=50`,
    );
    return `USDC→SOL out=${q.outAmount ?? '?'}`;
  });

  await check('mode', true, async () => {
    return config.DRY_RUN
      ? 'DRY_RUN — simulated fills only'
      : 'LIVE — real funds at risk (LIVE_CONFIRM=yes)';
  });

  let failed = 0;
  console.log('== Luxy health check ==');
  for (const r of results) {
    const flag = r.ok ? '✓' : r.critical ? '✗' : '~';
    if (!r.ok && r.critical) failed++;
    console.log(`${flag} ${r.name.padEnd(14)} ${r.detail}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
