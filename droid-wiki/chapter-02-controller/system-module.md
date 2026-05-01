# System module — `controller/src/modules/system/`

The system module is the **Phase-2** consolidation. It absorbs the
old `monitoring/` directory plus `lifecycle/platform/`,
`lifecycle/metrics/`, and `lifecycle/routes/system-routes.ts` into a
single tree responsible for everything that is *about* the host and the
running engine — not the engine itself.

## Layout

```
controller/src/modules/system/
├── routes.ts                    # 292 LoC — /status /gpus /compat /vram-calculator /events /system/*
├── routes.test.ts
├── event-manager.ts             # 229 LoC — EventManager + Event class (SSE bus)
├── event-manager.test.ts
├── metrics.ts                   # 165 LoC — peak/lifetime metrics utilities
├── metrics-store.ts             # 226 LoC — PeakMetricsStore + LifetimeMetricsStore (SQLite)
├── metrics-store.test.ts
├── metrics-routes.ts            # 139 LoC — /metrics /metrics/peaks /metrics/runtime …
├── logs-routes.ts               # 263 LoC — /logs /logs/sessions/:id /logs/:date
├── logs-routes.test.ts
├── usage-routes.ts              #  38 LoC — thin shim → usage/chat-database + usage/pi-sessions
├── usage-routes.test.ts
├── metrics-collector/
│   ├── index.ts
│   ├── metrics-collector.ts     # 513 LoC — the 5-second poll loop
│   ├── metrics-collector.test.ts
│   └── configs.ts               # METRICS_COLLECT_INTERVAL_MS, etc.
├── platform/
│   ├── gpu.ts                   # 191 LoC — getGpuInfo() unified across nvidia/amd
│   ├── amd-gpu.ts               # rocm-smi / amd-smi parsers
│   ├── rocm-info.ts             # tool resolution
│   ├── smi-tools.ts             # nvidia-smi resolution + forced override
│   └── compatibility-report.ts
├── usage/
│   ├── chat-database.ts         # 531 LoC — SQL aggregation across DBs
│   ├── chat-database.test.ts    #  73 LoC
│   ├── pi-sessions.ts           # 290 LoC — NEW reads ~/.pi/agent/sessions/*.jsonl
│   ├── pi-sessions.test.ts      #  53 LoC NEW
│   └── usage-utilities.ts
└── ... (small helpers)
```

## `event-manager.ts` (229 LoC) — the SSE bus

`EventManager` is a single in-process pub/sub bus:

```ts
class EventManager {
  subscribe(channel = "default", signal?: AbortSignal): AsyncIterable<Event>;
  publish(event: Event): Promise<void>;
  publishMetrics(metrics: Record<string, unknown>): Promise<void>;
  getLatestMetrics(): Record<string, unknown>;
}
```

Each `Event` serialises to an SSE frame (`event-manager.ts:35-39`):

```ts
public toSse(): string {
  const payload = { data: this.data, timestamp: this.timestamp };
  return `id: ${this.id}\nevent: ${this.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}
```

Subscribers receive a backpressured `AsyncQueue` of size 100 (from
`core/async.ts`). The bus is consumed by:

- `routes.ts:GET /events` — the long-lived SSE endpoint hit by the
  frontend.
- `metrics-routes.ts` — short-lived metric snapshots replay
  `latestMetrics` for clients that just connected.

`controller-events.ts` (in `contracts/`, see
[`shared-types-and-app-context.md`](shared-types-and-app-context.md)) is
a single string-constants table of every event type known to the
system, keyed by `CONTROLLER_EVENTS.<NAME>`.

## `metrics-collector/metrics-collector.ts` (513 LoC)

A long-running task started in `main.ts` that polls every
`METRICS_COLLECT_INTERVAL_MS` (default 5 seconds) and publishes a
`metrics` event with:

- GPU info via `system/platform/gpu.ts:getGpuInfo()`
- System runtime info via `engines/layers/runtime-info.ts`
- vLLM throughput from the `/metrics` Prometheus endpoint of the active
  inference server (when the recipe backend is `vllm` or `sglang`).
- llama.cpp throughput from log scraping
  (`scrapeLlamacppThroughput`, `metrics-collector.ts:67-104`) — tails
  the controller's own log file for that recipe and parses the
  `prompt eval time = ... / eval time = ... tokens per second` lines.
- A coarser `runtime_summary` event every
  `METRICS_RUNTIME_SUMMARY_INTERVAL_MS`.

The collector also writes peak GPU/memory snapshots to
`PeakMetricsStore` and increments `LifetimeMetricsStore.uptimeSeconds`
by `METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS` per tick — this is the
mechanism behind the Studio "all-time" stats card.

## `routes.ts` (292 LoC)

The high-level endpoints:

```
GET  /status            — running flag + current process + inference port + launching id
GET  /gpus              — getGpuInfo() snapshot
GET  /compat            — buildCompatibilityReport(...) for the “System Diagnostics” page
POST /vram-calculator   — estimateWeightsSizeBytes(model, ctxlen, …)
GET  /system/config     — sanitised view of `Config` for the frontend
GET  /events            — long-lived SSE stream
```

The compat report cross-references runtime versions (vllm / cuda /
rocm) with whether the inference port is reachable on `127.0.0.1` and
whether a process is registered.

`routes.ts` also calls `registerMonitoringRoutes`, `registerLogsRoutes`,
and `registerUsageRoutes` so the entry from `http/app.ts` only needs
`registerSystemRoutes(app, context)`.

## `metrics-routes.ts` (139 LoC)

```
GET /metrics                  — latest metrics snapshot
GET /metrics/peaks            — peak GPU memory / utilization / power
GET /metrics/runtime          — last runtime_summary
GET /metrics/lifetime         — uptimeSeconds + tokens served + requests
GET /metrics/throughput       — last `tps` sample
```

Backed by `PeakMetricsStore` and `LifetimeMetricsStore` (both in
`metrics-store.ts`), which are SQLite-backed.

## `logs-routes.ts` (263 LoC)

Reads from `${data_dir}/logs/<date>/<sessionId>.log` (the files the
process manager writes line-by-line):

```
GET /logs                      — list of sessions
GET /logs/sessions/:sessionId  — full text or last N bytes of a session log
GET /logs/:date                — list logs for a date
```

Used by Studio's "Logs" tab.

## `usage-routes.ts` (38 LoC) — thin shim

This file shrank from a thicker controller into a 38-LoC shim that
delegates to two collaborators:

```ts
app.get("/usage", async (ctx) => {
  const fromDb = await loadUsageFromChatDatabase(context);   // chat-database.ts
  const fromPi = await loadUsageFromPiSessions();            // pi-sessions.ts
  return ctx.json(mergeUsage(fromDb, fromPi));
});
```

(This is a paraphrase of the file's intent — see actual file for the
exact merge keys.)

### `usage/chat-database.ts` (531 LoC)

The biggest file in `system/`. Aggregates per-model and per-day usage
by querying both:

- The controller's own SQLite chat history (legacy — still present from
  before chat was deleted; stays as a read-only DB).
- The `LifetimeMetricsStore`.

Returns an object shaped for the Studio "Usage" page.

### `usage/pi-sessions.ts` (290 LoC) — **new file**

This file is **new on this branch** and is the bridge between the
controller's usage analytics and the externalised `pi` agent runtime.
It walks `~/.pi/agent/sessions/*.jsonl` (overridable with
`PI_CODING_AGENT_DIR`):

```ts
const piSessionsRoot = (): string =>
  process.env["PI_CODING_AGENT_DIR"]
    ? join(process.env["PI_CODING_AGENT_DIR"], "sessions")
    : join(homedir(), ".pi", "agent", "sessions");
```

Each `.jsonl` file is one session; each line is a turn with usage
counts. The file folds them into the same `UsageAccumulator` shape the
chat-database returns, so the merged result is uniform. It tracks:

- `totalRequests`, `promptTokens`, `completionTokens`, `totalTokens`
- `sessions: Set<string>`
- `byModel: Map<string, ModelUsage>`
- `daily: Map<string, ModelUsage>`
- `dailyByModel: Map<string, ModelUsage>`
- `hourly: Map<number, ...>`
- `lastHourRequests`, `last24hRequests`, `prev24hRequests`,
  `last24hTokens` (for the rolling 24-hour change widget)

This file is **why the Studio Usage page still works** even though the
controller's chat module was deleted.

## `platform/gpu.ts` (191 LoC)

`getGpuInfo()` returns an array of `GpuInfo` objects. It tries, in
order:

1. `resolveForcedGpuMonitoringTool()` — env override.
2. NVIDIA via `nvidia-smi --query-gpu=...,--format=csv,noheader,nounits`.
3. AMD via `amd-smi` (modern) then `rocm-smi` (legacy).

Each branch parses the CSV/JSON and normalises into the same
`GpuInfo` shape (`name`, `memory_total`, `memory_used`, `memory_free`,
`utilization`, `temperature`, `power_draw`, `power_limit`,
`memory_total_mb`, `memory_used_mb`, `memory_free_mb`, `index`).

`compatibility-report.ts` is a small pure function that merges runtime
info + GPU info + port status into a list of `{ id, ok, message }`
diagnostic checks.

## Chapter 7 candidates

- **`metrics-collector.ts` (513 LoC)** — single file, 5+ probes, log
  scraping, throttling, both metric kinds. A "collector framework"
  that schedules probes by interval would be cleaner.
- **`chat-database.ts` (531 LoC)** — reads two SQLite databases by
  hand-rolled SQL; queries are interleaved with shape-mapping. Heavy
  candidate for splitting into `chat-database/{queries,mappers,merge}.ts`.
- **`pi-sessions.ts` (290 LoC)** — already focused but its entire
  premise (reading another product's session files via filesystem path)
  is a coupling smell. The `pi` agent should publish usage events the
  controller subscribes to.
