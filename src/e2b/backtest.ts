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
  return {
    win_rate: returns.filter((r) => r > 0).length / returns.length,
    avg_return: mean,
    sharpe: mean / (sd + 1e-8) * Math.sqrt(252),
    max_drawdown: Math.min(...returns),
    n_trades: returns.length,
  };
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
