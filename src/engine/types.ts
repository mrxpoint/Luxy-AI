/**
 * LuxyEngine types — BLUEPRINT.md §3.1
 *
 * Quantitative decision layer that sits between the screener and the optional LLM.
 * Never executes trades; only produces structured predictions.
 */

export type EngineBackend = 'baseline' | 'lightgbm' | 'xgboost' | 'catboost' | 'pytorch';
export type EngineMode = 'engine_only' | 'engine_plus_llm' | 'llm_only';
export type EngineActionBias = 'entry' | 'skip' | 'watch' | 'exit';

export interface FeatureContribution {
  name: string;
  contribution: number;
}

export interface LuxyEnginePrediction {
  score: number;
  confidence: number;
  action_bias: EngineActionBias;
  top_features: FeatureContribution[];
  model: EngineBackend;
  model_version: string;
  raw_features: Record<string, number>;
  inference_ms: number;
  created_at: string;
}

export interface EngineContext {
  /** Optional HiveMind / portfolio hints for soft features */
  hivemindHitRate?: number;
  openPositions?: number;
  dailyDrawdownPct?: number;
}

export interface ModelMeta {
  id: number;
  backend: EngineBackend;
  version: string;
  agent: string;
  metrics: Record<string, unknown>;
  artifact_path: string | null;
  created_at: string;
}
