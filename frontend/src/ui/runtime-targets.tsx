"use client";

import { ArrowUpCircle, DownloadCloud, Info, Loader2 } from "lucide-react";
import type { EngineBackend, EngineJob, RuntimeTarget } from "@/lib/types";
import { SettingsButton, SettingsRow, SettingsValue } from "./settings";
import { StatusPill, type UiTone } from "./status";

export const ENGINE_META: Record<string, { label: string; description: string }> = {
  vllm: {
    label: "vLLM",
    description: "High-throughput LLM serving with CUDA-oriented scheduling.",
  },
  sglang: { label: "SGLang", description: "Fast structured generation and multi-turn serving." },
  llamacpp: {
    label: "llama.cpp",
    description: "GGUF inference through CPU, Metal, or CUDA builds.",
  },
  mlx: { label: "MLX", description: "Apple Silicon inference through mlx-lm." },
};

export type ManagedRuntimeInstallBackend = Extract<EngineBackend, "vllm" | "sglang" | "mlx">;

export const MANAGED_RUNTIME_BACKENDS: readonly ManagedRuntimeInstallBackend[] = [
  "vllm",
  "sglang",
  "mlx",
] as const;

export const SETUP_RUNTIME_BACKENDS: readonly ManagedRuntimeInstallBackend[] = ["vllm"] as const;

export const isRunningEngineJob = (job: EngineJob | undefined): boolean =>
  job?.status === "queued" || job?.status === "running";

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

export const isManagedRuntimeTarget = (target: RuntimeTarget): boolean => {
  if (!MANAGED_RUNTIME_BACKENDS.includes(target.backend as ManagedRuntimeInstallBackend)) {
    return false;
  }
  const normalizedPythonPath = target.pythonPath?.replace(/\\/g, "/") ?? "";
  return normalizedPythonPath.endsWith(`/runtime/venvs/${target.backend}-latest/bin/python`);
};

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
  return backends.map((backend) => {
    const meta = ENGINE_META[backend];
    const target = managedTargetForBackend(targets, backend);
    const installedTarget = target?.installed ? target : undefined;
    const job = installedTarget
      ? jobForRuntimeTarget(jobs, installedTarget)
      : managedInstallJob(jobs, backend);
    const running = isRunningEngineJob(job);
    const canUpdate = Boolean(installedTarget?.capabilities.canUpdate && onUpdateTarget);
    const action = installedTarget ? "Update" : "Install";
    return (
      <SettingsRow
        key={backend}
        variant="resource"
        label={`${meta.label} managed venv`}
        description={`${action} latest ${meta.label} in the controller-managed Python environment.`}
        value={
          <SettingsValue mono truncate>
            {target?.pythonPath ?? `$DATA_DIR/runtime/venvs/${backend}-latest`}
          </SettingsValue>
        }
        status={
          target ? (
            <RuntimeTargetStatus
              installed={target.installed}
              active={target.active}
              health={target.health.status}
            />
          ) : (
            <StatusPill tone={job?.status === "success" ? "good" : "default"}>venv</StatusPill>
          )
        }
        actions={
          <SettingsButton
            onClick={() =>
              void (installedTarget ? onUpdateTarget?.(installedTarget) : onInstall(backend))
            }
            disabled={running || (installedTarget ? !canUpdate : false)}
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : installedTarget ? (
              <ArrowUpCircle className="h-3 w-3" />
            ) : (
              <DownloadCloud className="h-3 w-3" />
            )}
            {running ? job?.status : action}
          </SettingsButton>
        }
      >
        {job ? <RuntimeJobMessage job={job} /> : null}
      </SettingsRow>
    );
  });
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

export function RuntimeTargetRow({
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

  return (
    <SettingsRow
      variant="resource"
      label={target.label || meta?.label || target.backend}
      description={<RuntimeTargetMeta target={target} />}
      control={<RuntimeTargetSummary target={target} />}
      status={
        <RuntimeTargetStatus
          installed={target.installed}
          active={target.active}
          health={target.health.status}
        />
      }
      actions={
        <RuntimeTargetAction
          target={target}
          job={job}
          onAction={onAction}
          unsupportedReason={unsupportedReason}
        />
      }
    >
      {job ? <RuntimeJobMessage job={job} /> : null}
      {target.capabilities.canUpdate && target.update ? (
        <RuntimeUpdateDetails update={target.update} />
      ) : null}
      {!target.capabilities.canUpdate ? (
        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">{unsupportedReason}</p>
      ) : null}
      {healthMessage ? (
        <p className="text-[length:var(--fs-sm)] text-(--ui-warning)">{healthMessage}</p>
      ) : null}
    </SettingsRow>
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
  return (
    <SettingsButton
      onClick={() => void onAction?.(target)}
      disabled={disabled}
      title={canUpdate ? undefined : unsupportedReason}
    >
      {running ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : canUpdate ? (
        <ArrowUpCircle className="h-3 w-3" />
      ) : (
        <Info className="h-3 w-3" />
      )}
      {running ? job?.status : canUpdate ? (target.installed ? "Update" : "Install") : "Managed"}
    </SettingsButton>
  );
}

function runtimeTargetHealthMessage(target: RuntimeTarget): string | undefined {
  if (!target.capabilities.canUpdate) return undefined;
  if (target.health.status !== "warning" && target.health.status !== "error") return undefined;
  return target.health.message;
}

function RuntimeTargetMeta({ target }: { target: RuntimeTarget }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span>{target.kind}</span>
      <span aria-hidden>·</span>
      <span>{target.source}</span>
      {target.active ? (
        <>
          <span aria-hidden>·</span>
          <span className="text-(--ui-success)">running</span>
        </>
      ) : null}
    </span>
  );
}

function RuntimeTargetSummary({ target }: { target: RuntimeTarget }) {
  const location = pathForTarget(target);
  return (
    <div className="min-w-0 flex-1 text-left">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-mono text-[length:var(--fs-md)] text-(--ui-fg)/85">
          {target.installed ? (target.version ?? "installed") : "not installed"}
        </span>
        {target.update && target.capabilities.canUpdate ? (
          <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">
            target {target.update.targetVersion}
          </span>
        ) : null}
      </div>
      {location ? (
        <div
          className="mt-0.5 min-w-0 truncate font-mono text-[length:var(--fs-sm)] text-(--ui-muted)"
          title={location}
        >
          {location}
        </div>
      ) : null}
    </div>
  );
}

export function RuntimeTargetStatus({
  installed,
  active,
  health,
}: {
  installed: boolean;
  active?: boolean;
  health?: RuntimeTarget["health"]["status"];
}) {
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
  return (
    <StatusPill tone={tone} variant="badge">
      {label}
    </StatusPill>
  );
}

export function RuntimeJobMessage({ job }: { job: EngineJob }) {
  return (
    <div
      className={`space-y-1 text-[length:var(--fs-md)] ${job.status === "error" ? "text-(--ui-danger)/80" : "text-(--ui-muted)"}`}
    >
      <p>{job.message}</p>
      {job.command ? <p className="truncate font-mono">{job.command}</p> : null}
      {job.error || job.outputTail ? (
        <p className="line-clamp-3 whitespace-pre-wrap font-mono">{job.error ?? job.outputTail}</p>
      ) : null}
    </div>
  );
}

export function RuntimeUpdateDetails({ update }: { update: NonNullable<RuntimeTarget["update"]> }) {
  const pinHint = update.changes.find((change) => change.startsWith("Set "));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
      <span>
        Update available:{" "}
        <span className="font-mono text-(--ui-fg)/70">
          {update.currentVersion ?? "unknown"} -&gt; {update.targetVersion}
        </span>
      </span>
      {update.restartRequired ? (
        <StatusPill tone="warning" variant="badge">
          restarts model
        </StatusPill>
      ) : null}
      <a
        href={update.releaseNotesUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-(--ui-accent)/80 hover:underline"
      >
        release notes
      </a>
      {pinHint ? <span className="basis-full text-(--ui-muted)/70">{pinHint}</span> : null}
    </div>
  );
}

function pathForTarget(target: RuntimeTarget) {
  return target.pythonPath ?? target.binaryPath ?? target.dockerImage ?? "";
}
