"""Command builders for vLLM and SGLang backends."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from .config import settings
from .models import Recipe


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

    cmd.extend(["--max-model-len", str(recipe.max_model_len)])
    cmd.extend(["--gpu-memory-utilization", str(recipe.gpu_memory_utilization)])
    cmd.extend(["--max-num-seqs", str(recipe.max_num_seqs)])

    if recipe.kv_cache_dtype != "auto":
        cmd.extend(["--kv-cache-dtype", recipe.kv_cache_dtype])
    if recipe.trust_remote_code:
        cmd.append("--trust-remote-code")
    if recipe.tool_call_parser:
        cmd.extend(["--tool-call-parser", recipe.tool_call_parser, "--enable-auto-tool-choice"])
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
        cmd.extend(["--tp", str(recipe.tensor_parallel_size)])

    cmd.extend(["--context-length", str(recipe.max_model_len)])
    cmd.extend(["--mem-fraction-static", str(recipe.gpu_memory_utilization)])

    if recipe.trust_remote_code:
        cmd.append("--trust-remote-code")
    if recipe.quantization:
        cmd.extend(["--quantization", recipe.quantization])
    if recipe.kv_cache_dtype and recipe.kv_cache_dtype != "auto":
        cmd.extend(["--kv-cache-dtype", recipe.kv_cache_dtype])

    _append_extra_args(cmd, recipe.extra_args)
    return cmd


def _append_extra_args(cmd: List[str], extra_args: dict) -> None:
    """Append extra CLI arguments to command."""
    # Keys that are used by the controller, not passed to the backend
    INTERNAL_KEYS = {"venv_path", "env_vars", "cuda_visible_devices", "description", "tags", "status"}

    for key, value in extra_args.items():
        normalized_key = key.replace("-", "_").lower()
        if normalized_key in INTERNAL_KEYS:
            continue
        flag = f"--{key.replace('_', '-')}"
        if flag in cmd:
            continue
        if value is True:
            cmd.append(flag)
        elif value is not False and value is not None:
            if isinstance(value, (dict, list)):
                cmd.extend([flag, json.dumps(value)])
            else:
                cmd.extend([flag, str(value)])
