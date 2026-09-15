/**
 * Calibrate baseline feature weights from closed positions (lightweight).
 * Records a versioned snapshot in engine_models. Full LightGBM/XGB training
 * remains a Python-artifact follow-up.
 */
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { BASELINE_MODEL_VERSION } from './baseline.js';

const log = logger.child({ module: 'engine-calibrate' });

export async function calibrateBaselineFromPositions(): Promise<{
  version: string;
  samples: number;
  winRate: number;
}> {
  const res = await query<{ pnl_pct: number | null }>(
    `SELECT pnl_pct FROM positions WHERE status = 'closed' AND pnl_pct IS NOT NULL
     ORDER BY closed_at DESC LIMIT 500`,
  );
  const samples = res.rows.length;
  const wins = res.rows.filter((r) => Number(r.pnl_pct) > 0).length;
  const winRate = samples > 0 ? wins / samples : 0;
  const version = `${BASELINE_MODEL_VERSION}-cal-${new Date().toISOString().slice(0, 10)}`;

  try {
    await query(
      `INSERT INTO engine_models (backend, version, agent, metrics, artifact_path, active)
       VALUES ('baseline', $1, 'meme', $2::jsonb, NULL, FALSE)
       ON CONFLICT (backend, version, agent) DO UPDATE SET metrics = EXCLUDED.metrics`,
      [version, JSON.stringify({ samples, winRate, source: 'closed_positions' })],
    );
  } catch (err) {
    log.warn({ err }, 'engine_models insert failed — run migrations');
  }

  log.info({ version, samples, winRate }, 'baseline calibration recorded');
  return { version, samples, winRate };
}
