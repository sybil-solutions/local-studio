import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { EngineJob, RuntimeJobBackend, RuntimeJobType } from "@local-studio/contracts/system";
import type { HostProfile } from "../../compute/contracts";
import { clearRuntimeTargetsCache, pinnedImageFor } from "./runtime-targets";
import { pidExists } from "./pid-exists";

/**
 * Engine jobs, docker-only: every job — install or update — is a `docker pull`
 * of the engine's pinned image. The job registry (list, poll, cancel, prune)
 * keeps its wire shape from the installer era; only the operation changed.
 */

type CreateEngineJobOptions = {
  backend: RuntimeJobBackend;
  type: RuntimeJobType;
  host: HostProfile;
};

const MAX_OUTPUT_TAIL_LENGTH = 4000;
const MAX_FINISHED_JOBS = 50;
const jobs = new Map<string, EngineJob>();
const jobChildren = new Map<string, ChildProcess>();

const nowIso = (): string => new Date().toISOString();

const updateJob = (id: string, updates: Partial<EngineJob>): void => {
  const current = jobs.get(id);
  if (!current) return;
  jobs.set(id, { ...current, ...updates });
};

const updateRunningJob = (id: string, updates: Partial<EngineJob>): void => {
  const current = jobs.get(id);
  if (!current || current.status !== "running") return;
  jobs.set(id, { ...current, ...updates });
};

const pruneFinishedJobs = (): void => {
  const finished = [...jobs.values()]
    .filter(
      (job) => job.status === "success" || job.status === "error" || job.status === "cancelled",
    )
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

const finishJob = (id: string, updates: Partial<EngineJob>): void => {
  updateRunningJob(id, { ...updates, progress: 1, finishedAt: nowIso() });
  jobChildren.delete(id);
  clearRuntimeTargetsCache();
};

const runPull = (job: EngineJob, image: string): void => {
  const child = spawn("docker", ["pull", image], { stdio: ["ignore", "pipe", "pipe"] });
  jobChildren.set(job.id, child);
  let output = "";
  let layersDone = 0;
  const observe = (chunk: Buffer): void => {
    const text = chunk.toString();
    output = (output + text).slice(-MAX_OUTPUT_TAIL_LENGTH);
    layersDone += (text.match(/Pull complete|Already exists/g) ?? []).length;
    updateRunningJob(job.id, {
      // Layer count is unknown up front; converge without ever claiming done.
      progress: Math.min(0.95, 0.1 + layersDone * 0.08),
      message: `pulling ${image}`,
      outputTail: output,
    });
  };
  child.stdout?.on("data", observe);
  child.stderr?.on("data", observe);
  child.on("error", (error) => {
    finishJob(job.id, { status: "error", message: error.message, error: error.message });
  });
  child.on("close", (code) => {
    if (jobs.get(job.id)?.status !== "running") return;
    if (code === 0) {
      finishJob(job.id, { status: "success", message: `pulled ${image}`, outputTail: output });
    } else {
      const message = `docker pull exited with ${code ?? "signal"}`;
      finishJob(job.id, { status: "error", message, error: message, outputTail: output });
    }
  });
};

export const createEngineJob = (options: CreateEngineJobOptions): Effect.Effect<EngineJob, Error> =>
  Effect.sync(() => {
    const image = pinnedImageFor(options.backend, options.host);
    if (!image) {
      throw new Error(`${options.backend} has no serving image for this hardware`);
    }
    const job: EngineJob = {
      id: randomUUID(),
      backend: options.backend,
      type: options.type,
      status: "running",
      progress: 0.05,
      message: `pulling ${image}`,
      command: `docker pull ${image}`,
      startedAt: nowIso(),
    };
    jobs.set(job.id, job);
    pruneFinishedJobs();
    runPull(job, image);
    return job;
  });

export const listEngineJobs = (): EngineJob[] =>
  [...jobs.values()].sort((first, second) => second.startedAt.localeCompare(first.startedAt));

export const getEngineJob = (id: string): EngineJob | null => jobs.get(id) ?? null;

const terminateJobChild = (id: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const child = jobChildren.get(id);
    if (!child) return;
    const exited = (): boolean =>
      child.exitCode !== null || Boolean(child.pid && !pidExists(child.pid));
    yield* Effect.sync(() => {
      try {
        return child.kill("SIGTERM");
      } catch {
        return false;
      }
    });
    const termDeadline = Date.now() + 2_000;
    while (!exited() && Date.now() < termDeadline) yield* Effect.sleep(100);
    if (!exited()) {
      yield* Effect.sync(() => {
        try {
          return child.kill("SIGKILL");
        } catch {
          return false;
        }
      });
      const killDeadline = Date.now() + 2_000;
      while (!exited() && Date.now() < killDeadline) yield* Effect.sleep(100);
    }
  }).pipe(Effect.catch(() => Effect.void));

export const cancelEngineJob = (id: string): Effect.Effect<EngineJob | null> =>
  Effect.gen(function* () {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.status === "success" || job.status === "error" || job.status === "cancelled") {
      return job;
    }
    updateJob(id, {
      status: "cancelled",
      progress: 1,
      message: "cancelled by user",
      finishedAt: nowIso(),
    });
    yield* terminateJobChild(id);
    jobChildren.delete(id);
    pruneFinishedJobs();
    return jobs.get(id) ?? null;
  });

export const shutdownEngineJobs = (): Effect.Effect<void> =>
  Effect.forEach(
    [...jobs.values()].filter((job) => job.status === "queued" || job.status === "running"),
    (job) => cancelEngineJob(job.id),
    { discard: true },
  );
