#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Upsert the DeepSeek W3A16 Transformers recipe into controller.db")
    parser.add_argument(
        "--db",
        default=str(Path(__file__).resolve().parents[2] / "data" / "controller.db"),
        help="Path to controller SQLite DB (default: ./data/controller.db)",
    )
    parser.add_argument(
        "--model-path",
        default="/home/ser/models/DeepSeek-V3.2-REAP-345B-W3A16",
        help="Local model directory path",
    )
    parser.add_argument(
        "--python-path",
        default="/opt/venvs/active/deepseek-w3a16/bin/python",
        help="Python to launch uvicorn/transformers server",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo_root))

    from controller.models import Backend, Recipe  # noqa: PLC0415
    from controller.store import RecipeStore  # noqa: PLC0415

    recipe = Recipe(
        id="deepseek-v3.2-reap-w3a16",
        name="DeepSeek V3.2 REAP 345B (W3A16) — Transformers",
        model_path=args.model_path,
        backend=Backend.TRANSFORMERS,
        max_model_len=65536,
        kv_cache_dtype="fp8",  # bookkeeping only for this backend
        quantization="auto-round",
        dtype="float16",
        served_model_name="deepseek-v3.2-reap-w3a16",
        python_path=args.python_path,
        extra_args={
            "cuda_visible_devices": "0,1,2,3,4,5,6,7",
            "env_vars": {
                "DEEPSEEK_MODEL_PATH": args.model_path,
                "DEEPSEEK_SERVED_MODEL_NAME": "deepseek-v3.2-reap-w3a16",
                "DEEPSEEK_MAX_CONTEXT_TOKENS": "65536",
                "DEEPSEEK_MAX_MEMORY_GIB": "18",
                "DEEPSEEK_OFFLOAD_DIR": "/tmp/deepseek_w3a16_offload",
                "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
            },
        },
    )

    store = RecipeStore(Path(args.db))
    store.save(recipe)
    print(f"Upserted recipe {recipe.id} into {args.db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

