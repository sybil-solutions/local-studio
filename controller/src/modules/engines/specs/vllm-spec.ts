import { Effect } from "effect";
import type { Config } from "../../../config/env";
import type { ProcessInfo } from "../../models/types";
import type { RuntimeBackendInfo } from "@local-studio/contracts/system";
import {
  getVllmConfigHelp,
  getVllmRuntimeInfo,
  installVllmRuntime,
} from "../runtimes/vllm-runtime";
import { normalizePackageSpec, probeVllmBinaryRuntime } from "../runtimes/runtime-target-probes";
import { resolveVllmPythonPath } from "../runtimes/vllm-python-path";
import type { BinaryProbeResult, ConfigHelpResult, EngineSpec } from "../engine-spec";


const managedPackageSpec = (version?: string | null): string =>
  normalizePackageSpec("vllm", version);

const probeBinary = (binary: string): Effect.Effect<BinaryProbeResult> =>
  probeVllmBinaryRuntime(binary).pipe(
    Effect.map((result) => ({
      installed: result.installed,
      version: result.version,
      binaryPath: result.binaryPath,
      ...(result.pythonPath ? { pythonPath: result.pythonPath } : {}),
      ...(result.message ? { message: result.message } : {}),
    })),
  );

const getRuntimeInfo = (
  _config: Config,
  _runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Effect.Effect<RuntimeBackendInfo> =>
  getVllmRuntimeInfo().pipe(
    Effect.map((info) => ({
      installed: info.installed,
      version: info.version,
      python_path: info.python_path,
      binary_path: info.vllm_bin,
      upgrade_command_available: Boolean(info.python_path),
    })),
  );

const getConfigHelp = (_config: Config): Effect.Effect<ConfigHelpResult> => getVllmConfigHelp();

export const vllmSpec: EngineSpec = {
  id: "vllm",
  cliBinary: "vllm",
  managedPackageSpec,
  install: installVllmRuntime,
  probeBinary,
  resolvePythonPath: (config: Config) => resolveVllmPythonPath(config.data_dir),
  getRuntimeInfo,
  getConfigHelp,
};
