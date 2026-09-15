#!/usr/bin/env python3
"""
Optional LightGBM trainer for LuxyEngine.

Reads JSONL feature rows exported by:
  pnpm exec tsx -e '...'  or a future export-engine-rows script

Each line: {"features": {...}, "label": 0|1}

Writes models/engine-lgbm-<stamp>.txt (LightGBM text model) + metrics JSON.
Requires: pip install lightgbm scikit-learn

Usage:
  python scripts/python/train_engine_lgbm.py --input data/training/engine-rows.jsonl --out models
"""
from __future__ import annotations
import argparse, json, time
from pathlib import Path

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default="models")
    args = ap.parse_args()

    try:
        import lightgbm as lgb
        import numpy as np
    except ImportError:
        raise SystemExit("Install lightgbm and numpy: pip install lightgbm numpy scikit-learn")

    rows = []
    with open(args.input) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    if len(rows) < 20:
        raise SystemExit(f"need ≥20 rows, got {len(rows)}")

    keys = sorted({k for r in rows for k in r["features"].keys()})
    X = np.array([[float(r["features"].get(k, 0.0)) for k in keys] for r in rows])
    y = np.array([int(r["label"]) for r in rows])

    dtrain = lgb.Dataset(X, label=y, feature_name=keys)
    params = {
        "objective": "binary",
        "metric": "binary_logloss",
        "learning_rate": 0.05,
        "num_leaves": 31,
        "verbosity": -1,
    }
    model = lgb.train(params, dtrain, num_boost_round=120)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    model_path = out / f"engine-lgbm-{stamp}.txt"
    model.save_model(str(model_path))
    meta = {
        "backend": "lightgbm",
        "version": f"lgbm-{stamp}",
        "feature_names": keys,
        "samples": len(rows),
        "artifact_path": str(model_path),
    }
    (out / f"engine-lgbm-{stamp}.meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))
    print("Note: Node runtime still uses logistic JSON artifacts until a native LGBM loader is added.")
    print("Export logistic-compatible weights via `pnpm engine:train` for live inference today.")

if __name__ == "__main__":
    main()
