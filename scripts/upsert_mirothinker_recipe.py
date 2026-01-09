#!/usr/bin/env python3
"""Upsert MiroThinker-v1.5-235B-AWQ-4bit recipe into the database."""
from __future__ import annotations

import sys
from pathlib import Path

def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root))

    from controller.models import Backend, Recipe
    from controller.store import RecipeStore

    # MiroThinker recipe - based on Qwen3-235B-A22B-Thinking-2507
    # IMPORTANT: Uses deepseek_r1 reasoning parser (NOT qwen3) to avoid <think> tag corruption
    # Tool calls use MCP format (<use_mcp_tool>) - parsed by LiteLLM callback, not vLLM
    recipe = Recipe(
        id="mirothinker-v1.5-235b-awq-4bit",
        name="MiroThinker-v1.5-235B-AWQ-4bit",
        model_path="/mnt/llm_models/MiroThinker-v1.5-235B-AWQ-4bit",
        backend=Backend.VLLM,
        tensor_parallel_size=8,
        max_model_len=262144,
        gpu_memory_utilization=0.95,
        max_num_seqs=32,
        kv_cache_dtype="fp8",
        quantization="awq_marlin",
        dtype="float16",
        trust_remote_code=True,
        served_model_name="MiroThinker-v1.5-235B-AWQ-4bit",
        tool_call_parser=None,        # MiroThinker uses MCP format - parsed by LiteLLM callback
        reasoning_parser="deepseek_r1",  # Correct parser for Qwen3-Thinking-2507 base model
        enable_auto_tool_choice=False,   # Let LiteLLM callback handle tool parsing
        thinking_mode="balanced",
        max_thinking_tokens=32768,
        extra_args={
            "enable-chunked-prefill": True,
            "enable-prefix-caching": True,
        },
    )

    db_path = repo_root / "data" / "recipes.db"
    store = RecipeStore(db_path)
    store.save(recipe)
    print(f"Upserted recipe '{recipe.id}' into {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
