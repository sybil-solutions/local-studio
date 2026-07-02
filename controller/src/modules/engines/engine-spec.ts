/**
 * EngineSpec: a self-contained description of each inference backend, inspired
 * by exo-spark's EngineSpec pattern. Each backend owns its command building,
 * process detection, health endpoint, install action, and binary probing,
 * rather than scattering these concerns across backend-builder,
 * process-utilities, runtime-targets, and runtime-info.
 */
import type { ChildProcess } from "node:child_process";
import type { Config } from "../../config/env";
import type { Recipe, ProcessInfo } from "../models/types";
import type {
  EngineBackend,
  RuntimeBackendInfo,
  RuntimeUpgradeResult,
} from "@local-studio/contracts/system";
import type { InstallProgressUpdate } from "./runtimes/managed-venv";

export type { InstallProgressUpdate };

export interface InstallOptions {
  config: Config;
  version?: string | undefined;
  pythonPath?: string | null | undefined;
  preferBundled?: boolean | undefined;
  createManagedVenv?: boolean | undefined;
  onProgress?: ((update: InstallProgressUpdate) => void) | undefined;
  onSpawn?: ((child: ChildProcess) => void) | undefined;
}
import { vllmSpec } from "./specs/vllm-spec";
import { sglangSpec } from "./specs/sglang-spec";
import { llamacppSpec } from "./specs/llamacpp-spec";
import { mlxSpec } from "./specs/mlx-spec";

export interface BinaryProbeResult {
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  pythonPath?: string | null;
  message?: string;
}

export interface ConfigHelpResult {
  config: string | null;
  error: string | null;
}

export interface EngineSpec {
  readonly id: EngineBackend;

  /** Health endpoint path appended to the inference base URL for readiness checks. */
  readonly healthPath: string;

  /** CLI binary name in the venv bin directory (e.g. "vllm", "sglang"). Null for engines without a CLI binary. */
  readonly cliBinary: string | null;

  /**
   * Build the full command array (including binary) to serve a recipe.
   * Replaces the per-backend functions in backend-builder.ts.
   */
  buildCommand: (recipe: Recipe, config: Config) => string[];

  /**
   * Managed venv package spec for install/update (e.g. "sglang[all]", "vllm", "mlx-lm").
   * Replaces managedPackageSpec in engine-jobs.ts.
   */
  managedPackageSpec: (version?: string | null) => string;

  /**
   * Idempotent install of this backend into a target Python (when pythonPath is
   * given) or the controller-owned managed venv (when it is not). Short-circuits
   * when the backend is already present. Replaces the per-backend upgrade
   * branches in engine-jobs.ts and runtime-upgrade.ts.
   */
  install: (options: InstallOptions) => Promise<RuntimeUpgradeResult>;

  /**
   * Detect whether a process's args represent this engine's serve invocation.
   * Replaces the per-backend checks in process-utilities.detectBackend.
   */
  detectInvocation: (args: string[]) => boolean;

  /** Extract the model path from a running process's args. */
  extractModelPath: (args: string[]) => string | null;

  /** Extract the served model name from a running process's args. */
  extractServedModelName: (args: string[]) => string | null;

  /** Probe a CLI binary for version/install info. Undefined if the engine has no CLI binary. */
  probeBinary?: (binary: string) => Promise<BinaryProbeResult>;

  /** Engine-specific Python path resolver for venv discovery. */
  resolvePythonPath?: (config: Config) => string | null;

  /** Get detailed runtime info (async). Replaces the sync functions in runtime-info.ts. */
  getRuntimeInfo?: (
    config: Config,
    runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
  ) => Promise<RuntimeBackendInfo>;

  /** Get config help (--help output) for the recipe editor's command tab. */
  getConfigHelp?: (config: Config) => Promise<ConfigHelpResult>;
}

const SPECS: Record<EngineBackend, EngineSpec> = {
  vllm: vllmSpec,
  sglang: sglangSpec,
  llamacpp: llamacppSpec,
  mlx: mlxSpec,
};

export const getEngineSpec = (backend: EngineBackend): EngineSpec => SPECS[backend];

export const ALL_ENGINE_SPECS: readonly EngineSpec[] = Object.values(SPECS);

/** Detect which engine a running process belongs to, or null if unrecognized. */
export const detectEngineFromArguments = (args: string[]): EngineBackend | null => {
  for (const spec of ALL_ENGINE_SPECS) {
    if (spec.detectInvocation(args)) return spec.id;
  }
  return null;
};

export { vllmSpec, sglangSpec, llamacppSpec, mlxSpec };
