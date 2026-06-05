"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowUpCircle, Check, Loader2, XCircle } from "lucide-react";
import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import api from "@/lib/api";
import type { EngineJob, RuntimeBackendInfo, RuntimeTarget, SystemRuntimeInfo } from "@/lib/types";
import {
  ENGINE_META,
  MANAGED_RUNTIME_BACKENDS,
  ManagedRuntimeInstallRows,
  RowDetailLine,
  RuntimeTargetRows,
  RuntimeTargetStatus,
  SettingsButton,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  StatusPill,
  isManagedRuntimeTarget,
  type ManagedRuntimeInstallBackend,
} from "@/ui";
import {
  hasHydratedEngineRows,
  resolveEngineRowsView,
  type EngineRowsView,
} from "./engines-section-model";

type UpgradeState = { status: "idle" | "upgrading" | "success" | "error"; message?: string };

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
        description="Model-serving runtimes installed on the controller host."
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
        description="GPU telemetry and lease state reported by the controller."
      >
        <GpuMonitoringRow gpuMon={gpuMon} />
        <GpuLeaseRow holder={lease?.holder} />
      </SettingsGroup>
    </div>
  );
}

const getEnginesSectionSnapshot = (): number => 0;

function HydrationStatus({ hasRows }: { hasRows: boolean }) {
  // Nothing to announce once the data is in — the rows speak for themselves, and
  // the page header already shows controller sync. Only surface a quiet hint
  // while the first payload is still loading.
  if (hasRows) return null;
  return <StatusPill tone="info">Loading…</StatusPill>;
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
  const handleTargetAction = useCallback(
    async (target: RuntimeTarget) => {
      await api.createRuntimeJob({
        backend: target.backend,
        targetId: target.id,
        type: target.installed ? "update" : "install",
      });
      await onJobCreated();
    },
    [onJobCreated],
  );
  const handleManagedInstall = useCallback(
    async (backend: ManagedRuntimeInstallBackend) => {
      await api.createRuntimeJob({ backend, type: "install" });
      await onJobCreated();
    },
    [onJobCreated],
  );

  if (view.kind === "targets") {
    const discoveredTargets = view.targets.filter((target) => !isManagedRuntimeTarget(target));
    return (
      <>
        <ManagedRuntimeInstallRows
          backends={MANAGED_RUNTIME_BACKENDS}
          targets={view.targets}
          jobs={jobs}
          onInstall={handleManagedInstall}
          onUpdateTarget={handleTargetAction}
        />
        {discoveredTargets.length > 0 ? (
          <RuntimeTargetRows
            targets={discoveredTargets}
            jobs={jobs}
            onAction={handleTargetAction}
          />
        ) : null}
      </>
    );
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
      variant="resource"
      label={meta.label}
      description={meta.description}
      value={
        <SettingsValue mono truncate>
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
        <RowDetailLine mono truncate size="md">
          {info.python_path ?? info.binary_path}
        </RowDetailLine>
      ) : null}
      {state.status === "error" && state.message ? (
        <RowDetailLine tone="danger" truncate>
          {state.message}
        </RowDetailLine>
      ) : null}
    </SettingsRow>
  );
}

function EngineStatus({ installed, active }: { installed: boolean; active?: boolean }) {
  return <RuntimeTargetStatus installed={installed} active={active} />;
}

function upgradeHandler(id: string) {
  if (id === "vllm") return () => api.upgradeVllmRuntime();
  if (id === "sglang") return () => api.upgradeSglangRuntime();
  if (id === "llamacpp") return () => api.upgradeLlamacppRuntime();
  return undefined;
}
