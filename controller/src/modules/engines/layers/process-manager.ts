// CRITICAL
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { setTimeout as delayTimeout } from "node:timers/promises";
import { parse as parseYaml } from "yaml";
import type { Config } from "../../../config/env";
import { delay } from "../../../core/async";
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
  fetchTabbyModel,
  listProcesses,
  pidExists,
  buildProcessTree,
} from "./process-utilities";

/**
 * Controller process manager.
 */
export interface ProcessManager {
  findInferenceProcess: (port: number) => Promise<ProcessInfo | null>;
  launchModel: (recipe: Recipe) => Promise<LaunchResult>;
  evictModel: (force: boolean) => Promise<number | null>;
  killProcess: (pid: number, force: boolean) => Promise<boolean>;
}

/**
 * Create a process manager.
 * @param config - Runtime config.
 * @param logger - Logger instance.
 * @param eventManager - Event manager for log forwarding.
 * @returns Process manager.
 */
export const createProcessManager = (
  config: Config,
  logger: Logger,
  eventManager?: EventManager
): ProcessManager => {
  /**
   * Locate the inference process by port.
   * @param port - Port to match.
   * @returns Process info or null.
   */
  const findInferenceProcess = async (port: number): Promise<ProcessInfo | null> => {
    const processes = listProcesses();
    for (const proc of processes) {
      const backend = detectBackend(proc.args);
      if (!backend) {
        continue;
      }
      const flagPort = extractFlag(proc.args, "--port");
      if (backend === "tabbyapi") {
        if (port !== 8000) {
          continue;
        }
      } else if (!flagPort || Number(flagPort) !== port) {
        continue;
      }
      let modelPath = extractFlag(proc.args, "--model") || extractFlag(proc.args, "--model-path");
      if (!modelPath && (backend === "llamacpp" || backend === "exllamav3")) {
        modelPath = extractFlag(proc.args, "-m");
      }
      let servedModelName =
        extractFlag(proc.args, "--served-model-name") ||
        extractFlag(proc.args, "--alias") ||
        extractFlag(proc.args, "-a");

      if (!modelPath) {
        const serveIndex = proc.args.indexOf("serve");
        if (serveIndex >= 0 && serveIndex + 1 < proc.args.length) {
          const candidate = proc.args[serveIndex + 1];
          if (candidate && !candidate.startsWith("-")) {
            modelPath = candidate;
          }
        }
      }

      if (backend === "tabbyapi" && !modelPath) {
        const tabbyDirectory = config.tabby_api_dir || "/opt/tabbyAPI";
        const configFlag = extractFlag(proc.args, "--config");
        if (configFlag) {
          const configPath = resolve(tabbyDirectory, configFlag);
          if (existsSync(configPath)) {
            try {
              const content = readFileSync(configPath, "utf-8");
              const parsed = parseYaml(content) as Record<string, unknown>;
              const model = parsed["model"] as Record<string, unknown> | undefined;
              const modelName = model?.["model_name"];
              if (typeof modelName === "string") {
                modelPath = resolve(config.models_dir, modelName);
                servedModelName = modelName;
              }
            } catch {
              return {
                pid: proc.pid,
                backend,
                model_path: "tabbyapi:unknown",
                port,
                served_model_name: servedModelName ?? "GLM-4.7",
              };
            }
          }
        }
        if (!modelPath) {
          const tabbyResult = await fetchTabbyModel(port, tabbyDirectory, config.models_dir);
          modelPath = tabbyResult.modelPath ?? modelPath;
          servedModelName = tabbyResult.servedModelName ?? servedModelName;
        }
      }

      if (!modelPath && backend === "tabbyapi") {
        return {
          pid: proc.pid,
          backend,
          model_path: "tabbyapi:unknown",
          port,
          served_model_name: servedModelName ?? "GLM-4.7",
        };
      }

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

  /**
   * Kill a process and its children.
   * @param pid - Process id.
   * @param force - Force kill if true.
   * @returns True on success.
   */
  const killProcess = async (pid: number, force: boolean): Promise<boolean> => {
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
      await delayTimeout(250);
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
        await delayTimeout(250);
      }
    }

    await delay(force ? 500 : 1000);
    return !pidExists(pid);
  };

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

  /**
   * Launch an inference backend for a recipe.
   * @param recipe - Recipe data.
   * @returns Launch result.
   */
  const launchModel = async (recipe: Recipe): Promise<LaunchResult> => {
    const updatedRecipe: Recipe = {
      ...recipe,
      port: config.inference_port,
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

    const logFile = primaryLogPathFor(config.data_dir, updatedRecipe.id);
    // Best-effort retention to prevent unbounded growth over long-running installs.
    cleanupLogFiles(config.data_dir, {
      ...getLogCleanupDefaultsFromEnvironment(),
      excludePaths: new Set([logFile]),
    });
    const env = buildEnvironment(updatedRecipe);

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

      // Use pipes to capture stdout/stderr for forwarding
      const child = spawn(entry, command.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        env,
        detached: true,
      }) as ChildProcess;

      child.on("error", (error) => {
        spawnError = String(error);
      });

      // Create log file stream
      let logStream: WriteStream | null = null;
      try {
        logStream = createWriteStream(logFile, { flags: "a" });
      } catch (logError) {
        logger.warn("Failed to open log file", {
          error: String(logError),
        });
      }

      // Forward stdout to log file and event manager
      if (child.stdout) {
        const rl = createInterface({
          input: child.stdout,
          crlfDelay: Infinity,
        });
        rl.on("line", (line) => {
          if (logStream) {
            logStream.write(line + "\n");
          }
          if (eventManager) {
            eventManager.publishLogLine(updatedRecipe.id, line).catch(() => {});
          }
        });
      }

      // Forward stderr to log file and event manager
      if (child.stderr) {
        const rl = createInterface({
          input: child.stderr,
          crlfDelay: Infinity,
        });
        rl.on("line", (line) => {
          if (logStream) {
            logStream.write(line + "\n");
          }
          if (eventManager) {
            eventManager.publishLogLine(updatedRecipe.id, line).catch(() => {});
          }
        });
      }

      // Close log stream when process exits
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
        return {
          success: false,
          pid: null,
          message: "Process exited early",
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

  /**
   * Evict the running inference process.
   * @param force - Force kill if true.
   * @returns Evicted pid or null.
   */
  const evictModel = async (force: boolean): Promise<number | null> => {
    const current = await findInferenceProcess(config.inference_port);
    if (!current) {
      return null;
    }
    await killProcess(current.pid, force);
    return current.pid;
  };

  return {
    findInferenceProcess,
    launchModel,
    evictModel,
    killProcess,
  };
};
