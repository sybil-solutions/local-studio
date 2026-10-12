"use client";

import { Fragment } from "react";
import type { EngineBackend, EngineJob, RuntimeTarget } from "@/lib/types";
import { type UiTone, Spinner } from "@/ui";
import {
  DataRow,
  DetailRow,
  EndCell,
  IdentityCell,
  RowAction,
  StatusText,
  statusToneFor,
  TextCell,
} from "@/features/recipes/recipes-content/catalog-table-shell";

/**
 * Engines are drawn in the same table language as servers and models.
 *
 * The columns are the four things that differ between two runtimes — what it
 * is, which version is on disk, where that install lives, and whether it is
 * usable — and everything an install has to say for itself (a job log, a
 * failed command, an available update) hangs off the row as a DetailRow rather
 * than being crushed into a cell.
 */
export const ENGINE_TABLE_COLUMNS = ["Engine", "Version", "Location", "State"] as const;
export const ENGINE_TABLE_COLSPAN = ENGINE_TABLE_COLUMNS.length;
export const ENGINE_TABLE_MIN_WIDTH = "min-w-[46rem]";

export const ENGINE_META: Record<string, { label: string; description: string }> = {
  vllm: {
    label: "vLLM",
    description: "High-throughput LLM serving with CUDA-oriented scheduling.",
  },
  sglang: { label: "SGLang", description: "Fast structured generation and multi-turn serving." },
  exllamav3: {
    label: "exllamav3",
    description: "exl3 quantized inference served through TabbyAPI.",
  },
};

export type ManagedRuntimeInstallBackend = Extract<EngineBackend, "vllm" | "sglang" | "exllamav3">;

export const MANAGED_RUNTIME_BACKENDS: readonly ManagedRuntimeInstallBackend[] = [
  "vllm",
  "sglang",
  "exllamav3",
] as const;

export const isRunningEngineJob = (job: EngineJob | undefined): boolean =>
  job?.status === "queued" || job?.status === "running";

const ENGINE_JOB_OUTPUT_TAIL_CHARS = 500;

function clipEngineJobOutputTail(outputTail: string | undefined): string | null {
  const tail = outputTail?.trim();
  if (!tail) return null;
  return tail.length > ENGINE_JOB_OUTPUT_TAIL_CHARS
    ? `…${tail.slice(-ENGINE_JOB_OUTPUT_TAIL_CHARS)}`
    : tail;
}

/** Multi-line failure summary for a job that ended in `error`: message, reason, output tail. */
export const jobForRuntimeTarget = (
  jobs: EngineJob[],
  target: RuntimeTarget,
): EngineJob | undefined =>
  jobs.find((job) => job.targetId === target.id && isRunningEngineJob(job)) ??
  jobs.find((job) => job.targetId === target.id);

const managedInstallJob = (
  jobs: EngineJob[],
  backend: ManagedRuntimeInstallBackend,
): EngineJob | undefined =>
  jobs.find(
    (job) =>
      job.backend === backend && job.type === "install" && !job.targetId && isRunningEngineJob(job),
  ) ?? jobs.find((job) => job.backend === backend && job.type === "install" && !job.targetId);

export const isManagedRuntimeTarget = (target: RuntimeTarget): boolean =>
  MANAGED_RUNTIME_BACKENDS.includes(target.backend as ManagedRuntimeInstallBackend) &&
  target.kind === "docker";

const managedTargetForBackend = (
  targets: RuntimeTarget[],
  backend: ManagedRuntimeInstallBackend,
): RuntimeTarget | undefined =>
  targets.find((target) => target.backend === backend && isManagedRuntimeTarget(target));

export function ManagedRuntimeInstallRows({
  backends = MANAGED_RUNTIME_BACKENDS,
  jobs = [],
  targets = [],
  onInstall,
  onUpdateTarget,
}: {
  backends?: readonly ManagedRuntimeInstallBackend[];
  jobs?: EngineJob[];
  targets?: RuntimeTarget[];
  onInstall: (backend: ManagedRuntimeInstallBackend) => void | Promise<void>;
  onUpdateTarget?: (target: RuntimeTarget) => void | Promise<void>;
}) {
  return backends.map((backend) => (
    <ManagedRuntimeInstallRow
      key={backend}
      backend={backend}
      jobs={jobs}
      targets={targets}
      onInstall={onInstall}
      onUpdateTarget={onUpdateTarget}
    />
  ));
}

/** What is on disk for this target, said the same way everywhere. */
function installedVersionLabel(target: RuntimeTarget | undefined): string {
  if (!target?.installed) return "not installed";
  return target.version ?? "installed";
}

/**
 * Everything the engine-image row needs to know, resolved in one place: which
 * docker target the controller reports for this backend, which pull job is
 * touching it, and whether the button pulls or re-pulls.
 */
function describeManagedInstall(
  backend: ManagedRuntimeInstallBackend,
  jobs: EngineJob[],
  targets: RuntimeTarget[],
) {
  const target = managedTargetForBackend(targets, backend);
  const installedTarget = target?.installed ? target : undefined;
  const job = installedTarget
    ? jobForRuntimeTarget(jobs, installedTarget)
    : managedInstallJob(jobs, backend);
  return {
    target,
    installedTarget,
    job,
    running: isRunningEngineJob(job),
    updateTarget: installedTarget?.capabilities.canUpdate ? installedTarget : undefined,
    actionLabel: installedTarget ? "Update" : "Pull image",
    location: target?.dockerImage ?? "pinned image",
  };
}

function ManagedRuntimeInstallRow({
  backend,
  jobs,
  targets,
  onInstall,
  onUpdateTarget,
}: {
  backend: ManagedRuntimeInstallBackend;
  jobs: EngineJob[];
  targets: RuntimeTarget[];
  onInstall: (backend: ManagedRuntimeInstallBackend) => void | Promise<void>;
  onUpdateTarget?: (target: RuntimeTarget) => void | Promise<void>;
}) {
  const meta = ENGINE_META[backend];
  const { target, installedTarget, job, running, updateTarget, actionLabel, location } =
    describeManagedInstall(backend, jobs, targets);
  const canAct = Boolean(updateTarget ? onUpdateTarget : onInstall);
  return (
    <>
      <DataRow>
        <IdentityCell
          label={`${meta.label} image`}
          description={`Pinned serving image for ${meta.label}.`}
        />
        <TextCell mono>{installedVersionLabel(target)}</TextCell>
        <TextCell mono title={location}>
          {location}
        </TextCell>
        <EndCell>
          <div className="flex items-center justify-end gap-2">
            {target ? (
              <RuntimeTargetStatus
                installed={target.installed}
                active={target.active}
                health={target.health.status}
              />
            ) : (
              <StatusText tone={job?.status === "success" ? "ok" : "dim"}>docker</StatusText>
            )}
            <RowAction
              alwaysVisible
              onClick={() =>
                void (updateTarget ? onUpdateTarget?.(updateTarget) : onInstall(backend))
              }
              disabled={running || !canAct}
              title={`${actionLabel} the pinned ${meta.label} image`}
            >
              {running ? <Spinner size="xs" /> : null}
              {running ? job?.status : actionLabel}
            </RowAction>
          </div>
        </EndCell>
      </DataRow>
      {job ? (
        <DetailRow colSpan={ENGINE_TABLE_COLSPAN}>
          <RuntimeJobMessage job={job} />
        </DetailRow>
      ) : null}
    </>
  );
}

export function RuntimeTargetRows({
  targets,
  jobs = [],
  onAction,
}: {
  targets: RuntimeTarget[];
  jobs?: EngineJob[];
  onAction?: (target: RuntimeTarget) => void | Promise<void>;
}) {
  return targets.map((target) => (
    <RuntimeTargetRow
      key={target.id}
      target={target}
      job={jobForRuntimeTarget(jobs, target)}
      onAction={onAction}
    />
  ));
}

function RuntimeTargetRow({
  target,
  job,
  onAction,
}: {
  target: RuntimeTarget;
  job?: EngineJob;
  onAction?: (target: RuntimeTarget) => void | Promise<void>;
}) {
  const meta = ENGINE_META[target.backend];
  const unsupportedReason = target.health.message ?? "Updates are unsupported for this target.";
  const healthMessage = runtimeTargetHealthMessage(target);
  const location = pathForTarget(target);
  const hasDetail = Boolean(
    job ||
      (target.capabilities.canUpdate && target.update) ||
      !target.capabilities.canUpdate ||
      healthMessage,
  );

  return (
    <>
      <DataRow>
        <IdentityCell
          label={target.label || meta?.label || target.backend}
          description={`${target.kind} · ${target.source}${target.active ? " · running" : ""}`}
        />
        <TextCell
          mono
          sub={
            target.update && target.capabilities.canUpdate
              ? `latest ${target.update.targetVersion}`
              : undefined
          }
        >
          {installedVersionLabel(target)}
        </TextCell>
        <TextCell mono title={location || undefined}>
          {location || "—"}
        </TextCell>
        <EndCell>
          <div className="flex items-center justify-end gap-2">
            <RuntimeTargetStatus
              installed={target.installed}
              active={target.active}
              health={target.health.status}
            />
            <RuntimeTargetAction
              target={target}
              job={job}
              onAction={onAction}
              unsupportedReason={unsupportedReason}
            />
          </div>
        </EndCell>
      </DataRow>
      {hasDetail ? (
        <DetailRow colSpan={ENGINE_TABLE_COLSPAN}>
          <RuntimeTargetDetail
            target={target}
            job={job}
            unsupportedReason={unsupportedReason}
            healthMessage={healthMessage}
          />
        </DetailRow>
      ) : null}
    </>
  );
}

function RuntimeTargetDetail({
  target,
  job,
  unsupportedReason,
  healthMessage,
}: {
  target: RuntimeTarget;
  job?: EngineJob;
  unsupportedReason: string;
  healthMessage?: string;
}) {
  return (
    <>
      {job ? <RuntimeJobMessage job={job} /> : null}
      {target.capabilities.canUpdate && target.update ? (
        <RuntimeUpdateDetails update={target.update} />
      ) : null}
      {!target.capabilities.canUpdate ? <span>{unsupportedReason}</span> : null}
      {healthMessage ? <span className="text-(--warn)">{healthMessage}</span> : null}
    </>
  );
}

function RuntimeTargetAction({
  target,
  job,
  onAction,
  unsupportedReason,
}: {
  target: RuntimeTarget;
  job?: EngineJob;
  onAction?: (target: RuntimeTarget) => void | Promise<void>;
  unsupportedReason: string;
}) {
  const running = isRunningEngineJob(job);
  const canUpdate = target.capabilities.canUpdate;
  const disabled = running || !canUpdate || !onAction;
  if (!running && (!canUpdate || !onAction)) {
    return null;
  }
  return (
    <RowAction
      alwaysVisible
      onClick={() => void onAction?.(target)}
      disabled={disabled}
      title={canUpdate ? undefined : unsupportedReason}
    >
      {running ? <Spinner size="xs" /> : null}
      {running ? job?.status : canUpdate ? (target.installed ? "Update" : "Install") : "Managed"}
    </RowAction>
  );
}

function runtimeTargetHealthMessage(target: RuntimeTarget): string | undefined {
  if (!target.capabilities.canUpdate) return undefined;
  if (target.health.status !== "warning" && target.health.status !== "error") return undefined;
  return target.health.message;
}

type RuntimeTargetStatusProps = {
  installed: boolean;
  active?: boolean;
  health?: RuntimeTarget["health"]["status"];
};

function runtimeTargetStatus({ installed, active, health }: RuntimeTargetStatusProps): {
  tone: UiTone;
  label: string;
} {
  const tone: UiTone = active
    ? "good"
    : health === "error"
      ? "danger"
      : installed
        ? "info"
        : "default";
  const label = active
    ? "active"
    : health === "error"
      ? "error"
      : installed
        ? "installed"
        : "available";
  return { tone, label };
}

/** The install's verdict, drawn the way a table row states it. */
export function RuntimeTargetStatus(props: RuntimeTargetStatusProps) {
  const { tone, label } = runtimeTargetStatus(props);
  return <StatusText tone={statusToneFor(tone)}>{label}</StatusText>;
}

function RuntimeJobMessage({ job }: { job: EngineJob }) {
  const failed = job.status === "error";
  const reason = job.error?.trim();
  const tail = clipEngineJobOutputTail(job.outputTail);
  const tone = failed ? "text-(--err)" : "";
  return (
    <>
      <span className={tone}>{job.message}</span>
      {job.command ? <span className="truncate font-mono">{job.command}</span> : null}
      {reason && reason !== job.message?.trim() ? (
        <span className={`line-clamp-3 font-mono ${tone}`}>{reason}</span>
      ) : null}
      {tail ? <RuntimeJobOutputTail tail={tail} failed={failed} /> : null}
    </>
  );
}

function RuntimeJobOutputTail({ tail, failed }: { tail: string; failed: boolean }) {
  if (!failed) {
    return <span className="line-clamp-3 font-mono">{tail}</span>;
  }
  return (
    <details className="overflow-hidden rounded-md border border-(--ui-border) bg-(--ui-bg)">
      <summary className="cursor-pointer px-2 py-1 text-[length:var(--fs-xs)] text-(--dim)">
        Last output
      </summary>
      <pre className="whitespace-pre-wrap break-all px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--err)/80">
        {tail}
      </pre>
    </details>
  );
}

function RuntimeUpdateDetails({ update }: { update: NonNullable<RuntimeTarget["update"]> }) {
  const pinHint = update.changes.find((change) => change.startsWith("Set "));
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span>
          Update available:{" "}
          <span className="font-mono text-(--fg)/70">
            {update.currentVersion ?? "unknown"} -&gt; {update.targetVersion}
          </span>
        </span>
        {update.restartRequired ? <span className="text-(--warn)">restarts model</span> : null}
        <a
          href={update.releaseNotesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-(--link) hover:underline"
        >
          release notes
        </a>
      </span>
      {pinHint ? <span className="text-(--dim)/70">{pinHint}</span> : null}
    </>
  );
}

function pathForTarget(target: RuntimeTarget) {
  return target.pythonPath ?? target.binaryPath ?? target.dockerImage ?? "";
}
