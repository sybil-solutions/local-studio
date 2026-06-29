import type { GpuSummary, RecipeSummary, Status, ControllerConfig, LifetimeMetrics } from "./types";
import { Effect } from "effect";

const DEFAULT_BASE_URL = "http://localhost:8080";

export class CliApiError extends Error {
  public readonly status: number | null;
  public readonly method: string;
  public readonly path: string;

  public constructor(message: string, method: string, path: string, status: number | null = null) {
    super(message);
    this.name = "CliApiError";
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

function resolveBaseUrl(): string {
  const configured = process.env.LOCAL_STUDIO_URL?.trim() || DEFAULT_BASE_URL;
  return configured.endsWith("/") ? configured.slice(0, -1) : configured;
}

function resolveApiKey(): string | undefined {
  return process.env.LOCAL_STUDIO_API_KEY?.trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const parseBodyEffect = (response: Response): Effect.Effect<unknown, CliApiError> =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) =>
        new CliApiError(
          `Failed to read response body: ${error instanceof Error ? error.message : String(error)}`,
          "GET",
          "unknown",
          response.status,
        ),
    });
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  });

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (isRecord(body)) {
    const detail = body.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    const error = body.error;
    if (typeof error === "string" && error.trim()) return error;
    const message = body.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function requestJsonEffect<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown } = {}
): Effect.Effect<T, CliApiError> {
  const url = `${resolveBaseUrl()}${path}`;
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method,
          headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(resolveApiKey() ? { "X-API-Key": resolveApiKey() } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        }),
      catch: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        return new CliApiError(`Network error calling ${method} ${path}: ${message}`, method, path);
      },
    });

    const body = yield* parseBodyEffect(response);
    if (!response.ok) {
      const reason = extractErrorMessage(body, `${response.status} ${response.statusText}`.trim());
      return yield* Effect.fail(
        new CliApiError(`Request failed for ${method} ${path}: ${reason}`, method, path, response.status),
      );
    }

    return body as T;
  });
}

export const fetchGPUsEffect = Effect.gen(function* () {
  const data = yield* requestJsonEffect<unknown>("GET", "/gpus");
  if (!isRecord(data) || !Array.isArray(data.gpus)) {
    return yield* Effect.fail(new CliApiError("Invalid response for GET /gpus", "GET", "/gpus"));
  }

  return data.gpus.filter(isRecord).map((gpu, index) => ({
    index: toFiniteNumber(gpu.index, index),
    name: typeof gpu.name === "string" ? gpu.name : `GPU ${index}`,
    memory_used: toFiniteNumber(gpu.memory_used),
    memory_total: toFiniteNumber(gpu.memory_total),
    utilization: toFiniteNumber(gpu.utilization),
    temperature: toFiniteNumber(gpu.temperature),
    power_draw: toFiniteNumber(gpu.power_draw),
  }));
});

export const fetchRecipesEffect = Effect.gen(function* () {
  const data = yield* requestJsonEffect<unknown>("GET", "/recipes");
  if (!Array.isArray(data)) {
    return yield* Effect.fail(new CliApiError("Invalid response for GET /recipes", "GET", "/recipes"));
  }
  return data as RecipeSummary[];
});

export const fetchStatusEffect = Effect.gen(function* () {
  const data = yield* requestJsonEffect<unknown>("GET", "/status");
  if (!isRecord(data)) {
    return yield* Effect.fail(new CliApiError("Invalid response for GET /status", "GET", "/status"));
  }

  const processInfo = isRecord(data.process) ? data.process : undefined;
  return {
    running: data.running === true,
    launching: Boolean(data.launching),
    model:
      typeof processInfo?.served_model_name === "string"
        ? processInfo.served_model_name
        : undefined,
    backend: typeof processInfo?.backend === "string" ? processInfo.backend : undefined,
    pid: toOptionalFiniteNumber(processInfo?.pid),
    port: toOptionalFiniteNumber(processInfo?.port),
    error: typeof data.error === "string" ? data.error : undefined,
  };
});

export const fetchConfigEffect = Effect.gen(function* () {
  const data = yield* requestJsonEffect<unknown>("GET", "/config");
  if (!isRecord(data) || !isRecord(data.config)) {
    return yield* Effect.fail(new CliApiError("Invalid response for GET /config", "GET", "/config"));
  }

  const config = data.config;
  return {
    port: toFiniteNumber(config.port),
    inference_port: toFiniteNumber(config.inference_port),
    models_dir: typeof config.models_dir === "string" ? config.models_dir : "",
    data_dir: typeof config.data_dir === "string" ? config.data_dir : "",
  };
});

export const fetchLifetimeMetricsEffect = Effect.gen(function* () {
  const data = yield* requestJsonEffect<unknown>("GET", "/lifetime-metrics");
  if (!isRecord(data)) {
    return yield* Effect.fail(
      new CliApiError("Invalid response for GET /lifetime-metrics", "GET", "/lifetime-metrics"),
    );
  }

  return {
    total_tokens: toFiniteNumber(data.tokens_total),
    total_requests: toFiniteNumber(data.requests_total),
    total_energy_kwh: toFiniteNumber(data.energy_kwh),
  };
});

export const launchRecipeEffect = (id: string) =>
  Effect.gen(function* () {
    const data = yield* requestJsonEffect<unknown>("POST", `/launch/${id}`);
  if (isRecord(data) && typeof data.success === "boolean") return data.success;
  return true;
  });

export const evictModelEffect = Effect.gen(function* () {
  const data = yield* requestJsonEffect<unknown>("POST", "/evict");
  return isRecord(data) && typeof data.success === "boolean" ? data.success : true;
});

export const fetchGPUs = (): Promise<GpuSummary[]> => Effect.runPromise(fetchGPUsEffect);
export const fetchRecipes = (): Promise<RecipeSummary[]> => Effect.runPromise(fetchRecipesEffect);
export const fetchStatus = (): Promise<Status> => Effect.runPromise(fetchStatusEffect);
export const fetchConfig = (): Promise<ControllerConfig> => Effect.runPromise(fetchConfigEffect);
export const fetchLifetimeMetrics = (): Promise<LifetimeMetrics> =>
  Effect.runPromise(fetchLifetimeMetricsEffect);
export const launchRecipe = (id: string): Promise<boolean> => Effect.runPromise(launchRecipeEffect(id));
export const evictModel = (): Promise<boolean> => Effect.runPromise(evictModelEffect);
