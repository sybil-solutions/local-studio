// Subagent tool for Local Studio.
//
// Registers a `subagent` tool that spawns an independent child agent session
// in the runtime (same project, own context) and returns its final report as
// the tool result. Multiple calls in one turn run in parallel. The runtime
// enforces a concurrency cap and forbids subagents from spawning their own.
//
// Calls proxy through the frontend like the connectors bridge, so this file
// stays a plain pi extension with no runtime imports.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const RUN_TIMEOUT_MS = 15 * 60_000;

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const textResult = (text: string, details: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

export default function subagentsExtension(pi: ExtensionAPI): void {
  let sessionId: string | null = null;
  pi.on("session_start", (_event, ctx) => {
    try {
      sessionId = ctx.sessionManager.getSessionId();
    } catch {
      sessionId = null;
    }
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate a self-contained task to an independent subagent with its own fresh context. " +
      "Use for parallelizable research, reviews, or implementation chunks — call this tool " +
      "multiple times in one turn to fan out. Give each subagent a short name and a complete, " +
      "standalone task description; it cannot see this conversation. Returns the subagent's " +
      "final report.",
    parameters: Type.Object({
      name: Type.String({ description: "Short display name, e.g. 'API auditor'" }),
      task: Type.String({ description: "Complete standalone task instructions" }),
    }),
    async execute(_id, params, signal) {
      const args = (params ?? {}) as { name?: string; task?: string };
      if (!sessionId) {
        return textResult("Subagents are unavailable: the session id is unknown.", {
          failed: true,
        });
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) controller.abort();
      try {
        const response = await fetch(`${FRONTEND_BASE}/api/agent/subagents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentPiSessionId: sessionId,
            name: args.name ?? "Subagent",
            task: args.task ?? "",
          }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          result?: string;
          piSessionId?: string | null;
          error?: string;
        };
        if (!response.ok || !payload.ok) {
          return textResult(`Subagent failed: ${payload.error ?? response.status}`, {
            failed: true,
            name: args.name,
          });
        }
        return textResult(payload.result ?? "(no report)", {
          name: args.name,
          piSessionId: payload.piSessionId ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`Subagent failed: ${message}`, { failed: true, name: args.name });
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
  });
}
