import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeBrowserPaneUrl } from "../../../../shared/agent/sanitize-embedded-browser-url";
import {
  browserHost,
  normalizeBrowserSessionKey,
  type KeyInput,
  type MouseInput,
} from "../browser-host/browser-host";
import {
  explicitBinaryOverride,
  isBrowserEngineId,
  listBrowserEngines,
  readEnginePreference,
  resolveBrowserEngine,
  writeEnginePreference,
} from "../browser-host/browser-engines";
import { browserHistory } from "../browser-host/browser-history";
import { playwrightManager } from "../browser-host/playwright";
import { fetchReadable } from "../browser-host/reader";
import { errorMessage } from "./helpers";

/** Same switch network-policy.ts honors — the two must agree, or a URL the
 *  navigate verb accepted dies at the pinning proxy with a confusing 403. */
const paneUrlOptions = () => ({
  allowPrivate: process.env.LOCAL_STUDIO_BROWSER_ALLOW_PRIVATE === "1",
});

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

// The reason the engine could not be resolved, phrased for whoever has to fix
// it — a missing LOCAL_STUDIO_CHROME_PATH binary reads differently from "no
// browser installed", and the old single string blamed the wrong dial.
function unavailableError(): string {
  try {
    resolveBrowserEngine();
    return "Browser unavailable";
  } catch (error) {
    return errorMessage(error, "Browser unavailable");
  }
}

let lastFallbackUrl = "";

type VerbResult = { ok: boolean; data?: unknown; error?: string };

export async function handleBrowserVerb(request: Request, verb: string): Promise<Response> {
  if (!ALLOWED_VERBS.has(verb)) {
    return Response.json({ ok: false, error: `Unknown browser verb: ${verb}` }, { status: 400 });
  }
  const { payload, session } = await readPayload(request);
  try {
    const result = await dispatchVerb(verb, payload, session, request.signal);
    return Response.json(result);
  } catch (error) {
    return Response.json({
      ok: false,
      error: errorMessage(error, "Browser command failed"),
    });
  }
}

async function readPayload(
  request: Request,
): Promise<{ payload: Record<string, unknown>; session: string | undefined }> {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (body && typeof body === "object") {
      // sessionId scopes the verb to its agent session's isolated browser
      // context; verbs without one (the panel's) follow the active session.
      const { sessionId, ...rest } = body;
      return { payload: rest, session: normalizeBrowserSessionKey(sessionId) ?? undefined };
    }
  } catch {
    // empty body is fine
  }
  return { payload: {}, session: undefined };
}

// Every verb — model-issued or panel-issued, both arrive here — lands in the
// history ring before the result goes back out.
async function dispatchVerb(
  verb: string,
  payload: Record<string, unknown>,
  session: string | undefined,
  signal: AbortSignal | undefined,
): Promise<VerbResult> {
  try {
    const result = await runVerb(verb, payload, session, signal);
    recordHistory(verb, payload, result);
    return result;
  } catch (error) {
    browserHistory.record({
      action: verb,
      detail: historyDetail(verb, payload),
      ok: false,
      error: errorMessage(error, String(error)),
    });
    throw error;
  }
}

async function runVerb(
  verb: string,
  payload: Record<string, unknown>,
  session: string | undefined,
  signal: AbortSignal | undefined,
): Promise<VerbResult> {
  if (!browserHost.isAvailable()) return fallbackVerb(verb, payload, signal);
  try {
    return await runHostVerb(verb, payload, session);
  } catch (error) {
    // A launch/connection failure for the reading verbs still degrades to
    // reading mode rather than failing the tool call outright.
    if (verb === "navigate" || verb === "get-text") return fallbackVerb(verb, payload, signal);
    throw error;
  }
}

function recordHistory(
  verb: string,
  payload: Record<string, unknown>,
  result: VerbResult,
): void {
  const data = (result.data ?? {}) as { url?: unknown; title?: unknown };
  browserHistory.record({
    action: verb,
    url: typeof data.url === "string" ? data.url : undefined,
    title: typeof data.title === "string" ? data.title : undefined,
    detail: historyDetail(verb, payload),
    ok: result.ok,
    error: result.error,
  });
}

function historyDetail(verb: string, payload: Record<string, unknown>): string | undefined {
  if (verb === "navigate") return String(payload.url ?? "") || undefined;
  if (verb === "click") return String(payload.selector ?? "") || undefined;
  if (verb === "fill") return `${String(payload.selector ?? "")} = ${String(payload.value ?? "")}`;
  if (verb === "scroll") return `deltaY ${Number(payload.deltaY ?? 0)}`;
  return undefined;
}

async function runHostVerb(
  verb: string,
  payload: Record<string, unknown>,
  session: string | undefined,
): Promise<VerbResult> {
  switch (verb) {
    case "navigate":
      return navigateVerb(payload, session);
    case "get-url":
      return { ok: true, data: await browserHost.getUrl(session) };
    case "get-text":
      return { ok: true, data: { text: await browserHost.getText(session) } };
    case "get-html":
      return { ok: true, data: { html: await browserHost.getHtml(session) } };
    case "screenshot":
      return { ok: true, data: { dataUri: await browserHost.screenshot(session) } };
    case "click":
      return selectorVerb(await browserHost.click({ selector: requireSelector(payload) }, session));
    case "fill":
      return selectorVerb(
        await browserHost.fill(
          {
            selector: requireSelector(payload),
            value: String(payload.value ?? ""),
          },
          session,
        ),
      );
    case "scroll":
      return scrollVerb(payload, session);
    case "back":
      await browserHost.goBack(session);
      return { ok: true, data: await browserHost.getState(session) };
    case "forward":
      await browserHost.goForward(session);
      return { ok: true, data: await browserHost.getState(session) };
    case "reload":
      await browserHost.reload(session);
      return { ok: true, data: await browserHost.getState(session) };
    default:
      return { ok: false, error: `Unsupported browser verb: ${verb}` };
  }
}

async function navigateVerb(
  payload: Record<string, unknown>,
  session: string | undefined,
): Promise<VerbResult> {
  // Pane rules: public web plus loopback (previewing local dev servers is the
  // pane's main job); other private ranges are opt-in via the desktop's
  // allow-private switch. The same policy is re-applied — with DNS pinning —
  // to every request the page then makes; see browser-host/network-policy.ts.
  const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""), paneUrlOptions());
  if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
  const result = await browserHost.navigate(url, session);
  return { ok: true, data: result };
}

async function scrollVerb(
  payload: Record<string, unknown>,
  session: string | undefined,
): Promise<VerbResult> {
  const deltaY = Number(payload.deltaY ?? 0);
  const result = await browserHost.scroll(
    { deltaY: Number.isFinite(deltaY) ? deltaY : 0 },
    session,
  );
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

// Chromium-unavailable fallbacks. navigate/get-url/get-text/get-html degrade to
// reading mode (remembering the last navigated URL per process so reads work
// without a url arg); every other verb returns the clear unavailable error. The
// fallback honors pane rules (public + loopback) so local dev servers stay
// previewable even when there's no headless Chromium to drive a full surface.
async function fallbackVerb(
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<VerbResult> {
  if (verb === "navigate") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""), paneUrlOptions());
    if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
    const reader = await fetchReadable(url, signal);
    lastFallbackUrl = reader.url;
    return { ok: true, data: { url: reader.url, title: reader.title, readingMode: true } };
  }
  if (verb === "get-url") {
    return { ok: true, data: { url: lastFallbackUrl, title: "" } };
  }
  if (verb === "get-text" || verb === "get-html") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""), paneUrlOptions()) || lastFallbackUrl;
    if (!url) return { ok: false, error: unavailableError() };
    const reader = await fetchReadable(url, signal);
    lastFallbackUrl = reader.url;
    return verb === "get-text"
      ? { ok: true, data: { text: reader.text, readingMode: true } }
      : { ok: true, data: { html: reader.markdown ?? reader.text, readingMode: true } };
  }
  return { ok: false, error: unavailableError() };
}

export async function handleBrowserFetch(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return Response.json({ error: "url is required" }, { status: 400 });
  try {
    const result = await fetchReadable(raw, request.signal);
    return Response.json(result);
  } catch (error) {
    const message = errorMessage(error, "Fetch failed");
    // Only the initial url-rejection is a client error (400); resolved-host,
    // redirect, and upstream failures are bad-gateway (502) like before.
    const status = message.startsWith("url rejected") ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

// ─── GET /api/agent/browser/frame ─────────────────────────────────────────
//
// Frame poll for the visible browser panel (~10fps JSON poll instead of SSE:
// Next's standalone server buffers locally-built event streams, and polling
// survives buffering proxies for remote deploys).

export async function handleBrowserFrame(): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: unavailableError() }, { status: 503 });
  }
  try {
    const { frame, state } = await browserHost.pollFrame();
    return Response.json({
      ok: true,
      data: {
        frame: frame?.data ?? null,
        url: state.url,
        title: state.title,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: errorMessage(error, "frame poll failed"),
    });
  }
}

type InputBody =
  | ({ kind: "mouse" } & Omit<MouseInput, "type"> & { type: MouseInput["type"] })
  | ({ kind: "wheel" } & Omit<MouseInput, "type">)
  | ({ kind: "key" } & KeyInput);

export async function handleBrowserInput(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: InputBody;
  try {
    body = (await request.json()) as InputBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await dispatchInput(body);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({
      ok: false,
      error: errorMessage(error, "input dispatch failed"),
    });
  }
}

async function dispatchInput(body: InputBody): Promise<void> {
  if (body.kind === "key") {
    await browserHost.dispatchKey({
      type: body.type,
      key: body.key,
      code: body.code,
    });
    return;
  }
  if (body.kind === "wheel") {
    await browserHost.dispatchMouse({
      type: "wheel",
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      deltaX: body.deltaX,
      deltaY: body.deltaY,
    });
    return;
  }
  await browserHost.dispatchMouse({
    type: body.type,
    x: Number(body.x) || 0,
    y: Number(body.y) || 0,
    button: body.button,
    clickCount: body.clickCount,
  });
}

// ─── GET /api/agent/browser/localhosts ────────────────────────────────────
//
// Discovers locally listening HTTP dev servers for the browser panel's
// localhost picker.

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 650;
const LSOF_TIMEOUT_MS = 2_500;
const MAX_CANDIDATES = 48;
const FALLBACK_PORTS = [3000, 3001, 3002, 3017, 4173, 5173, 5174, 8000, 8080, 8317, 1234];

type PortCandidate = {
  port: number;
  process?: string;
};

type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

function parseCurrentPort(request: Request): number | null {
  const host = request.headers.get("host") ?? "";
  const match = host.match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;
  return Number.isFinite(port) ? port : null;
}

function titleFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  // &amp; decodes last, or "&amp;lt;" round-trips into a phantom "<".
  return title
    ? title
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
    : "";
}

function parseLsof(stdout: string): PortCandidate[] {
  const byPort = new Map<number, PortCandidate>();
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const listenMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (!listenMatch) continue;
    const port = Number(listenMatch[1]);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
    const processName = line.trim().split(/\s+/)[0];
    if (!byPort.has(port)) byPort.set(port, { port, process: processName });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port).slice(0, MAX_CANDIDATES);
}

async function listListeningPorts(): Promise<PortCandidate[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const ports = parseLsof(stdout);
    if (ports.length > 0) return ports;
  } catch {
    // Fall through to common dev-server ports.
  }
  return FALLBACK_PORTS.map((port) => ({ port }));
}

async function probePort(
  candidate: PortCandidate,
  currentPort: number | null,
): Promise<LocalhostSite | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const url = `http://127.0.0.1:${candidate.port}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    let title = "";
    if (contentType.includes("text/html")) {
      title = titleFromHtml((await response.text()).slice(0, 64_000));
    }
    const displayUrl = `localhost:${candidate.port}`;
    return {
      port: candidate.port,
      url: `http://${displayUrl}`,
      displayUrl,
      title: title || displayUrl,
      process: candidate.process,
      current: candidate.port === currentPort,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleBrowserLocalhosts(request: Request): Promise<Response> {
  const currentPort = parseCurrentPort(request);
  const candidates = await listListeningPorts();
  const probed = await Promise.all(
    candidates.map((candidate) => probePort(candidate, currentPort)),
  );
  const sites = probed
    .filter((site): site is LocalhostSite => Boolean(site))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return a.port - b.port;
    });
  return Response.json({ sites });
}

// ─── GET /api/agent/browser/state ─────────────────────────────────────────

export async function handleBrowserState(): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  try {
    return Response.json({ ok: true, data: await browserHost.peekState() });
  } catch (error) {
    return Response.json({
      ok: false,
      error: errorMessage(error, "getState failed"),
    });
  }
}

// ─── POST /api/agent/browser/viewport ─────────────────────────────────────
//
// Sets the headless Chromium viewport so it matches the visible panel's
// dimensions. Body: { width, height }.

export async function handleBrowserViewport(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: { width?: unknown; height?: unknown };
  try {
    body = (await request.json()) as { width?: unknown; height?: unknown };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Response.json({ ok: false, error: "width and height are required" }, { status: 400 });
  }
  try {
    await browserHost.setViewport(width, height);
    return Response.json({
      ok: true,
      data: { width: Math.round(width), height: Math.round(height) },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: errorMessage(error, "setViewport failed"),
    });
  }
}

// ─── GET /api/agent/browser/history ───────────────────────────────────────
//
// The computer-use log: every browser action this runtime performed, model- or
// panel-driven. `?limit=` bounds the reply; `?visited=1` collapses it to the
// distinct pages in visit order.

export async function handleBrowserHistory(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? 50);
  const visitedOnly = params.get("visited") === "1";
  return Response.json({
    ok: true,
    data: visitedOnly
      ? { visited: browserHistory.visitedUrls(limit) }
      : { entries: browserHistory.list(limit) },
  });
}

// ─── GET /api/agent/browser/engines · POST /api/agent/browser/engine ──────
//
// Which Chromium-family binary the embedded browser drives. GET reports what is
// installed and what is running; POST persists a choice and drops the live
// context so the next action relaunches on the new engine.

function enginesPayload() {
  const preference = readEnginePreference();
  const engines = listBrowserEngines();
  const active = playwrightManager.activeEngine();
  const chosen = engines.find((engine) => engine.id === preference);
  return {
    preference,
    // True when the user picked a browser that is not installed here, so the UI
    // can say "Brave not found — running Chromium" instead of quietly lying.
    preferenceUnavailable: preference !== "auto" && !chosen?.path,
    override: explicitBinaryOverride(),
    active: active
      ? { id: active.id, label: active.label, path: active.path, source: active.source }
      : null,
    unavailableReason: active ? null : unavailableError(),
    engines,
  };
}

export async function handleBrowserEngines(): Promise<Response> {
  return Response.json({ ok: true, data: enginesPayload() });
}

export async function handleBrowserEngineSelect(request: Request): Promise<Response> {
  let body: { engine?: unknown };
  try {
    body = (await request.json()) as { engine?: unknown };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!isBrowserEngineId(body.engine)) {
    return Response.json({ ok: false, error: "unknown browser engine" }, { status: 400 });
  }
  try {
    writeEnginePreference(body.engine);
  } catch (error) {
    return Response.json({
      ok: false,
      error: errorMessage(error, "failed to save browser engine"),
    });
  }
  // The running context is bound to the old binary; the next verb relaunches.
  browserHost.stop();
  return Response.json({ ok: true, data: enginesPayload() });
}
