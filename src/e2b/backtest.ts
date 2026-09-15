/**
 * Local momentum backtest — TypeScript twin of the E2B python template
 * (BLUEPRINT.md §4.4 momentum_backtest.py).
 *
 * Used when the E2B sandbox is not configured (dry-run, local dev, CI).
 * Math is intentionally identical so results are comparable across engines:
 *
 *   sma      = rolling mean of close (sma_period)
 *   momentum = pct_change of close (momentum_period)
 *   entry    = close > sma AND momentum > threshold
 *   hold     = fixed number of candles, then exit at close
 */

export interface BacktestParams {
  smaPeriod?: number;
  momentumPeriod?: number;
  momentumThreshold?: number;
  holdPeriods?: number;
}

export interface CandleLike {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t?: number;
}

export interface BacktestMetrics {
  win_rate: number;
  avg_return: number;
  sharpe: number;
  max_drawdown: number;
  n_trades: number;
}

export function runMomentumBacktest(
  candles: CandleLike[],
  params: BacktestParams = {},
): BacktestMetrics {
  const smaPeriod = params.smaPeriod ?? 12;
  const momentumPeriod = params.momentumPeriod ?? 6;
  const threshold = params.momentumThreshold ?? 0.03;
  const hold = params.holdPeriods ?? 4;

  if (candles.length < smaPeriod + momentumPeriod + hold + 2) {
    return { win_rate: 0, avg_return: 0, sharpe: 0, max_drawdown: 0, n_trades: 0 };
  }

  const closes = candles.map((c) => c.c);
  const sma = rollingMean(closes, smaPeriod);

  const returns: number[] = [];
  for (let i = smaPeriod + momentumPeriod; i < closes.length - hold; i++) {
    const momentum = (closes[i]! - closes[i - momentumPeriod]!) / closes[i - momentumPeriod]!;
    if (closes[i]! > sma[i]! && momentum > threshold) {
      const entry = closes[i]!;
      const exit = closes[i + hold]!;
      returns.push((exit - entry) / entry);
    }
  }

  if (returns.length === 0) {
    return { win_rate: 0, avg_return: 0, sharpe: 0, max_drawdown: 0, n_trades: 0 };
  }

  const mean = avg(returns);
  const sd = std(returns);
  // Per-trade stats → annualized Sharpe: hold-period trades per year derived
  // from the candle cadence when timestamps are available (else no
  // annualization — reporting per-trade Sharpe is more honest than a wrong
  // ×√252 which assumed daily bars).
  const cadenceMin = inferCadenceMinutes(candles);
  const tradesPerYear = cadenceMin > 0 ? (365 * 24 * 60) / (cadenceMin * hold) : 0;
  const sharpe = tradesPerYear > 0 ? (mean / (sd + 1e-8)) * Math.sqrt(tradesPerYear) : mean / (sd + 1e-8);
  return {
    win_rate: returns.filter((r) => r > 0).length / returns.length,
    avg_return: mean,
    sharpe,
    max_drawdown: equityCurveDrawdown(returns),
    n_trades: returns.length,
  };
}

/** Median gap between candle timestamps in minutes (0 when unknown). */
function inferCadenceMinutes(candles: CandleLike[]): number {
  const ts = candles.filter((c) => typeof c.t === 'number').map((c) => c.t!);
  if (ts.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i]! - ts[i - 1]!;
    if (d > 0) gaps.push(d / 60_000);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/** Max peak-to-trough drawdown of the compounded equity curve of trade returns. */
function equityCurveDrawdown(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    const dd = equity / peak - 1;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

function rollingMean(xs: number[], w: number): Array<number | undefined> {
  const out: Array<number | undefined> = [];
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i]!;
    if (i >= w) sum -= xs[i - w]!;
    out.push(i >= w - 1 ? sum / w : undefined);
  }
  return out;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  const m = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - m) ** 2)));
}
