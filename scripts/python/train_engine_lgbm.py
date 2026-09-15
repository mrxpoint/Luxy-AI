#!/usr/bin/env python3
"""
Train LightGBM and export a JSON tree ensemble for Node (src/engine/lgbm.ts).

Input JSONL lines: {"features": {...}, "label": 0|1}
Output:
  models/engine-lgbm-<stamp>.json   — runtime artifact for LuxyEngine
  models/engine-lgbm-<stamp>.txt    — native LightGBM text (optional)

Usage:
  pip install lightgbm numpy scikit-learn
  python scripts/python/train_engine_lgbm.py --input data/training/engine-rows.jsonl
"""
from __future__ import annotations
import argparse, json, time
from pathlib import Path

def trees_to_json(model, feature_names: list[str]) -> list[dict]:
    """Convert LightGBM booster dump to evaluable JSON trees."""
    dump = model.dump_model()
    trees = []
    for t in dump.get("tree_info", []):
        tree_struct = t.get("tree_structure", {})
        nodes: list[dict] = []

        def walk(node: dict) -> int:
            idx = len(nodes)
            nodes.append({})
            if "leaf_value" in node and "split_feature" not in node:
                nodes[idx] = {"leaf_value": float(node["leaf_value"])}
                return idx
            # internal
            left_i = walk(node["left_child"])
            right_i = walk(node["right_child"])
            nodes[idx] = {
                "split_feature": int(node.get("split_feature", 0)),
                "threshold": float(node.get("threshold", 0.0)),
                "left": left_i,
                "right": right_i,
                "leaf_value": float(node.get("leaf_value", 0.0)) if "leaf_value" in node else None,
            }
            # clean None leaf_value on internal nodes
            if nodes[idx]["leaf_value"] is None:
                del nodes[idx]["leaf_value"]
            return idx

        if tree_struct:
            walk(tree_struct)
        trees.append({"nodes": nodes})
    return trees

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default="models")
    args = ap.parse_args()

    try:
        import lightgbm as lgb
        import numpy as np
    except ImportError as e:
        raise SystemExit(f"Install deps: pip install lightgbm numpy scikit-learn\n{e}")

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
    model = lgb.train(params, dtrain, num_boost_round=80)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")

    txt_path = out / f"engine-lgbm-{stamp}.txt"
    model.save_model(str(txt_path))

    artifact = {
        "backend": "lightgbm",
        "version": f"lgbm-{stamp}",
        "feature_names": keys,
        "objective": "binary",
        "init_score": 0.0,
        "trees": trees_to_json(model, keys),
        "metrics": {
            "samples": len(rows),
            "winRate": float(y.mean()),
        },
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    json_path = out / f"engine-lgbm-{stamp}.json"
    json_path.write_text(json.dumps(artifact, indent=2))
    print(json.dumps({"ok": True, "artifact": str(json_path), "txt": str(txt_path), **artifact["metrics"]}, indent=2))
    print("Activate in Luxy: set LUXY_ENGINE_BACKEND=lightgbm and register artifact_path in engine_models (or drop JSON in models/).")

if __name__ == "__main__":
    main()
