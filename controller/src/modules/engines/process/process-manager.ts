import { readFileSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { Cause, Effect, Exit, Fiber, Queue } from "effect";
import type { Config } from "../../../config/env";
import {
  cleanupLogFiles,
  createPrivateLogStream,
  getLogCleanupDefaultsFromEnvironment,
  primaryLogPathFor,
} from "../../../core/log-files";
import { redactLogLine } from "../../../core/log-redaction";
import {
  createRedactedRecordMultiplexer,
  redactedRecordPayload,
  type RedactedRecord,
} from "../../../core/redacted-record-multiplexer";
import type { Logger } from "../../../core/logger";
import { realProcessRunner, type ProcessRunner, type SpawnedProcess } from "../../../core/command";
import type { LaunchResult, ProcessInfo, Recipe } from "../../models/types";
import type { EventManager } from "../../system/event-manager";
import { buildBackendCommand } from "./backend-builder";
import { listProcessInventory, type ProcessInventoryEntry } from "./process-inventory";
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

interface LaunchResources {
  readonly child: SpawnedProcess;
  readonly pid: number | null;
  readonly ownedPids: Set<number>;
  readonly containerName: string | null;
  readonly queue: Queue.Queue<string | null>;
  readonly outputStreams: OutputStreamBinding[];
  readonly logStream: WriteStream | null;
  readonly onChildError: (error: Error) => void;
  readonly onChildExit: () => void;
  readonly onLogError: ((error: Error) => void) | null;
  readonly captureError: (error: unknown) => string;
  readonly finalizeOutput: () => void;
  logFiber: Fiber.Fiber<void, never> | null;
  released: boolean;
}

interface OutputStreamBinding {
  readonly stream: Readable;
  readonly onData: (chunk: unknown) => void;
  readonly onEnd: () => void;
  readonly onError: (error: Error) => void;
}

type OutputLabel = "stdout" | "stderr" | "error";

interface LaunchOutput {
  readonly queue: Queue.Queue<string | null>;
  readonly outputStreams: OutputStreamBinding[];
  readonly logStream: WriteStream | null;
  readonly recentOutput: string[];
  readonly captureError: (error: unknown) => string;
  readonly finalize: () => void;
  readonly markExited: () => void;
  readonly captureStream: (label: OutputLabel, stream: Readable) => void;
}

const ownershipEnvironmentKey = "LOCAL_STUDIO_ENGINE_OWNER";

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

const makeLaunchOutput = (logFile: string, logger: Logger): Effect.Effect<LaunchOutput> =>
  Effect.gen(function* () {
    const logStream = ((): WriteStream | null => {
      try {
        return createPrivateLogStream(logFile);
      } catch (error) {
        logger.warn("Failed to open log file", { error: String(error) });
        return null;
      }
    })();
    const queue = yield* Queue.sliding<string | null>(256);
    const outputStreams: OutputStreamBinding[] = [];
    const recentOutput: string[] = [];
    const output = createRedactedRecordMultiplexer<OutputLabel>();
    let exited = false;
    let openStreams = 0;
    let finalized = false;
    const captureRecords = (records: readonly RedactedRecord<OutputLabel>[]): void => {
      for (const record of records) {
        recentOutput.push(record.value);
        if (recentOutput.length > 60) recentOutput.shift();
        if (logStream) {
          try {
            logStream.write(`${record.value}${record.ending}`);
          } catch (error) {
            logger.warn("Inference log write failed", { error: String(error) });
          }
        }
        Queue.offerUnsafe(queue, record.value);
      }
    };
    const captureError = (error: unknown): string => {
      const records = output.writeRecord("error", String(error));
      captureRecords(records);
      return redactedRecordPayload(records);
    };
    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      captureRecords(output.flush());
      Queue.offerUnsafe(queue, null);
    };
    const finishExitedOutput = (): void => {
      if (exited && openStreams === 0) finalize();
    };
    const captureStream = (label: OutputLabel, stream: Readable): void => {
      openStreams += 1;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        openStreams -= 1;
        finishExitedOutput();
      };
      const onData = (chunk: unknown): void => captureRecords(output.write(label, chunk));
      const onEnd = (): void => finish();
      const onError = (error: Error): void => {
        captureError(error);
        finish();
      };
      stream.on("data", onData);
      stream.once("end", onEnd);
      stream.once("error", onError);
      outputStreams.push({ stream, onData, onEnd, onError });
    };
    const markExited = (): void => {
      exited = true;
      finishExitedOutput();
    };
    return {
      queue,
      outputStreams,
      logStream,
      recentOutput,
      captureError,
      finalize,
      markExited,
      captureStream,
    };
  });

const dockerContainerNameForCommand = (command: string[]): string | null => {
  const dockerIndex = command.findIndex(
    (argument) => argument === "docker" || argument.endsWith("/docker"),
  );
  if (dockerIndex < 0 || command[dockerIndex + 1] !== "run") return null;
  return extractFlag(command.slice(dockerIndex + 2), "--name") ?? null;
};

const ownershipMarkerFor = (config: Config): string =>
  createHash("sha256")
    .update(`${config.data_dir}\0${config.inference_port}`)
    .digest("hex")
    .slice(0, 32);

const commandWithOwnershipMarker = (command: string[], marker: string): string[] => {
  const dockerIndex = command.findIndex(
    (argument) => argument === "docker" || argument.endsWith("/docker"),
  );
  if (dockerIndex < 0 || command[dockerIndex + 1] !== "run") return command;
  const updated = [...command];
  updated.splice(dockerIndex + 2, 0, "--env", `${ownershipEnvironmentKey}=${marker}`);
  return updated;
};

const markedProcessInventory = (runner: ProcessRunner, marker: string): ProcessInventoryEntry[] => {
  const inventory = listProcessInventory(runner).filter((entry) => !entry.stat.includes("Z"));
  const expected = `${ownershipEnvironmentKey}=${marker}`;
  if (process.platform === "linux") {
    return inventory.filter((entry) => {
      try {
        return readFileSync(`/proc/${entry.pid}/environ`, "utf8").split("\0").includes(expected);
      } catch {
        return false;
      }
    });
  }
  const result = runner.runSync("ps", ["eww", "-axo", "pid=,command="]);
  if (result.status !== 0) return [];
  const markedPids = new Set(
    result.stdout
      .split("\n")
      .filter((line) => line.includes(expected))
      .map((line) => Number(line.trim().match(/^(\d+)/)?.[1]))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
  return inventory.filter((entry) => markedPids.has(entry.pid));
};

const runDockerCommand = (
  runner: ProcessRunner,
  args: string[],
): ReturnType<ProcessRunner["runSync"]> => {
  const result = runner.runSync("docker", args);
  return result.status === 0 ? result : runner.runSync("sudo", ["-n", "docker", ...args]);
};

const markedDockerContainerNames = (runner: ProcessRunner, marker: string): string[] => {
  const containers = runDockerCommand(runner, ["ps", "--format", "{{.Names}}"]);
  if (containers.status !== 0) return [];
  const expected = `${ownershipEnvironmentKey}=${marker}`;
  return containers.stdout
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => {
      const inspected = runDockerCommand(runner, [
        "inspect",
        "--format",
        "{{range .Config.Env}}{{println .}}{{end}}",
        name,
      ]);
      return inspected.status === 0 && inspected.stdout.split("\n").includes(expected);
    });
};

const processGroupMembers = (runner: ProcessRunner, pgid: number | undefined): number[] =>
  pgid === undefined
    ? []
    : listProcessInventory(runner)
        .filter((entry) => entry.pgid === pgid)
        .map((entry) => entry.pid);

const removeStaleDockerContainerForCommand = (command: string[], runner: ProcessRunner): void => {
  const name = dockerContainerNameForCommand(command);
  if (!name) return;
  const result = runner.runSync("docker", ["rm", "-f", name]);
  if (result.status !== 0) runner.runSync("sudo", ["-n", "docker", "rm", "-f", name]);
};

const dockerContainerNameForPid = (pid: number, runner: ProcessRunner): string | null => {
  if (process.platform !== "linux") return null;
  let cgroup = "";
  try {
    cgroup = readFileSync(`/proc/${pid}/cgroup`, "utf8");
  } catch {
    return null;
  }
  const containerId = cgroup.match(/(?:docker[\/-]|cri-containerd-)([0-9a-f]{12,64})/i)?.[1];
  if (!containerId) return null;
  let result = runner.runSync("docker", ["ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}"]);
  if (result.status !== 0) {
    result = runner.runSync("sudo", [
      "-n",
      "docker",
      "ps",
      "--no-trunc",
      "--format",
      "{{.ID}} {{.Names}}",
    ]);
  }
  if (result.status !== 0) return null;
  for (const line of result.stdout.split("\n")) {
    const [id, name] = line.trim().split(/\s+/, 2);
    if (id && (id.startsWith(containerId) || containerId.startsWith(id))) return name ?? null;
  }
  return null;
};

const buildProcessManager = (
  config: Config,
  logger: Logger,
  eventManager?: EventManager,
  runner: ProcessRunner = realProcessRunner,
): ProcessManager => {
  const ownershipMarker = ownershipMarkerFor(config);
  const activeResources = new Set<LaunchResources>();
  const ownedProcessGroups = new Map<number, number>();
  const ownedContainerNames = new Map<number, string>();

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

  const releaseResources = (resources: LaunchResources): Effect.Effect<void> => {
    if (resources.released) return Effect.void;
    resources.released = true;
    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        resources.finalizeOutput();
        for (const binding of resources.outputStreams) {
          binding.stream.removeListener("data", binding.onData);
          binding.stream.removeListener("end", binding.onEnd);
          binding.stream.removeListener("error", binding.onError);
          binding.stream.destroy();
        }
        if (resources.logStream && resources.onLogError) {
          resources.logStream.removeListener("error", resources.onLogError);
        }
        const child = resources.child as unknown as {
          removeListener?: (event: string, listener: unknown) => void;
        };
        child.removeListener?.("error", resources.onChildError);
        child.removeListener?.("exit", resources.onChildExit);
      });
      yield* Queue.shutdown(resources.queue);
      yield* closeLogStream(resources.logStream);
      activeResources.delete(resources);
    });
  };

  const stopResourcesForPid = (pid: number): Effect.Effect<void> =>
    Effect.forEach(
      [...activeResources].filter((resources) => resources.pid === pid),
      (resources) => {
        resources.finalizeOutput();
        return resources.logFiber
          ? Fiber.interrupt(resources.logFiber).pipe(Effect.asVoid)
          : releaseResources(resources);
      },
      { discard: true },
    );

  const findInferenceProcess = (port: number): Effect.Effect<ProcessInfo | null> =>
    Effect.sync(() => {
      const processes = listProcesses();
      for (const proc of processes) {
        const backend = detectBackend(proc.args);
        if (!backend) {
          continue;
        }
        const flagPort = extractFlag(proc.args, "--port");
        if (flagPort && Number(flagPort) !== port) {
          continue;
        } else if (!flagPort && !(backend === "vllm" && port === 8000)) {
          continue;
        }
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

  const killProcessEffect = (
    pid: number,
    force: boolean,
    ownership: "observed" | "owned" = "observed",
  ): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const resolvedOwnership =
        ownership === "owned" || ownedProcessGroups.has(pid) ? "owned" : "observed";
      const ownedResources =
        resolvedOwnership === "owned"
          ? [...activeResources].filter(
              (resources) => resources.pid === pid || resources.ownedPids.has(pid),
            )
          : [];
      const targetPgid =
        resolvedOwnership === "owned"
          ? ownedProcessGroups.get(pid)
          : listProcessInventory(runner).find((entry) => entry.pid === pid && entry.pgid === pid)
              ?.pgid;
      const groupMembers = (): number[] => processGroupMembers(runner, targetPgid);
      const knownOwnedPids = new Set([
        ...ownedResources.flatMap((resources) => [...resources.ownedPids]),
        ...groupMembers(),
      ]);
      if (!pidExists(pid) && [...knownOwnedPids].every((candidate) => !pidExists(candidate))) {
        ownedProcessGroups.delete(pid);
        ownedContainerNames.delete(pid);
        yield* stopResourcesForPid(pid);
        return true;
      }
      const tree = buildProcessTree();
      const children = new Set<number>();
      const roots = knownOwnedPids.size > 0 ? knownOwnedPids : new Set([pid]);
      for (const root of roots) collectChildren(tree, root, children);
      const allPids = [...new Set([...children, ...roots])];
      for (const resources of ownedResources) {
        for (const candidate of allPids) resources.ownedPids.add(candidate);
      }

      stopDockerContainersForProcesses(allPids, force, resolvedOwnership);

      const signal = force ? "SIGKILL" : "SIGTERM";
      for (const childPid of allPids) {
        sendSignal(childPid, signal);
      }

      const currentPids = (): number[] => [...new Set([...allPids, ...groupMembers()])];
      const allStopped = (): boolean => currentPids().every((candidate) => !pidExists(candidate));
      const deadline = Date.now() + (force ? 15_000 : 10_000);
      while (Date.now() < deadline) {
        if (allStopped()) {
          break;
        }
        yield* Effect.sleep(250);
      }

      if (!allStopped()) {
        stopDockerContainersForProcesses(allPids, true, resolvedOwnership);
        for (const candidate of currentPids()) {
          if (pidExists(candidate)) sendSignal(candidate, "SIGKILL");
        }
        const finalDeadline = Date.now() + 5_000;
        while (Date.now() < finalDeadline) {
          if (allStopped()) {
            break;
          }
          yield* Effect.sleep(250);
        }
      }

      yield* Effect.sleep(force ? 500 : 1000);
      const stopped = allStopped();
      if (stopped) {
        ownedProcessGroups.delete(pid);
        ownedContainerNames.delete(pid);
        yield* stopResourcesForPid(pid);
      }
      return stopped;
    });

  const stopDockerContainersForProcesses = (
    pids: number[],
    force: boolean,
    ownership: "observed" | "owned",
  ): void => {
    const pidSet = new Set(pids);
    const names = new Set<string>();
    const processes = listProcesses();

    if (ownership === "owned") {
      for (const pid of pidSet) {
        const name = ownedContainerNames.get(pid);
        if (name) names.add(name);
      }
    }

    for (const proc of processes) {
      if (!pidSet.has(proc.pid)) continue;
      if (ownership === "observed") {
        const cgroupName = dockerContainerNameForPid(proc.pid, runner);
        if (cgroupName) names.add(cgroupName);
      }
      const dockerIndex = proc.args.findIndex(
        (argument) => argument === "docker" || argument.endsWith("/docker"),
      );
      if (dockerIndex < 0 || proc.args[dockerIndex + 1] !== "run") continue;
      const name = extractFlag(proc.args.slice(dockerIndex + 2), "--name");
      if (name) names.add(name);
    }

    for (const name of names) {
      const action = force ? "kill" : "stop";
      const args = force ? [action, name] : [action, "--time", "2", name];
      let result = runner.runSync("docker", args);
      if (result.status !== 0) {
        result = runner.runSync("sudo", ["-n", "docker", ...args]);
      }
      if (result.status !== 0) {
        logger.warn("Failed to stop docker inference container", { name, action });
      }
    }
  };

  const sendSignal = (pid: number, signal: NodeJS.Signals): boolean => {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      const result = runner.runSync("sudo", ["-n", "kill", `-${signal}`, String(pid)]);
      return result.status === 0;
    }
  };

  const confirmInferenceStopped = (port: number): Effect.Effect<boolean> =>
    findInferenceProcess(port).pipe(Effect.map((running) => running === null));

  const cleanupMarkedOwnedProcesses = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const marked = markedProcessInventory(runner, ownershipMarker);
      for (const entry of marked) {
        const root = entry.pgid > 0 ? entry.pgid : entry.pid;
        ownedProcessGroups.set(root, root);
        const containerName = dockerContainerNameForPid(entry.pid, runner);
        if (containerName) ownedContainerNames.set(root, containerName);
      }
      const containers = markedDockerContainerNames(runner, ownershipMarker);
      const containersStopped = containers.map(
        (name) => runDockerCommand(runner, ["kill", name]).status === 0,
      );
      const processesStopped = yield* Effect.forEach([...ownedProcessGroups.keys()], (pid) =>
        killProcessEffect(pid, true, "owned"),
      );
      if (![...containersStopped, ...processesStopped].every(Boolean)) return false;
      return (
        markedProcessInventory(runner, ownershipMarker).length === 0 &&
        markedDockerContainerNames(runner, ownershipMarker).length === 0
      );
    });

  const launchModel = (
    recipe: Recipe,
    options: LaunchModelOptions = {},
  ): Effect.Effect<LaunchResult> => {
    let spawnedPid: number | null = null;
    let spawnedResources: LaunchResources | null = null;
    return Effect.gen(function* () {
      const updatedRecipe = recipeForLaunch(recipe, config.inference_port, options);
      let command: string[] | null = null;
      try {
        command = buildBackendCommand(updatedRecipe, config, options.gpuUuids !== undefined);
      } catch (error) {
        const message = redactLogLine(error instanceof Error ? error.message : String(error));
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

      if (!(yield* cleanupMarkedOwnedProcesses())) {
        return {
          success: false,
          pid: null,
          message: "Owned inference workers are still stopping",
          log_file: primaryLogPathFor(config.data_dir, updatedRecipe.id),
        };
      }
      command = commandWithOwnershipMarker(command, ownershipMarker);
      removeStaleDockerContainerForCommand(command, runner);

      const logFile = primaryLogPathFor(config.data_dir, updatedRecipe.id);
      cleanupLogFiles(config.data_dir, {
        ...getLogCleanupDefaultsFromEnvironment(),
        excludePaths: new Set([logFile]),
      });
      const env = buildEnvironment(updatedRecipe, config);
      env[ownershipEnvironmentKey] = ownershipMarker;

      try {
        const entry = command[0];
        if (!entry) {
          return {
            success: false,
            pid: null,
            message: "Invalid launch command",
            log_file: logFile,
          };
        }
        let spawnError: string | null = null;

        const child = runner.spawnDetached(entry, command.slice(1), { env, stdio: "pipe" });
        spawnedPid = child.pid ?? null;
        if (spawnedPid) ownedProcessGroups.set(spawnedPid, spawnedPid);

        const launchOutput = yield* makeLaunchOutput(logFile, logger);
        const { logStream, queue: logQueue, recentOutput } = launchOutput;
        const onChildError = (error: Error): void => {
          spawnError = launchOutput.captureError(error);
        };
        const onChildExit = (): void => launchOutput.markExited();
        const onLogError = logStream
          ? (error: Error): void =>
              logger.warn("Inference log stream failed", { error: String(error) })
          : null;
        if (logStream && onLogError) logStream.on("error", onLogError);
        const resources: LaunchResources = {
          child,
          pid: spawnedPid,
          ownedPids: new Set(spawnedPid ? [spawnedPid] : []),
          containerName: dockerContainerNameForCommand(command),
          queue: logQueue,
          outputStreams: launchOutput.outputStreams,
          logStream,
          onChildError,
          onChildExit,
          onLogError,
          captureError: launchOutput.captureError,
          finalizeOutput: launchOutput.finalize,
          logFiber: null,
          released: false,
        };
        spawnedResources = resources;
        if (spawnedPid && resources.containerName) {
          ownedContainerNames.set(spawnedPid, resources.containerName);
        }
        activeResources.add(resources);
        resources.logFiber = yield* Effect.gen(function* () {
          while (true) {
            const line = yield* Queue.take(logQueue);
            if (line === null) return;
            if (eventManager) yield* eventManager.publishLogLine(updatedRecipe.id, line);
          }
        }).pipe(
          Effect.ensuring(releaseResources(resources)),
          Effect.forkDetach({ startImmediately: true }),
        );
        if (child.stdout) launchOutput.captureStream("stdout", child.stdout);
        if (child.stderr) launchOutput.captureStream("stderr", child.stderr);

        child.on("error", onChildError);
        child.on("exit", onChildExit);

        child.unref();

        yield* Effect.sleep(3000);
        if (spawnError) {
          if (spawnedPid) yield* killProcessEffect(spawnedPid, true, "owned");
          else if (resources.logFiber) yield* Fiber.interrupt(resources.logFiber);
          return {
            success: false,
            pid: null,
            message: spawnError,
            log_file: logFile,
          };
        }
        if (child.exitCode !== null) {
          launchOutput.finalize();
          if (resources.logFiber) yield* Fiber.join(resources.logFiber);
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
          if (spawnedPid) yield* killProcessEffect(spawnedPid, true, "owned");
          return {
            success: false,
            pid: null,
            message,
            log_file: logFile,
          };
        }
        return {
          success: true,
          pid: spawnedPid,
          message: "Process started",
          log_file: logFile,
        };
      } catch (error) {
        const message = spawnedResources
          ? spawnedResources.captureError(error)
          : redactLogLine(String(error));
        spawnedResources?.finalizeOutput();
        if (spawnedPid) yield* killProcessEffect(spawnedPid, true, "owned");
        logger.error("Launch failed", { error: message });
        return {
          success: false,
          pid: null,
          message,
          log_file: logFile,
        };
      }
    }).pipe(
      Effect.onExit((exit) => {
        if (!Exit.isFailure(exit) || !Cause.hasInterrupts(exit.cause)) return Effect.void;
        if (spawnedPid) return killProcessEffect(spawnedPid, true, "owned").pipe(Effect.asVoid);
        if (!spawnedResources) return Effect.void;
        spawnedResources.finalizeOutput();
        return spawnedResources.logFiber
          ? Fiber.interrupt(spawnedResources.logFiber).pipe(Effect.asVoid)
          : releaseResources(spawnedResources);
      }),
    );
  };

  const shutdown = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const pids = [
        ...new Set([
          ...ownedProcessGroups.keys(),
          ...[...activeResources]
            .map((resources) => resources.pid)
            .filter((pid): pid is number => pid !== null),
        ]),
      ];
      const stopped = yield* Effect.forEach(pids, (pid) => killProcessEffect(pid, true, "owned"));
      yield* Effect.forEach(
        [...activeResources],
        (resources) =>
          resources.logFiber
            ? Fiber.interrupt(resources.logFiber).pipe(Effect.asVoid)
            : releaseResources(resources),
        { discard: true },
      );
      return stopped.every(Boolean);
    });

  const confirmOwnedProcessStopped = (pid: number): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const resources = [...activeResources].filter((entry) => entry.pid === pid);
      const pgid = ownedProcessGroups.get(pid);
      const pids = new Set([
        ...resources.flatMap((entry) => [...entry.ownedPids]),
        ...processGroupMembers(runner, pgid),
      ]);
      if (pids.size === 0) pids.add(pid);
      const stopped = [...pids].every((candidate) => !pidExists(candidate));
      if (stopped) {
        ownedProcessGroups.delete(pid);
        ownedContainerNames.delete(pid);
        yield* stopResourcesForPid(pid);
      }
      return stopped;
    });

  return {
    findInferenceProcess,
    confirmInferenceStopped,
    launchModel,
    killProcess: killProcessEffect,
    killOwnedProcess: (pid, force) => killProcessEffect(pid, force, "owned"),
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
  Effect.sync(() => buildProcessManager(config, logger, eventManager, runner));
