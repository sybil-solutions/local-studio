import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsync, type AsyncCommandResult } from "../../../core/command";
import type { EngineBackend, EngineJob, RuntimeTarget } from "../../shared/system-types";
import { upgradeVllmRuntime } from "./vllm-runtime";
import {
  runPlatformUpgrade,
  upgradeLlamacppRuntime,
  upgradeSglangRuntime,
  type RuntimeUpgradeOptions,
} from "./runtime-upgrade";
import {
  clearRuntimeTargetsCache,
  getDefaultRuntimeTarget,
  getRuntimeTarget,
} from "./runtime-targets";
import type { ProcessInfo } from "../../models/types";
import { ENGINE_INSTALL_TIMEOUT_MS, RUNTIME_UPGRADE_TIMEOUT_MS } from "../configs";
import { probePythonRuntime } from "./runtime-target-probes";

type RuntimeJobBackend = EngineBackend | "cuda" | "rocm";

type CreateEngineJobOptions = {
  backend: RuntimeJobBackend;
  type: EngineJob["type"];
  targetId?: string;
  version?: string;
  preferBundled?: boolean;
  runningProcess?: ProcessInfo | null;
};

const MAX_OUTPUT_TAIL_LENGTH = 4000;
const JOB_OUTPUT_THROTTLE_MS = 1_000;
const PIP_PREFLIGHT_TIMEOUT_MS = 10_000;
const UV_INSTALL_HINT = "curl -LsSf https://astral.sh/uv/install.sh | sh";
const jobs = new Map<string, EngineJob>();
// Live subprocess per job so cancelEngineJob can actually kill the work.
const jobChildren = new Map<string, ChildProcess>();

const tailOutput = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  return value.length > MAX_OUTPUT_TAIL_LENGTH ? value.slice(-MAX_OUTPUT_TAIL_LENGTH) : value;
};

const nowIso = (): string => new Date().toISOString();

const timeoutMinutes = (timeoutMs: number): number => Math.round(timeoutMs / 60_000);

const runJobCommand = async (
  jobId: string,
  command: string,
  args: string[],
  options: { timeoutMs: number; onOutput?: (chunk: string) => void }
): Promise<AsyncCommandResult> => {
  try {
    return await runCommandAsync(command, args, {
      ...options,
      onSpawn: (child) => jobChildren.set(jobId, child),
    });
  } finally {
    jobChildren.delete(jobId);
  }
};

const createJobRecord = (options: CreateEngineJobOptions): EngineJob => ({
  id: randomUUID(),
  backend: options.backend === "cuda" || options.backend === "rocm" ? "vllm" : options.backend,
  ...(options.targetId ? { targetId: options.targetId } : {}),
  type: options.type,
  status: "queued",
  progress: 0,
  message: `${options.type} queued for ${options.backend}`,
  startedAt: nowIso(),
});

const updateJob = (id: string, updates: Partial<EngineJob>): EngineJob | null => {
  const current = jobs.get(id);
  if (!current) return null;
  const next = { ...current, ...updates };
  jobs.set(id, next);
  return next;
};

// Progress updates and final transitions must not overwrite a job the user
// already cancelled (the killed subprocess still resolves with a failure).
const updateRunningJob = (id: string, updates: Partial<EngineJob>): void => {
  const current = jobs.get(id);
  if (!current || current.status !== "running") return;
  jobs.set(id, { ...current, ...updates });
};

const describeDefaultCommand = (options: CreateEngineJobOptions): string => {
  if (options.type === "install" && isManagedPythonBackend(options.backend)) {
    return `python -m venv $DATA_DIR/runtime/venvs/${managedVenvName(options.backend)} && pip install ${managedPackageSpec(options.backend, options.version)}`;
  }
  if (options.backend === "vllm") return "python -m pip install --upgrade vllm";
  if (options.backend === "sglang") return "python -m pip install --upgrade sglang";
  if (options.backend === "llamacpp") return "configured llama.cpp upgrade command";
  if (options.backend === "mlx") return "configured MLX environment";
  if (options.backend === "cuda") return "configured CUDA upgrade command";
  return "configured ROCm upgrade command";
};

type ManagedPythonBackend = Extract<EngineBackend, "vllm" | "sglang" | "mlx">;

const isManagedPythonBackend = (backend: RuntimeJobBackend): backend is ManagedPythonBackend =>
  backend === "vllm" || backend === "sglang" || backend === "mlx";

const managedVenvName = (backend: ManagedPythonBackend): string => `${backend}-latest`;

export const managedVenvPath = (
  config: Pick<Config, "data_dir">,
  backend: ManagedPythonBackend
): string => join(config.data_dir, "runtime", "venvs", managedVenvName(backend));

export const managedPackageSpec = (
  backend: ManagedPythonBackend,
  version?: string | null
): string => {
  if (backend === "mlx") return "mlx-lm";
  const packageName = backend === "vllm" ? "vllm" : "sglang";
  const normalized = version?.trim();
  if (!normalized) return packageName;
  return normalized.includes("==") || normalized.endsWith(".whl")
    ? normalized
    : `${packageName}==${normalized}`;
};

const runManagedPythonInstall = async (
  config: Config,
  backend: ManagedPythonBackend,
  options: RuntimeUpgradeOptions,
  jobId: string
): Promise<{
  success: boolean;
  version: string | null;
  output: string | null;
  error: string | null;
  used_command: string | null;
}> => {
  const basePython = resolveBinary("python3") ?? resolveBinary("python");
  if (!basePython) {
    return {
      success: false,
      version: null,
      output: null,
      error: "Python 3 was not found on PATH",
      used_command: null,
    };
  }

  const venvDirectory = managedVenvPath(config, backend);
  const venvPython = join(venvDirectory, "bin", "python");
  mkdirSync(dirname(venvDirectory), { recursive: true });
  if (!existsSync(venvPython)) {
    updateRunningJob(jobId, { message: `Creating ${backend} virtual environment...` });
    const create = await runJobCommand(jobId, basePython, ["-m", "venv", venvDirectory], {
      timeoutMs: RUNTIME_UPGRADE_TIMEOUT_MS,
    });
    if (create.status !== 0) {
      return {
        success: false,
        version: null,
        output: create.stdout || null,
        error: create.timedOut
          ? `Creating the ${backend} virtual environment timed out after ${timeoutMinutes(RUNTIME_UPGRADE_TIMEOUT_MS)} minutes`
          : create.stderr || `Failed to create managed ${backend} virtual environment`,
        used_command: `${basePython} -m venv ${venvDirectory}`,
      };
    }
  }

  const packageSpec = managedPackageSpec(backend, options.version);
  const uv = resolveBinary("uv");
  if (!uv) {
    const pipCheck = await runJobCommand(jobId, venvPython, ["-m", "pip", "--version"], {
      timeoutMs: PIP_PREFLIGHT_TIMEOUT_MS,
    });
    if (pipCheck.status !== 0) {
      return {
        success: false,
        version: null,
        output: pipCheck.stdout || null,
        error: `Neither uv nor a working pip is available to install ${packageSpec}. Install uv with: ${UV_INSTALL_HINT}`,
        used_command: `${venvPython} -m pip --version`,
      };
    }
  }
  const installer = uv ? "uv" : "pip";
  const command = uv ?? venvPython;
  const args = uv
    ? ["pip", "install", "--python", venvPython, "--upgrade", packageSpec]
    : ["-m", "pip", "install", "--upgrade", packageSpec];
  const usedCommand = [command, ...args].join(" ");

  let outputTail = "";
  let progress = 0.2;
  let lastUpdateAt = 0;
  updateRunningJob(jobId, { progress, message: `Installing ${packageSpec} with ${installer}...` });
  const install = await runJobCommand(jobId, command, args, {
    timeoutMs: ENGINE_INSTALL_TIMEOUT_MS,
    onOutput: (chunk) => {
      outputTail = (outputTail + chunk).slice(-MAX_OUTPUT_TAIL_LENGTH);
      const now = Date.now();
      if (now - lastUpdateAt < JOB_OUTPUT_THROTTLE_MS) return;
      lastUpdateAt = now;
      progress = Math.min(0.9, progress + 0.01);
      updateRunningJob(jobId, {
        progress,
        message: `Installing ${packageSpec} with ${installer}...`,
        outputTail,
      });
    },
  });
  if (install.status !== 0) {
    return {
      success: false,
      version: null,
      output: install.stdout || null,
      error: install.timedOut
        ? `Install of ${packageSpec} timed out after ${timeoutMinutes(ENGINE_INSTALL_TIMEOUT_MS)} minutes. Retry the install; large torch/CUDA wheels are the usual cause.`
        : install.stderr || `Failed to install ${packageSpec}`,
      used_command: usedCommand,
    };
  }

  const probe = await probePythonRuntime(backend, venvPython);
  return {
    success: probe.installed,
    version: probe.version,
    output: install.stdout || null,
    error: probe.installed ? null : (probe.message ?? `${backend} import probe failed`),
    used_command: usedCommand,
  };
};

const runJob = async (
  config: Config,
  job: EngineJob,
  options: CreateEngineJobOptions
): Promise<void> => {
  if (jobs.get(job.id)?.status !== "queued") return;
  updateJob(job.id, {
    status: "running",
    progress: 0.05,
    message: `${options.type} running for ${options.backend}`,
    command: describeDefaultCommand(options),
  });
  try {
    let target: RuntimeTarget | null = null;
    if (options.targetId && options.backend !== "cuda" && options.backend !== "rocm") {
      target = await getRuntimeTarget(config, options.targetId, options.runningProcess);
      if (!target) throw new Error("Runtime target not found");
      if (options.type !== "inspect" && !target.capabilities.canUpdate) {
        throw new Error(target.health.message ?? "Update is unsupported for this target.");
      }
    }
    if (!target && options.backend === "vllm") {
      target = await getDefaultRuntimeTarget(config, "vllm", options.runningProcess);
    }

    const upgradeOptions: RuntimeUpgradeOptions = {
      ...(options.version ? { version: options.version } : {}),
      ...(options.backend === "sglang" && target?.pythonPath
        ? { pythonPath: target.pythonPath }
        : {}),
    };
    const result =
      options.type === "install" && !options.targetId && isManagedPythonBackend(options.backend)
        ? await runManagedPythonInstall(config, options.backend, upgradeOptions, job.id)
        : options.backend === "vllm"
          ? await upgradeVllmRuntime({
              preferBundled: options.preferBundled ?? false,
              pythonPath: target?.pythonPath ?? null,
              ...upgradeOptions,
            })
          : options.backend === "sglang"
            ? await upgradeSglangRuntime(config, upgradeOptions)
            : options.backend === "llamacpp"
              ? await upgradeLlamacppRuntime(config, upgradeOptions)
              : options.backend === "cuda"
                ? await runPlatformUpgrade("cuda", upgradeOptions)
                : options.backend === "rocm"
                  ? await runPlatformUpgrade("rocm", upgradeOptions)
                  : {
                      success: false,
                      version: null,
                      output: null,
                      error: "MLX runtime updates are not supported by the controller yet.",
                      used_command: null,
                    };

    if (options.type === "install" || options.type === "update") {
      clearRuntimeTargetsCache();
    }
    const outputTail = tailOutput(result.output ?? result.error);
    const command = result.used_command ?? job.command;
    if (!result.success) {
      updateRunningJob(job.id, {
        status: "error",
        progress: 1,
        message: result.error ?? `${options.type} failed`,
        ...(command ? { command } : {}),
        ...(outputTail ? { outputTail } : {}),
        ...(result.error ? { error: result.error } : {}),
        finishedAt: nowIso(),
      });
      return;
    }

    updateRunningJob(job.id, {
      status: "success",
      progress: 1,
      message: result.version
        ? `${options.type} complete (${result.version})`
        : `${options.type} complete`,
      ...(command ? { command } : {}),
      ...(outputTail ? { outputTail } : {}),
      finishedAt: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRunningJob(job.id, {
      status: "error",
      progress: 1,
      message,
      error: message,
      outputTail: message,
      finishedAt: nowIso(),
    });
  }
};

export const createEngineJob = (config: Config, options: CreateEngineJobOptions): EngineJob => {
  const job = createJobRecord(options);
  jobs.set(job.id, job);
  void runJob(config, job, options);
  return job;
};

export const listEngineJobs = (): EngineJob[] =>
  [...jobs.values()].sort((first, second) => second.startedAt.localeCompare(first.startedAt));

export const getEngineJob = (id: string): EngineJob | null => jobs.get(id) ?? null;

export const cancelEngineJob = (id: string): EngineJob | null => {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "success" || job.status === "error" || job.status === "cancelled") return job;
  jobChildren.get(id)?.kill("SIGTERM");
  return updateJob(id, {
    status: "cancelled",
    progress: 1,
    message: "cancelled by user",
    finishedAt: nowIso(),
  });
};
