import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveBinary } from "../../../core/command";
import { resolveVllmPythonPath } from "./vllm-python-path";
import {
  getUpgradeCommandFromEnvironment,
  getVllmUpgradeVersion,
  VLLM_UPGRADE_ENV,
} from "./upgrade-config";
import { VLLM_RUNTIME_COMMAND_TIMEOUT_MS, VLLM_UPGRADE_TIMEOUT_MS } from "../configs";

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const parseCommandInput = (args: unknown): string[] | null => {
  if (!Array.isArray(args)) return null;
  const parsed = args
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : null;
};

const resolveVllmUpgradeTarget = (version?: string): string => {
  const configured =
    version && version.trim().length > 0 ? version.trim() : getVllmUpgradeVersion();
  const normalized = configured.trim();
  if (!normalized) return "vllm";
  return normalized.includes("==") || normalized.endsWith(".whl")
    ? normalized
    : `vllm==${normalized}`;
};

const resolveVllmUpgradeCommand = (
  pythonPath: string,
  version: string,
  preferBundled: boolean,
  bundledWheel: { path: string; version: string | null } | null
): { command: string; args: string[] } => {
  if (preferBundled) {
    if (bundledWheel) {
      if (resolveBinary("uv")) {
        return {
          command: "uv",
          args: ["pip", "install", "--python", pythonPath, "--upgrade", bundledWheel.path],
        };
      }
      return {
        command: pythonPath,
        args: ["-m", "pip", "install", "--upgrade", bundledWheel.path],
      };
    }
  }
  const packageSpec = resolveVllmUpgradeTarget(version);
  if (resolveBinary("uv")) {
    return {
      command: "uv",
      args: ["pip", "install", "--python", pythonPath, "--upgrade", packageSpec],
    };
  }
  return { command: pythonPath, args: ["-m", "pip", "install", "--upgrade", packageSpec] };
};

const runCommand = (
  command: string,
  args: string[],
  timeoutMs = VLLM_RUNTIME_COMMAND_TIMEOUT_MS
): Promise<CommandResult> => {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ code: null, stdout: stdout.trim(), stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
};

const resolvePythonFromScript = (scriptPath: string | null | undefined): string | null => {
  if (!scriptPath || !existsSync(scriptPath)) return null;
  try {
    const firstLine = readFileSync(scriptPath, "utf8").split("\n")[0]?.trim() ?? "";
    if (!firstLine.startsWith("#!")) return null;
    const command = firstLine.slice(2).trim().split(/\s+/);
    const executable = command[0];
    const envPython = executable?.endsWith("/env") ? command.find((part) => part.startsWith("python")) : null;
    const python = envPython ?? executable;
    if (!python || !python.includes("python")) return null;
    return python.includes("/") ? python : (resolveBinary(python) ?? python);
  } catch {
    return null;
  }
};

const resolvePythonBinary = (preferredPython?: string | null): string | null => {
  const candidates: string[] = [];
  if (preferredPython) candidates.push(preferredPython);
  const override = process.env["VLLM_STUDIO_RUNTIME_PYTHON"];
  if (override) candidates.push(override);
  const systemVllmPython = resolvePythonFromScript(resolveBinary("vllm"));
  if (systemVllmPython) candidates.push(systemVllmPython);
  const runtimePython = resolveVllmPythonPath();
  if (runtimePython) candidates.push(runtimePython);
  candidates.push("python3", "python");
  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ["--version"], { timeout: 2000 });
      if (result.status === 0) return candidate;
    } catch {
      continue;
    }
  }
  return null;
};

const collectPythonCandidates = (preferredPython?: string | null): string[] => {
  const candidates: string[] = [];
  if (preferredPython) candidates.push(preferredPython);
  const override = process.env["VLLM_STUDIO_RUNTIME_PYTHON"];
  if (override) candidates.push(override);
  const systemVllmPython = resolvePythonFromScript(resolveBinary("vllm"));
  if (systemVllmPython) candidates.push(systemVllmPython);
  const runtimePython = resolveVllmPythonPath();
  if (runtimePython) candidates.push(runtimePython);
  candidates.push("python3", "python");
  return candidates.filter((c, index, array) => array.indexOf(c) === index);
};

const resolveBundledWheel = (): { path: string; version: string | null } | null => {
  const runtimeDirectory = resolve(process.cwd(), "runtime", "wheels");
  if (!existsSync(runtimeDirectory)) return null;
  const candidates = readdirSync(runtimeDirectory).filter(
    (file) => file.startsWith("vllm-") && file.endsWith(".whl")
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
    const vllmBin = join(dirname(pythonPath), "vllm");
    if (existsSync(vllmBin)) return vllmBin;
  }
  return resolveBinary("vllm");
};

const VLLM_IMPORT_PROBE =
  "import json, sys\ntry:\n import vllm\n print(json.dumps({'version': vllm.__version__, 'python': sys.executable}))\nexcept Exception:\n print(json.dumps({'version': None, 'python': sys.executable}))";

export const getVllmRuntimeInfo = async (preferredPython?: string | null): Promise<{
  installed: boolean;
  version: string | null;
  python_path: string | null;
  vllm_bin: string | null;
  upgrade_command_available: boolean;
  bundled_wheel: { path: string; version: string | null } | null;
}> => {
  const bundledWheel = resolveBundledWheel();
  const candidates = collectPythonCandidates(preferredPython);
  for (const candidate of candidates) {
    try {
      const check = spawnSync(candidate, ["--version"], { timeout: 2000 });
      if (check.status !== 0) continue;
    } catch {
      continue;
    }
    const result = await runCommand(candidate, ["-c", VLLM_IMPORT_PROBE]);
    if (result.code !== 0) continue;
    let parsed: { version?: string | null; python?: string | null } | null = null;
    try {
      parsed = JSON.parse(result.stdout) as { version?: string | null; python?: string | null };
    } catch {
      continue;
    }
    if (parsed?.version) {
      const vllmBin = resolveVllmBinary(parsed.python ?? candidate);
      return {
        installed: true,
        version: parsed.version,
        python_path: parsed.python ?? candidate,
        vllm_bin: vllmBin,
        upgrade_command_available: true,
        bundled_wheel: bundledWheel,
      };
    }
  }
  const fallbackPython = resolvePythonBinary();
  const vllmBin = resolveVllmBinary(fallbackPython);
  return {
    installed: false,
    version: null,
    python_path: fallbackPython,
    vllm_bin: vllmBin,
    upgrade_command_available: Boolean(fallbackPython),
    bundled_wheel: bundledWheel,
  };
};

export const getVllmConfigHelp = async (): Promise<{
  config: string | null;
  error: string | null;
}> => {
  const pythonPath = resolvePythonBinary();
  const vllmBin = resolveVllmBinary(pythonPath);
  if (!pythonPath && !vllmBin) return { config: null, error: "vLLM runtime not available" };
  const command = vllmBin ?? pythonPath ?? "";
  const args = vllmBin
    ? ["serve", "--help"]
    : ["-m", "vllm.entrypoints.openai.api_server", "--help"];
  const result = await runCommand(command, args, 15_000);
  if (result.code !== 0)
    return { config: result.stdout || null, error: result.stderr || "Failed to fetch vLLM config" };
  return { config: result.stdout || null, error: null };
};

type VllmUpgradeOptions = {
  preferBundled?: boolean;
  command?: string;
  args?: string[];
  version?: string;
  pythonPath?: string | null;
};

export const upgradeVllmRuntime = async (
  options: VllmUpgradeOptions = {}
): Promise<{
  success: boolean;
  version: string | null;
  output: string | null;
  error: string | null;
  used_wheel: string | null;
  used_command: string | null;
}> => {
  const pythonPath = resolvePythonBinary(options.pythonPath);
  if (!pythonPath)
    return {
      success: false,
      version: null,
      output: null,
      error: "Python runtime not found",
      used_wheel: null,
      used_command: null,
    };

  const preferredCommand =
    options.command?.trim() ?? getUpgradeCommandFromEnvironment(VLLM_UPGRADE_ENV);
  const command = preferredCommand;
  const parsedArguments = parseCommandInput(options.args);
  const preferBundled = options.preferBundled !== false;
  if (!command) {
    const version = resolveVllmUpgradeTarget(options.version);
    const bundledWheel = resolveBundledWheel();
    const resolvedCommand = resolveVllmUpgradeCommand(
      pythonPath,
      version,
      preferBundled,
      bundledWheel
    );
    const result = await runCommand(
      resolvedCommand.command,
      resolvedCommand.args,
      VLLM_UPGRADE_TIMEOUT_MS
    );
    const usedCommand = [resolvedCommand.command, ...resolvedCommand.args].join(" ");
    if (result.code !== 0) {
      const usedWheel = preferBundled ? (bundledWheel?.path ?? null) : null;
      return {
        success: false,
        version: null,
        output: result.stdout || null,
        error: result.stderr || "Upgrade failed",
        used_wheel: usedWheel,
        used_command: usedCommand,
      };
    }
    const runtimeInfo = await getVllmRuntimeInfo(pythonPath);
    const usedWheel = preferBundled ? (bundledWheel?.path ?? null) : null;
    return {
      success: true,
      version: runtimeInfo.version,
      output: result.stdout || null,
      error: result.stderr || null,
      used_wheel: usedWheel,
      used_command: usedCommand,
    };
  }
  const customArguments = parsedArguments ?? [];
  const result = await runCommand(command, customArguments, VLLM_UPGRADE_TIMEOUT_MS);
  const usedCommand = [command, ...customArguments].join(" ");
  if (result.code !== 0)
    return {
      success: false,
      version: null,
      output: result.stdout || null,
      error: result.stderr || "Upgrade failed",
      used_wheel: null,
      used_command: usedCommand,
    };
  const runtimeInfo = await getVllmRuntimeInfo(pythonPath);
  return {
    success: true,
    version: runtimeInfo.version,
    output: result.stdout || null,
    error: result.stderr || null,
    used_wheel: null,
    used_command: usedCommand,
  };
};
