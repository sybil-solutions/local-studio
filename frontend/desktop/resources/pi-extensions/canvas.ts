// Canvas tool extension for Local Studio.
//
// Gives Pi a shared scratchboard it can read and update. The renderer also
// edits this same document through /api/agent/canvas, so the human and model
// see one source of truth.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const CANVAS_TOOL_TIMEOUT_MS = 20_000;

function result(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text }], details };
}

async function callCanvas(
  method: "GET" | "POST",
  body: Record<string, unknown> | null,
  signal: AbortSignal,
): Promise<{ enabled?: boolean; text?: string; updatedAt?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CANVAS_TOOL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const response = await fetch(`${FRONTEND_BASE}/api/agent/canvas`, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return (await response.json()) as { enabled?: boolean; text?: string; updatedAt?: string };
}

export default function registerCanvasExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "canvas_read",
    label: "Canvas: Read",
    description:
      "Read the shared Local Studio canvas scratchboard. Use it to pick up notes left by the human or previous model steps.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      try {
        const canvas = await callCanvas("GET", null, signal);
        return result(canvas.text || "", canvas);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result(`canvas_read failed: ${message}`, { failed: true, error: message });
      }
    },
  });

  pi.registerTool({
    name: "canvas_write",
    label: "Canvas: Write",
    description:
      "Replace the shared Local Studio canvas scratchboard with concise notes, plans, links, or state the human and model should both see.",
    parameters: Type.Object({
      text: Type.String({ description: "Full replacement canvas text" }),
    }),
    async execute(_id, params, signal) {
      try {
        const canvas = await callCanvas("POST", { enabled: true, text: params.text }, signal);
        return result(canvas.text || "", canvas);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result(`canvas_write failed: ${message}`, { failed: true, error: message });
      }
    },
  });

  pi.registerTool({
    name: "canvas_append",
    label: "Canvas: Append",
    description: "Append a short note to the shared Local Studio canvas scratchboard.",
    parameters: Type.Object({
      text: Type.String({ description: "Text to append to the canvas" }),
    }),
    async execute(_id, params, signal) {
      try {
        const current = await callCanvas("GET", null, signal);
        const prefix = current.text?.trimEnd() ? `${current.text.trimEnd()}\n\n` : "";
        const canvas = await callCanvas(
          "POST",
          { enabled: true, text: `${prefix}${params.text}` },
          signal,
        );
        return result(canvas.text || "", canvas);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result(`canvas_append failed: ${message}`, { failed: true, error: message });
      }
    },
  });
}
