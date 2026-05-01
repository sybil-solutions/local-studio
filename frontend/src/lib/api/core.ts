// CRITICAL
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

/** Mid-stream TCP/TLS drops often surface as TypeError or runtime-specific messages (e.g. Bun). Treat as EOF for SSE. */
function isBenignSseTransportFailure(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!error) return false;
  if (error instanceof DOMException) {
    if (error.name === "AbortError") return true;
    if (error.name === "NetworkError") return true;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    const msg = error.message.toLowerCase();
    if (msg.includes("abort")) return true;
    if (msg.includes("failed to fetch")) return true;
    if (msg.includes("networkerror") || msg.includes("network error")) return true;
    if (msg.includes("load failed")) return true;
    if (msg.includes("terminated")) return true;
    if (msg.includes("socket") && msg.includes("closed")) return true;
    if (msg.includes("connection reset")) return true;
    if (msg.includes("econnreset")) return true;
    if (msg.includes("broken pipe")) return true;
  }
  if (error instanceof TypeError) return true;
  return false;
}

export type ApiCore = ReturnType<typeof createApiCore>;

export function createApiCore(params: { baseUrl: string; useProxy: boolean }) {
  const { baseUrl, useProxy } = params;

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
    if (response.headers.get("x-backend-override-invalid") !== "1") return;
    clearStoredBackendUrl();
  };

  const buildUrl = (endpoint: string): string => {
    const path = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    return useProxy ? `${baseUrl}/${path}` : `${baseUrl}${endpoint}`;
  };

  const buildHeaders = (extraHeaders?: HeadersInit): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    const storedBackendUrl = getStoredBackendUrl();
    if (useProxy && storedBackendUrl) {
      headers["X-Backend-Url"] = storedBackendUrl;
    }

    const storedKey = getApiKey();
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
          if (
            useProxy &&
            response.headers.get("x-backend-override-invalid") === "1" &&
            headers["X-Backend-Url"] &&
            !retriedWithoutBackendOverride
          ) {
            retriedWithoutBackendOverride = true;
            delete headers["X-Backend-Url"];
            continue;
          }

          const errorBody: unknown = await response
            .json()
            .catch(() => ({ detail: "Request failed" }));
          const errorMessage = formatHttpErrorMessage(response.status, errorBody);
          lastError = new Error(errorMessage);

          if (isRetryableError(lastError, response.status) && attempt < retries) {
            const backoffMs = retryDelay * Math.pow(2, attempt);
            console.warn(
              `[API] Retry ${attempt + 1}/${retries} for ${endpoint} after ${backoffMs}ms (status: ${response.status})`,
            );
            await delay(backoffMs);
            continue;
          }

          throw lastError;
        }

        const text = await response.text();
        return text ? (JSON.parse(text) as T) : (null as unknown as T);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        } else if (error instanceof Error) {
          lastError = error;
        } else {
          lastError = new Error(String(error));
        }

        if (isRetryableError(error, lastStatus) && attempt < retries) {
          const backoffMs = retryDelay * Math.pow(2, attempt);
          console.warn(
            `[API] Retry ${attempt + 1}/${retries} for ${endpoint} after ${backoffMs}ms (${lastError.message})`,
          );
          await delay(backoffMs);
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
        } catch {
          /* ignore */
        }
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
        } catch {
          /* ignore */
        }
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    return { runId, stream: parseSseStream(reader, signal) };
  };

  /** Poll the controller health endpoint. Returns true if reachable. */
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
