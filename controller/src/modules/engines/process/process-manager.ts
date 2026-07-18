import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { Cause, Effect, Exit, Fiber, Queue } from "effect";
import type { Config } from "../../../config/env";
import {
  cleanupLogFiles,
  getLogCleanupDefaultsFromEnvironment,
  primaryLogPathFor,
} from "../../../core/log-files";
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
  shutdown: () => Effect.Effect<void>;
}

export interface LaunchModelOptions {
  readonly gpuUuids?: readonly string[];
}

interface LaunchResources {
  readonly child: SpawnedProcess;
  readonly pid: number | null;
  readonly queue: Queue.Queue<string | null>;
  readonly readers: Interface[];
  readonly logStream: WriteStream | null;
  readonly onChildError: (error: Error) => void;
  readonly onChildExit: () => void;
  readonly onLogError: ((error: Error) => void) | null;
  logFiber: Fiber.Fiber<void, never> | null;
  released: boolean;
}

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

const buildProcessManager = (
  config: Config,
  logger: Logger,
  eventManager?: EventManager,
  runner: ProcessRunner = realProcessRunner,
): ProcessManager => {
  const activeResources = new Set<LaunchResources>();

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
        for (const reader of resources.readers) reader.close();
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
        Queue.offerUnsafe(resources.queue, null);
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

  const killProcessEffect = (pid: number, force: boolean): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (!pidExists(pid)) {
        yield* stopResourcesForPid(pid);
        return true;
      }
      const tree = buildProcessTree();
      const children = new Set<number>();
      collectChildren(tree, pid, children);
      const allPids = [...children, pid];

      stopDockerContainersForProcesses(allPids, force);

      const signal = force ? "SIGKILL" : "SIGTERM";
      for (const childPid of allPids) {
        sendSignal(childPid, signal);
      }

      const deadline = Date.now() + (force ? 15_000 : 10_000);
      while (Date.now() < deadline) {
        if (!pidExists(pid)) {
          break;
        }
        yield* Effect.sleep(250);
      }

      if (pidExists(pid)) {
        stopDockerContainersForProcesses(allPids, true);
        if (!sendSignal(pid, "SIGKILL")) {
          return false;
        }
        const finalDeadline = Date.now() + 5_000;
        while (Date.now() < finalDeadline) {
          if (!pidExists(pid)) {
            break;
          }
          yield* Effect.sleep(250);
        }
      }

      yield* Effect.sleep(force ? 500 : 1000);
      const stopped = !pidExists(pid);
      if (stopped) yield* stopResourcesForPid(pid);
      return stopped;
    });

  const stopDockerContainersForProcesses = (pids: number[], force: boolean): void => {
    const pidSet = new Set(pids);
    const names = new Set<string>();
    const inferencePorts = new Set<number>();
    const processes = listProcesses();

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

    if (inferencePorts.size > 0) {
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

  const removeStaleDockerContainerForCommand = (command: string[]): void => {
    const dockerIndex = command.findIndex(
      (argument) => argument === "docker" || argument.endsWith("/docker"),
    );
    if (dockerIndex < 0 || command[dockerIndex + 1] !== "run") return;
    const name = extractFlag(command.slice(dockerIndex + 2), "--name");
    if (!name) return;
    const result = runner.runSync("docker", ["rm", "-f", name]);
    if (result.status !== 0) {
      runner.runSync("sudo", ["-n", "docker", "rm", "-f", name]);
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

  const isOrphanedInferenceWorker = (entry: ProcessInventoryEntry): boolean => {
    if (entry.ppid !== 1 || entry.stat.includes("Z")) {
      return false;
    }
    return entry.command.includes("VLLM::Worker");
  };

  const cleanupOrphanedInferenceWorkersEffect = (reason: string): Effect.Effect<number> =>
    Effect.gen(function* () {
      const workers = listProcessInventory(runner).filter(isOrphanedInferenceWorker);
      if (workers.length === 0) {
        return 0;
      }

      for (const worker of workers) {
        logger.warn("Killing orphaned inference worker", {
          pid: worker.pid,
          reason,
          command: worker.command,
        });
        sendSignal(worker.pid, "SIGTERM");
      }

      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline && workers.some((worker) => pidExists(worker.pid))) {
        yield* Effect.sleep(200);
      }

      for (const worker of workers) {
        if (pidExists(worker.pid)) {
          logger.warn("Force killing orphaned inference worker", {
            pid: worker.pid,
            reason,
            command: worker.command,
          });
          sendSignal(worker.pid, "SIGKILL");
        }
      }

      return workers.length;
    });

  const confirmInferenceStopped = (port: number): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      yield* cleanupOrphanedInferenceWorkersEffect("confirm-stopped");
      const running = yield* findInferenceProcess(port);
      return running === null && !listProcessInventory(runner).some(isOrphanedInferenceWorker);
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

      yield* cleanupOrphanedInferenceWorkersEffect("before-launch");
      removeStaleDockerContainerForCommand(command);

      const logFile = primaryLogPathFor(config.data_dir, updatedRecipe.id);
      cleanupLogFiles(config.data_dir, {
        ...getLogCleanupDefaultsFromEnvironment(),
        excludePaths: new Set([logFile]),
      });
      const env = buildEnvironment(updatedRecipe, config);

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

        let logStream: WriteStream | null = null;
        try {
          logStream = createWriteStream(logFile, { flags: "a" });
        } catch (logError) {
          logger.warn("Failed to open log file", {
            error: String(logError),
          });
        }

        const recentOutput: string[] = [];
        const logQueue = yield* Queue.sliding<string | null>(256);
        const readers: Interface[] = [];
        const onChildError = (error: Error): void => {
          spawnError = String(error);
        };
        const onChildExit = (): void => {
          Queue.offerUnsafe(logQueue, null);
        };
        const onLogError = logStream
          ? (error: Error): void =>
              logger.warn("Inference log stream failed", { error: String(error) })
          : null;
        if (logStream && onLogError) logStream.on("error", onLogError);
        const resources: LaunchResources = {
          child,
          pid: spawnedPid,
          queue: logQueue,
          readers,
          logStream,
          onChildError,
          onChildExit,
          onLogError,
          logFiber: null,
          released: false,
        };
        spawnedResources = resources;
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

        child.on("error", onChildError);
        child.on("exit", onChildExit);

        child.unref();

        yield* Effect.sleep(3000);
        if (spawnError) {
          if (spawnedPid) yield* killProcessEffect(spawnedPid, true);
          else if (resources.logFiber) yield* Fiber.interrupt(resources.logFiber);
          return {
            success: false,
            pid: null,
            message: spawnError,
            log_file: logFile,
          };
        }
        if (child.exitCode !== null) {
          Queue.offerUnsafe(logQueue, null);
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
        if (spawnedPid) yield* killProcessEffect(spawnedPid, true);
        logger.error("Launch failed", { error: String(error) });
        return {
          success: false,
          pid: null,
          message: String(error),
          log_file: logFile,
        };
      }
    }).pipe(
      Effect.onExit((exit) => {
        if (!Exit.isFailure(exit) || !Cause.hasInterrupts(exit.cause)) return Effect.void;
        if (spawnedPid) return killProcessEffect(spawnedPid, true).pipe(Effect.asVoid);
        if (!spawnedResources) return Effect.void;
        Queue.offerUnsafe(spawnedResources.queue, null);
        return spawnedResources.logFiber
          ? Fiber.interrupt(spawnedResources.logFiber).pipe(Effect.asVoid)
          : releaseResources(spawnedResources);
      }),
    );
  };

  const shutdown = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const pids = [...activeResources]
        .map((resources) => resources.pid)
        .filter((pid): pid is number => pid !== null);
      yield* Effect.forEach(pids, (pid) => killProcessEffect(pid, true), { discard: true });
      yield* Effect.forEach(
        [...activeResources],
        (resources) =>
          resources.logFiber
            ? Fiber.interrupt(resources.logFiber).pipe(Effect.asVoid)
            : releaseResources(resources),
        { discard: true },
      );
    });

  return {
    findInferenceProcess,
    confirmInferenceStopped,
    launchModel,
    killProcess: killProcessEffect,
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
