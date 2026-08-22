import type {
  EngineSupport,
  HealthCheck,
  LaunchPlan,
  LaunchRequest,
  MetricMap,
  EngineRuntimeKind,
  ServingOptions,
} from "../contracts";

/** Model directory inside a container. Every image mounts the model at the same path, so
 *  the argv is identical whether a plan runs as a process or a container. */
const CONTAINER_MODEL_DIR = "/models";

export const health = (path: string, readyDeadlineMs: number, intervalMs = 2_000): HealthCheck => ({
  path,
  readyDeadlineMs,
  intervalMs,
});

export const unsupported = (reason: string): EngineSupport => ({ ok: false, reason });
export const supported = (...runtimes: EngineRuntimeKind[]): EngineSupport => ({ ok: true, runtimes });

export const noMetrics: MetricMap = {
  requestsRunning: [],
  requestsWaiting: [],
  kvCacheUtilization: [],
  promptTokensTotal: [],
  generationTokensTotal: [],
};

export const prometheusMetrics = (prefix: string, kvName: string): MetricMap => ({
  requestsRunning: [`${prefix}:num_requests_running`],
  requestsWaiting: [`${prefix}:num_requests_waiting`],
  kvCacheUtilization: [`${prefix}:${kvName}`],
  promptTokensTotal: [`${prefix}:prompt_tokens_total`],
  generationTokensTotal: [`${prefix}:generation_tokens_total`],
});

/* ── tuning knobs ────────────────────────────────────────────────────────── */

/**
 * How one engine spells one canonical knob. `null` in a spelling table means the engine
 * has no equivalent, and the knob is dropped rather than guessed at.
 *
 * This table plus `tuningArguments` is what lets each engine describe its argument
 * builder as data instead of a hand-written argv assembly function.
 */
interface FlagSpec {
  readonly flag: string;
  /** Emitted alongside the flag when the knob is set — vLLM's tool parser needs
   *  `--enable-auto-tool-choice` next to it, SGLang's does not. */
  readonly companion?: string;
}

type TuningKey = keyof ServingOptions;
export type Spelling = Readonly<Partial<Record<TuningKey, FlagSpec>>>;

/** Fixed emission order, so two engines with the same knobs produce comparable argv. */
const TUNING_ORDER: readonly TuningKey[] = [
  "tensorParallel",
  "pipelineParallel",
  "maxContextLength",
  "memoryFraction",
  "maxConcurrentRequests",
  "kvCacheDtype",
  "dtype",
  "quantization",
  "trustRemoteCode",
  "toolCallParser",
  "reasoningParser",
];

/** Parallelism of 1 is the default everywhere; emitting it only adds noise and, for some
 *  builds, forces a distributed code path that a single card does not need. */
const PARALLEL_KEYS = new Set<TuningKey>(["tensorParallel", "pipelineParallel"]);

const shouldEmit = (key: TuningKey, value: ServingOptions[TuningKey]): boolean => {
  if (value === null || value === undefined || value === false) return false;
  if (value === "auto") return false;
  if (typeof value === "number") return PARALLEL_KEYS.has(key) ? value > 1 : value > 0;
  if (typeof value === "string") return value.length > 0;
  return true;
};

const tuningArguments = (options: ServingOptions, spelling: Spelling): string[] => {
  const args: string[] = [];
  for (const key of TUNING_ORDER) {
    const spec = spelling[key];
    const value = options[key];
    if (!spec || !shouldEmit(key, value)) continue;
    if (typeof value === "boolean") args.push(spec.flag);
    else args.push(spec.flag, String(value));
    if (spec.companion) args.push(spec.companion);
  }
  return args;
};

/** The flag key a token represents, or null when it is a value rather than a flag. */
const flagKey = (token: string): string | null =>
  token.startsWith("--") ? (token.split("=")[0] ?? token).slice(2) : null;

/**
 * Append recipe overrides so they always win: any base flag the user also supplied is
 * dropped first. Without this, both spellings reach the engine and which one applies is
 * left to argparse.
 */
const mergeArguments = (base: readonly string[], extra: readonly string[]): string[] => {
  const overridden = new Set(
    extra.map(flagKey).filter((key): key is string => key !== null),
  );
  const merged: string[] = [];
  for (let index = 0; index < base.length; index += 1) {
    const token = base[index] ?? "";
    const key = flagKey(token);
    if (key === null || !overridden.has(key)) {
      merged.push(token);
      continue;
    }
    // Skip the flag and its value, if it takes one.
    const next = base[index + 1];
    if (next !== undefined && flagKey(next) === null && !token.includes("=")) index += 1;
  }
  return [...merged, ...extra];
};

/* ── plan assembly ───────────────────────────────────────────────────────── */

const modelReference = (request: LaunchRequest): string =>
  request.runtime === "docker" ? CONTAINER_MODEL_DIR : request.modelPath;

const modelMounts = (request: LaunchRequest): LaunchPlan["mounts"] =>
  request.runtime === "docker"
    ? [{ from: request.modelPath, to: CONTAINER_MODEL_DIR, readOnly: true }]
    : [];

/** Containers listen on all interfaces so the published port reaches them; processes bind
 *  loopback, because the controller proxies them and nothing else should connect. */
const serveAddress = (request: LaunchRequest, listenPort: number): string[] => [
  "--host",
  request.runtime === "docker" ? "0.0.0.0" : "127.0.0.1",
  "--port",
  String(listenPort),
];

/**
 * The shape every OpenAI-compatible server shares. `modelFlag: null` passes the model
 * positionally (vLLM's `serve <path>` form).
 */
export const serverArguments = (
  request: LaunchRequest,
  spec: {
    readonly subcommand?: readonly string[];
    readonly modelFlag: string | null;
    readonly servedNameFlag: string | null;
    readonly spelling: Spelling;
    readonly defaults?: readonly string[];
  },
  listenPort: number,
): string[] => {
  const model = modelReference(request);
  const base = [
    ...(spec.subcommand ?? []),
    ...(spec.modelFlag === null ? [model] : [spec.modelFlag, model]),
    ...(spec.servedNameFlag ? [spec.servedNameFlag, request.servedModelName] : []),
    ...serveAddress(request, listenPort),
    ...tuningArguments(request.options, spec.spelling),
    ...(spec.defaults ?? []),
  ];
  return mergeArguments(base, request.extraArgs);
};

export const plan = (
  request: LaunchRequest,
  parts: {
    readonly args: readonly string[];
    readonly health: HealthCheck;
    readonly listenPort: number;
    readonly image?: string | null;
    readonly env?: Readonly<Record<string, string>>;
  },
): LaunchPlan => {
  const image = request.dockerImage ?? parts.image;
  return {
    kind: request.runtime,
    // A container image supplies its own executable; a process launch needs the binary.
    argv: request.runtime === "docker" ? [...parts.args] : [request.binary, ...parts.args],
    // An engine may always offer an image; only a container plan carries one.
    ...(request.runtime === "docker" && image ? { image } : {}),
    env: { ...request.env, ...(parts.env ?? {}) },
    ports: [{ container: parts.listenPort, host: request.port }],
    mounts: modelMounts(request),
    devices: request.devices,
    health: parts.health,
  };
};
