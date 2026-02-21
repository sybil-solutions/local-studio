// CRITICAL
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveBinary } from "../../core/command";
import { resolveVllmPythonPath } from "./vllm-python-path";
import { getUpgradeCommandFromEnvironment, getVllmUpgradeVersion, VLLM_UPGRADE_ENV } from "./runtime-upgrade-config";

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const UPGRADE_TIMEOUT_MS = 600_000;

const parseCommandInput = (args: unknown): string[] | null => {
  if (!Array.isArray(args)) {
    return null;
  }
  const parsed = args.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : null;
};

const resolveVllmUpgradeTarget = (version?: string): string => {
  const configured = version && version.trim().length > 0 ? version.trim() : getVllmUpgradeVersion();
  const normalized = configured.trim();
  if (!normalized) {
    return "vllm";
  }
  return normalized.includes("==") || normalized.endsWith(".whl") ? normalized : `vllm==${normalized}`;
};

const resolveVllmUpgradeCommand = (
  pythonPath: string,
  version: string,
  preferBundled: boolean,
  bundledWheel: { path: string; version: string | null } | null,
): { command: string; args: string[] } => {
  if (preferBundled) {
    if (bundledWheel) {
      if (resolveBinary("uv")) {
        return {
          command: "uv",
          args: ["pip", "install", "--python", pythonPath, "--upgrade", bundledWheel.path],
        };
      }
      return { command: pythonPath, args: ["-m", "pip", "install", "--upgrade", bundledWheel.path] };
    }
  }

  const packageSpec = resolveVllmUpgradeTarget(version);
  if (resolveBinary("uv")) {
    return {
      command: "uv",
      args: ["pip", "install", "--python", pythonPath, "--upgrade", packageSpec],
    };
  }

  return {
    command: pythonPath,
    args: ["-m", "pip", "install", "--upgrade", packageSpec],
  };
};

const runCommand = (
  command: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
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

const resolvePythonBinary = (): string | null => {
  const candidates: string[] = [];
  const runtimePython = resolveVllmPythonPath();
  if (runtimePython) {
    candidates.push(runtimePython);
  }
  const override = process.env["VLLM_STUDIO_RUNTIME_PYTHON"];
  if (override) {
    candidates.push(override);
  }
  candidates.push("python3", "python");

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ["--version"], { timeout: 2000 });
      if (result.status === 0) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
};

const resolveBundledWheel = (): { path: string; version: string | null } | null => {
  const runtimeDirectory = resolve(process.cwd(), "runtime", "wheels");
  if (!existsSync(runtimeDirectory)) {
    return null;
  }
  const candidates = readdirSync(runtimeDirectory).filter(
    (file) => file.startsWith("vllm-") && file.endsWith(".whl")
  );
  if (candidates.length === 0) {
    return null;
  }
  const withStats = candidates
    .map((file) => {
      const fullPath = join(runtimeDirectory, file);
      return { file, fullPath, mtime: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const latest = withStats[0];
  if (!latest) {
    return null;
  }
  const versionMatch = latest.file.match(/^vllm-([0-9A-Za-z.+-]+)-/);
  return {
    path: latest.fullPath,
    version: versionMatch?.[1] ?? null,
  };
};

const resolveVllmBinary = (pythonPath: string | null): string | null => {
  if (pythonPath) {
    const vllmBin = join(dirname(pythonPath), "vllm");
    if (existsSync(vllmBin)) {
      return vllmBin;
    }
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
  const pythonPath = resolvePythonBinary();
  const vllmBin = resolveVllmBinary(pythonPath);
  const bundledWheel = resolveBundledWheel();

  if (!pythonPath) {
    return {
      installed: false,
      version: null,
      python_path: null,
      vllm_bin: vllmBin,
      upgrade_command_available: false,
      bundled_wheel: bundledWheel,
    };
  }

  const result = await runCommand(pythonPath, [
    "-c",
    "import json, sys\ntry:\n import vllm\n print(json.dumps({'version': vllm.__version__, 'python': sys.executable}))\nexcept Exception:\n print(json.dumps({'version': None, 'python': sys.executable}))",
  ]);

  if (result.code !== 0) {
    return {
      installed: false,
      version: null,
      python_path: pythonPath,
      vllm_bin: vllmBin,
      upgrade_command_available: false,
      bundled_wheel: bundledWheel,
    };
  }

  let parsed: { version?: string | null; python?: string | null } | null = null;
  try {
    parsed = JSON.parse(result.stdout) as { version?: string | null; python?: string | null };
  } catch {
    parsed = null;
  }

  return {
    installed: Boolean(parsed?.version),
    version: parsed?.version ?? null,
    python_path: parsed?.python ?? pythonPath,
    vllm_bin: vllmBin,
    upgrade_command_available: true,
    bundled_wheel: bundledWheel,
  };
};

export const getVllmConfigHelp = async (): Promise<{
  config: string | null;
  error: string | null;
}> => {
  const pythonPath = resolvePythonBinary();
  const vllmBin = resolveVllmBinary(pythonPath);

  if (!pythonPath && !vllmBin) {
    return { config: null, error: "vLLM runtime not available" };
  }

  const command = vllmBin ?? pythonPath ?? "";
  const args = vllmBin
    ? ["serve", "--help"]
    : ["-m", "vllm.entrypoints.openai.api_server", "--help"];

  const result = await runCommand(command, args, 15_000);
  if (result.code !== 0) {
    return {
      config: result.stdout || null,
      error: result.stderr || "Failed to fetch vLLM config",
    };
  }
  return { config: result.stdout || null, error: null };
};

type VllmUpgradeOptions = {
  preferBundled?: boolean;
  command?: string;
  args?: string[];
  version?: string;
};

export const upgradeVllmRuntime = async (
  options: VllmUpgradeOptions = {}
): Promise<{
  success: boolean;
  version: string | null;
  output: string | null;
  error: string | null;
  used_wheel: string | null;
}> => {
  const pythonPath = resolvePythonBinary();
  if (!pythonPath) {
    return {
      success: false,
      version: null,
      output: null,
      error: "Python runtime not found",
      used_wheel: null,
    };
  }

  const preferredCommand = options.command?.trim() ?? getUpgradeCommandFromEnvironment(VLLM_UPGRADE_ENV);
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
      bundledWheel,
    );
    const result = await runCommand(resolvedCommand.command, resolvedCommand.args, UPGRADE_TIMEOUT_MS);
    if (result.code !== 0) {
      const usedWheel = preferBundled ? bundledWheel?.path ?? null : null;
      return {
        success: false,
        version: null,
        output: result.stdout || null,
        error: result.stderr || "Upgrade failed",
        used_wheel: usedWheel,
      };
    }

    const runtimeInfo = await getVllmRuntimeInfo();
    const usedWheel = preferBundled ? bundledWheel?.path ?? null : null;
    return {
      success: true,
      version: runtimeInfo.version,
      output: result.stdout || null,
      error: result.stderr || null,
      used_wheel: usedWheel,
    };
  }

  const customArguments = parsedArguments ?? [];
  const result = await runCommand(command, customArguments, UPGRADE_TIMEOUT_MS);

  if (result.code !== 0) {
    return {
      success: false,
      version: null,
      output: result.stdout || null,
      error: result.stderr || "Upgrade failed",
      used_wheel: null,
    };
  }

  const runtimeInfo = await getVllmRuntimeInfo();
  return {
    success: true,
    version: runtimeInfo.version,
    output: result.stdout || null,
    error: result.stderr || null,
    used_wheel: null,
  };
};
