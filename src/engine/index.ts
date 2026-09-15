/**
 * LuxyEngine — quantitative decision layer (BLUEPRINT.md §3.1).
 *
 * Modes:
 *   engine_only      → prediction maps directly toward intents (agent may skip LLM)
 *   engine_plus_llm  → prediction injected into LLM context (default)
 *   llm_only         → engine still scores for logging/training, LLM decides
 *
 * Artifacts: JSON logistic weights from trainAndSaveArtifact (or calibrate).
 * Heavy backends (lightgbm/…) fall back to the active baseline artifact until
 * a native loader is registered.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import type { ScoredCandidate } from '../types/index.js';
import { extractFeatures } from './features.js';
import { predictBaseline } from './baseline.js';
import { loadLgbmArtifact, predictLgbm, type LgbmArtifact } from './lgbm.js';
import type {
  EngineBackend,
  EngineContext,
  EngineMode,
  LuxyEnginePrediction,
} from './types.js';
import type { TrainedArtifact } from './train.js';

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
export { trainAndSaveArtifact, exportTrainingRows, fitLogisticWeights } from './train.js';
export { calibrateBaselineFromPositions } from './calibrate.js';

const log = logger.child({ module: 'luxy-engine' });

let cachedArtifact: TrainedArtifact | null = null;
let cacheLoaded = false;

export function engineEnabled(): boolean {
  return config.LUXY_ENGINE_ENABLED;
}

export function engineMode(): EngineMode {
  return config.LUXY_ENGINE_MODE;
}

export function engineBackend(): EngineBackend {
  return config.LUXY_ENGINE_BACKEND;
}

async function loadActiveArtifact(): Promise<TrainedArtifact | null> {
  if (cacheLoaded) return cachedArtifact;
  cacheLoaded = true;

  // 1) Registry path
  try {
    const res = await query<{ artifact_path: string | null; version: string }>(
      `SELECT artifact_path, version FROM engine_models
       WHERE active = TRUE AND agent = 'meme'
       ORDER BY created_at DESC LIMIT 1`,
    );
    const path = res.rows[0]?.artifact_path;
    if (path && existsSync(path)) {
      cachedArtifact = JSON.parse(readFileSync(path, 'utf8')) as TrainedArtifact;
      log.info({ version: cachedArtifact.version, path }, 'loaded active engine artifact');
      return cachedArtifact;
    }
  } catch {
    // schema missing or no active model
  }

  // 2) Latest file under models/
  try {
    const dir = resolve(process.cwd(), 'models');
    if (existsSync(dir)) {
      const files = readdirSync(dir)
        .filter((f) => (f.startsWith('engine-') || f.startsWith('engine-lgbm-')) && f.endsWith('.json'))
        .sort()
        .reverse();
      if (files[0]) {
        const path = resolve(dir, files[0]);
        cachedArtifact = JSON.parse(readFileSync(path, 'utf8')) as TrainedArtifact;
        log.info({ version: cachedArtifact.version, path }, 'loaded latest models/ artifact');
        return cachedArtifact;
      }
    }
  } catch (err) {
    log.debug({ err }, 'models/ scan failed');
  }

  return null;
}

/** Force reload on next predict (after train). */
export function clearArtifactCache(): void {
  cacheLoaded = false;
  cachedArtifact = null;
}

/**
 * Run inference for one candidate.
 */
export async function predict(
  candidate: ScoredCandidate,
  ctx: EngineContext = {},
): Promise<LuxyEnginePrediction> {
  const t0 = Date.now();
  const features = extractFeatures(candidate, ctx);
  const backend = engineBackend();
  const artifact = await loadActiveArtifact();

  if (artifact) {
    // LightGBM JSON ensemble
    if (
      (artifact as { backend?: string }).backend === 'lightgbm' ||
      backend === 'lightgbm'
    ) {
      const lgbm = artifact as unknown as LgbmArtifact;
      if (lgbm.trees && lgbm.feature_names) {
        return predictLgbm(features, lgbm, t0);
      }
    }
    // Logistic / baseline weights
    if ((artifact as { weights?: Record<string, number> }).weights) {
      const pred = predictBaseline(features, t0, {
        weights: (artifact as { weights: Record<string, number> }).weights,
        bias: (artifact as { bias: number }).bias,
        version: artifact.version,
      });
      return {
        ...pred,
        model: backend === 'baseline' ? 'baseline' : backend,
        model_version:
          backend === 'baseline'
            ? artifact.version
            : `${backend}@${artifact.version}+logistic-compat`,
      };
    }
  }

  if (backend !== 'baseline') {
    log.warn(
      { backend, version: config.LUXY_ENGINE_MODEL_VERSION },
      'no trained artifact — falling back to default baseline weights',
    );
  }

  const pred = predictBaseline(features, t0);
  return {
    ...pred,
    model: backend === 'baseline' ? 'baseline' : backend,
    model_version:
      backend === 'baseline'
        ? pred.model_version
        : `${config.LUXY_ENGINE_MODEL_VERSION}+baseline-fallback`,
  };
}

export function biasToAction(
  bias: LuxyEnginePrediction['action_bias'],
): 'entry' | 'hold' | 'exit' {
  if (bias === 'entry') return 'entry';
  if (bias === 'exit') return 'exit';
  return 'hold';
}

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
