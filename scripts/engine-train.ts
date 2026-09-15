/**
 * Fit LuxyEngine logistic weights from closed positions / signals and save artifact.
 *
 *   pnpm engine:train
 *   pnpm engine:train -- --activate
 */
import { trainAndSaveArtifact, clearArtifactCache } from '../src/engine/index.js';
import { pool } from '../src/db/pool.js';

const activate = process.argv.includes('--activate');

trainAndSaveArtifact({ activate })
  .then((r) => {
    if (!r) {
      console.error('Not enough samples (≥10 closed positions or signals required).');
      process.exit(2);
    }
    clearArtifactCache();
    console.log(JSON.stringify({ ok: true, ...r.metrics, version: r.version }, null, 2));
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  })
  .finally(() => pool.end().catch(() => undefined));
