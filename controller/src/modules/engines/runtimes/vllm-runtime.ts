import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveBinary, runCommandAsync } from "../../../core/command";
import { resolveVllmPythonPath } from "./vllm-python-path";
import {
  getUpgradeCommandFromEnvironment,
  getVllmUpgradeVersion,
  runEnvironmentUpgradeCommand,
  VLLM_UPGRADE_ENV,
} from "./upgrade-config";
import { VLLM_UPGRADE_TIMEOUT_MS, ENGINE_INSTALL_TIMEOUT_MS } from "../configs";
import { installIntoManagedVenv, venvConsoleScriptPath } from "./managed-venv";
import {
  normalizePackageSpec,
  probeBackendRuntime,
  resolvePythonFromScript,
} from "./runtime-target-probes";
import type { InstallOptions } from "../engine-spec";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";

const resolveVllmUpgradeTarget = (version?: string): string =>
  normalizePackageSpec("vllm", version?.trim() || getVllmUpgradeVersion());

const collectPythonCandidates = (): Array<string | null> => {
  const skipSystem = process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1";
  return [
    process.env["LOCAL_STUDIO_RUNTIME_PYTHON"] ?? null,
    skipSystem ? null : resolvePythonFromScript(resolveBinary("vllm")),
    resolveVllmPythonPath(),
    ...(skipSystem ? [] : ["python3", "python"]),
  ];
};

const resolvePythonBinary = async (): Promise<string | null> => {
  for (const candidate of collectPythonCandidates()) {
    if (!candidate) continue;
    const result = await runCommandAsync(candidate, ["--version"], { timeoutMs: 2_000 });
    if (result.status === 0) return candidate;
  }
  return null;
};

const resolveBundledWheel = (): { path: string; version: string | null } | null => {
  const runtimeDirectory = resolve(process.cwd(), "runtime", "wheels");
  if (!existsSync(runtimeDirectory)) return null;
  const candidates = readdirSync(runtimeDirectory).filter(
    (file) => file.startsWith("vllm-") && file.endsWith(".whl"),
  );
  if (candidates.length === 0) return null;
  const withStats = candidates
    .map((file) => {
      const fullPath = join(runtimeDirectory, file);
      return { file, fullPath, mtime: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const latest = withStats[0];
  if (!latest) return null;
  const versionMatch = latest.file.match(/^vllm-([0-9A-Za-z.+-]+)-/);
  return { path: latest.fullPath, version: versionMatch?.[1] ?? null };
};

const resolveVllmBinary = (pythonPath: string | null): string | null => {
  if (pythonPath) {
    const vllmBin = venvConsoleScriptPath(pythonPath, "vllm");
    if (existsSync(vllmBin)) return vllmBin;
  }
  return resolveBinary("vllm");
};

export const getVllmRuntimeInfo = async (): Promise<{
  installed: boolean;
  version: string | null;
  python_path: string | null;
  vllm_bin: string | null;
  upgrade_command_available: boolean;
  bundled_wheel: { path: string; version: string | null } | null;
}> => {
  const bundledWheel = resolveBundledWheel();
  const probe = await probeBackendRuntime("vllm", collectPythonCandidates());
  return {
    installed: probe.installed,
    version: probe.version,
    python_path: probe.pythonPath,
    vllm_bin: resolveVllmBinary(probe.pythonPath),
    upgrade_command_available: Boolean(probe.pythonPath && probe.runnable),
    bundled_wheel: bundledWheel,
  };
};

export const getVllmConfigHelp = async (): Promise<{
  config: string | null;
  error: string | null;
}> => {
  const pythonPath = await resolvePythonBinary();
  const vllmBin = resolveVllmBinary(pythonPath);
  if (!pythonPath && !vllmBin) return { config: null, error: "vLLM runtime not available" };
  const command = vllmBin ?? pythonPath ?? "";
  const args = vllmBin
    ? ["serve", "--help"]
    : ["-m", "vllm.entrypoints.openai.api_server", "--help"];
  const result = await runCommandAsync(command, args, { timeoutMs: 5_000 });
  if (result.status !== 0)
    return { config: result.stdout || null, error: result.stderr || "Failed to fetch vLLM config" };
  return { config: result.stdout || null, error: null };
};

export const installVllmRuntime = async (
  options: InstallOptions,
): Promise<RuntimeUpgradeResult> => {
  const envCommand = getUpgradeCommandFromEnvironment(VLLM_UPGRADE_ENV);
  if (envCommand) {
    return runEnvironmentUpgradeCommand(envCommand, options.onSpawn, VLLM_UPGRADE_TIMEOUT_MS);
  }

  const preferBundled = options.preferBundled !== false;
  const bundledWheel = preferBundled ? resolveBundledWheel() : null;
  const packageSpec = bundledWheel ? bundledWheel.path : resolveVllmUpgradeTarget(options.version);

  const installTimeoutMs = options.pythonPath ? VLLM_UPGRADE_TIMEOUT_MS : ENGINE_INSTALL_TIMEOUT_MS;
  return installIntoManagedVenv({
    config: options.config,
    backend: "vllm",
    packageSpec,
    pythonPath: options.pythonPath ?? null,
    createManagedVenv: !options.pythonPath,
    installTimeoutMs,
    onProgress: options.onProgress,
    onSpawn: options.onSpawn,
  });
};
