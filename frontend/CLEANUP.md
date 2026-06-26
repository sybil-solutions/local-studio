# Cleanup Log — zcode-clone branch

This branch repainted the entire Local Studio frontend to the ZCode design
language, adopted Effect-TS for the session/runtime layer, fixed model-search
bugs, consolidated duplicated types, moved misplaced components, and reduced all
complexity warnings to zero.

**73 files changed · +2846 / −2911 · 21 commits**

---

## 1. Design language — ZCode repaint

Ported the full ZCode/ZAI token system from the ZCode desktop app's bundled
CSS into `src/app/styles/globals/tokens.css`:

- **Neutral grayscale base** + single **sky-blue brand** accent
- **Rich semantic surface layer**: `--color-surface/card/popover/sidebar/
header/panel/border/hover/selected/tab/menu/input/tooltip/toast/tag`
- **Domain tokens** (local-studio lacked most): terminal 16-color palette,
  usage-chart (6 colors), usage-heatmap (5-step sky ramp), git/diff,
  context-breakdown, and a **node taxonomy** (command/file/session/skill/
  subagent) used to color-code engines, tools, and sessions
- Legacy `--ui-*` adapter layer + shadcn aliases repointed so existing
  components re-skin without class-name changes
- Theme catalog shrunk **77 → 6** themes (zai-dark/light + sky/violet/
  emerald/rose accents)

### Per-page repaints

| Page                                             | Changes                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Shell / sidebar**                              | ZCode flat `--color-sidebar` rail, sky left-edge active indicator, node-color nav sections                      |
| **Dashboard**                                    | Original `StatusSection → GpuSection → ActivityStrip` (metric cards + heatmap reverted per user request)        |
| **Models (recipes)**                             | Engine badges via node taxonomy, pill tabs on `--color-tab`, left-nav sky indicator                             |
| **Server**                                       | Rebuilt from a logs clone into a status console (connection/runtime/backends/process/services + log/docs panel) |
| **Agent chat**                                   | xterm terminal reads `--color-terminal-*` palette, tool verbs colored by node taxonomy                          |
| **Sessions / settings / usage / logs / plugins** | Hardcoded hex/tailwind colors → semantic tokens                                                                 |

---

## 2. Effect-TS adoption

### Installed

- `effect` 3.21, `@effect/schema` 0.75

### Migrated to Effect

| Module                          | Before                                                | After                                                      |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `runtime-schema.ts`             | Raw JSON.parse cast                                   | `@effect/schema` validates SSE payloads at the boundary    |
| `effect-coalescer.ts`           | Hand-rolled rAF-batched Map                           | Per-session Effect fiber on animation-frame clock          |
| `prompt-stream.ts`              | try/catch + manual fallback probe                     | `Effect.gen` + `Effect.tryPromise` + `Effect.catchAll`     |
| `use-controller-events.ts`      | `setTimeout` exponential backoff                      | `Effect.sleep` on a tracked interruptible `Fiber`          |
| `realtime-status-store.ts`      | `setInterval` poll loop                               | `Effect.repeat(Schedule.spaced)` fiber                     |
| `session-runtime-controller.ts` | 3x setInterval/setTimeout (poll, watchdog, reconnect) | All three -> Effect fibers on Schedule.spaced/Effect.sleep |
| `use-downloads.ts`              | setInterval poll                                      | effectInterval (via effect-timers.ts)                      |
| `use-huggingface-model-search`  | setTimeout debounce                                   | effectTimeout                                              |
| `use-dashboard-recipes.ts`      | setInterval log poll                                  | effectInterval                                             |
| `engines-section.tsx`           | setInterval job poll + 2x setTimeout idle resets      | effectInterval + effectTimeout                             |
| `plugins-page.tsx`              | setTimeout registry search debounce                   | effectTimeout                                              |
| `agent-browser-screencast.tsx`  | Recursive window.setTimeout poll + viewport debounce  | effectTimeout                                              |
| `use-setup.ts`                  | Promise+setTimeout sleep + race timeout               | Effect.sleep + Effect.timeout                              |

The controller's imperative public API (`bind`/`reconcile`/
`noteTurnAccepted`/`flush`/`pollNow`/`closeAll`) is unchanged — React's
commit-driven push model is preserved exactly.

---

## 3. Model search fixes

| Fix                                                                                       | File                              |
| ----------------------------------------------------------------------------------------- | --------------------------------- |
| Search ranking respects HF relevance order (was discarded by likes→downloads re-sort)     | `use-explore.ts`                  |
| VRAM-tier interleaving only in browse mode, not search mode                               | `use-explore.ts`                  |
| Browse-mode pagination bug (`hasMore` false when recency filter empties a page)           | `use-huggingface-model-search.ts` |
| Discover task+library filter overwrite (library silently cancelled task)                  | `use-discover.ts`                 |
| Route allowlist expanded (8→11 params: added `tags`, `pipeline_tag`, `config`)            | `api/huggingface/models/route.ts` |
| Explore tab gets Task/Library/Sort dropdowns (was just a search box)                      | `explore-tab-sections.tsx`        |
| Recency constants unified (6mo vs 120d disagreement)                                      | `explore-eligibility.ts`          |
| Avatar logos proxy image bytes instead of 307 redirect (cross-origin blocked in Electron) | `api/huggingface/avatar/route.ts` |
| Avatar resolution cached in-process (6h hit / 30m miss) — was 100 HF calls per render     | `api/huggingface/avatar/route.ts` |

---

## 4. Layout standardization

Models page (`recipes-content-view.tsx`) was the outlier — hand-rolled
172px grid, custom nav buttons, border-b header, `--bg/--fg` tokens. Now
renders through the shared `SettingsLayout` like Plugins and Settings:
200px sidebar, `max-w-5xl`, `SectionNav`, `PageHeader`, `--ui-*` tokens.

---

## 5. Type deduplication — single source of truth

| Type                                              | Copies removed                            | Canonical source                                         |
| ------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| `GitSummary`                                      | 5 local copies                            | `projects/types.ts` (`branch` made optional)             |
| `LoadedContextKind`                               | 3 inline literals                         | `agent-composer-context.tsx`                             |
| `UpdateSession`                                   | 2 identical fn types                      | `runtime/types.ts`                                       |
| `AggregatedSession` / `ActiveSession`             | 3 mirrored copies                         | New `session-contracts.ts` module                        |
| `SessionSortField`                                | Renamed (collided with usage `SortField`) | `session-contracts.ts`                                   |
| `RuntimeContextUsage`                             | 5 copies                                  | Effect-schema-derived type in `runtime-schema.ts`        |
| `PiContextUsage`                                  | Re-export alias of `RuntimeContextUsage`  | `pi-runtime-types.ts`                                    |
| `McpServer` / `CatalogueEntry` / `RegistrySource` | Full duplicate definitions                | `plugins-types.ts` re-exports from canonical MCP modules |

---

## 6. UI-kit consolidation

| Component          | Moved from → to                            | Reason                                  |
| ------------------ | ------------------------------------------ | --------------------------------------- |
| `CopyablePathChip` | `features/agent/ui/` → `src/ui/`           | Pure presentation, exported from barrel |
| `useClickOutside`  | `features/agent/hooks/` → `src/hooks/`     | Generic DOM utility                     |
| `extractProvider`  | `discover/utils.ts` → `lib/huggingface.ts` | HF parsing, cross-feature consumer      |

---

## 7. Complexity reduction — all warnings to zero

| Function                           | Before | After    | Technique                                                                            |
| ---------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------ |
| `ServerPage`                       | 35     | <10 each | Split into 12 sub-components                                                         |
| `terminal boot()`                  | 33     | <10      | Extracted `buildTerminalTheme()`, `resolveTerminalFont()`, `loadWebLinksAddon()`     |
| `RecipeModalTabModel`              | 24     | <10      | Split into ContextSection, WeightsSection, AdvancedLoadingFields, QuantizationFields |
| `RecipeModalTabPerformance`        | 23     | <10      | Split into KvCacheSection, SchedulerSection                                          |
| `RecipeModalTabResources`          | 23     | <10      | Split into ParallelismSection, GpuSection                                            |
| `RecipeModalTabFeatures`           | 22     | <10      | Split into ToolCallingSection, ReasoningSection, ChatTemplatesSection                |
| `normalizeSdkMessageTimestamps...` | 23     | <10      | Extracted per-message loop body into `normalizeOneMessageTimestamp()`                |

---

## 8. Dead code removal

- Deleted legacy `text-delta-coalescer.ts` (superseded by `effect-coalescer.ts`)
- Removed unused `@effect/platform` dependency (only `effect` + `@effect/schema` used)

---

## 9. Quality gate status

```
✅ 0 errors
✅ 0 warnings (was 7 complexity + 3 duplicate-import)
✅ 0 circular dependencies (402 files processed)
✅ 0 duplicate code clones (jscpd)
✅ 0 dead code (knip)
✅ typecheck passes (tsc --noEmit)
✅ build succeeds (next build --webpack)
```
