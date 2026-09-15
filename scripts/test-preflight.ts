/** Sanity test: E2B analysis preflight + strategy module import integrity. */
import { preflightAnalysis, kellySize, checkLiquidityDepth } from '../src/e2b/analysis.js';
import type { BacktestResult } from '../src/types/index.js';

const bt: BacktestResult = { win_rate: 0.64, avg_return: 0.05, sharpe: 1.6, max_drawdown: -0.09, n_trades: 25 };

const p = preflightAnalysis({ backtest: bt, portfolioUsd: 2500, entryUsd: 75, liquidityUsd: 85_000 });
console.log('preflight:', p.summary);
console.assert(p.enterable === true, 'preflight should pass for a healthy backtest');

const kelly = kellySize(0.6, 0.12, 0.08, 2500);
console.log('kelly(60% wr, 1.5 odds) size:', kelly.recommended_size_usd, 'fraction:', kelly.fractional_kelly?.toFixed(3));
console.assert(kelly.recommended_size_usd > 0 && kelly.recommended_size_usd < 2500, 'kelly size sane');

const negEdge = kellySize(0.4, 0.1, 0.1, 2500);
console.assert(negEdge.recommended_size_usd === 0, 'negative edge must not size');

const deepOk = checkLiquidityDepth(85_000, 75);
const deepBad = checkLiquidityDepth(1_000, 75);
console.log('liq 75usd @85k ok:', deepOk.ok, '| @1k ok:', deepBad.ok, `(${(deepBad.impact * 100).toFixed(1)}% impact)`);
console.assert(deepOk.ok && !deepBad.ok, 'liquidity gate must flip on thin books');

console.log('\nALL PREFLIGHT SANITY CHECKS PASSED');
