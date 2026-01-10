"""Prometheus metrics for vLLM Studio Controller.

This module provides Prometheus metrics for monitoring the controller,
GPU status, and model lifecycle events.
"""

from typing import Dict, List, Any, Optional

# Try to import prometheus_client, fall back to mock if not available
try:
    from prometheus_client import (
        Counter,
        Gauge,
        Histogram,
        Info,
        generate_latest,
        CONTENT_TYPE_LATEST,
        REGISTRY,
    )

    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False

    # Mock classes for when prometheus_client is not installed
    class _MockMetric:
        def __init__(self, *args, **kwargs):
            pass

        def labels(self, **kwargs):
            return self

        def inc(self, value=1):
            pass

        def set(self, value):
            pass

        def observe(self, value):
            pass

        def info(self, value):
            pass

    Counter = Gauge = Histogram = Info = _MockMetric
    CONTENT_TYPE_LATEST = "text/plain"
    REGISTRY = None

    def generate_latest(registry):
        return b"# prometheus_client not installed\n"


# --- Metrics definitions ---

# Model lifecycle
model_switches_total = Counter(
    "vllm_studio_model_switches_total", "Total number of model switches", ["recipe_id", "backend"]
)

model_switch_duration_seconds = (
    Histogram(
        "vllm_studio_model_switch_duration_seconds",
        "Time taken to switch models",
        ["recipe_id"],
        buckets=[10, 30, 60, 120, 300, 600],
    )
    if PROMETHEUS_AVAILABLE
    else _MockMetric()
)

model_launch_failures_total = Counter(
    "vllm_studio_model_launch_failures_total",
    "Total number of failed model launches",
    ["recipe_id"],
)

# Active state
active_model_info = Info("vllm_studio_active_model", "Currently active model information")

inference_server_up = Gauge(
    "vllm_studio_inference_server_up", "Whether inference server is running (1=up, 0=down)"
)

# GPU metrics
gpu_memory_used_bytes = Gauge(
    "vllm_studio_gpu_memory_used_bytes", "GPU memory used in bytes", ["gpu_id", "gpu_name"]
)

gpu_memory_total_bytes = Gauge(
    "vllm_studio_gpu_memory_total_bytes", "Total GPU memory in bytes", ["gpu_id", "gpu_name"]
)

gpu_utilization_percent = Gauge(
    "vllm_studio_gpu_utilization_percent", "GPU utilization percentage", ["gpu_id", "gpu_name"]
)

gpu_temperature_celsius = Gauge(
    "vllm_studio_gpu_temperature_celsius", "GPU temperature in Celsius", ["gpu_id", "gpu_name"]
)

# SSE metrics
sse_active_connections = Gauge(
    "vllm_studio_sse_active_connections", "Number of active SSE connections", ["channel"]
)

sse_events_published_total = Counter(
    "vllm_studio_sse_events_published_total", "Total SSE events published", ["event_type"]
)


# --- Metric update functions ---


def record_model_switch(recipe_id: str, backend: str, duration: float, success: bool):
    """Record a model switch attempt."""
    if success:
        model_switches_total.labels(recipe_id=recipe_id, backend=backend).inc()
        if PROMETHEUS_AVAILABLE:
            model_switch_duration_seconds.labels(recipe_id=recipe_id).observe(duration)
    else:
        model_launch_failures_total.labels(recipe_id=recipe_id).inc()


def update_active_model(
    model_path: Optional[str] = None,
    backend: Optional[str] = None,
    served_name: Optional[str] = None,
):
    """Update active model information."""
    if model_path:
        active_model_info.info(
            {
                "model_path": model_path or "",
                "backend": backend or "",
                "served_model_name": served_name or "",
            }
        )
        inference_server_up.set(1)
    else:
        active_model_info.info({"model_path": "", "backend": "", "served_model_name": ""})
        inference_server_up.set(0)


def update_gpu_metrics(gpus: List[Dict[str, Any]]):
    """Update GPU metrics from GPU info list."""
    for gpu in gpus:
        gpu_id = str(gpu.get("id", gpu.get("index", 0)))
        gpu_name = gpu.get("name", "Unknown")
        labels = {"gpu_id": gpu_id, "gpu_name": gpu_name}

        # Memory (convert MB to bytes if needed)
        mem_used = gpu.get("memory_used", 0)
        mem_total = gpu.get("memory_total", 0)

        # Handle both bytes and MB formats
        if mem_used < 1_000_000:  # Likely in MB
            mem_used = mem_used * 1024 * 1024
            mem_total = mem_total * 1024 * 1024

        gpu_memory_used_bytes.labels(**labels).set(mem_used)
        gpu_memory_total_bytes.labels(**labels).set(mem_total)

        # Utilization
        util = gpu.get("utilization", gpu.get("utilization_pct", 0)) or 0
        gpu_utilization_percent.labels(**labels).set(util)

        # Temperature
        temp = gpu.get("temperature", gpu.get("temp_c", 0)) or 0
        gpu_temperature_celsius.labels(**labels).set(temp)


def update_sse_metrics(stats: Dict[str, Any]):
    """Update SSE connection metrics."""
    channels = stats.get("channels", {})
    for channel, count in channels.items():
        sse_active_connections.labels(channel=channel).set(count)


# --- Metrics endpoint ---


def get_metrics_content() -> bytes:
    """Generate Prometheus metrics content."""
    if PROMETHEUS_AVAILABLE:
        return generate_latest(REGISTRY)
    return b"# prometheus_client not installed - install with: pip install prometheus-client\n"


def get_metrics_content_type() -> str:
    """Get the content type for metrics response."""
    return CONTENT_TYPE_LATEST
