// cua — Local Studio's headless computer-use browser.
//
// A throwaway Chromium-family browser (Chromium, Chrome, or Brave, whichever
// the user picked) driven through the agent runtime. No profile, no logins, no
// extensions, one page at a time. The user can watch it in the Browser panel.
//
// This extension used to carry a second transport that drove the user's REAL
// browser. That half now lives in chrome.ts under its own `chrome_*` names,
// because the two are not interchangeable and hiding the difference behind one
// vocabulary made the difference invisible exactly where it mattered: a model
// cannot tell that "the page" is a signed-out sandbox rather than the user's
// logged-in session if both spell it `browser_get_text`. Both extensions load
// together when the user arms Chrome, so the model picks per task — which only
// works because every description below says which browser this is.
//
// Configuration is read when the extension is REGISTERED, not when the module
// is imported. The runtime loads this module once per process but registers it
// per session, and the session id changes from one session to the next; module-
// scope caching would pin the first session's answers onto every later one.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { frontendBase, withTimeout, type ToolResult } from "./bridge.ts";
import { Type, type Static, type TSchema } from "./schema.ts";

type CuaEnv = {
  frontendBase: string;
  browserSessionId: string;
  timeoutMs: number;
};

function readEnv(): CuaEnv {
  const timeout = Number(process.env.LOCAL_STUDIO_BROWSER_TOOL_TIMEOUT_MS);
  return {
    frontendBase: frontendBase(),
    browserSessionId: process.env.LOCAL_STUDIO_BROWSER_SESSION_ID ?? "",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.trunc(timeout) : 60_000,
  };
}

// ─── transport ────────────────────────────────────────────────────────────

async function callHost(
  env: CuaEnv,
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const bounded = withTimeout(signal, env.timeoutMs);
  const response = await fetch(`${env.frontendBase}/api/agent/browser/${verb}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      env.browserSessionId ? { ...payload, sessionId: env.browserSessionId } : payload,
    ),
    signal: bounded.signal,
  }).finally(bounded.done);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${await response.text().catch(() => "")}`);
  }
  return unwrap(await response.json());
}

async function getHost(
  env: CuaEnv,
  pathAndQuery: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const bounded = withTimeout(signal, env.timeoutMs);
  const response = await fetch(`${env.frontendBase}${pathAndQuery}`, {
    signal: bounded.signal,
  }).finally(bounded.done);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return unwrap(await response.json());
}

function unwrap(body: unknown): unknown {
  const result = body as { ok?: boolean; data?: unknown; error?: string };
  if (!result?.ok) throw new Error(result?.error || "browser bridge returned ok=false");
  return result.data;
}

// ─── tool table ───────────────────────────────────────────────────────────

type ToolSpec<S extends TSchema> = {
  name: string;
  label: string;
  description: string;
  parameters: S;
  verb: string;
  body: (params: Static<S>) => Record<string, unknown>;
};

function define<S extends TSchema>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

const urlParam = Type.String({ description: "Absolute http(s) URL" });
const ignoredSelector = Type.Optional(
  Type.String({ description: "CSS selector; ignored by this backend" }),
);

// Stated once, then folded into the descriptions the model actually reads — a
// tool list is often all it gets, and the fact that changes its behaviour is
// that this browser is nobody: signed out, and not the window the user is
// looking at.
const LIMITS =
  "Runs a headless browser on this machine with a throwaway profile: no saved logins, no cookies, no extensions, no downloads, one page at a time, and only public http(s) URLs plus localhost are reachable. Anything behind a sign-in will show you the logged-out page. When the task needs the user's own session or their open tabs, use the `chrome_*` tools instead — those drive their real browser.";

const TOOLS = [
  define({
    name: "browser_navigate",
    label: "Browser: Navigate",
    description: `Open an absolute http(s) URL in the headless browser and wait for it to load. Call this before reading or interacting with a page. ${LIMITS} Returns the final URL and title; a redirect means the final URL differs from the one requested.`,
    parameters: Type.Object({ url: urlParam }),
    verb: "navigate",
    body: (p) => ({ url: p.url }),
  }),
  define({
    name: "browser_get_url",
    label: "Browser: Current URL",
    description:
      "Return the URL and title of the page the headless browser has open. Cheap; use it to confirm where it is instead of assuming. Note this is not the user's browser — if they say a page is already open, they mean their own window, which `chrome_get_url` reads.",
    parameters: Type.Object({}),
    verb: "get-url",
    body: () => ({}),
  }),
  define({
    name: "browser_get_text",
    label: "Browser: Get Text",
    description: `Return the visible text of the page open in the headless browser. The cheapest way to read a public page and the one to reach for by default. Text only — no layout, no images, nothing behind interaction; long pages are truncated, and \`selector\` is ignored. ${LIMITS}`,
    parameters: Type.Object({ selector: ignoredSelector }),
    verb: "get-text",
    body: () => ({}),
  }),
  define({
    name: "browser_get_html",
    label: "Browser: Get HTML",
    description:
      "Return the rendered HTML of the page open in the headless browser. Use only when text is not enough — to find selectors, attributes, or markup structure. Much larger than `browser_get_text` and truncated on big pages.",
    parameters: Type.Object({ selector: ignoredSelector }),
    verb: "get-html",
    body: () => ({}),
  }),
  define({
    name: "browser_screenshot",
    label: "Browser: Screenshot",
    description:
      "Capture the headless browser's viewport as a base64 PNG data URI. Use it when visual layout matters; prefer `browser_get_text` for reading, and skip it entirely on a model without vision. Captures the viewport, not the full scrollable page.",
    parameters: Type.Object({}),
    verb: "screenshot",
    body: () => ({}),
  }),
  define({
    name: "browser_click",
    label: "Browser: Click",
    description:
      "Click the first element matching a CSS selector in the headless browser. Safe to experiment with — this browser is signed out and nobody is watching it, so a wrong click costs a reload, not the user's account. Returns whether an element matched: `found: false` means the selector was wrong, not that the click silently failed, so re-read the page instead of retrying it. No coordinate clicking.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the element to click" }),
    }),
    verb: "click",
    body: (p) => ({ selector: p.selector }),
  }),
  define({
    name: "browser_fill",
    label: "Browser: Fill Field",
    description:
      "Set the value of an input or textarea in the headless browser and fire input/change events. Does not submit the form — click the submit control afterwards. Never put credentials, payment details, or other secrets here: this browser keeps no session, so signing in achieves nothing and only leaks the secret.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the input/textarea" }),
      value: Type.String({ description: "Value to set" }),
    }),
    verb: "fill",
    body: (p) => ({ selector: p.selector, value: p.value }),
  }),
  define({
    name: "browser_scroll",
    label: "Browser: Scroll",
    description:
      "Scroll the headless browser by a pixel delta (positive `deltaY` scrolls down). Use it to reach lazy-loaded content; for plain reading, `browser_get_text` already returns text below the fold.",
    parameters: Type.Object({
      deltaY: Type.Number({ description: "Pixels to scroll vertically" }),
      selector: ignoredSelector,
    }),
    verb: "scroll",
    body: (p) => ({ deltaY: p.deltaY }),
  }),
  define({
    name: "browser_back",
    label: "Browser: Back",
    description:
      "Go back one entry in the headless browser's history and return the new page state. Does nothing when there is nothing to go back to.",
    parameters: Type.Object({}),
    verb: "back",
    body: () => ({}),
  }),
  define({
    name: "browser_forward",
    label: "Browser: Forward",
    description:
      "Go forward one entry in the headless browser's history and return the new page state.",
    parameters: Type.Object({}),
    verb: "forward",
    body: () => ({}),
  }),
  define({
    name: "browser_reload",
    label: "Browser: Reload",
    description:
      "Reload the page open in the headless browser and return its state. Use after an action that should have changed server-side state.",
    parameters: Type.Object({}),
    verb: "reload",
    body: () => ({}),
  }),
];

// ─── registration ─────────────────────────────────────────────────────────

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  // JSON.stringify(undefined) is undefined, not a string — a tool that returned
  // an empty result would hand the SDK a content block with no text.
  return JSON.stringify(value ?? null, null, 2);
}

function failed(name: string, detailBase: Record<string, unknown>, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `${name} failed: ${message}` }],
    details: { ...detailBase, error: message, failed: true },
  };
}

export default async function registerCuaExtension(pi: ExtensionAPI) {
  const env = readEnv();

  for (const tool of TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, params, signal) {
        const detailBase: Record<string, unknown> = {
          browser: "cua",
          tool: tool.name,
          params: (params ?? {}) as Record<string, unknown>,
        };
        try {
          const data = await callHost(env, tool.verb, tool.body(params as never), signal);
          return {
            content: [{ type: "text", text: asText(data) }],
            details: { ...detailBase, data },
          };
        } catch (error) {
          return failed(tool.name, detailBase, error);
        }
      },
    });
  }

  pi.registerTool({
    name: "browser_history",
    label: "Browser: History",
    description:
      "Return the computer-use history: every action performed in the headless browser this session — by you or by the user in the Browser panel — oldest first, with timestamps, URLs, and success. Use it to recover what has already been visited or tried instead of repeating work. Held in memory for the current runtime; it is not the user's personal browsing history and does not survive a restart.",
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({ description: "Maximum entries to return (default 50, max 250)" }),
      ),
      visitedOnly: Type.Optional(
        Type.Boolean({ description: "Return only the distinct pages visited, in order" }),
      ),
    }),
    async execute(_id, params, signal) {
      const limit = Number.isFinite(params.limit)
        ? Math.max(1, Math.trunc(Number(params.limit)))
        : 50;
      const detailBase: Record<string, unknown> = {
        browser: "cua",
        tool: "browser_history",
        params,
      };
      try {
        const query = `limit=${limit}${params.visitedOnly ? "&visited=1" : ""}`;
        const data = await getHost(env, `/api/agent/browser/history?${query}`, signal);
        return {
          content: [{ type: "text", text: asText(data) }],
          details: { ...detailBase, data },
        };
      } catch (error) {
        return failed("browser_history", detailBase, error);
      }
    },
  });
}
