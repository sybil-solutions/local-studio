import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  createBrowserLiveStore,
  type BrowserLiveTransport,
} from "../src/features/agent/ui/agent-browser-live-store";

const A = "http://page.test/a";
const B = "http://page.test/b";
const C = "http://page.test/c";
const SESSION = "session-a";

function frame(url: string) {
  return {
    status: 200,
    body: {
      ok: true,
      data: {
        frame: Buffer.from(url).toString("base64"),
        url,
        title: url === A ? "A" : url === B ? "B" : "",
        canGoBack: false,
        canGoForward: false,
      },
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        if (predicate()) return;
        yield* Effect.sleep(2);
      }
      return yield* Effect.fail(new Error("Timed out waiting for browser store state"));
    }),
  );
}

function harness(initialUrl: string) {
  let hostUrl = initialUrl;
  const navigations: string[] = [];
  const transport: BrowserLiveTransport = {
    frame: async () => frame(hostUrl),
    navigate: async (_session, url) => {
      navigations.push(url);
      hostUrl = url;
      return { status: 200, body: { ok: true, data: { url } } };
    },
  };
  const store = createBrowserLiveStore({ pollIntervalMs: 2, transport });
  store.focus(SESSION);
  return {
    host: (url: string) => {
      hostUrl = url;
    },
    navigations,
    store,
  };
}

test("agent navigation leaves the initial start page through observed host state", async () => {
  const { host, navigations, store } = harness("about:blank");
  const unsubscribe = store.subscribeState(() => undefined);
  try {
    await waitFor(() => store.getStateSnapshot().hydrated);
    host(B);
    await waitFor(() => store.getStateSnapshot().location?.url === B);
    assert.equal(store.getStateSnapshot().state?.url, B);
    assert.deepEqual(navigations, []);
  } finally {
    unsubscribe();
  }
});

test("remount hydrates agent navigation without replaying the cached visible URL", async () => {
  const { host, navigations, store } = harness(A);
  const unsubscribeA = store.subscribeState(() => undefined);
  await waitFor(() => store.getStateSnapshot().location?.url === A);
  unsubscribeA();
  assert.equal(store.getStateSnapshot().hydrated, false);
  host(B);
  const unsubscribeB = store.subscribeState(() => undefined);
  try {
    await waitFor(() => store.getStateSnapshot().location?.url === B);
    assert.equal(store.getStateSnapshot().state?.url, B);
    assert.deepEqual(navigations, []);
  } finally {
    unsubscribeB();
  }
});

test("remount keeps location blocked until explicit navigation settles", async () => {
  let hostUrl = "about:blank";
  const request = Promise.withResolvers<{ status: number; body: unknown }>();
  const store = createBrowserLiveStore({
    pollIntervalMs: 2,
    transport: {
      frame: async () => frame(hostUrl),
      navigate: async (_session, url) => {
        const response = await request.promise;
        hostUrl = url;
        return response;
      },
    },
  });
  store.focus(SESSION);
  const unsubscribeA = store.subscribeState(() => undefined);
  await waitFor(() => store.getStateSnapshot().hydrated);
  const navigation = store.navigate(A);
  unsubscribeA();
  const unsubscribeB = store.subscribeState(() => undefined);
  try {
    await waitFor(() => store.getStateSnapshot().hydrated);
    assert.equal(store.getStateSnapshot().state?.url, "about:blank");
    assert.equal(store.getStateSnapshot().location, null);
    request.resolve({ status: 200, body: { ok: true, data: { url: A } } });
    await navigation;
    await waitFor(() => store.getStateSnapshot().location?.url === A);
    assert.equal(store.getStateSnapshot().state?.url, A);
  } finally {
    unsubscribeB();
  }
});

test("navigation settles against the host redirect destination", async () => {
  let hostUrl = "about:blank";
  const store = createBrowserLiveStore({
    pollIntervalMs: 2,
    transport: {
      frame: async () => frame(hostUrl),
      navigate: async () => {
        hostUrl = C;
        return { status: 200, body: { ok: true, data: { url: C } } };
      },
    },
  });
  store.focus(SESSION);
  const unsubscribe = store.subscribeState(() => undefined);
  try {
    await waitFor(() => store.getStateSnapshot().hydrated);
    await store.navigate(A);
    await waitFor(() => store.getStateSnapshot().location?.url === C);
    assert.equal(store.getStateSnapshot().state?.url, C);
  } finally {
    unsubscribe();
  }
});

test("explicit navigation dispatches in issue order and finishes at the latest target", async () => {
  let hostUrl = "about:blank";
  const dispatches: string[] = [];
  const requests = new Map<string, PromiseWithResolvers<{ status: number; body: unknown }>>();
  const store = createBrowserLiveStore({
    pollIntervalMs: 2,
    transport: {
      frame: async () => frame(hostUrl),
      navigate: async (_session, url) => {
        dispatches.push(url);
        const request = Promise.withResolvers<{ status: number; body: unknown }>();
        requests.set(url, request);
        const response = await request.promise;
        hostUrl = url;
        return response;
      },
    },
  });
  store.focus(SESSION);
  const unsubscribe = store.subscribeState(() => undefined);
  try {
    await waitFor(() => store.getStateSnapshot().hydrated);
    const navigateA = store.navigate(A);
    const navigateB = store.navigate(B);
    await waitFor(() => requests.has(A));
    assert.deepEqual(dispatches, [A]);
    assert.equal(requests.has(B), false);
    requests.get(A)?.resolve({ status: 200, body: { ok: true, data: { url: A } } });
    await navigateA;
    await waitFor(() => requests.has(B));
    await waitFor(() => store.getStateSnapshot().state?.url === A);
    assert.notEqual(store.getStateSnapshot().location?.url, A);
    requests.get(B)?.resolve({ status: 200, body: { ok: true, data: { url: B } } });
    await navigateB;
    await waitFor(() => store.getStateSnapshot().location?.url === B);
    assert.deepEqual(dispatches, [A, B]);
    assert.equal(hostUrl, B);
    assert.equal(store.getStateSnapshot().state?.url, B);
  } finally {
    unsubscribe();
  }
});

test("first poll after navigation settlement accepts an immediate redirect", async () => {
  let hostUrl = "about:blank";
  const frames: PromiseWithResolvers<{ status: number; body: unknown }>[] = [];
  const store = createBrowserLiveStore({
    pollIntervalMs: 2,
    transport: {
      frame: () => {
        const request = Promise.withResolvers<{ status: number; body: unknown }>();
        frames.push(request);
        return request.promise;
      },
      navigate: async (_session, url) => {
        hostUrl = url;
        return { status: 200, body: { ok: true, data: { url } } };
      },
    },
  });
  store.focus(SESSION);
  const unsubscribe = store.subscribeState(() => undefined);
  try {
    await waitFor(() => frames.length === 1);
    frames[0]?.resolve(frame(hostUrl));
    await waitFor(() => store.getStateSnapshot().hydrated);
    await waitFor(() => frames.length === 2);
    await store.navigate(A);
    hostUrl = B;
    frames[1]?.resolve(frame(hostUrl));
    await waitFor(() => frames.length === 3);
    assert.notEqual(store.getStateSnapshot().location?.url, B);
    frames[2]?.resolve(frame(hostUrl));
    await waitFor(() => store.getStateSnapshot().location?.url === B);
    assert.equal(store.getStateSnapshot().state?.url, B);
  } finally {
    unsubscribe();
  }
});

test("failed navigation releases location only to a post-settlement poll", async () => {
  let hostUrl = "about:blank";
  const frames: PromiseWithResolvers<{ status: number; body: unknown }>[] = [];
  const store = createBrowserLiveStore({
    pollIntervalMs: 2,
    transport: {
      frame: () => {
        const request = Promise.withResolvers<{ status: number; body: unknown }>();
        frames.push(request);
        return request.promise;
      },
      navigate: async () => ({ status: 500, body: { ok: false, error: "Navigation failed" } }),
    },
  });
  store.focus(SESSION);
  const unsubscribe = store.subscribeState(() => undefined);
  try {
    await waitFor(() => frames.length === 1);
    frames[0]?.resolve(frame(hostUrl));
    await waitFor(() => store.getStateSnapshot().hydrated);
    await waitFor(() => frames.length === 2);
    await store.navigate(A);
    assert.equal(store.getStateSnapshot().navigationError, "Navigation failed");
    hostUrl = C;
    frames[1]?.resolve(frame(hostUrl));
    await waitFor(() => frames.length === 3);
    assert.notEqual(store.getStateSnapshot().location?.url, C);
    frames[2]?.resolve(frame(hostUrl));
    await waitFor(() => store.getStateSnapshot().location?.url === C);
    assert.equal(store.getStateSnapshot().state?.url, C);
  } finally {
    unsubscribe();
  }
});

test("focused session keys every request and switching aborts old traffic", async () => {
  const frames: Array<{ session: string; signal: AbortSignal }> = [];
  const navigations: Array<{ session: string; url: string; signal: AbortSignal }> = [];
  const store = createBrowserLiveStore({
    pollIntervalMs: 2,
    transport: {
      frame: async (session, signal) => {
        frames.push({ session, signal });
        return frame(session === "session-a" ? A : B);
      },
      navigate: async (session, url, signal) => {
        navigations.push({ session, url, signal });
        return { status: 200, body: { ok: true, data: { url } } };
      },
    },
  });
  const unsubscribe = store.subscribeState(() => undefined);
  try {
    await Effect.runPromise(Effect.sleep(10));
    assert.equal(frames.length, 0);
    await store.navigate(A);
    assert.equal(navigations.length, 0);
    store.focus("session-a");
    await waitFor(() => frames.some((entry) => entry.session === "session-a"));
    await store.navigate(A);
    assert.equal(navigations.at(-1)?.session, "session-a");
    const oldSignal = frames.find((entry) => entry.session === "session-a")?.signal;
    assert.ok(oldSignal);
    store.focus("session-b");
    assert.equal(oldSignal.aborted, true);
    await waitFor(() => frames.some((entry) => entry.session === "session-b"));
    await store.navigate(B);
    assert.equal(navigations.at(-1)?.session, "session-b");
    const requestCount = frames.length + navigations.length;
    store.focus(null);
    await store.navigate(C);
    await Effect.runPromise(Effect.sleep(10));
    assert.equal(frames.length + navigations.length, requestCount);
  } finally {
    unsubscribe();
  }
});

test("an aborted navigation cannot report into the newly focused session", async () => {
  let oldNavigationStarted = false;
  const store = createBrowserLiveStore({
    pollIntervalMs: 2,
    transport: {
      frame: async (_session, signal) => {
        await Effect.runPromise(Effect.sleep(100));
        if (signal.aborted) throw new Error("frame aborted");
        return frame(A);
      },
      navigate: (session, url, signal) => {
        if (session !== "session-a") {
          return Promise.resolve({ status: 200, body: { ok: true, data: { url } } });
        }
        oldNavigationStarted = true;
        return new Promise<{ status: number; body: unknown }>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("old navigation aborted")), {
            once: true,
          });
        });
      },
    },
  });
  store.focus("session-a");
  const oldNavigation = store.navigate(A);
  await waitFor(() => oldNavigationStarted);
  store.focus("session-b");
  const currentNavigation = store.navigate(B);
  await Promise.all([oldNavigation, currentNavigation]);
  assert.equal(store.getStateSnapshot().navigationError, null);
});

test("malformed focus keys never start stateful transport", async () => {
  let requests = 0;
  const store = createBrowserLiveStore({
    pollIntervalMs: 2,
    transport: {
      frame: async () => {
        requests += 1;
        return frame(A);
      },
      navigate: async () => {
        requests += 1;
        return { status: 200, body: { ok: true, data: { url: A } } };
      },
    },
  });
  store.focus("bad key");
  const unsubscribe = store.subscribeState(() => undefined);
  try {
    await store.navigate(A);
    await Effect.runPromise(Effect.sleep(10));
    assert.equal(requests, 0);
  } finally {
    unsubscribe();
  }
});
