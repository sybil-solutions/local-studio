import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Schema } from "effect";
import {
  BROWSER_SESSION_HEADER,
  decodeBrowserSessionKey,
  type BrowserSessionKey,
} from "../browser-session-contract";
import {
  browserNavigation,
  type BrowserNavigation,
} from "../../../../shared/agent/sanitize-embedded-browser-url";
import {
  BrowserHost,
  browserHost,
  type BrowserFallbackResult,
} from "../browser-host/browser-host";
import { fetchReadable } from "../browser-host/reader";

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
const VerbPayloadSchema = Schema.Record(Schema.String, Schema.Unknown);

export function browserSessionKeyFromRequest(request: Request): BrowserSessionKey {
  return decodeBrowserSessionKey(request.headers.get(BROWSER_SESSION_HEADER));
}

function invalidBrowserSession(): Response {
  return Response.json(
    { ok: false, error: `A valid ${BROWSER_SESSION_HEADER} header is required` },
    { status: 400 },
  );
}

type BrowserSessionResult =
  | { type: "invalid"; response: Response }
  | { type: "valid"; session: BrowserSessionKey };

function requestBrowserSession(request: Request): BrowserSessionResult {
  try {
    return { type: "valid", session: browserSessionKeyFromRequest(request) };
  } catch {
    return { type: "invalid", response: invalidBrowserSession() };
  }
}

export async function handleBrowserVerb(
  request: Request,
  verb: string,
  host: BrowserHost = browserHost,
  reader: typeof fetchReadable = fetchReadable,
): Promise<Response> {
  const sessionResult = requestBrowserSession(request);
  if (sessionResult.type === "invalid") return sessionResult.response;
  const { session } = sessionResult;
  if (!ALLOWED_VERBS.has(verb)) {
    return Response.json({ ok: false, error: `Unknown browser verb: ${verb}` }, { status: 400 });
  }
  try {
    const payload = await readPayload(request);
    const result = await dispatchVerb(host, session, verb, payload, reader);
    return Response.json(result);
  } catch (error) {
    const payloadError = error instanceof BrowserPayloadError;
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Browser command failed",
      },
      payloadError ? { status: 400 } : undefined,
    );
  }
}

class BrowserPayloadError extends Error {}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text.trim()) return {};
    const body = Schema.decodeUnknownSync(VerbPayloadSchema)(JSON.parse(text));
    if (Object.hasOwn(body, "sessionId")) {
      throw new BrowserPayloadError(`Use ${BROWSER_SESSION_HEADER} instead of body sessionId`);
    }
    return body;
  } catch (error) {
    if (error instanceof BrowserPayloadError) throw error;
    throw new BrowserPayloadError("Invalid browser command JSON");
  }
}

async function dispatchVerb(
  host: BrowserHost,
  session: BrowserSessionKey,
  verb: string,
  payload: Record<string, unknown>,
  reader: typeof fetchReadable,
): Promise<VerbResult> {
  if (!host.isAvailable()) return fallbackVerb(host, session, verb, payload, reader);
  try {
    return await runHostVerb(host, session, verb, payload);
  } catch (error) {
    // A launch/connection failure for the reading verbs still degrades to
    // reading mode rather than failing the tool call outright.
    if (verb === "navigate" || verb === "get-text") {
      return fallbackVerb(host, session, verb, payload, reader);
    }
    throw error;
  }
}

async function runHostVerb(
  host: BrowserHost,
  session: BrowserSessionKey,
  verb: string,
  payload: Record<string, unknown>,
): Promise<VerbResult> {
  switch (verb) {
    case "navigate":
      return navigateVerb(host, session, payload);
    case "get-url":
      return { ok: true, data: await host.getUrl(session) };
    case "get-text":
      return { ok: true, data: { text: await host.getText(session) } };
    case "get-html":
      return { ok: true, data: { html: await host.getHtml(session) } };
    case "screenshot":
      return { ok: true, data: { dataUri: await host.screenshot(session) } };
    case "click":
      return selectorVerb(await host.click(session, { selector: requireSelector(payload) }));
    case "fill":
      return selectorVerb(
        await host.fill(session, {
          selector: requireSelector(payload),
          value: String(payload.value ?? ""),
        }),
      );
    case "scroll":
      return scrollVerb(host, session, payload);
    case "back":
      await host.goBack(session);
      return { ok: true, data: await host.getState(session) };
    case "forward":
      await host.goForward(session);
      return { ok: true, data: await host.getState(session) };
    case "reload":
      await host.reload(session);
      return { ok: true, data: await host.getState(session) };
    default:
      return { ok: false, error: `Unsupported browser verb: ${verb}` };
  }
}

async function navigateVerb(
  host: BrowserHost,
  session: BrowserSessionKey,
  payload: Record<string, unknown>,
): Promise<VerbResult> {
  // Pane rules: public web plus loopback (previewing local dev servers is the
  // pane's main job); other private ranges stay blocked.
  const navigation = browserNavigation(String(payload.url ?? ""));
  if (!navigation) return { ok: false, error: "valid public or localhost http(s) url required" };
  const result = await host.navigate(session, navigation.url);
  return { ok: true, data: result };
}

async function scrollVerb(
  host: BrowserHost,
  session: BrowserSessionKey,
  payload: Record<string, unknown>,
): Promise<VerbResult> {
  const deltaY = Number(payload.deltaY ?? 0);
  const result = await host.scroll(session, { deltaY: Number.isFinite(deltaY) ? deltaY : 0 });
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
  host: BrowserHost,
  session: BrowserSessionKey,
  verb: string,
  payload: Record<string, unknown>,
  reader: typeof fetchReadable,
): Promise<VerbResult> {
  if (verb !== "navigate" && verb !== "get-url" && verb !== "get-text" && verb !== "get-html") {
    return { ok: false, error: UNAVAILABLE_ERROR };
  }
  return host.withFallbackSession(session, (fallback) =>
    fallbackSessionVerb(verb, payload, fallback, reader),
  );
}

async function fallbackSessionVerb(
  verb: string,
  payload: Record<string, unknown>,
  fallback: BrowserNavigation | null,
  reader: typeof fetchReadable,
): Promise<BrowserFallbackResult<VerbResult>> {
  if (verb === "navigate") {
    const navigation = browserNavigation(String(payload.url ?? ""));
    if (!navigation) {
      return { result: { ok: false, error: "valid public or localhost http(s) url required" } };
    }
    const result = await reader(navigation.url, navigation.mode);
    return {
      navigation: { mode: navigation.mode, url: result.url },
      result: {
        ok: true,
        data: { url: result.url, title: result.title, readingMode: true },
      },
    };
  }
  if (verb === "get-url") {
    return { result: { ok: true, data: { url: fallback?.url ?? "", title: "" } } };
  }
  if (verb === "get-text" || verb === "get-html") {
    const requested = browserNavigation(String(payload.url ?? ""));
    const navigation = requested ?? fallback;
    if (!navigation) return { result: { ok: false, error: UNAVAILABLE_ERROR } };
    const result = await reader(navigation.url, navigation.mode);
    return {
      navigation: { mode: navigation.mode, url: result.url },
      result:
        verb === "get-text"
          ? { ok: true, data: { text: result.text, readingMode: true } }
          : { ok: true, data: { html: result.markdown ?? result.text, readingMode: true } },
    };
  }
  return { result: { ok: false, error: UNAVAILABLE_ERROR } };
}

export async function handleBrowserFetch(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return Response.json({ error: "url is required" }, { status: 400 });
  try {
    const result = await fetchReadable(raw);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
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

export async function handleBrowserFrame(
  request: Request,
  host: BrowserHost = browserHost,
): Promise<Response> {
  const sessionResult = requestBrowserSession(request);
  if (sessionResult.type === "invalid") return sessionResult.response;
  const { session } = sessionResult;
  if (!host.isAvailable()) {
    return Response.json({ ok: false, error: UNAVAILABLE_ERROR }, { status: 503 });
  }
  try {
    const { frame, state } = await host.pollFrame(session);
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
      error: error instanceof Error ? error.message : "frame poll failed",
    });
  }
}

const MouseButtonSchema = Schema.Union([
  Schema.Literal("left"),
  Schema.Literal("right"),
  Schema.Literal("middle"),
]);
const MouseTypeSchema = Schema.Union([
  Schema.Literal("down"),
  Schema.Literal("up"),
  Schema.Literal("move"),
]);
const KeyTypeSchema = Schema.Union([
  Schema.Literal("down"),
  Schema.Literal("up"),
  Schema.Literal("char"),
]);
const InputBodySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("mouse"),
    type: MouseTypeSchema,
    x: Schema.Number,
    y: Schema.Number,
    button: Schema.optional(MouseButtonSchema),
    clickCount: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal("wheel"),
    x: Schema.Number,
    y: Schema.Number,
    deltaX: Schema.optional(Schema.Number),
    deltaY: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal("key"),
    type: KeyTypeSchema,
    key: Schema.String,
    code: Schema.String,
    text: Schema.optional(Schema.String),
  }),
]);
type InputBody = typeof InputBodySchema.Type;

export async function handleBrowserInput(
  request: Request,
  host: BrowserHost = browserHost,
): Promise<Response> {
  const sessionResult = requestBrowserSession(request);
  if (sessionResult.type === "invalid") return sessionResult.response;
  const { session } = sessionResult;
  if (!host.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: InputBody;
  try {
    body = Schema.decodeUnknownSync(InputBodySchema)(await request.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await dispatchInput(host, session, body);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "input dispatch failed",
    });
  }
}

async function dispatchInput(
  host: BrowserHost,
  session: BrowserSessionKey,
  body: InputBody,
): Promise<void> {
  if (body.kind === "key") {
    await host.dispatchKey(session, {
      type: body.type,
      key: body.key,
      code: body.code,
      text: body.text,
    });
    return;
  }
  if (body.kind === "wheel") {
    await host.dispatchMouse(session, {
      type: "wheel",
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      deltaX: body.deltaX,
      deltaY: body.deltaY,
    });
    return;
  }
  await host.dispatchMouse(session, {
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
  return title
    ? title
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
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

export async function handleBrowserState(
  request: Request,
  host: BrowserHost = browserHost,
): Promise<Response> {
  const sessionResult = requestBrowserSession(request);
  if (sessionResult.type === "invalid") return sessionResult.response;
  const { session } = sessionResult;
  if (!host.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  try {
    return Response.json({ ok: true, data: await host.getState(session) });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "getState failed",
    });
  }
}

// ─── POST /api/agent/browser/viewport ─────────────────────────────────────
//
// Sets the headless Chromium viewport so it matches the visible panel's
// dimensions. Body: { width, height }.

const ViewportBodySchema = Schema.Struct({ width: Schema.Number, height: Schema.Number });

export async function handleBrowserViewport(
  request: Request,
  host: BrowserHost = browserHost,
): Promise<Response> {
  const sessionResult = requestBrowserSession(request);
  if (sessionResult.type === "invalid") return sessionResult.response;
  const { session } = sessionResult;
  if (!host.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: typeof ViewportBodySchema.Type;
  try {
    body = Schema.decodeUnknownSync(ViewportBodySchema)(await request.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Response.json({ ok: false, error: "width and height are required" }, { status: 400 });
  }
  try {
    await host.setViewport(session, width, height);
    return Response.json({
      ok: true,
      data: { width: Math.round(width), height: Math.round(height) },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "setViewport failed",
    });
  }
}
