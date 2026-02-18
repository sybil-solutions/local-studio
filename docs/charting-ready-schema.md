<!-- CRITICAL -->
# Charting-Ready Telemetry Schema

This document defines the canonical event schemas for future time-series
charting surfaces. The schemas are produced by the runtime telemetry
backbone (Task 07) and are designed to be consumed by chart widgets without
transformation.

## `runtime_sample` (future periodic snapshot)

Emitted at low frequency (30–60 s) alongside the existing `runtime_summary`.

```jsonc
{
  "timestamp": "2026-02-16T23:00:00.000Z",
  "platform": {
    "kind": "rocm",               // cuda | rocm | unknown
    "vendor": "amd"
  },
  "gpus": [
    {
      "index": 0,
      "utilization_pct": 87,
      "memory_used_mb": 61440,
      "memory_total_mb": 65536,
      "temperature_c": 72,
      "power_draw_w": 550,
      "power_limit_w": 750
    }
  ],
  "throughput": {
    "prompt_tps": 1240.5,
    "generation_tps": 78.3,
    "running_requests": 2,
    "pending_requests": 0
  },
  "services": [
    { "id": "llm", "kind": "vllm", "status": "running" },
    { "id": "stt", "kind": "whispercpp", "status": "idle" }
  ],
  "lease": {
    "holder": "llama-3.1-70b",
    "since": "2026-02-16T22:00:00.000Z"
  },
  "lifetime": {
    "prompt_tokens_total": 12500000,
    "completion_tokens_total": 3200000,
    "requests_total": 4800,
    "energy_kwh": 14.3,
    "uptime_hours": 48.2
  }
}
```

## Field Semantics

| Field | Source | Unit | Notes |
|-------|--------|------|-------|
| `timestamp` | controller clock | ISO 8601 | Wall time of sample |
| `platform.kind` | runtime detection | enum | Stable after boot |
| `gpus[].utilization_pct` | nvidia-smi / amd-smi | 0–100 | May be 0 if idle |
| `gpus[].memory_*_mb` | nvidia-smi / amd-smi | MiB | Total and used |
| `gpus[].temperature_c` | nvidia-smi / amd-smi | °C | Null if unsupported |
| `gpus[].power_draw_w` | nvidia-smi / amd-smi | W | Current draw |
| `throughput.prompt_tps` | vLLM /metrics delta | tok/s | 0 when idle |
| `throughput.generation_tps` | vLLM /metrics delta | tok/s | 0 when idle |
| `services[].status` | controller state | enum | running/idle/error/stopped |
| `lease.holder` | process manager | string | Model or service name |
| `lifetime.*` | LifetimeMetricsStore | varies | Monotonically increasing |

## Retention + Sampling

| Tier | Cadence | Retention | Storage |
|------|---------|-----------|---------|
| Live | 5 s | 10 min | In-memory ring buffer |
| Summary | 30 s | 24 h | SQLite (future) |
| Archive | 5 min | 30 d | SQLite (future) |

The live tier is sufficient for dashboard sparklines.
Summary and archive tiers will be added when chart widgets land.

## Consumer Contract

Frontend chart components should:

1. Subscribe to `runtime_sample` SSE events for live data.
2. Fall back to polling `/metrics` + `/gpus` when SSE is stale.
3. Maintain a client-side ring buffer (max 120 samples for 10 min at 5 s).
4. Use `timestamp` as the x-axis key (not arrival time).
