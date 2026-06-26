// Plan tool extension for Local Studio.
//
// Gives Pi a structured task plan it can read and rewrite. The renderer shows
// and edits the same document in the right-hand "Plan" panel through
// /api/agent/plan, so the human and model share one checklist. The plan is a
// Cursor-style Markdown document: a `### To-dos` section of `- [ ]` checkboxes.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const PLAN_SESSION_ID = process.env.LOCAL_STUDIO_PLAN_SESSION_ID ?? "";
const PLAN_TOOL_TIMEOUT_MS = 20_000;

function result(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text }], details };
}

function planUrl(): string {
  const query = PLAN_SESSION_ID ? `?sessionId=${encodeURIComponent(PLAN_SESSION_ID)}` : "";
  return `${FRONTEND_BASE}/api/agent/plan${query}`;
}

async function callPlan(
  method: "GET" | "POST",
  body: Record<string, unknown> | null,
  signal: AbortSignal,
): Promise<{ markdown?: string; updatedAt?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAN_TOOL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const response = await fetch(planUrl(), {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return (await response.json()) as { markdown?: string; updatedAt?: string };
}

export default function registerPlanExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "plan_read",
    label: "Plan: Read",
    description:
      "Read the shared Local Studio task plan (a Markdown checklist shown in the Plan panel). Call this at the start of a multi-step task to pick up an existing plan and its progress.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      try {
        const plan = await callPlan("GET", null, signal);
        return result(plan.markdown || "", plan);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result(`plan_read failed: ${message}`, { failed: true, error: message });
      }
    },
  });

  pi.registerTool({
    name: "plan_write",
    label: "Plan: Write",
    description:
      "Replace the shared Local Studio task plan shown in the Plan panel. Provide the FULL Markdown document. Use a `### To-dos` heading followed by checkbox lines: `- [ ]` pending, `- [/]` in progress, `- [x]` completed, `- [-]` cancelled. Keep exactly one item in progress. Call this whenever the plan or the status of a step changes.",
    parameters: Type.Object({
      markdown: Type.String({
        description: "Full replacement plan Markdown (a `### To-dos` checkbox list).",
      }),
    }),
    async execute(_id, params, signal) {
      try {
        const plan = await callPlan("POST", { markdown: params.markdown }, signal);
        return result(plan.markdown || "", plan);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result(`plan_write failed: ${message}`, { failed: true, error: message });
      }
    },
  });
}
