/**
 * Quick sanity check for the momentum backtest engine.
 * Run: pnpm exec tsx scripts/test-backtest.ts
 */
import { runMomentumBacktest } from '../src/e2b/backtest.js';

// Synthetic uptrend with pullbacks: 60 candles.
const candles = Array.from({ length: 60 }, (_, i) => {
  const base = 100 + i * 0.5 + Math.sin(i / 3) * 2;
  return { t: i, o: base, h: base * 1.01, l: base * 0.99, c: base * 1.002, v: 1000 };
});

console.log('uptrend backtest:', JSON.stringify(runMomentumBacktest(candles)));
console.log('empty-safe:', JSON.stringify(runMomentumBacktest([])));
console.log('short-safe:', JSON.stringify(runMomentumBacktest(candles.slice(0, 5))));
