// Browser tool extension for Local Studio.
//
// Registers tools the agent can call to drive the embedded webview in the
// agent surface. Each tool sends an HTTP request to the frontend's browser
// bridge API; the renderer receives the command via SSE, runs it against the
// active <webview>, and posts the result back.
//
// Loaded by pi-runtime via `--extension` only when the user has toggled
// "Browser tool" on in the agent header.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const BROWSER_SESSION_ID = process.env.LOCAL_STUDIO_BROWSER_SESSION_ID ?? "";
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 60_000;

function readTimeoutMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const BROWSER_TOOL_TIMEOUT_MS = readTimeoutMs(
  "LOCAL_STUDIO_BROWSER_TOOL_TIMEOUT_MS",
  DEFAULT_BROWSER_TOOL_TIMEOUT_MS,
);

function failedToolResult(
  verb: string,
  payload: Record<string, unknown>,
  error: unknown,
): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `browser_${verb} failed: ${message}` }],
    details: { verb, payload, error: message, failed: true },
  };
}

async function callBrowserAction(
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BROWSER_TOOL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const response = await fetch(`${FRONTEND_BASE}/api/agent/browser/${verb}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      BROWSER_SESSION_ID ? { ...payload, sessionId: BROWSER_SESSION_ID } : payload,
    ),
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${errBody}`);
  }
  const result = (await response.json()) as { ok: boolean; data?: unknown; error?: string };
  if (!result.ok) throw new Error(result.error || "browser bridge returned ok=false");
  const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2);
  return {
    content: [{ type: "text", text }],
    details: { verb, payload, data: result.data },
  };
}

async function safeBrowserAction(
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  try {
    return await callBrowserAction(verb, payload, signal);
  } catch (error) {
    return failedToolResult(verb, payload, error);
  }
}

export default function registerBrowserExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "browser_navigate",
    label: "Browser: Navigate",
    description:
      "Navigate the embedded browser to a URL. Use this to open a webpage before reading or interacting with it.",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute http(s) URL to load" }),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("navigate", { url: params.url }, signal);
    },
  });

  pi.registerTool({
    name: "browser_get_url",
    label: "Browser: Current URL",
    description: "Return the current URL of the embedded browser.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeBrowserAction("get-url", {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_get_text",
    label: "Browser: Get Text",
    description:
      "Return the visible text of the current page (innerText of <body>). Use after navigating to read page contents.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeBrowserAction("get-text", {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_get_html",
    label: "Browser: Get HTML",
    description:
      "Return the rendered HTML of the current page. Useful when text alone isn't enough.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeBrowserAction("get-html", {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser: Screenshot",
    description: "Capture a PNG screenshot of the current page; returns a base64 data URI.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeBrowserAction("screenshot", {}, signal);
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser: Click",
    description: "Click an element matching a CSS selector. Returns whether the element was found.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the element to click" }),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("click", { selector: params.selector }, signal);
    },
  });

  pi.registerTool({
    name: "browser_scroll",
    label: "Browser: Scroll",
    description: "Scroll the page by a vertical pixel delta (positive = down).",
    parameters: Type.Object({
      deltaY: Type.Number({ description: "Pixels to scroll vertically" }),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("scroll", { deltaY: params.deltaY }, signal);
    },
  });

  pi.registerTool({
    name: "browser_fill",
    label: "Browser: Fill Field",
    description:
      "Set the value of an input/textarea matching a CSS selector and dispatch input/change events.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the input/textarea" }),
      value: Type.String({ description: "Value to set" }),
    }),
    async execute(_id, params, signal) {
      return safeBrowserAction("fill", { selector: params.selector, value: params.value }, signal);
    },
  });
}
