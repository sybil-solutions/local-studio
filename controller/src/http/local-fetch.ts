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

export const fetchLocal = async (
  port: number,
  path: string,
  options: LocalFetchOptions = {}
): Promise<Response> => {
  const { host, timeoutMs, signal, ...init } = options;
  const url = buildLocalUrl(port, path, host);
  const requestSignal = signal ?? undefined;

  if (!timeoutMs || timeoutMs <= 0) {
    if (!requestSignal) {
      return fetch(url, init);
    }
    return fetch(url, { ...init, signal: requestSignal });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = combineSignals(requestSignal, controller.signal);

  try {
    return await fetch(url, { ...init, signal: combined.signal });
  } finally {
    clearTimeout(timer);
    combined.cleanup();
  }
};
