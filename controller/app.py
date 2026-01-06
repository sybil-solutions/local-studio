"""FastAPI application - minimal controller API."""

from __future__ import annotations

import asyncio
import datetime as dt
import os
import json
from collections import deque
from pathlib import Path
from typing import Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import __version__
from .events import event_manager, Event
from .metrics import (
    update_active_model, update_gpu_metrics, update_sse_metrics,
    get_metrics_content, get_metrics_content_type
)
from .config import settings
from .gpu import get_gpu_info
from .models import HealthResponse, LaunchResult, OpenAIModelInfo, OpenAIModelList, Recipe
from .process import evict_model, find_inference_process, kill_process
from .store import RecipeStore, ChatStore, PeakMetricsStore, LifetimeMetricsStore

app = FastAPI(
    title="vLLM Studio Controller",
    version=__version__,
    description="Minimal model lifecycle management for vLLM/SGLang",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
_store: Optional[RecipeStore] = None
_chat_store: Optional[ChatStore] = None
_peak_metrics_store: Optional[PeakMetricsStore] = None
_lifetime_metrics_store: Optional[LifetimeMetricsStore] = None
_switch_lock = asyncio.Lock()
_broadcast_task: Optional[asyncio.Task] = None
_last_power_sample_time: float = 0
_launching_recipe_id: Optional[str] = None  # Currently launching recipe (for preemption)
_launch_cancel_events: dict[str, asyncio.Event] = {}  # Per-recipe cancellation signals

import logging
import time

logger = logging.getLogger(__name__)
access_logger = logging.getLogger("vllm_studio.access")

# Configure access logger
if not access_logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        '%(asctime)s ACCESS %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    access_logger.addHandler(handler)
    access_logger.setLevel(logging.INFO)


def get_store() -> RecipeStore:
    global _store
    if _store is None:
        _store = RecipeStore(settings.db_path)
    return _store


def get_chat_store() -> ChatStore:
    global _chat_store
    if _chat_store is None:
        chat_db = settings.db_path.parent / "chats.db"
        _chat_store = ChatStore(chat_db)
    return _chat_store


def get_peak_metrics_store() -> PeakMetricsStore:
    global _peak_metrics_store
    if _peak_metrics_store is None:
        metrics_db = settings.db_path.parent / "metrics.db"
        _peak_metrics_store = PeakMetricsStore(metrics_db)
    return _peak_metrics_store


def get_lifetime_metrics_store() -> LifetimeMetricsStore:
    global _lifetime_metrics_store
    if _lifetime_metrics_store is None:
        lifetime_db = settings.db_path.parent / "lifetime.db"
        _lifetime_metrics_store = LifetimeMetricsStore(lifetime_db)
        _lifetime_metrics_store.ensure_first_started()
    return _lifetime_metrics_store


# --- Access logging & authentication middleware ---
@app.middleware("http")
async def access_logging_middleware(request: Request, call_next):
    """Log all requests with detailed info for security monitoring."""
    start_time = time.time()

    # Extract request info
    client_ip = request.headers.get("CF-Connecting-IP") or \
                request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or \
                request.client.host if request.client else "unknown"
    method = request.method
    path = request.url.path
    query = str(request.url.query) if request.url.query else ""
    user_agent = request.headers.get("User-Agent", "unknown")[:100]
    referer = request.headers.get("Referer", "-")[:200]
    auth_header = request.headers.get("Authorization", "")
    has_auth = bool(auth_header)
    auth_valid = False

    # Check auth status
    public_paths = {"/health", "/docs", "/openapi.json", "/redoc", "/metrics"}
    is_public = path in public_paths

    if settings.api_key:
        if auth_header.startswith("Bearer "):
            auth_valid = auth_header.split(" ", 1)[1] == settings.api_key
    else:
        auth_valid = True  # No API key configured

    # Determine if request should be blocked
    blocked = False
    if settings.api_key and not is_public and not auth_valid:
        blocked = True

    # Process request
    if blocked:
        response = JSONResponse(status_code=401, content={"error": "Invalid or missing API key"})
        status_code = 401
    else:
        response = await call_next(request)
        status_code = response.status_code

    # Calculate duration
    duration_ms = (time.time() - start_time) * 1000

    # Log with security-relevant details
    log_parts = [
        f"ip={client_ip}",
        f"method={method}",
        f"path={path}",
        f"query={query}" if query else None,
        f"status={status_code}",
        f"duration={duration_ms:.1f}ms",
        f"auth={'valid' if auth_valid else ('invalid' if has_auth else 'none')}",
        f"blocked={blocked}",
        f"ua={user_agent}",
        f"referer={referer}" if referer != "-" else None,
    ]
    log_msg = " | ".join(filter(None, log_parts))

    # Log level based on status
    if blocked or status_code >= 400:
        access_logger.warning(log_msg)
    else:
        access_logger.info(log_msg)

    return response


# --- Real-time events (SSE) startup/shutdown ---
@app.on_event("startup")
async def startup_event():
    """Start background tasks on application startup."""
    global _broadcast_task
    _broadcast_task = asyncio.create_task(broadcast_updates())
    logger.info("Started background SSE broadcast task")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up background tasks on shutdown."""
    global _broadcast_task
    if _broadcast_task:
        _broadcast_task.cancel()
        try:
            await _broadcast_task
        except asyncio.CancelledError:
            pass
    logger.info("Stopped background tasks")


async def broadcast_updates():
    """Background task to broadcast status/GPU/metrics updates every second."""
    global _last_power_sample_time
    _last_power_sample_time = time.time()
    last_tokens_total = 0
    last_prompt_tokens_total = 0
    last_completion_tokens_total = 0
    last_requests_total = 0

    while True:
        try:
            now = time.time()
            elapsed_seconds = now - _last_power_sample_time
            _last_power_sample_time = now

            # Broadcast process status
            current = find_inference_process(settings.inference_port)
            status_data = {
                "running": current is not None,
                "process": current.model_dump() if current else None,
                "inference_port": settings.inference_port,
            }
            await event_manager.publish_status(status_data)

            # Broadcast GPU metrics and track power
            gpu_list = get_gpu_info()
            gpu_data = [gpu.model_dump() for gpu in gpu_list]
            await event_manager.publish_gpu(gpu_data)

            # Track power consumption (always, even when idle)
            total_power_watts = sum(gpu.power_draw for gpu in gpu_list)
            if elapsed_seconds > 0 and elapsed_seconds < 10:  # Sanity check
                watt_hours = (total_power_watts * elapsed_seconds) / 3600.0
                lifetime_store = get_lifetime_metrics_store()
                lifetime_store.add_energy(watt_hours)

                # Track uptime (only when model is running)
                if current:
                    lifetime_store.add_uptime(elapsed_seconds)

            # Get lifetime metrics for broadcast
            lifetime_store = get_lifetime_metrics_store()
            lifetime_data = lifetime_store.get_all()

            # Calculate derived metrics
            uptime_hours = lifetime_data.get('uptime_seconds', 0) / 3600.0
            energy_kwh = lifetime_data.get('energy_wh', 0) / 1000.0
            lifetime_tokens = lifetime_data.get('tokens_total', 0)
            kwh_per_million_tokens = (energy_kwh / (lifetime_tokens / 1_000_000)) if lifetime_tokens > 0 else 0

            # Broadcast vLLM metrics (if backend is running)
            if current:
                try:
                    async with httpx.AsyncClient(timeout=2) as client:
                        r = await client.get(f"http://localhost:{settings.inference_port}/metrics")
                        if r.status_code == 200:
                            metrics = parse_vllm_metrics(r.text)

                            # Merge peak metrics for the current model
                            model_id = current.served_model_name or (current.model_path.split('/')[-1] if current.model_path else None)
                            if model_id:
                                peak_store = get_peak_metrics_store()
                                peak = peak_store.get(model_id)
                                if peak:
                                    metrics['peak_prefill_tps'] = peak.get('prefill_tps')
                                    metrics['peak_generation_tps'] = peak.get('generation_tps')
                                    metrics['peak_ttft_ms'] = peak.get('ttft_ms')
                                    metrics['total_tokens'] = peak.get('total_tokens', 0)
                                    metrics['total_requests'] = peak.get('total_requests', 0)

                            # Track lifetime tokens from vLLM metrics (total and breakdown)
                            current_prompt_tokens = metrics.get('prompt_tokens_total', 0)
                            current_completion_tokens = metrics.get('generation_tokens_total', 0)
                            current_tokens = current_prompt_tokens + current_completion_tokens
                            current_requests = metrics.get('request_success', 0)

                            if current_tokens > last_tokens_total:
                                new_tokens = current_tokens - last_tokens_total
                                lifetime_store.add_tokens(new_tokens)
                                last_tokens_total = current_tokens

                            if current_prompt_tokens > last_prompt_tokens_total:
                                new_prompt_tokens = current_prompt_tokens - last_prompt_tokens_total
                                lifetime_store.add_prompt_tokens(new_prompt_tokens)
                                last_prompt_tokens_total = current_prompt_tokens

                            if current_completion_tokens > last_completion_tokens_total:
                                new_completion_tokens = current_completion_tokens - last_completion_tokens_total
                                lifetime_store.add_completion_tokens(new_completion_tokens)
                                last_completion_tokens_total = current_completion_tokens

                            if current_requests > last_requests_total:
                                new_requests = current_requests - last_requests_total
                                lifetime_store.add_requests(new_requests)
                                last_requests_total = current_requests

                            # Calculate detailed cost metrics
                            lifetime_prompt_tokens = lifetime_data.get('prompt_tokens_total', 0)
                            lifetime_completion_tokens = lifetime_data.get('completion_tokens_total', 0)

                            # kWh per million tokens - estimate energy split based on compute ratios
                            # Output tokens cost ~10x more compute than input tokens per token
                            OUTPUT_COMPUTE_RATIO = 10  # Generation is ~10x more expensive per token
                            weighted_total = lifetime_prompt_tokens + (lifetime_completion_tokens * OUTPUT_COMPUTE_RATIO)
                            if weighted_total > 0 and lifetime_prompt_tokens > 0 and lifetime_completion_tokens > 0:
                                input_energy_fraction = lifetime_prompt_tokens / weighted_total
                                output_energy_fraction = (lifetime_completion_tokens * OUTPUT_COMPUTE_RATIO) / weighted_total
                                input_energy_kwh = energy_kwh * input_energy_fraction
                                output_energy_kwh = energy_kwh * output_energy_fraction
                                kwh_per_million_input = input_energy_kwh / (lifetime_prompt_tokens / 1_000_000)
                                kwh_per_million_output = output_energy_kwh / (lifetime_completion_tokens / 1_000_000)
                            else:
                                kwh_per_million_input = 0
                                kwh_per_million_output = 0

                            # Add lifetime metrics to broadcast
                            metrics['lifetime_tokens'] = int(lifetime_data.get('tokens_total', 0))
                            metrics['lifetime_prompt_tokens'] = int(lifetime_prompt_tokens)
                            metrics['lifetime_completion_tokens'] = int(lifetime_completion_tokens)
                            metrics['lifetime_requests'] = int(lifetime_data.get('requests_total', 0))
                            metrics['lifetime_energy_wh'] = lifetime_data.get('energy_wh', 0)
                            metrics['lifetime_energy_kwh'] = energy_kwh
                            metrics['lifetime_uptime_hours'] = uptime_hours
                            metrics['kwh_per_million_tokens'] = kwh_per_million_tokens
                            metrics['kwh_per_million_input'] = kwh_per_million_input
                            metrics['kwh_per_million_output'] = kwh_per_million_output
                            metrics['current_power_watts'] = total_power_watts

                            await event_manager.publish_metrics(metrics)
                except Exception:
                    pass  # Backend not ready or metrics not available
            else:
                # Reset token tracking when model stops
                last_tokens_total = 0
                last_prompt_tokens_total = 0
                last_completion_tokens_total = 0
                last_requests_total = 0

                # Calculate detailed cost metrics using compute-weighted energy split
                lifetime_prompt_tokens = lifetime_data.get('prompt_tokens_total', 0)
                lifetime_completion_tokens = lifetime_data.get('completion_tokens_total', 0)
                OUTPUT_COMPUTE_RATIO = 10  # Generation is ~10x more expensive per token
                weighted_total = lifetime_prompt_tokens + (lifetime_completion_tokens * OUTPUT_COMPUTE_RATIO)
                if weighted_total > 0 and lifetime_prompt_tokens > 0 and lifetime_completion_tokens > 0:
                    input_energy_fraction = lifetime_prompt_tokens / weighted_total
                    output_energy_fraction = (lifetime_completion_tokens * OUTPUT_COMPUTE_RATIO) / weighted_total
                    input_energy_kwh = energy_kwh * input_energy_fraction
                    output_energy_kwh = energy_kwh * output_energy_fraction
                    kwh_per_million_input = input_energy_kwh / (lifetime_prompt_tokens / 1_000_000)
                    kwh_per_million_output = output_energy_kwh / (lifetime_completion_tokens / 1_000_000)
                else:
                    kwh_per_million_input = 0
                    kwh_per_million_output = 0

                # Still broadcast lifetime metrics even when idle
                idle_metrics = {
                    'lifetime_tokens': int(lifetime_data.get('tokens_total', 0)),
                    'lifetime_prompt_tokens': int(lifetime_prompt_tokens),
                    'lifetime_completion_tokens': int(lifetime_completion_tokens),
                    'lifetime_requests': int(lifetime_data.get('requests_total', 0)),
                    'lifetime_energy_wh': lifetime_data.get('energy_wh', 0),
                    'lifetime_energy_kwh': energy_kwh,
                    'lifetime_uptime_hours': uptime_hours,
                    'kwh_per_million_tokens': kwh_per_million_tokens,
                    'kwh_per_million_input': kwh_per_million_input,
                    'kwh_per_million_output': kwh_per_million_output,
                    'current_power_watts': total_power_watts,
                }
                await event_manager.publish_metrics(idle_metrics)

        except Exception as e:
            logger.error(f"Error in broadcast_updates: {e}")

        await asyncio.sleep(1)  # Update every 1 second


def parse_vllm_metrics(prometheus_text: str) -> dict:
    """Parse Prometheus format metrics from vLLM.

    Extracts key metrics like:
    - vllm:num_requests_running
    - vllm:num_requests_waiting
    - vllm:avg_generation_throughput_toks_per_s
    - vllm:gpu_cache_usage_perc
    - vllm:generation_tokens_total
    - vllm:prompt_tokens_total
    - vllm:request_success_total
    """
    metrics = {}
    request_success_total = 0

    for line in prometheus_text.split('\n'):
        if line.startswith('#') or not line.strip():
            continue

        try:
            parts = line.split()
            if len(parts) >= 2:
                metric_name = parts[0]
                metric_value = float(parts[1])

                # Map vLLM metrics to friendly names
                if 'num_requests_running' in metric_name:
                    metrics['running_requests'] = int(metric_value)
                elif 'num_requests_waiting' in metric_name:
                    metrics['pending_requests'] = int(metric_value)
                elif 'avg_generation_throughput' in metric_name:
                    metrics['generation_throughput'] = metric_value
                elif 'avg_prompt_throughput' in metric_name:
                    metrics['prompt_throughput'] = metric_value
                elif 'kv_cache_usage_perc' in metric_name:
                    metrics['kv_cache_usage'] = metric_value
                elif 'time_to_first_token' in metric_name:
                    if 'sum' in metric_name:
                        metrics['ttft_sum'] = metric_value
                    elif 'count' in metric_name:
                        metrics['ttft_count'] = int(metric_value)
                # Token totals (counters)
                elif 'generation_tokens_total{' in metric_name:
                    metrics['generation_tokens_total'] = int(metric_value)
                elif 'prompt_tokens_total{' in metric_name:
                    metrics['prompt_tokens_total'] = int(metric_value)
                # Request success (sum all finished_reasons)
                elif 'request_success_total{' in metric_name:
                    request_success_total += int(metric_value)
        except Exception:
            continue

    # Set request success total
    if request_success_total > 0:
        metrics['request_success'] = request_success_total

    # Calculate average TTFT if available
    if 'ttft_sum' in metrics and 'ttft_count' in metrics and metrics['ttft_count'] > 0:
        metrics['avg_ttft_ms'] = (metrics['ttft_sum'] / metrics['ttft_count']) * 1000

    return metrics


# --- Health ---
@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health():
    """Health check."""
    current = find_inference_process(settings.inference_port)
    inference_ready = False

    if current:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/health")
                inference_ready = r.status_code == 200
        except Exception:
            pass

    return HealthResponse(
        status="ok",
        version=__version__,
        inference_ready=inference_ready,
        backend_reachable=inference_ready,
        running_model=current.served_model_name or current.model_path if current else None,
    )


@app.get("/status", tags=["System"])
async def status():
    """Detailed status including launch-in-progress info."""
    current = find_inference_process(settings.inference_port)
    return {
        "running": current is not None,
        "process": current.model_dump() if current else None,
        "inference_port": settings.inference_port,
        "launching": _launching_recipe_id,  # Recipe ID if launch in progress, else None
    }


@app.get("/gpus", tags=["System"])
async def gpus():
    """Get GPU information."""
    gpu_list = get_gpu_info()
    return {
        "count": len(gpu_list),
        "gpus": [gpu.model_dump() for gpu in gpu_list],
    }


# --- OpenAI-compatible endpoints ---
@app.get("/v1/models", tags=["OpenAI Compatible"])
async def list_models_openai():
    """List available models from recipes and running inference."""
    # Skip LiteLLM proxy - go directly to recipes/inference for accurate model names

    import time
    store = get_store()
    recipes = store.list()
    current = find_inference_process(settings.inference_port)

    # Get active model metadata from vLLM/SGLang if available
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

        # Check if this recipe is the currently running model
        if current:
            # Match by served_model_name first (most reliable)
            if current.served_model_name and recipe.served_model_name == current.served_model_name:
                is_active = True
            # Or match by model_path
            elif current.model_path:
                if recipe.model_path in current.model_path or current.model_path in recipe.model_path:
                    is_active = True
                elif current.model_path.split("/")[-1] == recipe.model_path.split("/")[-1]:
                    is_active = True
            # Try to get max_model_len from the active model's endpoint
            if active_model_data and "data" in active_model_data:
                for model in active_model_data["data"]:
                    if "max_model_len" in model:
                        max_model_len = model["max_model_len"]
                        break

        # Use served_model_name if available, otherwise use recipe ID
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


@app.get("/v1/models/{model_id}", response_model=OpenAIModelInfo, tags=["OpenAI Compatible"])
async def get_model_openai(model_id: str, store: RecipeStore = Depends(get_store)):
    """Get a specific model in OpenAI format."""
    import time

    # Try to find by served_model_name first, then by ID
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

    # Check if this is the active model and get metadata
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

    # Use served_model_name if available, otherwise use recipe ID
    display_id = recipe.served_model_name or recipe.id

    return OpenAIModelInfo(
        id=display_id,
        created=int(time.time()),
        active=is_active,
        max_model_len=max_model_len,
    )


# --- Recipes ---
@app.get("/recipes", tags=["Recipes"])
async def list_recipes(store: RecipeStore = Depends(get_store)):
    """List all recipes."""
    recipes = store.list()
    current = find_inference_process(settings.inference_port)
    result = []
    for r in recipes:
        status = "stopped"
        if _launching_recipe_id == r.id:
            status = "starting"
        if current:
            # Match by served_model_name first (most reliable)
            if current.served_model_name and r.served_model_name == current.served_model_name:
                status = "running"
            # Or match by model_path (check both directions for relative/absolute paths)
            elif current.model_path:
                if r.model_path in current.model_path or current.model_path in r.model_path:
                    status = "running"
                # Also check basename match
                elif current.model_path.split("/")[-1] == r.model_path.split("/")[-1]:
                    status = "running"
        result.append({**r.model_dump(), "status": status})
    return result


@app.get("/recipes/{recipe_id}", tags=["Recipes"])
async def get_recipe(recipe_id: str, store: RecipeStore = Depends(get_store)):
    """Get a recipe by ID."""
    recipe = store.get(recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@app.post("/recipes", tags=["Recipes"])
async def create_recipe(recipe: Recipe, store: RecipeStore = Depends(get_store)):
    """Create or update a recipe."""
    store.save(recipe)
    return {"success": True, "id": recipe.id}


@app.put("/recipes/{recipe_id}", tags=["Recipes"])
async def update_recipe(recipe_id: str, recipe: Recipe, store: RecipeStore = Depends(get_store)):
    """Update a recipe by ID."""
    if recipe.id != recipe_id:
        recipe.id = recipe_id
    store.save(recipe)
    return {"success": True, "id": recipe.id}


@app.delete("/recipes/{recipe_id}", tags=["Recipes"])
async def delete_recipe(recipe_id: str, store: RecipeStore = Depends(get_store)):
    """Delete a recipe."""
    if not store.delete(recipe_id):
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"success": True}


# --- Chat sessions ---
import uuid


@app.get("/chats", tags=["Chats"])
async def list_chat_sessions(chat_store: ChatStore = Depends(get_chat_store)):
    """List all chat sessions."""
    return chat_store.list_sessions()


@app.get("/chats/{session_id}", tags=["Chats"])
async def get_chat_session(session_id: str, chat_store: ChatStore = Depends(get_chat_store)):
    """Get a chat session with its messages."""
    session = chat_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": session}


@app.post("/chats", tags=["Chats"])
async def create_chat_session(request: Request, chat_store: ChatStore = Depends(get_chat_store)):
    """Create a new chat session."""
    body = await request.json()
    session_id = str(uuid.uuid4())
    title = body.get("title", "New Chat")
    model = body.get("model")
    session = chat_store.create_session(session_id, title, model)
    return {"session": session}


@app.put("/chats/{session_id}", tags=["Chats"])
async def update_chat_session(session_id: str, request: Request, chat_store: ChatStore = Depends(get_chat_store)):
    """Update a chat session (title, model)."""
    body = await request.json()
    if not chat_store.update_session(session_id, body.get("title"), body.get("model")):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


@app.delete("/chats/{session_id}", tags=["Chats"])
async def delete_chat_session(session_id: str, chat_store: ChatStore = Depends(get_chat_store)):
    """Delete a chat session."""
    if not chat_store.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


@app.post("/chats/{session_id}/messages", tags=["Chats"])
async def add_chat_message(session_id: str, request: Request, chat_store: ChatStore = Depends(get_chat_store)):
    """Add a message to a chat session."""
    body = await request.json()
    message_id = body.get("id", str(uuid.uuid4()))
    role = body.get("role", "user")
    content = body.get("content")
    model = body.get("model")
    tool_calls = body.get("tool_calls")
    request_prompt_tokens = body.get("request_prompt_tokens")
    request_tools_tokens = body.get("request_tools_tokens")
    request_total_input_tokens = body.get("request_total_input_tokens")
    request_completion_tokens = body.get("request_completion_tokens")
    message = chat_store.add_message(
        session_id, message_id, role, content, model, tool_calls,
        request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens
    )
    return message


@app.get("/chats/{session_id}/usage", tags=["Chats"])
async def get_chat_usage(session_id: str, chat_store: ChatStore = Depends(get_chat_store)):
    """Get token usage for a chat session."""
    return chat_store.get_usage(session_id)


@app.post("/chats/{session_id}/fork", tags=["Chats"])
async def fork_chat_session(session_id: str, request: Request, chat_store: ChatStore = Depends(get_chat_store)):
    """Fork a chat session, optionally from a specific message."""
    body = await request.json()
    new_id = str(uuid.uuid4())
    message_id = body.get("message_id")
    model = body.get("model")
    title = body.get("title")
    session = chat_store.fork_session(session_id, new_id, message_id, model, title)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": session}


# --- Model lifecycle ---
@app.post("/launch/{recipe_id}", response_model=LaunchResult, tags=["Lifecycle"])
async def launch(recipe_id: str, force: bool = False, store: RecipeStore = Depends(get_store)):
    """Launch a model by recipe ID with real-time progress updates.

    Supports preemption: if another model is loading, it will be cancelled
    and VRAM cleared before starting the new model.

    Progress events are emitted via SSE:
    - preempting: Cancelling in-progress launch
    - evicting: Stopping current model
    - launching: Starting new model
    - waiting: Waiting for model to be ready
    - ready: Model is ready to serve
    - cancelled: Launch was preempted by another request
    - error: Launch failed
    """
    global _launching_recipe_id, _launch_cancel_events
    import time
    import psutil

    recipe = store.get(recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Check if another launch is in progress and preempt it
    if _launching_recipe_id and _launching_recipe_id != recipe_id:
        preempted_recipe_id = _launching_recipe_id
        logger.info(f"Preempting launch of {preempted_recipe_id} for {recipe_id}")
        await event_manager.publish_launch_progress(
            recipe_id, "preempting", f"Cancelling {preempted_recipe_id}...", progress=0.0
        )
        await event_manager.publish_launch_progress(
            preempted_recipe_id, "cancelled", f"Preempted by {recipe_id}", progress=0.0
        )

        # Signal cancellation to the in-progress launch
        cancel_event = _launch_cancel_events.get(preempted_recipe_id)
        if cancel_event:
            cancel_event.set()

        # Force kill any running/loading process immediately
        await evict_model(force=True)
        await asyncio.sleep(1)

    # Create new cancellation event for this launch
    cancel_event = asyncio.Event()
    _launch_cancel_events[recipe_id] = cancel_event
    _launching_recipe_id = recipe_id

    try:
        # Use timeout on lock acquisition - don't wait forever
        try:
            await asyncio.wait_for(_switch_lock.acquire(), timeout=2.0)
        except asyncio.TimeoutError:
            # Lock held by another launch - force preemption
            logger.info(f"Lock contention - force preempting for {recipe_id}")
            await evict_model(force=True)
            await asyncio.sleep(1)
            await _switch_lock.acquire()

        try:
            # Stage 1: Evict current model (force kill for faster switch)
            await event_manager.publish_launch_progress(
                recipe_id, "evicting", "Clearing VRAM...", progress=0.0
            )
            await evict_model(force=True)
            await asyncio.sleep(1)

            # Check for preemption
            if cancel_event.is_set():
                await event_manager.publish_launch_progress(
                    recipe_id, "cancelled", "Preempted by another launch", progress=0.0
                )
                return LaunchResult(success=False, pid=None, message="Launch cancelled", log_file=None)

            # Stage 2: Launch new model
            await event_manager.publish_launch_progress(
                recipe_id, "launching", f"Starting {recipe.name}...", progress=0.25
            )

            # Import launch_model from process module
            from .process import launch_model
            success, pid, message = await launch_model(recipe)

            if not success:
                await event_manager.publish_launch_progress(
                    recipe_id, "error", message, progress=0.0
                )
                return LaunchResult(success=False, pid=None, message=message, log_file=None)

            # Stage 3: Wait for readiness (with preemption checks)
            await event_manager.publish_launch_progress(
                recipe_id, "waiting", "Waiting for model to load...", progress=0.5
            )

            # Poll health endpoint (up to 5 minutes, but check for preemption)
            start = time.time()
            timeout = 300
            ready = False
            crashed = False

            while time.time() - start < timeout:
                # Check for preemption FIRST
                if cancel_event.is_set():
                    logger.info(f"Launch of {recipe_id} cancelled during load")
                    await event_manager.publish_launch_progress(
                        recipe_id, "cancelled", "Preempted by another launch", progress=0.0
                    )
                    # Kill the process we just started
                    if pid:
                        try:
                            proc = psutil.Process(pid)
                            for child in proc.children(recursive=True):
                                child.kill()
                            proc.kill()
                        except psutil.NoSuchProcess:
                            pass
                    return LaunchResult(success=False, pid=None, message="Launch cancelled", log_file=None)

                # Check if process has crashed
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
                await asyncio.sleep(2)  # Reduced from 3s for more responsive preemption

            if crashed:
                # Read the last lines from the log file for error context
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
                logger.info(f"Model {recipe_id} is ready, watchdog tracking active")
                return LaunchResult(
                    success=True,
                    pid=pid,
                    message="Model is ready",
                    log_file=f"/tmp/vllm_{recipe_id}.log",
                )
            else:
                # On timeout, stop the process to avoid leaving a hung backend around.
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
        # Clear launching state when done
        if _launching_recipe_id == recipe_id:
            _launching_recipe_id = None
        # Clear cancellation event when done (avoid cross-launch cancellation bugs)
        if _launch_cancel_events.get(recipe_id) is cancel_event:
            del _launch_cancel_events[recipe_id]


@app.post("/evict", tags=["Lifecycle"])
async def evict(force: bool = False):
    """Stop the running model."""
    async with _switch_lock:
        pid = await evict_model(force=force)
    logger.info(f"Model evicted (pid={pid})")
    return {"success": True, "evicted_pid": pid}


@app.get("/wait-ready", tags=["Lifecycle"])
async def wait_ready(timeout: int = 300):
    """Wait for inference backend to be ready."""
    import time

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


# --- Logs ---
def _log_path_for(session_id: str) -> Path:
    safe = "".join(ch for ch in (session_id or "") if ch.isalnum() or ch in ("-", "_", "."))
    if not safe:
        raise HTTPException(status_code=400, detail="Invalid log session id")
    return Path("/tmp") / f"vllm_{safe}.log"


def _tail_lines(path: Path, limit: int) -> list[str]:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            return list(deque(f, maxlen=limit))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Log not found")


@app.get("/logs", tags=["Logs"])
async def list_logs(store: RecipeStore = Depends(get_store)):
    """List available inference log files."""
    current = find_inference_process(settings.inference_port)
    log_files = sorted(Path("/tmp").glob("vllm_*.log"), key=lambda p: p.stat().st_mtime, reverse=True)

    sessions = []
    for p in log_files:
        sid = p.name.removeprefix("vllm_").removesuffix(".log")
        recipe = store.get(sid)
        created_at = dt.datetime.fromtimestamp(p.stat().st_mtime, tz=dt.timezone.utc).isoformat()

        status = "stopped"
        if current and recipe and current.model_path and recipe.model_path and recipe.model_path in current.model_path:
            status = "running"
        elif current and recipe and current.served_model_name and recipe.served_model_name == current.served_model_name:
            status = "running"

        sessions.append(
            {
                "id": sid,
                "recipe_id": recipe.id if recipe else sid,
                "recipe_name": recipe.name if recipe else None,
                "model_path": recipe.model_path if recipe else None,
                "model": (recipe.served_model_name or recipe.name) if recipe else sid,
                "backend": recipe.backend.value if recipe else None,
                "created_at": created_at,
                "status": status,
            }
        )

    return {"sessions": sessions}


@app.get("/logs/{session_id}", tags=["Logs"])
async def get_logs(session_id: str, limit: int = 2000):
    """Get log content for a session (returns both `logs` and `content` for UI compatibility)."""
    limit = max(1, min(int(limit), 20000))
    path = _log_path_for(session_id)
    lines = _tail_lines(path, limit)
    logs = [ln.rstrip("\n") for ln in lines]
    return {"id": session_id, "logs": logs, "content": "\n".join(logs)}


@app.delete("/logs/{session_id}", tags=["Logs"])
async def delete_logs(session_id: str):
    """Delete a log file."""
    path = _log_path_for(session_id)
    try:
        path.unlink()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Log not found")
    return {"success": True}


# --- Real-time events (SSE) endpoints ---
@app.get("/events", tags=["Events"])
async def events_stream():
    """Subscribe to real-time status updates via Server-Sent Events.

    Events emitted:
    - status: Process status (running/stopped, model info)
    - gpu: GPU metrics (utilization, memory, temperature)
    - metrics: vLLM performance metrics
    - launch_progress: Model launch progress

    Example usage:
        const es = new EventSource('/events');
        es.addEventListener('status', (e) => console.log(JSON.parse(e.data)));
    """
    async def event_generator():
        try:
            async for event in event_manager.subscribe():
                yield event.to_sse()
        except asyncio.CancelledError:
            pass  # Client disconnected

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@app.get("/logs/{session_id}/stream", tags=["Logs"])
async def stream_logs(session_id: str):
    """Stream log file updates in real-time via SSE.

    First sends existing log content, then tails new lines as they're added.
    """
    path = _log_path_for(session_id)

    async def log_generator():
        try:
            # Send existing content first
            if path.exists():
                with path.open("r", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        event = Event(type="log", data={"line": line.rstrip("\n")})
                        yield event.to_sse()

            # Then stream new lines
            async for event in event_manager.subscribe(f"logs:{session_id}"):
                yield event.to_sse()
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        log_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
        }
    )


@app.get("/events/stats", tags=["Events"])
async def events_stats():
    """Get event manager statistics for monitoring."""
    return event_manager.get_stats()


# --- Prometheus metrics ---
@app.get("/metrics", tags=["Monitoring"])
async def metrics():
    """Prometheus metrics endpoint.

    Exposes metrics for:
    - Model switches and launch failures
    - GPU utilization, memory, temperature
    - SSE connection stats
    - Active model information
    """
    from fastapi.responses import Response

    # Update metrics before serving
    current = find_inference_process(settings.inference_port)
    if current:
        update_active_model(
            model_path=current.model_path,
            backend=current.backend,
            served_name=current.served_model_name
        )
    else:
        update_active_model()

    gpu_list = get_gpu_info()
    update_gpu_metrics([gpu.model_dump() for gpu in gpu_list])

    sse_stats = event_manager.get_stats()
    update_sse_metrics(sse_stats)

    return Response(
        content=get_metrics_content(),
        media_type=get_metrics_content_type()
    )


# --- Peak metrics & benchmark ---
@app.get("/peak-metrics", tags=["Monitoring"])
async def get_peak_metrics(
    model_id: str = None,
    metrics_store: PeakMetricsStore = Depends(get_peak_metrics_store)
):
    """Get stored peak performance metrics."""
    if model_id:
        result = metrics_store.get(model_id)
        return result or {"error": "No metrics for this model"}
    return {"metrics": metrics_store.get_all()}


@app.get("/lifetime-metrics", tags=["Monitoring"])
async def get_lifetime_metrics(
    lifetime_store: LifetimeMetricsStore = Depends(get_lifetime_metrics_store)
):
    """Get lifetime/cumulative metrics across all sessions.

    Returns:
        - tokens_total: Total tokens generated (lifetime)
        - requests_total: Total requests served (lifetime)
        - energy_wh: Total energy consumed in Watt-hours
        - uptime_seconds: Total model uptime in seconds
        - first_started_at: Unix timestamp of first start
        - derived metrics: energy_kwh, uptime_hours, kwh_per_million_tokens
    """
    data = lifetime_store.get_all()
    uptime_hours = data.get('uptime_seconds', 0) / 3600.0
    energy_kwh = data.get('energy_wh', 0) / 1000.0
    tokens = data.get('tokens_total', 0)
    kwh_per_million = (energy_kwh / (tokens / 1_000_000)) if tokens > 0 else 0

    # Get current power
    gpu_list = get_gpu_info()
    current_power_watts = sum(gpu.power_draw for gpu in gpu_list)

    return {
        "tokens_total": int(data.get('tokens_total', 0)),
        "requests_total": int(data.get('requests_total', 0)),
        "energy_wh": data.get('energy_wh', 0),
        "energy_kwh": energy_kwh,
        "uptime_seconds": data.get('uptime_seconds', 0),
        "uptime_hours": uptime_hours,
        "first_started_at": data.get('first_started_at', 0),
        "kwh_per_million_tokens": kwh_per_million,
        "current_power_watts": current_power_watts,
    }


@app.post("/benchmark", tags=["Monitoring"])
async def run_benchmark(
    prompt_tokens: int = 1000,
    max_tokens: int = 100,
    metrics_store: PeakMetricsStore = Depends(get_peak_metrics_store)
):
    """Run a benchmark and store peak metrics if better than existing.

    Sends a request with ~prompt_tokens input and max_tokens output,
    measures TTFT, prefill speed, and generation speed.
    Only updates stored metrics if new values are better.
    """
    import time as time_module

    current = find_inference_process(settings.inference_port)
    if not current:
        return {"error": "No model running"}

    model_id = current.served_model_name or current.model_path.split('/')[-1]

    # Generate prompt of approximately prompt_tokens tokens (rough estimate: 4 chars per token)
    prompt = "Please count: " + " ".join([str(i) for i in range(prompt_tokens // 2)])

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            start_time = time_module.perf_counter()

            response = await client.post(
                f"http://localhost:{settings.inference_port}/v1/chat/completions",
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "stream": False
                }
            )

            total_time = time_module.perf_counter() - start_time

            if response.status_code != 200:
                return {"error": f"Request failed: {response.status_code}"}

            data = response.json()
            usage = data.get("usage", {})
            prompt_tokens_actual = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)

            # Calculate metrics
            # Estimate prefill time as ~10% of total for short outputs, adjust based on ratio
            if completion_tokens > 0 and prompt_tokens_actual > 0:
                # Rough estimate: prefill takes prompt_tokens/(prompt_tokens + completion_tokens * gen_ratio) of time
                # For thinking models, generation is slower, so adjust
                prefill_ratio = prompt_tokens_actual / (prompt_tokens_actual + completion_tokens * 10)
                prefill_time = total_time * prefill_ratio
                generation_time = total_time - prefill_time

                prefill_tps = prompt_tokens_actual / prefill_time if prefill_time > 0 else 0
                generation_tps = completion_tokens / generation_time if generation_time > 0 else 0

                # TTFT estimate (first token time) - rough approximation
                ttft_ms = prefill_time * 1000

                # Update if better
                result = metrics_store.update_if_better(
                    model_id=model_id,
                    prefill_tps=prefill_tps,
                    generation_tps=generation_tps,
                    ttft_ms=ttft_ms
                )

                # Add to cumulative totals
                metrics_store.add_tokens(model_id, completion_tokens, 1)

                return {
                    "success": True,
                    "model_id": model_id,
                    "benchmark": {
                        "prompt_tokens": prompt_tokens_actual,
                        "completion_tokens": completion_tokens,
                        "total_time_s": round(total_time, 2),
                        "prefill_tps": round(prefill_tps, 1),
                        "generation_tps": round(generation_tps, 1),
                        "ttft_ms": round(ttft_ms, 0)
                    },
                    "peak_metrics": result
                }
            else:
                return {"error": "No tokens in response"}

    except Exception as e:
        return {"error": str(e)}


# --- MCP (minimal built-in tools) ---
_MCP_CFG_NAME = "mcp_servers.json"


def _mcp_cfg_path() -> Path:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings.data_dir / _MCP_CFG_NAME


def _read_mcp_servers() -> list[dict]:
    path = _mcp_cfg_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [s for s in data if isinstance(s, dict)]
    except Exception:
        return []
    return []


def _write_mcp_servers(servers: list[dict]) -> None:
    _mcp_cfg_path().write_text(json.dumps(servers, indent=2, sort_keys=True), encoding="utf-8")


@app.get("/mcp/servers", tags=["MCP"])
async def list_mcp_servers():
    return _read_mcp_servers()


@app.post("/mcp/servers", tags=["MCP"])
async def add_mcp_server(server: dict):
    name = str(server.get("name") or "").strip()
    command = str(server.get("command") or "").strip()
    if not name or not command:
        raise HTTPException(status_code=400, detail="`name` and `command` required")

    servers = [s for s in _read_mcp_servers() if s.get("name") != name]
    server["name"] = name
    server["command"] = command
    server["enabled"] = bool(server.get("enabled", True))
    server["args"] = list(server.get("args") or [])
    server["env"] = dict(server.get("env") or {})
    servers.append(server)
    _write_mcp_servers(servers)
    return {"success": True}


@app.put("/mcp/servers/{name}", tags=["MCP"])
async def update_mcp_server(name: str, server: dict):
    server["name"] = name
    return await add_mcp_server(server)


@app.delete("/mcp/servers/{name}", tags=["MCP"])
async def delete_mcp_server(name: str):
    servers = _read_mcp_servers()
    next_servers = [s for s in servers if s.get("name") != name]
    if len(next_servers) == len(servers):
        raise HTTPException(status_code=404, detail="Server not found")
    _write_mcp_servers(next_servers)
    return {"success": True}


@app.get("/mcp/tools", tags=["MCP"])
async def list_mcp_tools():
    # Provide a small built-in tool set so tool-calling works out of the box.
    return {
        "tools": [
            {
                "server": "builtin",
                "name": "time",
                "description": "Get the current time (UTC) as an ISO 8601 string.",
                "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
            },
            {
                "server": "builtin",
                "name": "fetch",
                "description": "Fetch a URL via HTTP GET and return text (truncated).",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "URL to fetch"},
                        "max_bytes": {"type": "integer", "description": "Max bytes to return", "default": 20000},
                        "timeout_sec": {"type": "number", "description": "Request timeout seconds", "default": 20},
                        "headers": {"type": "object", "additionalProperties": {"type": "string"}},
                    },
                    "required": ["url"],
                    "additionalProperties": False,
                },
            },
            {
                "server": "exa",
                "name": "search",
                "description": "Search the web using Exa AI. Returns relevant results with titles, URLs, and content snippets.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "num_results": {"type": "integer", "description": "Number of results (1-10)", "default": 5},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        ]
    }


@app.post("/mcp/tools/{server}/{tool_name}", tags=["MCP"])
async def call_mcp_tool(server: str, tool_name: str, payload: dict):
    # Exa search
    if server == "exa" and tool_name == "search":
        query = str(payload.get("query") or "").strip()
        if not query:
            raise HTTPException(status_code=400, detail="`query` required")
        num_results = min(10, max(1, int(payload.get("num_results") or 5)))

        # Get API key from MCP config
        exa_key = None
        for srv in _read_mcp_servers():
            if srv.get("name") == "exa":
                exa_key = srv.get("env", {}).get("EXA_API_KEY")
                break

        if not exa_key:
            exa_key = os.environ.get("EXA_API_KEY")

        if not exa_key:
            raise HTTPException(status_code=500, detail="EXA_API_KEY not configured")

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://api.exa.ai/search",
                headers={"x-api-key": exa_key, "Content-Type": "application/json"},
                json={"query": query, "numResults": num_results, "contents": {"text": {"maxCharacters": 1000}}},
            )
            if r.status_code != 200:
                return {"result": f"Exa API error: {r.status_code} - {r.text[:500]}"}
            data = r.json()
            results = []
            for item in data.get("results", []):
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "text": item.get("text", "")[:500],
                })
            return {"result": results}

    if server != "builtin":
        raise HTTPException(status_code=404, detail="Unknown MCP server")

    if tool_name == "time":
        return {"result": {"utc": dt.datetime.now(tz=dt.timezone.utc).isoformat()}}

    if tool_name == "fetch":
        url = str(payload.get("url") or "").strip()
        if not url:
            raise HTTPException(status_code=400, detail="`url` required")
        max_bytes = int(payload.get("max_bytes") or 20000)
        max_bytes = max(1, min(max_bytes, 250_000))
        timeout_sec = float(payload.get("timeout_sec") or 20)
        timeout_sec = max(1.0, min(timeout_sec, 120.0))
        headers = payload.get("headers") or {}
        if not isinstance(headers, dict):
            headers = {}

        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout_sec) as client:
            r = await client.get(url, headers={str(k): str(v) for k, v in headers.items()})
            body = r.content[:max_bytes]
            text = body.decode("utf-8", errors="replace")
            return {
                "result": {
                    "url": str(r.url),
                    "status_code": r.status_code,
                    "content_type": r.headers.get("content-type"),
                    "text": text,
                    "truncated": len(r.content) > len(body),
                }
            }

    raise HTTPException(status_code=404, detail="Unknown MCP tool")

@app.get("/v1/studio/models", tags=["OpenAI Compatible"])
async def list_studio_models(store: RecipeStore = Depends(get_store)):
    """List available local model weight directories.

    This is a UX helper endpoint for the Studio UI. It scans:

    - `VLLM_STUDIO_MODELS_DIR` (if set and exists)
    - Parent directories of any *local* recipe `model_path` entries

    Each returned model includes lightweight metadata and the list of recipe IDs
    that reference it.
    """
    from collections import defaultdict
    from pathlib import Path

    from .browser import build_model_info, discover_model_dirs

    recipes = store.list()

    # Index recipes by canonical local path and basename.
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

    # Choose scan roots: configured models_dir + parents of recipe paths.
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
            # Conservative fallback: only basename match if it uniquely identifies a recipe.
            by_name = recipes_by_basename.get(d.name, [])
            if len(by_name) == 1:
                recipe_ids = list(by_name)

        models.append(build_model_info(d, recipe_ids=recipe_ids).model_dump())

    models.sort(key=lambda m: (m.get("name") or "").lower())

    # Serialize roots (sets -> lists)
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


# --- OpenAI Chat Completions Proxy ---

def _find_recipe_by_model(store: RecipeStore, model_name: str) -> Optional[Recipe]:
    """Find a recipe by served_model_name or id (case-insensitive)."""
    if not model_name:
        return None
    recipes = store.list()
    model_lower = model_name.lower()
    for recipe in recipes:
        served_lower = (recipe.served_model_name or "").lower()
        id_lower = recipe.id.lower()
        if served_lower == model_lower or id_lower == model_lower:
            logger.info(f"_find_recipe_by_model: matched '{model_name}' to recipe id='{recipe.id}'")
            return recipe
    logger.warning(f"_find_recipe_by_model: no recipe found for '{model_name}'")
    return None


async def _ensure_model_running(requested_model: str, store: RecipeStore) -> Optional[str]:
    """Ensure the requested model is running, auto-switching if needed.

    Returns None if model is ready, or an error message if switch failed.
    """
    import time
    import psutil
    from .process import launch_model

    if not requested_model:
        logger.debug("_ensure_model_running: no requested_model provided")
        return None

    requested_lower = requested_model.lower()

    # Check what's currently running
    current = find_inference_process(settings.inference_port)
    current_name = current.served_model_name if current else None
    logger.info(f"_ensure_model_running: requested='{requested_model}', current='{current_name}'")

    # If the requested model is already running, we're done (case-insensitive)
    if current_name and current_name.lower() == requested_lower:
        logger.debug(f"_ensure_model_running: model '{requested_model}' already running")
        return None

    # Find recipe for the requested model
    recipe = _find_recipe_by_model(store, requested_model)
    if not recipe:
        # No recipe found - let LiteLLM handle it (might be an external model)
        logger.warning(f"_ensure_model_running: no recipe found for '{requested_model}', passing through to LiteLLM")
        return None

    # Need to switch models - acquire lock and switch
    async with _switch_lock:
        # Double-check after acquiring lock (case-insensitive)
        current = find_inference_process(settings.inference_port)
        current_name = current.served_model_name if current else None
        if current_name and current_name.lower() == requested_lower:
            return None

        logger.info(f"Auto-switching model: {current.served_model_name if current else 'none'} -> {requested_model}")

        # Evict current model
        await evict_model(force=False)
        await asyncio.sleep(2)

        # Launch new model
        success, pid, message = await launch_model(recipe)
        if not success:
            logger.error(f"Auto-switch failed to launch {requested_model}: {message}")
            return f"Failed to launch model {requested_model}: {message}"

        # Wait for readiness (up to 5 minutes)
        start = time.time()
        timeout = 300
        ready = False

        while time.time() - start < timeout:
            # Check if process crashed
            if pid and not psutil.pid_exists(pid):
                log_file = Path(f"/tmp/vllm_{recipe.id}.log")
                error_tail = ""
                if log_file.exists():
                    try:
                        error_tail = log_file.read_text()[-500:]
                    except Exception:
                        pass
                return f"Model {requested_model} crashed during startup: {error_tail[-200:]}"

            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    r = await client.get(f"http://localhost:{settings.inference_port}/health")
                    if r.status_code == 200:
                        ready = True
                        break
            except Exception:
                pass

            await asyncio.sleep(3)

        if not ready:
            return f"Model {requested_model} failed to become ready (timeout)"

        logger.info(f"Auto-switch complete: {requested_model} is ready")
        return None


@app.post("/v1/chat/completions", tags=["OpenAI Compatible"])
async def chat_completions_proxy(request: Request, store: RecipeStore = Depends(get_store)):
    """Proxy chat completions to LiteLLM backend with auto-eviction support.

    If the requested model differs from the currently running model and a matching
    recipe exists, the controller will automatically evict the current model and
    launch the requested one before forwarding the request.
    """
    import os
    try:
        body = await request.body()

        # Parse request to get model and streaming flag
        try:
            data = json.loads(body)
            requested_model = data.get("model")
            is_streaming = data.get("stream", False)
        except Exception:
            requested_model = None
            is_streaming = False

        # Auto-switch model if needed
        if requested_model:
            switch_error = await _ensure_model_running(requested_model, store)
            if switch_error:
                raise HTTPException(status_code=503, detail=switch_error)

        # Use LiteLLM master key for backend auth (controller already validated the request)
        litellm_key = os.environ.get("LITELLM_MASTER_KEY", "sk-master")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {litellm_key}",
        }

        litellm_url = "http://localhost:4100/v1/chat/completions"

        if is_streaming:
            # Track thinking state for <think> tag parsing across chunks
            think_state = {"in_thinking": False}

            def parse_think_tags_from_content(data: dict) -> dict:
                """Parse <think>...</think> from content and convert to reasoning_content."""
                if 'choices' not in data:
                    return data

                for choice in data['choices']:
                    delta = choice.get('delta', {})
                    content = delta.get('content')

                    if not content:
                        continue

                    # Already has reasoning_content, skip parsing
                    if delta.get('reasoning_content'):
                        continue

                    # Handle </think> without opening tag (vLLM sometimes strips <think>)
                    # If we see </think> but aren't in thinking mode and no <think>, assume everything before is thinking
                    if '</think>' in content and '<think>' not in content and not think_state["in_thinking"]:
                        parts = content.split('</think>', 1)
                        reasoning = parts[0]
                        remaining = parts[1] if len(parts) > 1 else ''
                        delta['reasoning_content'] = reasoning
                        delta['content'] = remaining.strip() or None
                        continue

                    # Handle <think> and </think> tags in content
                    if '<think>' in content:
                        # Split on <think> tag
                        parts = content.split('<think>', 1)
                        before = parts[0]
                        after = parts[1] if len(parts) > 1 else ''

                        think_state["in_thinking"] = True

                        # Check if </think> is also in this chunk
                        if '</think>' in after:
                            think_parts = after.split('</think>', 1)
                            reasoning = think_parts[0]
                            remaining = think_parts[1] if len(think_parts) > 1 else ''
                            think_state["in_thinking"] = False

                            delta['reasoning_content'] = reasoning
                            delta['content'] = (before + remaining).strip() or None
                        else:
                            delta['reasoning_content'] = after
                            delta['content'] = before.strip() or None

                    elif think_state["in_thinking"]:
                        # We're in thinking mode from a previous chunk
                        if '</think>' in content:
                            # End of thinking
                            parts = content.split('</think>', 1)
                            reasoning = parts[0]
                            remaining = parts[1] if len(parts) > 1 else ''
                            think_state["in_thinking"] = False

                            delta['reasoning_content'] = reasoning
                            delta['content'] = remaining.strip() or None
                        else:
                            # Still in thinking - all content is reasoning
                            delta['reasoning_content'] = content
                            delta['content'] = None

                return data

            async def stream_response():
                async with httpx.AsyncClient(timeout=300) as client:
                    async with client.stream("POST", litellm_url, content=body, headers=headers) as response:
                        async for chunk in response.aiter_bytes():
                            # Filter out malformed chunks with role:user (LiteLLM bug)
                            chunk_str = chunk.decode('utf-8', errors='ignore')
                            if '"role":"user"' in chunk_str and '"tool_calls":[]' in chunk_str:
                                continue

                            # Fix vLLM duplicate reasoning fields bug:
                            # vLLM outputs both "reasoning" and "reasoning_content" with identical content
                            # for backwards compatibility. Strip "reasoning" to prevent client duplication.
                            if '"reasoning":' in chunk_str and '"reasoning_content":' in chunk_str:
                                try:
                                    # Process each SSE line
                                    lines = chunk_str.split('\n')
                                    fixed_lines = []
                                    for line in lines:
                                        if line.startswith('data: ') and line != 'data: [DONE]':
                                            data_json = line[6:]  # Remove 'data: ' prefix
                                            if data_json.strip():
                                                data = json.loads(data_json)
                                                # Remove duplicate "reasoning" field from delta
                                                if 'choices' in data:
                                                    for choice in data['choices']:
                                                        if 'delta' in choice and 'reasoning' in choice['delta']:
                                                            del choice['delta']['reasoning']
                                                fixed_lines.append('data: ' + json.dumps(data))
                                            else:
                                                fixed_lines.append(line)
                                        else:
                                            fixed_lines.append(line)
                                    chunk = ('\n'.join(fixed_lines)).encode('utf-8')
                                except Exception:
                                    pass  # On parse error, pass through original chunk

                            # Parse <think>...</think> tags from content to reasoning_content
                            # This handles models that output thinking in content (e.g., GLM-4.7-reap-50)
                            if '<think>' in chunk_str or think_state["in_thinking"]:
                                try:
                                    lines = chunk_str.split('\n')
                                    fixed_lines = []
                                    for line in lines:
                                        if line.startswith('data: ') and line != 'data: [DONE]':
                                            data_json = line[6:]
                                            if data_json.strip():
                                                data = json.loads(data_json)
                                                data = parse_think_tags_from_content(data)
                                                fixed_lines.append('data: ' + json.dumps(data))
                                            else:
                                                fixed_lines.append(line)
                                        else:
                                            fixed_lines.append(line)
                                    chunk = ('\n'.join(fixed_lines)).encode('utf-8')
                                except Exception as e:
                                    logger.warning(f"Think tag parsing error: {e}")
                                    pass

                            yield chunk

            return StreamingResponse(
                stream_response(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                }
            )
        else:
            async with httpx.AsyncClient(timeout=300) as client:
                response = await client.post(litellm_url, content=body, headers=headers)
                return JSONResponse(
                    content=response.json(),
                    status_code=response.status_code
                )
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="LiteLLM backend unavailable")
    except Exception as e:
        logger.error(f"Chat completions proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- Usage Analytics (LiteLLM Spend Logs) ---
@app.get("/usage", tags=["Analytics"])
async def get_usage_stats():
    """Get token usage statistics from LiteLLM spend logs."""
    import asyncpg

    import os
    # Use localhost for host-based controller
    db_url = "postgresql://postgres:postgres@127.0.0.1:5432/litellm"
    logger.info(f"[USAGE] Connecting to: {db_url}")

    try:
        conn = await asyncpg.connect(db_url)
        
        # Totals
        totals = await conn.fetchrow('''
            SELECT 
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COUNT(*) as total_requests
            FROM "LiteLLM_SpendLogs"
        ''')
        
        # Cache stats
        cache_stats = await conn.fetch('''
            SELECT 
                cache_hit,
                COUNT(*) as count,
                COALESCE(SUM(total_tokens), 0) as tokens
            FROM "LiteLLM_SpendLogs"
            GROUP BY cache_hit
        ''')
        
        # By model
        by_model = await conn.fetch('''
            SELECT 
                model,
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COUNT(*) as requests
            FROM "LiteLLM_SpendLogs"
            WHERE model != '' AND model IS NOT NULL
            GROUP BY model
            ORDER BY total_tokens DESC
            LIMIT 20
        ''')
        
        # Daily breakdown (last 14 days)
        daily = await conn.fetch('''
            SELECT 
                DATE("startTime") as date,
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COUNT(*) as requests
            FROM "LiteLLM_SpendLogs"
            WHERE "startTime" >= CURRENT_DATE - INTERVAL '14 days'
            GROUP BY DATE("startTime")
            ORDER BY date DESC
        ''')
        
        await conn.close()
        
        # Format cache stats
        cache_formatted = {
            "hits": 0,
            "misses": 0,
            "hit_tokens": 0,
            "miss_tokens": 0
        }
        for row in cache_stats:
            if row["cache_hit"] == "True":
                cache_formatted["hits"] = row["count"]
                cache_formatted["hit_tokens"] = row["tokens"]
            elif row["cache_hit"] == "False":
                cache_formatted["misses"] = row["count"]
                cache_formatted["miss_tokens"] = row["tokens"]
        
        return {
            "totals": {
                "total_tokens": totals["total_tokens"],
                "prompt_tokens": totals["prompt_tokens"],
                "completion_tokens": totals["completion_tokens"],
                "total_requests": totals["total_requests"]
            },
            "cache": cache_formatted,
            "by_model": [
                {
                    "model": row["model"],
                    "total_tokens": row["total_tokens"],
                    "prompt_tokens": row["prompt_tokens"],
                    "completion_tokens": row["completion_tokens"],
                    "requests": row["requests"]
                }
                for row in by_model
            ],
            "daily": [
                {
                    "date": row["date"].isoformat(),
                    "total_tokens": row["total_tokens"],
                    "prompt_tokens": row["prompt_tokens"],
                    "completion_tokens": row["completion_tokens"],
                    "requests": row["requests"]
                }
                for row in daily
            ]
        }
    except Exception as e:
        logger.error(f"Failed to fetch usage stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))
