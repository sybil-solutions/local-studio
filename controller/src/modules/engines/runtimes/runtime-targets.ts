import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Config } from "../../../config/env";
import { loadPersistedConfig, savePersistedConfig } from "../../../config/persisted-config";
import { resolveBinary, runCommand } from "../../../core/command";
import type { ProcessInfo } from "../../models/types";
import type { EngineBackend, RuntimeBackendInfo, RuntimeTarget } from "../../shared/system-types";
import { detectBackend, listProcesses } from "../process/process-utilities";
import { makeRuntimeTarget } from "./runtime-target-factory";
import {
  compareVersions,
  parseCommandBinary,
  parseCommandPython,
  probeBinaryRuntime,
  probePythonRuntime,
  splitEnvironmentList,
} from "./runtime-target-probes";
import { getEngineSpec } from "../engine-spec";
import type { BinaryProbeResult } from "../engine-spec";

const ENGINE_LABEL_FOR_BACKEND: Record<string, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  mlx: "MLX",
};

const TARGET_CACHE_TTL_MS = 300_000;
let targetsCache: {
  expiresAt: number;
  configDataDirectory: string;
  value: RuntimeTarget[];
} | null = null;

const resetRuntimeTargetsCache = (): void => {
  targetsCache = null;
};

export const clearRuntimeTargetsCache = (): void => resetRuntimeTargetsCache();

const unique = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const sourcePriority = (source: RuntimeTarget["source"]): number => {
  if (source === "running") return 4;
  if (source === "configured") return 3;
  if (source === "bundled") return 2;
  return 1;
};

const addTarget = (targets: RuntimeTarget[], target: RuntimeTarget): void => {
  const existingIndex = targets.findIndex((candidate) => candidate.id === target.id);
  if (existingIndex === -1) {
    targets.push(target);
    return;
  }
  const existing = targets[existingIndex];
  if (!existing) return;
  const keepExistingSource = sourcePriority(existing.source) >= sourcePriority(target.source);
  targets[existingIndex] = {
    ...existing,
    ...target,
    label: keepExistingSource ? existing.label : target.label,
    active: existing.active || target.active,
    installed: existing.installed || target.installed,
    version: existing.version ?? target.version,
    health: existing.health.status === "ok" ? existing.health : target.health,
    source: keepExistingSource ? existing.source : target.source,
  };
};

const collectRunningTargets = (runningProcess?: ProcessInfo | null): RuntimeTarget[] => {
  const targets: RuntimeTarget[] = [];
  const processEntries = listProcesses();
  const activePid = runningProcess?.pid ?? null;
  for (const entry of processEntries) {
    const backend = detectBackend(entry.args);
    if (backend !== "vllm" && backend !== "sglang" && backend !== "llamacpp" && backend !== "mlx")
      continue;
    const pythonPath = backend === "llamacpp" ? null : parseCommandPython(entry.args);
    const binaryPath = backend === "llamacpp" ? parseCommandBinary(entry.args) : null;
    const key = pythonPath ?? binaryPath ?? `${entry.pid}:${entry.args.join(" ")}`;
    addTarget(
      targets,
      makeRuntimeTarget({
        backend,
        kind: pythonPath ? "venv" : "binary",
        source: "running",
        key,
        label: `${backend} running (${basename(key)})`,
        installed: true,
        active: activePid !== null && entry.pid === activePid,
        pythonPath,
        binaryPath,
      })
    );
  }
  return targets;
};

const collectVenvPythonFiles = (config: Config): string[] => {
  const roots = unique([
    resolve(process.cwd(), "runtime", "venvs"),
    resolve(process.cwd(), "venvs"),
    resolve(process.cwd(), ".venv"),
    resolve(config.data_dir, "runtime", "venvs"),
    resolve(config.data_dir, "venvs"),
    "/opt/venvs/active",
    "/opt/venvs",
  ]);
  const candidates: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const stats = statSync(root);
      if (stats.isDirectory() && existsSync(join(root, "bin", "python"))) {
        candidates.push(join(root, "bin", "python"));
      }
      if (!stats.isDirectory()) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const python = join(root, entry.name, "bin", "python");
        if (existsSync(python)) candidates.push(python);
      }
    } catch {
      continue;
    }
  }
  return candidates;
};

// Probes independent candidates concurrently; the returned pairs preserve
// candidate order so addTarget keeps its order-dependent dedupe behavior.
const probePythonCandidates = (
  backend: "vllm" | "sglang" | "mlx",
  candidates: string[]
): Promise<Array<{ candidate: string; probe: Awaited<ReturnType<typeof probePythonRuntime>> }>> =>
  Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      probe: await probePythonRuntime(backend, candidate),
    }))
  );

const collectPythonTargets = async (
  backend: "vllm" | "sglang" | "mlx",
  config: Config,
  runningProcess?: ProcessInfo | null
): Promise<RuntimeTarget[]> => {
  const targets: RuntimeTarget[] = [];
  const running = collectRunningTargets(runningProcess).filter(
    (target) => target.backend === backend
  );
  for (const target of running) addTarget(targets, target);

  const configured =
    backend === "vllm"
      ? [
          process.env["LOCAL_STUDIO_RUNTIME_PYTHON"],
          ...splitEnvironmentList(process.env["LOCAL_STUDIO_VLLM_PYTHONS"]),
          ...splitEnvironmentList(process.env["LOCAL_STUDIO_RUNTIME_PYTHONS"]),
        ]
      : backend === "sglang"
        ? [config.sglang_python, ...splitEnvironmentList(process.env["LOCAL_STUDIO_SGLANG_PYTHONS"])]
        : [config.mlx_python, ...splitEnvironmentList(process.env["LOCAL_STUDIO_MLX_PYTHONS"])];
  for (const { candidate, probe } of await probePythonCandidates(backend, unique(configured))) {
    addTarget(
      targets,
      makeRuntimeTarget({
        backend,
        kind: "venv",
        source: "configured",
        key: probe.pythonPath ?? candidate,
        label: `${backend} configured (${basename(probe.pythonPath ?? candidate)})`,
        installed: probe.installed,
        version: probe.version,
        pythonPath: probe.pythonPath ?? candidate,
        healthMessage: probe.message,
      })
    );
  }

  const enginePythonPath = getEngineSpec(backend).resolvePythonPath?.() ?? null;
  const projectManaged =
    backend === "vllm"
      ? unique([enginePythonPath, ...collectVenvPythonFiles(config)])
      : unique([
          backend === "sglang" ? config.sglang_python : config.mlx_python,
          enginePythonPath,
          ...collectVenvPythonFiles(config),
        ]);
  for (const { candidate, probe } of await probePythonCandidates(backend, projectManaged)) {
    addTarget(
      targets,
      makeRuntimeTarget({
        backend,
        kind: "venv",
        source: "discovered",
        key: probe.pythonPath ?? candidate,
        label: `${backend} venv (${basename(dirname(dirname(probe.pythonPath ?? candidate)))})`,
        installed: probe.installed,
        version: probe.version,
        pythonPath: probe.pythonPath ?? candidate,
        healthMessage: probe.message,
      })
    );
  }

  const systemPython =
    process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1"
      ? null
      : (resolveBinary("python3") ?? resolveBinary("python"));
  if (systemPython) {
    const probe = await probePythonRuntime(backend, systemPython);
    addTarget(
      targets,
      makeRuntimeTarget({
        backend,
        kind: "system",
        source: "discovered",
        key: probe.pythonPath ?? systemPython,
        label: `${backend} system Python`,
        installed: probe.installed,
        version: probe.version,
        pythonPath: probe.pythonPath ?? systemPython,
        healthMessage: probe.message,
      })
    );
  }

  // Probe CLI binary (vllm, sglang) using the engine spec's probeBinary.
  const spec = getEngineSpec(backend);
  if (spec.cliBinary && spec.probeBinary) {
    const binary =
      process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1" ? null : resolveBinary(spec.cliBinary);
    if (binary) {
      const probe: BinaryProbeResult = await spec.probeBinary(binary);
      addTarget(
        targets,
        makeRuntimeTarget({
          backend,
          kind: "system",
          source: "discovered",
          key: binary,
          label: `${ENGINE_LABEL_FOR_BACKEND[backend]} system binary`,
          installed: probe.installed,
          version: probe.version,
          pythonPath: probe.pythonPath ?? null,
          binaryPath: probe.binaryPath,
          healthMessage: probe.message,
        })
      );
    }
  }

  return targets;
};

const collectLlamacppTargets = async (
  config: Config,
  runningProcess?: ProcessInfo | null
): Promise<RuntimeTarget[]> => {
  const targets: RuntimeTarget[] = [];
  const running = collectRunningTargets(runningProcess).filter(
    (target) => target.backend === "llamacpp"
  );
  for (const target of running) addTarget(targets, target);

  for (const candidate of unique([config.llama_bin])) {
    const probe = await probeBinaryRuntime(candidate);
    addTarget(
      targets,
      makeRuntimeTarget({
        backend: "llamacpp",
        kind: candidate.includes("/") ? "binary" : "system",
        source: "configured",
        key: probe.binaryPath ?? candidate,
        label: `llama.cpp configured (${basename(probe.binaryPath ?? candidate)})`,
        installed: probe.installed,
        version: probe.version,
        binaryPath: probe.binaryPath,
        healthMessage: probe.message,
      })
    );
  }

  const systemBinary =
    process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1" ? null : resolveBinary("llama-server");
  if (systemBinary) {
    const probe = await probeBinaryRuntime(systemBinary);
    addTarget(
      targets,
      makeRuntimeTarget({
        backend: "llamacpp",
        kind: "system",
        source: "discovered",
        key: probe.binaryPath ?? systemBinary,
        label: "llama.cpp system binary",
        installed: probe.installed,
        version: probe.version,
        binaryPath: probe.binaryPath,
        healthMessage: probe.message,
      })
    );
  }
  return targets;
};

const collectDockerTargets = (backend: EngineBackend): RuntimeTarget[] => {
  if (process.env["LOCAL_STUDIO_RUNTIME_SKIP_DOCKER"] === "1") return [];
  const docker = resolveBinary("docker");
  if (!docker) return [];
  const targets: RuntimeTarget[] = [];
  const patterns: Record<EngineBackend, RegExp> = {
    vllm: /(^|[/:_-])vllm($|[/:_-])/i,
    sglang: /(^|[/:_-])sglang($|[/:_-])/i,
    llamacpp: /(llama\.cpp|llamacpp|llama-server)/i,
    mlx: /(mlx-lm|mlx_lm|mlx)/i,
  };
  const imageResult = runCommand(docker, ["images", "--format", "{{.Repository}}:{{.Tag}}"], 3_000);
  if (imageResult.status === 0) {
    for (const image of imageResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)) {
      if (!patterns[backend].test(image)) continue;
      addTarget(
        targets,
        makeRuntimeTarget({
          backend,
          kind: "docker",
          source: "discovered",
          key: image,
          label: `${backend} Docker image (${image})`,
          installed: true,
          dockerImage: image,
        })
      );
    }
  }
  const psResult = runCommand(docker, ["ps", "--format", "{{.Image}}"], 3_000);
  if (psResult.status === 0) {
    for (const image of psResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)) {
      if (!patterns[backend].test(image)) continue;
      addTarget(
        targets,
        makeRuntimeTarget({
          backend,
          kind: "docker",
          source: "running",
          key: image,
          label: `${backend} running Docker (${image})`,
          installed: true,
          active: true,
          dockerImage: image,
        })
      );
    }
  }
  return targets;
};

const collectBundledTargets = (backend: EngineBackend): RuntimeTarget[] => {
  if (backend !== "vllm") return [];
  const wheelRoot = resolve(process.cwd(), "runtime", "wheels");
  if (!existsSync(wheelRoot)) return [];
  const targets: RuntimeTarget[] = [];
  try {
    for (const file of readdirSync(wheelRoot)) {
      if (!file.startsWith("vllm-") || !file.endsWith(".whl")) continue;
      const fullPath = join(wheelRoot, file);
      const version = file.match(/^vllm-([0-9A-Za-z.+-]+)-/)?.[1] ?? null;
      addTarget(
        targets,
        makeRuntimeTarget({
          backend,
          kind: "binary",
          source: "bundled",
          key: fullPath,
          label: `vLLM bundled wheel (${version ?? file})`,
          installed: true,
          version,
          binaryPath: fullPath,
        })
      );
    }
  } catch {
    return [];
  }
  return targets;
};

const withSelection = (targets: RuntimeTarget[], config: Config): RuntimeTarget[] => {
  const persisted = loadPersistedConfig(config.data_dir);
  const selectedIds = persisted.selected_runtime_target_ids ?? {};
  return targets.map((target) => ({
    ...target,
    active: target.active || selectedIds[target.backend] === target.id,
  }));
};

const sortTargets = (targets: RuntimeTarget[]): RuntimeTarget[] => {
  const backendOrder: Record<EngineBackend, number> = { vllm: 0, sglang: 1, llamacpp: 2, mlx: 3 };
  return [...targets].sort(
    (first, second) =>
      backendOrder[first.backend] - backendOrder[second.backend] ||
      Number(second.active) - Number(first.active) ||
      Number(second.installed) - Number(first.installed) ||
      compareVersions(second.version, first.version) ||
      first.label.localeCompare(second.label)
  );
};

export const getRuntimeTargets = async (
  config: Config,
  runningProcess?: ProcessInfo | null
): Promise<RuntimeTarget[]> => {
  const now = Date.now();
  if (
    targetsCache &&
    targetsCache.expiresAt > now &&
    targetsCache.configDataDirectory === config.data_dir
  ) {
    return targetsCache.value;
  }
  const backends: EngineBackend[] = ["vllm", "sglang", "llamacpp", "mlx"];
  const targets: RuntimeTarget[] = [];
  // Probe backends concurrently, but merge in the fixed backend order so
  // addTarget's order-dependent dedupe/priority behavior is unchanged.
  const backendTargetGroups = await Promise.all(
    backends.map((backend) =>
      backend === "llamacpp"
        ? collectLlamacppTargets(config, runningProcess)
        : collectPythonTargets(backend, config, runningProcess)
    )
  );
  backends.forEach((backend, index) => {
    for (const target of backendTargetGroups[index] ?? []) addTarget(targets, target);
    for (const target of collectDockerTargets(backend)) addTarget(targets, target);
    for (const target of collectBundledTargets(backend)) addTarget(targets, target);
  });
  const selectedTargets = sortTargets(withSelection(targets, config));
  targetsCache = {
    expiresAt: now + TARGET_CACHE_TTL_MS,
    configDataDirectory: config.data_dir,
    value: selectedTargets,
  };
  return selectedTargets;
};

export const getRuntimeTarget = async (
  config: Config,
  targetIdValue: string,
  runningProcess?: ProcessInfo | null
): Promise<RuntimeTarget | null> => {
  const targets = await getRuntimeTargets(config, runningProcess);
  return targets.find((target) => target.id === targetIdValue) ?? null;
};

export const selectRuntimeTarget = async (
  config: Config,
  targetIdValue: string,
  runningProcess?: ProcessInfo | null
): Promise<RuntimeTarget | null> => {
  const target = await getRuntimeTarget(config, targetIdValue, runningProcess);
  if (!target) return null;
  const persisted = loadPersistedConfig(config.data_dir);
  savePersistedConfig(config.data_dir, {
    selected_runtime_target_ids: {
      ...(persisted.selected_runtime_target_ids ?? {}),
      [target.backend]: target.id,
    },
  });
  targetsCache = null;
  return { ...target, active: true };
};

export const getDefaultRuntimeTarget = async (
  config: Config,
  backend: EngineBackend,
  runningProcess?: ProcessInfo | null
): Promise<RuntimeTarget | null> => {
  const targets = (await getRuntimeTargets(config, runningProcess)).filter(
    (target) => target.backend === backend
  );
  const newestInstalled = targets
    .filter((target) => target.installed)
    .sort((first, second) => compareVersions(second.version, first.version))[0];
  return (
    targets.find((target) => target.active) ??
    newestInstalled ??
    targets.find((target) => target.source === "configured") ??
    targets[0] ??
    null
  );
};

export const runtimeTargetToBackendInfo = (target: RuntimeTarget | null): RuntimeBackendInfo => ({
  installed: target?.installed ?? false,
  version: target?.version ?? null,
  python_path: target?.pythonPath ?? null,
  binary_path: target?.binaryPath ?? null,
  upgrade_command_available: target?.capabilities.canUpdate ?? false,
});
