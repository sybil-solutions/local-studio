// Embedded browser verb dispatch for the pi agent's browser_* tools.
//
// Verbs are driven by the server-side CDP browser host (a real headless
// Chromium) instead of the old renderer-bridge embedded webview. The response
// contract the pi tools expect is preserved byte-for-byte:
//   { ok: true, data: <verb-shaped> }  /  { ok: false, error }
//
// When Chromium is unavailable (no binary, launch failure), navigate/get-text
// fall back to reading mode (browser-host/reader.ts); interactive verbs return
// a clear "Browser unavailable" error.
//
// /events, /result, and browser-bridge.ts remain for any other consumers, but
// this path no longer uses them.

import { NextRequest } from "next/server";
import { browserHost } from "@/features/agent/browser-host/browser-host";
import { fetchReadable } from "@/features/agent/browser-host/reader";
import {
  sanitizeBrowserPaneUrl,
  sanitizePublicBrowserUrl,
} from "@/features/agent/sanitize-embedded-browser-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_VERBS = new Set([
  "navigate",
  "get-url",
  "get-text",
  "get-html",
  "screenshot",
  "click",
  "scroll",
  "fill",
  "back",
  "forward",
  "reload",
]);

const UNAVAILABLE_ERROR = "Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH";

type VerbResult = { ok: boolean; data?: unknown; error?: string };

export async function POST(request: NextRequest, context: { params: Promise<{ verb: string }> }) {
  const { verb } = await context.params;
  if (!ALLOWED_VERBS.has(verb)) {
    return Response.json({ ok: false, error: `Unknown browser verb: ${verb}` }, { status: 400 });
  }
  const payload = await readPayload(request);
  try {
    const result = await dispatchVerb(verb, payload);
    return Response.json(result);
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Browser command failed",
    });
  }
}

async function readPayload(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (body && typeof body === "object") {
      // sessionId was a renderer-bridge affinity hint; the host is global now.
      const { sessionId: _sessionId, ...rest } = body;
      return rest;
    }
  } catch {
    // empty body is fine
  }
  return {};
}

async function dispatchVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  if (!browserHost.isAvailable()) return fallbackVerb(verb, payload);
  try {
    return await runHostVerb(verb, payload);
  } catch (error) {
    // A launch/connection failure for the reading verbs still degrades to
    // reading mode rather than failing the tool call outright.
    if (verb === "navigate" || verb === "get-text") return fallbackVerb(verb, payload);
    throw error;
  }
}

async function runHostVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  switch (verb) {
    case "navigate":
      return navigateVerb(payload);
    case "get-url":
      return { ok: true, data: await browserHost.getUrl() };
    case "get-text":
      return { ok: true, data: { text: await browserHost.getText() } };
    case "get-html":
      return { ok: true, data: { html: await browserHost.getHtml() } };
    case "screenshot":
      return { ok: true, data: { dataUri: await browserHost.screenshot() } };
    case "click":
      return selectorVerb(await browserHost.click({ selector: requireSelector(payload) }));
    case "fill":
      return selectorVerb(
        await browserHost.fill({
          selector: requireSelector(payload),
          value: String(payload.value ?? ""),
        }),
      );
    case "scroll":
      return scrollVerb(payload);
    case "back":
      await browserHost.goBack();
      return { ok: true, data: await browserHost.getState() };
    case "forward":
      await browserHost.goForward();
      return { ok: true, data: await browserHost.getState() };
    case "reload":
      await browserHost.reload();
      return { ok: true, data: await browserHost.getState() };
    default:
      return { ok: false, error: `Unsupported browser verb: ${verb}` };
  }
}

async function navigateVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  // Pane rules: public web plus loopback (previewing local dev servers is the
  // pane's main job); other private ranges stay blocked.
  const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
  if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
  const result = await browserHost.navigate(url);
  return { ok: true, data: result };
}

async function scrollVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  const deltaY = Number(payload.deltaY ?? 0);
  const result = await browserHost.scroll({ deltaY: Number.isFinite(deltaY) ? deltaY : 0 });
  return { ok: true, data: { deltaY: result.deltaY, scrollY: result.scrollY } };
}

function selectorVerb(result: { found: boolean }): VerbResult {
  return {
    ok: result.found,
    data: { found: result.found },
    ...(result.found ? {} : { error: "selector not found" }),
  };
}

function requireSelector(payload: Record<string, unknown>): string {
  const selector = String(payload.selector ?? "");
  if (!selector) throw new Error("selector required");
  return selector;
}

// Chromium-unavailable fallbacks. navigate + get-text drop to reading mode;
// every interactive verb returns the clear unavailable error. The fallback
// honors pane rules (public + loopback) so local dev servers stay previewable
// even when there's no headless Chromium to drive a full live surface.
async function fallbackVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  if (verb === "navigate") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
    if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
    const reader = await fetchReadable(url);
    return { ok: true, data: { url: reader.url, title: reader.title, readingMode: true } };
  }
  if (verb === "get-text") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
    if (!url) return { ok: false, error: UNAVAILABLE_ERROR };
    const reader = await fetchReadable(url);
    return { ok: true, data: { text: reader.text, readingMode: true } };
  }
  return { ok: false, error: UNAVAILABLE_ERROR };
}
