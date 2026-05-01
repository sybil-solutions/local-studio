# Deletions inventory

This PR deletes the entire legacy chat surface (159 files) plus several
chat-only modules under `frontend/src/lib/`, `frontend/src/store/`, and
`frontend/src/components/shared/`. It also drops every Playwright spec.
Everything below is verified against `git diff --name-status origin/main...HEAD`.

## Top-level pages

| Path | What it was | Replacement |
| ---- | ----------- | ----------- |
| `frontend/src/app/chat/page.tsx` | Default `/chat` page wired through the run-machine. | `app/agent/page.tsx`. |
| `frontend/src/app/chat2/page.tsx` | Orphan / WIP variant of the chat page. | None — redundant. |
| `frontend/src/app/api/title/route.ts` | Generated chat titles via the proxy. | None — agent UI derives titles from the first user message. |

## `chat/_components/agent/*` (file viewer / drawers)

| Deleted file | What it was |
| ------------ | ----------- |
| `agent-file-content-viewer.tsx` | Full agent file viewer. |
| `agent-file-content-viewer/mermaid-diagram.tsx` | Mermaid renderer for file viewer. |
| `agent-file-metadata.ts` | Metadata helpers. |
| `agent-file-previewer.ts` | Preview helpers. |
| `agent-files-panel.tsx` | Side panel listing agent-touched files. |
| `agent-files-tree.tsx` | Tree of agent file changes. |
| `agent-plan-drawer.tsx` | The "plan" drawer. |
| `agent-types.ts` | Shared TS types. |
| `index.ts` | Barrel. |

Replacement: `<FilesystemPanel>` in `app/agent/_components/filesystem-panel.tsx`
(548 lines). It is not feature-equivalent — it shows the project filesystem
not just agent-touched files, and it has its own per-line comments rather
than a "plan".

## `chat/_components/artifacts/*`

| Deleted file | What it was |
| ------------ | ----------- |
| `artifact-modal.tsx`, `artifact-preview-panel.tsx`, `artifact-preview-panel/components.tsx`, `artifact-renderer.tsx`, `artifact-templates.ts`, `artifact-viewer-content.tsx`, `artifact-viewer.tsx`, `artifact-viewer/use-artifact-drag.ts`, `mini-artifact-card.tsx`, `index.ts` | The whole artifact subsystem (modal, draggable preview panel, renderer, templates, mini cards). |

Replacement: none. The agent surface does not implement artifacts. (HTML/JSX
preview lives only inside the FilesystemPanel for files matching
`.html|.svg|.jsx|.tsx`.)

## `chat/_components/code/*`

| Deleted file | What it was |
| ------------ | ----------- |
| `code-preview.tsx` | Live preview of code blocks. |
| `enhanced-code-block.tsx` | The fancy syntax-highlighted code block with copy button, line numbers, languages. |
| `index.ts` | Barrel. |

Replacement: a much smaller `<AssistantMarkdown>` (`assistant-markdown.tsx`,
155 lines) using `react-markdown` + `rehype-highlight` with an inline copy
button.

## `chat/_components/computer-viewport/*`

| Deleted file | What it was |
| ------------ | ----------- |
| `agent-file-preview.tsx`, `browser-view.tsx`, `computer-embedded-browser.tsx`, `computer-viewport.tsx`, `file-view.tsx`, `index.ts`, `terminal-view.tsx`, `todo-view.tsx` | The legacy "computer" viewport (browser + files + terminal + todos). |

Replacement: a much simpler "Computer" right-pane in `<AgentWorkspace>` with
just two tabs (Browser, Files). The terminal was added then removed (commit
`3df8d7e1` followed by `671e3b18`).

## `chat/_components/input/*` (composer)

| Deleted file | What it was |
| ------------ | ----------- |
| `attachments-preview.tsx`, `call-mode-indicator.tsx`, `recording-indicator.tsx`, `transcription-status.tsx` | Voice / call-mode / transcription UI. |
| `tool-belt.tsx`, `tool-belt-toolbar.tsx`, `tool-belt-toolbar/*`, `tool-belt/*`, `tool-dropdown.tsx`, `index.ts` | The tool belt (the old composer toolbar with attachments, call mode, voice, autosize textarea hooks). |

Replacement: composer is now inlined in `<ChatPane>` (`chat-pane.tsx`,
within ~250 lines of the textarea + paperclip + globe + send). Voice / call
mode / transcription are gone.

## `chat/_components/layout/chat-page/*` (page controller)

A multi-level controller: page-state, lifecycle, events, timers, run-stream,
session bootstrap, title generator, sidebar controller, run-status, action
hooks. All deleted.

Specifically:

- `chat-page.tsx`, `chat-export.ts`, `chat-run-stream.ts`,
  `chat-send-user-message.ts`, `chat-session-bootstrap.ts(+test)`,
  `run-system-prompt.ts`, `stream-timeouts.ts`.
- Controller subtree: `controller/chat-sidebar-controller.ts(+test)`,
  `controller/internal/actions/use-chat-export-actions.ts`,
  `use-chat-run-actions.ts`, `use-chat-ui-actions.tsx`,
  `controller/internal/run-status.ts(+test)`,
  `controller/internal/types/controller-types.ts`,
  `use-chat-page-controller-tail.tsx(+types)`,
  `use-chat-page-lifecycle.ts`, `use-chat-page-store.ts`,
  `use-chat-title-generator.ts`, `use-chat-tool-belt.tsx`,
  `use-stream-error-toast.ts`, `use-thinking-snippet.ts`,
  `last-session-id.ts`, `use-chat-page-controller.tsx`,
  `use-chat-page-events.ts`, `use-chat-page-timers.ts`.
- View subtree: `view/chat-page-view.tsx`,
  `view/chat-page-view/sidebar-contents.tsx`,
  `view/chat-page-view/sidebar-contents-from-page-props.tsx`,
  `view/chat-page-view/types.ts`.

Replacement: the new agent surface has no equivalent of this controller.
Streaming + abort + replay are inlined into `<ChatPane>`; project /
sessions / models live in dedicated stores; titles are derived from the
first user message.

## `chat/_components/layout/page/*`

`chat-action-buttons.tsx`, `chat-conversation.tsx`, `chat-modals.tsx`,
`chat-splash-canvas.tsx` (+ `splash-draw.ts` + `splash-geometry.ts`),
`chat-top-controls.tsx`. All deleted.

Replacement: chat conversation rendering is inside `<TimelineMessage>` in
`chat-pane.tsx`. The splash canvas (a particle/geometry effect) has no
replacement — agent surface uses a plain text empty state.

## `chat/_components/layout/sidebar/*` (unified sidebar)

| Deleted file | What it was |
| ------------ | ----------- |
| `chat-side-panel.tsx`, `chat-side-panel-context.tsx` | Side panel container + context. |
| `chat-side-panel/activity-panel.tsx`, `browser-panel.tsx`, `chat-history-dock.tsx`, `chat-history-panel.tsx`, `thinking-item.tsx`, `tool-categorization.ts`, `tool-item.tsx`, `turn-group.tsx`, `workspace-panel.tsx` | Activity / browser / chat-history / thinking / tools / turns / workspace panels. |
| `chat-toolbelt-dock.tsx`, `mobile-chat-history-drawer.tsx`, `mobile-results-drawer.tsx`, `unified-sidebar.tsx`, `unified-sidebar/panel-registry.ts`, `unified-sidebar/sidebar-pane.tsx`, `unified-sidebar/tab-button.tsx`, `unified-sidebar/types.ts` | The chat-specific unified sidebar plus mobile drawers. |

Replacement: the agent surface uses the global `<LeftSidebar>` plus a new
`<ProjectsNavSection>` (515 lines, `frontend/src/components/projects-nav-section.tsx`).
Sessions/turns are surfaced inside the project rows. The mobile drawers are
gone.

## `chat/_components/messages/*` and `modals/*`

| Deleted file | What it was |
| ------------ | ----------- |
| `chat-message-item.tsx`, `chat-message-item/chat-message-item.tsx`, `thinking-block.tsx`, `tool-call-row.tsx`, `use-message-derived.ts`, `user-message.tsx`, `chat-message-list.tsx`, `chat-message-list/agent-file-chips.ts`, `visible-messages.ts`, `index.ts`, `message-renderer.tsx`, `referenced-agent-file-previews.tsx`, `referenced-agent-paths.ts` | Message list, item, thinking block, tool-call row, file chips, message-derived hook, message renderer, referenced agent paths. |
| `modals/chat-settings-modal.tsx`, `modals/export-modal.tsx`, `modals/usage-modal.tsx`, `modals/index.ts` | Chat settings, export, usage modals. |

Replacement: `<TimelineMessage>` inside `chat-pane.tsx` handles user/
assistant rendering with `thinking` and `tool` blocks; modals are gone (the
agent surface has no settings/export/usage modal — usage moved to the
top-level Usage page).

## `chat/_components/perf/perf-profiler.tsx`

A dev-only profiler component. No replacement.

## `chat/hooks/*` (entire directory)

Removed:

- `agent/use-agent-files.ts(+ subtree)` (`prefetch-dependencies.ts`,
  `resolve-session-id.ts`, `use-agent-files-store.ts`).
- `agent/use-agent-state.ts`.
- `chat/use-chat-artifacts.ts`, `use-chat-compaction.ts(+ types)`,
  `use-chat-context.ts`, `use-chat-derived.ts(+ build-activity-groups.ts)`,
  `use-chat-message-mapping.ts(+ helpers.ts)`, `use-chat-messages.ts`,
  `use-chat-scroll.ts`, `use-chat-sessions.ts`, `use-chat-tool-results.ts`,
  `use-chat-tools.ts`, `use-chat-usage.ts`, `use-current-tool-call.ts`,
  `index.ts`.
- `run/use-available-models.ts`, `run/use-run-event-handler/types.ts`.
- `ui/use-raf-throttle.ts`.

The `chat/types.ts` file plus `chat/utils/*` (`agent-system-prompt.ts`,
`chat-attachments.ts`, `html-dependency-parser.ts`, `index.ts`,
`path-resolver.ts`) were also removed.

Replacement: per-tab state lives in `<ChatPane>` directly; sessions are
fetched on demand from `/api/agent/sessions`; usage is computed inline in
`usageFromEvent`.

## `lib/services/message-parsing/*`

Whole module removed:

- `context.tsx`, `factory.ts`, `hooks.ts`, `index.ts`,
  `internal/service-helpers.ts`, `service.ts`, `types.ts`.
- Parsers: `parsers/artifacts.parser.ts`, `box-tags.parser.ts`,
  `index.ts`, `markdown.parser.ts`, `thinking.parser.ts`.

Replacement: pi already emits structured text/thinking/tool deltas — there's
no need for any parser pipeline. `react-markdown` does the markdown
rendering inside `<AssistantMarkdown>`.

## `lib/systems/run-machine/*` and `lib/systems/tools/*`

Removed:

- `run-machine/index.ts`, `run-effects.ts`, `run-machine.ts(+test)`,
  `types.ts`, `use-run-machine.ts`.
- `tools/tool-tracker.ts(+test)`.

Replacement: the per-turn state machine collapsed into the streaming reducer
inside `<ChatPane>`. There is no longer a generic run machine.

## `lib/types/chat/*`

`agent.ts`, `artifacts.ts`, `chat.ts`. Replaced by inline types in
`chat-pane.tsx` and (for tools) the pi event types from
`@mariozechner/pi-coding-agent`.

## `lib/api/chats.ts`

The legacy `/chats` API client. Replaced by the direct `fetch` calls inside
`<ChatPane>` and `<AgentWorkspace>`.

## `components/shared/*`

Removed (5 files):

- `change-indicator.tsx`
- `config-row.tsx`
- `index.ts`
- `page-state.tsx`
- `refresh-button.tsx`
- `toast-stack.tsx`

The shared components used by the deleted chat module had no other consumers
that could justify them as standalone helpers. The dashboard pages now
import their own `RefreshButton` / `PageState` from `@/ui` (a separate
ui-kit barrel that survived).

## `hooks/use-stop-model.ts`

Replaced by `hooks/use-model-lifecycle.ts` which now exposes both `start`
and `stop` (plus `status` and `activeRecipeId`). All consumers were
migrated; the duplicate "stop in sidebar" hook was removed in commit
`94863760`.

## Tests

`frontend/tests/` was entirely removed. Specifically:

- `tests/README.md`
- `tests/chat-agent-files-proof.spec.ts`
- `tests/constants.ts`
- `tests/discover-quant-vram-proof.spec.ts`
- `tests/rocm-dashboard-platform.spec.ts`
- `tests/voice-call-mode-proof.spec.ts`

Replacement: there is no Playwright suite at HEAD. New unit tests live next
to their sources (`*.test.ts` colocated): `chat-pane.test.ts`, `models.test.ts`,
`use-model-lifecycle.test.ts`, `normalize-usage-stats.test.ts`,
`api/proxy/[...path]/route.test.ts`. The `package.json` retains the
`test:integration` Playwright script but there are no specs to run.

## Store deletions

Removed `frontend/src/store/`:

- `chat-slice-defaults.ts` (27 lines)
- `chat-slice-types.ts` (248 lines)
- `chat-slice.ts` (191 lines)
- `chat-slice/agent-actions.ts` (88 lines)
- `chat-slice/artifact-actions.ts` (90 lines)
- `chat-slice/initial-chat-state.ts` (93 lines)
- `chat-slice/toast-actions.ts` (44 lines)

Replacement: the agent surface keeps state inside React (per-pane
`<AgentWorkspace>` state, per-tab `SessionTab`). The remaining zustand store
is generic UI state (theme, sidebar pinned state).

## Styles

`frontend/src/app/styles/globals/themes.css` deleted; theme tokens inlined
into `globals.css` and `base.css` (modified). See
[modifications-inventory.md](./modifications-inventory.md).
