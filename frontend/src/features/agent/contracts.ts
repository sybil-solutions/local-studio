import type { AgentImageInput } from "@shared/agent/agent-image-input";

export type { AgentImageInput };
// The turn wire contract + generic body-field helpers live in
// shared/agent/agent-turn.ts so the @local-studio/agent-runtime HTTP handlers
// can share them; re-exported here for frontend callers.
export {
  objectRecord,
  stringField,
  stringArray,
  boolField,
  parseAgentTurnRequest,
} from "@shared/agent/agent-turn";
export type {
  ParseResult,
  AgentTurnMode,
  AgentStreamingBehavior,
  AgentTurnRequest,
  AgentTurnRuntimeStatus,
  AgentTurnCommandResult,
} from "@shared/agent/agent-turn";
import {
  objectRecord,
  stringField,
  stringArray,
  type ParseResult,
  type AgentTurnRuntimeStatus,
  type AgentTurnCommandResult,
} from "@shared/agent/agent-turn";

export type GitRef = { name: string; current: boolean; remote: boolean };
export type GitStatusEntry = { code: string; path: string };

export type GitState = {
  isRepo: boolean;
  branch: string | null;
  status: string[];
  entries: GitStatusEntry[];
  diff: string;
  additions: number;
  deletions: number;
  refs: GitRef[];
  hasUpstream: boolean;
  remoteUrl: string | null;
  prUrl: string | null;
  error?: string;
};

export type GitAction =
  | { action: "init" }
  | { action: "checkout"; ref: string }
  | { action: "createBranch"; branch: string }
  | { action: "commit"; message: string; paths: string[] }
  | { action: "push" };

export function parseGitAction(input: unknown): ParseResult<GitAction> {
  const body = objectRecord(input);
  if (!body || typeof body.action !== "string") {
    return { ok: false, error: "action is required" };
  }
  if (body.action === "init") return { ok: true, value: { action: "init" } };
  if (body.action === "push") return { ok: true, value: { action: "push" } };
  if (body.action === "checkout") {
    const ref = stringField(body, "ref", true);
    return ref.ok ? { ok: true, value: { action: "checkout", ref: ref.value! } } : ref;
  }
  if (body.action === "createBranch") {
    const branch = stringField(body, "branch", true);
    return branch.ok
      ? { ok: true, value: { action: "createBranch", branch: branch.value! } }
      : branch;
  }
  if (body.action === "commit") {
    const message = stringField(body, "message", true);
    if (!message.ok) return message;
    return {
      ok: true,
      value: { action: "commit", message: message.value!, paths: stringArray(body.paths) },
    };
  }
  return { ok: false, error: `Unsupported git action: ${body.action}` };
}

export type TerminalRunRequest = { command: string };
export type TerminalRunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

export function parseTerminalRunRequest(input: unknown): ParseResult<TerminalRunRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const command = stringField(body, "command", true);
  return command.ok ? { ok: true, value: { command: command.value! } } : command;
}

export function parseAgentTurnCommandResult(input: unknown): AgentTurnCommandResult | null {
  const payload = objectRecord(input);
  if (!payload || payload.type !== "command") return null;
  const outcome =
    payload.outcome === "accepted" || payload.outcome === "queued" || payload.outcome === "rejected"
      ? payload.outcome
      : null;
  const runtimeSessionId =
    typeof payload.runtimeSessionId === "string" && payload.runtimeSessionId.trim()
      ? payload.runtimeSessionId.trim()
      : "";
  if (!outcome || !runtimeSessionId) return null;
  return {
    type: "command",
    outcome,
    runtimeSessionId,
    piSessionId: typeof payload.piSessionId === "string" ? payload.piSessionId : null,
    active: payload.active === true,
    status: objectRecord(payload.status) ? (payload.status as AgentTurnRuntimeStatus) : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
  };
}
