import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { delay, delayEffect } from "../../../core/async";
import {
  cleanupLogFiles,
  getLogCleanupDefaultsFromEnvironment,
  primaryLogPathFor,
} from "../../../core/log-files";
import type { Logger } from "../../../core/logger";
import type { LaunchResult, ProcessInfo, Recipe } from "../../models/types";
import type { EventManager } from "../../system/event-manager";
import { buildBackendCommand } from "./backend-builder";
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
  findInferenceProcess: (port: number) => Promise<ProcessInfo | null>;
  launchModel: (recipe: Recipe, portOverride?: number) => Promise<LaunchResult>;
  killProcess: (pid: number, force: boolean) => Promise<boolean>;
}

export const createProcessManager = (
  config: Config,
  logger: Logger,
  eventManager?: EventManager
): ProcessManager => {
  type ProcessTableEntry = {
    pid: number;
    ppid: number;
    stat: string;
    command: string;
  };

  const findInferenceProcess = async (port: number): Promise<ProcessInfo | null> => {
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
  };

  const killProcessEffect = (pid: number, force: boolean): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (!pidExists(pid)) {
        return true;
      }
      const tree = buildProcessTree();
      const children = new Set<number>();
      collectChildren(tree, pid, children);
      const allPids = [...children, pid];

      // Docker-backed recipes often leave the actual server inside a container whose
      // host process tree does not reliably die when the docker CLI process is
      // signalled. Stop/kill the named container first, then signal the process tree.
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
        yield* delayEffect(250);
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
          yield* delayEffect(250);
        }
      }

      yield* delayEffect(force ? 500 : 1000);
      return !pidExists(pid);
    });

  const killProcess = (pid: number, force: boolean): Promise<boolean> =>
    Effect.runPromise(killProcessEffect(pid, force));

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
        (argument) => argument === "docker" || argument.endsWith("/docker")
      );
      if (dockerIndex < 0 || proc.args[dockerIndex + 1] !== "run") continue;
      const name = extractFlag(proc.args.slice(dockerIndex + 2), "--name");
      if (name) names.add(name);
    }

    // With Docker + host process visibility, the Python server process is often
    // parented under containerd-shim rather than the `docker run` CLI process. If
    // `findInferenceProcess()` found the in-container Python PID, match the
    // sibling docker-run command by inference port so the container is stopped too.
    if (inferencePorts.size > 0) {
      for (const proc of processes) {
        const dockerIndex = proc.args.findIndex(
          (argument) => argument === "docker" || argument.endsWith("/docker")
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
      let result = spawnSync("docker", args, { stdio: "ignore" });
      if (result.status !== 0) {
        result = spawnSync("sudo", ["-n", "docker", ...args], { stdio: "ignore" });
      }
      if (result.status !== 0) {
        logger.warn("Failed to stop docker inference container", { name, action });
      }
    }
  };

  const removeStaleDockerContainerForCommand = (command: string[]): void => {
    const dockerIndex = command.findIndex(
      (argument) => argument === "docker" || argument.endsWith("/docker")
    );
    if (dockerIndex < 0 || command[dockerIndex + 1] !== "run") return;
    const name = extractFlag(command.slice(dockerIndex + 2), "--name");
    if (!name) return;
    const result = spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    if (result.status !== 0) {
      spawnSync("sudo", ["-n", "docker", "rm", "-f", name], { stdio: "ignore" });
    }
  };

  const sendSignal = (pid: number, signal: NodeJS.Signals): boolean => {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      const result = spawnSync("sudo", ["-n", "kill", `-${signal}`, String(pid)], {
        stdio: "ignore",
      });
      return result.status === 0;
    }
  };

  const listProcessTable = (): ProcessTableEntry[] => {
    try {
      const result = spawnSync("ps", ["-eo", "pid=,ppid=,stat=,args="]);
      if (result.status !== 0) {
        return [];
      }
      const output = result.stdout.toString("utf-8").trim();
      if (!output) {
        return [];
      }
      return output
        .split("\n")
        .map((line): ProcessTableEntry | null => {
          const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
          if (!match) {
            return null;
          }
          const command = match[4] ?? "";
          return {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            stat: match[3] ?? "",
            command,
          };
        })
        .filter((entry): entry is ProcessTableEntry => entry !== null && entry.pid > 0);
    } catch {
      return [];
    }
  };

  const isOrphanedInferenceWorker = (entry: ProcessTableEntry): boolean => {
    if (entry.ppid !== 1 || entry.stat.includes("Z")) {
      return false;
    }
    return entry.command.includes("VLLM::Worker");
  };

  const cleanupOrphanedInferenceWorkersEffect = (reason: string): Effect.Effect<number> =>
    Effect.gen(function* () {
      const workers = listProcessTable().filter(isOrphanedInferenceWorker);
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
        yield* delayEffect(200);
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

  const cleanupOrphanedInferenceWorkers = (reason: string): Promise<number> =>
    Effect.runPromise(cleanupOrphanedInferenceWorkersEffect(reason));

  const launchModel = async (recipe: Recipe, portOverride?: number): Promise<LaunchResult> => {
    const updatedRecipe: Recipe = {
      ...recipe,
      port: portOverride ?? config.inference_port,
    };
    let command: string[] | null = null;
    try {
      command = buildBackendCommand(updatedRecipe, config);
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

    await cleanupOrphanedInferenceWorkers("before-launch");
    removeStaleDockerContainerForCommand(command);

    const logFile = primaryLogPathFor(config.data_dir, updatedRecipe.id);
    // Best-effort retention to prevent unbounded growth over long-running installs.
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

      const child = spawn(entry, command.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        env,
        detached: true,
      }) as ChildProcess;

      child.on("error", (error) => {
        spawnError = String(error);
      });

      let logStream: WriteStream | null = null;
      try {
        logStream = createWriteStream(logFile, { flags: "a" });
      } catch (logError) {
        logger.warn("Failed to open log file", {
          error: String(logError),
        });
      }

      // Keep a rolling tail of the process output. Launch logs stream live to
      // subscribers of `logs:<recipeId>`, but a fast-failing launch (e.g. an
      // argparse "invalid choice" error) exits before the UI subscribes to that
      // channel, so the live stream drops them — only the log file keeps them.
      // We replay this tail in the failure result so the UI shows WHY a launch
      // died instead of a bare "Process exited early".
      const recentOutput: string[] = [];
      const captureLine = (line: string): void => {
        recentOutput.push(line);
        if (recentOutput.length > 60) recentOutput.shift();
        if (logStream) {
          logStream.write(line + "\n");
        }
        if (eventManager) {
          eventManager.publishLogLine(updatedRecipe.id, line).catch(() => {});
        }
      };

      if (child.stdout) {
        createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", captureLine);
      }

      if (child.stderr) {
        createInterface({ input: child.stderr, crlfDelay: Infinity }).on("line", captureLine);
      }

      child.on("exit", () => {
        if (logStream) {
          logStream.end();
        }
      });

      child.unref();

      await delay(3000);
      if (spawnError) {
        if (logStream) {
          logStream.end();
        }
        return {
          success: false,
          pid: null,
          message: spawnError,
          log_file: logFile,
        };
      }
      if (child.exitCode !== null) {
        if (logStream) {
          logStream.end();
        }
        // Surface the tail of the process output so the failure is diagnosable
        // from the UI (e.g. an invalid CLI flag, a missing kernel/import) rather
        // than a bare "exited early".
        const tail = recentOutput
          .slice(-20)
          .filter((line) => line.trim().length > 0)
          .join("\n");
        const message = tail
          ? `Process exited early (code ${child.exitCode}):\n${tail}`
          : `Process exited early (code ${child.exitCode})`;
        if (eventManager) {
          void eventManager
            .publishLaunchProgress(updatedRecipe.id, "error", message)
            .catch(() => {});
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
        pid: child.pid ?? null,
        message: "Process started",
        log_file: logFile,
      };
    } catch (error) {
      logger.error("Launch failed", { error: String(error) });
      return {
        success: false,
        pid: null,
        message: String(error),
        log_file: logFile,
      };
    }
  };

  return {
    findInferenceProcess,
    launchModel,
    killProcess,
  };
};
