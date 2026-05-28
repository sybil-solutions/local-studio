import { getApiKey } from "../api-key";
import { clearStoredBackendUrl, getStoredBackendUrl } from "../backend-url";
import { delay } from "../async";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export const encodePathSegments = (path: string) =>
  path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

function isRetryableError(error: unknown, status?: number): boolean {
  if (status && status >= 500) return true;
  if (status === 429) return true;
  if (status === 408) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "AbortError") return false;
  return false;
}

/** Normalize FastAPI / generic JSON error bodies into a single string for `Error.message`. */
export function formatHttpErrorMessage(status: number, body: unknown): string {
  const fallback = `HTTP ${status}`;
  if (body == null) return fallback;

  if (typeof body === "string") {
    const t = body.trim();
    return t.length > 0 ? t : fallback;
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    return fallback;
  }

  const b = body as Record<string, unknown>;
  const detail = b["detail"];

  if (typeof detail === "string") {
    const t = detail.trim();
    return t.length > 0 ? t : fallback;
  }

  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const msg =
          typeof o["msg"] === "string"
            ? o["msg"].trim()
            : typeof o["message"] === "string"
              ? (o["message"] as string).trim()
              : "";
        if (msg) {
          const locRaw = o["loc"];
          const loc =
            Array.isArray(locRaw) && locRaw.length > 0
              ? locRaw
                  .filter(
                    (x): x is string | number => typeof x === "string" || typeof x === "number",
                  )
                  .join(".")
              : "";
          return loc ? `${loc}: ${msg}` : msg;
        }
      }
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    });
    const joined = parts.filter((p) => p.length > 0).join("; ");
    return joined.length > 0 ? joined : fallback;
  }

  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback;
    }
  }

  const nested = b["error"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const msg = (nested as Record<string, unknown>)["message"];
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }

  if (typeof b["message"] === "string" && b["message"].trim()) {
    return (b["message"] as string).trim();
  }

  return fallback;
}

export interface RequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface ChatRunStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Strip Bun-only debugging suffix from fetch/SSE errors so the UI stays readable. */
export function scrubTransportFetchErrorMessage(message: string): string {
  return message
    .replace(
      /\s*For more information, pass `verbose:\s*true`\s+in the second argument to fetch\(\)\.?\s*$/i,
      "",
    )
    .trimEnd();
}

const BENIGN_SSE_MESSAGE_PARTS = [
  "abort",
  "failed to fetch",
  "networkerror",
  "network error",
  "load failed",
  "terminated",
  "connection reset",
  "econnreset",
  "broken pipe",
];

function isAbortOrNetworkDomException(error: DOMException): boolean {
  return error.name === "AbortError" || error.name === "NetworkError";
}

function hasBenignSseErrorMessage(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    BENIGN_SSE_MESSAGE_PARTS.some((part) => msg.includes(part)) ||
    (msg.includes("socket") && msg.includes("closed"))
  );
}

/** Mid-stream TCP/TLS drops often surface as TypeError or runtime-specific messages (e.g. Bun). Treat as EOF for SSE. */
function isBenignSseTransportFailure(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!error) return false;
  if (error instanceof DOMException) return isAbortOrNetworkDomException(error);
  if (error instanceof TypeError) return true;
  if (error instanceof Error) return error.name === "AbortError" || hasBenignSseErrorMessage(error);
  return false;
}

export type ApiCore = ReturnType<typeof createApiCore>;

export function createApiCore(params: {
  baseUrl: string;
  useProxy: boolean;
  backendUrlOverride?: string;
  apiKeyOverride?: string;
}) {
  const { baseUrl, useProxy, backendUrlOverride, apiKeyOverride } = params;
  const hasBackendUrlOverride = Boolean(backendUrlOverride?.trim());

  const normalizeSsePayload = (
    event: string,
    data: Record<string, unknown>,
  ): ChatRunStreamEvent => {
    // Backward-compatibility: some older proxy/controller stacks emit SSE frames with
    // `event: message` (or no event line) and wrap the real event inside nested payloads.
    //
    // Supported legacy shapes:
    // - { event: "run_start", data: { ... } }
    // - { type: "run_start", data: { ... } }
    // - { event: "run_start", payload: { ... } }
    // - { type: "run_start", payload: { ... } }
    const nestedEvent =
      typeof data["event"] === "string"
        ? (data["event"] as string)
        : typeof data["type"] === "string"
          ? (data["type"] as string)
          : null;
    const nestedData = isRecord(data["data"])
      ? (data["data"] as Record<string, unknown>)
      : isRecord(data["payload"])
        ? (data["payload"] as Record<string, unknown>)
        : null;

    if ((event === "message" || event === "") && nestedEvent && nestedData) {
      return {
        event: nestedEvent,
        data: nestedData,
      };
    }

    return { event: event || "message", data };
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const maybeClearInvalidBackendOverride = (response: Response): void => {
    if (!useProxy) return;
    if (hasBackendUrlOverride) return;
    if (response.headers.get("x-backend-override-invalid") !== "1") return;
    clearStoredBackendUrl();
  };

  const shouldRetryWithoutBackendOverride = (
    response: Response,
    headers: Record<string, string>,
    retriedWithoutBackendOverride: boolean,
  ): boolean =>
    useProxy &&
    !hasBackendUrlOverride &&
    response.headers.get("x-backend-override-invalid") === "1" &&
    Boolean(headers["X-Backend-Url"]) &&
    !retriedWithoutBackendOverride;

  const responseError = async (response: Response): Promise<Error> => {
    const errorBody: unknown = await response.json().catch(() => ({ detail: "Request failed" }));
    const error = new Error(formatHttpErrorMessage(response.status, errorBody));
    (error as Error & { status: number }).status = response.status;
    return error;
  };

  const normalizeRequestError = (error: unknown, timeout: number): Error => {
    if (error instanceof Error && error.name === "AbortError") {
      return new Error(`Request timeout after ${timeout}ms`);
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  };

  const shouldRetryAttempt = (
    error: unknown,
    status: number | undefined,
    attempt: number,
    retries: number,
  ): boolean => attempt < retries && isRetryableError(error, status);

  const waitBeforeRetry = async (
    endpoint: string,
    attempt: number,
    retries: number,
    retryDelay: number,
    cause: string,
  ) => {
    const backoffMs = retryDelay * Math.pow(2, attempt);
    console.warn(
      `[API] Retry ${attempt + 1}/${retries} for ${endpoint} after ${backoffMs}ms ${cause}`,
    );
    await delay(backoffMs);
  };

  const buildUrl = (endpoint: string): string => {
    const path = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    return useProxy ? `${baseUrl}/${path}` : `${baseUrl}${endpoint}`;
  };

  const buildHeaders = (extraHeaders?: HeadersInit): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    const storedBackendUrl = backendUrlOverride?.trim() || getStoredBackendUrl();
    if (useProxy && storedBackendUrl) {
      headers["X-Backend-Url"] = storedBackendUrl;
    }

    const storedKey = apiKeyOverride?.trim() || getApiKey();
    if (storedKey) {
      headers["Authorization"] = `Bearer ${storedKey}`;
    }

    if (extraHeaders) {
      const merged = new Headers(extraHeaders);
      merged.forEach((value, key) => {
        headers[key] = value;
      });
    }

    return headers;
  };

  const request = async <T>(endpoint: string, options: RequestOptions = {}): Promise<T> => {
    const {
      timeout = DEFAULT_TIMEOUT_MS,
      retries = DEFAULT_RETRIES,
      retryDelay = DEFAULT_RETRY_DELAY_MS,
      ...fetchOptions
    } = options;

    const headers = buildHeaders(fetchOptions.headers);
    const url = buildUrl(endpoint);

    let lastError: Error | null = null;
    let lastStatus: number | undefined;
    let retriedWithoutBackendOverride = false;
    const maxAttempts = retries + (useProxy && headers["X-Backend-Url"] ? 1 : 0);

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          headers: { ...headers },
          credentials: "include",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;
        maybeClearInvalidBackendOverride(response);

        if (!response.ok) {
          if (shouldRetryWithoutBackendOverride(response, headers, retriedWithoutBackendOverride)) {
            retriedWithoutBackendOverride = true;
            delete headers["X-Backend-Url"];
            continue;
          }

          lastError = await responseError(response);
          if (shouldRetryAttempt(lastError, response.status, attempt, retries)) {
            await waitBeforeRetry(
              endpoint,
              attempt,
              retries,
              retryDelay,
              `(status: ${response.status})`,
            );
            continue;
          }

          throw lastError;
        }

        const text = await response.text();
        return text ? (JSON.parse(text) as T) : (null as unknown as T);
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = normalizeRequestError(error, timeout);

        if (shouldRetryAttempt(error, lastStatus, attempt, retries)) {
          await waitBeforeRetry(endpoint, attempt, retries, retryDelay, `(${lastError.message})`);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error("Request failed after retries");
  };

  const parseSseStream = async function* (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatRunStreamEvent> {
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let dataLines: string[] = [];

    const flushEvent = (): ChatRunStreamEvent | null => {
      if (dataLines.length === 0) return null;
      const dataString = dataLines.join("\n");
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataString) as Record<string, unknown>;
      } catch {
        data = { raw: dataString };
      }
      const payload = normalizeSsePayload(eventType, data);
      eventType = "";
      dataLines = [];
      return payload;
    };

    while (true) {
      let chunk: Uint8Array | undefined;
      try {
        const result = await reader.read();
        if (result.done) break;
        chunk = result.value;
      } catch (err) {
        if (isBenignSseTransportFailure(err, signal)) {
          break;
        }
        throw err;
      }

      if (!chunk) break;

      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line) {
          const payload = flushEvent();
          if (payload) yield payload;
          continue;
        }

        // SSE comment lines (e.g. ": keepalive") — emit a synthetic event
        // so the stream consumer can reset idle timers.
        if (line.startsWith(":")) {
          yield { event: "keepalive", data: {} };
          continue;
        }

        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }

    const finalPayload = flushEvent();
    if (finalPayload) yield finalPayload;
  };

  const getSseJson = async (
    endpoint: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AsyncGenerator<ChatRunStreamEvent>> => {
    const url = buildUrl(endpoint);
    const headers = buildHeaders({ Accept: "text/event-stream" });

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: options.signal,
      credentials: "include",
    });

    if (!response.ok || !response.body) {
      const errorBody = await response.json().catch(() => ({ detail: "Request failed" }));
      const errorMessage =
        errorBody.detail || errorBody.error?.message || `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const signal = options.signal;

    if (signal) {
      const onAbort = () => {
        try {
          void reader.cancel();
        } catch {}
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    return parseSseStream(reader, signal);
  };

  const postSseJson = async (
    endpoint: string,
    payload: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ runId: string | null; stream: AsyncGenerator<ChatRunStreamEvent> }> => {
    const url = buildUrl(endpoint);
    const headers = buildHeaders({ Accept: "text/event-stream" });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: options.signal,
        credentials: "include",
      });
    } catch (err) {
      if (err instanceof Error) {
        const cleaned = scrubTransportFetchErrorMessage(err.message);
        if (cleaned && cleaned !== err.message) {
          throw new Error(cleaned);
        }
      }
      throw err;
    }
    maybeClearInvalidBackendOverride(response);

    if (!response.ok || !response.body) {
      const errorBody = await response.json().catch(() => ({ detail: "Request failed" }));
      const errorMessage =
        errorBody.detail || errorBody.error?.message || `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    const runId = response.headers.get("x-run-id");
    const reader = response.body.getReader();
    const signal = options.signal;

    if (signal) {
      const onAbort = () => {
        try {
          void reader.cancel();
        } catch {}
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    return { runId, stream: parseSseStream(reader, signal) };
  };

  const healthPoll = async (timeoutMs = 5_000): Promise<boolean> => {
    try {
      const url = buildUrl("/health");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        credentials: "include",
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  };

  return {
    baseUrl,
    useProxy,
    buildUrl,
    buildHeaders,
    request,
    postSseJson,
    getSseJson,
    healthPoll,
  };
}
