/**
 * The compute layer's contracts. This file has no runtime imports and no I/O — it is
 * the only module every other compute file may depend on.
 *
 * Three rules carry the design:
 *   1. Engines are pure. `plan()` is a total function of its request; no clock, no env,
 *      no filesystem. That is what makes the whole launch path golden-testable.
 *   2. The instance record is the lease. A device is held iff a live record claims it,
 *      so there is no registry to fall out of sync with reality.
 *   3. Status is derived, never stored. `stateOf` reads liveness, then health, then the
 *      deadline — there is no status field to go stale.
 */

/** The engine roster. Matches the shared `EngineBackend` exactly. */
export type EngineId = "vllm" | "sglang" | "exllamav3";

export const ENGINE_IDS: readonly EngineId[] = ["vllm", "sglang", "exllamav3"] as const;

export type Accelerator = "cuda" | "rocm" | "metal" | "xpu" | "cpu";
/** Engines run in containers, full stop. The one-member union keeps the field
 *  self-describing in records and plans. */
export type EngineRuntimeKind = "docker";
export type HostPlatform = "linux" | "darwin" | "win32";
export type HostArch = "x64" | "arm64";

/** Node id. `"self"` is always this host; peers use their registered id. */
export type NodeId = string;

/** Stable across reboots: an NVIDIA/AMD GPU UUID, or a synthetic id for accelerators
 *  that have none (`"metal:0"`, `"cpu:0"`). Never a bare index — indices renumber. */
export type DeviceId = string;

export interface HostProfile {
  readonly nodeId: NodeId;
  readonly platform: HostPlatform;
  readonly arch: HostArch;
  readonly accelerator: Accelerator;
  /** Apple Silicon and DGX Spark (GB10): VRAM *is* RAM. Never budget them separately. */
  readonly unifiedMemory: boolean;
  readonly wsl: boolean;
  readonly docker: boolean;
  /** Docker is present *and* GPU passthrough works. False on macOS, always. */
  readonly dockerGpu: boolean;
  readonly deviceCount: number;
}

/* ── engines ─────────────────────────────────────────────────────────────── */

export type EngineSupport =
  | { readonly ok: true; readonly runtimes: readonly EngineRuntimeKind[] }
  | { readonly ok: false; readonly reason: string };

export interface HealthCheck {
  readonly path: string;
  /** Cold start budget. vLLM compiles graphs; llama.cpp just mmaps. */
  readonly readyDeadlineMs: number;
  readonly intervalMs: number;
}

/** Canonical metric name -> the Prometheus names that may carry it, in priority order.
 *  Engines disagree on spelling (`vllm:` vs `llamacpp:`), so the reader takes the first
 *  present rather than branching per engine. */
export type MetricMap = Readonly<Record<CanonicalMetric, readonly string[]>>;

export type CanonicalMetric =
  | "requestsRunning"
  | "requestsWaiting"
  | "kvCacheUtilization"
  | "promptTokensTotal"
  | "generationTokensTotal";

export interface PortBinding {
  readonly container: number;
  readonly host: number;
}

export interface Mount {
  readonly from: string;
  readonly to: string;
  readonly readOnly: boolean;
}

/**
 * The universal currency between an engine and a launcher. An engine says *what* to run;
 * a launcher decides *how*. Note `devices` is abstract — the engine never writes
 * CUDA_VISIBLE_DEVICES or `--gpus`; `applyDevices` does, once, for every engine.
 */
export interface LaunchPlan {
  readonly kind: EngineRuntimeKind;
  /** The container's entrypoint args. */
  readonly argv: readonly string[];
  readonly image?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly ports: readonly PortBinding[];
  readonly mounts: readonly Mount[];
  readonly devices: readonly DeviceId[];
  readonly workdir?: string;
  readonly health: HealthCheck;
}

/**
 * The tuning knobs a recipe exposes, named once and canonically. Each engine declares how
 * it spells them (`Spelling`); an engine with no equivalent for a knob drops it rather
 * than guessing. Adding a knob is a one-line change per engine instead of an edit to two
 * near-identical 40-line argument builders.
 */
export interface ServingOptions {
  readonly tensorParallel: number;
  readonly pipelineParallel: number;
  readonly maxContextLength: number;
  readonly memoryFraction: number;
  readonly maxConcurrentRequests: number;
  /** "auto" is treated as unset — every engine defaults it the same way. */
  readonly kvCacheDtype: string | null;
  readonly dtype: string | null;
  readonly quantization: string | null;
  readonly trustRemoteCode: boolean;
  readonly toolCallParser: string | null;
  readonly reasoningParser: string | null;
}

export interface LaunchRequest {
  readonly engine: EngineId;
  readonly host: HostProfile;
  readonly runtime: EngineRuntimeKind;
  readonly devices: readonly DeviceId[];
  readonly port: number;
  /** Absolute path to the model directory. */
  readonly modelPath: string;
  readonly servedModelName: string;
  readonly options: ServingOptions;
  /** Verbatim recipe flags, appended last; any base flag they repeat is dropped. */
  readonly extraArgs: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly dockerImage: string | null;
}

/** An engine as the compute layer sees it: what it supports, how to plan a
 *  launch, how to check it. Named apart from the legacy engines module's
 *  EngineSpec (install/probe/runtime-info), which it will eventually replace. */
export interface ComputeEngineSpec {
  readonly id: EngineId;
  readonly supports: (host: HostProfile) => EngineSupport;
  readonly plan: (request: LaunchRequest) => LaunchPlan;
  readonly health: HealthCheck;
  readonly metrics: MetricMap;
  /** The pinned serving image for this engine on this hardware. */
  readonly image: (host: HostProfile) => string | null;
  readonly defaultPort: number;
}

/* ── instances ───────────────────────────────────────────────────────────── */

export type HandleReference =
  | {
      readonly kind: "process";
      readonly pid: number;
      readonly processGroupId: number | null;
      readonly sessionId: number | null;
      readonly startToken: string | null;
    }
  | {
      readonly kind: "docker";
      readonly containerId: string;
      readonly daemonId: string;
      readonly executablePath: string;
      readonly executableToken: string;
    }
  | {
      readonly kind: "docker-pending";
      readonly containerName: string;
      readonly nonce: string;
      readonly daemonId: string;
      readonly executablePath: string;
      readonly executableToken: string;
    }
  | { readonly kind: "remote"; readonly nodeId: NodeId; readonly name: string }
  /** A device hold with no supervised process — e.g. the speech worker claims its GPU
   *  through the lease shim. Always "alive"; freed only by explicit release. */
  | { readonly kind: "pinned"; readonly holder: string };

/**
 * The single source of truth for a running deployment, persisted as one JSON file per
 * instance (write-then-rename). `devices` **is** the GPU lease: capacity is derived by
 * unioning the devices of every record whose handle is still alive.
 */
export interface InstanceRecord {
  readonly name: string;
  readonly nodeId: NodeId;
  readonly engine: EngineId;
  readonly recipeId: string;
  readonly runtime: EngineRuntimeKind;
  /** null while the record is a reservation and nothing has spawned yet. */
  readonly ref: HandleReference | null;
  readonly port: number;
  readonly devices: readonly DeviceId[];
  /** Proves we started it; a launcher refuses to signal a handle whose nonce differs. */
  readonly nonce: string;
  readonly startedAt: string;
  readonly readyDeadlineAt: string;
}

export type InstanceState = "reserving" | "starting" | "ready" | "unhealthy" | "exited";

/* ── devices ─────────────────────────────────────────────────────────────── */

export type TelemetryField =
  | "memory"
  | "utilization"
  | "temperature"
  | "power"
  | "storage"
  | "hostMemory";

export type DeviceVendor = "nvidia" | "amd" | "apple" | "intel" | "unknown";

export interface AcceleratorInfo {
  readonly id: DeviceId;
  readonly index: number;
  readonly vendor: DeviceVendor;
  readonly name: string;
  readonly accelerator: Accelerator;
  readonly memoryTotalBytes: number;
  readonly memoryUsedBytes: number;
  readonly unifiedMemory: boolean;
  /** null means "this platform cannot report it", not "zero". */
  readonly utilizationPct: number | null;
  readonly temperatureC: number | null;
  readonly powerWatts: number | null;
  readonly powerLimitWatts: number | null;
  readonly driver: string | null;
}

export interface HostInfo {
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly memoryTotalBytes: number;
  readonly memoryAvailableBytes: number;
  readonly swapTotalBytes: number | null;
  readonly platform: HostPlatform;
  readonly arch: HostArch;
  readonly release: string;
  readonly uptimeSeconds: number;
}

export interface VolumeInfo {
  readonly mount: string;
  readonly totalBytes: number;
  readonly freeBytes: number;
  readonly filesystem: string | null;
  readonly model: string | null;
  readonly rotational: boolean | null;
}

export interface ThermalInfo {
  readonly label: string;
  readonly celsius: number;
  readonly source: "gpu" | "cpu" | "chassis";
}

export interface DeviceSnapshot {
  readonly sampledAt: string;
  readonly accelerators: readonly AcceleratorInfo[];
  readonly host: HostInfo;
  readonly storage: readonly VolumeInfo[];
  readonly thermals: readonly ThermalInfo[];
  /** What the probes on this host can actually answer. A field absent here renders as
   *  "unsupported" rather than a plausible zero. */
  readonly capabilities: readonly TelemetryField[];
}

/* ── failure ─────────────────────────────────────────────────────────────── */

/** One union replaces twelve ad-hoc failure channels. Only `lifecycle` produces these,
 *  and only `toHttp`/`toEvent` render them — so an HTTP status can never again be
 *  chosen by substring-matching an error message. */
export type LaunchFailure =
  | { readonly kind: "unsupported"; readonly engine: EngineId; readonly reason: string }
  | { readonly kind: "already-running"; readonly name: string }
  | { readonly kind: "no-capacity"; readonly need: number; readonly free: number }
  | { readonly kind: "install-failed"; readonly engine: EngineId; readonly detail: string }
  | { readonly kind: "spawn-failed"; readonly detail: string; readonly startedReference?: HandleReference }
  | {
      readonly kind: "exited-early";
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly logTail: string;
    }
  | { readonly kind: "unhealthy-timeout"; readonly waitedMs: number; readonly logTail: string }
  | { readonly kind: "cancelled" };
