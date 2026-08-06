import { realpathSync, statSync } from "node:fs";
import { Effect } from "effect";
import type { Accelerator, HandleReference, InstanceRecord, LaunchPlan } from "../contracts";
import { resolveBinary, runCommandAsyncEffect, type AsyncCommandResult } from "../../../core/command";
import { dockerFlagsFor } from "../engines/devices";
import { LOG_TAIL_BYTES, spawnFailed, type Launcher } from "./launcher";

/**
 * Container launcher. Ownership is a label pair written at `docker run` time: the
 * instance name and the record's nonce. `owns` compares the nonce, so a container someone
 * recreated by hand under the same name is never signalled — the exact analogue of the
 * process launcher's start-token check. All state queries are one `docker inspect` by
 * exact name; nothing ever lists all containers and filters, which is what made the old
 * launch path O(running containers).
 */

const NAME_LABEL = "local-studio.instance";
const NONCE_LABEL = "local-studio.nonce";
const DOCKER_TIMEOUT_MS = 30_000;

const containerName = (instanceName: string): string =>
  `local-studio-${instanceName.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;

export interface DockerExecutable { readonly path: string; readonly token: string }

export interface DockerLauncherRuntime {
  readonly resolveExecutable: () => DockerExecutable | null;
  readonly run: (executable: string, args: readonly string[], timeoutMs: number) => Effect.Effect<AsyncCommandResult>;
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
  return reference.kind === "docker" && stored?.kind === "docker" && reference.containerId === stored.containerId && reference.daemonId === stored.daemonId && reference.executablePath === stored.executablePath && reference.executableToken === stored.executableToken;
};

const ownership = (
  reference: HandleReference,
  record: InstanceRecord,
  runtime: DockerLauncherRuntime,
): Effect.Effect<"owned" | "stopped" | "gone" | "unknown"> =>
  Effect.gen(function* () {
    if (reference.kind !== "docker" || !sameDockerReference(reference, record) || !/^[a-f0-9]{64}$/.test(reference.containerId)) return "unknown";
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
      return inspected.stderr.trim() === `Error: No such object: ${reference.containerId}` ? "gone" : "unknown";
    }
    const [containerId, nonce, name, running, ...extra] = inspected.stdout.trim().split(/\r?\n/);
    const exact = extra.length === 0 &&
      containerId === reference.containerId &&
      nonce === record.nonce &&
      name === record.name;
    return exact && running === "true" ? "owned" : exact && running === "false" ? "stopped" : "unknown";
  });

export const makeDockerLauncher = (
  accelerator: Accelerator,
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
      const name = containerName(record.name);
      const deviceFlags = dockerFlagsFor(accelerator, plan.devices);
      const arguments_: string[] = [
        "run",
        "-d",
        "--name",
        name,
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
        return yield* spawnFailed("docker run failed");
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
      const proof = yield* ownership(reference, { ...record, ref: reference }, runtime); if (proof !== "owned" && proof !== "stopped") return yield* spawnFailed("docker identity changed during launch");
      return reference;
    }),

  alive: (reference, record) =>
    ownership(reference, record, runtime).pipe(Effect.map((state) => state !== "gone" && state !== "stopped")),

  owns: (reference, record) =>
    ownership(reference, record, runtime).pipe(Effect.map((state) => state === "owned" || state === "stopped")),

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

  logTail: (reference) =>
    reference.kind !== "docker"
      ? Effect.succeed("")
      : docker(runtime, reference.executablePath, [
          "logs",
          "--tail",
          "60",
          reference.containerId,
        ]).pipe(
          Effect.map((result) =>
            `${result.stdout}\n${result.stderr}`.trim().slice(-LOG_TAIL_BYTES),
          ),
        ),
});
