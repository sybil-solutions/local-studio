import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../../../config/env";
import { runCommandAsync } from "../../../core/command";
import type { ProcessInfo, Recipe } from "../../models/types";
import type { RuntimeBackendInfo } from "../../shared/system-types";
import { appendExtraArguments, getPythonPath } from "../process/backend-builder";
import { stripForeignFlagKeys } from "../../../../../shared/contracts/engine-args";
import {
  extractFlag,
  hasModuleInvocation,
} from "../argument-utilities";
import type { EngineSpec } from "../engine-spec";

const MLX_IMPORT_PROBE =
  "import json, sys\ntry:\n import mlx_lm\n print(json.dumps({'version': getattr(mlx_lm, '__version__', None) or 'installed', 'python': sys.executable}))\nexcept Exception:\n print(json.dumps({'version': None, 'python': sys.executable}))";

const buildMlxCommand = (recipe: Recipe, config: Config): string[] => {
  const python = getPythonPath(recipe) || config.mlx_python || "python3";
  const command = [python, "-m", "mlx_lm.server"];
  command.push("--model", recipe.model_path, "--host", recipe.host, "--port", String(recipe.port));
  return appendExtraArguments(command, stripForeignFlagKeys("mlx", recipe.extra_args));
};

const managedPackageSpec = (_version?: string | null): string => {
  return "mlx-lm";
};

const detectInvocation = (args: string[]): boolean => {
  const joined = args.join(" ");
  if (joined.includes("mlx_lm.server") || joined.includes("mlx-lm")) return true;
  if (hasModuleInvocation(args, "mlx_lm.server")) return true;
  return false;
};

const extractModelPath = (args: string[]): string | null => {
  return extractFlag(args, "--model") ?? null;
};

const extractServedModelName = (_args: string[]): string | null => {
  // mlx_lm.server has no served-model-name flag; it uses the model path as the ID.
  return null;
};

const resolvePythonPath = (): string | null => {
  const explicit = process.env["LOCAL_STUDIO_MLX_PYTHON"]?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  const managedCandidates = [
    join(process.cwd(), "runtime", "venvs", "mlx-latest", "bin", "python"),
  ];
  for (const candidate of managedCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
};

const getRuntimeInfoAsync = async (
  config: Config,
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Promise<RuntimeBackendInfo> => {
  const candidates: string[] = [];

  if (runningProcess && runningProcess.backend === "mlx") {
    const psResult = await runCommandAsync("ps", ["-p", String(runningProcess.pid), "-o", "args="], { timeoutMs: 3_000 });
    if (psResult.status === 0 && psResult.stdout) {
      const args = psResult.stdout.trim().split(/\s+/);
      const first = args[0];
      if (first && /^python\d*$/.test(first.split("/").pop() ?? "")) {
        if (existsSync(first)) candidates.push(first);
      }
      const moduleIndex = args.findIndex((a) => a === "mlx_lm.server");
      if (moduleIndex >= 2 && args[moduleIndex - 1] === "-m") {
        const py = args[moduleIndex - 2];
        if (py && existsSync(py)) candidates.push(py);
      }
    }
  }

  if (config.mlx_python) candidates.push(config.mlx_python);
  const resolved = resolvePythonPath();
  if (resolved) candidates.push(resolved);
  candidates.push("python3", "python");

  const unique = candidates.filter((candidate, index, allCandidates) => allCandidates.indexOf(candidate) === index);

  for (const python of unique) {
    const check = await runCommandAsync(python, ["--version"], { timeoutMs: 2_000 });
    if (check.status !== 0) continue;
    const result = await runCommandAsync(python, ["-c", MLX_IMPORT_PROBE], { timeoutMs: 5_000 });
    if (result.status !== 0) continue;
    try {
      const parsed = JSON.parse(result.stdout) as { version?: string | null; python?: string | null };
      if (parsed.version) {
        return {
          installed: true,
          version: parsed.version,
          python_path: parsed.python ?? python,
          upgrade_command_available: false,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    installed: false,
    version: null,
    python_path: config.mlx_python ?? null,
    upgrade_command_available: false,
  };
};

export const mlxSpec: EngineSpec = {
  id: "mlx",
  // mlx_lm.server has no /health endpoint; /v1/models answers 200 once ready.
  // This mirrors exo-spark's healthPath for MLX.
  healthPath: "/v1/models",
  cliBinary: null,
  buildCommand: buildMlxCommand,
  managedPackageSpec,
  detectInvocation,
  extractModelPath,
  extractServedModelName,
  resolvePythonPath,
  getRuntimeInfo: getRuntimeInfoAsync,
};
