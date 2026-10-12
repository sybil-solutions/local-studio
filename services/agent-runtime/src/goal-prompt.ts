//
// Server-side session-goal injection.
//
// `/goal <objective>` stores an objective per pi session; goal-driver.ts
// re-prompts the agent whenever it settles. But on a turn the user types
// themselves the model never saw the objective, so the goal only nudged the
// session between turns instead of steering it.
//
// The old fix was a bundled pi extension (goal.ts) that read the goal off disk
// inside `before_agent_start`. It relied on `ctx.sessionManager.getSessionId()`
// to key the read — but extensions bind over RPC and that id does NOT match the
// canonical piSessionId the goal store is keyed by (a live breadcrumb showed a
// different id on every before_agent_start, so the goal was always null and the
// section never reached the model).
//
// This module moves the injection in-process. pi-runtime registers the factory
// below as an `extensionFactories` entry on the session's resource loader; the
// closure captures the runtime's own SessionManager, so it reads the goal with
// the SAME canonical piSessionId the store writes. `before_agent_start` fires
// once per prompt (SDK: agent-session.js emits it in _prompt, and the returned
// systemPrompt overrides that turn only), so reading the goal live inside the
// handler picks up mid-session edits and budget/turn changes.
//

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveDataDir } from "./data-dir";

const MARKER = "Local Studio session goal:";

/** The one status where the goal steers the turn. Every other status stays in
 *  the store (so the UI can show and resume it) but must not keep pushing the
 *  model — including `budget_limited`, which used to keep injecting "the budget
 *  is spent, do not start new work" into every later turn the USER typed, long
 *  after the automatic pursuit had stopped. */
const STEERING_STATUSES = new Set(["active"]);

/** Loose shape: the on-disk goal is normalized elsewhere, but the pure builder
 *  must tolerate partial/legacy documents so a bad field never crashes a turn. */
export type GoalPromptInput = {
  objective?: unknown;
  status?: unknown;
  turnBudget?: unknown;
  turnsUsed?: unknown;
};

/** Codex wraps the objective in tags and states plainly that it is instruction,
 *  not data, then reports budget so the model can pace itself.
 *
 *  This is the only copy. A second, byte-identical builder used to sit in
 *  frontend/desktop/resources/pi-extensions/goal.ts from when injection was a
 *  bundled extension; it was registered nowhere and could only drift. */
export function goalSystemPromptSection(goal: GoalPromptInput): string | null {
  const objective = typeof goal.objective === "string" ? goal.objective.trim() : "";
  if (!objective) return null;
  const status = typeof goal.status === "string" ? goal.status : "active";
  if (!STEERING_STATUSES.has(status)) return null;

  const lines = [
    MARKER,
    "You are working toward a standing objective for this session. It applies to",
    "every turn, including ones the user starts. Keep it in view when you decide",
    "what to do next, and prefer work that advances it.",
    "",
    `<objective>${objective}</objective>`,
  ];

  const turnsUsed = typeof goal.turnsUsed === "number" ? goal.turnsUsed : 0;
  const turnBudget = typeof goal.turnBudget === "number" ? goal.turnBudget : null;
  if (turnBudget !== null) {
    lines.push("", `Turn budget: ${turnsUsed} of ${turnBudget} used.`);
  } else if (turnsUsed > 0) {
    lines.push("", `Turns spent on this goal so far: ${turnsUsed}.`);
  }

  lines.push(
    "",
    "Before claiming the objective is met, audit it against concrete evidence —",
    "files written, command output, and runtime evidence — not intent. Say GOAL_COMPLETE only",
    "when that evidence exists, and GOAL_BLOCKED with the reason only when you",
    "genuinely cannot proceed.",
  );

  return lines.join("\n");
}

/** goals-store keys files as <dataDir>/goals/<piSessionId>.json (see
 *  session-json-store). readGoal there is async; the before_agent_start hook
 *  needs a synchronous read, so mirror the same path + id rules here. */
function goalFilePath(piSessionId: string): string | null {
  const id = piSessionId.trim();
  if (!id || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(id)) return null;
  return path.join(resolveDataDir(), "goals", `${id}.json`);
}

export function readGoalSync(piSessionId: string): GoalPromptInput | null {
  const file = goalFilePath(piSessionId);
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as GoalPromptInput) : null;
  } catch {
    // No goal for this session (the common case) — stay silent.
    return null;
  }
}

/** Append the steering section for `piSessionId` to `systemPrompt`, or return
 *  null when there is nothing to add (no goal, non-steering status, or the
 *  section is already present — chained overrides could re-run this). */
export function appendGoalSystemPrompt(systemPrompt: string, piSessionId: string): string | null {
  const goal = readGoalSync(piSessionId);
  if (!goal) return null;
  const section = goalSystemPromptSection(goal);
  if (!section) return null;
  if (systemPrompt.includes(MARKER)) return null;
  return `${systemPrompt.trimEnd()}\n\n${section}`;
}

/** Build the in-process extension factory. `getPiSessionId` is evaluated per
 *  turn (inside before_agent_start), so it always reflects the runtime's live
 *  canonical id even if the session was resumed or adopted a new id. */
export function createGoalPromptExtension(getPiSessionId: () => string | null) {
  return (pi: ExtensionAPI): void => {
    pi.on("before_agent_start", (event) => {
      const piSessionId = getPiSessionId();
      if (!piSessionId) return {};
      const next = appendGoalSystemPrompt(event.systemPrompt, piSessionId);
      return next ? { systemPrompt: next } : {};
    });
  };
}
