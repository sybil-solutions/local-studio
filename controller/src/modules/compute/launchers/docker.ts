import { closeSync, realpathSync, statSync } from "node:fs";
import { Effect } from "effect";
import type { Accelerator, HandleReference, InstanceRecord, LaunchPlan } from "../contracts";
import {
  resolveBinary,
  runCommandAsyncEffect,
  type AsyncCommandResult,
} from "../../../core/command";
import { openPrivateLogFile, readPrivateLogTail } from "../../../core/log-files";
import { startRedactedCommandProxy } from "../../../core/log-proxy";
import { redactLogLine } from "../../../core/log-redaction";
import { dockerFlagsFor } from "../engines/devices";
import { LOG_TAIL_BYTES, spawnFailed, type Launcher } from "./launcher";

const NAME_LABEL = "local-studio.instance";
const NONCE_LABEL = "local-studio.nonce";
const DOCKER_TIMEOUT_MS = 30_000;

const containerName = (instanceName: string): string =>
  `local-studio-${instanceName.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;

export interface DockerExecutable {
  readonly path: string;
  readonly token: string;
}

export interface DockerLauncherRuntime {
  readonly resolveExecutable: () => DockerExecutable | null;
  readonly run: (
    executable: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Effect.Effect<AsyncCommandResult>;
  readonly startAttached: (
    path: string,
    executable: string,
    args: readonly string[],
  ) => Effect.Effect<void, Error>;
}

const realRuntime: DockerLauncherRuntime = {
  resolveExecutable: () => {
    try {
      const resolved = resolveBinary("docker");
      if (!resolved) return null;
      const path = realpathSync.native(resolved);
      const stat = statSync(path);
      return { path, token: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}` };
    } catch {
      return null;
    }
  },
  run: (executable, args, timeoutMs) => runCommandAsyncEffect(executable, [...args], { timeoutMs }),
  startAttached: (path, executable, args) =>
    startRedactedCommandProxy(path, executable, args).pipe(Effect.asVoid),
};

const docker = (
  runtime: DockerLauncherRuntime,
  executable: string,
  args: readonly string[],
  timeoutMs = DOCKER_TIMEOUT_MS,
): Effect.Effect<AsyncCommandResult> => runtime.run(executable, args, timeoutMs);

const sameExecutable = (reference: HandleReference, executable: DockerExecutable | null): boolean =>
  reference.kind === "docker" &&
  executable?.path === reference.executablePath &&
  executable.token === reference.executableToken;

const sameDockerReference = (reference: HandleReference, record: InstanceRecord): boolean => {
  const stored = record.ref;
  return (
    reference.kind === "docker" &&
    stored?.kind === "docker" &&
    reference.containerId === stored.containerId &&
    reference.daemonId === stored.daemonId &&
    reference.executablePath === stored.executablePath &&
    reference.executableToken === stored.executableToken
  );
};

const ownership = (
  reference: HandleReference,
  record: InstanceRecord,
  runtime: DockerLauncherRuntime,
): Effect.Effect<"owned" | "stopped" | "gone" | "unknown"> =>
  Effect.gen(function* () {
    if (
      reference.kind !== "docker" ||
      !sameDockerReference(reference, record) ||
      !/^[a-f0-9]{64}$/.test(reference.containerId)
    )
      return "unknown";
    const executable = runtime.resolveExecutable();
    if (!sameExecutable(reference, executable) || !executable) return "unknown";
    const daemon = yield* docker(runtime, executable.path, ["info", "--format", "{{.ID}}"]);
    if (daemon.status !== 0 || daemon.stdout.trim() !== reference.daemonId) return "unknown";
    const inspected = yield* docker(runtime, executable.path, [
      "inspect",
      "--format",
      `{{.Id}}\n{{index .Config.Labels "${NONCE_LABEL}"}}\n{{index .Config.Labels "${NAME_LABEL}"}}\n{{.State.Running}}`,
      reference.containerId,
    ]);
    if (inspected.status !== 0) {
      return inspected.stderr.trim() === `Error: No such object: ${reference.containerId}`
        ? "gone"
        : "unknown";
    }
    const [containerId, nonce, name, running, ...extra] = inspected.stdout.trim().split(/\r?\n/);
    const exact =
      extra.length === 0 &&
      containerId === reference.containerId &&
      nonce === record.nonce &&
      name === record.name;
    return exact && running === "true"
      ? "owned"
      : exact && running === "false"
        ? "stopped"
        : "unknown";
  });

export const makeDockerLauncher = (
  accelerator: Accelerator,
  logPathFor: (name: string) => string,
  runtime: DockerLauncherRuntime = realRuntime,
): Launcher => ({
  start: (plan: LaunchPlan, record: InstanceRecord) =>
    Effect.gen(function* () {
      if (!plan.image) return yield* spawnFailed(`no image for ${record.engine} on this host`);
      const executable = runtime.resolveExecutable();
      if (!executable) return yield* spawnFailed("docker executable identity unavailable");
      const daemon = yield* docker(runtime, executable.path, ["info", "--format", "{{.ID}}"]);
      const daemonId = daemon.status === 0 ? daemon.stdout.trim() : "";
      if (!daemonId) return yield* spawnFailed("docker daemon identity unavailable");
      const logPath = logPathFor(record.name);
      yield* Effect.try({
        try: () => {
          const descriptor = openPrivateLogFile(logPath, true);
          closeSync(descriptor);
        },
        catch: () => undefined,
      }).pipe(Effect.catch(() => spawnFailed(`cannot open private log for ${record.name}`)));
      const name = containerName(record.name);
      const deviceFlags = dockerFlagsFor(accelerator, plan.devices);
      const arguments_: string[] = [
        "create",
        "--name",
        name,
        "--log-driver",
        "none",
        "--label",
        `${NAME_LABEL}=${record.name}`,
        "--label",
        `${NONCE_LABEL}=${record.nonce}`,
        ...deviceFlags.args,
        ...deviceFlags.groupAdd.flatMap((group) => ["--group-add", group]),
        ...plan.ports.flatMap((binding) => ["-p", `${binding.host}:${binding.container}`]),
        ...plan.mounts.flatMap((mount) => [
          "-v",
          `${mount.from}:${mount.to}${mount.readOnly ? ":ro" : ""}`,
        ]),
        ...Object.entries(plan.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        plan.image,
        ...plan.argv,
      ];
      const result = yield* docker(runtime, executable.path, arguments_, 120_000);
      if (result.status !== 0) {
        return yield* spawnFailed(
          redactLogLine(`docker create failed: ${result.stderr || result.stdout}`),
        );
      }
      const containerId = result.stdout.trim();
      if (!/^[a-f0-9]{64}$/.test(containerId)) {
        return yield* spawnFailed("docker returned an invalid container identity");
      }
      const reference = {
        kind: "docker",
        containerId,
        daemonId,
        executablePath: executable.path,
        executableToken: executable.token,
      } as const;
      const durable = { ...record, ref: reference };
      const proof = yield* ownership(reference, durable, runtime);
      if (proof !== "stopped") {
        return yield* spawnFailed("docker identity changed during create");
      }
      const attached = yield* runtime
        .startAttached(logPath, executable.path, ["start", "--attach", containerId])
        .pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
      let started = false;
      if (attached) {
        for (let attempt = 0; attempt < 100 && !started; attempt += 1) {
          const current = yield* ownership(reference, durable, runtime);
          if (current === "owned") {
            started = true;
            break;
          }
          if (current !== "stopped") break;
          yield* Effect.sleep(50);
        }
      }
      if (!started) {
        const current = yield* ownership(reference, durable, runtime);
        if (current === "owned" || current === "stopped") {
          yield* docker(runtime, executable.path, ["rm", "-f", containerId]).pipe(Effect.ignore);
        }
        const diagnostic = readPrivateLogTail(logPath, LOG_TAIL_BYTES).trim();
        return yield* spawnFailed(
          diagnostic ? `docker start failed: ${diagnostic}` : "docker start failed",
        );
      }
      return reference;
    }),

  alive: (reference, record) =>
    ownership(reference, record, runtime).pipe(
      Effect.map((state) => state !== "gone" && state !== "stopped"),
    ),

  owns: (reference, record) =>
    ownership(reference, record, runtime).pipe(
      Effect.map((state) => state === "owned" || state === "stopped"),
    ),

  stop: (reference, record, graceMs) =>
    reference.kind !== "docker"
      ? Effect.void
      : Effect.gen(function* () {
          const initial = yield* ownership(reference, record, runtime);
          if (initial !== "owned" && initial !== "stopped") return;
          yield* docker(
            runtime,
            reference.executablePath,
            ["stop", "-t", String(Math.ceil(graceMs / 1000)), reference.containerId],
            graceMs + DOCKER_TIMEOUT_MS,
          ).pipe(Effect.ignore);
          const final = yield* ownership(reference, record, runtime);
          if (final !== "owned" && final !== "stopped") return;
          yield* docker(runtime, reference.executablePath, [
            "rm",
            "-f",
            reference.containerId,
          ]).pipe(Effect.ignore);
        }),

  logTail: (reference, record) =>
    reference.kind !== "docker"
      ? Effect.succeed("")
      : Effect.sync(() => readPrivateLogTail(logPathFor(record.name), LOG_TAIL_BYTES)),
});
