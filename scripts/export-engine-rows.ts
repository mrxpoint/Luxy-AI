/**
 * Export tabular feature rows for LightGBM / logistic training.
 *   pnpm exec tsx scripts/export-engine-rows.ts > data/training/engine-rows.jsonl
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportTrainingRows } from '../src/engine/train.js';
import { pool } from '../src/db/pool.js';

async function main() {
  const rows = await exportTrainingRows(1000);
  const dir = resolve(process.cwd(), 'data/training');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `engine-rows-${Date.now()}.jsonl`);
  const body = rows.map((r) => JSON.stringify({ features: r.features, label: r.label, symbol: r.symbol })).join('\n');
  writeFileSync(path, body + (body ? '\n' : ''), 'utf8');
  console.log(JSON.stringify({ ok: true, path, samples: rows.length }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end().catch(() => undefined));
