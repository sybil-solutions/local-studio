import { type Dispatch, type SetStateAction } from "react";
import { Effect, Schema, Semaphore } from "effect";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

type UseLocalhostSitesEffectsParams = {
  enabled: boolean;
  onLoadingChange: Dispatch<SetStateAction<boolean>>;
  onSitesChange: Dispatch<SetStateAction<LocalhostSite[]>>;
  onErrorChange: Dispatch<SetStateAction<string | null>>;
};

export function useLocalhostSitesEffects({
  enabled,
  onLoadingChange,
  onSitesChange,
  onErrorChange,
}: UseLocalhostSitesEffectsParams): void {
  useMountSubscription(() => {
    if (!enabled) return;
    let cancelled = false;
    onLoadingChange(true);
    onErrorChange(null);
    void fetch("/api/agent/browser/localhosts", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { sites?: LocalhostSite[]; error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error || "Failed to scan");
        if (!cancelled) onSitesChange(payload.sites ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          onSitesChange([]);
          onErrorChange(error instanceof Error ? error.message : "Failed to scan localhost");
        }
      })
      .finally(() => {
        if (!cancelled) {
          onLoadingChange(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, onErrorChange, onLoadingChange, onSitesChange]);
}

export type BrowserPaneState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

type UseAgentBrowserEffectsParams = {
  url: string;
  readingMode: boolean;
  fetchReadable: (target: string) => Promise<void>;
  enabled?: boolean;
};

export function useAgentBrowserEffects({
  url,
  readingMode,
  fetchReadable,
  enabled = true,
}: UseAgentBrowserEffectsParams): void {
  useMountSubscription(() => {
    if (enabled && url && readingMode) {
      void fetchReadable(url);
    }
  }, [enabled, fetchReadable, readingMode, url]);
}

type BrowserHostResponse = { status: number; body: unknown };
export type BrowserHostTransport = (path: string, body?: unknown) => Promise<BrowserHostResponse>;
export type BrowserMutationResult = { error: string | null; url?: string; readingMode?: boolean };

const BrowserActionResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  data: Schema.optional(
    Schema.Struct({
      url: Schema.optional(Schema.String),
      readingMode: Schema.optional(Schema.Boolean),
    }),
  ),
});

const requestBrowserHost: BrowserHostTransport = async (path, body) => {
  const response = await fetch(`/api/agent/browser/${path}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "Browser command failed";

export function createBrowserHostCoordinator(transport: BrowserHostTransport) {
  let pollSequence = 0;
  let mutationSequence = 0;
  let settledMutation = 0;
  let locationBarrier = 0;
  const lock = Semaphore.makeUnsafe(1);

  const mutate = (path: string, body?: unknown): Promise<BrowserMutationResult> => {
    const sequence = (mutationSequence += 1);
    const program = Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => transport(path, body),
        catch: (error) => error,
      });
      const payload = yield* Schema.decodeUnknownEffect(BrowserActionResponseSchema)(response.body);
      if (response.status < 200 || response.status >= 300 || !payload.ok) {
        return yield* Effect.fail(
          new Error(payload.error ?? `Browser command failed with HTTP ${response.status}`),
        );
      }
      return { error: null, ...payload.data };
    }).pipe(
      Effect.match({
        onFailure: (error) => ({ error: messageFor(error) }),
        onSuccess: (result) => result,
      }),
      Effect.ensuring(
        Effect.sync(() => {
          if (sequence !== mutationSequence) return;
          settledMutation = sequence;
          locationBarrier = pollSequence;
        }),
      ),
    );
    return Effect.runPromise(lock.withPermit(program));
  };

  return {
    beginFrame: () => (pollSequence += 1),
    locationIsAuthoritative: (sequence: number) =>
      settledMutation === mutationSequence && sequence > locationBarrier,
    mutate,
  };
}

const browserHostCoordinator = createBrowserHostCoordinator(requestBrowserHost);

export const beginBrowserFrame = (): number => browserHostCoordinator.beginFrame();
export const browserFrameLocationIsAuthoritative = (sequence: number): boolean =>
  browserHostCoordinator.locationIsAuthoritative(sequence);
export const mutateBrowserHost = (path: string, body?: unknown): Promise<BrowserMutationResult> =>
  browserHostCoordinator.mutate(path, body);
