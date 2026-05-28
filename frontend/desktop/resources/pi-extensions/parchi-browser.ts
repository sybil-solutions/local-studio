// Parchi browser tool extension for vLLM Studio.
//
// Registers Pi tools that call the local Parchi relay bridge instead of the
// embedded Electron webview bridge. Enable through VLLM_STUDIO_BROWSER_BACKEND=parchi
// while the normal browser tool toggle is on.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const DEFAULT_PARCHI_RELAY_RPC = "http://127.0.0.1:17373/v1/rpc";
const DEFAULT_PARCHI_ORIGIN = "http://127.0.0.1:3000";
const DEFAULT_PARCHI_TIMEOUT_MS = 120_000;

const PARCHI_RELAY_URL = process.env.PARCHI_RELAY_URL ?? DEFAULT_PARCHI_RELAY_RPC;
const PARCHI_RELAY_TOKEN = process.env.PARCHI_RELAY_TOKEN ?? "";
const PARCHI_RELAY_ORIGIN = process.env.PARCHI_RELAY_ORIGIN ?? DEFAULT_PARCHI_ORIGIN;
const PARCHI_RELAY_SESSION_ID =
  process.env.PARCHI_RELAY_SESSION_ID || process.env.VLLM_STUDIO_BROWSER_SESSION_ID || "default";
const PARCHI_RELAY_TASK_ID =
  process.env.PARCHI_RELAY_TASK_ID || `vllm-studio:${PARCHI_RELAY_SESSION_ID}`;
const PARCHI_RELAY_TASK_TITLE =
  process.env.PARCHI_RELAY_TASK_TITLE || "vLLM Studio Parchi browser session";

function readTimeoutMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const PARCHI_TOOL_TIMEOUT_MS = readTimeoutMs(
  "PARCHI_RELAY_TOOL_TIMEOUT_MS",
  DEFAULT_PARCHI_TIMEOUT_MS,
);

function failedToolResult(
  verb: string,
  payload: Record<string, unknown>,
  error: unknown,
): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `parchi_${verb} failed: ${message}` }],
    details: { verb, payload, error: message, failed: true },
  };
}

function normalizeRelayUrl(value: string): string {
  const trimmed = value.trim() || DEFAULT_PARCHI_RELAY_RPC;
  return trimmed.endsWith("/v1/rpc") ? trimmed : `${trimmed.replace(/\/+$/, "")}/v1/rpc`;
}

async function callParchiBridge(
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PARCHI_TOOL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (PARCHI_RELAY_TOKEN) headers.Authorization = `Bearer ${PARCHI_RELAY_TOKEN}`;
  const response = await fetch(normalizeRelayUrl(PARCHI_RELAY_URL), {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `parchi-${Date.now()}`,
      method: "bridge.call",
      params: {
        verb,
        payload,
        origin: PARCHI_RELAY_ORIGIN,
        sessionId: PARCHI_RELAY_SESSION_ID,
        taskId: PARCHI_RELAY_TASK_ID,
        taskTitle: PARCHI_RELAY_TASK_TITLE,
        timeoutMs: PARCHI_TOOL_TIMEOUT_MS,
      },
    }),
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  });

  const result = (await response.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (!response.ok || result.error) {
    throw new Error(result.error?.message || `Parchi relay HTTP ${response.status}`);
  }
  const text =
    typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2);
  return {
    content: [{ type: "text", text }],
    details: { verb, payload, data: result.result, relaySessionId: PARCHI_RELAY_SESSION_ID },
  };
}

async function safeParchiBridge(
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  try {
    return await callParchiBridge(verb, payload, signal);
  } catch (error) {
    return failedToolResult(verb, payload, error);
  }
}

export default function registerParchiBrowserExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "parchi_create_workspace",
    label: "Parchi: Create Workspace",
    description:
      "Prepare an isolated Parchi browser workspace for this Pi session before navigation or page interaction.",
    parameters: Type.Object({
      url: Type.Optional(
        Type.String({ description: "Optional first absolute http(s) URL to load" }),
      ),
      reset: Type.Optional(
        Type.Boolean({
          description: "Close existing tabs in this relay session first. Defaults to true.",
        }),
      ),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge(
        "create-workspace",
        {
          ...(typeof params.url === "string" ? { url: params.url } : {}),
          ...(typeof params.reset === "boolean" ? { reset: params.reset } : {}),
        },
        signal,
      );
    },
  });

  pi.registerTool({
    name: "parchi_navigate",
    label: "Parchi: Navigate",
    description: "Ask Parchi to navigate its isolated browser session to an absolute http(s) URL.",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute http(s) URL to load" }),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge("navigate", { url: params.url }, signal);
    },
  });

  pi.registerTool({
    name: "parchi_new_tab",
    label: "Parchi: New Tab",
    description: "Open a new tab inside the isolated Parchi browser session.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Optional absolute http(s) URL to load" })),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge(
        "new-tab",
        typeof params.url === "string" ? { url: params.url } : {},
        signal,
      );
    },
  });

  pi.registerTool({
    name: "parchi_list_tabs",
    label: "Parchi: List Tabs",
    description: "List tabs in the isolated Parchi browser session.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeParchiBridge("list-tabs", {}, signal);
    },
  });

  pi.registerTool({
    name: "parchi_switch_tab",
    label: "Parchi: Switch Tab",
    description: "Switch the active tab in the isolated Parchi browser session.",
    parameters: Type.Object({
      tabId: Type.String({ description: "Tab id or agent-browser tab label" }),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge("switch-tab", { tabId: params.tabId }, signal);
    },
  });

  pi.registerTool({
    name: "parchi_close_tab",
    label: "Parchi: Close Tab",
    description: "Close a tab in the isolated Parchi browser session.",
    parameters: Type.Object({
      tabId: Type.String({ description: "Tab id or agent-browser tab label" }),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge("close-tab", { tabId: params.tabId }, signal);
    },
  });

  pi.registerTool({
    name: "parchi_get_url",
    label: "Parchi: Current URL",
    description: "Return the current URL from Parchi's browser session.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeParchiBridge("get-url", {}, signal);
    },
  });

  pi.registerTool({
    name: "parchi_get_text",
    label: "Parchi: Get Text",
    description: "Return visible page text from Parchi's browser session.",
    parameters: Type.Object({
      selector: Type.Optional(
        Type.String({ description: "Optional CSS selector to scope text read" }),
      ),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge(
        "get-text",
        typeof params.selector === "string" ? { selector: params.selector } : {},
        signal,
      );
    },
  });

  pi.registerTool({
    name: "parchi_get_html",
    label: "Parchi: Get HTML",
    description: "Return rendered HTML from Parchi's browser session.",
    parameters: Type.Object({
      selector: Type.Optional(
        Type.String({ description: "Optional CSS selector to scope HTML read" }),
      ),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge(
        "get-html",
        typeof params.selector === "string" ? { selector: params.selector } : {},
        signal,
      );
    },
  });

  pi.registerTool({
    name: "parchi_screenshot",
    label: "Parchi: Screenshot",
    description: "Capture a screenshot through Parchi's browser session.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return safeParchiBridge("screenshot", {}, signal);
    },
  });

  pi.registerTool({
    name: "parchi_click",
    label: "Parchi: Click",
    description: "Click a selector or coordinate through Parchi's browser session.",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector or agent-browser ref" })),
      x: Type.Optional(Type.Number({ description: "Viewport x coordinate" })),
      y: Type.Optional(Type.Number({ description: "Viewport y coordinate" })),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge("click", params as Record<string, unknown>, signal);
    },
  });

  pi.registerTool({
    name: "parchi_fill",
    label: "Parchi: Fill Field",
    description: "Set a form field value through Parchi's browser session.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector or agent-browser ref" }),
      value: Type.String({ description: "Value to set" }),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge("fill", { selector: params.selector, value: params.value }, signal);
    },
  });

  pi.registerTool({
    name: "parchi_scroll",
    label: "Parchi: Scroll",
    description: "Scroll Parchi's browser session.",
    parameters: Type.Object({
      direction: Type.Optional(Type.String({ description: "up, down, left, or right" })),
      amount: Type.Optional(Type.Number({ description: "Optional scroll amount" })),
      selector: Type.Optional(Type.String({ description: "Optional element selector" })),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge("scroll", params as Record<string, unknown>, signal);
    },
  });

  pi.registerTool({
    name: "parchi_repl",
    label: "Parchi: JavaScript REPL",
    description: "Run JavaScript through Parchi's browser/session REPL bridge.",
    parameters: Type.Object({
      script: Type.String({ description: "JavaScript source to evaluate" }),
    }),
    async execute(_id, params, signal) {
      return safeParchiBridge("repl", { script: params.script }, signal);
    },
  });
}
