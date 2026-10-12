import { Stat, StatusPill, type UiTone } from "@/ui";
import { SettingsFactRows, SettingsGroup, type SettingsFactRow } from "./settings-ui";
import type { ApiConnectionSettings } from "./types";
import type { CompatibilityCheck, CompatibilityReport, ConfigData, ServiceInfo } from "@/lib/types";

export function ServicesSettings({
  data,
  apiSettings,
  loading,
  error,
}: {
  data: ConfigData | null;
  apiSettings: ApiConnectionSettings;
  loading: boolean;
  error: string | null;
}) {
  const services = data?.services ?? [];
  const rows = services.length ? services : fallbackServices(data, apiSettings, loading);
  const tone = services.length ? "good" : error ? "warning" : "info";

  return (
    <SettingsGroup
      title="Services & endpoints"
      description="Controller, inference, and desktop endpoints used by this installation."
      actions={
        <StatusPill tone={tone}>
          {services.length ? `${services.length} live` : "fallback"}
        </StatusPill>
      }
      collapsible
      defaultOpen={false}
    >
      <SettingsFactRows
        rows={[...rows.map(serviceFactRow), ...endpointFactRows(data, apiSettings)]}
      />
    </SettingsGroup>
  );
}

export function SystemOverview({
  data,
  compatibilityReport,
  loading,
  error,
}: {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  loading: boolean;
  error: string | null;
}) {
  const runtime = data?.runtime;
  const checks = compatibilityReport?.checks ?? [];
  const actionableChecks = checks.filter((check) => check.severity !== "info");
  const controllerState = data ? "Synced" : loading ? "Checking" : "Fallback";
  const controllerTone: UiTone = data ? "good" : error ? "warning" : "info";
  const compatibilityState = !compatibilityReport
    ? "Checking"
    : actionableChecks.length
      ? `${actionableChecks.length} issue${actionableChecks.length === 1 ? "" : "s"}`
      : "Clear";

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-start justify-between gap-4 px-1">
        <div>
          <h3 className="text-[length:var(--fs-lg)] font-medium tracking-[-0.01em] text-(--ui-fg)">
            System snapshot
          </h3>
          <p className="mt-1 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
            Live controller state at a glance. Expand a section only when you need to act.
          </p>
        </div>
        <StatusPill tone={controllerTone}>{controllerState.toLowerCase()}</StatusPill>
      </div>
      <dl className="grid grid-cols-2 border-y border-(--ui-separator) py-4 sm:grid-cols-4">
        <Stat label="Controller" value={controllerState} />
        <Stat label="Platform" value={runtime?.platform.kind ?? "Unknown"} />
        <Stat label="GPUs" value={runtime?.gpus.count ?? "—"} />
        <Stat label="Compatibility" value={compatibilityState} />
      </dl>
      {error ? (
        <p className="mt-2 px-1 text-[length:var(--fs-sm)] text-(--ui-warning)">{error}</p>
      ) : null}
    </section>
  );
}

export function SystemDetails({
  data,
  compatibilityReport,
}: {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
}) {
  return (
    <div>
      <SettingsGroup
        title="Machine details"
        description="Ports, paths, platform versions, and GPU inventory reported by the controller."
        collapsible
        defaultOpen={false}
      >
        <SettingsFactRows rows={machineFactRows(data)} />
      </SettingsGroup>
      <CompatibilitySettings
        checks={compatibilityReport?.checks ?? []}
        report={compatibilityReport}
      />
    </div>
  );
}

function CompatibilitySettings({
  checks,
  report,
}: {
  checks: CompatibilityCheck[];
  report: CompatibilityReport | null;
}) {
  const ordered = [...checks].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const actionableChecks = ordered.filter((check) => check.severity !== "info");
  const tone: UiTone = !report ? "info" : actionableChecks.length ? "warning" : "good";

  return (
    <SettingsGroup
      title="Compatibility"
      description="Diagnostics and suggested fixes from the controller probe."
      actions={
        <StatusPill tone={tone}>
          {!report ? "pending" : actionableChecks.length ? "review" : "clear"}
        </StatusPill>
      }
      collapsible
      defaultOpen={actionableChecks.length > 0}
    >
      {!report ? (
        <SettingsFactRows
          rows={[
            {
              label: "Report",
              value: "Waiting for the compatibility probe",
              dim: true,
            },
          ]}
        />
      ) : ordered.length === 0 ? (
        <SettingsFactRows rows={[{ label: "Report", value: "No issues detected" }]} />
      ) : (
        <SettingsFactRows rows={ordered.map(compatibilityFactRow)} />
      )}
    </SettingsGroup>
  );
}

function endpointFactRows(
  data: ConfigData | null,
  apiSettings: ApiConnectionSettings,
): SettingsFactRow[] {
  return [
    {
      label: "Controller URL",
      value: data?.environment.controller_url ?? apiSettings.backendUrl,
      mono: true,
      status: { label: data ? "live" : "saved", tone: data ? "good" : "info" },
    },
    {
      label: "Inference URL",
      value: data?.environment.inference_url ?? "http://127.0.0.1:8000",
      mono: true,
    },
    {
      label: "Frontend URL",
      value: data?.environment.frontend_url ?? "http://localhost:3001",
      mono: true,
    },
  ];
}

function machineFactRows(data: ConfigData | null): SettingsFactRow[] {
  return [...networkFactRows(data), ...storageFactRows(data), ...runtimeFactRows(data)];
}

function networkFactRows(data: ConfigData | null): SettingsFactRow[] {
  const config = data?.config;

  return [
    { label: "Host", value: config?.host ?? "127.0.0.1", mono: true },
    { label: "Controller port", value: config?.port ?? 8080, mono: true },
    { label: "Inference port", value: config?.inference_port ?? 8000, mono: true },
  ];
}

function storageFactRows(data: ConfigData | null): SettingsFactRow[] {
  const config = data?.config;

  return [
    {
      label: "Models directory",
      value: config?.models_dir ?? "~/models",
      mono: true,
      truncate: true,
    },
    { label: "Data directory", value: config?.data_dir ?? "data/", mono: true, truncate: true },
    { label: "Database", value: config?.db_path ?? "data/studio.db", mono: true, truncate: true },
  ];
}

function runtimeFactRows(data: ConfigData | null): SettingsFactRow[] {
  const runtime = data?.runtime;
  const gpuCount = runtime?.gpus.count ?? 0;

  return [
    { label: "Platform", value: runtime?.platform.kind ?? "unknown" },
    {
      label: "GPU types",
      value: runtime?.gpus.types.length ? runtime.gpus.types.join(", ") : "Unknown",
      truncate: true,
    },
    {
      label: "GPU count",
      value: gpuCount,
      mono: true,
      status: {
        label: gpuCount ? "detected" : "not detected",
        tone: gpuCount ? "good" : "default",
      },
    },
    { label: "CUDA driver", value: runtime?.cuda.driver_version ?? "Unknown", mono: true },
    { label: "CUDA runtime", value: runtime?.cuda.cuda_version ?? "Unknown", mono: true },
    { label: "ROCm", value: runtime?.platform.rocm?.rocm_version ?? "Not in use", mono: true },
  ];
}

function fallbackServices(
  data: ConfigData | null,
  apiSettings: ApiConnectionSettings,
  loading: boolean,
): ServiceInfo[] {
  return [
    {
      name: "Controller",
      port: portFromUrl(apiSettings.backendUrl) ?? 8080,
      internal_port: 8080,
      protocol: "http",
      status: loading ? "checking" : data ? "ready" : "fallback",
      description: apiSettings.backendUrl || "Controller URL not saved yet",
    },
    {
      name: "Inference",
      port: data?.config.inference_port ?? 8000,
      internal_port: data?.config.inference_port ?? 8000,
      protocol: "http",
      status: data ? "ready" : "fallback",
      description: data?.environment.inference_url ?? "Model server endpoint hydrates from /config",
    },
    {
      name: "Frontend",
      port: portFromUrl(data?.environment.frontend_url ?? "") ?? 3001,
      internal_port: 3001,
      protocol: "http",
      status: "ready",
      description: data?.environment.frontend_url ?? "Local desktop/web shell",
    },
  ];
}

function serviceFactRow(service: ServiceInfo): SettingsFactRow {
  return {
    key: `${service.name}-${service.port}`,
    label: service.name,
    description: service.description ?? "No description reported",
    value: `${service.protocol.toUpperCase()} :${service.port}${
      service.port !== service.internal_port ? ` → :${service.internal_port}` : ""
    }`,
    mono: true,
    status: { label: service.status, tone: toneForStatus(service.status) },
  };
}

function compatibilityFactRow(check: CompatibilityCheck): SettingsFactRow {
  return {
    key: check.id,
    label: check.severity.toUpperCase(),
    description: check.message,
    value: check.evidence ?? check.suggested_fix ?? "No extra evidence",
    dim: true,
    status: { label: check.severity, tone: severityTone(check.severity) },
  };
}

function portFromUrl(value: string): number | null {
  try {
    const parsed = new URL(value);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

function toneForStatus(status: string): UiTone {
  const normalized = status.toLowerCase();
  if (normalized.includes("ready") || normalized.includes("running") || normalized.includes("ok")) {
    return "good";
  }
  if (normalized.includes("error") || normalized.includes("down") || normalized.includes("fail")) {
    return "danger";
  }
  if (
    normalized.includes("fallback") ||
    normalized.includes("check") ||
    normalized.includes("warn")
  ) {
    return "warning";
  }
  return "default";
}

function severityRank(severity: CompatibilityCheck["severity"]): number {
  if (severity === "error") return 0;
  if (severity === "warn") return 1;
  return 2;
}

function severityTone(severity: CompatibilityCheck["severity"]): UiTone {
  if (severity === "error") return "danger";
  if (severity === "warn") return "warning";
  return "info";
}
