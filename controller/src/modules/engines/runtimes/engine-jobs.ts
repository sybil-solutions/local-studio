import { randomUUID } from "node:crypto";
import type { Config } from "../../../config/env";
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

type RuntimeJobBackend = EngineBackend | "cuda" | "rocm";

type CreateEngineJobOptions = {
  backend: RuntimeJobBackend;
  type: EngineJob["type"];
  targetId?: string;
  command?: string;
  args?: string[];
  version?: string;
  preferBundled?: boolean;
  runningProcess?: ProcessInfo | null;
};

const MAX_OUTPUT_TAIL_LENGTH = 4000;
const jobs = new Map<string, EngineJob>();

const tailOutput = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  return value.length > MAX_OUTPUT_TAIL_LENGTH ? value.slice(-MAX_OUTPUT_TAIL_LENGTH) : value;
};

const nowIso = (): string => new Date().toISOString();

const createJobRecord = (options: CreateEngineJobOptions): EngineJob => ({
  id: randomUUID(),
  backend: options.backend === "cuda" || options.backend === "rocm" ? "vllm" : options.backend,
  ...(options.targetId ? { targetId: options.targetId } : {}),
  type: options.type,
  status: "queued",
  progress: 0,
  message: `${options.type} queued for ${options.backend}`,
  ...(options.command ? { command: options.command } : {}),
  startedAt: nowIso(),
});

const updateJob = (id: string, updates: Partial<EngineJob>): EngineJob | null => {
  const current = jobs.get(id);
  if (!current) return null;
  const next = { ...current, ...updates };
  jobs.set(id, next);
  return next;
};

const describeDefaultCommand = (options: CreateEngineJobOptions): string => {
  if (options.command) return [options.command, ...(options.args ?? [])].join(" ").trim();
  if (options.backend === "vllm") return "python -m pip install --upgrade vllm";
  if (options.backend === "sglang") return "python -m pip install --upgrade sglang";
  if (options.backend === "llamacpp") return "configured llama.cpp upgrade command";
  if (options.backend === "mlx") return "configured MLX environment";
  if (options.backend === "cuda") return "configured CUDA upgrade command";
  return "configured ROCm upgrade command";
};

const runJob = async (
  config: Config,
  job: EngineJob,
  options: CreateEngineJobOptions
): Promise<void> => {
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
      ...(options.command ? { command: options.command } : {}),
      ...(options.args ? { args: options.args } : {}),
      ...(options.version ? { version: options.version } : {}),
    };
    const result =
      options.backend === "vllm"
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
              ? runPlatformUpgrade("cuda", upgradeOptions)
              : options.backend === "rocm"
                ? runPlatformUpgrade("rocm", upgradeOptions)
                : {
                    success: false,
                    version: null,
                    output: null,
                    error: "MLX runtime updates are not supported by the controller yet.",
                    used_command: null,
                  };

    const outputTail = tailOutput(result.output ?? result.error);
    const command = result.used_command ?? job.command;
    if (!result.success) {
      updateJob(job.id, {
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

    clearRuntimeTargetsCache();
    updateJob(job.id, {
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
    updateJob(job.id, {
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
  return updateJob(id, {
    status: "cancelled",
    progress: 1,
    message: "Job cancellation requested",
    finishedAt: nowIso(),
  });
};

export const clearEngineJobsForTests = (): void => jobs.clear();
