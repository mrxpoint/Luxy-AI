/**
 * E2B in-session sandbox terminal (BLUEPRINT.md §4).
 *
 * Every Luxy agent session gets an isolated sandbox where analysis code runs
 * and results feed back into the reasoning context. The custom `luxy-trading`
 * template ships pandas/numpy/ta; it must be built once with:
 *
 *   e2b template build --name luxy-trading   (see e2b/Dockerfile)
 *
 * When E2B_API_KEY is absent (local development / dry-run), callers fall
 * back to the TypeScript BacktestEngine which implements identical math —
 * see src/e2b/backtest.ts.
 */
export { LuxySandbox, type SandboxResult } from './sandbox.js';
export { runMomentumBacktest, type BacktestParams } from './backtest.js';
