/**
 * Database migration runner.
 *
 * Applies db/schema.sql against DATABASE_URL. The schema file is written
 * to be idempotent (IF NOT EXISTS everywhere), so this script is safe to
 * re-run at any time.
 *
 * Usage: pnpm db:migrate
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from '../src/config/index.js';
import { pool, query } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';

const log = logger.child({ module: 'migrate' });

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(here, '../../db/schema.sql');
  const sql = await readFile(schemaPath, 'utf8');

  log.info({ database: maskUrl(config.DATABASE_URL) }, 'applying schema...');

  // Single transaction: all-or-nothing.
  await query('BEGIN');
  try {
    await query(sql);
    await query(
      `INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
       ON CONFLICT (version) DO NOTHING`,
    );
    await query('COMMIT');
    log.info('migration applied: 001_initial_schema');
  } catch (err) {
    await query('ROLLBACK');
    log.error({ err }, 'migration failed, rolled back');
    throw err;
  }
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    u.password = '***';
    return u.toString();
  } catch {
    return 'invalid-url';
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    log.error({ err }, 'migration runner crashed');
    process.exit(1);
  });
