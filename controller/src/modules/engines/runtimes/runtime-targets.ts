import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Config } from "../../../config/env";
import { loadPersistedConfig, savePersistedConfig } from "../../../config/persisted-config";
import { resolveBinary, runCommand } from "../../../core/command";
import type { ProcessInfo } from "../../models/types";
import type { EngineBackend, RuntimeBackendInfo, RuntimeTarget } from "../../shared/system-types";
import { detectBackend, listProcesses } from "../process/process-utilities";
import {
  getVllmUpgradeVersion,
  isUpgradeCommandConfigured,
  LLAMACPP_UPGRADE_ENV,
  VLLM_UPGRADE_VERSION_ENV,
} from "./upgrade-config";
import { resolveVllmPythonPath } from "./vllm-python-path";

type RuntimeTargetSource = RuntimeTarget["source"];
type RuntimeTargetKind = RuntimeTarget["kind"];
type RuntimeHealthStatus = RuntimeTarget["health"]["status"];

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

export const clearRuntimeTargetsForTests = (): void => resetRuntimeTargetsCache();

const PYTHON_VERSION_PROBES: Record<"vllm" | "sglang", string> = {
  vllm: "import json, sys\ntry:\n import vllm\n print(json.dumps({'version': vllm.__version__, 'python': sys.executable}))\nexcept Exception as e:\n print(json.dumps({'version': None, 'python': sys.executable, 'error': str(e)}))",
  sglang:
    "import json, sys\ntry:\n import sglang\n print(json.dumps({'version': getattr(sglang, '__version__', None), 'python': sys.executable}))\nexcept Exception as e:\n print(json.dumps({'version': None, 'python': sys.executable, 'error': str(e)}))",
};

const normalizeIdPart = (value: string): string =>
  Buffer.from(value).toString("base64url").replace(/=+$/g, "");

const targetId = (backend: EngineBackend, kind: RuntimeTargetKind, key: string): string =>
  `${backend}:${kind}:${normalizeIdPart(key)}`;

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

const pathExists = (path: string | null | undefined): boolean => Boolean(path && existsSync(path));

const resolvePathOrBinary = (value: string): string | null => {
  if (value.includes("/")) return existsSync(value) ? resolve(value) : null;
  return resolveBinary(value);
};

const looksLikePython = (value: string): boolean => {
  const name = basename(value);
  return /^python(?:\d+(?:\.\d+)?)?$/.test(name) || name.includes("python");
};

const splitEnvironmentList = (value: string | undefined): string[] =>
  value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

const parseCommandPython = (args: string[]): string | null => {
  const first = args[0];
  if (first && looksLikePython(first)) return resolvePathOrBinary(first) ?? first;
  const moduleIndex = args.findIndex(
    (argument) =>
      argument === "vllm.entrypoints.openai.api_server" || argument === "sglang.launch_server"
  );
  if (moduleIndex >= 2 && args[moduleIndex - 1] === "-m") {
    const candidate = args[moduleIndex - 2];
    if (candidate && looksLikePython(candidate)) return resolvePathOrBinary(candidate) ?? candidate;
  }
  return null;
};

const parseCommandBinary = (args: string[]): string | null => {
  const first = args[0];
  if (!first) return null;
  return resolvePathOrBinary(first) ?? first;
};

const createCapabilities = (target: {
  kind: RuntimeTargetKind;
  backend: EngineBackend;
  installed: boolean;
  source: RuntimeTargetSource;
  pythonPath?: string | null;
}): RuntimeTarget["capabilities"] => ({
  canLaunch: target.installed || target.source === "running",
  canUpdate:
    (target.backend === "vllm" &&
      target.installed &&
      (target.kind === "venv" || (target.kind === "system" && Boolean(target.pythonPath)))) ||
    (target.backend === "llamacpp" && isUpgradeCommandConfigured(LLAMACPP_UPGRADE_ENV)),
  canInspectOptions:
    target.backend !== "sglang" && (target.installed || target.source === "running"),
  supportsDocker: target.kind === "docker",
});

const createHealth = (
  installed: boolean,
  source: RuntimeTargetSource,
  message?: string
): RuntimeTarget["health"] => {
  let status: RuntimeHealthStatus = installed ? "ok" : "warning";
  if (source === "running") status = "ok";
  if (message && !installed && source !== "running") status = "warning";
  return message ? { status, message } : { status };
};

const RELEASE_NOTES: Record<EngineBackend, string> = {
  vllm: "https://github.com/vllm-project/vllm/releases",
  sglang: "https://github.com/sgl-project/sglang/releases",
  llamacpp: "https://github.com/ggml-org/llama.cpp/releases",
};

const packageSpecForTarget = (backend: EngineBackend): string => {
  if (backend === "vllm") {
    const target = getVllmUpgradeVersion().trim();
    return target ? `vllm==${target}` : "vllm";
  }
  if (backend === "sglang") return "sglang";
  return "configured llama.cpp upgrade command";
};

const updateMetadata = (args: {
  backend: EngineBackend;
  version?: string | null | undefined;
  capabilities: RuntimeTarget["capabilities"];
}): RuntimeTarget["update"] | undefined => {
  if (!args.capabilities.canUpdate) return undefined;
  const configuredVllmTarget = args.backend === "vllm" ? getVllmUpgradeVersion().trim() : "";
  const targetVersion =
    args.backend === "vllm" && configuredVllmTarget
      ? configuredVllmTarget
      : args.backend === "llamacpp"
        ? "configured"
        : "latest";
  return {
    currentVersion: args.version ?? null,
    targetVersion,
    packageSpec: packageSpecForTarget(args.backend),
    releaseNotesUrl: RELEASE_NOTES[args.backend],
    restartRequired: true,
    changes: [
      `${args.backend} runtime package/binary`,
      "Controller runtime target metadata after completion",
      "Running model process after restart/reload",
      ...(args.backend === "vllm" && !configuredVllmTarget
        ? [`Set ${VLLM_UPGRADE_VERSION_ENV} to pin a specific target version.`]
        : []),
    ],
  };
};

const makeTarget = (args: {
  backend: EngineBackend;
  kind: RuntimeTargetKind;
  source: RuntimeTargetSource;
  key: string;
  label: string;
  installed: boolean;
  active?: boolean;
  version?: string | null;
  pythonPath?: string | null;
  binaryPath?: string | null;
  dockerImage?: string | null;
  healthMessage?: string | undefined;
}): RuntimeTarget => {
  const base = {
    backend: args.backend,
    kind: args.kind,
    installed: args.installed,
    source: args.source,
    ...(args.pythonPath !== undefined ? { pythonPath: args.pythonPath } : {}),
  };
  const capabilities = createCapabilities(base);
  const update = updateMetadata({
    backend: args.backend,
    version: args.version,
    capabilities,
  });
  return {
    id: targetId(args.backend, args.kind, args.key),
    backend: args.backend,
    kind: args.kind,
    label: args.label,
    installed: args.installed,
    active: args.active ?? false,
    version: args.version ?? null,
    pythonPath: args.pythonPath ?? null,
    binaryPath: args.binaryPath ?? null,
    dockerImage: args.dockerImage ?? null,
    source: args.source,
    capabilities,
    health: createHealth(args.installed, args.source, args.healthMessage),
    ...(update ? { update } : {}),
  };
};

const probePythonRuntime = (
  backend: "vllm" | "sglang",
  python: string
): {
  installed: boolean;
  version: string | null;
  pythonPath: string | null;
  message?: string | undefined;
} => {
  const check = runCommand(python, ["--version"], 2_000);
  if (check.status !== 0) {
    return {
      installed: false,
      version: null,
      pythonPath: pathExists(python) ? resolve(python) : python,
      message: "Python executable is not runnable",
    };
  }
  const result = runCommand(python, ["-c", PYTHON_VERSION_PROBES[backend]], 5_000);
  if (result.status !== 0) {
    return {
      installed: false,
      version: null,
      pythonPath: python,
      message: result.stderr || `${backend} import probe failed`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      version?: string | null;
      python?: string | null;
      error?: string;
    };
    return {
      installed: Boolean(parsed.version),
      version: parsed.version ?? null,
      pythonPath: parsed.python ?? python,
      message: parsed.version
        ? undefined
        : (parsed.error ?? `${backend} is not installed in this Python`),
    };
  } catch {
    return {
      installed: false,
      version: null,
      pythonPath: python,
      message: "Unable to parse runtime probe output",
    };
  }
};

const parseLlamaVersion = (output: string): string | null => {
  const match = output.match(/version\s*[:=]\s*(\d+\s*\([^)]+\)|\S+)/i);
  return match?.[1]?.trim() ?? output.split("\n")[0]?.trim() ?? null;
};

const parsePackageVersion = (output: string): string | null => {
  const match = output.match(/\b\d+(?:\.\d+){1,3}(?:[A-Za-z0-9.+-]*)?\b/);
  return match?.[0] ?? null;
};

const compareVersions = (left: string | null, right: string | null): number => {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  const leftParts = left.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const resolvePythonFromScript = (scriptPath: string | null | undefined): string | null => {
  if (!scriptPath || !existsSync(scriptPath)) return null;
  try {
    const firstLine = readFileSync(scriptPath, "utf8").split("\n")[0]?.trim() ?? "";
    if (!firstLine.startsWith("#!")) return null;
    const parts = firstLine.slice(2).trim().split(/\s+/);
    const executable = parts[0];
    const envPython = executable?.endsWith("/env")
      ? parts.find((part) => part.startsWith("python"))
      : null;
    const python = envPython ?? executable;
    if (!python || !python.includes("python")) return null;
    return resolvePathOrBinary(python) ?? python;
  } catch {
    return null;
  }
};

const probeBinaryRuntime = (
  binary: string
): {
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  message?: string;
} => {
  const resolved = resolvePathOrBinary(binary);
  const command = resolved ?? binary;
  const version = runCommand(command, ["--version"], 3_000);
  if (version.status === 0) {
    return {
      installed: true,
      version: parseLlamaVersion(version.stdout) ?? parseLlamaVersion(version.stderr),
      binaryPath: resolved ?? command,
    };
  }
  const help = runCommand(command, ["--help"], 3_000);
  if (help.status === 0) {
    return {
      installed: true,
      version: parseLlamaVersion(help.stdout) ?? parseLlamaVersion(help.stderr),
      binaryPath: resolved ?? command,
    };
  }
  return {
    installed: false,
    version: null,
    binaryPath: resolved,
    message: version.stderr || "Binary is not runnable",
  };
};

const probeVllmBinaryRuntime = (
  binary: string
): {
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  pythonPath: string | null;
  message?: string;
} => {
  const resolved = resolvePathOrBinary(binary);
  const command = resolved ?? binary;
  const version = runCommand(command, ["--version"], 3_000);
  const pythonPath = resolvePythonFromScript(resolved ?? command);
  if (version.status === 0) {
    return {
      installed: true,
      version:
        parsePackageVersion(version.stdout) ??
        parsePackageVersion(version.stderr) ??
        parseLlamaVersion(version.stdout) ??
        parseLlamaVersion(version.stderr),
      binaryPath: resolved ?? command,
      pythonPath,
    };
  }
  return {
    installed: false,
    version: null,
    binaryPath: resolved,
    pythonPath,
    message: version.stderr || "vLLM binary is not runnable",
  };
};

const addTarget = (targets: RuntimeTarget[], target: RuntimeTarget): void => {
  const existingIndex = targets.findIndex((candidate) => candidate.id === target.id);
  if (existingIndex === -1) {
    targets.push(target);
    return;
  }
  const existing = targets[existingIndex];
  if (!existing) return;
  targets[existingIndex] = {
    ...existing,
    ...target,
    active: existing.active || target.active,
    installed: existing.installed || target.installed,
    version: existing.version ?? target.version,
    health: existing.health.status === "ok" ? existing.health : target.health,
    source: existing.source === "running" ? existing.source : target.source,
  };
};

const collectRunningTargets = (runningProcess?: ProcessInfo | null): RuntimeTarget[] => {
  const targets: RuntimeTarget[] = [];
  const processEntries = listProcesses();
  const activePid = runningProcess?.pid ?? null;
  for (const entry of processEntries) {
    const backend = detectBackend(entry.args);
    if (backend !== "vllm" && backend !== "sglang" && backend !== "llamacpp") continue;
    const pythonPath = backend === "llamacpp" ? null : parseCommandPython(entry.args);
    const binaryPath = backend === "llamacpp" ? parseCommandBinary(entry.args) : null;
    const key = pythonPath ?? binaryPath ?? `${entry.pid}:${entry.args.join(" ")}`;
    addTarget(
      targets,
      makeTarget({
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

const collectPythonTargets = (
  backend: "vllm" | "sglang",
  config: Config,
  runningProcess?: ProcessInfo | null
): RuntimeTarget[] => {
  const targets: RuntimeTarget[] = [];
  const running = collectRunningTargets(runningProcess).filter(
    (target) => target.backend === backend
  );
  for (const target of running) addTarget(targets, target);

  const configured =
    backend === "vllm"
      ? [
          process.env["VLLM_STUDIO_RUNTIME_PYTHON"],
          ...splitEnvironmentList(process.env["VLLM_STUDIO_VLLM_PYTHONS"]),
          ...splitEnvironmentList(process.env["VLLM_STUDIO_RUNTIME_PYTHONS"]),
        ]
      : [config.sglang_python, ...splitEnvironmentList(process.env["VLLM_STUDIO_SGLANG_PYTHONS"])];
  for (const candidate of unique(configured)) {
    const probe = probePythonRuntime(backend, candidate);
    addTarget(
      targets,
      makeTarget({
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

  const projectManaged =
    backend === "vllm"
      ? unique([resolveVllmPythonPath(), ...collectVenvPythonFiles(config)])
      : unique([config.sglang_python, resolveVllmPythonPath(), ...collectVenvPythonFiles(config)]);
  for (const candidate of projectManaged) {
    const probe = probePythonRuntime(backend, candidate);
    addTarget(
      targets,
      makeTarget({
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
    process.env["VLLM_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1"
      ? null
      : (resolveBinary("python3") ?? resolveBinary("python"));
  if (systemPython) {
    const probe = probePythonRuntime(backend, systemPython);
    addTarget(
      targets,
      makeTarget({
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

  if (backend === "vllm") {
    const binary =
      process.env["VLLM_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1" ? null : resolveBinary("vllm");
    if (binary) {
      const probe = probeVllmBinaryRuntime(binary);
      addTarget(
        targets,
        makeTarget({
          backend,
          kind: "system",
          source: "discovered",
          key: binary,
          label: "vLLM system binary",
          installed: probe.installed,
          version: probe.version,
          pythonPath: probe.pythonPath,
          binaryPath: probe.binaryPath,
          healthMessage: probe.message,
        })
      );
    }
  }

  return targets;
};

const collectLlamacppTargets = (
  config: Config,
  runningProcess?: ProcessInfo | null
): RuntimeTarget[] => {
  const targets: RuntimeTarget[] = [];
  const running = collectRunningTargets(runningProcess).filter(
    (target) => target.backend === "llamacpp"
  );
  for (const target of running) addTarget(targets, target);

  for (const candidate of unique([config.llama_bin])) {
    const probe = probeBinaryRuntime(candidate);
    addTarget(
      targets,
      makeTarget({
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
    process.env["VLLM_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1" ? null : resolveBinary("llama-server");
  if (systemBinary) {
    const probe = probeBinaryRuntime(systemBinary);
    addTarget(
      targets,
      makeTarget({
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
  if (process.env["VLLM_STUDIO_RUNTIME_SKIP_DOCKER"] === "1") return [];
  const docker = resolveBinary("docker");
  if (!docker) return [];
  const targets: RuntimeTarget[] = [];
  const patterns: Record<EngineBackend, RegExp> = {
    vllm: /(^|[/:_-])vllm($|[/:_-])/i,
    sglang: /(^|[/:_-])sglang($|[/:_-])/i,
    llamacpp: /(llama\.cpp|llamacpp|llama-server)/i,
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
        makeTarget({
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
        makeTarget({
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
        makeTarget({
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
  const backendOrder: Record<EngineBackend, number> = { vllm: 0, sglang: 1, llamacpp: 2 };
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
  const backends: EngineBackend[] = ["vllm", "sglang", "llamacpp"];
  const targets: RuntimeTarget[] = [];
  for (const backend of backends) {
    const backendTargets =
      backend === "llamacpp"
        ? collectLlamacppTargets(config, runningProcess)
        : collectPythonTargets(backend, config, runningProcess);
    for (const target of backendTargets) addTarget(targets, target);
    for (const target of collectDockerTargets(backend)) addTarget(targets, target);
    for (const target of collectBundledTargets(backend)) addTarget(targets, target);
  }
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
