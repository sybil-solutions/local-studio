# Studio, Audio, and Jobs modules

These three modules were not refactored by the five-phase migration —
they were touched only for import path fixes. They are documented here
for completeness and because Chapter 7 will flag at least one (audio)
as a structural concern noted in `CONTROLLER_SCOPE.md`.

## `controller/src/modules/studio/`

```
studio/
├── routes.ts        # 398 LoC
├── routes.test.ts
└── ...
```

`studio/routes.ts` is the catch-all for **Studio settings, diagnostics,
and provider CRUD**. Endpoints (paths are root-level):

```
GET  /studio/diagnostics          — system info (cpus, memory, platform, gpu, disk)
GET  /studio/settings             — read persisted config (~/.config/vllm-studio/config.json)
PUT  /studio/settings
POST /studio/storage/clear        — wipe data dir (with confirmation)
GET  /studio/storage              — disk usage breakdown of the data dir
GET  /studio/providers            — list providers (openai, anthropic, …)
PUT  /studio/providers/:id        — upsert provider with API key
DELETE /studio/providers/:id
GET  /studio/recommendations      — STUDIO_MODEL_RECOMMENDATIONS (curated list)
```

Diagnostics composition pulls together:

- `os.cpus()`, `os.freemem()`, `os.totalmem()`, `os.platform()`,
  `os.arch()`, `os.release()`.
- `getGpuInfo()` from `system/platform/gpu.ts`.
- `discoverModelDirectories()` and `estimateWeightsSizeBytes()` from
  `models/model-browser.ts`.
- `getVllmRuntimeInfo()` from `engines/layers/vllm-runtime.ts`.
- `loadPersistedConfig()` from `config/persisted-config.ts`.
- `statfsSync()` for disk space.

The diff vs `origin/main` is minimal (+6 LoC): an import path tweak
following the engines/system reorganisation.

## `controller/src/modules/audio/`

```
audio/
├── routes.ts        # 410 LoC
└── routes.test.ts
```

`audio/routes.ts` exposes the OpenAI-compatible STT/TTS endpoints:

```
POST /v1/audio/transcriptions     — multipart upload → transcribed text
POST /v1/audio/speech             — JSON in → audio out (WAV)
```

The implementation delegates to:

- `services/integrations/stt.ts` (`transcribeAudio`) — wraps a
  whisper-style command-line tool. `mode` can be `strict` or
  `best_effort`.
- `services/integrations/tts.ts` (`synthesizeSpeech`) — wraps a TTS
  command-line tool. `mode` is the same.
- `services/integrations/cli/cli-runner.ts` (`runCliCommand`) — runs
  arbitrary CLI integrations (the abstraction for both above).

The diff vs `origin/main` is +5/-5 LoC: import path adjustment and the
addition of `mkdir` (from `node:fs/promises`) for output paths.

**Chapter 7 note**: `CONTROLLER_SCOPE.md` flags `audio/` as
out-of-scope for the long-term controller. STT/TTS belongs in a
separate service (it owns its own ML stack and is not "vLLM Studio").
The branch leaves it where it is.

## `controller/src/modules/jobs/`

```
jobs/
├── index.ts                  # re-exports
├── configs.ts
├── job-manager.ts
├── orchestrator.ts
├── auto-orchestrator.ts
├── memory-orchestrator.ts
├── routes.ts
├── routes.test.ts
├── types.ts
└── workflows/
    ├── index.ts
    └── voice-assistant-turn.ts   # 4.8 KB — multi-step voice flow
```

The jobs module is the controller-side **task queue + orchestrator**.
Three flavours:

- `JobManager` — generic queue (persisted via `JobStore` SQLite).
- `Orchestrator` — manual job runner.
- `AutoOrchestrator` — schedules/auto-triggers based on system state.
- `MemoryOrchestrator` — runs jobs in-memory (testing/short-lived).

Workflows currently registered:

- `voice-assistant-turn.ts` — combines audio → STT → LLM → TTS →
  audio out into a single multi-step job. Used by Studio's voice
  assistant.

The diff vs `origin/main` is essentially zero in this module — only
import paths shifted, no logic change. `JobManager` is constructed in
`app-context.ts` and exposed on `AppContext` so HTTP routes
(`registerJobsRoutes`) can dispatch jobs.

## Why these modules weren't refactored

The migration explicitly scoped the refactor to **engines / system /
models / chat / proxy**. Studio, audio, and jobs were left because:

- **studio** is a thin HTTP-layer module — no internal layering to
  collapse.
- **audio** is slated for extraction per `CONTROLLER_SCOPE.md`.
- **jobs** has its own internal split (manager / orchestrator /
  workflows) that already follows the "flat layers" pattern.

These modules represent the "tail" of the controller and are the
most likely candidates for **Chapter 7 follow-up work**:

- Audio: extract to a sibling service, or guard behind a feature flag.
- Studio: the 398-LoC `routes.ts` + 388-LoC settings handling is a
  reasonable next file to break apart (settings vs diagnostics vs
  providers).
- Jobs: workflows have a single registered example
  (`voice-assistant-turn`); growth here would justify a richer
  workflow framework.
