import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { basename } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { Cause, Effect, Exit, Fiber, Queue } from "effect";
import type { Config } from "../../../config/env";
import {
  cleanupLogFiles,
  getLogCleanupDefaultsFromEnvironment,
  primaryLogPathFor,
} from "../../../core/log-files";
import type { Logger } from "../../../core/logger";
import {
  realProcessRunner,
  resolveBinaryFromEnvironment,
  type CommandResult,
  type ProcessRunner,
  type SpawnedProcess,
} from "../../../core/command";
import type { LaunchResult, ProcessInfo, Recipe } from "../../models/types";
import type { EventManager } from "../../system/event-manager";
import { buildBackendCommand } from "./backend-builder";
import { readProcessInventory, type ProcessInventoryEntry } from "./process-inventory";
import {
  createProcessOwnershipStore,
  DOCKER_BINDING_ENVIRONMENT_KEYS,
  type DockerBindingEnvironment,
  inspectOwnedProcessGroup,
  type PendingProcessOwnershipRecord,
  type ProcessOwnershipLaunch,
  type ProcessOwnershipRecord,
  type ProcessOwnershipScope,
  type ProcessOwnershipStore,
  type SpawnedProcessOwnershipRecord,
} from "./process-ownership";
import {
  buildEnvironment,
  collectChildren,
  detectBackend,
  extractFlag,
  listProcesses,
  pidExists,
  buildProcessTree,
} from "./process-utilities";
import { getEngineSpec } from "../engine-spec";

export interface ProcessManager {
  findInferenceProcess: (port: number) => Effect.Effect<ProcessInfo | null>;
  confirmInferenceStopped: (port: number) => Effect.Effect<boolean>;
  launchModel: (recipe: Recipe, options?: LaunchModelOptions) => Effect.Effect<LaunchResult>;
  killProcess: (pid: number, force: boolean) => Effect.Effect<boolean>;
  killOwnedProcess: (pid: number, force: boolean) => Effect.Effect<boolean>;
  confirmOwnedProcessStopped: (pid: number) => Effect.Effect<boolean>;
  shutdown: () => Effect.Effect<boolean>;
}

export interface LaunchModelOptions {
  readonly gpuUuids?: readonly string[];
}

type LaunchResources = {
  readonly child: SpawnedProcess;
  readonly pid: number | null;
  readonly launchId: string | null;
  readonly queue: Queue.Queue<string | null>;
  readonly readers: Interface[];
  readonly logStream: WriteStream | null;
  readonly onChildError: (error: Error) => void;
  readonly onChildExit: () => void;
  readonly onLogError: ((error: Error) => void) | null;
  logFiber: Fiber.Fiber<void, never> | null;
  released: boolean;
};

type LaunchResourceRegistry = {
  readonly activePids: () => number[];
  readonly register: (resources: LaunchResources) => void;
  readonly release: (resources: LaunchResources) => Effect.Effect<void>;
  readonly stop: (resources: LaunchResources) => Effect.Effect<void>;
  readonly stopAll: () => Effect.Effect<void>;
  readonly stopForLaunch: (launchId: string) => Effect.Effect<void>;
  readonly stopForPid: (pid: number) => Effect.Effect<void>;
};

const closeLogStream = (stream: WriteStream | null): Effect.Effect<void> => {
  if (!stream || stream.closed || stream.destroyed) return Effect.void;
  return Effect.callback<void>((resume) => {
    let completed = false;
    const cleanup = (): void => {
      stream.removeListener("close", onClose);
      stream.removeListener("error", onError);
    };
    const finish = (): void => {
      if (completed) return;
      completed = true;
      cleanup();
      resume(Effect.void);
    };
    const onClose = (): void => finish();
    const onError = (): void => finish();
    stream.once("close", onClose);
    stream.once("error", onError);
    try {
      stream.end();
    } catch {
      finish();
    }
    return Effect.sync(cleanup);
  });
};

const createLaunchResourceRegistry = (): LaunchResourceRegistry => {
  const active = new Set<LaunchResources>();
  const release = (resources: LaunchResources): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (resources.released) return Effect.void;
      resources.released = true;
      return Effect.gen(function* () {
        yield* Effect.sync(() => {
          for (const reader of resources.readers) reader.close();
          if (resources.logStream && resources.onLogError) {
            resources.logStream.removeListener("error", resources.onLogError);
          }
          resources.child.removeListener("error", resources.onChildError);
          resources.child.removeListener("exit", resources.onChildExit);
        });
        yield* Queue.shutdown(resources.queue);
        yield* closeLogStream(resources.logStream);
        active.delete(resources);
      });
    });
  const stop = (resources: LaunchResources): Effect.Effect<void> => {
    Queue.offerUnsafe(resources.queue, null);
    return resources.logFiber
      ? Fiber.interrupt(resources.logFiber).pipe(Effect.asVoid)
      : release(resources);
  };
  const stopMatching = (predicate: (resources: LaunchResources) => boolean): Effect.Effect<void> =>
    Effect.forEach([...active].filter(predicate), stop, { discard: true });
  return {
    activePids: () => [
      ...new Set(
        [...active].map((resources) => resources.pid).filter((pid): pid is number => pid !== null),
      ),
    ],
    register: (resources): void => {
      active.add(resources);
    },
    release,
    stop,
    stopAll: () => stopMatching(() => true),
    stopForLaunch: (launchId) => stopMatching((resources) => resources.launchId === launchId),
    stopForPid: (pid) => stopMatching((resources) => resources.pid === pid),
  };
};

type OwnershipInspection =
  | {
      readonly status: "owned";
      readonly record: ProcessOwnershipRecord;
      readonly processGroupId: number;
      readonly members: readonly ProcessInventoryEntry[];
    }
  | { readonly status: "blocked" }
  | { readonly status: "gone"; readonly record: ProcessOwnershipRecord }
  | { readonly status: "missing" };

const DOCKER_LAUNCH_LABEL = "org.local-studio.launch-id";
const DOCKER_SETTLE_INTERVAL_MS = 50;
const DOCKER_SETTLE_WINDOW_MS = 500;
const DOCKER_STABLE_ABSENCE_COUNT = 3;
const PENDING_START_SKEW_MS = 2_000;
const PENDING_START_WINDOW_MS = 10_000;

type DockerAuthority = "direct";

type DockerRuntimeBinding = {
  readonly authority: DockerAuthority;
  readonly daemonFingerprint: string;
  readonly executable: string;
  readonly environment: NodeJS.ProcessEnv;
};

type DockerOwnershipFields = {
  readonly dockerAuthority: DockerAuthority;
  readonly dockerDaemonFingerprint: string;
  readonly dockerExecutable: string;
  readonly dockerEnvironment: DockerBindingEnvironment;
};

type DockerLaunchPreparation = {
  readonly command: string[];
  readonly ownership: DockerOwnershipFields;
};

type DockerBindingRegistry = {
  readonly prepareDockerLaunch: (
    launchId: string,
    command: readonly string[],
    environment: NodeJS.ProcessEnv,
  ) => DockerLaunchPreparation | null;
  readonly forgetDockerLaunch: (record: ProcessOwnershipRecord) => void;
  readonly verifiedDockerBinding: (record: ProcessOwnershipRecord) => DockerRuntimeBinding | null;
};

const recipeForLaunch = (recipe: Recipe, port: number, options: LaunchModelOptions): Recipe => {
  const updated = { ...recipe, port };
  if (options.gpuUuids === undefined) return updated;
  const selector = options.gpuUuids.join(",");
  return {
    ...updated,
    env_vars: { ...updated.env_vars, CUDA_VISIBLE_DEVICES: selector },
    extra_args: { ...updated.extra_args, visible_devices: selector },
  };
};

const stopWindowsDockerContainersForProcesses = (
  runner: ProcessRunner,
  logger: Logger,
  pids: readonly number[],
  force: boolean,
  allowPortCorrelation: boolean,
): boolean => {
  const pidSet = new Set(pids);
  const names = new Set<string>();
  const inferencePorts = new Set<number>();
  const processes = listProcesses(runner);
  for (const proc of processes) {
    if (!pidSet.has(proc.pid)) continue;
    const port = Number(extractFlag(proc.args, "--port"));
    if (Number.isFinite(port) && port > 0) inferencePorts.add(port);
    const dockerIndex = proc.args.findIndex(
      (argument) => argument === "docker" || argument.endsWith("/docker"),
    );
    if (dockerIndex < 0 || proc.args[dockerIndex + 1] !== "run") continue;
    const name = extractFlag(proc.args.slice(dockerIndex + 2), "--name");
    if (name) names.add(name);
  }
  if (allowPortCorrelation && inferencePorts.size > 0) {
    for (const proc of processes) {
      const dockerIndex = proc.args.findIndex(
        (argument) => argument === "docker" || argument.endsWith("/docker"),
      );
      if (dockerIndex < 0 || proc.args[dockerIndex + 1] !== "run") continue;
      const dockerPort = Number(extractFlag(proc.args, "--port"));
      if (!inferencePorts.has(dockerPort)) continue;
      const name = extractFlag(proc.args.slice(dockerIndex + 2), "--name");
      if (name) names.add(name);
    }
  }
  let stopped = true;
  for (const name of names) {
    const action = force ? "kill" : "stop";
    const args = force ? [action, name] : [action, "--time", "2", name];
    let result = runner.runSync("docker", args);
    if (result.status !== 0) result = runner.runSync("sudo", ["-n", "docker", ...args]);
    if (result.status !== 0) {
      logger.warn("Failed to stop docker inference container", { name, action });
      stopped = false;
    }
  }
  return stopped;
};

const dockerRunIndex = (command: readonly string[]): number =>
  command.findIndex(
    (argument, index) =>
      (argument === "docker" || argument.endsWith("/docker")) && command[index + 1] === "run",
  );

const commandRuntimeKind = (command: readonly string[]): "docker" | "native" =>
  dockerRunIndex(command) >= 0 ? "docker" : "native";

const commandWithDockerLaunchLabel = (command: readonly string[], launchId: string): string[] => {
  const index = dockerRunIndex(command);
  if (index < 0) return [...command];
  return [
    ...command.slice(0, index + 2),
    "--label",
    `${DOCKER_LAUNCH_LABEL}=${launchId}`,
    ...command.slice(index + 2),
  ];
};

const commandFingerprint = (command: readonly string[]): string =>
  createHash("sha256").update(JSON.stringify(command)).digest("hex");

const isSudoExecutable = (executable: string): boolean =>
  basename(executable).toLowerCase() === "sudo";

const commandUsesNativePrivilegeWrapper = (
  command: readonly string[],
  environment: NodeJS.ProcessEnv,
): boolean => {
  const executable = command[0];
  if (!executable) return false;
  if (isSudoExecutable(executable)) return true;
  const resolved = resolveBinaryFromEnvironment(executable, environment);
  return resolved !== null && isSudoExecutable(resolved);
};

const dockerAuthorityForCommand = (
  command: readonly string[],
): { readonly authority: DockerAuthority; readonly executable: string } | null => {
  const index = dockerRunIndex(command);
  const executable = command[index];
  return index === 0 && executable ? { authority: "direct", executable } : null;
};

const runDocker = (
  runner: ProcessRunner,
  executable: string,
  environment: NodeJS.ProcessEnv,
  args: string[],
): CommandResult => runner.runSync(executable, args, { env: environment });

const dockerBindingEnvironment = (environment: NodeJS.ProcessEnv): DockerBindingEnvironment => ({
  DOCKER_HOST: environment["DOCKER_HOST"] ?? null,
  DOCKER_CONTEXT: environment["DOCKER_CONTEXT"] ?? null,
  DOCKER_CONFIG: environment["DOCKER_CONFIG"] ?? null,
  DOCKER_TLS_VERIFY: environment["DOCKER_TLS_VERIFY"] ?? null,
  DOCKER_CERT_PATH: environment["DOCKER_CERT_PATH"] ?? null,
});

const reconstructedDockerEnvironment = (
  dockerEnvironment: DockerBindingEnvironment,
): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  for (const key of DOCKER_BINDING_ENVIRONMENT_KEYS) {
    const value = dockerEnvironment[key];
    if (value === null) delete environment[key];
    else environment[key] = value;
  }
  return environment;
};

const dockerBindingEnvironmentsMatch = (
  left: DockerBindingEnvironment | undefined,
  right: DockerBindingEnvironment | undefined,
): boolean => DOCKER_BINDING_ENVIRONMENT_KEYS.every((key) => left?.[key] === right?.[key]);

const ownershipGenerationsMatch = (
  left: ProcessOwnershipRecord,
  right: ProcessOwnershipRecord,
): boolean =>
  left.launchId === right.launchId &&
  left.createdAtMs === right.createdAtMs &&
  left.commandFingerprint === right.commandFingerprint &&
  left.recipeId === right.recipeId &&
  left.backend === right.backend &&
  left.port === right.port &&
  left.runtimeKind === right.runtimeKind &&
  left.dockerAuthority === right.dockerAuthority &&
  left.dockerDaemonFingerprint === right.dockerDaemonFingerprint &&
  left.dockerExecutable === right.dockerExecutable &&
  dockerBindingEnvironmentsMatch(left.dockerEnvironment, right.dockerEnvironment);

const ownershipRecordsMatch = (
  left: ProcessOwnershipRecord,
  right: ProcessOwnershipRecord,
): boolean => {
  if (!ownershipGenerationsMatch(left, right) || left.state !== right.state) return false;
  if (left.state === "pending" || right.state === "pending") return true;
  if (left.rootPid !== right.rootPid || left.processGroupId !== right.processGroupId) {
    return false;
  }
  return left.state === "spawned" || right.state === "spawned"
    ? true
    : left.startIdentity === right.startIdentity;
};

const dockerDaemonBinding = (
  runner: ProcessRunner,
  authority: DockerAuthority,
  executable: string,
  environment: NodeJS.ProcessEnv,
): DockerRuntimeBinding | null => {
  const context = runDocker(runner, executable, environment, [
    "context",
    "inspect",
    "--format",
    "{{.Name}}|{{.Endpoints.docker.Host}}",
  ]);
  const daemon = runDocker(runner, executable, environment, [
    "info",
    "--format",
    "{{.ID}}|{{.Name}}|{{.DockerRootDir}}",
  ]);
  if (context.status !== 0 || daemon.status !== 0 || !context.stdout || !daemon.stdout) {
    return null;
  }
  const identityEnvironment = dockerBindingEnvironment(environment);
  return {
    authority,
    daemonFingerprint: createHash("sha256")
      .update(JSON.stringify([context.stdout, daemon.stdout, identityEnvironment]))
      .digest("hex"),
    executable,
    environment: { ...environment },
  };
};

const createDockerBindingRegistry = (runner: ProcessRunner): DockerBindingRegistry => {
  const bindings = new Map<string, DockerRuntimeBinding>();
  const prepareDockerLaunch = (
    launchId: string,
    command: readonly string[],
    environment: NodeJS.ProcessEnv,
  ): DockerLaunchPreparation | null => {
    const launch = dockerAuthorityForCommand(command);
    if (!launch) return null;
    const executable = resolveBinaryFromEnvironment(launch.executable, environment);
    if (!executable) return null;
    const binding = dockerDaemonBinding(runner, launch.authority, executable, environment);
    if (!binding) return null;
    bindings.set(launchId, binding);
    return {
      command: [executable, ...command.slice(1)],
      ownership: {
        dockerAuthority: binding.authority,
        dockerDaemonFingerprint: binding.daemonFingerprint,
        dockerExecutable: binding.executable,
        dockerEnvironment: dockerBindingEnvironment(binding.environment),
      },
    };
  };
  const forgetDockerLaunch = (record: ProcessOwnershipRecord): void => {
    const binding = bindings.get(record.launchId);
    if (binding?.daemonFingerprint === record.dockerDaemonFingerprint) {
      bindings.delete(record.launchId);
    }
  };
  const verifiedDockerBinding = (record: ProcessOwnershipRecord): DockerRuntimeBinding | null => {
    if (
      record.runtimeKind !== "docker" ||
      !record.dockerAuthority ||
      !record.dockerDaemonFingerprint ||
      !record.dockerExecutable ||
      !record.dockerEnvironment
    ) {
      return null;
    }
    const remembered = bindings.get(record.launchId);
    const rememberedMatches =
      remembered?.executable === record.dockerExecutable &&
      dockerBindingEnvironmentsMatch(
        dockerBindingEnvironment(remembered.environment),
        record.dockerEnvironment,
      );
    const reproduced = dockerDaemonBinding(
      runner,
      record.dockerAuthority,
      rememberedMatches ? remembered.executable : record.dockerExecutable,
      rememberedMatches
        ? remembered.environment
        : reconstructedDockerEnvironment(record.dockerEnvironment),
    );
    if (
      !reproduced ||
      reproduced.authority !== record.dockerAuthority ||
      reproduced.daemonFingerprint !== record.dockerDaemonFingerprint
    ) {
      return null;
    }
    bindings.set(record.launchId, reproduced);
    return reproduced;
  };
  return { prepareDockerLaunch, forgetDockerLaunch, verifiedDockerBinding };
};

const removeStaleWindowsDockerContainer = (
  runner: ProcessRunner,
  command: readonly string[],
): void => {
  const index = dockerRunIndex(command);
  if (index < 0) return;
  const name = extractFlag(command.slice(index + 2), "--name");
  if (!name) return;
  const result = runner.runSync("docker", ["rm", "-f", name]);
  if (result.status !== 0) runner.runSync("sudo", ["-n", "docker", "rm", "-f", name]);
};

const sendWindowsSignal = (pid: number, signal: NodeJS.Signals): boolean => {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
};

const createKillWindowsProcess =
  (
    runner: ProcessRunner,
    logger: Logger,
  ): ((pid: number, force: boolean) => Effect.Effect<boolean>) =>
  (pid, force) =>
    Effect.gen(function* () {
      if (!pidExists(pid)) return true;
      const tree = buildProcessTree();
      const children = new Set<number>();
      collectChildren(tree, pid, children);
      const allPids = [...children, pid];
      stopWindowsDockerContainersForProcesses(runner, logger, allPids, force, true);
      const signal = force ? "SIGKILL" : "SIGTERM";
      for (const childPid of allPids) sendWindowsSignal(childPid, signal);
      const deadline = Date.now() + (force ? 15_000 : 10_000);
      while (Date.now() < deadline && pidExists(pid)) yield* Effect.sleep(250);
      if (pidExists(pid)) {
        stopWindowsDockerContainersForProcesses(runner, logger, allPids, true, true);
        if (!sendWindowsSignal(pid, "SIGKILL")) return false;
        const finalDeadline = Date.now() + 5_000;
        while (Date.now() < finalDeadline && pidExists(pid)) yield* Effect.sleep(250);
      }
      yield* Effect.sleep(force ? 500 : 1000);
      return !pidExists(pid);
    });

const createConfirmSpawnIdentity =
  (
    runner: ProcessRunner,
    processLaunchId: (pid: number) => string | null,
  ): ((
    pid: number,
    launchId: string,
    exited: () => boolean,
  ) => Effect.Effect<ProcessInventoryEntry | null>) =>
  (pid, launchId, exited) =>
    Effect.gen(function* () {
      const deadline = Date.now() + 1_000;
      while (Date.now() < deadline) {
        const inventory = readProcessInventory(runner);
        if (inventory.status === "available") {
          const entry = inventory.entries.find((candidate) => candidate.pid === pid);
          if (entry) {
            if (entry.processGroupId !== pid || entry.stat.includes("Z")) return null;
            if (processLaunchId(pid) === launchId) return entry;
          }
        }
        if (exited()) return null;
        yield* Effect.sleep(50);
      }
      return null;
    });

const createWindowsLaunchCleanup =
  (
    activePids: () => number[],
    killProcess: (pid: number, force: boolean) => Effect.Effect<boolean>,
    stopAllResources: () => Effect.Effect<void>,
  ): (() => Effect.Effect<boolean>) =>
  () =>
    Effect.gen(function* () {
      const stopped = yield* Effect.forEach(activePids(), (pid) => killProcess(pid, true));
      if (!stopped.every(Boolean)) return false;
      yield* stopAllResources();
      return true;
    });

type LaunchModelDependencies = {
  readonly config: Config;
  readonly logger: Logger;
  readonly eventManager?: EventManager;
  readonly runner: ProcessRunner;
  readonly supportsOwnedProcessGroups: boolean;
  readonly ownershipStore: ProcessOwnershipStore;
  readonly platform: NodeJS.Platform;
  readonly prepareForLaunch: () => Effect.Effect<boolean>;
  readonly cleanupOwnedProcessGroup: (
    reason: string,
    expected?: ProcessOwnershipRecord,
  ) => Effect.Effect<boolean>;
  readonly terminateUnrecordedLaunch: (pid: number) => Effect.Effect<boolean>;
  readonly registerResources: (resources: LaunchResources) => void;
  readonly releaseResources: (resources: LaunchResources) => Effect.Effect<void>;
  readonly stopResources: (resources: LaunchResources) => Effect.Effect<void>;
  readonly prepareDockerLaunch: (
    launchId: string,
    command: readonly string[],
    environment: NodeJS.ProcessEnv,
  ) => DockerLaunchPreparation | null;
  readonly forgetDockerLaunch: (record: ProcessOwnershipRecord) => void;
  readonly confirmSpawnIdentity: (
    pid: number,
    launchId: string,
    exited: () => boolean,
  ) => Effect.Effect<ProcessInventoryEntry | null>;
};

const createLaunchModel = (
  dependencies: LaunchModelDependencies,
): ProcessManager["launchModel"] => {
  const {
    config,
    logger,
    eventManager,
    runner,
    supportsOwnedProcessGroups,
    ownershipStore,
    platform,
    prepareForLaunch,
    cleanupOwnedProcessGroup,
    terminateUnrecordedLaunch,
    registerResources,
    releaseResources,
    stopResources,
    prepareDockerLaunch,
    forgetDockerLaunch,
    confirmSpawnIdentity,
  } = dependencies;
  return (recipe: Recipe, options: LaunchModelOptions = {}): Effect.Effect<LaunchResult> =>
    Effect.gen(function* () {
      const updatedRecipe = recipeForLaunch(recipe, config.inference_port, options);
      let command: string[] | null = null;
      try {
        command = buildBackendCommand(updatedRecipe, config, options.gpuUuids !== undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          pid: null,
          message,
          log_file: primaryLogPathFor(config.data_dir, updatedRecipe.id),
        };
      }
      if (!command) {
        return {
          success: false,
          pid: null,
          message: "Invalid launch command",
          log_file: primaryLogPathFor(config.data_dir, updatedRecipe.id),
        };
      }

      const logFile = primaryLogPathFor(config.data_dir, updatedRecipe.id);
      if (!(yield* prepareForLaunch())) {
        return {
          success: false,
          pid: null,
          message: "Unable to verify prior Local Studio process ownership",
          log_file: logFile,
        };
      }
      if (platform === "win32") removeStaleWindowsDockerContainer(runner, command);
      cleanupLogFiles(config.data_dir, {
        ...getLogCleanupDefaultsFromEnvironment(),
        excludePaths: new Set([logFile]),
      });
      const launchId = randomUUID();
      const runtimeKind = commandRuntimeKind(command);
      const labeledLaunchCommand = supportsOwnedProcessGroups
        ? commandWithDockerLaunchLabel(command, launchId)
        : command;
      const env = {
        ...buildEnvironment(updatedRecipe, config),
        LOCAL_STUDIO_LAUNCH_ID: launchId,
      };
      if (
        supportsOwnedProcessGroups &&
        runtimeKind === "native" &&
        commandUsesNativePrivilegeWrapper(labeledLaunchCommand, env)
      ) {
        return {
          success: false,
          pid: null,
          message: "Native privilege-wrapper launches cannot preserve process ownership",
          log_file: logFile,
        };
      }
      const dockerLaunch =
        supportsOwnedProcessGroups && runtimeKind === "docker"
          ? prepareDockerLaunch(launchId, labeledLaunchCommand, env)
          : null;
      if (supportsOwnedProcessGroups && runtimeKind === "docker" && !dockerLaunch) {
        return {
          success: false,
          pid: null,
          message: "Unable to verify Docker launch authority and daemon",
          log_file: logFile,
        };
      }
      const launchCommand = dockerLaunch?.command ?? labeledLaunchCommand;
      const dockerOwnership = dockerLaunch?.ownership ?? null;
      const entry = launchCommand[0];
      if (!entry) {
        return {
          success: false,
          pid: null,
          message: "Invalid launch command",
          log_file: logFile,
        };
      }
      const ownershipGeneration: PendingProcessOwnershipRecord | null = supportsOwnedProcessGroups
        ? {
            version: 1,
            state: "pending",
            launchId,
            recipeId: updatedRecipe.id,
            backend: updatedRecipe.backend,
            port: config.inference_port,
            createdAtMs: Date.now(),
            runtimeKind,
            commandFingerprint: commandFingerprint(launchCommand),
            ...(dockerOwnership ?? {}),
          }
        : null;
      let ownershipRecord: ProcessOwnershipRecord | null = null;
      let ownershipLaunch: ProcessOwnershipLaunch | null = null;
      if (ownershipGeneration) {
        try {
          ownershipLaunch = ownershipStore.beginLaunch(ownershipGeneration);
          ownershipRecord = ownershipGeneration;
        } catch (error) {
          forgetDockerLaunch(ownershipGeneration);
          return {
            success: false,
            pid: null,
            message: `Unable to persist pending process ownership: ${String(error)}`,
            log_file: logFile,
          };
        }
      }
      const expectedGeneration = (): PendingProcessOwnershipRecord => {
        if (!ownershipGeneration) throw new Error("Launch ownership generation is unavailable");
        return ownershipGeneration;
      };
      const releaseOwnershipLaunch = (): void => {
        const launch = ownershipLaunch;
        ownershipLaunch = null;
        launch?.release();
      };
      const removeOwnershipLaunch = (): boolean => {
        if (!ownershipLaunch)
          return ownershipRecord ? ownershipStore.remove(ownershipRecord) : true;
        const launch = ownershipLaunch;
        ownershipLaunch = null;
        return launch.remove();
      };
      let spawnedChild = false;
      let launchResources: LaunchResources | null = null;
      let launchSettled = false;

      const cleanupLaunchOwnership = (reason: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (!ownershipRecord) {
            if (spawnedChild && launchResources && launchResources.pid !== null) {
              yield* terminateUnrecordedLaunch(launchResources.pid);
            }
            return;
          }
          if (!spawnedChild && ownershipRecord.state === "pending") {
            if (removeOwnershipLaunch()) forgetDockerLaunch(ownershipRecord);
            return;
          }
          if (ownershipLaunch) releaseOwnershipLaunch();
          yield* cleanupOwnedProcessGroup(reason, expectedGeneration());
        });

      const stopLaunchResources = (): Effect.Effect<void> =>
        launchResources ? stopResources(launchResources) : Effect.void;

      const cleanupFailedLaunch = (reason: string): Effect.Effect<void> =>
        cleanupLaunchOwnership(reason).pipe(Effect.andThen(stopLaunchResources));

      const launchEffect = Effect.gen(function* () {
        try {
          let spawnError: string | null = null;
          const logQueue = yield* Queue.sliding<string | null>(256);
          const child = runner.spawnDetached(entry, launchCommand.slice(1), { env, stdio: "pipe" });
          spawnedChild = true;
          const onChildError = (error: Error): void => {
            spawnError = String(error);
          };
          const onChildExit = (): void => {
            Queue.offerUnsafe(logQueue, null);
          };

          let logStream: WriteStream | null = null;
          try {
            logStream = createWriteStream(logFile, { flags: "a" });
          } catch (logError) {
            logger.warn("Failed to open log file", { error: String(logError) });
          }
          const onLogError = logStream
            ? (error: Error): void =>
                logger.warn("Inference log stream failed", { error: String(error) })
            : null;
          if (logStream && onLogError) logStream.on("error", onLogError);

          const recentOutput: string[] = [];
          const readers: Interface[] = [];
          const resources: LaunchResources = {
            child,
            pid: child.pid ?? null,
            launchId: ownershipGeneration?.launchId ?? null,
            queue: logQueue,
            readers,
            logStream,
            onChildError,
            onChildExit,
            onLogError,
            logFiber: null,
            released: false,
          };
          launchResources = resources;
          registerResources(resources);
          child.on("error", onChildError);
          child.on("exit", onChildExit);
          resources.logFiber = yield* Effect.gen(function* () {
            while (true) {
              const line = yield* Queue.take(logQueue);
              if (line !== null && eventManager)
                yield* eventManager.publishLogLine(updatedRecipe.id, line);
              if (line !== null) continue;
              while (!launchSettled) yield* Effect.sleep(10);
              if (ownershipGeneration) {
                yield* cleanupOwnedProcessGroup("process-exit", ownershipGeneration);
              }
              return;
            }
          }).pipe(
            Effect.ensuring(releaseResources(resources)),
            Effect.forkDetach({ startImmediately: true }),
          );
          const captureLine = (line: string): void => {
            recentOutput.push(line);
            if (recentOutput.length > 60) recentOutput.shift();
            if (logStream) {
              try {
                logStream.write(line + "\n");
              } catch (error) {
                logger.warn("Inference log write failed", { error: String(error) });
              }
            }
            Queue.offerUnsafe(logQueue, line);
          };
          if (child.stdout) {
            const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
            reader.on("line", captureLine);
            readers.push(reader);
          }
          if (child.stderr) {
            const reader = createInterface({ input: child.stderr, crlfDelay: Infinity });
            reader.on("line", captureLine);
            readers.push(reader);
          }
          child.unref();

          if (supportsOwnedProcessGroups) {
            if (child.pid === undefined) yield* Effect.sleep(25);
            if (child.pid !== undefined && ownershipRecord?.state === "pending") {
              try {
                if (!ownershipLaunch)
                  throw new Error("Process ownership launch scope is unavailable");
                ownershipRecord = ownershipLaunch.markSpawned({
                  rootPid: child.pid,
                  processGroupId: child.pid,
                });
              } catch (error) {
                releaseOwnershipLaunch();
                yield* cleanupOwnedProcessGroup("spawn-persistence-failed", expectedGeneration());
                yield* stopLaunchResources();
                return {
                  success: false,
                  pid: null,
                  message: `Unable to persist spawned process ownership: ${String(error)}`,
                  log_file: logFile,
                };
              }
            }
            if (!spawnError && child.pid !== undefined) {
              const identity = yield* confirmSpawnIdentity(
                child.pid,
                launchId,
                () => child.exitCode !== null,
              );
              if (identity) {
                const pending = ownershipRecord;
                if (!pending) throw new Error("Pending process ownership is unavailable");
                try {
                  const confirmedIdentity = {
                    rootPid: child.pid,
                    processGroupId: identity.processGroupId,
                    startIdentity: identity.startIdentity,
                  };
                  if (pending.state === "active") {
                    if (
                      pending.rootPid !== confirmedIdentity.rootPid ||
                      pending.processGroupId !== confirmedIdentity.processGroupId ||
                      pending.startIdentity !== confirmedIdentity.startIdentity
                    ) {
                      throw new Error("Active process ownership identity changed");
                    }
                  } else {
                    if (!ownershipLaunch) {
                      throw new Error("Process ownership launch scope is unavailable");
                    }
                    ownershipRecord = ownershipLaunch.activate(confirmedIdentity);
                  }
                  releaseOwnershipLaunch();
                } catch (error) {
                  if (ownershipLaunch) releaseOwnershipLaunch();
                  yield* cleanupOwnedProcessGroup("activation-failed", expectedGeneration());
                  yield* stopLaunchResources();
                  return {
                    success: false,
                    pid: null,
                    message: `Unable to activate process ownership: ${String(error)}`,
                    log_file: logFile,
                  };
                }
              } else if (child.exitCode === null) {
                releaseOwnershipLaunch();
                yield* cleanupOwnedProcessGroup("identity-unverified", expectedGeneration());
                yield* stopLaunchResources();
                return {
                  success: false,
                  pid: null,
                  message: "Unable to confirm spawned process ownership",
                  log_file: logFile,
                };
              }
            } else if (!spawnError) {
              releaseOwnershipLaunch();
              yield* cleanupOwnedProcessGroup("identity-missing", expectedGeneration());
              yield* stopLaunchResources();
              return {
                success: false,
                pid: null,
                message: "Spawned process did not report an identity",
                log_file: logFile,
              };
            }
          }

          yield* Effect.sleep(3000);
          if (spawnError) {
            yield* cleanupFailedLaunch("spawn-error");
            return { success: false, pid: null, message: spawnError, log_file: logFile };
          }
          if (child.exitCode !== null) {
            yield* cleanupFailedLaunch("early-exit");
            const tail = recentOutput
              .slice(-20)
              .filter((line) => line.trim().length > 0)
              .join("\n");
            const message = tail
              ? `Process exited early (code ${child.exitCode}):\n${tail}`
              : `Process exited early (code ${child.exitCode})`;
            if (eventManager) {
              yield* eventManager.publishLaunchProgress(updatedRecipe.id, "error", message);
            }
            return { success: false, pid: null, message, log_file: logFile };
          }
          return {
            success: true,
            pid: child.pid ?? null,
            message: "Process started",
            log_file: logFile,
          };
        } catch (error) {
          yield* cleanupFailedLaunch("launch-exception");
          logger.error("Launch failed", { error: String(error) });
          return {
            success: false,
            pid: null,
            message: String(error),
            log_file: logFile,
          };
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            launchSettled = true;
          }),
        ),
      );

      return yield* launchEffect.pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
            ? cleanupFailedLaunch("launch-interrupted")
            : Effect.void,
        ),
      );
    });
};

const createFindInferenceProcess =
  (
    runner: ProcessRunner,
    waitForStartupReconciliation: () => Effect.Effect<boolean>,
  ): ProcessManager["findInferenceProcess"] =>
  (port: number): Effect.Effect<ProcessInfo | null> =>
    Effect.gen(function* () {
      yield* waitForStartupReconciliation();
      const processes = listProcesses(runner);
      for (const proc of processes) {
        const backend = detectBackend(proc.args);
        if (!backend) continue;
        const flagPort = extractFlag(proc.args, "--port");
        if (flagPort && Number(flagPort) !== port) continue;
        if (!flagPort && !(backend === "vllm" && port === 8000)) continue;
        const modelPath = getEngineSpec(backend).extractModelPath(proc.args);
        const servedModelName = getEngineSpec(backend).extractServedModelName(proc.args);
        return {
          pid: proc.pid,
          backend,
          model_path: modelPath ?? null,
          port,
          served_model_name: servedModelName ?? null,
        };
      }
      return null;
    });

type OwnedDockerActions = {
  readonly stop: (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    force: boolean,
    requireProcessProof: boolean,
  ) => "absent" | "blocked" | "stopped";
  readonly settle: (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
  ) => Effect.Effect<"blocked" | "clear">;
  readonly removeGeneration: (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    remove: () => boolean,
  ) => boolean;
};

type OwnedDockerActionDependencies = {
  readonly runner: ProcessRunner;
  readonly logger: Logger;
  readonly ownershipStore: ProcessOwnershipStore;
  readonly verifiedBinding: (record: ProcessOwnershipRecord) => DockerRuntimeBinding | null;
  readonly forgetBinding: (record: ProcessOwnershipRecord) => void;
  readonly inspectOwnership: () => OwnershipInspection;
  readonly missingOwnershipIsGone: (record: ProcessOwnershipRecord) => boolean;
  readonly recordIsCurrent: (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
  ) => boolean;
  readonly recordsMatch: (left: ProcessOwnershipRecord, right: ProcessOwnershipRecord) => boolean;
  readonly generationsMatch: (
    left: ProcessOwnershipRecord,
    right: ProcessOwnershipRecord,
  ) => boolean;
};

const createOwnedDockerActions = (
  dependencies: OwnedDockerActionDependencies,
): OwnedDockerActions => {
  const {
    runner,
    logger,
    ownershipStore,
    verifiedBinding,
    forgetBinding,
    inspectOwnership,
    missingOwnershipIsGone,
    recordIsCurrent,
    recordsMatch,
    generationsMatch,
  } = dependencies;
  type DockerLookup =
    | { readonly status: "found"; readonly id: string; readonly binding: DockerRuntimeBinding }
    | { readonly status: "absent"; readonly binding: DockerRuntimeBinding }
    | { readonly status: "blocked" };
  const findContainer = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
  ): DockerLookup => {
    if (!recordIsCurrent(record, expectedGeneration)) return { status: "blocked" };
    const binding = verifiedBinding(record);
    if (!binding || !recordIsCurrent(record, expectedGeneration)) return { status: "blocked" };
    const result = runDocker(runner, binding.executable, binding.environment, [
      "ps",
      "-aq",
      "--no-trunc",
      "--filter",
      `label=${DOCKER_LAUNCH_LABEL}=${record.launchId}`,
      "--format",
      "{{.ID}}",
    ]);
    if (result.status !== 0 || !recordIsCurrent(record, expectedGeneration)) {
      return { status: "blocked" };
    }
    const ids = result.stdout.split(/\s+/).filter(Boolean);
    if (ids.length === 0) return { status: "absent", binding };
    const id = ids[0];
    return ids.length === 1 && id && /^[a-f\d]{64}$/i.test(id)
      ? { status: "found", id, binding }
      : { status: "blocked" };
  };
  const runAction = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    container: Extract<DockerLookup, { readonly status: "found" }>,
    args: string[],
  ): boolean => {
    const revalidated = findContainer(record, expectedGeneration);
    if (revalidated.status === "absent") return true;
    if (revalidated.status !== "found" || revalidated.id !== container.id) return false;
    if (!recordIsCurrent(record, expectedGeneration)) return false;
    return (
      runDocker(runner, revalidated.binding.executable, revalidated.binding.environment, args)
        .status === 0
    );
  };
  const processProofMatches = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
  ): boolean => {
    const revalidated = inspectOwnership();
    return !(
      revalidated.status === "missing" ||
      revalidated.status === "blocked" ||
      !recordsMatch(revalidated.record, record) ||
      !generationsMatch(revalidated.record, expectedGeneration)
    );
  };
  const stop: OwnedDockerActions["stop"] = (
    record,
    expectedGeneration,
    force,
    requireProcessProof,
  ) => {
    if (record.runtimeKind !== "docker") return "absent";
    if (requireProcessProof && !processProofMatches(record, expectedGeneration)) return "blocked";
    const container = findContainer(record, expectedGeneration);
    if (container.status === "absent") return "absent";
    if (container.status === "blocked") return "blocked";
    const action = force ? "kill" : "stop";
    const args = force ? [action, container.id] : [action, "--time", "2", container.id];
    if (!runAction(record, expectedGeneration, container, args)) {
      logger.warn("Failed to stop owned docker inference container", {
        action,
        containerId: container.id,
        launchId: record.launchId,
      });
      return "blocked";
    }
    return "stopped";
  };
  const settle: OwnedDockerActions["settle"] = (record, expectedGeneration) =>
    Effect.gen(function* () {
      if (record.runtimeKind !== "docker") return "clear";
      const deadline = Date.now() + DOCKER_SETTLE_WINDOW_MS;
      let consecutiveAbsences = 0;
      while (true) {
        const current = ownershipStore.read();
        if (current.status === "missing") {
          return missingOwnershipIsGone(record) ? "clear" : "blocked";
        }
        const container = findContainer(record, expectedGeneration);
        if (container.status === "blocked") return "blocked";
        if (container.status === "found") {
          if (!runAction(record, expectedGeneration, container, ["rm", "-f", container.id])) {
            return "blocked";
          }
          consecutiveAbsences = 0;
        } else {
          consecutiveAbsences += 1;
        }
        if (Date.now() >= deadline) {
          return consecutiveAbsences >= DOCKER_STABLE_ABSENCE_COUNT ? "clear" : "blocked";
        }
        yield* Effect.sleep(DOCKER_SETTLE_INTERVAL_MS);
      }
    });
  const removeGeneration: OwnedDockerActions["removeGeneration"] = (
    record,
    expectedGeneration,
    remove,
  ) => {
    const current = ownershipStore.read();
    if (current.status === "missing") {
      const removed = missingOwnershipIsGone(record);
      if (removed) forgetBinding(record);
      return removed;
    }
    if (!recordIsCurrent(record, expectedGeneration) || !remove()) {
      return false;
    }
    forgetBinding(record);
    return true;
  };
  return { stop, settle, removeGeneration };
};

type LockedGenerationCleanupDependencies = {
  readonly inspectOwnership: (scope?: ProcessOwnershipScope) => OwnershipInspection;
  readonly recoverPendingNativeGeneration: (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    remove: () => boolean,
  ) => boolean;
  readonly recoverPendingDockerContainerEffect: (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    remove: () => boolean,
  ) => Effect.Effect<boolean>;
  readonly stopOwnedDockerContainer: OwnedDockerActions["stop"];
  readonly settleOwnedDockerContainerEffect: OwnedDockerActions["settle"];
  readonly removeOwnedGeneration: OwnedDockerActions["removeGeneration"];
  readonly terminateOwnedProcessGroupEffect: (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    firstSignal: NodeJS.Signals,
    reason: string,
  ) => Effect.Effect<boolean>;
};

const createLockedGenerationCleanup = (
  dependencies: LockedGenerationCleanupDependencies,
): ((
  reason: string,
  expectedGeneration: ProcessOwnershipRecord,
  scope: ProcessOwnershipScope,
) => Effect.Effect<boolean>) => {
  const {
    inspectOwnership,
    recoverPendingNativeGeneration,
    recoverPendingDockerContainerEffect,
    stopOwnedDockerContainer,
    settleOwnedDockerContainerEffect,
    removeOwnedGeneration,
    terminateOwnedProcessGroupEffect,
  } = dependencies;
  return (reason, expectedGeneration, scope) =>
    Effect.gen(function* () {
      const inspection = inspectOwnership(scope);
      if (inspection.status === "missing") return false;
      if (inspection.status === "blocked") {
        if (recoverPendingNativeGeneration(scope.record, expectedGeneration, scope.remove)) {
          return true;
        }
        return yield* recoverPendingDockerContainerEffect(
          scope.record,
          expectedGeneration,
          scope.remove,
        );
      }
      if (
        !ownershipRecordsMatch(inspection.record, scope.record) ||
        !ownershipGenerationsMatch(inspection.record, expectedGeneration)
      ) {
        return false;
      }
      if (
        stopOwnedDockerContainer(inspection.record, expectedGeneration, false, true) === "blocked"
      ) {
        return false;
      }
      if (inspection.status === "gone") {
        const settled = yield* settleOwnedDockerContainerEffect(
          inspection.record,
          expectedGeneration,
        );
        return (
          settled === "clear" &&
          removeOwnedGeneration(inspection.record, expectedGeneration, scope.remove)
        );
      }
      const terminated = yield* terminateOwnedProcessGroupEffect(
        inspection.record,
        expectedGeneration,
        "SIGTERM",
        reason,
      );
      if (!terminated) return false;
      const settled = yield* settleOwnedDockerContainerEffect(
        inspection.record,
        expectedGeneration,
      );
      return (
        settled === "clear" &&
        removeOwnedGeneration(inspection.record, expectedGeneration, scope.remove)
      );
    });
};

const createSuccessfulSingleFlight = (
  operation: () => Effect.Effect<boolean>,
): (() => Effect.Effect<boolean>) => {
  let complete = false;
  let running = false;
  return () =>
    Effect.gen(function* () {
      if (complete) return true;
      while (running) {
        yield* Effect.sleep(10);
        if (complete) return true;
      }
      running = true;
      const success = yield* operation().pipe(
        Effect.ensuring(
          Effect.sync(() => {
            running = false;
          }),
        ),
      );
      if (success) complete = true;
      return success;
    });
};

export const createProcessManager = (
  config: Config,
  logger: Logger,
  eventManager?: EventManager,
  runner: ProcessRunner = realProcessRunner,
  platform: NodeJS.Platform = process.platform,
): ProcessManager => {
  const supportsOwnedProcessGroups = platform !== "win32";
  const {
    activePids,
    register: registerResources,
    release: releaseResources,
    stop: stopResources,
    stopAll: stopAllResources,
    stopForLaunch: stopResourcesForLaunch,
    stopForPid: stopResourcesForPid,
  } = createLaunchResourceRegistry();
  const ownershipStore = createProcessOwnershipStore(config.data_dir);
  const { prepareDockerLaunch, forgetDockerLaunch, verifiedDockerBinding } =
    createDockerBindingRegistry(runner);
  let reconcileStartup = (): Effect.Effect<boolean> => Effect.succeed(true);
  const waitForStartupReconciliation = createSuccessfulSingleFlight(() => reconcileStartup());
  const findInferenceProcess = createFindInferenceProcess(runner, waitForStartupReconciliation);
  const killWindowsProcessEffect = createKillWindowsProcess(runner, logger);

  const processLaunchId = (pid: number): string | null => {
    const result = runner.readProcessEnvironmentVariable(pid, "LOCAL_STUDIO_LAUNCH_ID");
    return result.status === "found" ? result.value : null;
  };

  const pendingGenerationCandidates = (
    record: ProcessOwnershipRecord,
    entries: readonly ProcessInventoryEntry[],
  ): ProcessInventoryEntry[] =>
    entries.filter((entry) => {
      if (entry.stat.includes("Z")) return false;
      const startedAtMs = Number(entry.startIdentity);
      return (
        Number.isSafeInteger(startedAtMs) &&
        startedAtMs >= record.createdAtMs - PENDING_START_SKEW_MS &&
        startedAtMs <= record.createdAtMs + PENDING_START_WINDOW_MS
      );
    });

  const inspectPendingProcessGroup = (
    record: PendingProcessOwnershipRecord,
    entries: readonly ProcessInventoryEntry[],
    scope?: ProcessOwnershipScope,
  ): OwnershipInspection => {
    const candidates = pendingGenerationCandidates(record, entries);
    const markers = new Map<number, string>();
    for (const candidate of candidates) {
      const marker = runner.readProcessEnvironmentVariable(candidate.pid, "LOCAL_STUDIO_LAUNCH_ID");
      if (marker.status === "found") markers.set(candidate.pid, marker.value);
    }
    const matching = candidates.filter((entry) => markers.get(entry.pid) === record.launchId);
    if (matching.length === 0) return { status: "blocked" };
    const groupIds = new Set(matching.map((entry) => entry.processGroupId));
    if (groupIds.size !== 1) return { status: "blocked" };
    const processGroupId = groupIds.values().next().value;
    if (typeof processGroupId !== "number" || processGroupId <= 0) {
      return { status: "blocked" };
    }
    const members = entries.filter(
      (entry) => entry.processGroupId === processGroupId && !entry.stat.includes("Z"),
    );
    for (const member of members) {
      const cached = markers.get(member.pid);
      if (cached === record.launchId) continue;
      const marker = runner.readProcessEnvironmentVariable(member.pid, "LOCAL_STUDIO_LAUNCH_ID");
      if (marker.status !== "found" || marker.value !== record.launchId) {
        return { status: "blocked" };
      }
    }
    if (members.length === 0) return { status: "blocked" };
    const leader = members.find((entry) => entry.pid === processGroupId);
    const launcher = matching.find(
      (entry) => commandFingerprint(entry.args) === record.commandFingerprint,
    );
    if (launcher && launcher.pid !== processGroupId) return { status: "blocked" };
    try {
      const identity = {
        rootPid: processGroupId,
        processGroupId,
        startIdentity: leader?.startIdentity ?? members[0]?.startIdentity ?? "",
      };
      const active = scope ? scope.activate(identity) : ownershipStore.activate(record, identity);
      return { status: "owned", record: active, processGroupId, members };
    } catch (error) {
      logger.warn("Pending process ownership activation failed", { error: String(error) });
      return { status: "blocked" };
    }
  };

  const inspectSpawnedProcessGroup = (
    record: SpawnedProcessOwnershipRecord,
    entries: readonly ProcessInventoryEntry[],
  ): OwnershipInspection => {
    const leader = entries.find((entry) => entry.pid === record.rootPid);
    if (leader && leader.processGroupId !== record.processGroupId) return { status: "blocked" };
    const members = entries.filter(
      (entry) => entry.processGroupId === record.processGroupId && !entry.stat.includes("Z"),
    );
    if (members.length > 0) {
      return members.every((entry) => processLaunchId(entry.pid) === record.launchId)
        ? { status: "owned", record, processGroupId: record.processGroupId, members }
        : { status: "blocked" };
    }
    const candidates = pendingGenerationCandidates(record, entries);
    for (const candidate of candidates) {
      const marker = runner.readProcessEnvironmentVariable(candidate.pid, "LOCAL_STUDIO_LAUNCH_ID");
      if (marker.status === "unavailable") return { status: "blocked" };
      if (marker.status === "found" && marker.value === record.launchId) {
        return { status: "blocked" };
      }
    }
    return { status: "gone", record };
  };

  const inspectOwnership = (scope?: ProcessOwnershipScope): OwnershipInspection => {
    const persisted = ownershipStore.read();
    if (persisted.status === "missing") return { status: "missing" };
    if (persisted.status === "invalid") {
      logger.warn("Process ownership validation failed", { reason: persisted.reason });
      return { status: "blocked" };
    }
    const inventory = readProcessInventory(runner);
    if (inventory.status === "unavailable") {
      logger.warn("Process inventory is unavailable for ownership validation");
      return { status: "blocked" };
    }
    if (persisted.record.state === "pending") {
      return inspectPendingProcessGroup(persisted.record, inventory.entries, scope);
    }
    if (persisted.record.state === "spawned") {
      return inspectSpawnedProcessGroup(persisted.record, inventory.entries);
    }
    const state = inspectOwnedProcessGroup(persisted.record, inventory.entries, processLaunchId);
    if (state.status === "identity-mismatch") {
      logger.warn("Process ownership identity no longer matches", {
        launchId: persisted.record.launchId,
        rootPid: persisted.record.rootPid,
      });
      return { status: "blocked" };
    }
    if (state.status === "gone") {
      return { status: "gone", record: persisted.record };
    }
    return {
      status: "owned",
      record: persisted.record,
      processGroupId: persisted.record.processGroupId,
      members: state.members,
    };
  };

  const missingOwnershipIsGone = (expected: ProcessOwnershipRecord): boolean => {
    const inventory = readProcessInventory(runner);
    if (inventory.status === "unavailable") return false;
    if (expected.state === "active" || expected.state === "spawned") {
      return !inventory.entries.some(
        (entry) => entry.processGroupId === expected.processGroupId && !entry.stat.includes("Z"),
      );
    }
    const candidates = pendingGenerationCandidates(expected, inventory.entries);
    if (
      candidates.some((entry) => commandFingerprint(entry.args) === expected.commandFingerprint)
    ) {
      return false;
    }
    for (const entry of candidates) {
      const marker = runner.readProcessEnvironmentVariable(entry.pid, "LOCAL_STUDIO_LAUNCH_ID");
      if (marker.status === "unavailable") return false;
      if (marker.status === "found" && marker.value === expected.launchId) return false;
    }
    return true;
  };

  const signalOwnedProcessGroup = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    signal: NodeJS.Signals,
    reason: string,
  ): "blocked" | "gone" | "signaled" => {
    const inspection = inspectOwnership();
    if (inspection.status === "missing") {
      return missingOwnershipIsGone(record) ? "gone" : "blocked";
    }
    if (inspection.status === "blocked") return "blocked";
    if (
      !ownershipRecordsMatch(inspection.record, record) ||
      !ownershipGenerationsMatch(inspection.record, expectedGeneration)
    ) {
      return "blocked";
    }
    if (inspection.status === "gone") return "gone";
    logger.warn("Signaling Local Studio inference process group", {
      launchId: record.launchId,
      processGroupId: inspection.processGroupId,
      reason,
      signal,
    });
    return runner.signalProcessGroup(inspection.processGroupId, signal) ? "signaled" : "blocked";
  };

  const waitForOwnedProcessGroupEffect = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    timeoutMs: number,
  ): Effect.Effect<"blocked" | "gone" | "present"> =>
    Effect.gen(function* () {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const inspection = inspectOwnership();
        if (inspection.status === "missing") {
          return missingOwnershipIsGone(record) ? "gone" : "blocked";
        }
        if (inspection.status === "blocked") return "blocked";
        if (
          !ownershipRecordsMatch(inspection.record, record) ||
          !ownershipGenerationsMatch(inspection.record, expectedGeneration)
        ) {
          return "blocked";
        }
        if (inspection.status === "gone") return "gone";
        yield* Effect.sleep(200);
      }
      return "present";
    });

  const terminateOwnedProcessGroupEffect = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    firstSignal: NodeJS.Signals,
    reason: string,
  ): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const firstResult = signalOwnedProcessGroup(record, expectedGeneration, firstSignal, reason);
      if (firstResult === "gone") return true;
      if (firstResult === "blocked") return false;
      const firstWait = yield* waitForOwnedProcessGroupEffect(
        record,
        expectedGeneration,
        firstSignal === "SIGKILL" ? 5_000 : 2_000,
      );
      if (firstWait === "gone") return true;
      if (firstWait === "blocked" || firstSignal === "SIGKILL") return false;
      const killResult = signalOwnedProcessGroup(record, expectedGeneration, "SIGKILL", reason);
      if (killResult === "gone") return true;
      if (killResult === "blocked") return false;
      return (yield* waitForOwnedProcessGroupEffect(record, expectedGeneration, 5_000)) === "gone";
    });

  const ownershipRecordIsCurrent = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
  ): boolean => {
    const current = ownershipStore.read();
    return (
      current.status === "found" &&
      ownershipRecordsMatch(current.record, record) &&
      ownershipGenerationsMatch(current.record, expectedGeneration)
    );
  };

  const {
    stop: stopOwnedDockerContainer,
    settle: settleOwnedDockerContainerEffect,
    removeGeneration: removeOwnedGeneration,
  } = createOwnedDockerActions({
    runner,
    logger,
    ownershipStore,
    verifiedBinding: verifiedDockerBinding,
    forgetBinding: forgetDockerLaunch,
    inspectOwnership,
    missingOwnershipIsGone,
    recordIsCurrent: ownershipRecordIsCurrent,
    recordsMatch: ownershipRecordsMatch,
    generationsMatch: ownershipGenerationsMatch,
  });

  const recoverPendingDockerContainerEffect = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    remove: () => boolean,
  ): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (record.state !== "pending" || record.runtimeKind !== "docker") return false;
      if (!missingOwnershipIsGone(record)) return false;
      const settled = yield* settleOwnedDockerContainerEffect(record, expectedGeneration);
      return (
        settled === "clear" &&
        missingOwnershipIsGone(record) &&
        removeOwnedGeneration(record, expectedGeneration, remove)
      );
    });

  const recoverPendingNativeGeneration = (
    record: ProcessOwnershipRecord,
    expectedGeneration: ProcessOwnershipRecord,
    remove: () => boolean,
  ): boolean =>
    record.state === "pending" &&
    record.runtimeKind === "native" &&
    ownershipGenerationsMatch(record, expectedGeneration) &&
    missingOwnershipIsGone(record) &&
    remove();

  const cleanupLockedGenerationEffect = createLockedGenerationCleanup({
    inspectOwnership,
    recoverPendingNativeGeneration,
    recoverPendingDockerContainerEffect,
    stopOwnedDockerContainer,
    settleOwnedDockerContainerEffect,
    removeOwnedGeneration,
    terminateOwnedProcessGroupEffect,
  });

  const cleanupOwnedProcessGroupEffect = (
    reason: string,
    expectedGeneration?: ProcessOwnershipRecord,
  ): Effect.Effect<boolean, Error> =>
    Effect.gen(function* () {
      const inspection = inspectOwnership();
      if (inspection.status === "missing") {
        return expectedGeneration ? missingOwnershipIsGone(expectedGeneration) : true;
      }
      const candidate = ((): ProcessOwnershipRecord | null => {
        if (inspection.status !== "blocked") return inspection.record;
        const persisted = ownershipStore.read();
        return persisted.status === "found" ? persisted.record : null;
      })();
      if (!candidate) return false;
      const expected = expectedGeneration ?? candidate;
      if (!ownershipGenerationsMatch(candidate, expected)) return false;
      const result = yield* ownershipStore.withExactGeneration(candidate, (scope) =>
        cleanupLockedGenerationEffect(reason, expected, scope),
      );
      return result.status === "acquired" && result.value;
    });

  const cleanupOwnedProcessGroup = (
    reason: string,
    expectedGeneration?: ProcessOwnershipRecord,
  ): Effect.Effect<boolean> =>
    cleanupOwnedProcessGroupEffect(reason, expectedGeneration).pipe(
      Effect.catch((error: unknown) => {
        logger.error("Owned process-group cleanup failed", { error: String(error), reason });
        return Effect.succeed(false);
      }),
    );

  const killOwnedProcessEffect = (pid: number, force: boolean): Effect.Effect<boolean, Error> =>
    Effect.gen(function* () {
      const initial = inspectOwnership();
      if (initial.status === "missing" || initial.status === "blocked") return false;
      const expected = initial.record;
      const result = yield* ownershipStore.withExactGeneration(expected, (scope) =>
        Effect.gen(function* () {
          const inspection = inspectOwnership(scope);
          if (
            inspection.status === "missing" ||
            inspection.status === "blocked" ||
            !ownershipRecordsMatch(inspection.record, scope.record)
          ) {
            return false;
          }
          if (inspection.status === "gone") {
            const inventory = readProcessInventory(runner);
            if (stopOwnedDockerContainer(inspection.record, expected, force, true) === "blocked") {
              return false;
            }
            const settled = yield* settleOwnedDockerContainerEffect(inspection.record, expected);
            return (
              settled === "clear" &&
              removeOwnedGeneration(inspection.record, expected, scope.remove) &&
              inventory.status === "available" &&
              !inventory.entries.some((entry) => entry.pid === pid)
            );
          }
          if (
            (inspection.record.state !== "active" || pid !== inspection.record.rootPid) &&
            !inspection.members.some((entry) => entry.pid === pid)
          ) {
            return false;
          }
          if (stopOwnedDockerContainer(inspection.record, expected, force, true) === "blocked") {
            return false;
          }
          const terminated = yield* terminateOwnedProcessGroupEffect(
            inspection.record,
            expected,
            force ? "SIGKILL" : "SIGTERM",
            "requested-stop",
          );
          if (!terminated) return false;
          const settled = yield* settleOwnedDockerContainerEffect(inspection.record, expected);
          return (
            settled === "clear" && removeOwnedGeneration(inspection.record, expected, scope.remove)
          );
        }),
      );
      const stopped = result.status === "acquired" && result.value;
      if (stopped) yield* stopResourcesForLaunch(expected.launchId);
      return stopped;
    });

  const killProcess = (pid: number, force: boolean): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      yield* waitForStartupReconciliation();
      const stopped = yield* (
        supportsOwnedProcessGroups
          ? killOwnedProcessEffect(pid, force)
          : killWindowsProcessEffect(pid, force)
      ).pipe(
        Effect.catch((error: unknown) => {
          logger.error("Process termination failed", { error: String(error), pid });
          return Effect.succeed(false);
        }),
      );
      if (stopped) yield* stopResourcesForPid(pid);
      return stopped;
    });

  const confirmInferenceStopped = (port: number): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const startupClean = yield* waitForStartupReconciliation();
      if (!startupClean) return false;
      if (supportsOwnedProcessGroups && !(yield* cleanupOwnedProcessGroup("confirm-stopped"))) {
        return false;
      }
      const process = yield* findInferenceProcess(port);
      if (process) return false;
      yield* stopAllResources();
      return true;
    });

  const confirmSpawnIdentityEffect = createConfirmSpawnIdentity(runner, processLaunchId);
  const cleanupWindowsLaunches = createWindowsLaunchCleanup(
    activePids,
    killWindowsProcessEffect,
    stopAllResources,
  );

  const prepareForLaunch = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (!supportsOwnedProcessGroups) return yield* cleanupWindowsLaunches();
      if (!(yield* waitForStartupReconciliation())) return false;
      const clean = yield* cleanupOwnedProcessGroup("before-launch");
      if (clean) yield* stopAllResources();
      return clean;
    });

  const launchModel = createLaunchModel({
    config,
    logger,
    ...(eventManager ? { eventManager } : {}),
    runner,
    supportsOwnedProcessGroups,
    ownershipStore,
    platform,
    prepareForLaunch,
    cleanupOwnedProcessGroup,
    terminateUnrecordedLaunch: (pid) => killWindowsProcessEffect(pid, true),
    registerResources,
    releaseResources,
    stopResources,
    prepareDockerLaunch,
    forgetDockerLaunch,
    confirmSpawnIdentity: confirmSpawnIdentityEffect,
  });

  reconcileStartup = (): Effect.Effect<boolean> =>
    supportsOwnedProcessGroups
      ? cleanupOwnedProcessGroup("controller-start")
      : Effect.succeed(true);

  const shutdown = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const stopped = supportsOwnedProcessGroups
        ? (yield* waitForStartupReconciliation()) &&
          (yield* cleanupOwnedProcessGroup("controller-shutdown"))
        : yield* cleanupWindowsLaunches();
      yield* stopAllResources();
      return stopped;
    });

  const confirmOwnedProcessStopped = (pid: number): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (!(yield* waitForStartupReconciliation())) return false;
      if (!supportsOwnedProcessGroups) {
        const stopped = !pidExists(pid);
        if (stopped) yield* stopResourcesForPid(pid);
        return stopped;
      }
      const inspection = inspectOwnership();
      if (inspection.status === "missing") {
        const stopped = !pidExists(pid);
        if (stopped) yield* stopResourcesForPid(pid);
        return stopped;
      }
      if (inspection.status === "blocked") return false;
      const recordMatches =
        inspection.record.state !== "pending" && inspection.record.rootPid === pid;
      const memberMatches =
        inspection.status === "owned" && inspection.members.some((entry) => entry.pid === pid);
      if (!recordMatches && !memberMatches) return false;
      if (inspection.status === "owned") return false;
      const stopped = yield* cleanupOwnedProcessGroup("confirm-owned-stopped", inspection.record);
      if (stopped) yield* stopResourcesForLaunch(inspection.record.launchId);
      return stopped;
    });

  return {
    findInferenceProcess,
    confirmInferenceStopped,
    launchModel,
    killProcess,
    killOwnedProcess: killProcess,
    confirmOwnedProcessStopped,
    shutdown,
  };
};

export const makeProcessManager = (
  config: Config,
  logger: Logger,
  eventManager?: EventManager,
  runner: ProcessRunner = realProcessRunner,
): Effect.Effect<ProcessManager> =>
  Effect.sync(() => createProcessManager(config, logger, eventManager, runner));
