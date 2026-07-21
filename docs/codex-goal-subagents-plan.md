# Codex parity: /goal + subagents-as-threads — findings & implementation plan

Reverse-engineered from Codex desktop (app.asar webview bundles + `codex` app-server
binary strings + live `~/.codex` data), 2026-07-21. Cross-referenced against our
codebase on `codex/litter-local-bridge`.

## Headline

Both features already exist here in first-cut form:

- `/goal` shipped in `77b36788` — `goals-store.ts` (JSON per pi session under
  `<dataDir>/goals/`), `goal-driver.ts` (continuation prompt on turn end, anti-spin,
  turn budget, `GOAL_COMPLETE`/`GOAL_BLOCKED` sentinels), composer `/goal` command,
  `session-goal-bar.tsx`.
- Subagents shipped in `86401666` — pi tool extension `subagents.ts` → headless child
  sessions (`subagent:<parent>:<id>`, max 4, no nesting) that write canonical session
  files; `subagent-chips.tsx` in the parent transcript.

The work is the delta to Codex's model, below.

## How Codex does it (confirmed by string/data evidence)

### Goals (`codex_goal_extension`, local SQLite `~/.codex/goals_1.sqlite`)

- One goal per thread: `thread_goals(thread_id PK, goal_id, objective, status,
  token_budget, tokens_used, time_used_seconds, ...)`; status enum
  `active|paused|blocked|usage_limited|budget_limited|complete`; plus a
  `thread_goal_continuation_deferrals` table ("Not now" on resume confirmation).
- No scheduler inside goals. The loop is idle-triggered: client watches
  `thread/status/changed → idle` + turn-completed and re-sends
  `thread/goal/set {status:'active'}`; the app-server injects a synthetic user turn
  from `goals/continuation.md` — objective wrapped in `<objective>` tags with an
  untrusted-data note, budget report lines, "Completion audit" (prove completion from
  current state), "Blocked audit" (only after the same blocker recurs 3 consecutive
  goal turns). Transcript labels these turns "Sent as goal".
- Token+time accounting in SQL; the usage UPDATE auto-flips to `budget_limited`.
- Model tools: `create_goal(objective, token_budget)`, `update_goal(status ∈
  complete|blocked only — pause/resume are user/system-only)`, `get_goal` (returns
  remaining budget). Guardrail: "do not infer goals from ordinary tasks".
- Composer: `/goal` enters goal mode (pill + placeholder "Describe your goal, define
  measurable outcomes for best results"); replace/resume confirmations; pause the goal
  when the user interrupts; auto-`thread/goal/clear` after `complete`.
- Long objectives/attachments are materialized to `~/.codex/attachments/<uuid>/` and
  the objective references the file ("Read the Codex goal objective file at …").
- Cadence comes from the separate Automations subsystem: `kind = "cron" | "heartbeat"`;
  a heartbeat automation (`rrule FREQ=MINUTELY;INTERVAL=10`, `target_thread_id`)
  prompts an existing goal thread on schedule. The desktop launch flow can create a
  goal + heartbeat pair at thread creation.

### Subagents (multi_agent v1/v2, "collab" tools)

- A subagent IS a thread. Child rollout `session_meta` carries
  `parent_thread_id`, `source.subagent.thread_spawn {parent_thread_id, depth,
  agent_path, agent_nickname, agent_role}`. SQLite: `threads` gains
  `thread_source/agent_nickname/agent_role/agent_path` columns plus an edge table
  `thread_spawn_edges(parent_thread_id, child_thread_id, status)`.
- Nicknames auto-assigned from a ~100-name scientist roster (Leibniz, Lovelace,
  Boole, …); role = spawn `agent_type` ("explorer", "fork", "worker", "default").
- Tools: `spawn_agent` (returns immediately with `{agent_id = child thread id,
  nickname}`; `fork_turns`/`fork_context` controls context forking; children can spawn
  their own), `send_message` (mailbox, no turn), `followup_task`, `wait_agent`
  (multi-target, "call very sparingly, do non-overlapping work while waiting"),
  `interrupt_agent`, `close_agent` (descendants cascade; completed agents count
  toward the concurrency limit until closed), `list_agents`.
- Results back to parent via three channels: `wait_agent` output;
  `<subagent_notification>{agent_path, status:{completed: <full final answer>}}`
  injected as a user message; and a `<subagents>` roster in `<environment_context>`.
- UI: (a) composer "N background agents" strip — per-child row with animated avatar,
  nickname, is working/awaiting/done, model tooltip, diff stats, click opens child as
  a normal conversation; "Stop all" stops all descendants; "@ to tag agents".
  (b) transcript `subAgentActivity` chips ("Leibniz started working… and 2 others").
  (c) child conversation header shows a parent chip; project attribution resolves via
  `parentThreadId ?? threadId`. Sidebar: children are suppressed (no unread badges,
  not listed top-level) — entry is always through the parent. Archiving the parent
  cascades to descendants.

## Our gaps and the plan

### Phase 1 — subagents as threads (the user-visible ask)

1. **Persist the spawn edge.** In `services/agent-runtime/src/subagents.ts`, on spawn
   write `{parentPiSessionId, depth, nickname, role}` into the session-metadata
   sidecar (`session-metadata-store.ts`) for the child; rebuild the in-memory
   parent→children registry from metadata on boot (today it's a restart-losing
   singleton, subagents.ts:37-42).
2. **Expose it.** Extend `SessionSummary`/`AggregatedSession`
   (`shared/agent/session-summary.ts`) + the sessions aggregation route with
   `parentPiSessionId` and `nickname`.
3. **Sidebar threads.** In `projects-nav/session-rows.tsx`: children render as
   nested, indented rows under their parent session row (collapsed by default,
   count badge on the parent), excluded from top-level lists and unread counting.
   This is where we deliberately diverge from Codex (which hides children from the
   sidebar entirely) — "subagents as threads" means visible, openable thread rows.
4. **Child session header chip** linking back to the parent (parent chip pattern from
   Codex `local-conversation-page`); opening a child is just opening a session — the
   files are already canonical.
5. **Nicknames.** Add the roster; return `{sessionId, nickname}` from the spawn tool;
   show nickname in chips + sidebar rows.
6. **Archive cascade** parent → descendants in the archive route.
7. Keep the existing `subagent` tool result flow; optionally add the
   `<subagent_notification>` push for fire-and-forget spawns later (needs a
   wait/notify split in the tool, Codex-style `wait_agent`).

### Phase 2 — /goal hardening to Codex behavior

1. **Continuation template parity** in `goal-driver.ts`: `<objective>` tagging +
   untrusted-objective note, budget report lines, completion audit, blocked only
   after 3 consecutive recurrences (we currently have simpler anti-spin).
2. **Replace sentinels with tools**: `create_goal` / `update_goal(complete|blocked
   only)` / `get_goal` via a pi tool extension (same pattern as subagents.ts);
   user/system-only pause/resume enforced server-side (Codex's
   `:external-goal-mutation` distinction).
3. **Composer goal mode**: `/goal` flips the composer into goal mode (pill +
   "Describe your goal, define measurable outcomes for best results"), replace/resume
   confirmations, pause-on-interrupt, auto-clear after complete, "Sent as goal"
   turn badge.
4. **Heartbeat automations**: add `kind: "heartbeat"` + `targetPiSessionId` to
   `automations-store.ts`/`automation-scheduler.ts` so a schedule can prompt an
   existing goal session instead of spawning a fresh headless run; wire the goal
   editor to optionally create the pair.
5. **Durable dispatch**: goal continuations + heartbeats go through
   `session.promptDurably` + the litter mutation ledger (exactly-once, crash-safe)
   instead of plain `session.prompt`.
6. Optional: token+time accounting (we count turns; Codex counts tokens/seconds and
   auto-flips `budget_limited` — we have usage data per turn to do the same), and a
   `usage_limited` status distinct from `budget_limited`.

## Order

Phase 1 first (small, mechanical, high visibility), then 2.1/2.2 (driver+tools),
then 2.3 (composer UX), then 2.4/2.5 (heartbeats + durability), 2.6 last.
