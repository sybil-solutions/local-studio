import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { setTimeout as delayTimeout } from "node:timers/promises";
import { parse as parseYaml } from "yaml";
import type { Config } from "../config/env";
import { delay } from "../core/async";
import type { Logger } from "../core/logger";
import type { LaunchResult, ProcessInfo, Recipe } from "../types/models";
import type { EventManager } from "./event-manager";
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
 * @param eventManager - Event manager for log forwarding.
 * @returns Process manager.
 */
export const createProcessManager = (
    config: Config,
    logger: Logger,
    eventManager?: EventManager,
): ProcessManager => {
    /**
     * Locate the inference process by port.
     * @param port - Port to match.
     * @returns Process info or null.
     */
    const findInferenceProcess = async (
        port: number,
    ): Promise<ProcessInfo | null> => {
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
            let modelPath =
                extractFlag(proc.args, "--model") ||
                extractFlag(proc.args, "--model-path");
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
                            const parsed = parseYaml(content) as Record<
                                string,
                                unknown
                            >;
                            const model = parsed["model"] as
                                | Record<string, unknown>
                                | undefined;
                            const modelName = model?.["model_name"];
                            if (typeof modelName === "string") {
                                modelPath = resolve(
                                    config.models_dir,
                                    modelName,
                                );
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
                    const tabbyResult = await fetchTabbyModel(
                        port,
                        tabbyDirectory,
                        config.models_dir,
                    );
                    modelPath = tabbyResult.modelPath ?? modelPath;
                    servedModelName =
                        tabbyResult.servedModelName ?? servedModelName;
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
    const killProcess = async (
        pid: number,
        force: boolean,
    ): Promise<boolean> => {
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
        const updatedRecipe: Recipe = {
            ...recipe,
            port: config.inference_port,
        };
        const command =
            updatedRecipe.backend === "sglang"
                ? buildSglangCommand(updatedRecipe, config)
                : buildVllmCommand(updatedRecipe);

        const logFile = resolve("/tmp", `vllm_${updatedRecipe.id}.log`);
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
                        eventManager
                            .publishLogLine(updatedRecipe.id, line)
                            .catch(() => {});
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
                        eventManager
                            .publishLogLine(updatedRecipe.id, line)
                            .catch(() => {});
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
