"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowUpCircle, Check, Loader2, Settings, XCircle } from "lucide-react";
import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import api from "@/lib/api";
import type { EngineJob, RuntimeBackendInfo, RuntimeTarget, SystemRuntimeInfo } from "@/lib/types";
import {
  SettingsButton,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  StatusPill,
  type StatusTone,
} from "@/components/settings-primitives";
import {
  ENGINE_META,
  hasHydratedEngineRows,
  resolveEngineRowsView,
  type EngineRowsView,
} from "./engines-section-model";

type UpgradeState = { status: "idle" | "upgrading" | "success" | "error"; message?: string };

const isRunningJob = (job: EngineJob | undefined): boolean =>
  job?.status === "queued" || job?.status === "running";

const jobForTarget = (jobs: EngineJob[], target: RuntimeTarget): EngineJob | undefined =>
  jobs.find((job) => job.targetId === target.id && isRunningJob(job)) ??
  jobs.find((job) => job.targetId === target.id);

export function EnginesSection({ runtime }: { runtime?: SystemRuntimeInfo | null }) {
  const { runtimeSummary, status, lease } = useRealtimeStatus();
  const [targets, setTargets] = useState<RuntimeTarget[]>([]);
  const [jobs, setJobs] = useState<EngineJob[]>([]);

  const backends = runtime?.backends ?? runtimeSummary?.backends;
  const gpuMon = runtime?.gpu_monitoring ?? runtimeSummary?.gpu_monitoring;
  const activeBackend = status?.process?.backend;

  const refreshRuntimeJobs = useCallback(async () => {
    const [targetPayload, jobPayload] = await Promise.all([
      api.getRuntimeTargets().catch(() => ({ targets: [] })),
      api.getRuntimeJobs().catch(() => ({ jobs: [] })),
    ]);
    setTargets(targetPayload.targets);
    setJobs(jobPayload.jobs);
  }, []);

  const subscribeRuntimeJobs = useCallback(
    (_notify: () => void) => {
      void Promise.resolve().then(refreshRuntimeJobs);
      const timer = setInterval(() => void refreshRuntimeJobs(), 2500);
      return () => clearInterval(timer);
    },
    [refreshRuntimeJobs],
  );

  useSyncExternalStore(subscribeRuntimeJobs, getEnginesSectionSnapshot, getEnginesSectionSnapshot);

  const engineRows = useMemo(() => resolveEngineRowsView(targets, backends), [backends, targets]);
  const hasRows = hasHydratedEngineRows(engineRows);

  return (
    <div className="space-y-8">
      <SettingsGroup
        title="Inference engines"
        description="Codex-style status rows instead of install cards; each row keeps an action or a fallback."
        actions={<HydrationStatus hasRows={hasRows} />}
      >
        <EngineRows
          activeBackend={activeBackend}
          jobs={jobs}
          onJobCreated={refreshRuntimeJobs}
          view={engineRows}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Hardware monitor"
        description="GPU telemetry rows stay visible even before live samples arrive."
      >
        <GpuMonitoringRow gpuMon={gpuMon} />
        <GpuLeaseRow holder={lease?.holder} />
      </SettingsGroup>
    </div>
  );
}

const getEnginesSectionSnapshot = (): number => 0;

function HydrationStatus({ hasRows }: { hasRows: boolean }) {
  return (
    <StatusPill tone={hasRows ? "good" : "info"}>{hasRows ? "hydrated" : "waiting"}</StatusPill>
  );
}

function GpuMonitoringRow({ gpuMon }: { gpuMon?: SystemRuntimeInfo["gpu_monitoring"] }) {
  return (
    <SettingsRow
      label="GPU monitoring"
      description="nvidia-smi, amd-smi, or rocm-smi discovery from the controller."
      value={<SettingsValue mono>{gpuMonitorValue(gpuMon)}</SettingsValue>}
      status={
        <StatusPill tone={gpuMon?.available ? "good" : "warning"}>
          {gpuMon?.available ? "online" : "fallback"}
        </StatusPill>
      }
    />
  );
}

function GpuLeaseRow({ holder }: { holder?: string | null }) {
  return (
    <SettingsRow
      label="GPU lease"
      description="Current runtime lock holder when a launch or engine job owns the GPU lane."
      value={<SettingsValue mono>{holder ?? "No active lease"}</SettingsValue>}
      status={<StatusPill>{holder ? "held" : "free"}</StatusPill>}
    />
  );
}

function gpuMonitorValue(gpuMon: SystemRuntimeInfo["gpu_monitoring"] | undefined): string {
  if (!gpuMon?.available) {
    return "not available yet";
  }
  return gpuMon.tool ?? "available";
}

function EngineRows({
  activeBackend,
  jobs,
  onJobCreated,
  view,
}: {
  activeBackend?: string;
  jobs: EngineJob[];
  onJobCreated: () => Promise<void>;
  view: EngineRowsView;
}) {
  if (view.kind === "targets") {
    return view.targets.map((target) => (
      <RuntimeTargetRow
        key={target.id}
        target={target}
        job={jobForTarget(jobs, target)}
        onJobCreated={onJobCreated}
      />
    ));
  }
  if (view.kind === "backends") {
    return view.rows.map(({ id, info }) => (
      <BackendRow key={id} id={id} info={info} active={activeBackend === id} />
    ));
  }
  return view.engineIds.map((key) => (
    <SettingsRow
      key={key}
      label={ENGINE_META[key].label}
      description={ENGINE_META[key].description}
      value={<SettingsValue dim>Runtime data has not hydrated yet.</SettingsValue>}
      status={<StatusPill tone="info">pending</StatusPill>}
    />
  ));
}

function RuntimeTargetRow({
  target,
  job,
  onJobCreated,
}: {
  target: RuntimeTarget;
  job?: EngineJob;
  onJobCreated: () => Promise<void>;
}) {
  const meta = ENGINE_META[target.backend] ?? {
    label: target.backend,
    description: "Runtime target",
  };
  const running = isRunningJob(job);
  const action = target.capabilities.canUpdate
    ? target.installed
      ? "Update"
      : "Install"
    : "Configure";
  const actionDisabled = running || !target.capabilities.canUpdate;
  const disabledReason = !target.capabilities.canUpdate
    ? (target.health.message ?? "Updates are unsupported for this target.")
    : undefined;

  const handleAction = useCallback(async () => {
    if (actionDisabled) return;
    await api.createRuntimeJob({
      backend: target.backend,
      targetId: target.id,
      type: target.installed ? "update" : "install",
    });
    await onJobCreated();
  }, [actionDisabled, onJobCreated, target.backend, target.id, target.installed]);

  return (
    <SettingsRow
      label={target.label || meta.label}
      description={`${meta.description} · ${target.kind} · ${target.source}`}
      value={
        <SettingsValue mono>
          {target.installed ? (target.version ?? "installed") : "not installed"}
          {pathForTarget(target) ? ` · ${pathForTarget(target)}` : ""}
        </SettingsValue>
      }
      status={
        <EngineStatus
          installed={target.installed}
          active={target.active}
          health={target.health.status}
        />
      }
      actions={
        <SettingsButton
          onClick={() => void handleAction()}
          disabled={actionDisabled}
          title={disabledReason}
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : target.capabilities.canUpdate ? (
            <ArrowUpCircle className="h-3 w-3" />
          ) : (
            <Settings className="h-3 w-3" />
          )}
          {running ? job?.status : action}
        </SettingsButton>
      }
    >
      {job ? <JobMessage job={job} /> : null}
      {target.update ? <UpdateDetails update={target.update} /> : null}
      {disabledReason ? <p className="text-[11px] text-(--dim)">{disabledReason}</p> : null}
    </SettingsRow>
  );
}

function BackendRow({
  id,
  info,
  active,
}: {
  id: string;
  info: RuntimeBackendInfo;
  active?: boolean;
}) {
  const meta = ENGINE_META[id] ?? { label: id, description: "Runtime backend" };
  const [state, setState] = useState<UpgradeState>({ status: "idle" });
  const onUpgrade = upgradeHandler(id);

  const handleUpgrade = useCallback(async () => {
    if (!onUpgrade) return;
    setState({ status: "upgrading" });
    try {
      await onUpgrade();
      setState({ status: "success", message: "Upgrade complete" });
      setTimeout(() => setState({ status: "idle" }), 4000);
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Upgrade failed" });
      setTimeout(() => setState({ status: "idle" }), 6000);
    }
  }, [onUpgrade]);

  return (
    <SettingsRow
      label={meta.label}
      description={meta.description}
      value={
        <SettingsValue mono>
          {info.installed ? (info.version ?? "installed") : "not installed"}
        </SettingsValue>
      }
      status={<EngineStatus installed={info.installed} active={active} />}
      actions={
        onUpgrade && info.upgrade_command_available ? (
          <SettingsButton
            onClick={() => void handleUpgrade()}
            disabled={state.status === "upgrading"}
          >
            {state.status === "upgrading" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : state.status === "success" ? (
              <Check className="h-3 w-3 text-(--hl2)" />
            ) : state.status === "error" ? (
              <XCircle className="h-3 w-3 text-(--err)" />
            ) : (
              <ArrowUpCircle className="h-3 w-3" />
            )}
            {state.status === "idle" ? (info.installed ? "Update" : "Install") : state.status}
          </SettingsButton>
        ) : null
      }
    >
      {info.python_path || info.binary_path ? (
        <SettingsValue mono dim>
          {info.python_path ?? info.binary_path}
        </SettingsValue>
      ) : null}
      {state.status === "error" && state.message ? (
        <p className="truncate text-[11px] text-(--err)">{state.message}</p>
      ) : null}
    </SettingsRow>
  );
}

function EngineStatus({
  installed,
  active,
  health,
}: {
  installed: boolean;
  active?: boolean;
  health?: RuntimeTarget["health"]["status"];
}) {
  const tone: StatusTone = active
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
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

function JobMessage({ job }: { job: EngineJob }) {
  return (
    <div
      className={`space-y-1 text-[12px] ${job.status === "error" ? "text-(--err)/80" : "text-(--dim)/60"}`}
    >
      <p>{job.message}</p>
      {job.command ? <p className="truncate font-mono">{job.command}</p> : null}
      {job.error || job.outputTail ? (
        <p className="line-clamp-3 whitespace-pre-wrap font-mono">{job.error ?? job.outputTail}</p>
      ) : null}
    </div>
  );
}

function UpdateDetails({ update }: { update: NonNullable<RuntimeTarget["update"]> }) {
  return (
    <div className="grid gap-1.5 border-t border-(--border)/[0.06] pt-3 text-[12px] text-(--dim)/60">
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
        <span>current {update.currentVersion ?? "unknown"}</span>
        <span>target {update.targetVersion}</span>
        <span>{update.restartRequired ? "restart required" : "no restart"}</span>
      </div>
      <div className="font-mono text-[11px]">{update.packageSpec}</div>
      <div className="flex flex-wrap gap-1">
        {update.changes.map((change) => (
          <span
            key={change}
            className="rounded border border-(--border)/[0.08] px-1.5 py-[1px] text-[11px]"
          >
            {change}
          </span>
        ))}
      </div>
      <a
        href={update.releaseNotesUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-fit text-[12px] text-(--accent)/80 hover:underline"
      >
        release notes
      </a>
    </div>
  );
}

function pathForTarget(target: RuntimeTarget) {
  return target.pythonPath ?? target.binaryPath ?? target.dockerImage ?? "";
}

function upgradeHandler(id: string) {
  if (id === "vllm") return () => api.upgradeVllmRuntime();
  if (id === "sglang") return () => api.upgradeSglangRuntime();
  if (id === "llamacpp") return () => api.upgradeLlamacppRuntime();
  return undefined;
}
