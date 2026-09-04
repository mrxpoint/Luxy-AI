/**
 * Polymarket Prediction Market Agent (BLUEPRINT.md §9.4 / §14 Phase 3).
 *
 * Loop (30 min): fetch open markets → LLM probability estimate → edge
 * detection vs CLOB midpoint → high-edge signals become buy-side intents
 * (GTC marketable limits) → persist + queue + notify.
 *
 * Runs fully in dry-run: the executor simulates fills until live keys are
 * provisioned. Run: pnpm dev:polymarket
 */
import { config } from '../../config/index.js';
import { query } from '../../db/pool.js';
import { audit } from '../../db/audit.js';
import { intentQueue, notify } from '../../redis/queues.js';
import { logger } from '../../utils/logger.js';
import type { LuxyIntent } from '../../types/index.js';
import { scanPolymarketSignals } from './signals.js';

const log = logger.child({ module: 'polymarket-agent' });

async function cycle(): Promise<void> {
  const signals = await scanPolymarketSignals();
  log.info({ found: signals.length }, 'polymarket cycle');

  for (const s of signals.slice(0, 3)) {
    // Buy the underpriced side. edge > 0 → model says Yes is cheap;
    // edge < 0 → model says Yes is rich → express as short (sell) side.
    const side = s.edge > 0 ? 'long' : 'short';
    const sizeUsd = Math.min(50, Math.max(5, Math.round(s.liquidityUsd * 0.002)));

    const intent: LuxyIntent = {
      action: 'entry',
      agent: 'polymarket',
      chain: 'polymarket',
      token: s.conditionId,
      symbol: s.slug,
      side,
      sizeUsd,
      reasoning: `"${s.question}" — market ${(s.marketPrice * 100).toFixed(0)}¢ vs model ${(s.modelProbability * 100).toFixed(0)}¢ (edge ${(s.edge * 100).toFixed(0)}¢, ${s.outcome}), GTC marketable limit`,
      confidence: Math.min(0.9, Math.abs(s.edge) * 4),
      createdAt: new Date().toISOString(),
    };
    await intentQueue.add('intent', intent);

    try {
      await query(
        `INSERT INTO signals (source, agent, chain, token, symbol, score, llm_reason, llm_evaluated, raw_data)
         VALUES ('polymarket', 'polymarket', 'polymarket', $1, $2, $3, $4, TRUE, $5)`,
        [
          s.conditionId,
          s.slug,
          s.score,
          s.question,
          JSON.stringify(s),
        ],
      );
    } catch (err) {
      log.debug({ err }, 'signal persist skipped');
    }

    await notify(
      `[POLY] ${s.slug} — market ${(s.marketPrice * 100).toFixed(0)}¢ vs model ${(s.modelProbability * 100).toFixed(0)}¢ → ${side} $${sizeUsd}`,
      'polymarket',
    );
    await audit('polymarket-agent', 'edge_signal', { signal: s });
  }
}

async function main(): Promise<void> {
  log.info(
    { intervalMin: config.POLYMARKET_INTERVAL_MIN, minEdge: config.POLYMARKET_MIN_EDGE, dryRun: config.DRY_RUN },
    'polymarket agent starting',
  );
  await cycle().catch((err) => log.error({ err }, 'polymarket cycle failed'));
  setInterval(
    () => cycle().catch((err) => log.error({ err }, 'polymarket cycle failed')),
    config.POLYMARKET_INTERVAL_MIN * 60_000,
  );
}

main().catch((err) => {
  log.fatal({ err }, 'polymarket agent crashed');
  process.exit(1);
});
