# PR Review: `feat/plop-t3code-with-pi`

> A book-length, code-grounded review of the largest single change set in vLLM Studio's history.

| Metric | Value |
|---|---|
| **Branch** | `feat/plop-t3code-with-pi` |
| **Base** | `origin/main` (`1205004e`) |
| **HEAD** | `7e40ffd9` |
| **Commits** | 67 |
| **Files changed** | 485 |
| **Insertions** | +32,332 |
| **Deletions** | −43,997 |
| **Net** | **−11,665 LoC** |
| **Added files** | 62 |
| **Deleted files** | 290 |
| **Modified files** | 83 |
| **Renamed files** | 50 |

## What this PR is

A two-part transformation:

1. **A massive cleanup** — the entire bespoke chat module (controller `chat/agent/*` + frontend `app/chat/*`) is deleted in favor of delegating all coding-agent behavior to an out-of-process `pi` binary from [`badlogic/pi-mono`](https://github.com/badlogic/pi-mono). The "shared" workspace package is dissolved into the controller. The legacy frontend `chat/` surface (159 files) is replaced by a new `agent/` surface ported from [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code).
2. **A controller refactor** completed across 5 phases — `lifecycle/` + `downloads/` are merged into a new `engines/` module fronted by a `EngineService` interface and a state-machine coordinator; `monitoring/` + `lifecycle/platform/` + `lifecycle/metrics/` are merged into `system/`; `lifecycle/recipes/` moves into `models/`; the chat module is internally restructured; `proxy/tool-call-core.ts` (863 lines) is split into 4 focused files. See [MIGRATION.md](../../MIGRATION.md) for the per-phase log.

The result is a smaller, flatter, more layered codebase that aligns the product with its declared scope (`scope.md`, `CONTROLLER_SCOPE.md`): a local orchestrator for vLLM/SGLang/llama.cpp that proxies OpenAI traffic, fronted by a Next.js + Electron desktop UI that delegates coding-agent semantics to `pi`.

## How to read this book

Each chapter has an `index.md` (chapter overview) and several deeply-researched topic pages. Pages link extensively to source paths and to the diff stats they're derived from. Recommended reading order:

1. [Chapter 1 — Frontend](../chapter-01-frontend/index.md)
2. [Chapter 2 — Controller](../chapter-02-controller/index.md)
3. [Chapter 3 — CLI](../chapter-03-cli/index.md)
4. [Chapter 4 — Anything Else](../chapter-04-anything-else/index.md)
5. [Chapter 5 — Patterns We're Using](../chapter-05-patterns/index.md)
6. [Chapter 6 — Areas of Complexity](../chapter-06-complexity/index.md)
7. [Chapter 7 — Files We Need to Improve](../chapter-07-files-to-improve/index.md)
8. [Chapter 8 — Things We Can Merge](../chapter-08-merge-opportunities/index.md)

Reference material (raw diff inventories, glossary, comparison with `pi-mono` and `t3code`) lives under [`reference/`](../reference/index.md).
