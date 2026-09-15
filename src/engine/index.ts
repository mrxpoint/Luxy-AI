/**
 * LuxyEngine — quantitative decision layer (BLUEPRINT.md §3.1).
 *
 * Modes:
 *   engine_only      → prediction maps directly toward intents (agent may skip LLM)
 *   engine_plus_llm  → prediction injected into LLM context (default)
 *   llm_only         → engine still scores for logging/training, LLM decides
 *
 * Backends lightgbm/xgboost/catboost/pytorch: reserved for trained artifacts.
 * Until an artifact is registered, those backends fall back to baseline with a warning.
 */
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { ScoredCandidate } from '../types/index.js';
import { extractFeatures } from './features.js';
import { predictBaseline } from './baseline.js';
import type {
  EngineBackend,
  EngineContext,
  EngineMode,
  LuxyEnginePrediction,
} from './types.js';

export type {
  EngineBackend,
  EngineMode,
  EngineActionBias,
  LuxyEnginePrediction,
  FeatureContribution,
  ModelMeta,
  EngineContext,
} from './types.js';

export { extractFeatures } from './features.js';
export { predictBaseline, BASELINE_MODEL_VERSION } from './baseline.js';

const log = logger.child({ module: 'luxy-engine' });

export function engineEnabled(): boolean {
  return config.LUXY_ENGINE_ENABLED;
}

export function engineMode(): EngineMode {
  return config.LUXY_ENGINE_MODE;
}

export function engineBackend(): EngineBackend {
  return config.LUXY_ENGINE_BACKEND;
}

/**
 * Run inference for one candidate.
 * Always returns a prediction when called; callers gate on engineEnabled()/mode.
 */
export async function predict(
  candidate: ScoredCandidate,
  ctx: EngineContext = {},
): Promise<LuxyEnginePrediction> {
  const t0 = Date.now();
  const features = extractFeatures(candidate, ctx);
  const backend = engineBackend();

  if (backend === 'baseline') {
    return predictBaseline(features, t0);
  }

  // Future: load joblib/onnx artifact for lightgbm|xgboost|catboost|pytorch
  log.warn(
    { backend, version: config.LUXY_ENGINE_MODEL_VERSION },
    'trained artifact not loaded — falling back to baseline scorer',
  );
  const pred = predictBaseline(features, t0);
  return {
    ...pred,
    model: backend,
    model_version: `${config.LUXY_ENGINE_MODEL_VERSION}+baseline-fallback`,
  };
}

/** Map engine bias → intent action for engine_only mode. */
export function biasToAction(
  bias: LuxyEnginePrediction['action_bias'],
): 'entry' | 'hold' | 'exit' {
  if (bias === 'entry') return 'entry';
  if (bias === 'exit') return 'exit';
  return 'hold';
}

/** Human-readable block for LLM prompts. */
export function formatPredictionForPrompt(p: LuxyEnginePrediction): string {
  const tops = p.top_features
    .slice(0, 5)
    .map((f) => `${f.name}=${f.contribution.toFixed(3)}`)
    .join(', ');
  return [
    `score=${p.score.toFixed(3)} confidence=${p.confidence.toFixed(3)}`,
    `action_bias=${p.action_bias}`,
    `model=${p.model}@${p.model_version} (${p.inference_ms}ms)`,
    `top_features: ${tops || '—'}`,
  ].join('\n');
}
