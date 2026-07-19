import type { ChildProcess } from "node:child_process";
import { Schema, type Effect } from "effect";
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

export class EngineOperationError extends Schema.TaggedErrorClass<EngineOperationError>()(
  "EngineOperationError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export interface EngineSpec {
  readonly id: EngineBackend;

  readonly healthPath: string;
  readonly cliBinary: string | null;
  buildCommand: (recipe: Recipe, config: Config) => string[];
  managedPackageSpec: (version?: string | null) => string;
  install: (options: InstallOptions) => Effect.Effect<RuntimeUpgradeResult, EngineOperationError>;
  detectInvocation: (args: string[]) => boolean;
  extractModelPath: (args: string[]) => string | null;
  extractServedModelName: (args: string[]) => string | null;
  probeBinary?: (binary: string) => Effect.Effect<BinaryProbeResult, EngineOperationError>;
  resolvePythonPath?: (config: Config) => string | null;
  getRuntimeInfo?: (
    config: Config,
    runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
  ) => Effect.Effect<RuntimeBackendInfo, EngineOperationError>;
  getConfigHelp?: (config: Config) => Effect.Effect<ConfigHelpResult, EngineOperationError>;
}

const SPECS: Record<EngineBackend, EngineSpec> = {
  vllm: vllmSpec,
  sglang: sglangSpec,
  llamacpp: llamacppSpec,
  mlx: mlxSpec,
};

export const getEngineSpec = (backend: EngineBackend): EngineSpec => SPECS[backend];

export const ALL_ENGINE_SPECS: readonly EngineSpec[] = Object.values(SPECS);

export const detectEngineFromArguments = (args: string[]): EngineBackend | null => {
  for (const spec of ALL_ENGINE_SPECS) {
    if (spec.detectInvocation(args)) return spec.id;
  }
  return null;
};

export { vllmSpec, sglangSpec, llamacppSpec, mlxSpec };
