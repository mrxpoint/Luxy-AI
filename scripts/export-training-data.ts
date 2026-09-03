/**
 * Fine-tuning dataset export (BLUEPRINT.md §11.1 — Phase 4 prerequisite).
 *
 * Turns accumulated runtime history into an SFT JSONL dataset:
 *
 *   1. Join each closed position to its originating signal context and the
 *      LuxyIntent (stored verbatim in positions.intent).
 *   2. Keep only sessions with a CLEAR outcome: |pnl%| >= 5
 *      (augment: risk-guard blocks and high-slippage rejections as bad-decision
 *      examples — edge cases the model must learn to avoid).
 *   3. Label: outcome "good" when PnL > 0 within the window, "bad" otherwise.
 *   4. Emit chat-format JSONL (`messages` array), one row per session.
 *
 * Output: data/training/luxy-sft-<stamp>.jsonl (gitignored — never commit
 * market history you cannot share).
 *
 * Usage: pnpm ft:export [--min-pnl-pct=5] [--out=data/training]
 */
import { mkdir } from 'node:fs/promises';
import { appendFile } from 'node:fs/promises';
import { config } from '../src/config/index.js';
import { pool, query } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';

const log = logger.child({ module: 'ft-export' });

interface Args {
  minPnlPct: number;
  out: string;
}
function parseArgs(): Args {
  const a: Args = { minPnlPct: 5, out: 'data/training' };
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)(?:=(.*))?$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'min-pnl-pct') a.minPnlPct = Number(v ?? 5);
    if (k === 'out') a.out = v ?? a.out;
  }
  return a;
}

interface SessionRow {
  position_id: number;
  agent: string;
  chain: string;
  token: string | null;
  symbol: string | null;
  size_usd: string;
  entry_price: string | null;
  pnl_usd: string | null;
  pnl_pct: string | null;
  intent: Record<string, unknown> | null;
  signal_ctx: Record<string, unknown> | null;
  backtest: Record<string, unknown> | null;
}

const SYSTEM_PROMPT =
  'You are Luxy, an AI trading agent. You reason carefully, validate signals in code, ' +
  'output structured JSON intents, and never execute trades directly.';

function buildExample(row: SessionRow, label: 'good' | 'bad'): {
  messages: Array<{ role: string; content: string }>;
  outcome: 'good' | 'bad';
  actual_pnl_pct: number;
} {
  const signalCtx = row.signal_ctx
    ? {
        symbol: (row.signal_ctx as { symbol?: string }).symbol ?? row.symbol,
        chain: row.chain,
        token: row.token,
        priceUsd: (row.signal_ctx as { priceUsd?: number }).priceUsd,
        liquidityUsd: (row.signal_ctx as { liquidity?: { usd?: number } }).liquidity?.usd,
        volume24h: (row.signal_ctx as { volume?: { h24?: number } }).volume?.h24,
        txns24h: (row.signal_ctx as { txns?: { h24?: { buys: number; sells: number } } }).txns?.h24,
      }
    : { symbol: row.symbol, chain: row.chain, token: row.token };

  const userContent =
    `SIGNAL: ${row.symbol ?? row.token ?? row.chain} on ${row.chain}.\n` +
    `Context: ${JSON.stringify(signalCtx)}\n` +
    (row.backtest ? `Backtest metrics: ${JSON.stringify(row.backtest)}\n` : '') +
    `Decide the next action (entry/exit/hold/alert) with size and reasoning.`;

  const assistantContent = JSON.stringify(
    {
      action: row.intent?.action ?? 'exit',
      agent: row.agent,
      chain: row.chain,
      token: row.token,
      sizeUsd: Number(row.size_usd),
      reasoning: row.intent?.reasoning ?? 'position closed with recorded outcome',
      confidence: row.intent?.confidence ?? 0.6,
      createdAt: new Date().toISOString(),
    },
    null,
    0,
  );

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent },
    ],
    outcome: label,
    actual_pnl_pct: Number(row.pnl_pct ?? 0) * 100,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const minPnl = Math.abs(args.minPnlPct) / 100;
  log.info({ minPnlPct: args.minPnlPct, out: args.out }, 'exporting fine-tuning dataset');

  // Clear-outcome sessions (BLUEPRINT §11.1 step 3-4).
  const res = await query<SessionRow>(
    `SELECT p.id AS position_id, p.agent, p.chain, p.token, sym.symbol, p.size_usd,
            p.entry_price, p.pnl_usd, p.pnl_pct, p.intent,
            (SELECT s.raw_data FROM signals s
              WHERE s.token = p.token AND s.chain = p.chain
              ORDER BY s.created_at DESC LIMIT 1) AS signal_ctx,
            (SELECT b.result FROM backtest_runs b
              WHERE b.signal_id = (SELECT s.id FROM signals s
                                    WHERE s.token = p.token AND s.chain = p.chain
                                    ORDER BY s.created_at DESC LIMIT 1)
              ORDER BY b.created_at DESC LIMIT 1) AS backtest
     FROM positions p
     LEFT JOIN LATERAL (
       SELECT raw_data->'baseToken'->>'symbol' AS symbol
       FROM signals s WHERE s.token = p.token ORDER BY s.created_at DESC LIMIT 1
     ) sym ON TRUE
     WHERE p.status = 'closed'
       AND p.pnl_pct IS NOT NULL
       AND ABS(p.pnl_pct) >= $1`,
    [minPnl],
  );

  // Augment: risk-guard blocks are negative examples (§11.1 step 5).
  const blocks = await query<{ payload: Record<string, unknown> | null; reason?: unknown }>(
    `SELECT payload FROM audit_log
     WHERE action = 'risk_block' AND created_at >= NOW() - interval '30 days'
     LIMIT 200`,
  );

  await mkdir(args.out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `${args.out}/luxy-sft-${stamp}.jsonl`;
  let good = 0;
  let bad = 0;

  for (const row of res.rows) {
    const label: 'good' | 'bad' = Number(row.pnl_pct) > 0 ? 'good' : 'bad';
    label === 'good' ? good++ : bad++;
    const example = buildExample(row, label);
    await appendFile(file, `${JSON.stringify(example)}\n`);
  }

  for (const b of blocks.rows) {
    const payload = b.payload ?? {};
    const example = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `SIGNAL (blocked by risk guard): ${JSON.stringify(payload).slice(0, 600)}\nDecide the next action.`,
        },
        {
          role: 'assistant',
          content: JSON.stringify({
            action: 'hold',
            reasoning: `risk guard blocked: ${String((payload as { reason?: string }).reason ?? 'limit reached')} — never attempt to circumvent hard limits`,
            confidence: 0.2,
          }),
        },
      ],
      outcome: 'bad',
      actual_pnl_pct: 0,
    };
    bad++;
    await appendFile(file, `${JSON.stringify(example)}\n`);
  }

  // Record dataset version for model_evals traceability (§8.1).
  const datasetVersion = `luxy-sft-${stamp}`;
  try {
    await query(
      `INSERT INTO model_evals (model, dataset_version, metrics, notes)
       VALUES ('(pending training)', $1, $2, $3)`,
      [
        datasetVersion,
        JSON.stringify({ examples_good: good, examples_bad: bad, source: 'ft:export' }),
        `exported from runtime history: ${good + bad} examples (min |pnl| ${args.minPnlPct}%)`,
      ],
    );
  } catch (err) {
    log.debug({ err }, 'model_evals registration skipped (table may not exist yet)');
  }

  console.log(`\n=== LUXY SFT EXPORT ===`);
  console.log(`file: ${file}`);
  console.log(`examples: ${good + bad} (good=${good}, bad=${bad}, incl. ${blocks.rows.length} risk-block augmentations)`);
  console.log(`dry_run mode: ${config.DRY_RUN} — datasets from dry-run sessions must be labeled as such before training\n`);

  await pool.end();
}

main().catch((err) => {
  log.fatal({ err }, 'export failed');
  process.exit(1);
});
