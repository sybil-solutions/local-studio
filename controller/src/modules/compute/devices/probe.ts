import { Effect } from "effect";
import type { DeviceSnapshot, HostProfile, TelemetryField } from "../contracts";

/** What a probe contributes to the merged snapshot. */
export type SnapshotFragment = Partial<Omit<DeviceSnapshot, "sampledAt" | "capabilities">>;

export interface ProbeResult {
  readonly fragment: SnapshotFragment;
  /** Fields this probe can genuinely answer on this host. A field absent here renders as
   *  "unsupported" rather than as a plausible zero. */
  readonly capabilities: readonly TelemetryField[];
}

export interface DeviceProbe {
  readonly id: string;
  /** Cheap gate — no I/O. Probes that pass still have to tolerate missing tooling. */
  readonly detect: (host: HostProfile) => boolean;
  readonly run: (host: HostProfile) => Effect.Effect<ProbeResult>;
}

export const emptyResult: ProbeResult = { fragment: {}, capabilities: [] };

/** A probe must never fail the snapshot: a missing tool is data, not an error. */
export const neverFails = (effect: Effect.Effect<ProbeResult>): Effect.Effect<ProbeResult> =>
  effect.pipe(Effect.catchCause(() => Effect.succeed(emptyResult)));
