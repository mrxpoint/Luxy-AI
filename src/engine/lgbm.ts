/**
 * LightGBM-compatible JSON tree ensemble evaluator (Node runtime).
 *
 * Artifacts are produced by scripts/python/train_engine_lgbm.py
 * (engine-lgbm-*.json) with shape:
 * {
 *   backend: "lightgbm",
 *   version: string,
 *   feature_names: string[],
 *   objective: "binary",
 *   trees: [{ nodes: [{ split_feature?, threshold?, left?, right?, leaf_value? }] }],
 *   init_score?: number
 * }
 *
 * No native LightGBM C++ binding required.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { LuxyEnginePrediction, FeatureContribution } from './types.js';

export interface LgbmNode {
  split_feature?: number;
  threshold?: number;
  left?: number;
  right?: number;
  leaf_value?: number;
}

export interface LgbmTree {
  nodes: LgbmNode[];
}

export interface LgbmArtifact {
  backend: 'lightgbm';
  version: string;
  feature_names: string[];
  objective?: string;
  trees: LgbmTree[];
  init_score?: number;
}

export function loadLgbmArtifact(path: string): LgbmArtifact | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as LgbmArtifact;
  if (!raw.trees || !raw.feature_names) return null;
  return raw;
}

function evalTree(tree: LgbmTree, xs: number[]): number {
  let i = 0;
  const nodes = tree.nodes;
  for (let step = 0; step < 256; step++) {
    const n = nodes[i];
    if (!n) return 0;
    if (n.leaf_value !== undefined && n.split_feature === undefined) {
      return n.leaf_value;
    }
    if (n.leaf_value !== undefined && (n.left === undefined || n.right === undefined)) {
      return n.leaf_value;
    }
    const f = n.split_feature ?? 0;
    const thr = n.threshold ?? 0;
    const goLeft = (xs[f] ?? 0) <= thr;
    const next = goLeft ? n.left : n.right;
    if (next === undefined || next === null) {
      return n.leaf_value ?? 0;
    }
    i = next;
  }
  return 0;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function predictLgbm(
  features: Record<string, number>,
  artifact: LgbmArtifact,
  startedAt: number,
): LuxyEnginePrediction {
  const xs = artifact.feature_names.map((name) => features[name] ?? 0);
  let raw = artifact.init_score ?? 0;
  for (const tree of artifact.trees) {
    raw += evalTree(tree, xs);
  }
  const score = sigmoid(raw);

  // Approximate contributions: single-feature perturbation
  const contributions: FeatureContribution[] = [];
  for (let i = 0; i < artifact.feature_names.length; i++) {
    const name = artifact.feature_names[i]!;
    const xs2 = xs.slice();
    xs2[i] = 0;
    let raw0 = artifact.init_score ?? 0;
    for (const tree of artifact.trees) raw0 += evalTree(tree, xs2);
    contributions.push({ name, contribution: sigmoid(raw) - sigmoid(raw0) });
  }
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  let action_bias: LuxyEnginePrediction['action_bias'] = 'skip';
  if (score >= 0.62) action_bias = 'entry';
  else if (score >= 0.48) action_bias = 'watch';

  return {
    score,
    confidence: Math.min(0.95, 0.4 + Math.abs(score - 0.5) * 1.1),
    action_bias,
    top_features: contributions.slice(0, 8),
    model: 'lightgbm',
    model_version: artifact.version,
    raw_features: { ...features },
    inference_ms: Math.max(0, Date.now() - startedAt),
    created_at: new Date().toISOString(),
  };
}
