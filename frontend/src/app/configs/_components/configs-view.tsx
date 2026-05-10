// CRITICAL
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Cable,
  Cpu,
  GraduationCap,
  Plug,
  type LucideIcon,
  Paintbrush,
  ServerCog,
} from "lucide-react";
import type { CompatibilityCheck, CompatibilityReport, ConfigData, ServiceInfo } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "../hooks/use-configs";
import { ApiConnectionSection } from "./api-connection-section";
import { AppearanceSettings } from "./appearance-settings";
import { EnginesSection } from "./engines-section";
import { useSidebarStatus } from "@/hooks/use-sidebar-status";
import {
  EmptySafeNotice,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsLayout,
  SettingsRow,
  SettingsValue,
  StatusPill,
  type SettingsSectionDef,
  type SettingsSectionId,
  type StatusTone,
} from "@/components/settings-primitives";

interface ConfigsViewProps {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  loading: boolean;
  error: string | null;
  apiSettings: ApiConnectionSettings;
  apiSettingsLoading: boolean;
  showApiKey: boolean;
  saving: boolean;
  testing: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  hasConfigData: boolean;
  isInitialLoading: boolean;
  onReload: () => void;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onToggleApiKey: () => void;
  onTestConnection: () => void;
  onSaveSettings: () => void;
}

const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;

const SECTIONS: SettingsSectionDef[] = [
  ["connection", "Connection", "Controller URL, API key, voice defaults.", Cable],
  ["engines", "Engines / Services / System", "Runtime targets, services, storage, hardware.", Cpu],
  ["appearance", "Appearance", "Theme variables, typography, density.", Paintbrush],
  ["archive", "Archived chats", "Hidden Pi sessions tracked by stable ID.", Archive],
  ["plugins", "Plugins", "Codex plugin discovery and composer availability.", Plug],
  [
    "skills",
    "Skills",
    "Normalized local skills from Codex, Pi, Claude, Factory, OpenCode.",
    GraduationCap,
  ],
  ["setup", "Setup", "First-run checks for Pi, controller, and local directories.", ServerCog],
].map(([id, label, description, Icon]) => ({
  id: id as SettingsSectionId,
  label: label as string,
  description: description as string,
  icon: sectionIcon(Icon as LucideIcon),
}));

const isSectionId = (value: string): value is SettingsSectionId =>
  SECTIONS.some((section) => section.id === value);

export function ConfigsView({
  data,
  compatibilityReport,
  loading,
  error,
  apiSettings,
  apiSettingsLoading,
  showApiKey,
  saving,
  testing,
  connectionStatus,
  statusMessage,
  hasConfigData,
  isInitialLoading,
  onReload,
  onApiSettingsChange,
  onToggleApiKey,
  onTestConnection,
  onSaveSettings,
}: ConfigsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => {
    if (typeof window === "undefined") return "connection";
    const hash = window.location.hash.replace("#", "");
    return isSectionId(hash) ? hash : "connection";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (isSectionId(hash)) setActiveSection(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${section}`);
    }
  };

  const layoutStatus = useMemo(() => {
    if (isInitialLoading) return "checking controller";
    if (loading) return "refreshing";
    if (hasConfigData) return "controller synced";
    if (error) return "local fallbacks";
    return "ready";
  }, [error, hasConfigData, isInitialLoading, loading]);

  return (
    <SettingsLayout
      sections={SECTIONS}
      activeSection={activeSection}
      title="Settings"
      status={layoutStatus}
      loading={loading}
      onReload={onReload}
      onSelectSection={selectSection}
    >
      {activeSection === "connection" ? (
        <ApiConnectionSection
          apiSettingsLoading={apiSettingsLoading}
          apiSettings={apiSettings}
          showApiKey={showApiKey}
          testing={testing}
          saving={saving}
          connectionStatus={connectionStatus}
          statusMessage={statusMessage}
          onApiSettingsChange={onApiSettingsChange}
          onToggleApiKey={onToggleApiKey}
          onTestConnection={onTestConnection}
          onSave={onSaveSettings}
        />
      ) : null}

      {activeSection === "engines" ? (
        <div className="space-y-5">
          <EnginesSection runtime={data?.runtime ?? null} />
          <ServicesSettings data={data} apiSettings={apiSettings} loading={loading} error={error} />
          <SystemSettings
            data={data}
            compatibilityReport={compatibilityReport}
            loading={loading}
            error={error}
          />
        </div>
      ) : null}
      {activeSection === "appearance" ? <AppearanceSettings /> : null}
      {activeSection === "archive" ? <ArchivedChatsSettings /> : null}
      {activeSection === "plugins" ? <PluginsSettings /> : null}
      {activeSection === "skills" ? <SkillsSettings /> : null}
      {activeSection === "setup" ? <SetupChecksSettings /> : null}
    </SettingsLayout>
  );
}

function ServicesSettings({
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
  const fallbackServices: ServiceInfo[] = [
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
  const rows = services.length ? services : fallbackServices;

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Service topology"
        description="Live service rows when the controller answers; stable fallback rows when it does not."
        actions={
          <StatusPill tone={services.length ? "good" : error ? "warning" : "info"}>
            {services.length ? `${services.length} live` : "fallback"}
          </StatusPill>
        }
      >
        {rows.map((service) => (
          <SettingsRow
            key={`${service.name}-${service.port}`}
            label={service.name}
            description={service.description ?? "No description reported"}
            value={
              <SettingsValue mono>
                {service.protocol.toUpperCase()} :{service.port}
                {service.port !== service.internal_port ? ` → :${service.internal_port}` : ""}
              </SettingsValue>
            }
            status={<StatusPill tone={toneForStatus(service.status)}>{service.status}</StatusPill>}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Environment URLs"
        description="Endpoints used by the desktop app and browser proxy."
      >
        <SettingsRow
          label="Controller"
          description="API control plane and runtime status source."
          value={
            <SettingsValue mono>
              {data?.environment.controller_url ?? apiSettings.backendUrl}
            </SettingsValue>
          }
          status={<StatusPill tone={data ? "good" : "info"}>{data ? "live" : "saved"}</StatusPill>}
        />
        <SettingsRow
          label="Inference"
          description="OpenAI-compatible model server target."
          value={
            <SettingsValue mono>
              {data?.environment.inference_url ?? "http://127.0.0.1:8000"}
            </SettingsValue>
          }
          status={<StatusPill>{data ? "reported" : "default"}</StatusPill>}
        />
        <SettingsRow
          label="Frontend"
          description="Next.js route that Electron loads in development and production."
          value={
            <SettingsValue mono>
              {data?.environment.frontend_url ?? "http://localhost:3001"}
            </SettingsValue>
          }
          status={<StatusPill>{data ? "reported" : "local"}</StatusPill>}
        />
      </SettingsGroup>
    </div>
  );
}

function SystemSettings({
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
  const config = data?.config;
  const checks = compatibilityReport?.checks ?? [];
  const gpuCount = runtime?.gpus.count ?? 0;
  const networkRows = [
    ["Host", config?.host ?? "127.0.0.1"],
    ["Controller port", config?.port ?? 8080],
    ["Inference port", config?.inference_port ?? 8000],
  ] as const;
  const hardwareRows = [
    ["Platform", runtime?.platform.kind ?? "unknown"],
    ["GPU types", runtime?.gpus.types.length ? runtime.gpus.types.join(", ") : "Unknown"],
    ["CUDA driver", runtime?.cuda.driver_version ?? "Unknown", true],
    ["CUDA runtime", runtime?.cuda.cuda_version ?? "Unknown", true],
    ["ROCm version", runtime?.platform.rocm?.rocm_version ?? "Unknown", true],
  ] as const;

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Controller state"
        description="System details hydrate independently so settings never collapse into a blank page."
        actions={
          <StatusPill tone={data ? "good" : error ? "warning" : "info"}>
            {data ? "live" : loading ? "checking" : "fallback"}
          </StatusPill>
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
          status={
            <StatusPill tone={data ? "good" : error ? "warning" : "info"}>
              {data ? "loaded" : "fallback"}
            </StatusPill>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Network" description="Controller and inference ports from config.">
        {networkRows.map(([label, value]) => (
          <SettingsRow
            key={label}
            label={label}
            value={<SettingsValue mono>{value}</SettingsValue>}
          />
        ))}
        <SettingsRow
          label="API key"
          value={
            <SettingsValue>
              {config?.api_key_configured ? "Configured" : "Not configured"}
            </SettingsValue>
          }
          status={
            <StatusPill tone={config?.api_key_configured ? "good" : "default"}>
              {config?.api_key_configured ? "stored" : "optional"}
            </StatusPill>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Storage"
        description="File paths remain explicit instead of being hidden in cards."
      >
        <PathRow label="Models" value={config?.models_dir} fallback="~/models" />
        <PathRow label="Data" value={config?.data_dir} fallback="data/" />
        <PathRow label="Database" value={config?.db_path} fallback="data/studio.db" />
      </SettingsGroup>

      <SettingsGroup
        title="Hardware"
        description="Runtime platform and GPU inventory from compatibility/config probes."
      >
        {hardwareRows.map(([label, value, mono]) => (
          <SettingsRow
            key={label}
            label={label}
            value={<SettingsValue mono={mono}>{value}</SettingsValue>}
          />
        ))}
        <SettingsRow
          label="GPU count"
          value={<SettingsValue mono>{gpuCount}</SettingsValue>}
          status={
            <StatusPill tone={gpuCount ? "good" : "default"}>
              {gpuCount ? "detected" : "not detected"}
            </StatusPill>
          }
        />
      </SettingsGroup>

      <CompatibilitySettings checks={checks} report={compatibilityReport} />
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
        <SettingsRow
          label="Report"
          description="Compatibility probe has not returned yet."
          value={<SettingsValue dim>Waiting for /compat; settings remain usable.</SettingsValue>}
          status={<StatusPill tone="info">pending</StatusPill>}
        />
      ) : ordered.length === 0 ? (
        <SettingsRow
          label="Compatibility"
          description="Controller reported no compatibility issues."
          value={<SettingsValue>No issues detected</SettingsValue>}
          status={<StatusPill tone="good">clean</StatusPill>}
        />
      ) : (
        ordered.map((check) => (
          <SettingsRow
            key={check.id}
            label={check.severity.toUpperCase()}
            description={check.message}
            value={
              <SettingsValue dim>
                {check.evidence ?? check.suggested_fix ?? "No extra evidence"}
              </SettingsValue>
            }
            status={<StatusPill tone={severityTone(check.severity)}>{check.severity}</StatusPill>}
          />
        ))
      )}
    </SettingsGroup>
  );
}

function ArchivedChatsSettings() {
  type Pref = { title?: string; pinned?: boolean; hidden?: boolean };
  type Session = {
    id: string;
    projectName?: string;
    projectPath?: string;
    firstUserMessage?: string | null;
    updatedAt?: string;
  };
  const [prefs, setPrefs] = useState<Record<string, Pref>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("vllm-studio.agent.sessionPrefs");
      return raw ? (JSON.parse(raw) as Record<string, Pref>) : {};
    } catch {
      return {};
    }
  });
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    void fetch("/api/agent/sessions/all?since=365d", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ sessions?: Session[] }>)
      .then((payload) => setSessions(payload.sessions ?? []))
      .catch(() => setSessions([]));
  }, []);

  const archivedIds = Object.entries(prefs)
    .filter(([, pref]) => pref.hidden)
    .map(([id]) => id);
  const byId = new Map(sessions.map((session) => [session.id, session]));

  const unarchive = (id: string) => {
    const next = { ...prefs, [id]: { ...prefs[id], hidden: undefined } };
    if (!next[id].title && !next[id].pinned && !next[id].hidden) delete next[id];
    localStorage.setItem("vllm-studio.agent.sessionPrefs", JSON.stringify(next));
    window.dispatchEvent(new Event("vllm-studio.agent.sessionPrefs.changed"));
    setPrefs(next);
  };

  return (
    <SettingsGroup
      title="Archived chats"
      description="Archived sessions are hidden from normal session lists and restart hydration by stable Pi session ID."
      actions={<StatusPill>{archivedIds.length} archived</StatusPill>}
    >
      {archivedIds.length === 0 ? (
        <SettingsRow
          label="Archive"
          description="Use a session row menu to archive instead of deleting from disk."
          value={<SettingsValue dim>No archived chats.</SettingsValue>}
          status={<StatusPill>empty</StatusPill>}
        />
      ) : (
        archivedIds.map((id) => {
          const session = byId.get(id);
          const pref = prefs[id] ?? {};
          return (
            <SettingsRow
              key={id}
              label={pref.title || session?.firstUserMessage || id}
              description={
                session?.projectPath ||
                "Session metadata will hydrate when its project is available."
              }
              value={<SettingsValue mono>{id}</SettingsValue>}
              status={<StatusPill tone="info">archived</StatusPill>}
              actions={<SettingsButton onClick={() => unarchive(id)}>Restore</SettingsButton>}
            >
              <div className="text-[11px] text-(--dim)">
                {session?.projectName ? `${session.projectName} · ` : ""}
                {session?.updatedAt ?? "no timestamp"}
              </div>
            </SettingsRow>
          );
        })
      )}
    </SettingsGroup>
  );
}

function PluginsSettings() {
  type Plugin = {
    id: string;
    name: string;
    source?: string;
    path: string;
    installed: boolean;
    enabled: boolean;
    description?: string;
    appIds?: string[];
  };
  type PluginRuntimeCheck = {
    skillConfigured?: boolean;
    mcpConfigured?: boolean;
    appConfigured?: boolean;
    mcpExecutableExists?: boolean;
    note?: string;
  };
  type PluginValidation = {
    browserUseAvailable?: boolean;
    browserUseRuntime?: PluginRuntimeCheck | null;
    computerUseAvailable?: boolean;
    computerUseRuntime?: PluginRuntimeCheck | null;
  };
  type Marketplace = {
    name: string;
    source?: string;
    sourceType?: string;
    lastUpdated?: string;
  };
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [marketplaceSource, setMarketplaceSource] = useState("");
  const [validation, setValidation] = useState<PluginValidation | null>(null);
  const [savingPlugin, setSavingPlugin] = useState<string | null>(null);
  const [upgradingMarketplace, setUpgradingMarketplace] = useState<string | null>(null);
  const browserUse = plugins.find((plugin) => plugin.name.includes("browser-use")) ?? null;
  const computerUse = plugins.find((plugin) => plugin.name.includes("computer-use")) ?? null;

  const loadPlugins = () =>
    fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
      .then(
        (res) =>
          res.json() as Promise<{
            plugins?: Plugin[];
            marketplaces?: Marketplace[];
            validation?: PluginValidation;
          }>,
      )
      .then((payload) => {
        setPlugins(payload.plugins ?? []);
        setMarketplaces(payload.marketplaces ?? []);
        setValidation(payload.validation ?? null);
      })
      .catch(() => {
        setPlugins([]);
        setMarketplaces([]);
        setValidation({ browserUseAvailable: false, computerUseAvailable: false });
      });

  useEffect(() => {
    void loadPlugins();
  }, []);

  const setPluginEnabled = (plugin: Plugin, enabled: boolean) => {
    setSavingPlugin(plugin.id);
    void fetch("/api/agent/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: plugin.name, source: plugin.source, enabled }),
    })
      .then(
        (res) =>
          res.json() as Promise<{
            plugins?: Plugin[];
            marketplaces?: Marketplace[];
            validation?: PluginValidation;
          }>,
      )
      .then((payload) => {
        setPlugins(payload.plugins ?? []);
        setMarketplaces(payload.marketplaces ?? []);
        setValidation(payload.validation ?? null);
      })
      .catch(() => void loadPlugins())
      .finally(() => setSavingPlugin(null));
  };

  const upgradeMarketplace = (marketplace?: Marketplace) => {
    const key = marketplace?.name ?? "all";
    setUpgradingMarketplace(key);
    void fetch("/api/agent/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "upgrade_marketplace", name: marketplace?.name }),
    })
      .then(
        (res) =>
          res.json() as Promise<{
            plugins?: Plugin[];
            marketplaces?: Marketplace[];
            validation?: PluginValidation;
          }>,
      )
      .then((payload) => {
        setPlugins(payload.plugins ?? []);
        setMarketplaces(payload.marketplaces ?? []);
        setValidation(payload.validation ?? null);
      })
      .catch(() => void loadPlugins())
      .finally(() => setUpgradingMarketplace(null));
  };

  const addMarketplace = () => {
    const source = marketplaceSource.trim();
    if (!source) return;
    setUpgradingMarketplace("add");
    void fetch("/api/agent/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add_marketplace", source }),
    })
      .then(
        (res) =>
          res.json() as Promise<{
            plugins?: Plugin[];
            marketplaces?: Marketplace[];
            validation?: PluginValidation;
          }>,
      )
      .then((payload) => {
        setPlugins(payload.plugins ?? []);
        setMarketplaces(payload.marketplaces ?? []);
        setValidation(payload.validation ?? null);
        setMarketplaceSource("");
      })
      .catch(() => void loadPlugins())
      .finally(() => setUpgradingMarketplace(null));
  };

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Plugin marketplaces"
        description="Uses Codex marketplace metadata and the Codex CLI upgrade path instead of a vLLM-specific plugin registry."
        actions={
          <SettingsButton
            onClick={() => upgradeMarketplace()}
            disabled={upgradingMarketplace === "all"}
          >
            Upgrade all
          </SettingsButton>
        }
      >
        {marketplaces.length ? (
          marketplaces.map((marketplace) => (
            <SettingsRow
              key={marketplace.name}
              label={marketplace.name}
              description={marketplace.source ?? "No source reported"}
              value={
                <SettingsValue>
                  {marketplace.sourceType ?? "source"} · {marketplace.lastUpdated ?? "never"}
                </SettingsValue>
              }
              actions={
                <SettingsButton
                  onClick={() => upgradeMarketplace(marketplace)}
                  disabled={upgradingMarketplace === marketplace.name}
                >
                  Upgrade
                </SettingsButton>
              }
            />
          ))
        ) : (
          <EmptySafeNotice>No Codex plugin marketplaces found in config.</EmptySafeNotice>
        )}
        <SettingsRow
          label="Add marketplace"
          description="Accepts the same source syntax as Codex: owner/repo[@ref], Git URL, SSH URL, or a local marketplace root."
          control={
            <SettingsInput
              value={marketplaceSource}
              onChange={setMarketplaceSource}
              placeholder="owner/repo[@ref] or /path/to/marketplace"
            />
          }
          actions={
            <SettingsButton
              onClick={addMarketplace}
              disabled={!marketplaceSource.trim() || upgradingMarketplace === "add"}
            >
              Add
            </SettingsButton>
          }
        />
      </SettingsGroup>
      <SettingsGroup
        title="Plugin registry"
        description="Discovers Codex plugin bundles from the local Codex plugin cache. Composer/runtime wiring stays modular."
        actions={
          <StatusPill tone={plugins.length ? "good" : "warning"}>{plugins.length} found</StatusPill>
        }
      >
        <SettingsRow
          label="Browser-use"
          description="Required composer plugin for browser control via @browser-use."
          value={
            <SettingsValue>
              {pluginAvailabilityText(browserUse, validation?.browserUseRuntime)}
            </SettingsValue>
          }
          status={
            <PluginAvailabilityPill
              plugin={browserUse}
              available={validation?.browserUseAvailable}
              runtime={validation?.browserUseRuntime}
            />
          }
        />
        <SettingsRow
          label="Computer-use"
          description="Specific parity check requested for the Codex computer-use helper."
          value={
            <SettingsValue>
              {pluginAvailabilityText(computerUse, validation?.computerUseRuntime)}
            </SettingsValue>
          }
          status={
            <PluginAvailabilityPill
              plugin={computerUse}
              available={validation?.computerUseAvailable}
              runtime={validation?.computerUseRuntime}
            />
          }
        />
        {plugins
          .filter(
            (plugin) =>
              !plugin.name.includes("browser-use") && !plugin.name.includes("computer-use"),
          )
          .slice(0, 40)
          .map((plugin) => (
            <SettingsRow
              key={plugin.path}
              label={plugin.name}
              description={pluginDescription(plugin)}
              value={<SettingsValue>{plugin.enabled ? "Enabled" : "Disabled"}</SettingsValue>}
              status={
                <StatusPill tone={plugin.enabled ? "good" : "default"}>
                  {plugin.installed ? "installed" : "available"}
                </StatusPill>
              }
              actions={
                <SettingsButton
                  onClick={() => setPluginEnabled(plugin, !plugin.enabled)}
                  disabled={savingPlugin === plugin.id}
                >
                  {plugin.enabled ? "Disable" : "Enable"}
                </SettingsButton>
              }
            />
          ))}
      </SettingsGroup>
    </div>
  );
}

function pluginAvailabilityText(
  plugin: { enabled: boolean } | null,
  runtime?: { mcpConfigured?: boolean; mcpExecutableExists?: boolean; note?: string } | null,
) {
  if (!plugin) return "Not discovered";
  if (!plugin.enabled) return "Discovered but disabled in Codex plugin config";
  if (runtime?.mcpConfigured && runtime.mcpExecutableExists === false) {
    return "Selectable, but its MCP command is missing";
  }
  return runtime?.note ?? "Available and selectable in the composer";
}

function PluginAvailabilityPill({
  plugin,
  available,
  runtime,
}: {
  plugin: { enabled: boolean } | null;
  available?: boolean;
  runtime?: { mcpConfigured?: boolean; mcpExecutableExists?: boolean } | null;
}) {
  if (!plugin) return <StatusPill tone="warning">missing</StatusPill>;
  if (!plugin.enabled || !available) return <StatusPill tone="default">disabled</StatusPill>;
  if (runtime?.mcpConfigured && runtime.mcpExecutableExists === false) {
    return <StatusPill tone="warning">mcp missing</StatusPill>;
  }
  if (runtime?.mcpConfigured) return <StatusPill tone="info">mcp wired</StatusPill>;
  return <StatusPill tone="good">selectable</StatusPill>;
}

function pluginDescription(plugin: { appIds?: string[]; description?: string; path: string }) {
  const summary = plugin.description?.replace(/\s+/g, " ").trim();
  const short = summary && summary.length > 150 ? `${summary.slice(0, 147)}…` : summary;
  const connectors = plugin.appIds?.length ? ` · connectors: ${plugin.appIds.join(", ")}` : "";
  return short ? `${short}${connectors} · ${plugin.path}` : `${plugin.path}${connectors}`;
}

function SkillsSettings() {
  type Skill = { id: string; name: string; source: string; path: string };
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    void fetch("/api/agent/skills", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ skills?: Skill[] }>)
      .then((payload) => setSkills(payload.skills ?? []))
      .catch(() => setSkills([]));
  }, []);

  return (
    <SettingsGroup
      title="Skills"
      description="Normalized, deduplicated skills discovered from ~/.claude, ~/.pi, ~/.codex, ~/.factory, and ~/.opencode."
      actions={
        <StatusPill tone={skills.length ? "good" : "warning"}>{skills.length} skills</StatusPill>
      }
    >
      {skills.length === 0 ? (
        <SettingsRow
          label="Skill discovery"
          description="No SKILL.md entries were found in the configured roots."
          value={<SettingsValue dim>Empty discovery result</SettingsValue>}
          status={<StatusPill tone="warning">empty</StatusPill>}
        />
      ) : (
        skills
          .slice(0, 80)
          .map((skill) => (
            <SettingsRow
              key={skill.id}
              label={skill.name}
              description={skill.path}
              value={<SettingsValue mono>{skill.source}</SettingsValue>}
              status={<StatusPill tone="info">discovered</StatusPill>}
            />
          ))
      )}
    </SettingsGroup>
  );
}

function SetupChecksSettings() {
  type Check = { id: string; label: string; ok: boolean; value: string; guidance: string };
  const [checks, setChecks] = useState<Check[]>([]);
  const controllerStatus = useSidebarStatus();

  useEffect(() => {
    void fetch("/api/agent/setup-checks", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ checks?: Check[] }>)
      .then((payload) => setChecks(payload.checks ?? []))
      .catch(() => setChecks([]));
  }, []);

  const controllerCheck: Check = {
    id: "controller",
    label: "Controller connection",
    ok: controllerStatus.online,
    value: controllerStatus.online ? controllerStatus.activityLine : "offline",
    guidance: "Set a reachable controller URL in Settings → Connection before using Agents.",
  };
  const rows = [...checks, controllerCheck];
  const blockers = rows.filter((check) => !check.ok);
  return (
    <SettingsGroup
      title="First-time setup"
      description="Preflight checks prevent new users from landing in an empty Agent tab without explanation."
      actions={
        <StatusPill tone={blockers.length ? "warning" : "good"}>
          {blockers.length ? `${blockers.length} blockers` : "ready"}
        </StatusPill>
      }
    >
      {rows.map((check) => (
        <SettingsRow
          key={check.id}
          label={check.label}
          description={check.guidance}
          value={<SettingsValue mono>{check.value}</SettingsValue>}
          status={
            <StatusPill tone={check.ok ? "good" : "warning"}>
              {check.ok ? "ok" : "missing"}
            </StatusPill>
          }
        />
      ))}
    </SettingsGroup>
  );
}

function PathRow({
  label,
  value,
  fallback,
}: {
  label: string;
  value?: string | null;
  fallback: string;
}) {
  return (
    <SettingsRow
      label={label}
      description="Filesystem path reported by the controller or a stable default."
      value={<SettingsValue mono>{value || fallback}</SettingsValue>}
      status={
        <StatusPill tone={value ? "good" : "default"}>{value ? "reported" : "fallback"}</StatusPill>
      }
    />
  );
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
