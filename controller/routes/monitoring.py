"""Monitoring endpoints: metrics, peak metrics, lifetime, benchmark."""

from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import Response

from ..config import settings
from ..events import event_manager
from ..gpu import get_gpu_info
from ..metrics import (
    update_active_model, update_gpu_metrics, update_sse_metrics,
    get_metrics_content, get_metrics_content_type
)
from ..process import find_inference_process
from ..store import PeakMetricsStore, LifetimeMetricsStore

router = APIRouter(tags=["Monitoring"])


def get_peak_metrics_store() -> PeakMetricsStore:
    """Get peak metrics store instance."""
    from ..app import get_peak_metrics_store as _get_peak_metrics_store
    return _get_peak_metrics_store()


def get_lifetime_metrics_store() -> LifetimeMetricsStore:
    """Get lifetime metrics store instance."""
    from ..app import get_lifetime_metrics_store as _get_lifetime_metrics_store
    return _get_lifetime_metrics_store()


@router.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint."""
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


@router.get("/peak-metrics")
async def get_peak_metrics(
    model_id: str = None,
    metrics_store: PeakMetricsStore = Depends(get_peak_metrics_store)
):
    """Get stored peak performance metrics."""
    if model_id:
        result = metrics_store.get(model_id)
        return result or {"error": "No metrics for this model"}
    return {"metrics": metrics_store.get_all()}


@router.get("/lifetime-metrics")
async def get_lifetime_metrics(
    lifetime_store: LifetimeMetricsStore = Depends(get_lifetime_metrics_store)
):
    """Get lifetime/cumulative metrics across all sessions."""
    data = lifetime_store.get_all()
    uptime_hours = data.get('uptime_seconds', 0) / 3600.0
    energy_kwh = data.get('energy_wh', 0) / 1000.0
    tokens = data.get('tokens_total', 0)
    kwh_per_million = (energy_kwh / (tokens / 1_000_000)) if tokens > 0 else 0

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


@router.post("/benchmark")
async def run_benchmark(
    prompt_tokens: int = 1000,
    max_tokens: int = 100,
    metrics_store: PeakMetricsStore = Depends(get_peak_metrics_store)
):
    """Run a benchmark and store peak metrics if better than existing."""
    current = find_inference_process(settings.inference_port)
    if not current:
        return {"error": "No model running"}

    model_id = current.served_model_name or current.model_path.split('/')[-1]
    prompt = "Please count: " + " ".join([str(i) for i in range(prompt_tokens // 2)])

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            start_time = time.perf_counter()

            response = await client.post(
                f"http://localhost:{settings.inference_port}/v1/chat/completions",
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "stream": False
                }
            )

            total_time = time.perf_counter() - start_time

            if response.status_code != 200:
                return {"error": f"Request failed: {response.status_code}"}

            data = response.json()
            usage = data.get("usage", {})
            prompt_tokens_actual = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)

            if completion_tokens > 0 and prompt_tokens_actual > 0:
                prefill_ratio = prompt_tokens_actual / (prompt_tokens_actual + completion_tokens * 10)
                prefill_time = total_time * prefill_ratio
                generation_time = total_time - prefill_time

                prefill_tps = prompt_tokens_actual / prefill_time if prefill_time > 0 else 0
                generation_tps = completion_tokens / generation_time if generation_time > 0 else 0
                ttft_ms = prefill_time * 1000

                result = metrics_store.update_if_better(
                    model_id=model_id,
                    prefill_tps=prefill_tps,
                    generation_tps=generation_tps,
                    ttft_ms=ttft_ms
                )

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
