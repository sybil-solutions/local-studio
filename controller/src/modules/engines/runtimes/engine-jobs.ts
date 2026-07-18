import { spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Config } from "../../../config/env";
import type {
  EngineBackend,
  EngineJob,
  RuntimeTarget,
  RuntimeUpgradeResult,
} from "@local-studio/contracts/system";
import { getEngineSpec, type InstallOptions } from "../engine-spec";
import { acquireEngineInstallLock, installLockTimeoutMessage } from "./install-lock";
import { runPlatformUpgrade } from "./runtime-upgrade";
import {
  clearRuntimeTargetsCache,
  getDefaultRuntimeTarget,
  getRuntimeTarget,
} from "./runtime-targets";
import type { ProcessInfo } from "../../models/types";
import {
  isManagedPythonBackend,
  managedVenvName,
  type ManagedPythonBackend,
  type InstallProgressUpdate,
} from "./managed-venv";

export { managedVenvPath } from "./managed-venv";

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
const jobs = new Map<string, EngineJob>();
const jobChildren = new Map<string, ChildProcess>();

const tailOutput = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  return value.length > MAX_OUTPUT_TAIL_LENGTH ? value.slice(-MAX_OUTPUT_TAIL_LENGTH) : value;
};

const nowIso = (): string => new Date().toISOString();

const isPlatformBackend = (backend: RuntimeJobBackend): backend is "cuda" | "rocm" =>
  backend === "cuda" || backend === "rocm";

const createJobRecord = (options: CreateEngineJobOptions): EngineJob => ({
  id: randomUUID(),
  backend: isPlatformBackend(options.backend) ? "vllm" : options.backend,
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

const updateRunningJob = (id: string, updates: Partial<EngineJob>): void => {
  const current = jobs.get(id);
  if (!current || current.status !== "running") return;
  jobs.set(id, { ...current, ...updates });
};

const describeDefaultCommand = (options: CreateEngineJobOptions): string => {
  if (isPlatformBackend(options.backend))
    return `configured ${options.backend.toUpperCase()} upgrade command`;
  if (options.backend === "llamacpp") return "configured llama.cpp upgrade command";
  if (options.type === "install" && isManagedPythonBackend(options.backend)) {
    return `python -m venv $DATA_DIR/runtime/venvs/${managedVenvName(options.backend)} && pip install ${managedPackageSpec(options.backend, options.version)}`;
  }
  return `python -m pip install --upgrade ${managedPackageSpec(options.backend, options.version)}`;
};

export const managedPackageSpec = (
  backend: ManagedPythonBackend,
  version?: string | null,
): string => getEngineSpec(backend).managedPackageSpec(version);

const unsupportedMlxUpdate: RuntimeUpgradeResult = {
  success: false,
  version: null,
  output: null,
  error: "MLX runtime updates are not supported by the controller yet.",
  used_command: null,
};

const cancelledResult: RuntimeUpgradeResult = {
  success: false,
  version: null,
  output: null,
  error: "cancelled by user",
  used_command: null,
};

const installLockFailure = (backend: EngineBackend): RuntimeUpgradeResult => ({
  success: false,
  version: null,
  output: null,
  error: installLockTimeoutMessage(backend),
  used_command: null,
});

const runEngineInstall = async (
  config: Config,
  job: EngineJob,
  options: CreateEngineJobOptions,
  backend: EngineBackend,
  target: RuntimeTarget | null,
): Promise<RuntimeUpgradeResult> => {
  if (backend === "mlx" && options.type === "update") return unsupportedMlxUpdate;
  const lock = await acquireEngineInstallLock(config, backend, {
    onWait: (): void =>
      updateRunningJob(job.id, { message: `waiting for in-progress ${backend} install...` }),
    shouldContinue: (): boolean => jobs.get(job.id)?.status === "running",
  });
  if (!lock)
    return jobs.get(job.id)?.status === "cancelled" ? cancelledResult : installLockFailure(backend);
  try {
    if (jobs.get(job.id)?.status !== "running") return cancelledResult;
    return await getEngineSpec(backend).install({
      config,
      version: options.version,
      pythonPath: target?.pythonPath ?? null,
      preferBundled: options.preferBundled,
      createManagedVenv: !options.targetId,
      onProgress: (update: InstallProgressUpdate): void => updateRunningJob(job.id, update),
      onSpawn: (child: ChildProcess): void => {
        jobChildren.set(job.id, child);
      },
    } satisfies InstallOptions);
  } finally {
    lock.release();
    jobChildren.delete(job.id);
  }
};

const runJob = async (
  config: Config,
  job: EngineJob,
  options: CreateEngineJobOptions,
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
    if (options.targetId && !isPlatformBackend(options.backend)) {
      target = await getRuntimeTarget(config, options.targetId, options.runningProcess);
      if (!target) throw new Error("Runtime target not found");
      if (options.type !== "inspect" && !target.capabilities.canUpdate) {
        throw new Error(target.health.message ?? "Update is unsupported for this target.");
      }
    }
    if (!target && options.backend === "vllm") {
      target = await getDefaultRuntimeTarget(config, "vllm", options.runningProcess);
    }

    const result = isPlatformBackend(options.backend)
      ? await runPlatformUpgrade(options.backend, {})
      : await runEngineInstall(config, job, options, options.backend, target);

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

// Keep at most this many finished (success/error/cancelled) job records. The
// map is module-lifetime, so without pruning it grows one entry per job for the
// life of the controller. Active jobs are never pruned.
const MAX_FINISHED_JOBS = 50;

const pruneFinishedJobs = (): void => {
  const finished = [...jobs.values()]
    .filter((job) => job.status === "success" || job.status === "error" || job.status === "cancelled")
    .sort((first, second) => first.startedAt.localeCompare(second.startedAt));
  const excess = finished.length - MAX_FINISHED_JOBS;
  for (let index = 0; index < excess; index += 1) {
    const stale = finished[index];
    if (stale) {
      jobs.delete(stale.id);
      jobChildren.delete(stale.id);
    }
  }
};

export const createEngineJob = (config: Config, options: CreateEngineJobOptions): EngineJob => {
  const job = createJobRecord(options);
  jobs.set(job.id, job);
  pruneFinishedJobs();
  void runJob(config, job, options);
  return job;
};

export const listEngineJobs = (): EngineJob[] =>
  [...jobs.values()].sort((first, second) => second.startedAt.localeCompare(first.startedAt));

export const getEngineJob = (id: string): EngineJob | null => jobs.get(id) ?? null;

const terminateJobChild = (child: ChildProcess | undefined): void => {
  if (!child) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    return;
  }
  child.kill("SIGTERM");
};

export const cancelEngineJob = (id: string): EngineJob | null => {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "success" || job.status === "error" || job.status === "cancelled") return job;
  terminateJobChild(jobChildren.get(id));
  return updateJob(id, {
    status: "cancelled",
    progress: 1,
    message: "cancelled by user",
    finishedAt: nowIso(),
  });
};
