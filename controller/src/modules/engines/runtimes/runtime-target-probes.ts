import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveBinary, runCommand } from "../../../core/command";

const PYTHON_VERSION_PROBES: Record<"vllm" | "sglang", string> = {
  vllm: "import json, sys\ntry:\n import vllm\n print(json.dumps({'version': vllm.__version__, 'python': sys.executable}))\nexcept Exception as e:\n print(json.dumps({'version': None, 'python': sys.executable, 'error': str(e)}))",
  sglang:
    "import json, sys\ntry:\n import sglang\n print(json.dumps({'version': getattr(sglang, '__version__', None), 'python': sys.executable}))\nexcept Exception as e:\n print(json.dumps({'version': None, 'python': sys.executable, 'error': str(e)}))",
};

const pathExists = (path: string | null | undefined): boolean => Boolean(path && existsSync(path));

export const resolvePathOrBinary = (value: string): string | null => {
  if (value.includes("/")) return existsSync(value) ? resolve(value) : null;
  return resolveBinary(value);
};

const looksLikePython = (value: string): boolean => {
  const name = basename(value);
  return /^python(?:\d+(?:\.\d+)?)?$/.test(name) || name.includes("python");
};

export const splitEnvironmentList = (value: string | undefined): string[] =>
  value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

export const parseCommandPython = (args: string[]): string | null => {
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

export const parseCommandBinary = (args: string[]): string | null => {
  const first = args[0];
  if (!first) return null;
  return resolvePathOrBinary(first) ?? first;
};

export const probePythonRuntime = (
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

export const parsePackageVersion = (output: string): string | null => {
  const match = output.match(/\b\d+(?:\.\d+){1,3}(?:[A-Za-z0-9.+-]*)?\b/);
  return match?.[0] ?? null;
};

export const compareVersions = (left: string | null, right: string | null): number => {
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

export const probeBinaryRuntime = (
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

export const probeVllmBinaryRuntime = (
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
