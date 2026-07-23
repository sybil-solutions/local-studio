"use client";

import { useSyncExternalStore } from "react";
import { Effect, Fiber, Schedule, Schema, Semaphore } from "effect";
import { browserLocationUpdate } from "@/features/agent/ui/agent-browser-location";

export type BrowserPaneState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type BrowserLiveStateSnapshot = {
  hydrated: boolean;
  state: BrowserPaneState | null;
  location: { revision: number; url: string } | null;
  navigationError: string | null;
  unavailable: string | null;
};

export type BrowserLiveFrameSnapshot = {
  frame: string | null;
};

type BrowserTransportResponse = {
  status: number;
  body: unknown;
};

export type BrowserLiveTransport = {
  frame: () => Promise<BrowserTransportResponse>;
  navigate: (url: string) => Promise<BrowserTransportResponse>;
};

export type BrowserLiveStore = {
  getFrameSnapshot: () => BrowserLiveFrameSnapshot;
  getStateSnapshot: () => BrowserLiveStateSnapshot;
  navigate: (url: string) => Promise<void>;
  subscribeFrame: (listener: () => void) => () => void;
  subscribeState: (listener: () => void) => () => void;
};

type BrowserLiveStoreOptions = {
  pollIntervalMs?: number;
  transport?: BrowserLiveTransport;
};

const BrowserPaneStateSchema = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
});
const BrowserFrameResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  data: Schema.optional(
    Schema.Struct({
      frame: Schema.NullOr(Schema.String),
      ...BrowserPaneStateSchema.fields,
    }),
  ),
});
const BrowserActionResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Struct({ url: Schema.optional(Schema.String) })),
});
const EMPTY_STATE: BrowserLiveStateSnapshot = {
  hydrated: false,
  state: null,
  location: null,
  navigationError: null,
  unavailable: null,
};
const EMPTY_FRAME: BrowserLiveFrameSnapshot = { frame: null };
const POLL_INTERVAL_MS = 110;

async function request(path: string, init?: RequestInit): Promise<BrowserTransportResponse> {
  const response = await fetch(path, init);
  return { status: response.status, body: await response.json() };
}

const defaultTransport: BrowserLiveTransport = {
  frame: () => request("/api/agent/browser/frame", { cache: "no-store" }),
  navigate: (url) =>
    request("/api/agent/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
};

function samePaneState(left: BrowserPaneState | null, right: BrowserPaneState): boolean {
  return (
    left?.url === right.url &&
    left.title === right.title &&
    left.canGoBack === right.canGoBack &&
    left.canGoForward === right.canGoForward
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Browser command failed";
}

export function createBrowserLiveStore({
  pollIntervalMs = POLL_INTERVAL_MS,
  transport = defaultTransport,
}: BrowserLiveStoreOptions = {}): BrowserLiveStore {
  let stateSnapshot = EMPTY_STATE;
  let frameSnapshot = EMPTY_FRAME;
  let pollFiber: Fiber.Fiber<void, unknown> | null = null;
  let generation = 0;
  let navigationSequence = 0;
  let settledNavigationSequence = 0;
  let pollSequence = 0;
  let locationPollBarrier: number | null = null;
  let locationRevision = 0;
  let emittedUrl = "";
  const navigationLock = Semaphore.makeUnsafe(1);
  const stateListeners = new Set<() => void>();
  const frameListeners = new Set<() => void>();

  const emitState = (next: BrowserLiveStateSnapshot) => {
    if (next === stateSnapshot) return;
    stateSnapshot = next;
    for (const listener of stateListeners) listener();
  };

  const emitFrame = (frame: string) => {
    if (frameSnapshot.frame === frame) return;
    frameSnapshot = { frame };
    for (const listener of frameListeners) listener();
  };

  const locationIsAuthoritative = (pollRequestSequence: number) => {
    if (settledNavigationSequence !== navigationSequence) return false;
    if (locationPollBarrier !== null && pollRequestSequence <= locationPollBarrier) return false;
    locationPollBarrier = null;
    return true;
  };

  const recordFrame = (
    state: BrowserPaneState,
    frame: string | null,
    pollRequestSequence: number,
  ) => {
    let nextLocation = stateSnapshot.location;
    if (locationIsAuthoritative(pollRequestSequence)) {
      const location = browserLocationUpdate(emittedUrl, state.url);
      emittedUrl = location.emittedUrl;
      if (location.location) {
        nextLocation = { revision: (locationRevision += 1), url: location.location };
      }
    }
    const nextState = samePaneState(stateSnapshot.state, state) ? stateSnapshot.state : state;
    if (
      !stateSnapshot.hydrated ||
      nextState !== stateSnapshot.state ||
      nextLocation !== stateSnapshot.location ||
      stateSnapshot.unavailable
    ) {
      emitState({
        ...stateSnapshot,
        hydrated: true,
        state: nextState,
        location: nextLocation,
        unavailable: null,
      });
    }
    if (frame) emitFrame(frame);
  };

  const pollOnce = async (activeGeneration: number) => {
    const pollRequestSequence = (pollSequence += 1);
    const response = await transport.frame();
    if (activeGeneration !== generation) return;
    const payload = Schema.decodeUnknownSync(BrowserFrameResponseSchema)(response.body);
    if (response.status === 503) {
      const unavailable = payload.error ?? "Browser unavailable";
      if (
        !stateSnapshot.hydrated ||
        stateSnapshot.unavailable !== unavailable ||
        stateSnapshot.state
      ) {
        emitState({
          ...stateSnapshot,
          hydrated: true,
          state: null,
          unavailable,
        });
      }
      return;
    }
    if (response.status < 200 || response.status >= 300 || !payload.ok || !payload.data) {
      throw new Error(payload.error ?? `Browser frame failed with HTTP ${response.status}`);
    }
    recordFrame(payload.data, payload.data.frame, pollRequestSequence);
  };

  const settleNavigation = (navigationRequestSequence: number) => {
    if (navigationRequestSequence !== navigationSequence) return false;
    settledNavigationSequence = navigationRequestSequence;
    locationPollBarrier = pollSequence;
    return true;
  };

  const stop = () => {
    generation += 1;
    const fiber = pollFiber;
    pollFiber = null;
    if (fiber) void Effect.runPromise(Fiber.interrupt(fiber));
    stateSnapshot = EMPTY_STATE;
    frameSnapshot = EMPTY_FRAME;
    locationRevision = 0;
    emittedUrl = "";
    locationPollBarrier = null;
  };

  const start = () => {
    if (pollFiber || stateListeners.size + frameListeners.size === 0) return;
    const activeGeneration = (generation += 1);
    pollFiber = Effect.runFork(
      Effect.tryPromise({
        try: () => pollOnce(activeGeneration),
        catch: (error) => error,
      }).pipe(
        Effect.catch(() => Effect.void),
        Effect.repeat(Schedule.spaced(pollIntervalMs)),
        Effect.asVoid,
      ),
    ) as Fiber.Fiber<void, unknown>;
  };

  const unsubscribe = (listeners: Set<() => void>, listener: () => void) => {
    listeners.delete(listener);
    if (stateListeners.size + frameListeners.size === 0) stop();
  };

  const subscribe = (listeners: Set<() => void>, listener: () => void) => {
    listeners.add(listener);
    start();
    return () => unsubscribe(listeners, listener);
  };

  const navigate = (url: string) => {
    const target = url.trim();
    if (!target) return Promise.resolve();
    const navigationRequestSequence = (navigationSequence += 1);
    if (stateSnapshot.navigationError) {
      emitState({ ...stateSnapshot, navigationError: null });
    }
    const program = Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => transport.navigate(target),
        catch: (error) => error,
      });
      const payload = yield* Schema.decodeUnknownEffect(BrowserActionResponseSchema)(response.body);
      if (response.status < 200 || response.status >= 300 || !payload.ok) {
        return yield* Effect.fail(
          new Error(payload.error ?? `Browser navigation failed with HTTP ${response.status}`),
        );
      }
      settleNavigation(navigationRequestSequence);
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (!settleNavigation(navigationRequestSequence)) return;
          emitState({ ...stateSnapshot, navigationError: errorMessage(error) });
        }),
      ),
    );
    return Effect.runPromise(navigationLock.withPermit(program));
  };

  return {
    getFrameSnapshot: () => frameSnapshot,
    getStateSnapshot: () => stateSnapshot,
    navigate,
    subscribeFrame: (listener) => subscribe(frameListeners, listener),
    subscribeState: (listener) => subscribe(stateListeners, listener),
  };
}

const browserLiveStore = createBrowserLiveStore();

export function navigateBrowserHost(url: string): Promise<void> {
  return browserLiveStore.navigate(url);
}

export function useBrowserLiveFrame(): BrowserLiveFrameSnapshot {
  return useSyncExternalStore(
    browserLiveStore.subscribeFrame,
    browserLiveStore.getFrameSnapshot,
    () => EMPTY_FRAME,
  );
}

export function useBrowserLiveState(): BrowserLiveStateSnapshot {
  return useSyncExternalStore(
    browserLiveStore.subscribeState,
    browserLiveStore.getStateSnapshot,
    () => EMPTY_STATE,
  );
}
