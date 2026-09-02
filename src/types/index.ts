/**
 * Shared domain types for the Luxy AI system.
 * These mirror BLUEPRINT.md §2.2 (data flow), §3.2 (LuxyIntent), §6 (agents).
 */

export type AgentName = 'meme' | 'perps' | 'lp' | 'narrative';
export type Chain = 'solana' | 'base' | 'ethereum' | 'hyperliquid';
export type IntentAction = 'entry' | 'exit' | 'hold' | 'alert';
export type LlmVerdict = 'strong' | 'moderate' | 'weak' | 'skip';

/** Backtest metrics produced by the E2B sandbox or the local TS fallback. */
export interface BacktestResult {
  win_rate: number;
  avg_return: number;
  sharpe: number;
  max_drawdown: number;
  n_trades: number;
}

/** A screener/narrative candidate that passed rule-based + LLM filtering. */
export interface ScoredCandidate {
  id: string;
  source: 'screener' | 'narrative';
  agent: AgentName;
  chain: Chain;
  token: string;
  symbol: string;
  name?: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  txns24h: number;
  marketCap?: number;
  /** candles when available (OHLCV, oldest first) — used for in-session backtest */
  candles?: Candle[];
  score: number;
  llmVerdict?: LlmVerdict;
  llmReason?: string;
  rawData: Record<string, unknown>;
  createdAt: string;
}

export interface Candle {
  t: number; // open time (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Structured decision output — the ONLY thing an LLM may emit (BLUEPRINT §1.2 #3). */
export interface LuxyIntent {
  action: IntentAction;
  agent: AgentName;
  chain: Chain;
  token?: string;
  symbol?: string;
  poolId?: string;
  market?: string; // hyperliquid market, e.g. "BTC"
  side?: 'long' | 'short';
  sizeUsd?: number;
  reasoning: string;
  confidence: number;
  backtest?: BacktestResult;
  createdAt: string;
}

/** A narrative/hype signal produced by the narrative agent. */
export interface NarrativeSignal {
  token: string;
  hypeLevel: 'low' | 'medium' | 'high';
  sentiment: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  confidence: number;
  sourceCount: number;
  sources: string[];
}

/** LP pool candidate scored by the Hunter. */
export interface PoolCandidate {
  poolId: string;
  chain: Chain;
  pairLabel: string;
  address: string;
  tvlUsd: number;
  volume24h: number;
  fees24h: number;
  feeTvlRatio: number;
  binStep: number;
  organicScore: number;
  score: number;
}

/** Perps market classification (BLUEPRINT.md §6.4). */
export interface PerpsSignal {
  market: string;
  direction: 'long' | 'short' | 'neutral';
  score: number;
  momentum24h: number;
  sma12h: number;
  volatility: number;
  price: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason: string;
}

export interface PortfolioState {
  portfolioUsd: number;
  openPositions: number;
  todayRealizedPnlUsd: number;
  dailyDrawdownPct: number;
}

/** Notification queue payload (all agents → telegram-bot). */
export interface NotificationJob {
  text: string;
  type: 'signal' | 'entry' | 'exit' | 'alert' | 'lp' | 'hype' | 'info';
}
