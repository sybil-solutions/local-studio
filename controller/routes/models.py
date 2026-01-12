"""OpenAI-compatible model endpoints."""

from __future__ import annotations

import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..models import OpenAIModelInfo, OpenAIModelList, Recipe
from ..process import find_inference_process
from ..store import RecipeStore

router = APIRouter(tags=["OpenAI Compatible"])


def get_store() -> RecipeStore:
    """Get recipe store instance."""
    from ..app import get_store as _get_store
    return _get_store()


@router.get("/v1/models")
async def list_models_openai():
    """List available models from recipes and running inference."""
    store = get_store()
    recipes = store.list()
    current = find_inference_process(settings.inference_port)

    active_model_data = None
    if current:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/v1/models")
                if r.status_code == 200:
                    active_model_data = r.json()
        except Exception:
            pass

    models = []
    current_time = int(time.time())

    for recipe in recipes:
        is_active = False
        max_model_len = recipe.max_model_len

        if current:
            if current.served_model_name and recipe.served_model_name == current.served_model_name:
                is_active = True
            elif current.model_path:
                if recipe.model_path in current.model_path or current.model_path in recipe.model_path:
                    is_active = True
                elif current.model_path.split("/")[-1] == recipe.model_path.split("/")[-1]:
                    is_active = True
            if active_model_data and "data" in active_model_data:
                for model in active_model_data["data"]:
                    if "max_model_len" in model:
                        max_model_len = model["max_model_len"]
                        break

        model_id = recipe.served_model_name or recipe.id
        models.append(
            OpenAIModelInfo(
                id=model_id,
                created=current_time,
                active=is_active,
                max_model_len=max_model_len,
            )
        )

    return OpenAIModelList(data=models)


@router.get("/v1/models/{model_id}", response_model=OpenAIModelInfo)
async def get_model_openai(model_id: str, store: RecipeStore = Depends(get_store)):
    """Get a specific model in OpenAI format."""
    recipes = store.list()
    recipe = None
    for r in recipes:
        if (r.served_model_name and r.served_model_name == model_id) or r.id == model_id:
            recipe = r
            break

    if not recipe:
        raise HTTPException(status_code=404, detail="Model not found")

    current = find_inference_process(settings.inference_port)
    is_active = False
    max_model_len = recipe.max_model_len

    if current and current.model_path and recipe.model_path in current.model_path:
        is_active = True
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/v1/models")
                if r.status_code == 200:
                    active_model_data = r.json()
                    if "data" in active_model_data:
                        for model in active_model_data["data"]:
                            if "max_model_len" in model:
                                max_model_len = model["max_model_len"]
                                break
        except Exception:
            pass

    display_id = recipe.served_model_name or recipe.id
    return OpenAIModelInfo(
        id=display_id,
        created=int(time.time()),
        active=is_active,
        max_model_len=max_model_len,
    )


@router.get("/v1/studio/models")
async def list_studio_models(store: RecipeStore = Depends(get_store)):
    """List available local model weight directories."""
    from ..browser import build_model_info, discover_model_dirs

    recipes = store.list()

    recipes_by_path: dict[str, list[str]] = defaultdict(list)
    recipes_by_basename: dict[str, list[str]] = defaultdict(list)

    for r in recipes:
        model_path = (r.model_path or "").strip()
        if not model_path:
            continue
        try:
            recipes_by_basename[Path(model_path).name].append(r.id)
        except Exception:
            recipes_by_basename[model_path.split("/")[-1]].append(r.id)

        if model_path.startswith("/"):
            try:
                canonical = str(Path(model_path).expanduser().resolve())
            except Exception:
                canonical = model_path.rstrip("/")
            recipes_by_path[canonical].append(r.id)

    root_index: dict[str, dict] = {}

    def add_root(path: Path, *, source: str, recipe_id: str | None = None) -> None:
        try:
            resolved = str(path.expanduser().resolve())
        except Exception:
            resolved = str(path)
        entry = root_index.get(resolved)
        if not entry:
            entry = {"path": resolved, "exists": path.exists(), "sources": set(), "recipe_ids": set()}
            root_index[resolved] = entry
        entry["sources"].add(source)
        if recipe_id:
            entry["recipe_ids"].add(recipe_id)

    configured_root = Path(settings.models_dir)
    add_root(configured_root, source="config")

    for r in recipes:
        model_path = (r.model_path or "").strip()
        if not model_path.startswith("/"):
            continue
        parent = Path(model_path).expanduser().resolve().parent
        if parent == Path("/"):
            continue
        add_root(parent, source="recipe_parent", recipe_id=r.id)

    roots = sorted(root_index.values(), key=lambda x: x["path"])
    scan_roots = [Path(r["path"]) for r in roots if r.get("exists")]

    model_dirs = discover_model_dirs(scan_roots, max_depth=2, max_models=1000)
    models = []
    for d in model_dirs:
        try:
            canonical = str(d.expanduser().resolve())
        except Exception:
            canonical = str(d).rstrip("/")

        recipe_ids = list(recipes_by_path.get(canonical, []))
        if not recipe_ids:
            by_name = recipes_by_basename.get(d.name, [])
            if len(by_name) == 1:
                recipe_ids = list(by_name)

        models.append(build_model_info(d, recipe_ids=recipe_ids).model_dump())

    models.sort(key=lambda m: (m.get("name") or "").lower())

    roots_payload = []
    for r in roots:
        roots_payload.append(
            {
                "path": r["path"],
                "exists": bool(r.get("exists")),
                "sources": sorted(r.get("sources") or []),
                "recipe_ids": sorted(r.get("recipe_ids") or []),
            }
        )

    return {"models": models, "roots": roots_payload, "configured_models_dir": str(settings.models_dir)}


@router.get("/v1/huggingface/models")
async def proxy_huggingface_models(
    search: Optional[str] = None,
    filter: Optional[str] = None,
    sort: Optional[str] = "trending",
    limit: int = 50,
):
    """Proxy requests to HuggingFace Hub API to avoid CORS issues."""
    # Map frontend sort options to HuggingFace API parameters
    sort_mapping = {
        "trending": "trendingScore",
        "downloads": "downloads",
        "likes": "likes",
        "modified": "lastModified",
    }
    hf_sort = sort_mapping.get(sort, "trendingScore")

    params = {"limit": limit, "full": "false", "sort": hf_sort}
    if search:
        params["search"] = search
    if filter:
        params["filter"] = filter

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                "https://huggingface.co/api/models",
                params=params,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"HuggingFace API error: {e}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Failed to reach HuggingFace API: {e}")
