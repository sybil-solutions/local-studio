# Local Studio: architecture

Status: design contract for the first build, 2026-09-25. This document is how the controller, gateway, metrics, UI and desktop shell fit together.

The system is small on purpose:

- **One controller binary** (Bun + Hono + bun:sqlite). It discovers models, launches and stops them, runs the gateway, records metrics, links to other controllers, launches agents, and deploys itself to other machines.
- **One SPA** (Vite + React) that the controller serves at `/`. It renders the snapshot and can do five things: connect a controller, launch a recipe, stop a model, export a recipe, and launch an agent.
- **One thin desktop shell** (Electron). It starts the bundled controller on loopback if none is running, then loads `http://127.0.0.1:8080/`.
- **One contracts package** (`packages/contracts`). It is the only place where types, request bodies, formulas and formatters are defined. The controller and the UI both import it.

Size budget: controller at most 6k lines of TypeScript, UI at most 3.5k, desktop at most 250, contracts at most 800. If a slice goes over budget, it has probably taken on something from §14 (Left out).

---

## 1. Repository layout and ownership

```
local-studio/
  docs/ARCHITECTURE.md
  package.json                  bun workspaces: packages/*, controller, ui, desktop
  tsconfig.base.json
  packages/contracts/src/       SCAFFOLD (frozen; changes need all slices' consent)
    machine.ts gpu.ts model.ts recipe.ts metrics.ts agent.ts snapshot.ts api.ts formulas.ts format.ts index.ts
  controller/src/
    main.ts app.ts context.ts   SCAFFOLD: CLI dispatch, composition root, service interfaces
    core/                       SCAFFOLD: config, db+migrate, auth, keys, identity, bus, sse, exec, log, snapshot
    discovery/                  slice 1: GPUs, docker, processes, ports, probe/fingerprint, groups, lifecycle (launch/stop/logs)
    gateway/                    slice 2: canonical model, 3 dialect adapters, routing, /v1/*
    metrics/                    slice 2: request store, engine scraper, attribution, rollups, summaries
    recipes/                    slice 3: registry catalog, hardware match, LaunchPlan, export, registry PR
    federation/                 slice 4: peers, tailnet discovery, /api/peers/* passthrough, fleet snapshot
    agents/                     slice 4: workspaces, launch table, dsh manager, terminals, `agent run` CLI
    deploy/                     slice 5: `local-studio deploy` CLI, build of release artifacts
  ui/                           slice 6: Vite + React SPA
  desktop/                      slice 5: Electron shell + packaging
  scripts/                      slice 5: release.sh (build binary + ui tarball)
```

A slice edits only the directories it owns. Scaffold files are frozen. `controller/package.json` is scaffold-owned too: it already carries `hono`, `yaml`, `zod`; controller slices use Bun built-ins (`bun:sqlite`, `Bun.spawn`, `fetch`) and add no dependencies. If a slice needs a contract change, it adds a new optional field or type in a file under its own directory and reports it. The integrator folds it into `packages/contracts` after the slices finish.

## 2. Runtime topology

```
  Mac (hub, desktop app)                          gpu-box (4x RTX PRO 6000)
 ┌──────────────────────────────┐   tailnet    ┌─────────────────────────────────────┐
 │ Electron ─ loads ─┐          │              │ local-studio serve :8080 (later)     │
 │                   ▼          │  /api/peers/ │   discovery ── docker / ps / ss /    │
 │ local-studio serve :8080  ───┼──────────────┼─▶ nvidia-smi / probe :8000           │
 │  gateway /v1/* ──── route ───┼──────────────┼─▶ gateway ─▶ vLLM :8000 (adopted)    │
 │  metrics sqlite              │              │   metrics sqlite (source of truth    │
 │  agents: dsh web, tmux       │              │   for requests its engines served)   │
 └──────────────────────────────┘              └─────────────────────────────────────┘
 harnesses (claude, codex, dsh, apps) talk ONLY to http://127.0.0.1:8080 with a per-client key
```

Every machine runs the same binary. A "machine" is a controller. A hub is just a controller that has peers registered. There is no load balancer and no failover. Each model id is routed to exactly one place.

## 3. Contracts (`packages/contracts`)

This package is already written and typechecks. Slices import from `@local-studio/contracts` and nowhere else.

| File | Defines |
|---|---|
| `machine.ts` | `Health` (`/health` identity: service, version, machineId, name, api, readOnly), `Machine`, `Watchdog`, `Peer`, `TailnetCandidate` |
| `gpu.ts` | `Gpu` (key `nvidia:0`, uuid, busId, mem, util, temp, power, `processes[]` with `modelId`), `GpuGroup` (`kind: alone/grouped`, `state: available/running/busy/foreign`), `FOREIGN_USED_MIB = 2048` |
| `model.ts` | `Engine`, `ModelState` (`loading/ready/unhealthy/stopping`), `ModelOrigin` (`managed/adopted`), `Dialect`, `RuntimeRef` (docker or native), `RunningModel`, `Endpoint` (auth-gated proxies and other non-model listeners), `GatewayModel` |
| `recipe.ts` | `Recipe` (schema-2 launchable subset from `plugin/v2/recipes.json`), `RecipeCatalog`, `RecipeRow` (+fit), `LaunchPlan`, `LaunchProgress`, `RecipeExport`, `RecipePr` |
| `metrics.ts` | `ERROR_CODES` (dsh taxonomy + `MODEL_NOT_FOUND`), `TokenBuckets` (disjoint dsh buckets), `RequestRecord`, `EngineCounters`/`EngineGauges`/`EngineSample`, `EngineRates`, `MetricsSummary`, `MetricsSlice`, `DailyRow`, `Activity`, `ModelCardStats`, `Price` |
| `agent.ts` | `HARNESSES`, `CLIENTS`, `HARNESS_CLIENT`, `HarnessInfo`, `Workspace`, `AgentLaunchSpec`, `AgentLaunchResult`, `BuiltLaunch`, `DshStatus`, `ApiKeyInfo` |
| `snapshot.ts` | `Snapshot` (one machine), `FleetSnapshot` (all machines + peers + harnesses + workspaces), `ControllerEvent` (SSE union) |
| `api.ts` | zod request bodies (`ConnectPeerBody`, `LaunchRecipeBody`, `StopModelBody`, `ExportPrBody`, `AgentLaunchBody`, `IssueKeyBody`, `PriceBody`, `WindowParam`) and the `ROUTES` table |
| `formulas.ts` | `promptTotal`, `cacheHit`, `ttftMs`, `decodeMs`, `decodeTps`, `prefillTps`, `bucketsFromOpenAiUsage`, `bucketsFromAnthropicUsage`, `costUsd`, `classifyError` |
| `format.ts` (as `fmt`) | `k`, `tps`, `gb`, `ctx`, `ms`, `dur`, `ago`, `pct`, `cacheHitPercent` (dsh "honest" rounding: a partial hit never shows 100) |

Invariants that every slice relies on:

- **Token buckets are disjoint**, as in dsh: `inputUncached + cacheRead + cacheWrite = promptTotal`, `reasoning ⊆ output`, `total = promptTotal + output`. OpenAI `prompt_tokens` includes cached tokens, so it is split. Anthropic `input_tokens` excludes them, so it maps straight across. This fixes vLLM Studio bug G7.
- **`null` means unmeasured and is never shown as 0.** When a value cannot be measured correctly it is `null`. Unavailable is better than wrong.
- **Aggregate rates are Σ/Σ**, not the mean of per-request rates: `decodeTps = Σoutput / Σdecode_ms` over requests that had a decode phase.
- **Model ids:** `RunningModel.id` is the container name for docker, or `native-<port>` for native processes. It stays the same when forge recreates the same container. `RequestRecord.model` is the served model name the client asked for.
- **GPU keys** are `<backend>:<index>`, e.g. `nvidia:0`. UUIDs are carried alongside them.

## 4. Controller core (scaffold, done)

- `core/config.ts`: flags and env (`LOCAL_STUDIO_{HOME,DATA_DIR,HOST,PORT,MODELS_DIR,REGISTRY_DIR,READ_ONLY,NAME,SCAN_PORTS,WATCHDOGS,API_KEY,PUBLIC_URL,UI_DIR}`). The default bind is `127.0.0.1:8080` and the default home is `~/.local-studio`. `--read-only` refuses launch, stop, cancel, agent launch and PR (see `core/auth.ts` `READ_ONLY_DENY`).
- `core/db.ts`: a single SQLite file `<dataDir>/local-studio.db` in WAL mode. `migrate(db, module, steps[])` versions each module separately, so each slice owns its own tables and there is no shared migration file.
- `core/keys.ts`: the admin key lives in `<dataDir>/admin.key` (0600), or comes from `LOCAL_STUDIO_API_KEY`. Client keys (`ls_…`) are stored sha256-hashed with a `client` label. `issue()` returns the plaintext exactly once.
- `core/auth.ts`: `/health` is public. `/api/*` and `/v1/*` need a key, unless the request comes from loopback with a loopback Host (and, if it has an Origin, a loopback Origin). Client keys may only call `/v1/*`. It sets `c.var.client`, taken from the key's label, then `X-Local-Studio-Client`, then a normalised User-Agent (`claude-code`, `codex-cli`, `dsh`, `omp`, `zcode`, else `api`). This fixes G14.
- `core/exec.ts`: `exec(cmd[], {timeoutMs})` has a **mandatory timeout** and SIGKILLs on expiry. `fetchWithTimeout` uses `redirect: "manual"`. No ssh, docker or network call may bypass these.
- `core/bus.ts` + `core/sse.ts`: a typed in-process bus and `GET /api/events`, which sends `event: <type>` and `data: <json>`, a keepalive every 15 s, and an optional `?types=` filter. The first event is always a full `snapshot`.
- `app.ts`: the composition root. The factory order is discovery, metrics, federation, gateway, recipes, agents. All of them share one lazy `Services` object, so a factory may call `svc.*` only at runtime, never while constructing. Every 1 s it rebuilds the local `Snapshot` and emits it when it has changed. It serves `ui/dist` with an SPA fallback.
- `main.ts`: `local-studio serve | deploy | agent run | key print-admin | version`. It runs `Bun.serve` with `idleTimeout: 255` and a 64 MiB body limit (fixes G12).

Service interfaces (`context.ts`) are the only thing slices call across a boundary: `RuntimeService`, `LifecycleService`, `MetricsService`, `GatewayService`, `PeerService`, `RecipeService`, `AgentService`. Each module exports `create<Name>(ctx, svc): Module<Service>` with optional `routes`, `start` and `stop`.

## 5. HTTP API

Every route except `/health` needs auth (§4). Errors are `{"error":{"code","message"}}`. Gateway errors use each dialect's own error shape.

| Method, path | Owner | Returns / does |
|---|---|---|
| `GET /health` | core | `Health` (public, tiny, no model data) |
| `GET /api/snapshot` | core | `Snapshot` of this machine |
| `GET /api/fleet` | federation | `FleetSnapshot` (self + cached peer snapshots) |
| `GET /api/events[?types=snapshot,fleet,request,engine,launch,peer,log]` | core | SSE of `ControllerEvent` |
| `POST /api/models/:id/stop` `{confirm, force?}` | discovery | stops the model (§6.5). Refused in read-only mode |
| `POST /api/models/:id/export` | recipes | `RecipeExport` (read-only on the host; writes only under `<dataDir>/exports`) |
| `POST /api/models/:id/export/pr` `{title?, draft}` | recipes | `RecipePr` |
| `GET /api/recipes[?hardware=&fit=1]` | recipes | `RecipeRow[]` |
| `GET /api/recipes/:id/plan?gpuKeys=` | recipes | `{plan: LaunchPlan, dockerArgv: string[]}` preview, nothing executed (allowed in read-only) |
| `POST /api/recipes/sync` | recipes | fetches the registry and returns `RecipeCatalog` metadata |
| `POST /api/recipes/:id/launch` `{gpuKeys?}` | recipes→lifecycle | `202 LaunchProgress` (non-blocking; progress arrives over SSE `launch`) |
| `GET /api/launches`, `POST /api/launches/:id/cancel` | discovery | `LaunchProgress[]` |
| `GET /api/metrics/summary?window=&model=&client=&machine=` | metrics | `MetricsSummary` |
| `GET /api/metrics/requests?limit=&before=` | metrics | `RequestRecord[]` newest first |
| `GET /api/usage/daily?from=&to=&group=model,client` | metrics | `DailyRow[]` |
| `GET /api/usage/hourly?from=&to=` (epoch ms, default last 24 h) | metrics | `HourlyRow[]` per hour, machine, model, client |
| `GET /api/metrics/ttft?from=` (epoch ms, default last 24 h) | metrics | `TtftHour[]`: per-hour TTFT log-bucket histogram, mergeable across machines |
| `GET /api/metrics/gpus?from=` (epoch ms, default last 24 h) | metrics | `GpuSample[]`: 1-minute machine GPU samples (mean util, VRAM used and total of the GPUs that report usage, power, max temp), kept 7 days |
| `GET /api/health/detail`, `GET /metrics` | core | `ControllerHealth` / Prometheus text |
| `GET/PUT /api/prices` | metrics | `Price[]` (optional "equivalent cloud" USD per 1M tokens) |
| `GET /api/machines`, `POST /api/machines` `{url,key,name?}`, `DELETE /api/machines/:id` | federation | peers |
| `GET /api/machines/discover` | federation | `TailnetCandidate[]` |
| `ALL /api/peers/:id/*` | federation | passthrough to the registered peer, authenticated with the hub's stored key |
| `GET /api/agents` | agents | `HarnessInfo[]` |
| `POST /api/agents/launch` | agents | `AgentLaunchResult` |
| `GET /api/workspaces`, `DELETE /api/workspaces/:id` | agents | `Workspace` rows (delete never removes the directory) |
| `GET /api/keys`, `POST /api/keys`, `DELETE /api/keys/:id` | core (GET) / agents (POST, DELETE) | key metadata; POST returns the plaintext once |
| `GET /v1/models` | gateway | merged local + peer models (OpenAI shape, or Anthropic shape if the request carries `anthropic-version`) |
| `POST /v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/messages/count_tokens` | gateway | §7 |

## 6. Discovery and lifecycle (slice 1)

### 6.1 Scan loop

There is a fast loop every 3 s (GPU stats + health probes of known models) and a full scan every 15 s, or on demand. The scan is a pure function of what can be observed. No record is needed for a model to be found (this fixes the vLLM Studio "record-as-truth" failure described in the field notes). Linux steps:

1. **GPUs:** `nvidia-smi --query-gpu=index,name,uuid,pci.bus_id,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits`, then `nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits`, each with a 5 s timeout. On macOS it builds one `apple:0` GPU from `sysctl hw.memsize` and the chip name (unified memory, `memUsedMiB: null`). The hardware id uses the plugin rule: `norm(product)` plus VRAM ±1 GiB matched against the catalog's `hardware[].match`.
2. **Processes:** `ps -eo pid=,ppid=,lstart=,args=` once per scan, giving a parent map.
3. **Docker:** check `docker info --format '{{.ID}}'` with a 3 s timeout (no answer means `docker: "unavailable"`, and the scan continues). Then `docker ps -q` and `docker inspect <ids>` (8 s timeout). Only running containers are listed. Exited containers are never models.
4. **Listeners:** `ss -ltnpH` on Linux, `lsof -nP -iTCP -sTCP:LISTEN -FpcnT` on macOS. Root-owned sockets have no pid, and that is fine.
5. **Candidates:** docker-published host ports of running containers ∪ listeners whose pid chain contains an engine argv (`vllm serve`, `sglang.launch_server`, `llama-server`, `tabbyAPI`/`main.py` with tabby cwd, `mlx_lm.server`, `vllm-mlx serve`) or a GPU compute pid ∪ `LOCAL_STUDIO_SCAN_PORTS` ∪ remaining unowned listeners on 1024-65535. Excluded: our own port, registered peers, 22/53/631, and the ports of cached negatives (keyed `(port,pid)`, TTL 5 min). At most 64 probes per scan, 8 at a time.
6. **Probe + fingerprint** (GET only, 1.5 s timeout each, the field notes table): `/v1/models` first. A 401/403 means `Endpoint{kind:"auth-proxy"}`, never a model; this covers :8317, :8329 and the old :8080. A 200 with `data[]` leads to `/version` (vLLM), `/get_server_info` (SGLang), `/props` (llama.cpp), `/v1/model` (TabbyAPI), then the first line of `/metrics` (`vllm:`/`sglang:`/`llamacpp:`). An OpenAI-shaped 200 with no engine fingerprint and no GPU in its pid tree becomes `Endpoint{kind:"openai-proxy"}`. Connection refused or a 5xx on a container with GPU `DeviceRequests`, or on a GPU-owning pid, means `loading`. The :8002 singleflight proxy (500, no GPU) stays an `unknown-http` endpoint.
7. **GPU ownership:** for each compute-app pid, walk `PPid` up (`/proc/<pid>/status`, or the ps map) until it reaches a container `State.Pid` or a native engine root. That set of GPUs belongs to the model. Before any compute pids exist (early loading), fall back to `DeviceRequests[].DeviceIDs`, then to `CUDA_VISIBLE_DEVICES`/`NVIDIA_VISIBLE_DEVICES` resolved as UUIDs or indexes. `all` means every GPU.
8. **Host argv:** the real engine argv is `/proc/<engine pid>/cmdline` of the engine process under `State.Pid`, not `Config.Cmd`. The model path maps back through `Mounts`. `--served-model-name`, `--max-model-len`/`--context-length`/`-c`, `--tensor-parallel-size`, `--speculative-config` and `--kv-cache-dtype` are parsed from it. Context window comes from `/v1/models[].max_model_len` → argv → `MAX_MODEL_LEN` env. `cache` comes from `vllm:cache_config_info` labels (block size 2048, kv tokens 4,576,303 on gpu-box), taken from the metrics slice's latest sample.
9. **Watchdogs:** process argv matching `LOCAL_STUDIO_WATCHDOGS` (default `keep-serving.py,forge.py`) is listed in `Machine.watchdogs`. A model gets `watchdog` set when a watchdog is present on its machine. The UI then shows "a watchdog may restart this".
10. **Origin:** `managed` when the container carries `local-studio.managed=1` **and** `local-studio.machine=<our machineId>`. Everything else is `adopted`. The old controller's `local-studio.instance` label is ignored for ownership.

### 6.2 States

| State | Rule |
|---|---|
| `loading` | process/container alive, port bound or published, `/health` (or `/v1/models`) not 200, age < 30 min |
| `ready` | `/health` 200 and `/v1/models` lists at least one id |
| `unhealthy` | was ready, then 3 consecutive failed probes, or loading for 30 min or more |
| `stopping` | a stop is in progress |

State changes set `stateSince`. A model that disappears between scans is dropped, and a `log` event is emitted.

### 6.3 GPU groups

Computed from `gpus` and `models`. The GPUs of a model form one group: `running` if the model is ready, `busy` if it is loading or stopping, `kind: grouped` when there is more than one GPU. Every other GPU is its own `alone` group, marked `foreign` ("in use by another program") if `memUsedMiB > 2048` and not owned by a model, and `available` otherwise. On gpu-box today this gives one `grouped/running` group over `nvidia:0..3` for `local-studio-llm`. The UI builds "N × <gpu>" available group rows from runs of available GPUs of the same hardware id (plugin rule, the field notes).

### 6.4 Managed launch (`LifecycleService.launch(plan)`)

The input is a `LaunchPlan` from recipes (§9.3). The call is non-blocking: it returns `LaunchProgress` right away and moves through the phases `planning → pulling → starting → loading → ready | failed | cancelled`, emitting SSE `launch` events.

- Reservation: an in-memory lock per GPU key, re-checked against the live `groups` (the target GPUs must be `available`). A `foreign` GPU is refused. This fixes the vLLM Studio "lease ignores foreign users" bug.
- Port: the first bindable port in `12434-12499`, bind-probed on `127.0.0.1` and `0.0.0.0`.
- Pull: `docker image inspect` first, then `docker pull <digest image>` with a 60 min timeout. The image must be pinned by digest.
- Run: `docker run -d --name <plan.containerName> --label local-studio.managed=1 --label local-studio.recipe=<id> --label local-studio.machine=<machineId> --gpus "device=<uuid,…>" [--shm-size] [--entrypoint] -p 127.0.0.1:<hostPort>:<containerPort> -v src:dst[:ro] … -e K=V … <image> <args…>`. The engine binds loopback only; peers reach it through the gateway. The argv is logged with secrets redacted.
- Readiness: poll `/health` and then `/v1/models` every 3 s, with a 30 min timeout. Percent is elapsed time over the last recorded load time for this recipe (table `launch_history`, default `sizeGb × 6 s`), capped at 95. If `docker inspect .RestartCount ≥ 2` or the container exits, the launch fails with the first error line of `docker logs --tail 80`.
- Cancel: stop and remove the container, then release the GPUs.
- No `max_tokens`, no `--enforce-eager`, no disabled CUDA graphs. A plan containing `enforce.eager|disable.?cuda.?graph` is refused (the registry gate rule).

### 6.5 Stop (`LifecycleService.stop`)

- `confirm` must equal the model id. In `--read-only` mode stop is always refused (403 from auth). If a watchdog is present, `force: true` is also required.
- Right before acting, it re-checks that the container Id (or pid plus start time) and the port are the same as in the last scan.
- A managed container gets `docker stop -t 30`, then `docker rm`. An adopted container gets only `docker stop -t 30`, and is never removed, so the owner can inspect it or restart it. A native process gets SIGTERM to its process group, then SIGKILL after 30 s.

## 7. Gateway (slice 2)

### 7.1 Shape

```
client dialect ──decode──▶ CanonicalRequest ──encode──▶ upstream chat/completions (always stream:true, include_usage)
                                                             │ SSE
client dialect ◀──encode── CanonicalEvent stream ◀──decode───┘
```

Every engine serves OpenAI chat completions (vLLM, SGLang, llama.cpp, TabbyAPI, MLX), so **the upstream is always chat completions with streaming**. Only one upstream codec exists. This removes the "engine may not serve this API" failure (G1). Always streaming upstream also gives TTFT for every request, including non-streamed client calls (fixes G4, whose TTFT was always null), and it catches mid-stream failures (G3). Codecs are pure functions in `gateway/dialects/{chat,responses,messages}.ts`, each under about 400 lines.

**Chat → chat is a passthrough.** The client body goes upstream unchanged, except for: `model` rewritten to the served name, `stream: true`, `stream_options.include_usage: true`, and output caps stripped (§7.4). The upstream bytes go back unchanged while a side observer decodes them into canonical events. The usage-only chunk is held back (§7.5) and dropped if the client did not ask for usage. A non-streamed client gets the stream aggregated into one `chat.completion` JSON. Vendor fields such as `reasoning_content`/`reasoning` and `tool_calls` survive untouched.

### 7.2 Canonical model (`gateway/canonical.ts`)

```ts
type CPart = { type: "text"; text: string } | { type: "image"; url: string };           // url may be data:
type CMessage =
  | { role: "system"; text: string }
  | { role: "user"; parts: CPart[] }
  | { role: "assistant"; text: string; reasoning: string | null; toolCalls: { id: string; name: string; args: string }[] }
  | { role: "tool"; toolCallId: string; parts: CPart[]; isError: boolean };
interface CRequest {
  model: string; messages: CMessage[];
  tools: { name: string; description?: string; parameters: unknown; strict?: boolean }[];
  toolChoice: "auto" | "none" | "required" | { name: string } | null;
  stream: boolean; temperature?: number; topP?: number; stop?: string[];
  reasoning: { effort?: string; enabled?: boolean } | null;
  responseFormat?: unknown;              // json_schema passthrough
  extra: Record<string, unknown>;        // engine extras kept verbatim: chat_template_kwargs, top_k, seed, repetition_penalty…
  capsStripped: string[];                // e.g. ["max_tokens"]
}
type CEvent =
  | { t: "start"; id: string; model: string }
  | { t: "text"; delta: string } | { t: "reasoning"; delta: string }
  | { t: "tool_start"; index: number; id: string; name: string } | { t: "tool_args"; index: number; delta: string }
  | { t: "usage"; usage: TokenBuckets; raw: unknown }
  | { t: "finish"; reason: "stop" | "tool_calls" | "length" | "content_filter" }
  | { t: "error"; status: number | null; code: ErrorCode; message: string };
```

### 7.3 Dialect mapping (only what is needed)

| | Chat Completions | Responses | Anthropic Messages |
|---|---|---|---|
| request in | passthrough (+decode for peer/aggregate) | `input` string or items: `message` (input_text/input_image/output_text), `function_call`, `function_call_output`, `reasoning` (summary → assistant reasoning); `instructions` → system; `tools[type=function]`; `reasoning.effort`; `text.format` → responseFormat | `system` (string or blocks), `messages` blocks `text`, `image` (base64/url), `tool_use`, `tool_result` (`is_error`), `thinking` (→ reasoning); `tools[].input_schema`; `tool_choice` (`auto/any/tool/none`); `thinking.type` |
| stream out | upstream bytes | `response.created`, `response.in_progress`, `response.output_item.added`, `response.content_part.added`, `response.output_text.delta`, `response.reasoning_summary_text.delta` (reasoning item), `response.function_call_arguments.delta`, `…done` events, `response.completed` with `usage{input_tokens, input_tokens_details.cached_tokens, output_tokens, output_tokens_details.reasoning_tokens}` | `message_start` (usage placeholder), `content_block_start/delta/stop` for `thinking` (`thinking_delta`), `text` (`text_delta`), `tool_use` (`input_json_delta`), `message_delta{stop_reason, usage}`, `message_stop` |
| finish map | as is | `completed` / `incomplete{reason:max_output_tokens}` for length | `end_turn` / `tool_use` / `max_tokens` |
| error mid-stream | `data: {"error":{…}}` then `[DONE]` | `response.failed` | `event: error` |
| usage out | `prompt_tokens` (incl. cached), `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` | as above | `input_tokens` = uncached, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` |
| non-stream | aggregate | aggregate into `response` object | aggregate into `message` object |

- `POST /v1/messages/count_tokens`: POST to the engine's `/tokenize` (vLLM/SGLang) with the chat-templated messages if available, else the dsh heuristic (chars/4 + 4 per block, the field notes). Returns `{input_tokens}`.
- Responses `previous_response_id` and `store: true` are rejected with a clear 400 (§14). Codex sends full input with `store: false`.
- `n > 1` is rejected with a 400.
- Tool-call ids: preserved. When the upstream has none, they are synthesised as `call_<base36 time><counter>`, and `toolu_…`/`fc_…`-prefixed ids are kept per dialect.

### 7.4 Policy (the known bugs, fixed)

- **No output caps, ever.** `max_tokens`, `max_completion_tokens`, `max_output_tokens`, and Anthropic `thinking.budget_tokens` are removed before going upstream and listed in `RequestRecord.capsStripped`. Anthropic requires `max_tokens` from clients, so it is an artifact of that API and not a real limit. The gateway never adds a cap.
- **Routing:** `model` is matched case-insensitively against local `ready` models' `servedModels` first, then against peers' ready models in registration order. A `<peerName>/<model>` id forces a machine. A registry recipe id that is running resolves to its served name. Unknown models get a 404 `MODEL_NOT_FOUND` in the dialect's error shape, and the 404 is **recorded** (fixes G9). Loading models get a 503 with `retry-after`, also recorded.
- **Headers:** upstream `x-request-id` is copied to the client as `x-upstream-request-id`. The request gets `x-request-id: <our id>`. `anthropic-*` and `openai-*` headers are dropped upstream, because the engine speaks chat.
- **Keepalive:** SSE comment every 15 s on all three dialects until the first byte (fixes G10).
- **Abort:** when the client disconnects, the upstream fetch is aborted and the request is recorded as `ABORTED`, status 499.
- **Errors are always recorded**, whether upstream 4xx/5xx, connect failure, timeout, mid-stream error or empty response. `errorCode` comes from `classifyError` (fixes G2 and G13).
- **Peer requests:** if the model lives on a peer, the client body is forwarded **unchanged in its own dialect** to `<peer>/v1/<path>` with the hub's peer key and `X-Local-Studio-Client: <client>`, `X-Local-Studio-Via: <hub machineId>`. The bytes are piped back. The hub records the request with `via:"peer"` for latency and client views, and excludes it from token totals (the peer counts it).
- **`/v1/models`:** returns `{object:"list", data:[{id, object:"model", owned_by:<machine name>, context_length, contextWindow, max_model_len, local_studio:{machineId, modelId, engine, state, vision, via}}]}`. With `anthropic-version` it returns `{data:[{id, type:"model", display_name, created_at}], has_more:false}`. No max-output field is ever included.

### 7.5 Usage and timing capture in the stream

- `tsStart`: request body parsed. `tsUpstream`: upstream response headers received. `tsFirstToken`: first non-empty `text`, `reasoning` or `tool_start`/`tool_args` event. Role-only chunks and `response.created`/`message_start` do not count (G4). `tsEnd`: upstream `[DONE]`, or stream end.
- Per-chunk timing is not stored per request; the controller keeps a ring of gateway per-read processing times (`gateway.chunk_us`) in `GET /api/health/detail`.
- The usage-bearing final chunk is **held** until `metrics.finish()` resolves (at most about 400 ms, §8.3). The gateway then emits it with `prompt_tokens_details.cached_tokens` filled from the final record, so dsh shows its cache-hit pill even when vLLM lacks `--enable-prompt-tokens-details`, then `[DONE]`.

## 8. Metrics (slice 2)

The design copies DeepSeek Harness's data model and formulas, on the server side and for every client. It adds prefill, per-day and per-client rollups, spend, and engine-side truth, none of which dsh has.

### 8.1 Stores (all in `local-studio.db`, module `metrics`)

```sql
requests(id TEXT PK, ts_start INT, ts_upstream INT, ts_first_token INT, ts_end INT, day TEXT,        -- day = local date in config.tz
  machine_id, model_id, model, engine, client, workspace_id, session_id, dialect, stream INT, via, peer_id,
  status INT, finish, error_code, error_message,
  input_uncached INT, cache_read INT, cache_write INT, output INT, reasoning INT, prompt_total INT, total INT,
  usage_source, cache_source, context_window INT,
  ttft_ms INT, decode_ms INT, prefill_tps REAL, decode_tps REAL,
  engine_queue_ms INT, engine_prefill_ms INT, engine_decode_ms INT,
  caps_stripped TEXT, chunk_time0 INT, chunk_dt TEXT, cost_usd REAL)
  -- indexes: (ts_start), (day, model), (model_id, ts_start), (client, day)
engine_samples(ts INT, model_id, engine, counters TEXT, gauges TEXT)                 -- every 5 s while ready; 7 days
usage_daily(day, machine_id, model, client, requests, errors, input_uncached, cache_read, cache_write,
  output, reasoning, decode_tokens, decode_ms, prefill_tokens, prefill_ms, ttft_sum_ms, ttft_n, cost_usd,
  PRIMARY KEY(day, machine_id, model, client))                                     -- UPSERT in the same txn as the request row
prices(model PK, input, output, cache_read, cache_write)                              -- USD per 1M tokens; default none = $0
launch_history(recipe_id, started_at, load_seconds)                                   -- owned by discovery, listed here for completeness
```

Retention: `requests` 90 days, `engine_samples` 7 days, `usage_daily` forever. Pruning runs hourly.

### 8.2 Per-request formulas (`formulas.ts`, the same as dsh)

| Metric | Formula | Null when |
|---|---|---|
| TTFT | `tsFirstToken − tsStart` | no content token arrived |
| decode ms | `tsEnd − tsFirstToken` | no first token |
| decode tok/s | `output / (decode_ms/1000)` | `output < 2` or `decode_ms = 0` |
| prefill tok/s | `inputUncached / (ttft_ms/1000)`, marked "includes queue" | `inputUncached < 256` |
| engine prefill tok/s | `inputUncached / engine_prefill_ms` (exclusive window, §8.3) | not exclusive |
| cache hit | `cacheRead / promptTotal`, displayed with `fmt.cacheHitPercent` | `promptTotal = 0` |
| error rate | `count(errorCode ≠ null) / count(*)` per window, by `errorCode` | no requests |
| cost | pi-ai formula (dsh §7.9) with the `prices` row: `(in·uncached + out·output + cr·cacheRead + cw·cacheWrite)/1e6` | no price → `null` (UI shows `$0 local`) |
| context pressure | `promptTotal / contextWindow` of the latest request per session | no window |

Aggregates are always Σ/Σ: `decodeTps = Σoutput / Σdecode_ms`, `prefillTps = Σinput_uncached / Σttft_ms` over qualifying rows, and `cacheHit = ΣcacheRead / ΣpromptTotal`. Percentiles (p50/p90/p99 TTFT and per-request decode tok/s) come from SQL `ORDER BY … LIMIT 1 OFFSET ⌊p·n⌋` over the window. They are real, not hard-coded null (fixes M8). Windows use indexed integer `ts_start`, not `datetime()`, which fixes M9.

### 8.3 Engine truth and exclusive-window attribution

The **scraper** fetches `/metrics` of every `ready` model every 5 s (2 s timeout). It parses Prometheus text **with labels** and sums across label sets, ignoring `_created` series and summing `_bucket` only where needed. This fixes M1. The result is normalised into `EngineCounters`/`EngineGauges`:

| Field | vLLM | SGLang | llama.cpp (`--metrics`) |
|---|---|---|---|
| promptTokens | `vllm:prompt_tokens_total` | `sglang:prompt_tokens_total` | `llamacpp:prompt_tokens_total` |
| generationTokens | `vllm:generation_tokens_total` | `sglang:generation_tokens_total` | `llamacpp:tokens_predicted_total` |
| promptTokensCached | `vllm:prompt_tokens_by_source_total{source=local_cache_hit}` ∨ `vllm:prompt_tokens_cached_total` | `sglang:cached_tokens_total` | per-request `timings.cache_n` |
| promptTokensLocalCompute | `…by_source{source=local_compute}` | – | – |
| prefixCacheQueries / Hits | `vllm:prefix_cache_queries_total` / `_hits_total` | – (gauge `sglang:cache_hit_rate`) | – |
| requestsSuccess{reason} | `vllm:request_success_total{finished_reason}` | `sglang:num_requests_total`, `num_aborted_requests_total` | – |
| httpStatus{class} | `http_requests_total{status}` | – | – |
| ttft / queue / prefill / decode / e2e sum,count | `vllm:time_to_first_token_seconds`, `request_queue_time_seconds`, `request_prefill_time_seconds`, `request_decode_time_seconds`, `e2e_request_latency_seconds` | `sglang:time_to_first_token_seconds`, `queue_time_seconds` | per-request `timings.prompt_ms/predicted_ms` |
| spec drafts / draft tokens / accepted | `vllm:spec_decode_num_drafts_total`, `…num_draft_tokens_total`, `…num_accepted_tokens_total` | gauge `sglang:spec_accept_length` | – |
| gauges | `kv_cache_usage_perc`, `num_requests_running`, `num_requests_waiting` | `token_usage`, `num_running_reqs`, `num_queue_reqs`, `gen_throughput` | – |

`EngineRates` (a 60 s ring buffer, published as SSE `engine`) contains: prefix hit rate `Δhits/Δqueries`, engine prefill tok/s `ΔlocalCompute/ΔprefillSum`, engine decode tok/s `ΔgenTokensHistSum/ΔdecodeSum`, wall generation tok/s `ΔgenerationTokens/Δt` (live throughput that still counts during long requests, the field notes caveat), mean TTFT and queue, spec accept length `1 + Δaccepted/Δdrafts`, KV usage, running and waiting. Counter resets (engine restart, `value < previous`) start a new baseline. These are **engine-wide**: they include traffic that bypasses the gateway, such as forge benches hitting :8000 directly, and the UI labels them "engine".

**Exclusive-window attribution** gives per-request cache and engine timing even when the engine's usage block has no `cached_tokens`:

1. `metrics.begin(modelId)`: if the gateway has no other request in flight to this model, it scrapes `before` (250 ms timeout) and **then** the gateway forwards upstream.
2. `metrics.finish(handle, draft)`: it scrapes `after` 60 ms after stream end, retrying up to 3 times over 300 ms until `ΣrequestsSuccess` has advanced.
3. The request counts as exclusive only if all of these hold: gateway in-flight to this model stayed at 1 for the whole interval, `before.running == 0 && before.waiting == 0`, `ΔΣrequestsSuccess == 1`, and `ΔpromptTokens == draft.promptTotal` (when usage was reported). If any check fails, nothing is attributed and those fields stay `null`.
4. When exclusive: `cacheRead = ΔpromptTokensCached` if the engine did not report it (`cacheSource:"metrics"`, `usageSource:"engine+metrics"`), and `engineQueueMs`, `enginePrefillMs`, `engineDecodeMs` come from the histogram sum deltas. When the engine did report cached tokens, `cacheSource:"engine"` and the metrics delta is kept only as a cross-check.
5. Any disagreement between usage and the Prometheus deltas (prompt, output, cached) is logged at `warn`.

Usage without an engine usage block (a rare engine, or a truncated stream) is `usageSource:"estimated"`: output is 1 per content delta and prompt is the chars/4 heuristic. These rows are excluded from speed aggregates.

### 8.4 Rollups for the UI

- `activity()`: 140 days (20 weeks × 7, starting on the Monday 19 weeks before this week) of **tokens per local day** (`Σtotal`) from `usage_daily`, plus `requests`, `total`, `week`, `since`, `last`, with `via:"local"` rows only (§7.4). This is the plugin's `life` object, and it drives the calendar tiles.
- `cards()`: per running model, the plugin's run-card stats using dsh formulas: `sessionTokens` (since `startedAt`), `allTokens`, `week`, `decodeTps`/`prefillTps` (Σ/Σ, last 7 days), `meanTtftMs`, `cacheHit`, `errorRate` (24 h), and `line` (24 cumulative points, first to last request).
- `summary(window)`: `MetricsSummary` with `byModel` and `byClient` slices. This is the spend table: tokens in/out/cached per model/client/day, plus USD.
- Fleet totals (federation) are the **sum of each machine's own** activity and summaries, so proxied requests are never counted twice.

### 8.5 Presentation (dsh + plugin)

- **Pills** (dsh `StatsPills`): `N tok/s · X% cache hit`. They expand to `<dl>` rows: requests, avg TTFT (p50/p90), decode tok/s, prefill tok/s (engine and gateway), cache hit, input, cache read, cache write (hidden when 0), output, reasoning, errors by code, spend.
- **Figure grid** (plugin model page, 3×2): `decode avg` tok/s, `prefill avg` tok/s, `first token`, `session`, `week`, `up`.
- **Formatting:** `fmt.k` (517 / 12.2K / 1.2M), `fmt.tps` (≥10 integer, <10 one decimal), `fmt.ms` (`45.2s`, `2m42s`), `fmt.cacheHitPercent`. Unmeasured values show `–`.

## 9. Recipes: registry, launch, export, PR (slice 3)

### 9.1 Source

The registry is the only recipe store, read-only here. `<registryDir>` is a clone of `github.com/0xSero/local-ai-registry`: cloned on first use (`git clone --filter=blob:none`, 120 s timeout) and refreshed with `git fetch origin` on `POST /api/recipes/sync` or when older than 6 h. The launchable catalog is `git show origin/main:plugin/v2/recipes.json` (schema `omarchy-local-ai/recipes/2`, the field notes). The full record, for detail views and export templates, is `git show origin/main:registry/recipe/<id>.json`. If git is unavailable, `https://raw.githubusercontent.com/0xSero/local-ai-registry/main/plugin/v2/recipes.json` is fetched and cached. The registry working tree is never modified; PRs use a separate worktree.

Local recipes are read from `<home>/recipes/*.json` (one record or an array per file, re-read when a file changes) and listed ahead of the registry. A local record has the v2 recipe shape plus `hardwareId`; its weights may name a `hostPath` instead of a pinned revision, its image may be a tag (the plan warns), and `launch.mounts` and `launch.docker` add extra bind mounts and allow-listed docker flags (`--init`, `--ipc=host`, `--oom-score-adj=N`, `--ulimit=memlock|stack=…`, `--security-opt=seccomp=<file>.json`). They are data on the machine that runs them, never in the repository. A bad file is logged and skipped.

### 9.2 Rows and fit

The catalog is flattened into `Recipe[]` (hardware id and `recommended` added). `RecipeRow.fit` is computed against this machine's GPUs: `no-hardware` (no GPU of that hardware id), `too-few-gpus` (fewer than `cards`), `busy` (enough GPUs, not enough `available`), or `fits` with `freeGroups` (lowest-index sets of `cards` available GPUs of that hardware). `runningModelId` is set when a running model serves `servedName`.

### 9.3 LaunchPlan

A plan is built only from a `fits` row (unless `gpuKeys` is given and valid), using the plugin's gates: image pinned by digest, weights revision of 40 hex characters, arguments with no `enforce-eager`/`disable-cuda-graph`, env keys matching `^[A-Z_][A-Z0-9_]*$`, and `NVIDIA_VISIBLE_DEVICES`/`CUDA_VISIBLE_DEVICES` from the recipe dropped (the controller picks the cards). Weight host paths are resolved in this order: `<home>/weights.json` map `{ "<repo>@<rev>": "/abs/path" }`, then a directory under `modelsDir` whose name contains `rev[0:7]` and holds `config.json` (this matches gpu-box `/mnt/llm_models/GLM-5.3-Flash-LIL-NVFP4-46aaae8`), then `modelsDir/<owner--repo>@<rev12>`, then the HF cache snapshot `~/.cache/huggingface/hub/models--owner--repo/snapshots/<rev>`. If none exists, the launch fails with the exact `hf download <repo> --revision <rev> --local-dir <path>` command (downloads are §14). An `asset` is written to `<dataDir>/assets/<recipe>/<name>` and mounted read-only. `containerName = ls-<recipeId>` (`-2`, `-3` for duplicates). **Injected flags** are listed in `plan.injected` so export can show them: vLLM `--enable-prompt-tokens-details` and SGLang `--enable-metrics`, added only when the recipe's args already use CLI flags (`--served-model-name` present) and lack them.

### 9.4 Export (`POST /api/models/:id/export`)

This reads the host only: `docker inspect`, `docker image inspect`, `/proc` argv, `/v1/models`, `/version`, and the metrics store. It produces a registry v1 record with `status: "candidate"`, mapped as in the field notes:

- `launch.image`: `RepoDigests[0]` (refused if there is none).
- `launch.arguments`: `Config.Cmd`; `Config.Entrypoint` goes to `entrypoint` if it differs from the image default.
- `environment`: `Config.Env` minus the image's default env, minus secrets (`*_KEY|*_TOKEN|*_SECRET|HF_TOKEN|*PASSWORD*`), minus `NVIDIA_VISIBLE_DEVICES`/`CUDA_VISIBLE_DEVICES`.
- `mounts`: weight directories become `${MODEL_ROOT}/<basename>` read-only, with `provision{repository, revision}` from `local-inference.*` labels or `MODEL_REVISION`/`DFLASH_MODEL_REVISION` env. Cache directories become `${CACHE_ROOT}/<basename>`.
- Ports, shm, ipc and network come from `HostConfig`. Host IPC or host network is flagged as a refusal, since the registry gate rejects it.
- `hardware_id` and `hardware_count` come from the model's GPUs.
- `engine{name, version from /version or the local-inference.vllm.version label, graph_mode from argv --compilation-config}`.
- `serving{max_context_tokens, kv_cache_tokens from cache_config_info, max_concurrency from --max-num-seqs, tensor_parallel, kv_cache_dtype}`.
- `capabilities`: `null` with the reason "not proven; run accept_recipe.py". Capabilities are never guessed.
- `launch.container{captured_at, reason:"runtime-digest-from-live-container", state:"digest-pinned"}`.
- A `metadata.local_studio` block holds the **full host argv** (the truth, since Cmd can be a wrapper script) and the measured 7-day stats with provenance "local-studio gateway, <machine>, <window>".

The id is `<served-name>-<hardware-short>-<engine>-tp<N>` slugified. A `doc` Markdown file (what ran, where, host argv, measured numbers, refusals, the acceptance command `python3 scripts/accept_recipe.py <id> --endpoint http://127.0.0.1:<port>/v1`) is saved with the record to `<dataDir>/exports/<id>/{recipe.json,README.md}`. Native processes export as `launch.kind: "native"` (not launchable) with argv. That is still useful as a record.

### 9.5 PR (`POST /api/models/:id/export/pr`)

This refuses when there are refusals, or when `gh auth status` fails (10 s timeout). Steps: `git -C <registryDir> fetch origin`, then `git worktree add <home>/registry-work/<branch> origin/main -b local-studio/<id>-<yyyymmddHHMM>`. It writes `registry/recipe/<id>.json` (2-space JSON, sorted keys, like the existing records), commits `recipe: <model> on <hardware> via <engine>, candidate`, pushes the branch to `origin`, and runs `gh pr create --repo 0xSero/local-ai-registry --base main --draft --title … --body-file <README.md>`. It returns the URL. The worktree is left in place for the user to amend. The registry CI and `make check` validate the rest.

## 10. Federation (slice 4)

As in the field notes:

- **Identity:** `/health` returns `service:"local-studio"` and `machineId` (done in the scaffold).
- **Discover:** `tailscale status --json` (5 s timeout; on macOS the CLI may be `/Applications/Tailscale.app/Contents/MacOS/Tailscale`). Keep peers that are online, untagged, in the same MagicDNS suffix, with OS linux or macOS. Probe `http://<dns>:8080/health` (2 s timeout, 8 at a time). The result is `TailnetCandidate` with kind `local-studio`, `legacy-controller` (plain `{"status":"ok"}`), or `none`. Discovery never connects and never sends a key.
- **Connect:** `POST /api/machines {url, key}` checks `<url>/health`, then `GET <url>/api/snapshot` with the key. It stores `peers(id, machine_id, name, base_url, added_at, last_seen_at)` and writes the key to `<home>/keys/peer-<id>.key` (0600). The key is never returned.
- **Poll:** each peer's `/api/snapshot` every 3 s (2 s timeout), cached. A peer is marked offline after 3 misses. Changes emit `fleet` and `peer` events.
- **Passthrough:** `ALL /api/peers/:id/*` goes to `<baseUrl>/<rest>` with **the hub's stored key** (never the caller's). Bodies stream both ways, including SSE. Hop-by-hop headers are stripped. `redirect: manual`, 5 s connect timeout, no total timeout on streams, upstream aborted when the client disconnects. Only registered ids are accepted, so there is no SSRF surface.
- **`fleet()`:** self snapshot plus cached peer snapshots, peers, fleet activity (sum of machines' own activity), harnesses and workspaces from `svc.agents`.
- **`models()`:** each online peer's `ready` models as `GatewayModel{via:"peer"}`, id `<served>` (or `<peerName>/<served>` on collision with a local model).

## 11. Agents (slice 4)

As in the field notes-5 and the field notes-6. Agents **always** use the local gateway at `http://127.0.0.1:<port>`.

- **Keys:** one per client (`claude-code`, `codex-cli`, `codex-desktop`, `claude-desktop`, `dsh`), issued once via `ctx.keys.issue`. The plaintext goes to `<home>/keys/<client>.key` (0600). Keys are never put on argv, in logs, or in generated scripts.
- **Workspaces table:** `workspaces(id ws_<8hex>, name, dir, harness, model, flags JSON, created_at, last_open_at)`. The default dir is `~/LocalStudio/workspaces/<slug>`. Delete removes the row only.
- **Launch table** (`agents/launch-table.ts`, the only place harnesses are described), built as `{argv, env, files}` from `{harness, model, contextWindow, vision, dir, keyFile}`:
  - `claude`: env `ANTHROPIC_BASE_URL=G`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL` and `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` = M, `CLAUDE_CODE_SUBAGENT_MODEL=M`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS=ctx`, `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `ANTHROPIC_CUSTOM_HEADERS="X-Local-Studio-Client: claude-code\nX-Local-Studio-Workspace: <ws>"`. Argv `claude --model M --dangerously-skip-permissions [--continue]`. No `MAX_THINKING_TOKENS`.
  - `codex`: `codex -C <dir> -c model_providers.localstudio.{name,base_url=G/v1,wire_api=responses,env_key=LOCAL_STUDIO_API_KEY,http_headers={…}} -c model_provider=localstudio -c model=M -c model_context_window=ctx --dangerously-bypass-approvals-and-sandbox [resume --last]`. `~/.codex/config.toml` is never touched.
  - `dsh`: one supervised `dsh web --port 3090 --no-open` per machine, with `DSH_HOME=<home>/dsh` (isolated; `~/.dsh` and the user's :3080 instance are never touched) and `DSH_TELEMETRY_DISABLED=1`. `settings.yaml` is written with `yaml.parseDocument`, upserting only `llm-pi-ai.providers.localstudio-gateway` (`api: openai-completions`, `baseURL: G/v1`, `apiKeyEnv: LOCAL_STUDIO_API_KEY`, models with `contextWindow` and `input`, **no `maxTokens`**) and `agent-default-model` on first write. The runtime is `@deepseek-ai/dsh@latest` installed into `<home>/dsh-runtime` with `npm i` (300 s timeout) on first use, or `~/dsh-run` if the user sets `LOCAL_STUDIO_DSH_BIN`. The login URL is parsed from stdout (`^dsh web: (http://\S+)`) and given to the UI once, never logged.
  - `codex-desktop` / `claude-desktop` (tier 2): Codex.app with a private `CODEX_HOME=<home>/agents/codex-home` holding `config.toml`. Claude.app through a 3p config-library entry. Both are behind "set up once" and need a manual check first. Neither quits a running app without the UI's explicit confirmation.
- **Persistence:** terminal harnesses run inside `tmux new-session -A -s ls-<wsId> -c <dir> 'local-studio agent run <wsId>'`. The `agent run` CLI reads the workspace and key file, writes files (0600), and `exec`s the harness. It picks `--continue`/`resume --last` when the tmux session is gone but history exists. A terminal window opens through the ported `terminals.ts` table (macOS Terminal, iTerm, Ghostty, Warp; Linux `omarchy-launch-tui`, ghostty, kitty, alacritty, wezterm, gnome-terminal, konsole, xterm). A headless host returns `how:"tmux"` and `attach: "ssh -t <host> tmux attach -t ls-<ws>"`.

## 12. Deploy and desktop (slice 5)

- **Artifact:** `scripts/release.sh` runs `bun run build:ui`, then `bun build controller/src/main.ts --compile --target=bun-{linux-x64,darwin-arm64} --define process.env.LOCAL_STUDIO_VERSION='"<ver>"'`, producing `dist/<os>-<arch>/{local-studio,ui}` plus `dist/local-studio-<ver>-<os>-<arch>.tar.gz` (the controller finds `<execDir>/ui`). The target machine does not need bun.
- **`local-studio deploy <ssh-host> [--port 8080] [--dir ~/local-studio] [--host <bind>] [--read-only] [--service] [--no-start] [--replace] [--connect]`:**
  1. Probe with `ssh -o BatchMode=yes -o ConnectTimeout=8` under a 20 s alarm: `uname -sm`, `command -v docker nvidia-smi tmux systemctl`, and `curl --max-time 2 127.0.0.1:<port>/health`.
  2. Build or reuse the artifact for the target's OS and architecture.
  3. `ssh mkdir -p`, `scp` the binary and a ui tarball (300 s timeout), untar, `chmod 0755`.
  4. Write `<dir>/env` (0600) with host, port, `LOCAL_STUDIO_HOME=<dir>/home`, and read-only.
  5. Start. By default, if the port answers `/health` with `service:"local-studio"`, it stops there (idempotent) unless `--replace` is given, in which case only **our own** tmux session is killed. Otherwise `tmux -L local-studio -f /dev/null new-session -d -s local-studio-<port> '<dir>/local-studio serve …'` on a private tmux server that never loads the user's `~/.tmux.conf` or plugins (a default-socket server once triggered tmux-continuum to restore old sessions on gpu-box), or `setsid nohup` without tmux. `--service` installs a systemd **user** unit `local-studio-<port>.service` (Linux) or a launchd agent (macOS) and starts it. It never restarts any other unit.
  6. Poll `/health` over ssh for 30 × 1 s.
  7. With `--connect`, read the admin key with `ssh <host> '<dir>/local-studio key --home <dir>/home'` into memory and `POST` it to the local controller's `/api/machines`. It is never printed.
  - `local-studio deploy stop <ssh-host> [--port]` kills only `tmux -L local-studio kill-session -t local-studio-<port>` (or `systemctl --user stop` for `--service`).
- **Desktop (`desktop/`, Electron):** `main.cjs` checks `GET http://127.0.0.1:8080/health` (1 s timeout). If it is not `service:"local-studio"`, it spawns `<resources>/local-studio serve --port 8080` (the same binary and ui) and waits for health, then opens a `BrowserWindow` on `http://127.0.0.1:8080/`. It kills the child on quit only if it started it. electron-builder produces a macOS arm64 dmg and zip and a Linux x64 AppImage, plus electron-updater metadata, with `extraResources` = the binary and ui. There is no preload API, no IPC and no tray.

## 13. UI (slice 6)

The UI is a Vite + React 19 SPA with no router library (hash views) and no state library. **The view is data**: `view = build(fleet, ui)`, then `render(view)`, then `dispatch(action)`.

- **Data:** `GET /api/fleet` on load, then SSE `/api/events?types=snapshot,fleet,request,launch,engine` read with `fetch` + a streaming reader (so it can send `Authorization`), with reconnect/backoff. The local snapshot comes from `snapshot` events and peers from `fleet`. Peer-specific actions go through `/api/peers/<id>/…`. A key prompt appears only on a 401; the key is kept in localStorage.
- **Design**: JetBrains Mono, vantablack tokens (`--bg #000`, `--surface #0f0f0f`, `--card #141414`, `--ink #fff`, `--value #d4d4d4`, `--label #b2b2b2`, `--rule #535353`, `--alert #d1a8a8`, `--alert-rule #a55555`), square corners, 1px rules, no bold, lowercase labels, UPPERCASE section headings, the plugin spacing grid × 1.25 for desktop width, and a two-column wide layout. Colors are defined only in `ui/src/theme.css`, and `prefers-reduced-motion` is honoured.
- **Views (four, nothing else):**
  - **control:** machines strip (select a controller, connect one), run cards with Agent / Export / Stop, GPU rows with group state, and the recipe table with Launch (plan preview, typed-confirm stop).
  - **live:** GPU util (with a short history), memory, power, temp; engine running/waiting, KV, prefix hit, spec accept, rates; controller health from `/api/health/detail`; recent requests (SSE locally, polled from peers).
  - **usage:** machine and window filters, the 140-day calendar, totals (tokens in/cached/out, cache hit, spend, error rate, decode/prefill tok/s, TTFT p50/p90/p99), and tables by machine, model, client, day, hour (last 24 h from records) and error code.
  - **agents:** DeepSeek Harness, Claude Code, Codex, pi and omp against a chosen gateway model in a persistent workspace. Inside Electron (detected by user agent) the controller opens a terminal window (`.command` files on macOS, no Apple Events); in a browser the attach command is shown to copy.
- **Components:** `TitleLine`, `SectionHeading`, `ActivityGrid`, `ModelCard` (+`TokenLine` SVG), `SlotRow`, `GroupRow`, `Btn` (primary/secondary/danger), `Chips`, `FigureGrid`, `Pills`, `GpuRow`, `FieldRow`, `Table`, `Dialog`, `BarMark`. All numbers are formatted by `fmt` from contracts.

## 14. Left out, on purpose

- Load balancing, cross-machine retries, failover, request queues.
- A recipe editing UI and recipe CRUD (the registry plus `<home>/recipes/*.json` are the stores).
- Our own chat UI (dsh is the agent UI) and agent-session storage.
- Weight downloads (the launch fails with the exact `hf download` command), HF search, and model deletion.
- Native (non-docker) launches, compose launches, and launches on macOS/MLX (MLX servers are still discovered and adopted).
- AMD, Intel and Windows GPUs. The contracts keep a `backend` field so they can be added later.
- Responses `previous_response_id`/`store`, `n > 1`, legacy `/v1/completions`, embeddings, audio, and images endpoints.
- Tailnet `whois` "trust my tailnet" auth, TLS (use `tailscale serve`), multi-user accounts.
- Prometheus export of the controller itself, energy accounting, synthetic benchmarks, and `peak_*` tables.
- vLLM Studio's runtime upgrades, providers hub, rigs, VRAM calculator, and MCP.
- Automated test suites (owner rule). Verification runs against the live system (§15).
