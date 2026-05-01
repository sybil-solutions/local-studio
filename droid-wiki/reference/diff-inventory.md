# Raw diff inventory

The numbers and inventories underpinning every chapter.

## Top-line totals

```
git diff --shortstat origin/main...HEAD
485 files changed, 32332 insertions(+), 43997 deletions(-)
```

## File-mode breakdown

| Mode | Count |
|---|--:|
| Added (`A`) | 62 |
| Deleted (`D`) | 290 |
| Modified (`M`) | 83 |
| Renamed (`R`) | 50 |
| **Total** | **485** |

## Per-top-level-dir totals

```
git diff --stat origin/main...HEAD -- frontend/**
282 files changed, 7,420 insertions(+), 22,934 deletions(-)
```

```
git diff --stat origin/main...HEAD -- controller/**
169 files changed, 4,500 insertions(+), 9,863 deletions(-)
```

```
git diff --stat origin/main...HEAD -- cli/**
2 files changed, 9 insertions(+), 2 deletions(-)
```

```
git diff --stat origin/main...HEAD -- shared/**
8 files changed, 0 insertions(+), 495 deletions(-)
```

```
git diff --stat origin/main...HEAD -- frontend/desktop/**
10 files changed, 382 insertions(+), 14 deletions(-)
```

`frontend/**` totals include `frontend/desktop/**`. Deletions in `frontend/` are dominated by the deleted `frontend/src/app/chat/` tree (~159 files) and `frontend/src/store/chat-slice/**`, `frontend/src/lib/services/message-parsing/**`, `frontend/src/lib/systems/run-machine/**`, `frontend/tests/**`.

## Where additions concentrate

| Path | Additions |
|---|--:|
| `controller/src/modules/engines/layers/engine-coordinator.ts` | New (~578 LoC) |
| `controller/src/modules/engines/routes.ts` | New (~327 LoC) |
| `controller/src/modules/engines/layers/download-machine.ts` | New (~290 LoC) |
| `controller/src/modules/proxy/tool-call-stream.ts` | New (~423 LoC) |
| `controller/src/modules/proxy/reasoning-extractor.ts` | New (~6 KB) |
| `controller/src/modules/proxy/content-normalizer.ts` | New (~2 KB) |
| `controller/src/modules/proxy/tool-call-parser.ts` | New (~5 KB) |
| `controller/src/modules/system/usage/pi-sessions.ts` | New |
| `frontend/src/app/agent/_components/agent-workspace.tsx` | New (1,145 LoC) |
| `frontend/src/app/agent/_components/chat-pane.tsx` | New (1,231 LoC) |
| `frontend/src/app/agent/_components/filesystem-panel.tsx` | New (547 LoC) |
| `frontend/src/lib/agent/pi-runtime.ts` | New (444 LoC) |
| `frontend/src/components/projects-nav-section.tsx` | New (516 LoC) |
| `frontend/desktop/resources/pi-extensions/browser.ts` | New (139 LoC) |
| `frontend/desktop/logic/projects-store.ts` | New |
| `MIGRATION.md` | New (~146 LoC) |
| `plan.md` | New (~360 LoC) |
| `scope.md` | New (~464 LoC) |

## Where deletions concentrate

| Area | Files removed |
|---|--:|
| `controller/src/modules/chat/agent/**` (in-controller pi agent) | ~30 |
| `controller/src/modules/chat/agent-files/**` | 5 |
| `controller/src/modules/chat/store-*.ts` + `routes.ts` + `index.ts` | ~10 |
| `controller/src/modules/lifecycle/**` | ~25 (most renamed; some deleted) |
| `controller/src/modules/downloads/**` | ~10 (renamed into engines) |
| `controller/src/modules/monitoring/**` | ~10 (renamed into system) |
| `controller/scripts/**` | 3 |
| `controller/src/http/security-middleware.test.ts` | 1 |
| `frontend/src/app/chat/**` | ~159 |
| `frontend/src/store/chat-slice*` | ~7 |
| `frontend/src/lib/services/message-parsing/**` | ~13 |
| `frontend/src/lib/systems/run-machine/**` | 5 |
| `frontend/src/lib/types/chat/**` | 3 |
| `frontend/src/components/shared/**` | 5 |
| `frontend/src/hooks/use-stop-model.ts` | 1 |
| `frontend/src/app/api/title/route.ts` | 1 |
| `frontend/tests/**` (Playwright) | 6 |
| `shared/**` | 8 (entire workspace package) |
| `.factory/threat-model.md` + `security-config.json` | 2 |

## Renames

50 files were renamed (mostly the `lifecycle/*` -> `engines/layers/*`, `monitoring/*` -> `system/*`, `lifecycle/recipes/*` -> `models/recipes/*`, `shared/*` -> `controller/src/modules/shared/*` migrations from MIGRATION.md).

## Cross-references

- The full file-mode list of every changed path is preserved at `/tmp/pr-namestatus.txt` if reproducing.
- See [commit log](commit-log.md) for the 67-commit annotated history.
