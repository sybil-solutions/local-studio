import { Effect } from "effect";
import type {
  Accelerator,
  DeviceSnapshot,
  HostProfile,
  NodeId,
  TelemetryField,
} from "../contracts";
import { acceleratorProbe } from "./accelerators";
import { hostArch, hostPlatform, hostProbe, readHostInfo } from "./host";
import { storageProbe } from "./storage";
import { thermalProbe } from "./thermal";
import type { DeviceProbe } from "./probe";

export interface TelemetryOptions {
  readonly nodeId?: NodeId;
  /** Extra paths to report free space for — model store, data root. */
  readonly storagePaths?: readonly string[];
  /** How long a sample stays fresh. Ten dashboard clients then cost one `nvidia-smi`. */
  readonly ttlMs?: number;
}

const DEFAULT_TTL_MS = 1_000;

const probesFor = (options: TelemetryOptions): readonly DeviceProbe[] => [
  hostProbe,
  acceleratorProbe,
  storageProbe(options.storagePaths ?? []),
  thermalProbe,
];

/** Derive the host profile from a snapshot: the accelerator mix decides what can run. */
export const profileFrom = (
  snapshot: DeviceSnapshot,
  options: { readonly nodeId: NodeId; readonly docker: boolean; readonly dockerGpu: boolean },
): HostProfile => {
  const first = snapshot.accelerators[0];
  const accelerator: Accelerator = first?.accelerator ?? "cpu";
  return {
    nodeId: options.nodeId,
    platform: snapshot.host.platform,
    arch: snapshot.host.arch,
    accelerator,
    // Apple Silicon always; NVIDIA only for the Grace/GB10 parts that share LPDDR.
    unifiedMemory: snapshot.accelerators.some((entry) => entry.unifiedMemory),
    wsl: isWsl(),
    docker: options.docker,
    // macOS Docker has no Metal passthrough, so a container there would silently run on CPU.
    dockerGpu: options.dockerGpu && snapshot.host.platform !== "darwin",
    deviceCount: snapshot.accelerators.length,
  };
};

const WSL_MARKER = /microsoft/i;

export const isWsl = (): boolean =>
  hostPlatform() === "linux" && WSL_MARKER.test(process.env["WSL_DISTRO_NAME"] ?? "");

/** A profile good enough to run probes with, before a full snapshot exists. */
export const bootstrapProfile = (nodeId: NodeId): HostProfile => ({
  nodeId,
  platform: hostPlatform(),
  arch: hostArch(),
  accelerator: "cpu",
  unifiedMemory: false,
  wsl: isWsl(),
  docker: false,
  dockerGpu: false,
  deviceCount: 0,
});

const mergeCapabilities = (
  collected: readonly (readonly TelemetryField[])[],
): readonly TelemetryField[] => [...new Set(collected.flat())];

export const collectSnapshot = (
  options: TelemetryOptions = {},
): Effect.Effect<DeviceSnapshot> =>
  Effect.gen(function* () {
    const nodeId = options.nodeId ?? "self";
    const profile = bootstrapProfile(nodeId);
    const probes = probesFor(options).filter((probe) => probe.detect(profile));
    // Probes are independent and all of them are I/O-bound; sampling them together keeps
    // one snapshot to the cost of its slowest probe rather than their sum.
    const results = yield* Effect.all(
      probes.map((probe) => probe.run(profile)),
      { concurrency: "unbounded" },
    );
    return {
      sampledAt: new Date().toISOString(),
      accelerators: results.flatMap((result) => result.fragment.accelerators ?? []),
      host: results.reduce<DeviceSnapshot["host"]>(
        (host, result) => result.fragment.host ?? host,
        readHostInfo(),
      ),
      storage: results.flatMap((result) => result.fragment.storage ?? []),
      thermals: results.flatMap((result) => result.fragment.thermals ?? []),
      capabilities: mergeCapabilities(results.map((result) => result.capabilities)),
    };
  });

export interface Telemetry {
  readonly snapshot: () => Effect.Effect<DeviceSnapshot>;
}

/**
 * Cached sampler. Telemetry is strictly read-only — it never touches an instance record —
 * which is what makes it safe to poll from anywhere.
 */
export const makeTelemetry = (options: TelemetryOptions = {}): Telemetry => {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  let cached: { readonly at: number; readonly value: DeviceSnapshot } | null = null;

  return {
    snapshot: () =>
      Effect.gen(function* () {
        const now = Date.now();
        if (cached && now - cached.at < ttlMs) return cached.value;
        const value = yield* collectSnapshot(options);
        cached = { at: now, value };
        return value;
      }),
  };
};
