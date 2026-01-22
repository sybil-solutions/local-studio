import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delayTimeout } from "node:timers/promises";
import { parse as parseYaml } from "yaml";
import type { Config } from "../config/env";
import { delay } from "../core/async";
import type { Logger } from "../core/logger";
import type { LaunchResult, ProcessInfo, Recipe } from "../types/models";
import { buildSglangCommand, buildVllmCommand } from "./backends";
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
 * @returns Process manager.
 */
export const createProcessManager = (config: Config, logger: Logger): ProcessManager => {
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
      let servedModelName = extractFlag(proc.args, "--served-model-name");

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

    const signal = force ? "SIGKILL" : "SIGTERM";
    for (const childPid of allPids) {
      try {
        process.kill(childPid, signal);
      } catch {
        continue;
      }
    }

    if (!force) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (!pidExists(pid)) {
          break;
        }
        await delayTimeout(250);
      }
      if (pidExists(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          return false;
        }
      }
    }

    await delay(force ? 500 : 1000);
    return true;
  };

  /**
   * Launch an inference backend for a recipe.
   * @param recipe - Recipe data.
   * @returns Launch result.
   */
  const launchModel = async (recipe: Recipe): Promise<LaunchResult> => {
    const updatedRecipe: Recipe = { ...recipe, port: config.inference_port };
    const command = updatedRecipe.backend === "sglang"
      ? buildSglangCommand(updatedRecipe, config)
      : buildVllmCommand(updatedRecipe);

    const logFile = resolve("/tmp", `vllm_${updatedRecipe.id}.log`);
    let logFileDescriptor: number | null = openSync(logFile, "a");
    const env = buildEnvironment(updatedRecipe);

    try {
      const entry = command[0];
      if (!entry) {
        if (logFileDescriptor !== null) {
          closeSync(logFileDescriptor);
          logFileDescriptor = null;
        }
        return {
          success: false,
          pid: null,
          message: "Invalid launch command",
          log_file: logFile,
        };
      }
      let spawnError: string | null = null;
      const child = spawn(entry, command.slice(1), {
        stdio: ["ignore", logFileDescriptor, logFileDescriptor],
        env,
        detached: true,
      }) as ChildProcess;
      child.on("error", (error) => {
        spawnError = String(error);
      });
      if (logFileDescriptor !== null) {
        closeSync(logFileDescriptor);
        logFileDescriptor = null;
      }
      child.unref();

      await delay(3000);
      if (spawnError) {
        return {
          success: false,
          pid: null,
          message: spawnError,
          log_file: logFile,
        };
      }
      if (child.exitCode !== null) {
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
      if (logFileDescriptor !== null) {
        closeSync(logFileDescriptor);
      }
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
