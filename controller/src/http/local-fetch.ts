import { Effect } from "effect";

export type LocalFetchOptions = RequestInit & { host?: string; timeoutMs?: number };

const normalizePath = (path: string): string => {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

export const buildLocalUrl = (port: number, path: string, host = "localhost"): string =>
  `http://${host}:${port}${normalizePath(path)}`;

const combineSignals = (
  primary: AbortSignal | undefined,
  timeout: AbortSignal
): { signal: AbortSignal; cleanup: () => void } => {
  if (!primary) {
    return { signal: timeout, cleanup: (): void => {} };
  }

  const anyFunction = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal })
    .any;
  if (typeof anyFunction === "function") {
    return { signal: anyFunction([primary, timeout]), cleanup: (): void => {} };
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const onPrimaryAbort = (): void => abort();
  const onTimeoutAbort = (): void => abort();

  if (primary.aborted || timeout.aborted) {
    abort();
    return { signal: controller.signal, cleanup: (): void => {} };
  }

  primary.addEventListener("abort", onPrimaryAbort, { once: true });
  timeout.addEventListener("abort", onTimeoutAbort, { once: true });

  return {
    signal: controller.signal,
    cleanup: (): void => {
      primary.removeEventListener("abort", onPrimaryAbort);
      timeout.removeEventListener("abort", onTimeoutAbort);
    },
  };
};

export const fetchLocalEffect = (
  port: number,
  path: string,
  options: LocalFetchOptions = {}
): Effect.Effect<Response, unknown> => {
  const { host, timeoutMs, signal, ...init } = options;
  const url = buildLocalUrl(port, path, host);
  const requestSignal = signal ?? undefined;

  if (!timeoutMs || timeoutMs <= 0) {
    if (!requestSignal) {
      return Effect.tryPromise(() => fetch(url, init));
    }
    return Effect.tryPromise(() => fetch(url, { ...init, signal: requestSignal }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = combineSignals(requestSignal, controller.signal);
  return Effect.tryPromise(() => fetch(url, { ...init, signal: combined.signal })).pipe(
    Effect.ensuring(
      Effect.sync(() => {
      clearTimeout(timer);
      combined.cleanup();
      }),
    ),
  );
};

export const fetchLocal = (
  port: number,
  path: string,
  options: LocalFetchOptions = {}
): Promise<Response> => Effect.runPromise(fetchLocalEffect(port, path, options));
