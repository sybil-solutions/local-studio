import { Effect } from "effect";
import type {
  DeviceId,
  EngineId,
  HostProfile,
  InstanceRecord,
  InstanceState,
  LaunchFailure,
  EngineRuntimeKind,
  ServingOptions,
} from "./contracts";
import { fetchLocal } from "../../http/local-fetch";
import { applyDevices } from "./engines/devices";
import { engineSpec, planLaunch, supportsRuntime } from "./engines/registry";
import { toEvent } from "./failures";
import type { Launcher } from "./launchers/launcher";
import type { InstanceStore } from "./instances/store";

/**
 * The only mutator in the compute layer. Everything it knows lives in the instance
 * records; there is no coordinator state to go stale, and cancellation is one flag per
 * name rather than an abort controller + an intent serial + a boolean racing each other.
 */

const STOP_GRACE_MS = 20_000;

/** Operators tune cold-start budgets per box (large MoE + AOT compile can exceed any
 *  default); the legacy env override keeps working. */
const readyDeadlineOverrideMs = (): number | null => {
  const raw = process.env["LOCAL_STUDIO_READY_TIMEOUT_MS"];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const HEALTH_PROBE_TIMEOUT_MS = 3_000;

export interface ComputeDeps {
  readonly store: InstanceStore;
  readonly launcherFor: (runtime: EngineRuntimeKind) => Launcher;
  readonly host: () => Effect.Effect<HostProfile>;
  readonly freeDevices: () => Effect.Effect<readonly DeviceId[]>;
  readonly onEvent: (name: string, stage: string, message: string) => Effect.Effect<void>;
}

export interface ComputeLaunchInput {
  readonly name: string;
  readonly engine: EngineId;
  readonly recipeId: string;
  readonly runtime: EngineRuntimeKind;
  readonly deviceCount: number;
  /** Pin the launch to these devices (recipe GPU selectors); default = any free. */
  readonly devices?: readonly DeviceId[];
  /** Serve on exactly this port (legacy inference_port); default = engine base scan. */
  readonly portOverride?: number;
  /** Verbatim launch argv (recipe custom launch command); replaces the engine plan. */
  readonly commandOverride?: readonly string[];
  readonly modelPath: string;
  readonly servedModelName: string;
  readonly options: ServingOptions;
  readonly extraArgs: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly dockerImage: string | null;
  readonly binary: string | null;
}

export interface InstanceView {
  readonly record: InstanceRecord;
  readonly state: InstanceState;
}

export interface ComputeService {
  readonly launch: (input: ComputeLaunchInput) => Effect.Effect<InstanceRecord, LaunchFailure>;
  readonly stop: (name: string) => Effect.Effect<boolean>;
  readonly cancel: (name: string) => Effect.Effect<boolean>;
  readonly stateOf: (record: InstanceRecord) => Effect.Effect<InstanceState>;
  readonly instances: () => Effect.Effect<readonly InstanceView[]>;
  /** One supervisor pass: drop records whose handle is gone. The only reaper. */
  readonly superviseOnce: () => Effect.Effect<number>;
}

export const makeComputeService = (deps: ComputeDeps): ComputeService => {
  const cancelRequested = new Set<string>();

  const launcherOf = (record: InstanceRecord): Launcher => deps.launcherFor(record.runtime);

  const recordAlive = (record: InstanceRecord): Effect.Effect<boolean> => {
    if (record.ref === null) return Effect.succeed(false);
    // Pinned holds have no supervised process; they live until explicitly released.
    if (record.ref.kind === "pinned") return Effect.succeed(true);
    return launcherOf(record).alive(record.ref, record);
  };

  const healthy = (record: InstanceRecord): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const spec = engineSpec(record.engine);
      const response = yield* fetchLocal(record.port, spec.health.path, {
        timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
      }).pipe(Effect.catch(() => Effect.succeed(null)));
      return response !== null && response.ok;
    });

  /** Liveness first, then health, then the deadline. Never stored anywhere. */
  const stateOf = (record: InstanceRecord): Effect.Effect<InstanceState> =>
    Effect.gen(function* () {
      if (record.ref === null) return "reserving";
      if (!(yield* recordAlive(record))) return "exited";
      if (yield* healthy(record)) return "ready";
      return Date.now() < Date.parse(record.readyDeadlineAt) ? "starting" : "unhealthy";
    });

  const stopRecord = (record: InstanceRecord): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (record.ref === null) return true;
      const launcher = launcherOf(record);
      if (yield* launcher.owns(record.ref, record)) {
        yield* launcher.stop(record.ref, record, STOP_GRACE_MS);
      }
      return !(yield* launcher.owns(record.ref, record)) && !(yield* launcher.alive(record.ref, record));
    });

  const failCleanup = (
    record: InstanceRecord,
    failure: LaunchFailure,
  ): Effect.Effect<never, LaunchFailure> =>
    Effect.gen(function* () {
      if (yield* stopRecord(record)) deps.store.drop(record.name);
      cancelRequested.delete(record.name);
      const event = toEvent(failure);
      yield* deps.onEvent(record.name, event.stage, event.message);
      return yield* Effect.fail(failure);
    });

  const waitReady = (record: InstanceRecord): Effect.Effect<void, LaunchFailure> =>
    Effect.gen(function* () {
      const spec = engineSpec(record.engine);
      const startedAt = Date.now();
      const deadline = Date.parse(record.readyDeadlineAt);
      while (Date.now() < deadline) {
        if (cancelRequested.has(record.name)) {
          return yield* failCleanup(record, { kind: "cancelled" });
        }
        // Liveness before health: if our daemon died, a 200 on this port is someone else.
        if (!(yield* recordAlive(record))) {
          const logTail =
            record.ref === null ? "" : yield* launcherOf(record).logTail(record.ref, record);
          return yield* failCleanup(record, {
            kind: "exited-early",
            exitCode: null,
            signal: null,
            logTail,
          });
        }
        if (yield* healthy(record)) return;
        yield* Effect.sleep(spec.health.intervalMs);
      }
      const logTail =
        record.ref === null ? "" : yield* launcherOf(record).logTail(record.ref, record);
      return yield* failCleanup(record, {
        kind: "unhealthy-timeout",
        waitedMs: Date.now() - startedAt,
        logTail,
      });
    });

  const launch = (input: ComputeLaunchInput): Effect.Effect<InstanceRecord, LaunchFailure> =>
    Effect.gen(function* () {
      const host = yield* deps.host();
      const spec = engineSpec(input.engine);
      const support = spec.supports(host);
      if (!support.ok) {
        return yield* Effect.fail<LaunchFailure>({
          kind: "unsupported",
          engine: input.engine,
          reason: support.reason,
        });
      }
      if (!supportsRuntime(input.engine, host, input.runtime)) {
        return yield* Effect.fail<LaunchFailure>({
          kind: "unsupported",
          engine: input.engine,
          reason: `runtime "${input.runtime}" not available (offers: ${support.runtimes.join(", ")})`,
        });
      }

      const existing = deps.store.read(input.name);
      if (existing) {
        const state = yield* stateOf(existing);
        if (state === "ready" || state === "starting" || state === "reserving") {
          return yield* Effect.fail<LaunchFailure>({ kind: "already-running", name: input.name });
        }
        // exited / unhealthy: reclaim the name.
        if (!(yield* stopRecord(existing))) {
          return yield* Effect.fail<LaunchFailure>({ kind: "already-running", name: input.name });
        }
        deps.store.drop(existing.name);
      }

      cancelRequested.delete(input.name);
      const candidates = input.devices ?? (yield* deps.freeDevices());
      const record = yield* deps.store.reserve(
        {
          name: input.name,
          nodeId: host.nodeId,
          engine: input.engine,
          recipeId: input.recipeId,
          runtime: input.runtime,
          candidates,
          need: input.devices
            ? input.devices.length
            : Math.min(input.deviceCount, Math.max(candidates.length, 0)),
          shareable: host.unifiedMemory && !input.devices,
          basePort: spec.defaultPort,
          ...(input.portOverride !== undefined ? { exactPort: input.portOverride } : {}),
          readyDeadlineMs: readyDeadlineOverrideMs() ?? spec.health.readyDeadlineMs,
        },
        recordAlive,
      );

      yield* deps.onEvent(record.name, "launching", `${input.engine} on :${record.port}`);

      const plan = input.commandOverride
        ? // A custom launch command is used verbatim — the recipe author owns the argv;
          // only device selection is still folded in.
          applyDevices(
            {
              kind: input.runtime,
              argv: [...input.commandOverride],
              env: input.env,
              ports: [{ container: record.port, host: record.port }],
              mounts: [],
              devices: record.devices,
              health: spec.health,
              ...(input.dockerImage ? { image: input.dockerImage } : {}),
            },
            host.accelerator,
          )
        : planLaunch({
            engine: input.engine,
            host,
            runtime: input.runtime,
            devices: record.devices,
            port: record.port,
            modelPath: input.modelPath,
            servedModelName: input.servedModelName,
            options: input.options,
            extraArgs: input.extraArgs,
            env: input.env,
            dockerImage: input.dockerImage,
            binary: input.binary ?? spec.defaultBinary,
          });

      const reference = yield* deps
        .launcherFor(input.runtime)
        .start(plan, record)
        .pipe(Effect.catch((failure) => failCleanup(record, failure)));

      const started: InstanceRecord = { ...record, ref: reference };
      deps.store.write(started);

      yield* waitReady(started);
      cancelRequested.delete(started.name);
      yield* deps.onEvent(started.name, "ready", `healthy on :${started.port}`);
      return started;
    });

  const stop = (name: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const record = deps.store.read(name);
      if (!record) return false;
      if (!(yield* stopRecord(record))) return false;
      deps.store.drop(name);
      yield* deps.onEvent(name, "stopped", `freed :${record.port}`);
      return true;
    });

  const cancel = (name: string): Effect.Effect<boolean> =>
    Effect.sync(() => {
      if (deps.store.read(name) === null) return false;
      cancelRequested.add(name);
      return true;
    });

  const instances = (): Effect.Effect<readonly InstanceView[]> =>
    Effect.gen(function* () {
      const views: InstanceView[] = [];
      for (const record of deps.store.all()) {
        views.push({ record, state: yield* stateOf(record) });
      }
      return views;
    });

  const superviseOnce = (): Effect.Effect<number> =>
    Effect.gen(function* () {
      let reaped = 0;
      for (const record of deps.store.all()) {
        // Pinned holds are freed by explicit release, never by the reaper.
        if (record.ref?.kind === "pinned") continue;
        // A reservation that never got a handle is a crashed launch; give it a minute.
        if (record.ref === null) {
          const age = Date.now() - Date.parse(record.startedAt);
          if (age > 60_000) {
            deps.store.drop(record.name);
            reaped += 1;
          }
          continue;
        }
        if (!(yield* recordAlive(record)) && (yield* stopRecord(record))) {
          // Dropping the record frees its devices by construction — there is no release
          // call to forget and no cache to invalidate.
          deps.store.drop(record.name);
          reaped += 1;
          yield* deps.onEvent(record.name, "exited", "process gone; record reaped");
        }
      }
      return reaped;
    });

  return { launch, stop, cancel, stateOf, instances, superviseOnce };
};
