"""Command builders for vLLM and SGLang backends."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import settings
from .models import Recipe


def _normalize_json_arg(value: Any) -> Any:
    """Normalize JSON-ish CLI arg payloads.

    vLLM expects underscore_separated keys inside JSON payloads (e.g.
    speculative_config.num_speculative_tokens). Users may naturally write YAML
    with kebab-case keys, so we normalize '-' to '_' recursively.
    """
    if isinstance(value, dict):
        return {str(k).replace("-", "_"): _normalize_json_arg(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_json_arg(v) for v in value]
    return value


def _get_extra_arg(extra_args: Dict[str, Any], key: str) -> Any:
    """Get extra_args value accepting both snake_case and kebab-case keys."""
    if key in extra_args:
        return extra_args[key]
    kebab = key.replace("_", "-")
    if kebab in extra_args:
        return extra_args[kebab]
    snake = key.replace("-", "_")
    if snake in extra_args:
        return extra_args[snake]
    return None


def _get_python_path(recipe: Recipe) -> Optional[str]:
    """Get Python path from recipe.python_path or extra_args.venv_path."""
    # Explicit python_path takes priority
    if recipe.python_path:
        return recipe.python_path

    # Check for venv_path in extra_args
    venv_path = _get_extra_arg(recipe.extra_args, "venv_path")
    if venv_path:
        python_bin = os.path.join(venv_path, "bin", "python")
        if os.path.exists(python_bin):
            return python_bin

    return None


def _get_default_reasoning_parser(recipe: Recipe) -> Optional[str]:
    """Auto-detect reasoning parser based on model name/path."""
    # Check model_path and served_model_name for model identification
    model_id = (recipe.served_model_name or recipe.model_path or "").lower()

    # MiniMax M2 models - must use append_think parser
    if "minimax" in model_id and ("m2" in model_id or "m-2" in model_id):
        return "minimax_m2_append_think"

    # GLM-4.5/4.6/4.7 models use glm45 parser
    if "glm" in model_id and any(v in model_id for v in ("4.5", "4.6", "4.7", "4-5", "4-6", "4-7")):
        return "glm45"

    return None


def build_vllm_command(recipe: Recipe) -> List[str]:
    """Build vLLM launch command."""
    python_path = _get_python_path(recipe)
    if python_path:
        vllm_bin = os.path.join(os.path.dirname(python_path), "vllm")
        if os.path.exists(vllm_bin):
            cmd = [vllm_bin, "serve"]
        else:
            cmd = [python_path, "-m", "vllm.entrypoints.openai.api_server"]
    else:
        cmd = ["vllm", "serve"]

    cmd.extend([recipe.model_path, "--host", recipe.host, "--port", str(recipe.port)])

    if recipe.served_model_name:
        cmd.extend(["--served-model-name", recipe.served_model_name])
    if recipe.tensor_parallel_size > 1:
        cmd.extend(["--tensor-parallel-size", str(recipe.tensor_parallel_size)])
    if recipe.pipeline_parallel_size > 1:
        cmd.extend(["--pipeline-parallel-size", str(recipe.pipeline_parallel_size)])

    # MiniMax M2 with TP>4 requires expert parallel
    model_id_lower = (recipe.served_model_name or recipe.model_path or "").lower()
    if "minimax" in model_id_lower and ("m2" in model_id_lower or "m-2" in model_id_lower):
        if recipe.tensor_parallel_size > 4:
            cmd.append("--enable-expert-parallel")

    cmd.extend(["--max-model-len", str(recipe.max_model_len)])
    cmd.extend(["--gpu-memory-utilization", str(recipe.gpu_memory_utilization)])
    cmd.extend(["--max-num-seqs", str(recipe.max_num_seqs)])

    if recipe.kv_cache_dtype != "auto":
        cmd.extend(["--kv-cache-dtype", recipe.kv_cache_dtype])
    if recipe.trust_remote_code:
        cmd.append("--trust-remote-code")
    if recipe.tool_call_parser:
        cmd.extend(["--tool-call-parser", recipe.tool_call_parser, "--enable-auto-tool-choice"])
    reasoning_parser = recipe.reasoning_parser or _get_default_reasoning_parser(recipe)
    if reasoning_parser:
        cmd.extend(["--reasoning-parser", reasoning_parser])
    if recipe.quantization:
        cmd.extend(["--quantization", recipe.quantization])
    if recipe.dtype:
        cmd.extend(["--dtype", recipe.dtype])

    _append_extra_args(cmd, recipe.extra_args)
    return cmd


def build_sglang_command(recipe: Recipe) -> List[str]:
    """Build SGLang launch command."""
    python = _get_python_path(recipe) or settings.sglang_python or "python"
    cmd = [python, "-m", "sglang.launch_server"]
    cmd.extend(["--model-path", recipe.model_path])
    cmd.extend(["--host", recipe.host, "--port", str(recipe.port)])

    if recipe.served_model_name:
        cmd.extend(["--served-model-name", recipe.served_model_name])
    if recipe.tensor_parallel_size > 1:
        cmd.extend(["--tensor-parallel-size", str(recipe.tensor_parallel_size)])
    if recipe.pipeline_parallel_size > 1:
        cmd.extend(["--pipeline-parallel-size", str(recipe.pipeline_parallel_size)])

    cmd.extend(["--context-length", str(recipe.max_model_len)])
    cmd.extend(["--mem-fraction-static", str(recipe.gpu_memory_utilization)])
    if recipe.max_num_seqs > 0:
        cmd.extend(["--max-running-requests", str(recipe.max_num_seqs)])

    if recipe.trust_remote_code:
        cmd.append("--trust-remote-code")
    if recipe.quantization:
        cmd.extend(["--quantization", recipe.quantization])
    if recipe.kv_cache_dtype and recipe.kv_cache_dtype != "auto":
        cmd.extend(["--kv-cache-dtype", recipe.kv_cache_dtype])

    _append_extra_args(cmd, recipe.extra_args)
    return cmd


def build_transformers_command(recipe: Recipe) -> List[str]:
    """Build Transformers (uvicorn) launch command.

    This backend is intended for cases where vLLM/SGLang cannot serve a checkpoint
    (e.g. 3-bit MoE variants). It launches an OpenAI-compatible server implemented
    in this repo (scripts/deepseek/transformers_server.py).
    """
    python = _get_python_path(recipe) or "python"
    repo_root = Path(__file__).resolve().parent.parent

    cmd = [
        python,
        "-m",
        "uvicorn",
        "--app-dir",
        str(repo_root),
        "scripts.deepseek.transformers_server:app",
        "--host",
        recipe.host,
        "--port",
        str(recipe.port),
    ]
    _append_extra_args(cmd, recipe.extra_args)
    return cmd


def _append_extra_args(cmd: List[str], extra_args: dict) -> None:
    """Append extra CLI arguments to command.

    Handles nested dicts as JSON strings for vLLM config args like:
    --speculative-config '{"method": "mtp", "num_speculative_tokens": 1}'
    """
    # Keys that are used by the controller, not passed to the backend
    INTERNAL_KEYS = {"venv_path", "env_vars", "cuda_visible_devices", "description", "tags", "status"}
    JSON_STRING_KEYS = {"speculative_config", "default_chat_template_kwargs"}

    for key, value in extra_args.items():
        normalized_key = key.replace("-", "_").lower()
        if normalized_key in INTERNAL_KEYS:
            continue

        flag = f"--{key.replace('_', '-')}"

        if flag in cmd:
            continue
        if value is True:
            cmd.append(flag)
        elif value is False:
            # Explicitly disable the flag (e.g., --disable-*)
            # For expert parallelism, we want to NOT add the flag at all
            if normalized_key not in ("enable_expert_parallelism", "enable-expert-parallelism"):
                cmd.append(flag)
        elif value is not None:
            normalized_key = key.replace("-", "_").lower()
            if isinstance(value, str) and normalized_key in JSON_STRING_KEYS:
                v = value.strip()
                if v.startswith("{") or v.startswith("["):
                    try:
                        parsed = json.loads(v)
                    except Exception:
                        parsed = None
                    if isinstance(parsed, (dict, list)):
                        cmd.extend([flag, json.dumps(_normalize_json_arg(parsed))])
                        continue
            if isinstance(value, (dict, list)):
                # Pass dicts/lists as JSON strings (vLLM expects this for speculative_config etc)
                cmd.extend([flag, json.dumps(_normalize_json_arg(value))])
            else:
                cmd.extend([flag, str(value)])
