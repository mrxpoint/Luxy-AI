import type { BacktestResult } from '../types/index.js';

export interface BacktestJobRequest {
  source: 'telegram' | 'web' | 'cli';
  userRef: string;
  venue: 'hyperliquid' | 'birdeye' | 'polymarket' | 'replay_signals';
  symbolOrMarket: string;
  interval?: string;
  from?: string;
  to?: string;
  days?: number;
  strategy?: string;
  params?: Record<string, unknown>;
  resolvedOnly?: boolean;
  eventFilter?: string;
  engine?: 'e2b' | 'local-ts' | 'luxy-engine';
}

export interface BacktestJobResult {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  metrics?: BacktestResult;
  chartPoints?: number;
  source?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}
