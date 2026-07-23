import assert from "node:assert/strict";
import test from "node:test";
import { BROWSER_SESSION_HEADER, decodeBrowserSessionKey } from "../browser-session-contract";
import { BrowserHost, type BrowserHostManager } from "../browser-host/browser-host";
import { fetchReadable, type ReaderResult } from "../browser-host/reader";
import type { BrowserNetworkMode } from "../../../../shared/agent/sanitize-embedded-browser-url";
import {
  browserSessionKeyFromRequest,
  handleBrowserFetch,
  handleBrowserFrame,
  handleBrowserInput,
  handleBrowserLocalhosts,
  handleBrowserState,
  handleBrowserVerb,
  handleBrowserViewport,
} from "./browser-handlers";

class CountingManager implements BrowserHostManager {
  touches = 0;

  ensure(_mode: BrowserNetworkMode, _scope: string): Promise<never> {
    this.touches += 1;
    return Promise.reject(new Error("Unexpected context creation"));
  }

  isAvailable(): boolean {
    this.touches += 1;
    return false;
  }

  release(_scope: string): Promise<void> {
    this.touches += 1;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

function request(path: string, method: "GET" | "POST", session?: string, body?: string): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: session === undefined ? undefined : { [BROWSER_SESSION_HEADER]: session },
    body: method === "POST" ? (body ?? "{}") : undefined,
  });
}

function readable(url: string): ReaderResult {
  return { contentType: "text/plain", text: url, title: url, url };
}

function deferredReadable(): {
  fetch: typeof fetchReadable;
  reject: (error: Error) => void;
  resolve: (url: string) => void;
  started: Promise<void>;
} {
  const completed = Promise.withResolvers<ReaderResult>();
  const started = Promise.withResolvers<void>();
  return {
    fetch: async () => {
      started.resolve();
      return completed.promise;
    },
    reject: completed.reject,
    resolve: (url) => completed.resolve(readable(url)),
    started: started.promise,
  };
}

function navigateRequest(session: string, url: string): Request {
  return request(
    "/api/agent/browser/navigate",
    "POST",
    session,
    JSON.stringify({ url }),
  );
}

function getTextRequest(session: string): Request {
  return request("/api/agent/browser/get-text", "POST", session);
}

function getUrlRequest(session: string): Request {
  return request("/api/agent/browser/get-url", "POST", session);
}

async function statefulResponses(host: BrowserHost, session?: string): Promise<Response[]> {
  const verbs = [
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
  ];
  return Promise.all([
    ...verbs.map((verb) =>
      handleBrowserVerb(request(`/api/agent/browser/${verb}`, "POST", session, "{}"), verb, host),
    ),
    handleBrowserFrame(request("/api/agent/browser/frame", "GET", session), host),
    handleBrowserState(request("/api/agent/browser/state", "GET", session), host),
    handleBrowserInput(
      request(
        "/api/agent/browser/input",
        "POST",
        session,
        JSON.stringify({ kind: "mouse", type: "move", x: 1, y: 1 }),
      ),
      host,
    ),
    handleBrowserViewport(
      request(
        "/api/agent/browser/viewport",
        "POST",
        session,
        JSON.stringify({ width: 800, height: 600 }),
      ),
      host,
    ),
  ]);
}

test("every stateful endpoint rejects missing and malformed session headers before host access", async () => {
  for (const value of [undefined, "", "bad key", "é", "a".repeat(129), "session-a,session-b"]) {
    const manager = new CountingManager();
    const host = new BrowserHost(manager);
    const responses = await statefulResponses(host, value);
    assert.equal(responses.length, 15);
    assert.deepEqual(
      responses.map((response) => response.status),
      Array(15).fill(400),
    );
    assert.equal(manager.touches, 0);
    await host.stop();
  }
});

test("session schema accepts exact boundaries and rejects unstable ASCII", () => {
  assert.equal(decodeBrowserSessionKey("a"), "a");
  assert.equal(decodeBrowserSessionKey("a".repeat(128)), "a".repeat(128));
  for (const value of [
    null,
    "",
    "a".repeat(129),
    " leading",
    "trailing ",
    "a/b",
    "a\u0000b",
    "☃",
  ]) {
    assert.throws(() => decodeBrowserSessionKey(value));
  }
  assert.equal(
    browserSessionKeyFromRequest(request("/api/agent/browser/state", "GET", "session-a")),
    "session-a",
  );
});

test("body session affinity is rejected in favor of the canonical header", async () => {
  const manager = new CountingManager();
  const host = new BrowserHost(manager);
  const response = await handleBrowserVerb(
    request(
      "/api/agent/browser/navigate",
      "POST",
      "session-a",
      JSON.stringify({ sessionId: "session-b", url: "https://example.com" }),
    ),
    "navigate",
    host,
  );
  assert.equal(response.status, 400);
  assert.equal(manager.touches, 0);
  await host.stop();
});

test("stateless fetch ignores browser session headers", async () => {
  const response = await handleBrowserFetch(
    request("/api/agent/browser/fetch", "GET", "malformed session"),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "url is required" });
});

test("stateless localhost discovery ignores browser session headers", async () => {
  const response = await handleBrowserLocalhosts(
    request("/api/agent/browser/localhosts", "GET", "malformed session"),
  );
  assert.equal(response.status, 200);
});

test("deferred fallback reads retain their session through idle cleanup", async () => {
  const manager = new CountingManager();
  let now = 0;
  const host = new BrowserHost(manager, {
    config: { idleMs: 60_000, maxSessions: 1 },
    now: () => now,
  });
  const initialUrl = "https://public.test/initial";
  await handleBrowserVerb(
    navigateRequest("session-a", initialUrl),
    "navigate",
    host,
    async (url) => readable(url),
  );
  const reader = deferredReadable();
  const pending = handleBrowserVerb(
    getTextRequest("session-a"),
    "get-text",
    host,
    reader.fetch,
  );
  await reader.started;
  now = 60_001;
  await host.cleanupIdleSessions();
  reader.reject(new Error("deferred failure"));
  await pending;
  const current = await handleBrowserVerb(getUrlRequest("session-a"), "get-url", host);
  const body = await current.json();
  await host.stop();
  assert.deepEqual(body, { ok: true, data: { title: "", url: initialUrl } });
});

test("release waits for a deferred fallback fetch", async () => {
  const manager = new CountingManager();
  const host = new BrowserHost(manager);
  const reader = deferredReadable();
  const pending = handleBrowserVerb(
    navigateRequest("session-a", "https://public.test/pending"),
    "navigate",
    host,
    reader.fetch,
  );
  await reader.started;
  let released = false;
  const releasing = host.releaseSession("session-a").then(() => {
    released = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const releasedWhilePending = released;
  reader.resolve("https://public.test/pending");
  await Promise.all([pending, releasing]);
  await host.stop();
  assert.equal(releasedWhilePending, false);
});

test("a deferred fallback fetch holds its session capacity", async () => {
  const manager = new CountingManager();
  const host = new BrowserHost(manager, { config: { idleMs: 60_000, maxSessions: 1 } });
  const reader = deferredReadable();
  const pending = handleBrowserVerb(
    navigateRequest("session-a", "https://public.test/pending"),
    "navigate",
    host,
    reader.fetch,
  );
  await reader.started;
  const blocked = await handleBrowserVerb(getUrlRequest("session-b"), "get-url", host);
  const body = await blocked.json();
  reader.resolve("https://public.test/pending");
  await pending;
  await host.stop();
  assert.deepEqual(body, {
    error: "Browser session capacity reached while all sessions are active",
    ok: false,
  });
});

test("later fallback navigation remains authoritative after an earlier fetch completes", async () => {
  const manager = new CountingManager();
  const host = new BrowserHost(manager);
  const firstUrl = "https://public.test/first";
  const secondUrl = "https://public.test/second";
  const firstReader = deferredReadable();
  let secondStarted = false;
  const reader: typeof fetchReadable = async (url) => {
    if (url === firstUrl) return firstReader.fetch(url);
    secondStarted = true;
    return readable(url);
  };
  const first = handleBrowserVerb(
    navigateRequest("session-a", firstUrl),
    "navigate",
    host,
    reader,
  );
  await firstReader.started;
  const second = handleBrowserVerb(
    navigateRequest("session-a", secondUrl),
    "navigate",
    host,
    reader,
  );
  await handleBrowserVerb(getUrlRequest("session-b"), "get-url", host);
  const secondStartedBeforeFirstCompleted = secondStarted;
  firstReader.resolve(firstUrl);
  await Promise.all([first, second]);
  const current = await handleBrowserVerb(getUrlRequest("session-a"), "get-url", host);
  const body = await current.json();
  await host.stop();
  assert.equal(secondStartedBeforeFirstCompleted, false);
  assert.deepEqual(body, { ok: true, data: { title: "", url: secondUrl } });
});
