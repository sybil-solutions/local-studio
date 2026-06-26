import type { GpuSummary, RecipeSummary, Status, ControllerConfig, LifetimeMetrics } from "./types";

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

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

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

async function requestJson<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown } = {}
): Promise<T> {
  const url = `${resolveBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(resolveApiKey() ? { "X-API-Key": resolveApiKey() } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliApiError(
      `Network error calling ${method} ${path}: ${message}`,
      method,
      path,
      null
    );
  }

  const body = await parseBody(response);
  if (!response.ok) {
    const reason = extractErrorMessage(body, `${response.status} ${response.statusText}`.trim());
    throw new CliApiError(
      `Request failed for ${method} ${path}: ${reason}`,
      method,
      path,
      response.status
    );
  }

  return body as T;
}

export async function fetchGPUs(): Promise<GpuSummary[]> {
  const data = await requestJson<unknown>("GET", "/gpus");
  if (!isRecord(data) || !Array.isArray(data.gpus)) {
    throw new CliApiError("Invalid response for GET /gpus", "GET", "/gpus");
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
}

export async function fetchRecipes(): Promise<RecipeSummary[]> {
  const data = await requestJson<unknown>("GET", "/recipes");
  if (!Array.isArray(data)) {
    throw new CliApiError("Invalid response for GET /recipes", "GET", "/recipes");
  }
  return data as RecipeSummary[];
}

export async function fetchStatus(): Promise<Status> {
  const data = await requestJson<unknown>("GET", "/status");
  if (!isRecord(data)) {
    throw new CliApiError("Invalid response for GET /status", "GET", "/status");
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
}

export async function fetchConfig(): Promise<ControllerConfig> {
  const data = await requestJson<unknown>("GET", "/config");
  if (!isRecord(data) || !isRecord(data.config)) {
    throw new CliApiError("Invalid response for GET /config", "GET", "/config");
  }

  const config = data.config;
  return {
    port: toFiniteNumber(config.port),
    inference_port: toFiniteNumber(config.inference_port),
    models_dir: typeof config.models_dir === "string" ? config.models_dir : "",
    data_dir: typeof config.data_dir === "string" ? config.data_dir : "",
  };
}

export async function fetchLifetimeMetrics(): Promise<LifetimeMetrics> {
  const data = await requestJson<unknown>("GET", "/lifetime-metrics");
  if (!isRecord(data)) {
    throw new CliApiError("Invalid response for GET /lifetime-metrics", "GET", "/lifetime-metrics");
  }

  return {
    total_tokens: toFiniteNumber(data.tokens_total),
    total_requests: toFiniteNumber(data.requests_total),
    total_energy_kwh: toFiniteNumber(data.energy_kwh),
  };
}

export async function launchRecipe(id: string): Promise<boolean> {
  const data = await requestJson<unknown>("POST", `/launch/${id}`);
  if (isRecord(data) && typeof data.success === "boolean") return data.success;
  return true;
}

export async function evictModel(): Promise<boolean> {
  const data = await requestJson<unknown>("POST", "/evict");
  if (isRecord(data) && typeof data.success === "boolean") return data.success;
  return true;
}
