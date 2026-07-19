import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { coerce, compare } from "semver";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import { VLLM_RUNTIME_COMMAND_TIMEOUT_MS } from "../configs";

export type PythonProbeBackend = "vllm" | "sglang" | "mlx";

export const normalizePackageSpec = (packageName: string, version?: string | null): string => {
  const normalized = version?.trim();
  if (!normalized) return packageName;
  return normalized.includes("==") || normalized.endsWith(".whl")
    ? normalized
    : `${packageName}==${normalized}`;
};

const PYTHON_VERSION_PROBES: Record<PythonProbeBackend, string> = {
  vllm: "import json, sys\ntry:\n import vllm\n print(json.dumps({'version': vllm.__version__, 'python': sys.executable}))\nexcept Exception as e:\n print(json.dumps({'version': None, 'python': sys.executable, 'error': str(e)}))",
  sglang:
    "import json, sys\ntry:\n import sglang\n print(json.dumps({'version': getattr(sglang, '__version__', None), 'python': sys.executable}))\nexcept Exception as e:\n print(json.dumps({'version': None, 'python': sys.executable, 'error': str(e)}))",
  mlx: "import json, sys\ntry:\n import mlx_lm\n print(json.dumps({'version': getattr(mlx_lm, '__version__', None) or 'installed', 'python': sys.executable}))\nexcept Exception as e:\n print(json.dumps({'version': None, 'python': sys.executable, 'error': str(e)}))",
};

const PythonVersionProbeSchema = Schema.Struct({
  version: Schema.optional(Schema.NullOr(Schema.String)),
  python: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.String),
});

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
      argument === "vllm.entrypoints.openai.api_server" ||
      argument === "sglang.launch_server" ||
      argument === "mlx_lm.server",
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

export interface PythonRuntimeProbe {
  installed: boolean;
  version: string | null;
  pythonPath: string | null;
  runnable: boolean;
  message?: string | undefined;
}

export const probePythonRuntime = (
  backend: PythonProbeBackend,
  python: string,
): Effect.Effect<PythonRuntimeProbe> =>
  Effect.gen(function* () {
    const check = yield* runCommandAsyncEffect(python, ["--version"], { timeoutMs: 2_000 });
    if (check.status !== 0) {
      return {
        installed: false,
        version: null,
        pythonPath: pathExists(python) ? resolve(python) : python,
        runnable: false,
        message: "Python executable is not runnable",
      };
    }
    const result = yield* runCommandAsyncEffect(python, ["-c", PYTHON_VERSION_PROBES[backend]], {
      timeoutMs: VLLM_RUNTIME_COMMAND_TIMEOUT_MS,
    });
    if (result.status !== 0) {
      return {
        installed: false,
        version: null,
        pythonPath: python,
        runnable: true,
        message: result.stderr || `${backend} import probe failed`,
      };
    }
    try {
      const parsed = Schema.decodeUnknownSync(PythonVersionProbeSchema)(JSON.parse(result.stdout));
      return {
        installed: Boolean(parsed.version),
        version: parsed.version ?? null,
        pythonPath: parsed.python ?? python,
        runnable: true,
        message: parsed.version
          ? undefined
          : (parsed.error ?? `${backend} is not installed in this Python`),
      };
    } catch {
      return {
        installed: false,
        version: null,
        pythonPath: python,
        runnable: true,
        message: "Unable to parse runtime probe output",
      };
    }
  });

export const probeBackendRuntime = (
  backend: PythonProbeBackend,
  candidates: Array<string | null | undefined>,
): Effect.Effect<PythonRuntimeProbe> =>
  Effect.gen(function* () {
    const unique = candidates.filter(
      (candidate, index, all): candidate is string =>
        Boolean(candidate) && all.indexOf(candidate) === index,
    );
    let fallback: PythonRuntimeProbe | null = null;
    for (const candidate of unique) {
      const probe = yield* probePythonRuntime(backend, candidate);
      if (probe.installed) return probe;
      if (!fallback && probe.runnable) fallback = probe;
    }
    return (
      fallback ?? {
        installed: false,
        version: null,
        pythonPath: null,
        runnable: false,
        message: `No runnable Python found for ${backend}`,
      }
    );
  });

export const probeRunningProcessPython = (pid: number): Effect.Effect<string | null> =>
  runCommandAsyncEffect("ps", ["-p", String(pid), "-o", "args="], {
    timeoutMs: 3_000,
  }).pipe(
    Effect.map((result) =>
      result.status !== 0 || !result.stdout
        ? null
        : parseCommandPython(result.stdout.trim().split(/\s+/)),
    ),
  );

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
  const leftVersion = coerce(left);
  const rightVersion = coerce(right);
  if (!leftVersion || !rightVersion) return left.localeCompare(right);
  return compare(leftVersion, rightVersion);
};

export const resolvePythonFromScript = (scriptPath: string | null | undefined): string | null => {
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
  binary: string,
): Effect.Effect<{
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  message?: string;
}> =>
  Effect.gen(function* () {
    const resolved = resolvePathOrBinary(binary);
    const command = resolved ?? binary;
    const version = yield* runCommandAsyncEffect(command, ["--version"], { timeoutMs: 3_000 });
    if (version.status === 0) {
      return {
        installed: true,
        version: parseLlamaVersion(version.stdout) ?? parseLlamaVersion(version.stderr),
        binaryPath: resolved ?? command,
      };
    }
    const help = yield* runCommandAsyncEffect(command, ["--help"], { timeoutMs: 3_000 });
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
  });

export const probeVllmBinaryRuntime = (
  binary: string,
): Effect.Effect<{
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  pythonPath: string | null;
  message?: string;
}> =>
  Effect.gen(function* () {
    const resolved = resolvePathOrBinary(binary);
    const command = resolved ?? binary;
    const version = yield* runCommandAsyncEffect(command, ["--version"], { timeoutMs: 3_000 });
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
  });
