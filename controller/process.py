"""Process management for vLLM/SGLang."""

from __future__ import annotations

import asyncio
import os
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import psutil

from .backends import build_sglang_command, build_vllm_command
from .config import settings
from .models import Backend, ProcessInfo, Recipe
from .backends import build_transformers_command


def _extract_flag(cmdline: List[str], flag: str) -> Optional[str]:
    """Extract value of a CLI flag."""
    for i, arg in enumerate(cmdline):
        if arg == flag and i + 1 < len(cmdline):
            return cmdline[i + 1]
    return None


def _build_env(recipe: Recipe) -> Dict[str, str]:
    env = os.environ.copy()

    # Bypass flashinfer version check (common issue with vLLM)
    env["FLASHINFER_DISABLE_VERSION_CHECK"] = "1"

    env_vars = {}
    if isinstance(recipe.env_vars, dict):
        env_vars.update(recipe.env_vars)

    extra_env_vars = (
        recipe.extra_args.get("env_vars")
        or recipe.extra_args.get("env-vars")
        or recipe.extra_args.get("envVars")
    )
    if isinstance(extra_env_vars, dict):
        env_vars.update(extra_env_vars)

    if env_vars:
        for k, v in env_vars.items():
            if v is None:
                continue
            env[str(k)] = str(v)

    cuda_visible_devices = (
        recipe.extra_args.get("cuda_visible_devices")
        or recipe.extra_args.get("cuda-visible-devices")
        or recipe.extra_args.get("CUDA_VISIBLE_DEVICES")
    )
    if cuda_visible_devices not in (None, "", False):
        env["CUDA_VISIBLE_DEVICES"] = str(cuda_visible_devices)

    return env


def _is_inference_process(cmdline: List[str]) -> Optional[str]:
    """Check if cmdline is vLLM, SGLang, or TabbyAPI, return backend name."""
    if not cmdline:
        return None
    joined = " ".join(cmdline)
    if "vllm.entrypoints.openai.api_server" in joined:
        return "vllm"
    # Check for vllm serve command (may be at position 0, 1, or 2 depending on how invoked)
    if "vllm" in joined and "serve" in joined:
        return "vllm"
    if "sglang.launch_server" in joined:
        return "sglang"
    if "scripts.deepseek.transformers_server:app" in joined:
        return "transformers"
    if "scripts.deepseek.transformers_server" in joined and "uvicorn" in joined:
        return "transformers"
    # TabbyAPI / ExLlamaV3 (main.py with --config flag)
    if "tabbyAPI" in joined or ("main.py" in joined and "--config" in joined):
        return "tabbyapi"
    return None


def find_inference_process(port: int) -> Optional[ProcessInfo]:
    """Find running inference process on given port."""
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            backend = _is_inference_process(cmdline)
            if not backend:
                continue
            p = _extract_flag(cmdline, "--port")
            # TabbyAPI doesn't use --port flag, assume default port 8000
            if backend == "tabbyapi":
                if port != 8000:
                    continue
            elif p is None or int(p) != port:
                continue
            # Extract model path
            model_path = _extract_flag(cmdline, "--model") or _extract_flag(cmdline, "--model-path")
            served_model_name = _extract_flag(cmdline, "--served-model-name")

            if not model_path:
                # Find "serve" anywhere in cmdline and get the next non-flag arg
                try:
                    serve_idx = cmdline.index("serve")
                    if serve_idx + 1 < len(cmdline) and not cmdline[serve_idx + 1].startswith("-"):
                        model_path = cmdline[serve_idx + 1]
                except ValueError:
                    pass

            # TabbyAPI: model info is in config, try to get from /v1/models or config file
            if backend == "tabbyapi" and not model_path:
                try:
                    import httpx
                    import yaml
                    # Try to get API key from TabbyAPI config
                    tabby_dir = settings.tabby_api_dir or "/opt/tabbyAPI"
                    api_key = None
                    try:
                        with open(f"{tabby_dir}/api_tokens.yml") as f:
                            tokens = yaml.safe_load(f)
                            api_key = tokens.get("api_key")
                    except Exception:
                        pass

                    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                    r = httpx.get(f"http://localhost:{port}/v1/models", headers=headers, timeout=2)
                    if r.status_code == 200:
                        data = r.json().get("data", [])
                        if data:
                            served_model_name = data[0].get("id")
                            model_path = str(settings.models_dir / served_model_name)

                    # Fallback: read from config file
                    if not served_model_name:
                        config_flag = _extract_flag(cmdline, "--config")
                        if config_flag:
                            try:
                                with open(f"{tabby_dir}/{config_flag}") as f:
                                    cfg = yaml.safe_load(f)
                                    served_model_name = cfg.get("model", {}).get("model_name")
                                    model_path = str(settings.models_dir / served_model_name)
                            except Exception:
                                pass
                except Exception:
                    pass

                if not model_path:
                    model_path = "tabbyapi:unknown"
                    served_model_name = "GLM-4.7"  # Default fallback

            return ProcessInfo(
                pid=proc.info["pid"],
                backend=backend,
                model_path=model_path,
                port=port,
                served_model_name=served_model_name,
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, ValueError):
            continue
    return None


async def kill_process(pid: int, force: bool = False) -> bool:
    """Kill process and its children.

    If force=True, uses SIGKILL immediately for faster cleanup.
    """
    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return True

    # Get all children before killing parent
    children = proc.children(recursive=True)

    if force:
        # Force mode: SIGKILL everything immediately
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
        try:
            proc.kill()
        except psutil.NoSuchProcess:
            pass
    else:
        # Graceful mode: SIGTERM first, then SIGKILL
        for child in children:
            try:
                child.terminate()
            except psutil.NoSuchProcess:
                pass
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except psutil.TimeoutExpired:
            proc.kill()
        except psutil.NoSuchProcess:
            pass

    # Brief wait for cleanup
    await asyncio.sleep(0.5 if force else 1)
    return True


async def launch_model(recipe: Recipe) -> Tuple[bool, Optional[int], str]:
    """Launch inference server with recipe config."""
    recipe.port = settings.inference_port  # Override with configured port

    if recipe.backend == Backend.SGLANG:
        cmd = build_sglang_command(recipe)
    elif recipe.backend == Backend.TRANSFORMERS:
        cmd = build_transformers_command(recipe)
    else:
        cmd = build_vllm_command(recipe)

    log_file = Path(f"/tmp/vllm_{recipe.id}.log")
    env = _build_env(recipe)

    try:
        with open(log_file, "w") as log:
            proc = subprocess.Popen(
                cmd,
                stdout=log,
                stderr=subprocess.STDOUT,
                env=env,
                start_new_session=True,
            )

        await asyncio.sleep(3)

        if proc.poll() is not None:
            tail = log_file.read_text()[-500:] if log_file.exists() else ""
            return False, None, f"Process exited early: {tail}"

        return True, proc.pid, str(log_file)
    except Exception as e:
        return False, None, str(e)


async def evict_model(force: bool = False) -> Optional[int]:
    """Stop current running model."""
    current = find_inference_process(settings.inference_port)
    if not current:
        return None
    await kill_process(current.pid, force=force)
    return current.pid


async def switch_model(recipe: Recipe, force: bool = False) -> Tuple[bool, Optional[int], str]:
    """Switch to a new model (evict current + launch new)."""
    await evict_model(force=force)
    await asyncio.sleep(2)
    return await launch_model(recipe)
