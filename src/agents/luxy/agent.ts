/**
 * Luxy Main Agent — decision core (BLUEPRINT.md §4.2 + §6.1).
 *
 * Processing pipeline per signal:
 *   1. Get signal context (scored candidate from the queue)
 *   2. Fetch OHLCV (Birdeye) when available
 *   3. Validate in code: momentum backtest via E2B sandbox, or the
 *      identical local TS engine when E2B is not configured
 *   4. Prime the LLM with context + backtest metrics + HiveMind lessons
 *   5. Parse structured LuxyIntent JSON
 *   6. Submit to the intents queue (executor enforces risk)
 */
import { query } from '../../db/pool.js';
import { audit } from '../../db/audit.js';
import { intentQueue, notify } from '../../redis/queues.js';
import { luxyLLM, tryChat } from '../../llm/adapter.js';
import {
  LUXY_SYSTEM_PROMPT,
  buildSignalEvaluationMessage,
} from '../../llm/prompts/luxy-system.js';
import { fetchOhlcv, birdeyeConfigured } from '../../screener/birdeye.js';
import { runMomentumBacktest } from '../../e2b/backtest.js';
import { preflightAnalysis } from '../../e2b/analysis.js';
import { LuxySandbox } from '../../e2b/sandbox.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import type { BacktestResult, LuxyIntent, ScoredCandidate } from '../../types/index.js';

const log = logger.child({ module: 'luxy-agent' });

const HIVEMIND_MAX_LESSONS = 10;

/** HiveMind lessons primed into every decision context (BLUEPRINT §1.2 #4). */
export async function getHivemindLessons(limit = HIVEMIND_MAX_LESSONS): Promise<string[]> {
  try {
    const res = await query<{ pool_id: string; action: string; outcome_summary: string | null }>(
      `SELECT pool_id, action, outcome_summary FROM lp_lessons ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map(
      (r) => `[HIVEMIND] Pool ${r.pool_id}: ${r.action.toUpperCase()} — ${r.outcome_summary ?? 'no summary'}`,
    );
  } catch {
    return [];
  }
}

/** Run the momentum backtest in E2B when available, else local TS twin. */
export async function validateInCode(candidate: ScoredCandidate): Promise<{
  backtest: BacktestResult | null;
  engine: 'e2b' | 'local-ts' | 'none';
}> {
  let candles = candidate.candles ?? [];
  if (candles.length === 0 && birdeyeConfigured()) {
    try {
      candles = await fetchOhlcv(candidate.token, 24);
    } catch (err) {
      log.debug({ err }, 'ohlcv fetch failed for backtest');
    }
  }
  if (candles.length < 24) return { backtest: null, engine: 'none' };

  const sandbox = new LuxySandbox();
  if (sandbox.available) {
    try {
      await sandbox.init();
      const code = momentumBacktestPython(candles);
      const result = await sandbox.run(code);
      await sandbox.close();
      if (!result.error) {
        const parsed = JSON.parse(result.stdout.trim()) as BacktestResult;
        return { backtest: parsed, engine: 'e2b' };
      }
      log.warn({ error: result.error }, 'e2b backtest failed — falling back to local engine');
    } catch (err) {
      log.warn({ err }, 'e2b sandbox unavailable — falling back to local engine');
      await sandbox.close();
    }
  }

  const metrics = runMomentumBacktest(candles);
  return { backtest: metrics, engine: 'local-ts' };
}

function momentumBacktestPython(candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>): string {
  const data = JSON.stringify(candles);
  return `
import json, pandas as pd, numpy as np
candles = json.loads('''${data}''')
df = pd.DataFrame(candles)
df['close'] = df['c'].astype(float)
df['sma'] = df['close'].rolling(12).mean()
df['momentum'] = df['close'].pct_change(6)
df['entry'] = (df['close'] > df['sma']) & (df['momentum'] > 0.03)
returns = []
closes = df['close'].tolist()
entries = df['entry'].tolist()
for i, e in enumerate(entries):
    if e and i + 4 < len(closes):
        returns.append((closes[i+4] - closes[i]) / closes[i])
if not returns:
    print(json.dumps({'win_rate': 0, 'avg_return': 0, 'sharpe': 0, 'max_drawdown': 0, 'n_trades': 0}))
else:
    arr = np.array(returns)
    print(json.dumps({
        'win_rate': float(np.mean(arr > 0)),
        'avg_return': float(np.mean(arr)),
        'sharpe': float(np.mean(arr) / (np.std(arr) + 1e-8) * np.sqrt(252)),
        'max_drawdown': float(np.min(arr)),
        'n_trades': int(len(arr)),
    }))
`.trim();
}

/** Cache backtest for the future fine-tuning dataset (BLUEPRINT §11). */
async function recordBacktest(signalToken: string, engine: string, result: BacktestResult | null): Promise<void> {
  try {
    await query(
      `INSERT INTO backtest_runs (signal_id, engine, params, result)
       VALUES ((SELECT id FROM signals WHERE token = $1 ORDER BY created_at DESC LIMIT 1), $2, $3, $4)`,
      [signalToken, engine, JSON.stringify({ strategy: 'momentum', sma: 12, mom: 6, thr: 0.03 }), JSON.stringify(result)],
    );
  } catch {
    // backtest caching is best-effort
  }
}

/** Core decision for one candidate. Returns the emitted intent (or hold). */
export async function evaluateCandidate(candidate: ScoredCandidate): Promise<LuxyIntent> {
  const baseIntent: LuxyIntent = {
    action: 'hold',
    agent: 'meme',
    chain: candidate.chain,
    token: candidate.token,
    symbol: candidate.symbol,
    reasoning: 'evaluation pending',
    confidence: 0,
    createdAt: new Date().toISOString(),
  };

  const { backtest, engine } = await validateInCode(candidate);
  if (backtest) baseIntent.backtest = backtest;
  await recordBacktest(candidate.token, engine, backtest);

  // Preflight: Kelly sizing + liquidity depth (BLUEPRINT §4.6 steps 3-4).
  const preflight = backtest
    ? preflightAnalysis({
        backtest,
        portfolioUsd: config.PAPER_PORTFOLIO_USD,
        entryUsd: Math.min(config.PAPER_PORTFOLIO_USD * config.RISK_MAX_POSITION_PCT, candidate.liquidityUsd * 0.01),
        liquidityUsd: candidate.liquidityUsd,
      })
    : null;

  const lessons = await getHivemindLessons();
  const state = await portfolioSummary();

  const adapter = luxyLLM();
  const userMsg = buildSignalEvaluationMessage({
    candidateJson: JSON.stringify(
      {
        symbol: candidate.symbol,
        name: candidate.name,
        chain: candidate.chain,
        token: candidate.token,
        priceUsd: candidate.priceUsd,
        liquidityUsd: candidate.liquidityUsd,
        volume24h: candidate.volume24h,
        txns24h: candidate.txns24h,
        marketCap: candidate.marketCap,
        ruleScore: candidate.score,
        llmFilterVerdict: candidate.llmVerdict,
        source: candidate.source,
      },
      null,
      2,
    ),
    backtestJson: backtest ? JSON.stringify(backtest, null, 2) : null,
    preflightJson: preflight ? JSON.stringify(preflight, null, 2) : null,
    hivemindLessons: lessons,
    openPositions: state.openPositions,
    dailyDrawdownPct: state.dailyDrawdownPct,
  });

  const res = await tryChat(adapter, [{ role: 'user', content: userMsg }], LUXY_SYSTEM_PROMPT);
  if (!res) {
    return {
      ...baseIntent,
      reasoning: 'llm unavailable — defaulting to hold (fail-safe)',
      confidence: 0,
    };
  }

  const parsed = safeParseIntent(res.text);
  if (!parsed) {
    return {
      ...baseIntent,
      reasoning: `unparseable llm output — hold. raw: ${res.text.slice(0, 140)}`,
    };
  }

  return {
    ...baseIntent,
    action: parsed.action ?? 'hold',
    sizeUsd: parsed.sizeUsd,
    reasoning: parsed.reasoning ?? '',
    confidence: parsed.confidence ?? 0,
    backtest: backtest ?? parsed.backtest,
  };
}

async function portfolioSummary(): Promise<{ openPositions: number; dailyDrawdownPct: number }> {
  try {
    const open = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM positions WHERE status='open'`);
    const pnl = await query<{ pnl: number }>(
      `SELECT COALESCE(SUM(pnl_usd),0)::float AS pnl FROM positions
       WHERE status='closed' AND closed_at >= date_trunc('day', NOW())`,
    );
    const drawdown = Math.max(0, -(pnl.rows[0]?.pnl ?? 0) / config.PAPER_PORTFOLIO_USD);
    return { openPositions: open.rows[0]?.n ?? 0, dailyDrawdownPct: drawdown };
  } catch {
    return { openPositions: 0, dailyDrawdownPct: 0 };
  }
}

interface ParsedDecision {
  action?: LuxyIntent['action'];
  sizeUsd?: number;
  reasoning?: string;
  confidence?: number;
  backtest?: BacktestResult;
}

function safeParseIntent(text: string): ParsedDecision | null {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    return JSON.parse(cleaned.slice(start, end + 1)) as ParsedDecision;
  } catch {
    return null;
  }
}

/** Full queue-driven handler used by the worker in index.ts. */
export async function processCandidate(candidate: ScoredCandidate): Promise<LuxyIntent> {
  const intent = await evaluateCandidate(candidate);
  await intentQueue.add('intent', intent);
  log.info(
    { action: intent.action, symbol: candidate.symbol, confidence: intent.confidence },
    'intent emitted',
  );
  await audit('luxy', `intent_${intent.action}`, { intent });
  if (intent.action === 'entry') {
    await notify(
      `[DECISION] Entry intent for ${candidate.symbol}: $${(intent.sizeUsd ?? 0).toFixed(2)} — ${intent.reasoning.slice(0, 140)}`,
      'signal',
    );
  }
  return intent;
}
