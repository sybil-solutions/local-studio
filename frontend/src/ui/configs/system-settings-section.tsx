import {
  SettingsFactRows,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  StatusPill,
  type SettingsFactRow,
  type StatusTone,
} from "@/ui";
import type { ApiConnectionSettings } from "@/lib/configs/types";
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
  return (
    <div className="space-y-5">
      <ServiceTopologyGroup data={data} apiSettings={apiSettings} loading={loading} error={error} />
      <EnvironmentUrlsGroup data={data} apiSettings={apiSettings} />
    </div>
  );
}

function ServiceTopologyGroup({
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
  const label = services.length ? `${services.length} live` : "fallback";
  return (
    <SettingsGroup
      title="Service topology"
      description="Live service rows when the controller answers; stable fallback rows when it does not."
      actions={<StatusPill tone={tone}>{label}</StatusPill>}
    >
      <SettingsFactRows rows={rows.map(serviceFactRow)} />
    </SettingsGroup>
  );
}

function EnvironmentUrlsGroup({
  data,
  apiSettings,
}: {
  data: ConfigData | null;
  apiSettings: ApiConnectionSettings;
}) {
  return (
    <SettingsGroup
      title="Environment URLs"
      description="Endpoints used by the desktop app and browser proxy."
    >
      <SettingsFactRows
        rows={[
          {
            label: "Controller",
            description: "API control plane and runtime status source.",
            value: data?.environment.controller_url ?? apiSettings.backendUrl,
            mono: true,
            status: { label: data ? "live" : "saved", tone: data ? "good" : "info" },
          },
          {
            label: "Inference",
            description: "OpenAI-compatible model server target.",
            value: data?.environment.inference_url ?? "http://127.0.0.1:8000",
            mono: true,
            status: { label: data ? "reported" : "default" },
          },
          {
            label: "Frontend",
            description: "Next.js route that Electron loads in development and production.",
            value: data?.environment.frontend_url ?? "http://localhost:3001",
            mono: true,
            status: { label: data ? "reported" : "local" },
          },
        ]}
      />
    </SettingsGroup>
  );
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
export function SystemSettings({
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
  return (
    <div className="space-y-5">
      <ControllerStateGroup data={data} loading={loading} error={error} />
      <NetworkSettingsGroup data={data} />
      <StorageSettingsGroup data={data} />
      <HardwareSettingsGroup data={data} />
      <CompatibilitySettings
        checks={compatibilityReport?.checks ?? []}
        report={compatibilityReport}
      />
    </div>
  );
}

function ControllerStateGroup({
  data,
  loading,
  error,
}: {
  data: ConfigData | null;
  loading: boolean;
  error: string | null;
}) {
  const tone = data ? "good" : error ? "warning" : "info";
  return (
    <SettingsGroup
      title="Controller state"
      description="System details hydrate independently so settings never collapse into a blank page."
      actions={
        <StatusPill tone={tone}>{data ? "live" : loading ? "checking" : "fallback"}</StatusPill>
      }
    >
      <SettingsRow
        label="Config status"
        description="Last /config response or stable fallback mode."
        value={
          <SettingsValue>
            {data ? "Loaded from controller" : error || "Waiting for first controller response"}
          </SettingsValue>
        }
        status={<StatusPill tone={tone}>{data ? "loaded" : "fallback"}</StatusPill>}
      />
    </SettingsGroup>
  );
}

function NetworkSettingsGroup({ data }: { data: ConfigData | null }) {
  const config = data?.config;
  return (
    <SettingsGroup title="Network" description="Controller and inference ports from config.">
      <SettingsFactRows
        rows={[
          { label: "Host", value: config?.host ?? "127.0.0.1", mono: true },
          { label: "Controller port", value: config?.port ?? 8080, mono: true },
          { label: "Inference port", value: config?.inference_port ?? 8000, mono: true },
          {
            label: "API key",
            value: config?.api_key_configured ? "Configured" : "Not configured",
            status: {
              label: config?.api_key_configured ? "stored" : "optional",
              tone: config?.api_key_configured ? "good" : "default",
            },
          },
        ]}
      />
    </SettingsGroup>
  );
}

function StorageSettingsGroup({ data }: { data: ConfigData | null }) {
  const config = data?.config;
  return (
    <SettingsGroup
      title="Storage"
      description="File paths remain explicit instead of being hidden in cards."
    >
      <SettingsFactRows
        rows={[
          pathFactRow("Models", config?.models_dir, "~/models"),
          pathFactRow("Data", config?.data_dir, "data/"),
          pathFactRow("Database", config?.db_path, "data/studio.db"),
        ]}
      />
    </SettingsGroup>
  );
}

function HardwareSettingsGroup({ data }: { data: ConfigData | null }) {
  const runtime = data?.runtime;
  const gpuCount = runtime?.gpus.count ?? 0;
  return (
    <SettingsGroup
      title="Hardware"
      description="Runtime platform and GPU inventory from compatibility/config probes."
    >
      <SettingsFactRows
        rows={[
          { label: "Platform", value: runtime?.platform.kind ?? "unknown" },
          {
            label: "GPU types",
            value: runtime?.gpus.types.length ? runtime.gpus.types.join(", ") : "Unknown",
          },
          { label: "CUDA driver", value: runtime?.cuda.driver_version ?? "Unknown", mono: true },
          { label: "CUDA runtime", value: runtime?.cuda.cuda_version ?? "Unknown", mono: true },
          {
            label: "ROCm version",
            value: runtime?.platform.rocm?.rocm_version ?? "Unknown",
            mono: true,
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
        ]}
      />
    </SettingsGroup>
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
  return (
    <SettingsGroup
      title="Compatibility"
      description="Warnings and fixes are rows; a clean or missing report still has a stable value."
      actions={
        <StatusPill tone={!report ? "info" : ordered.length ? "warning" : "good"}>
          {!report ? "pending" : ordered.length ? `${ordered.length} checks` : "clean"}
        </StatusPill>
      }
    >
      {!report ? (
        <SettingsFactRows
          rows={[
            {
              label: "Report",
              description: "Compatibility probe has not returned yet.",
              value: "Waiting for /compat; settings remain usable.",
              dim: true,
              status: { label: "pending", tone: "info" },
            },
          ]}
        />
      ) : ordered.length === 0 ? (
        <SettingsFactRows
          rows={[
            {
              label: "Compatibility",
              description: "Controller reported no compatibility issues.",
              value: "No issues detected",
              status: { label: "clean", tone: "good" },
            },
          ]}
        />
      ) : (
        <SettingsFactRows rows={ordered.map(compatibilityFactRow)} />
      )}
    </SettingsGroup>
  );
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
function pathFactRow(
  label: string,
  value: string | null | undefined,
  fallback: string,
): SettingsFactRow {
  return {
    label,
    description: "Filesystem path reported by the controller or a stable default.",
    value: value || fallback,
    mono: true,
    status: { label: value ? "reported" : "fallback", tone: value ? "good" : "default" },
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
function portFromUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}
function toneForStatus(status: string): StatusTone {
  const normalized = status.toLowerCase();
  if (normalized.includes("ready") || normalized.includes("running") || normalized.includes("ok"))
    return "good";
  if (normalized.includes("error") || normalized.includes("down") || normalized.includes("fail"))
    return "danger";
  if (
    normalized.includes("fallback") ||
    normalized.includes("check") ||
    normalized.includes("warn")
  )
    return "warning";
  return "default";
}
function severityRank(severity: CompatibilityCheck["severity"]) {
  if (severity === "error") return 0;
  if (severity === "warn") return 1;
  return 2;
}
function severityTone(severity: CompatibilityCheck["severity"]): StatusTone {
  if (severity === "error") return "danger";
  if (severity === "warn") return "warning";
  return "info";
}
