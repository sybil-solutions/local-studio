// chrome — the user's OWN browser, driven through the local extension relay.
//
// This is the other half of the browsing surface, and the half that is not
// interchangeable with it:
//
//   cua (`browser_*`)  — a headless throwaway Chromium this app launches. No
//                        cookies, no logins, no extensions, nobody watching.
//   chrome (`chrome_*`)— the window the user has open right now, with their
//                        profile, their sessions, their tabs. Everything shows
//                        up on their screen and can touch signed-in accounts.
//
// Both are registered together when the user arms Chrome, so the model chooses
// per task instead of being locked into one. That only works if every
// description says which browser it is — a model that thinks `browser_*` is
// signed in will report an empty inbox, and a model that thinks `chrome_*` is a
// sandbox will click "Delete" in the user's real account. The wording is load-
// bearing, not decoration.
//
// Transport is JSON-RPC to a loopback relay that forwards to the browser
// extension. The relay is the user's own process: if it is not running, the
// extension registers nothing rather than advertising tools that always fail.
//
// Config is read at REGISTRATION, not import. The runtime imports this module
// once per process but registers it per session, and the relay address and
// session id change between sessions.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withTimeout, type ToolResult } from "./bridge.ts";
import { Type, type Static, type TSchema } from "./schema.ts";

type ChromeEnv = {
  relayUrl: string;
  relayToken: string;
  sessionId: string;
  timeoutMs: number;
};

// Probing runs at session startup. The tool timeout is minutes long; a relay
// that accepts the connection and then hangs would stall every session behind
// it for that whole window.
const PROBE_TIMEOUT_MS = 3_000;
const HISTORY_LIMIT = 250;

function readEnv(): ChromeEnv {
  const timeout = Number(process.env.LOCAL_STUDIO_CHROME_TOOL_TIMEOUT_MS);
  return {
    relayUrl: (process.env.LOCAL_STUDIO_CHROME_RELAY_URL || "http://127.0.0.1:7717").replace(
      /\/+$/,
      "",
    ),
    relayToken: process.env.LOCAL_STUDIO_CHROME_RELAY_TOKEN ?? "",
    sessionId: process.env.LOCAL_STUDIO_CHROME_RELAY_SESSION || "default",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.trunc(timeout) : 120_000,
  };
}

async function callRelay(
  env: ChromeEnv,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  timeoutMs = env.timeoutMs,
): Promise<unknown> {
  const bounded = withTimeout(signal, timeoutMs);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Sitegeist-Session": env.sessionId,
  };
  if (env.relayToken) headers.Authorization = `Bearer ${env.relayToken}`;
  try {
    const response = await fetch(`${env.relayUrl}/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: bounded.signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (!response.ok || body.error) {
      throw new Error(body.error?.message || `chrome relay HTTP ${response.status}`);
    }
    return body.result;
  } finally {
    bounded.done();
  }
}

// ─── tool table ───────────────────────────────────────────────────────────

type ToolSpec<S extends TSchema> = {
  name: string;
  label: string;
  description: string;
  parameters: S;
  method: string;
  params: (params: Static<S>) => Record<string, unknown>;
};

function define<S extends TSchema>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

const urlParam = Type.String({ description: "Absolute http(s) URL" });
const optionalSelector = Type.Optional(
  Type.String({ description: "CSS selector to scope the result; omit for the whole page" }),
);
const tabIdParam = Type.Union([Type.String(), Type.Number()], {
  description: "Tab id from chrome_tabs_list",
});

// Repeated into every description on purpose. A tool list is often all the
// model reads, and the single fact that changes its behaviour is *whose*
// browser this is.
const REAL =
  "Acts on the user's OWN browser window — their real profile, logins and cookies — and is visible on their screen. For anonymous, throwaway, or bulk fetching use the `browser_*` (cua) tools instead: those run a headless browser with no sessions.";

const TOOLS = [
  define({
    name: "chrome_navigate",
    label: "Chrome: Navigate",
    description: `Point the user's active tab at an absolute http(s) URL and wait for load. ${REAL} This leaves their browsing history and can log page views against their account, so navigate only where the task requires. Returns the final URL and title; a redirect (often to a login page) means the final URL differs from the one requested.`,
    parameters: Type.Object({ url: urlParam }),
    method: "browser.navigate",
    params: (p) => ({ url: p.url }),
  }),
  define({
    name: "chrome_get_url",
    label: "Chrome: Current Page",
    description: `Return the URL and title of the user's active tab. ${REAL} Cheap, and the honest way to answer "what am I looking at" — the user may have moved since your last call, so check instead of assuming.`,
    parameters: Type.Object({}),
    method: "browser.url",
    params: () => ({}),
  }),
  define({
    name: "chrome_get_text",
    label: "Chrome: Read Page",
    description: `Return the visible text of the user's active tab. ${REAL} Because the page is loaded in their session, this can return private, signed-in content — treat it as the user's data, use it for the task at hand, and do not send it anywhere they did not ask for. Text only; long pages are truncated.`,
    parameters: Type.Object({ selector: optionalSelector }),
    method: "browser.text",
    params: (p) => compact({ selector: p.selector }),
  }),
  define({
    name: "chrome_get_html",
    label: "Chrome: Page HTML",
    description: `Return the rendered HTML of the user's active tab. ${REAL} Use only when text is not enough — to find selectors, attributes, or markup structure. Much larger than chrome_get_text and truncated on big pages.`,
    parameters: Type.Object({ selector: optionalSelector }),
    method: "browser.html",
    params: (p) => compact({ selector: p.selector }),
  }),
  define({
    name: "chrome_screenshot",
    label: "Chrome: Screenshot",
    description: `Capture the user's active tab as a base64 PNG data URI. ${REAL} It will contain whatever is on their screen, including signed-in content and anything in view — do not capture more than the task needs, and skip it entirely on a model without vision.`,
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean({ description: "Capture the full scrollable page" })),
      selector: optionalSelector,
    }),
    method: "browser.screenshot",
    params: (p) => compact({ fullPage: p.fullPage, selector: p.selector }),
  }),
  define({
    name: "chrome_click",
    label: "Chrome: Click",
    description: `Click the first element matching a CSS selector in the user's active tab. ${REAL} A click here is a real action taken as the signed-in user: it can post, purchase, delete, or send. Only click controls the user asked you to click, and never a destructive or irreversible one on your own initiative. Returns whether an element matched — \`found: false\` means the selector was wrong, so re-read the page rather than retrying it.`,
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the element to click" }),
    }),
    method: "browser.click",
    params: (p) => ({ selector: p.selector }),
  }),
  define({
    name: "chrome_fill",
    label: "Chrome: Fill Field",
    description: `Set the value of an input or textarea in the user's active tab, optionally submitting the form. ${REAL} Never type credentials, card numbers, or other secrets: the user is already signed in here, so a login form means something is wrong, not that you should fill it. Anything you submit is submitted as them.`,
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector for the input/textarea" }),
      value: Type.String({ description: "Value to set" }),
      submit: Type.Optional(Type.Boolean({ description: "Submit the form after filling" })),
    }),
    method: "browser.fill",
    params: (p) => compact({ selector: p.selector, value: p.value, submit: p.submit }),
  }),
  define({
    name: "chrome_scroll",
    label: "Chrome: Scroll",
    description: `Scroll the user's active tab by a pixel delta (positive scrolls down). ${REAL} Use it to reach lazy-loaded content; chrome_get_text already returns text below the fold.`,
    parameters: Type.Object({
      deltaY: Type.Number({ description: "Pixels to scroll vertically" }),
      selector: optionalSelector,
    }),
    method: "browser.scroll",
    params: (p) => compact({ dy: p.deltaY, selector: p.selector }),
  }),
  define({
    name: "chrome_eval",
    label: "Chrome: Evaluate",
    description: `Evaluate a JavaScript expression in the user's active tab and return its value. ${REAL} It runs inside their authenticated origin, so treat it as privileged: read and inspect, do not mutate account state or call site APIs with it. Values that cannot be serialized come back as null.`,
    parameters: Type.Object({
      expression: Type.String({ description: "JavaScript expression to evaluate" }),
    }),
    method: "browser.eval",
    params: (p) => ({ expression: p.expression }),
  }),
  define({
    name: "chrome_tabs_list",
    label: "Chrome: List Tabs",
    description: `List the user's open tabs with their ids, URLs, and titles. ${REAL} This is their working set — the titles alone can be sensitive. Use it to find a tab they already have open instead of navigating the one they are reading.`,
    parameters: Type.Object({}),
    method: "browser.tabs.list",
    params: () => ({}),
  }),
  define({
    name: "chrome_tabs_new",
    label: "Chrome: New Tab",
    description: `Open a new tab in the user's browser, optionally at a URL, and return its id. ${REAL} Prefer this over chrome_navigate when they are mid-task: it leaves the page they were reading alone.`,
    parameters: Type.Object({ url: Type.Optional(urlParam) }),
    method: "browser.tabs.new",
    params: (p) => compact({ url: p.url }),
  }),
  define({
    name: "chrome_tabs_switch",
    label: "Chrome: Switch Tab",
    description: `Make one of the user's tabs active by id; later chrome_* calls act on it. ${REAL} This moves what is on their screen, so switch deliberately and say why.`,
    parameters: Type.Object({ id: tabIdParam }),
    method: "browser.tabs.switch",
    params: (p) => ({ id: p.id }),
  }),
  define({
    name: "chrome_tabs_close",
    label: "Chrome: Close Tab",
    description: `Close one of the user's tabs by id. ${REAL} Closing a real tab can lose unsaved work in a form or editor — only close tabs you opened yourself, or ones the user explicitly asked you to close.`,
    parameters: Type.Object({ id: tabIdParam }),
    method: "browser.tabs.close",
    params: (p) => ({ id: p.id }),
  }),
];

// ─── registration ─────────────────────────────────────────────────────────

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  // JSON.stringify(undefined) is undefined, not a string — a tool that returned
  // an empty relay result would hand the SDK a content block with no text.
  return JSON.stringify(value ?? null, null, 2);
}

function failed(name: string, detailBase: Record<string, unknown>, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: `${name} failed: ${message}. The user's browser is reached through a local relay and its extension; if it stopped, say so plainly instead of guessing at page content.`,
      },
    ],
    details: { ...detailBase, error: message, failed: true },
  };
}

/** Methods the connected relay advertises, or null when it did not answer. */
async function probeRelay(env: ChromeEnv): Promise<Set<string> | null> {
  try {
    const result = await callRelay(env, "relay.capabilities", {}, undefined, PROBE_TIMEOUT_MS);
    const methods = (result as { methods?: unknown })?.methods;
    return Array.isArray(methods)
      ? new Set(methods.filter((method): method is string => typeof method === "string"))
      : new Set<string>();
  } catch {
    return null;
  }
}

export default async function registerChromeExtension(pi: ExtensionAPI) {
  const env = readEnv();
  const supported = await probeRelay(env);
  // No relay means no browser extension running. Registering the toolset anyway
  // would tell the model it can reach the user's Chrome and leave it inventing
  // page content when every call fails; the headless `browser_*` tools are
  // still there and are the honest fallback.
  if (!supported) return;

  // The relay keeps no history of its own, and the user's real browsing history
  // is theirs — this log covers only what this session did.
  const log: Array<{ at: string; action: string; detail?: string; ok: boolean }> = [];

  for (const tool of TOOLS) {
    // An empty capability list means the relay answered but advertised nothing;
    // register everything in that case rather than going silent.
    if (supported.size > 0 && !supported.has(tool.method)) continue;
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, params, signal) {
        const args = (params ?? {}) as Record<string, unknown>;
        const detailBase: Record<string, unknown> = { browser: "chrome", tool: tool.name, params };
        const detail =
          typeof args.url === "string" ? args.url : (args.selector as string | undefined);
        try {
          const data = await callRelay(env, tool.method, tool.params(params as never), signal);
          record(log, tool.name, detail, true);
          return {
            content: [{ type: "text", text: asText(data) }],
            details: { ...detailBase, data },
          };
        } catch (error) {
          record(log, tool.name, detail, false);
          return failed(tool.name, detailBase, error);
        }
      },
    });
  }

  pi.registerTool({
    name: "chrome_history",
    label: "Chrome: Session Actions",
    description:
      "Return what these chrome_* tools have already done to the user's browser this session, oldest first, with timestamps and whether each call succeeded. Use it before repeating an action so you do not open the same tab twice or re-submit a form. It is NOT the user's browsing history — pages they visited themselves are not here, and reading their real history is not something these tools do.",
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({ description: "Maximum entries to return (default 50, max 250)" }),
      ),
    }),
    async execute(_id, params) {
      const requested = Number(params.limit);
      const limit = Number.isFinite(requested)
        ? Math.min(HISTORY_LIMIT, Math.max(1, Math.trunc(requested)))
        : 50;
      const entries = log.slice(-limit);
      return {
        content: [{ type: "text", text: asText({ entries }) }],
        details: { browser: "chrome", tool: "chrome_history", data: { entries } },
      };
    },
  });
}

function record(
  log: Array<{ at: string; action: string; detail?: string; ok: boolean }>,
  action: string,
  detail: string | undefined,
  ok: boolean,
): void {
  log.push({ at: new Date().toISOString(), action, detail, ok });
  if (log.length > HISTORY_LIMIT) log.shift();
}
