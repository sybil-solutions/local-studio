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
  readonly launchPrepared: (
    identity: ComputeLaunchInput,
    prepare: () => Effect.Effect<ComputeLaunchInput, LaunchFailure>,
  ) => Effect.Effect<InstanceRecord, LaunchFailure>;
  readonly stop: (name: string) => Effect.Effect<boolean>;
  readonly cancel: (name: string, attemptNonce: string) => Effect.Effect<boolean>;
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
    return launcherOf(record).alive(record.ref);
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

  const stopRecord = (record: InstanceRecord): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (record.ref === null) return;
      const launcher = launcherOf(record);
      // Never signal what we cannot prove is ours — a recycled pid or a hand-recreated
      // container just gets its record dropped.
      if (yield* launcher.owns(record.ref, record)) {
        yield* launcher.stop(record.ref, STOP_GRACE_MS);
      }
    });

  const cleanupFailure = (
    record: InstanceRecord,
    failure: LaunchFailure,
  ): Effect.Effect<never, LaunchFailure> =>
    Effect.gen(function* () {
      yield* stopRecord(record);
      deps.store.release(record.name, record.nonce);
      cancelRequested.delete(record.nonce);
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
        if (
          cancelRequested.has(record.nonce) ||
          deps.store.read(record.name)?.nonce !== record.nonce
        ) {
          return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
        }
        // Liveness before health: if our daemon died, a 200 on this port is someone else.
        if (!(yield* recordAlive(record))) {
          const logTail =
            record.ref === null ? "" : yield* launcherOf(record).logTail(record.ref, record);
          return yield* Effect.fail<LaunchFailure>({
            kind: "exited-early",
            exitCode: null,
            signal: null,
            logTail,
          });
        }
        if (yield* healthy(record)) {
          if (
            cancelRequested.has(record.nonce) ||
            deps.store.read(record.name)?.nonce !== record.nonce
          ) {
            return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
          }
          return;
        }
        yield* Effect.sleep(spec.health.intervalMs);
      }
      const logTail =
        record.ref === null ? "" : yield* launcherOf(record).logTail(record.ref, record);
      return yield* Effect.fail<LaunchFailure>({
        kind: "unhealthy-timeout",
        waitedMs: Date.now() - startedAt,
        logTail,
      });
    });

  const runAttempt = (
    attempt: InstanceRecord,
    prepare: () => Effect.Effect<ComputeLaunchInput, LaunchFailure>,
  ): Effect.Effect<InstanceRecord, LaunchFailure> => {
    const spec = engineSpec(attempt.engine);
    let current = attempt;
    return Effect.gen(function* () {
      const input = yield* prepare();
      if (
        input.name !== attempt.name ||
        input.engine !== attempt.engine ||
        input.recipeId !== attempt.recipeId ||
        input.runtime !== attempt.runtime
      ) {
        return yield* Effect.fail<LaunchFailure>({
          kind: "spawn-failed",
          detail: "prepared launch identity does not match its attempt",
        });
      }
      if (
        cancelRequested.has(attempt.nonce) ||
        deps.store.read(attempt.name)?.nonce !== attempt.nonce
      ) {
        return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
      }

      const host = yield* deps.host();
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

      if (
        cancelRequested.has(attempt.nonce) ||
        deps.store.read(attempt.name)?.nonce !== attempt.nonce
      ) {
        return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
      }
      const candidates = input.devices ?? (yield* deps.freeDevices());
      if (
        cancelRequested.has(attempt.nonce) ||
        deps.store.read(attempt.name)?.nonce !== attempt.nonce
      ) {
        return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
      }
      const record = yield* deps.store.reserve(
        {
          name: input.name,
          nodeId: host.nodeId,
          engine: input.engine,
          recipeId: input.recipeId,
          runtime: input.runtime,
          attemptNonce: attempt.nonce,
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
      current = record;

      if (cancelRequested.has(record.nonce)) {
        return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
      }

      yield* deps.onEvent(record.name, "launching", `${input.engine} on :${record.port}`);

      if (
        cancelRequested.has(record.nonce) ||
        deps.store.read(record.name)?.nonce !== record.nonce
      ) {
        return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
      }

      const plan = input.commandOverride
        ? applyDevices(
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

      const reference = yield* deps.launcherFor(input.runtime).start(plan, record);

      const started: InstanceRecord = { ...record, ref: reference };
      current = started;
      if (cancelRequested.has(started.nonce) || !deps.store.replace(started, started.nonce)) {
        return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
      }

      yield* waitReady(started);
      cancelRequested.delete(started.nonce);
      yield* deps.onEvent(started.name, "ready", `healthy on :${started.port}`);
      return started;
    }).pipe(Effect.catch((failure) => cleanupFailure(current, failure)));
  };

  const launchPrepared = (
    identity: ComputeLaunchInput,
    prepare: () => Effect.Effect<ComputeLaunchInput, LaunchFailure>,
  ): Effect.Effect<InstanceRecord, LaunchFailure> =>
    Effect.gen(function* () {
      if (identity.name === "speech") {
        return yield* Effect.fail<LaunchFailure>({
          kind: "spawn-failed",
          detail: "speech is reserved for the speech GPU lease",
        });
      }
      const spec = engineSpec(identity.engine);
      const acquire = (): InstanceRecord | null => {
        const acquiredAt = Date.now();
        return deps.store.acquire({
          name: identity.name,
          nodeId: "self",
          engine: identity.engine,
          recipeId: identity.recipeId,
          runtime: identity.runtime,
          ref: null,
          port: identity.portOverride ?? spec.defaultPort,
          devices: [],
          startedAt: new Date(acquiredAt).toISOString(),
          readyDeadlineAt: new Date(
            acquiredAt + (readyDeadlineOverrideMs() ?? spec.health.readyDeadlineMs),
          ).toISOString(),
        });
      };
      let attempt = yield* Effect.sync(acquire);
      if (!attempt) {
        const existing = deps.store.read(identity.name);
        if (!existing) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "already-running",
            name: identity.name,
          });
        }
        const state = yield* stateOf(existing);
        if (state === "ready" || state === "starting" || state === "reserving") {
          return yield* Effect.fail<LaunchFailure>({
            kind: "already-running",
            name: identity.name,
          });
        }
        yield* stopRecord(existing);
        deps.store.release(existing.name, existing.nonce);
        attempt = yield* Effect.sync(acquire);
        if (!attempt) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "already-running",
            name: identity.name,
          });
        }
      }
      return yield* runAttempt(attempt, prepare);
    });

  const launch = (input: ComputeLaunchInput): Effect.Effect<InstanceRecord, LaunchFailure> =>
    launchPrepared(input, () => Effect.succeed(input));

  const stop = (name: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const record = deps.store.read(name);
      if (!record) return false;
      yield* stopRecord(record);
      if (!deps.store.release(name, record.nonce)) return false;
      yield* deps.onEvent(name, "stopped", `freed :${record.port}`);
      return true;
    });

  const cancel = (name: string, attemptNonce: string): Effect.Effect<boolean> =>
    Effect.sync(() => {
      if (deps.store.read(name)?.nonce !== attemptNonce) return false;
      cancelRequested.add(attemptNonce);
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
            if (deps.store.release(record.name, record.nonce)) reaped += 1;
          }
          continue;
        }
        if (!(yield* recordAlive(record))) {
          // Dropping the record frees its devices by construction — there is no release
          // call to forget and no cache to invalidate.
          if (deps.store.release(record.name, record.nonce)) {
            reaped += 1;
            yield* deps.onEvent(record.name, "exited", "process gone; record reaped");
          }
        }
      }
      return reaped;
    });

  return { launch, launchPrepared, stop, cancel, stateOf, instances, superviseOnce };
};
