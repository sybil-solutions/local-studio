"""Model browser - discover local model weight directories."""

from __future__ import annotations

import json
import os
from collections import deque
from pathlib import Path
from typing import Deque, Dict, Iterable, List, Optional, Set, Tuple

from pydantic import BaseModel


class ModelInfo(BaseModel):
    """Information about a discovered local model."""

    name: str
    path: str
    size_bytes: Optional[int] = None
    modified_at: Optional[float] = None
    architecture: Optional[str] = None
    quantization: Optional[str] = None
    context_length: Optional[int] = None
    recipe_ids: List[str] = []
    has_recipe: bool = False


WEIGHT_EXTS: Tuple[str, ...] = (".safetensors", ".bin", ".gguf")
CONFIG_FILENAMES: Tuple[str, ...] = ("config.json",)


def _looks_like_model_dir(path: Path) -> bool:
    if not path.exists() or not path.is_dir():
        return False
    for cfg in CONFIG_FILENAMES:
        if (path / cfg).exists():
            return True
    try:
        for entry in path.iterdir():
            if entry.is_file() and entry.suffix.lower() in WEIGHT_EXTS:
                return True
    except Exception:
        return False
    return False


def _infer_quantization(name: str) -> Optional[str]:
    name_lower = name.lower()
    for quant in ("awq", "gptq", "gguf", "fp16", "bf16", "int8", "int4", "w4a16", "w8a16"):
        if quant in name_lower:
            return quant
    return None


def _read_config_metadata(model_dir: Path) -> Dict[str, Optional[object]]:
    config_path = model_dir / "config.json"
    if not config_path.exists():
        return {"architecture": None, "context_length": None}
    try:
        with open(config_path) as f:
            config = json.load(f)
        architecture = None
        if isinstance(config, dict):
            architectures = config.get("architectures")
            if isinstance(architectures, list) and architectures:
                architecture = architectures[0]
            context_length = (
                config.get("max_position_embeddings")
                or config.get("max_seq_len")
                or config.get("seq_length")
                or config.get("n_ctx")
            )
            if isinstance(context_length, str) and context_length.isdigit():
                context_length = int(context_length)
        else:
            architecture = None
            context_length = None
        return {"architecture": architecture, "context_length": context_length}
    except Exception:
        return {"architecture": None, "context_length": None}


def _estimate_weights_size_bytes(model_dir: Path, recursive: bool = True) -> Optional[int]:
    total = 0
    try:
        if recursive:
            for root, _, files in os.walk(model_dir):
                for filename in files:
                    if Path(filename).suffix.lower() not in WEIGHT_EXTS:
                        continue
                    try:
                        total += (Path(root) / filename).stat().st_size
                    except Exception:
                        continue
        else:
            for entry in model_dir.iterdir():
                if entry.is_file() and entry.suffix.lower() in WEIGHT_EXTS:
                    try:
                        total += entry.stat().st_size
                    except Exception:
                        continue
    except Exception:
        return None
    return total or None


def discover_model_dirs(
    roots: Iterable[Path],
    *,
    max_depth: int = 1,
    max_models: int = 500,
) -> List[Path]:
    """Discover model directories under one or more roots.

    Traverses directories up to `max_depth` and considers a directory a model if
    it contains `config.json` or weight files (safetensors/bin/gguf).

    The scan intentionally stops descending once a model directory is found.
    """
    discovered: List[Path] = []
    seen: Set[str] = set()
    q: Deque[Tuple[Path, int]] = deque()

    for root in roots:
        if not root:
            continue
        q.append((root, 0))

    while q and len(discovered) < max_models:
        current, depth = q.popleft()
        try:
            resolved = str(current.resolve())
        except Exception:
            resolved = str(current)
        if resolved in seen:
            continue
        seen.add(resolved)

        if _looks_like_model_dir(current):
            discovered.append(current)
            continue

        if depth >= max_depth:
            continue

        try:
            for entry in current.iterdir():
                if not entry.is_dir():
                    continue
                if entry.name.startswith("."):
                    continue
                q.append((entry, depth + 1))
        except Exception:
            continue

    return discovered


def build_model_info(model_dir: Path, *, recipe_ids: Optional[List[str]] = None) -> ModelInfo:
    """Build a `ModelInfo` object for a discovered model directory."""
    metadata = _read_config_metadata(model_dir)
    try:
        modified_at = model_dir.stat().st_mtime
    except Exception:
        modified_at = None
    recipe_ids = recipe_ids or []
    return ModelInfo(
        name=model_dir.name,
        path=str(model_dir),
        size_bytes=_estimate_weights_size_bytes(model_dir, recursive=False),
        modified_at=modified_at,
        architecture=metadata.get("architecture"),
        quantization=_infer_quantization(model_dir.name),
        context_length=metadata.get("context_length"),
        recipe_ids=sorted(set(recipe_ids)),
        has_recipe=bool(recipe_ids),
    )
