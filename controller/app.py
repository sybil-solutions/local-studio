"""vLLM Studio Controller - FastAPI Application."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import settings
from .events import event_manager
from .gpu import get_gpu_info
from .metrics import (
    update_active_model, update_gpu_metrics, update_sse_metrics,
    get_metrics_content, get_metrics_content_type
)
from .process import find_inference_process
from .store import RecipeStore, ChatStore, PeakMetricsStore, LifetimeMetricsStore, MCPStore

import httpx
import re

# Route modules
from .routes import (
    system_router,
    models_router,
    lifecycle_router,
    chats_router,
    logs_router,
    monitoring_router,
    mcp_router,
    proxy_router,
    usage_router,
)

logger = logging.getLogger(__name__)

# Global stores (singleton pattern)
_store: Optional[RecipeStore] = None
_chat_store: Optional[ChatStore] = None
_peak_metrics_store: Optional[PeakMetricsStore] = None
_lifetime_metrics_store: Optional[LifetimeMetricsStore] = None
_mcp_store: Optional[MCPStore] = None

# Background task handle for metrics collection
_metrics_task: Optional[asyncio.Task] = None

# Cache for vLLM metrics (for rate calculations)
_last_vllm_metrics: dict = {}
_last_metrics_time: float = 0


async def _scrape_vllm_metrics(port: int) -> dict:
    """Scrape metrics from vLLM Prometheus endpoint."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"http://localhost:{port}/metrics")
            if response.status_code != 200:
                return {}

            metrics = {}
            for line in response.text.split('\n'):
                if line.startswith('#') or not line.strip():
                    continue

                # Parse Prometheus format: metric_name{labels} value
                match = re.match(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?[^}]*\}?\s+([\d.eE+-]+)$', line)
                if match:
                    name, value = match.groups()
                    try:
                        metrics[name] = float(value)
                    except ValueError:
                        pass

            return metrics
    except Exception:
        return {}


def get_store() -> RecipeStore:
    """Get the recipe store singleton."""
    global _store
    if _store is None:
        _store = RecipeStore(settings.db_path)
    return _store


def get_chat_store() -> ChatStore:
    """Get the chat store singleton."""
    global _chat_store
    if _chat_store is None:
        _chat_store = ChatStore(settings.data_dir / "chats.db")
    return _chat_store


def get_peak_metrics_store() -> PeakMetricsStore:
    """Get the peak metrics store singleton."""
    global _peak_metrics_store
    if _peak_metrics_store is None:
        _peak_metrics_store = PeakMetricsStore(settings.db_path)
    return _peak_metrics_store


def get_lifetime_metrics_store() -> LifetimeMetricsStore:
    """Get the lifetime metrics store singleton."""
    global _lifetime_metrics_store
    if _lifetime_metrics_store is None:
        _lifetime_metrics_store = LifetimeMetricsStore(settings.db_path)
    return _lifetime_metrics_store


def get_mcp_store() -> MCPStore:
    """Get the MCP store singleton."""
    global _mcp_store
    if _mcp_store is None:
        _mcp_store = MCPStore(settings.db_path)
    return _mcp_store


async def _collect_and_broadcast_metrics():
    """Background task to collect metrics and broadcast updates."""
    global _last_vllm_metrics, _last_metrics_time
    import time

    while True:
        try:
            # Collect current state
            current = find_inference_process(settings.inference_port)
            gpu_list = get_gpu_info()

            # Update Prometheus metrics
            if current:
                update_active_model(
                    model_path=current.model_path,
                    backend=current.backend,
                    served_name=current.served_model_name
                )
            else:
                update_active_model()

            update_gpu_metrics([gpu.model_dump() for gpu in gpu_list])

            sse_stats = event_manager.get_stats()
            update_sse_metrics(sse_stats)

            # Update lifetime metrics (energy tracking)
            lifetime_store = get_lifetime_metrics_store()
            total_power_watts = sum(gpu.power_draw for gpu in gpu_list)
            # Convert watts to watt-hours for 5 second interval: W * (5/3600) = Wh
            energy_wh = total_power_watts * (5 / 3600)
            lifetime_store.increment('energy_wh', energy_wh)
            lifetime_store.increment('uptime_seconds', 5)

            # Broadcast status update via SSE (matching /status endpoint format)
            await event_manager.publish_status({
                "running": current is not None,
                "process": current.model_dump() if current else None,
                "inference_port": settings.inference_port,
            })

            # Also broadcast GPU info
            await event_manager.publish_gpu([gpu.model_dump() for gpu in gpu_list])

            # Collect and broadcast vLLM metrics
            if current:
                vllm_metrics = await _scrape_vllm_metrics(settings.inference_port)
                now = time.time()
                elapsed = now - _last_metrics_time if _last_metrics_time > 0 else 5

                # Calculate throughput rates
                prompt_throughput = 0.0
                generation_throughput = 0.0

                if vllm_metrics and _last_vllm_metrics and elapsed > 0:
                    prev_prompt = _last_vllm_metrics.get('vllm:prompt_tokens_total', 0)
                    curr_prompt = vllm_metrics.get('vllm:prompt_tokens_total', 0)
                    prev_gen = _last_vllm_metrics.get('vllm:generation_tokens_total', 0)
                    curr_gen = vllm_metrics.get('vllm:generation_tokens_total', 0)

                    if curr_prompt > prev_prompt:
                        prompt_throughput = (curr_prompt - prev_prompt) / elapsed
                    if curr_gen > prev_gen:
                        generation_throughput = (curr_gen - prev_gen) / elapsed

                _last_vllm_metrics = vllm_metrics
                _last_metrics_time = now

                # Get peak metrics
                peak_store = get_peak_metrics_store()
                model_id = current.served_model_name or current.model_path.split('/')[-1]
                peak_data = peak_store.get(model_id)

                # Get lifetime metrics
                lifetime_data = lifetime_store.get_all()

                # Broadcast combined metrics
                await event_manager.publish_metrics({
                    # Real-time from vLLM
                    "running_requests": int(vllm_metrics.get('vllm:num_requests_running', 0)),
                    "pending_requests": int(vllm_metrics.get('vllm:num_requests_waiting', 0)),
                    "kv_cache_usage": vllm_metrics.get('vllm:kv_cache_usage_perc', 0),
                    "prompt_tokens_total": int(vllm_metrics.get('vllm:prompt_tokens_total', 0)),
                    "generation_tokens_total": int(vllm_metrics.get('vllm:generation_tokens_total', 0)),

                    # Calculated throughput
                    "prompt_throughput": round(prompt_throughput, 1),
                    "generation_throughput": round(generation_throughput, 1),

                    # Peak metrics (from benchmark)
                    "peak_prefill_tps": peak_data.get('prefill_tps') if peak_data else None,
                    "peak_generation_tps": peak_data.get('generation_tps') if peak_data else None,
                    "peak_ttft_ms": peak_data.get('ttft_ms') if peak_data else None,

                    # Lifetime metrics
                    "lifetime_prompt_tokens": lifetime_data.get('prompt_tokens_total', 0),
                    "lifetime_completion_tokens": lifetime_data.get('completion_tokens_total', 0),
                    "lifetime_requests": lifetime_data.get('requests_total', 0),
                    "lifetime_energy_kwh": lifetime_data.get('energy_wh', 0) / 1000,
                    "lifetime_uptime_hours": lifetime_data.get('uptime_seconds', 0) / 3600,

                    # Current power
                    "current_power_watts": total_power_watts,

                    # Cost efficiency metrics
                    "kwh_per_million_input": (lifetime_data.get('energy_wh', 0) / 1000) / (lifetime_data.get('prompt_tokens_total', 1) / 1_000_000) if lifetime_data.get('prompt_tokens_total', 0) > 0 else None,
                    "kwh_per_million_output": (lifetime_data.get('energy_wh', 0) / 1000) / (lifetime_data.get('completion_tokens_total', 1) / 1_000_000) if lifetime_data.get('completion_tokens_total', 0) > 0 else None,
                })

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Metrics collection error: {e}")

        await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global _metrics_task

    logger.info(f"Starting vLLM Studio Controller v{__version__}")
    logger.info(f"Data directory: {settings.data_dir}")
    logger.info(f"Database: {settings.db_path}")

    # Ensure data directory exists
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    # Initialize stores
    get_store()
    get_chat_store()
    get_peak_metrics_store()
    get_lifetime_metrics_store()
    get_mcp_store()

    # Start background metrics collection
    _metrics_task = asyncio.create_task(_collect_and_broadcast_metrics())

    yield

    # Cleanup
    if _metrics_task:
        _metrics_task.cancel()
        try:
            await _metrics_task
        except asyncio.CancelledError:
            pass

    logger.info("Controller shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="vLLM Studio Controller",
    description="Model lifecycle management for vLLM and SGLang inference servers",
    version=__version__,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Access logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests."""
    # Skip noisy endpoints
    skip_paths = {"/health", "/metrics", "/events", "/status"}
    if request.url.path not in skip_paths:
        logger.debug(f"{request.method} {request.url.path}")

    response = await call_next(request)
    return response


# Include route modules
app.include_router(system_router)
app.include_router(models_router)
app.include_router(lifecycle_router)
app.include_router(chats_router)
app.include_router(logs_router)
app.include_router(monitoring_router)
app.include_router(mcp_router)
app.include_router(proxy_router)
app.include_router(usage_router)


# Tokenization endpoints (kept in main app for simplicity)
@app.post("/v1/tokenize", tags=["Tokenization"])
async def tokenize_text(request: Request):
    """Tokenize text using the running model's tokenizer (vLLM-compatible)."""
    import httpx

    current = find_inference_process(settings.inference_port)
    if not current:
        return {"error": "No model running", "num_tokens": 0}

    try:
        body = await request.json()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"http://localhost:{settings.inference_port}/tokenize",
                json=body
            )
            if r.status_code == 200:
                return r.json()
            return {"error": f"Tokenization failed: {r.status_code}", "num_tokens": 0}
    except Exception as e:
        return {"error": str(e), "num_tokens": 0}


@app.post("/v1/detokenize", tags=["Tokenization"])
async def detokenize_tokens(request: Request):
    """Detokenize tokens using the running model's tokenizer (vLLM-compatible)."""
    import httpx

    current = find_inference_process(settings.inference_port)
    if not current:
        return {"error": "No model running", "text": ""}

    try:
        body = await request.json()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"http://localhost:{settings.inference_port}/detokenize",
                json=body
            )
            if r.status_code == 200:
                return r.json()
            return {"error": f"Detokenization failed: {r.status_code}", "text": ""}
    except Exception as e:
        return {"error": str(e), "text": ""}


@app.post("/v1/count-tokens", tags=["Tokenization"])
async def count_text_tokens(request: Request):
    """Count tokens in text using the running model's tokenizer."""
    import httpx

    current = find_inference_process(settings.inference_port)
    if not current:
        return {"error": "No model running", "num_tokens": 0}

    try:
        body = await request.json()
        text = body.get("text", "")
        model = body.get("model", current.served_model_name or "default")

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"http://localhost:{settings.inference_port}/tokenize",
                json={"model": model, "prompt": text}
            )
            if r.status_code == 200:
                data = r.json()
                tokens = data.get("tokens", [])
                return {"num_tokens": len(tokens), "model": model}
            return {"error": f"Token count failed: {r.status_code}", "num_tokens": 0}
    except Exception as e:
        return {"error": str(e), "num_tokens": 0}


@app.post("/v1/tokenize-chat-completions", tags=["Tokenization"])
async def tokenize_chat_completions(request: Request):
    """Estimate token count for a chat completion request.

    Applies the model's chat template and counts tokens for messages and tools.
    Returns total input tokens and per-component breakdown.
    """
    import httpx

    current = find_inference_process(settings.inference_port)
    if not current:
        return {"error": "No model running", "input_tokens": 0}

    try:
        body = await request.json()
        messages = body.get("messages", [])
        tools = body.get("tools", [])
        model = body.get("model", current.served_model_name or "default")

        # Count message tokens by applying chat template
        messages_tokens = 0
        async with httpx.AsyncClient(timeout=30) as client:
            # Try to get templated prompt
            try:
                # Most vLLM setups support /v1/chat/completions with max_tokens=1 and stream=false
                # to get the prompt tokens in the response
                test_request = {
                    "model": model,
                    "messages": messages,
                    "max_tokens": 1,
                    "stream": False,
                }
                if tools:
                    test_request["tools"] = tools

                r = await client.post(
                    f"http://localhost:{settings.inference_port}/v1/chat/completions",
                    json=test_request
                )
                if r.status_code == 200:
                    data = r.json()
                    usage = data.get("usage", {})
                    prompt_tokens = usage.get("prompt_tokens", 0)
                    return {
                        "input_tokens": prompt_tokens,
                        "breakdown": {
                            "messages": prompt_tokens,
                            "tools": 0,  # Included in messages for templated approach
                        },
                        "model": model,
                    }
            except Exception:
                pass

            # Fallback: count tokens in concatenated message content
            all_text = ""
            for msg in messages:
                content = msg.get("content", "")
                if isinstance(content, str):
                    all_text += content + "\n"
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            all_text += part.get("text", "") + "\n"

            r = await client.post(
                f"http://localhost:{settings.inference_port}/tokenize",
                json={"model": model, "prompt": all_text}
            )
            if r.status_code == 200:
                data = r.json()
                messages_tokens = len(data.get("tokens", []))

            # Count tools tokens
            tools_tokens = 0
            if tools:
                tools_text = str(tools)
                r = await client.post(
                    f"http://localhost:{settings.inference_port}/tokenize",
                    json={"model": model, "prompt": tools_text}
                )
                if r.status_code == 200:
                    data = r.json()
                    tools_tokens = len(data.get("tokens", []))

            # Add overhead for chat template (rough estimate)
            overhead = len(messages) * 4  # ~4 tokens per message for role/formatting

            return {
                "input_tokens": messages_tokens + tools_tokens + overhead,
                "breakdown": {
                    "messages": messages_tokens + overhead,
                    "tools": tools_tokens,
                },
                "model": model,
            }
    except Exception as e:
        return {"error": str(e), "input_tokens": 0}


# Title generation endpoint
@app.post("/api/title", tags=["Chat"])
async def generate_title(request: Request):
    """Generate a title for a chat conversation."""
    import httpx

    try:
        body = await request.json()
        model = body.get("model")
        user_msg = body.get("user", "")
        assistant_msg = body.get("assistant", "")

        if not model or not user_msg:
            return {"title": "New Chat"}

        # Use a simple prompt to generate a title
        prompt = f"""Generate a short, descriptive title (3-6 words) for this conversation. Only output the title, nothing else.

User: {user_msg[:500]}
Assistant: {assistant_msg[:500] if assistant_msg else '(response pending)'}

Title:"""

        litellm_key = os.environ.get("LITELLM_MASTER_KEY", "sk-master")

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "http://localhost:4100/v1/chat/completions",
                headers={"Authorization": f"Bearer {litellm_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 20,
                    "temperature": 0.7,
                }
            )

            if r.status_code == 200:
                data = r.json()
                title = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                # Clean up the title
                title = title.strip('"\'').strip()
                if len(title) > 60:
                    title = title[:57] + "..."
                return {"title": title or "New Chat"}

        return {"title": "New Chat"}
    except Exception as e:
        logger.error(f"Title generation error: {e}")
        return {"title": "New Chat"}
