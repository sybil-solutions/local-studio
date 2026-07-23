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
    navigate: async (url) => {
      navigations.push(url);
      hostUrl = url;
      return { status: 200, body: { ok: true, data: { url } } };
    },
  };
  return {
    host: (url: string) => {
      hostUrl = url;
    },
    navigations,
    store: createBrowserLiveStore({ pollIntervalMs: 2, transport }),
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
      navigate: async (url) => {
        const response = await request.promise;
        hostUrl = url;
        return response;
      },
    },
  });
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
      navigate: async (url) => {
        dispatches.push(url);
        const request = Promise.withResolvers<{ status: number; body: unknown }>();
        requests.set(url, request);
        const response = await request.promise;
        hostUrl = url;
        return response;
      },
    },
  });
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
      navigate: async (url) => {
        hostUrl = url;
        return { status: 200, body: { ok: true, data: { url } } };
      },
    },
  });
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
