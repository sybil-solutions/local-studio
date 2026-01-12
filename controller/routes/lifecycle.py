"""Model lifecycle endpoints: recipes CRUD, launch, evict."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Optional

import httpx
import psutil
from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..events import event_manager
from ..models import LaunchResult, Recipe
from ..process import evict_model, find_inference_process, kill_process, launch_model
from ..store import RecipeStore
from .system import get_launching_recipe_id, set_launching_recipe_id

router = APIRouter()
logger = logging.getLogger(__name__)

_switch_lock = asyncio.Lock()
_launch_cancel_events: dict[str, asyncio.Event] = {}


def get_store() -> RecipeStore:
    """Get recipe store instance."""
    from ..app import get_store as _get_store
    return _get_store()


# --- Recipes ---
@router.get("/recipes", tags=["Recipes"])
async def list_recipes(store: RecipeStore = Depends(get_store)):
    """List all recipes."""
    recipes = store.list()
    current = find_inference_process(settings.inference_port)
    result = []
    launching_id = get_launching_recipe_id()
    for r in recipes:
        status = "stopped"
        if launching_id == r.id:
            status = "starting"
        if current:
            if current.served_model_name and r.served_model_name == current.served_model_name:
                status = "running"
            elif current.model_path:
                if r.model_path in current.model_path or current.model_path in r.model_path:
                    status = "running"
                elif current.model_path.split("/")[-1] == r.model_path.split("/")[-1]:
                    status = "running"
        result.append({**r.model_dump(), "status": status})
    return result


@router.get("/recipes/{recipe_id}", tags=["Recipes"])
async def get_recipe(recipe_id: str, store: RecipeStore = Depends(get_store)):
    """Get a recipe by ID."""
    recipe = store.get(recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@router.post("/recipes", tags=["Recipes"])
async def create_recipe(recipe: Recipe, store: RecipeStore = Depends(get_store)):
    """Create or update a recipe."""
    store.save(recipe)
    return {"success": True, "id": recipe.id}


@router.put("/recipes/{recipe_id}", tags=["Recipes"])
async def update_recipe(recipe_id: str, recipe: Recipe, store: RecipeStore = Depends(get_store)):
    """Update a recipe by ID."""
    if recipe.id != recipe_id:
        recipe.id = recipe_id
    store.save(recipe)
    return {"success": True, "id": recipe.id}


@router.delete("/recipes/{recipe_id}", tags=["Recipes"])
async def delete_recipe(recipe_id: str, store: RecipeStore = Depends(get_store)):
    """Delete a recipe."""
    if not store.delete(recipe_id):
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"success": True}


# --- Model lifecycle ---
@router.post("/launch/{recipe_id}", response_model=LaunchResult, tags=["Lifecycle"])
async def launch(recipe_id: str, force: bool = False, store: RecipeStore = Depends(get_store)):
    """Launch a model by recipe ID with real-time progress updates."""
    global _launch_cancel_events

    recipe = store.get(recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Check if another launch is in progress and preempt it
    current_launching = get_launching_recipe_id()
    if current_launching and current_launching != recipe_id:
        preempted_recipe_id = current_launching
        logger.info(f"Preempting launch of {preempted_recipe_id} for {recipe_id}")
        await event_manager.publish_launch_progress(
            recipe_id, "preempting", f"Cancelling {preempted_recipe_id}...", progress=0.0
        )
        await event_manager.publish_launch_progress(
            preempted_recipe_id, "cancelled", f"Preempted by {recipe_id}", progress=0.0
        )

        cancel_event = _launch_cancel_events.get(preempted_recipe_id)
        if cancel_event:
            cancel_event.set()

        await evict_model(force=True)
        await asyncio.sleep(1)

    cancel_event = asyncio.Event()
    _launch_cancel_events[recipe_id] = cancel_event
    set_launching_recipe_id(recipe_id)

    try:
        try:
            await asyncio.wait_for(_switch_lock.acquire(), timeout=2.0)
        except asyncio.TimeoutError:
            logger.info(f"Lock contention - force preempting for {recipe_id}")
            await evict_model(force=True)
            await asyncio.sleep(1)
            await _switch_lock.acquire()

        try:
            await event_manager.publish_launch_progress(
                recipe_id, "evicting", "Clearing VRAM...", progress=0.0
            )
            await evict_model(force=True)
            await asyncio.sleep(1)

            if cancel_event.is_set():
                await event_manager.publish_launch_progress(
                    recipe_id, "cancelled", "Preempted by another launch", progress=0.0
                )
                return LaunchResult(success=False, pid=None, message="Launch cancelled", log_file=None)

            await event_manager.publish_launch_progress(
                recipe_id, "launching", f"Starting {recipe.name}...", progress=0.25
            )

            success, pid, message = await launch_model(recipe)

            if not success:
                await event_manager.publish_launch_progress(
                    recipe_id, "error", message, progress=0.0
                )
                return LaunchResult(success=False, pid=None, message=message, log_file=None)

            await event_manager.publish_launch_progress(
                recipe_id, "waiting", "Waiting for model to load...", progress=0.5
            )

            start = time.time()
            timeout = 300
            ready = False
            crashed = False

            while time.time() - start < timeout:
                if cancel_event.is_set():
                    logger.info(f"Launch of {recipe_id} cancelled during load")
                    await event_manager.publish_launch_progress(
                        recipe_id, "cancelled", "Preempted by another launch", progress=0.0
                    )
                    if pid:
                        try:
                            proc = psutil.Process(pid)
                            for child in proc.children(recursive=True):
                                child.kill()
                            proc.kill()
                        except psutil.NoSuchProcess:
                            pass
                    return LaunchResult(success=False, pid=None, message="Launch cancelled", log_file=None)

                try:
                    if pid and not psutil.pid_exists(pid):
                        crashed = True
                        break
                except Exception:
                    pass

                try:
                    async with httpx.AsyncClient(timeout=5) as client:
                        r = await client.get(f"http://localhost:{settings.inference_port}/health")
                        if r.status_code == 200:
                            ready = True
                            break
                except Exception:
                    pass

                elapsed = int(time.time() - start)
                await event_manager.publish_launch_progress(
                    recipe_id, "waiting",
                    f"Loading model... ({elapsed}s)",
                    progress=0.5 + (elapsed / timeout) * 0.5
                )
                await asyncio.sleep(2)

            if crashed:
                log_file = Path(f"/tmp/vllm_{recipe_id}.log")
                error_tail = ""
                if log_file.exists():
                    try:
                        error_tail = log_file.read_text()[-1000:]
                    except Exception:
                        pass
                await event_manager.publish_launch_progress(
                    recipe_id, "error", "Model process crashed. Check logs for details.", progress=0.0
                )
                return LaunchResult(success=False, pid=None, message=f"Process crashed: {error_tail[-200:]}", log_file=str(log_file))

            if ready:
                await event_manager.publish_launch_progress(
                    recipe_id, "ready", "Model is ready!", progress=1.0
                )
                logger.info(f"Model {recipe_id} is ready")
                return LaunchResult(
                    success=True,
                    pid=pid,
                    message="Model is ready",
                    log_file=f"/tmp/vllm_{recipe_id}.log",
                )
            else:
                try:
                    if pid:
                        await kill_process(pid, force=True)
                except Exception:
                    pass

                log_file = Path(f"/tmp/vllm_{recipe_id}.log")
                error_tail = ""
                if log_file.exists():
                    try:
                        error_tail = log_file.read_text()[-1000:]
                    except Exception:
                        pass
                await event_manager.publish_launch_progress(
                    recipe_id, "error", "Model failed to become ready (timeout)", progress=0.0
                )
                return LaunchResult(
                    success=False,
                    pid=None,
                    message=f"Model failed to become ready (timeout): {error_tail[-200:]}",
                    log_file=str(log_file),
                )
        finally:
            _switch_lock.release()
    finally:
        if get_launching_recipe_id() == recipe_id:
            set_launching_recipe_id(None)
        if _launch_cancel_events.get(recipe_id) is cancel_event:
            del _launch_cancel_events[recipe_id]


@router.post("/evict", tags=["Lifecycle"])
async def evict(force: bool = False):
    """Stop the running model."""
    async with _switch_lock:
        pid = await evict_model(force=force)
    logger.info(f"Model evicted (pid={pid})")
    return {"success": True, "evicted_pid": pid}


@router.get("/wait-ready", tags=["Lifecycle"])
async def wait_ready(timeout: int = 300):
    """Wait for inference backend to be ready."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/health")
                if r.status_code == 200:
                    return {"ready": True, "elapsed": int(time.time() - start)}
        except Exception:
            pass
        await asyncio.sleep(2)

    return {"ready": False, "elapsed": timeout, "error": "Timeout waiting for backend"}
