/**
 * PostgreSQL connection pool (singleton per process).
 *
 * BLUEPRINT.md §12.3: the app DB user has SELECT/INSERT/UPDATE only —
 * no DELETE on audit_log, no DDL. Enforce that at the infra level, not in code.
 */
import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'db' });

pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  log.error({ err }, 'unexpected postgres pool error');
});

/** Thin parameterized query helper. */
export function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/** True when the database accepts connections (used by API routes to degrade gracefully). */
export async function dbHealthy(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
