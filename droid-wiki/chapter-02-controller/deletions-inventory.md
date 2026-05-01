# Deletions inventory

84 files were deleted from `controller/`, `shared/`, and `.factory/`
between `origin/main` and `feat/plop-t3code-with-pi`. They fall into
seven groups.

## 1. Chat / agent runtime — 56 files (the headline deletion)

The entire `controller/src/modules/chat/` tree, including the in-process
pi-agent runtime. The agent now runs in the frontend / external `pi`
binary, not in the controller.

```
controller/src/modules/chat/
├── routes.ts, index.ts, configs.ts
├── chats-routes.ts, agent-files-routes.ts
├── compaction.ts
├── store.ts, store.test.ts, store-runs.ts, store-schema.ts, store-hydration.ts
├── agent-files/{helpers,index,service,store.test,types}.ts          (5 files)
└── agent/                                                           (~30 files)
    ├── chat-run-factory.ts, chat-run-factory-mock.ts
    ├── run-manager.ts, run-manager.event-order.test.ts
    ├── run-manager-{model-resolver,persistence,sse,sse.test,types,utf8,utilities}.ts
    ├── run-registry.ts, run-registry.test.ts
    ├── agent-event-handler.ts
    ├── message-mapper.ts
    ├── system-prompt-builder.ts, system-prompt-builder.test.ts
    ├── tool-circuit-breaker.ts
    ├── tool-registry.ts, tool-registry.test.ts
    ├── tool-registry-{agentfs,common,local,local.test,plan,types}.ts
    ├── stream-openai-completions-safe.ts
    ├── pi-agent-types.ts, configs.ts, contracts.ts, index.ts, model-factory.ts
```

**Why deleted**: the design moved to "the controller proxies model
calls; the agent loop runs in the client." This eliminated:

- The need to mirror chat history in the controller's SQLite.
- The need to maintain `chat-run-factory` / `chat-run-factory-mock`.
- The complex `tool-registry-{local,agentfs,plan,common}` plumbing.
- ~30 files of in-controller orchestration code.

**What replaces it**: nothing in the controller. The proxy
(`modules/proxy/openai-routes.ts`) still annotates responses with
`session_id` and `session_usage`, which the external agent can consume.
Usage data from the external agent is read back by
`modules/system/usage/pi-sessions.ts` (290 LoC, new).

**Risk to flag in PR review**:

- Loss of server-side run cancellation across processes (the
  controller no longer knows about in-flight chat runs).
- Loss of server-authoritative tool-call execution (now client-side).
- `controller/src/types/chat.ts` survives because the proxy still uses
  the message shapes — confusing leftover that should be renamed or
  scoped down.
- All chat-related HTTP endpoints (`/api/chat/*`, `/api/runs/*`,
  `/api/agent-files/*`) are gone with no deprecation period.

## 2. Lifecycle module tree — 15 files

The Phase-1/2/3 source trees that were either deleted (because their
contents moved into `engines/`, `system/`, and `models/recipes/`) or
deleted because the wrapping module disappeared:

```
controller/src/modules/lifecycle/
├── configs.ts                                ← merged into engines/configs.ts
├── index.ts, routes.ts, types.ts             ← types merged into models/types.ts
├── engines/
│   ├── index.ts                              ← module deleted
│   └── backends.test.ts                      ← test moved to engines/layers/
├── process/
│   ├── index.ts                              ← module deleted
│   └── process-utilities.test.ts             ← test moved to engines/layers/
├── routes/
│   ├── index.ts                              ← composition file deleted
│   ├── lifecycle-routes.ts                   ← endpoints moved into engines/routes.ts
│   ├── runtime-routes.ts                     ← endpoints moved into engines/routes.ts
│   ├── system-gpus-amd.test.ts               ← moved to system/platform/
│   └── system-routes.test.ts                 ← moved to system/routes.test.ts
├── runtime/
│   ├── configs.ts, index.ts                  ← module deleted
│   └── runtime-upgrade.ts                    ← simplified into engines/layers/runtime-upgrade.ts
└── state/
    ├── index.ts                              ← module deleted
    ├── lifecycle-coordinator.ts              ← REPLACED by engines/layers/engine-coordinator.ts
    └── lifecycle-coordinator.test.ts         ← replaced by engine-coordinator.test.ts
```

The "renames" (`R09x` in git diff) for the surviving files:
`process-manager.ts`, `process-utilities.ts`, `runtime-info.ts`,
`vllm-runtime.ts`, `llamacpp-runtime.ts`, `vllm-python-path.ts`,
`launch-state.ts`, `backends.ts → backend-builder.ts` all moved into
`engines/layers/`. Recipe files moved into `models/recipes/`. Platform,
metrics, monitoring files moved into `system/`.

## 3. Downloads module tree — 4 files

```
controller/src/modules/downloads/
├── configs.ts             ← merged into engines/configs.ts
├── index.ts               ← module dissolved
├── routes.ts              ← endpoints moved into engines/routes.ts
└── types.ts               ← types absorbed where consumed
```

Renamed survivors: `download-globs.ts`, `download-math.ts`,
`download-paths.ts`, `download-store.ts → download-store.ts`,
`huggingface-api.ts`, `manager.ts → download-manager.ts`. All under
`engines/layers/`.

## 4. Monitoring module tree — 2 files

```
controller/src/modules/monitoring/
├── routes.ts              ← composition file deleted (replaced by system/routes.ts)
└── usage-routes.ts        ← deleted, replaced by system/usage-routes.ts (38-LoC shim)
```

Everything else in `monitoring/` was renamed into `system/`.

## 5. Proxy module — 1 file (the big one)

```
controller/src/modules/proxy/tool-call-core.ts   (863 LoC)
```

Replaced by the four-file split (Phase 5):

- `tool-call-parser.ts` (181 LoC)
- `tool-call-stream.ts` (423 LoC)
- `reasoning-extractor.ts` (159 LoC)
- `content-normalizer.ts` (70 LoC)

Total of replacement: 833 LoC across four focused files.

`proxy/proxy-parsers.ts` is **renamed** to `core/utf8.ts` (not deleted).

## 6. `shared/` workspace package — 4 files

The whole top-level workspace package was dissolved:

```
shared/
├── README.md
├── src/agent.ts          ← chat agent types — deleted (chat module gone)
├── src/downloads.ts      ← types now in modules/shared/recipe-types.ts
└── src/index.ts          ← barrel — gone
```

The four files that survived the dissolution moved to
`controller/src/modules/shared/`:

- `controller-events.ts` (`shared/src/controller-events.ts → modules/shared/controller-events.ts`)
- `recipe-types.ts` (was `shared/src/recipe.ts`)
- `state-machine.ts` (unchanged, generic FSM helper — possible C7 deletion candidate; nothing on this branch uses it)
- `system-types.ts` (was `shared/src/system.ts`)

**Why this is risky**: the dissolution removes the type-sharing
contract between controller and frontend that the workspace package
provided. The frontend now must either copy the types or import them
through a different path. **Verify in Chapter 4 (frontend) how the
frontend now obtains these types.**

## 7. Controller scripts and `.factory/` — 5 files

```
controller/scripts/
├── delete-test-chat-sessions.ts          ← chat module gone
├── retitle-chats.ts                      ← chat module gone
└── utilities/compare-controllers.ts      ← dev tool, removed

controller/src/http/security-middleware.test.ts   ← TEST DELETED
                                                  ← (implementation file remains)

.factory/
├── security-config.json                  (23 lines)   ← security policy
└── threat-model.md                       (600 lines)  ← STRIDE threat model
```

**`.factory/` deletions are the most concerning items in this group**:

- `security-config.json` and `threat-model.md` represented the
  documented threat model and security configuration for the
  controller. Removing them without replacement is a posture
  regression that should be flagged in the PR review (**Chapter 7**).
- `security-middleware.test.ts` deletion is doubly concerning: the
  middleware code remains, but its tests are gone. This means
  the security middleware has **no test coverage on this branch**.

## Summary table

| Group                     | Count | Net LoC removed |
|---------------------------|------:|----------------:|
| Chat / agent runtime      |    56 | ~5,666 |
| Lifecycle module tree     |    15 | ~1,000 (most renamed; deletions are wrapper files) |
| Downloads module tree     |     4 | ~50    (most renamed; deletions are wrapper files) |
| Monitoring module tree    |     2 | ~50    (most renamed; deletions are wrapper files) |
| Proxy `tool-call-core.ts` |     1 |    863 (replaced by 4 files of ~833 LoC) |
| `shared/` workspace pkg   |     4 | ~100   (most renamed into `modules/shared/`) |
| Scripts & `.factory/`     |     5 |  ~700  (mostly the threat model) |
| **Total**                 |   **84** | **~10,011 deletions in the diff** |

Note: the deletion counts match `git diff --stat` output of −10,011
because the rename detector produced rename pairs for ~50 of the
moved files. The "true" deletions (no rename target) account for the
biggest user-facing impact: the chat tree, the threat model, and the
security middleware test file.
