"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Globe, Plug, ShieldCheck, type LucideIcon } from "lucide-react";
import { SettingsLayout, SettingsNotice, type SettingsSectionDef } from "../settings";
import { CuratedQuickAddPanel } from "./plugins-curated-quick-add";
import { InstalledMcpServersPanel } from "./plugins-installed-servers";
import { ManualMcpServerPanel } from "./plugins-manual-server";
import { ConfigureEntryPanel } from "./plugins-page-parts";
import { RegistrySearchPanel } from "./plugins-registry-search";
import { RegistrySourcesPanel } from "./plugins-registry-sources";
import {
  type CatalogueEntry,
  type McpServer,
  type RegistryPayload,
  type RegistrySource,
  type ServersPayload,
} from "./plugins-types";
import { parseArgsText, parseEnvLines, parseTagsText, quoteArgsText } from "./plugins-utils";

type PluginsSectionId = "custom" | "registry" | "curated";

const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;
const SECTIONS: SettingsSectionDef<PluginsSectionId>[] = [
  {
    id: "custom",
    label: "Custom",
    description: "Installed MCP servers, manual servers, and registry sources.",
    icon: sectionIcon(Plug),
  },
  {
    id: "registry",
    label: "Registry",
    description: "Search official and enabled compatible MCP registries.",
    icon: sectionIcon(Globe),
  },
  {
    id: "curated",
    label: "Curated",
    description: "High-confidence stdio MCP quick-add entries.",
    icon: sectionIcon(ShieldCheck),
  },
];

const isSectionId = (value: string): value is PluginsSectionId =>
  SECTIONS.some((section) => section.id === value);

export function PluginsPage() {
  return <PluginsManager mode="page" />;
}

export function PluginsSettingsSection() {
  return <PluginsManager mode="settings" />;
}

function PluginsManager({ mode }: { mode: "page" | "settings" }) {
  const [activeSection, setActiveSection] = useState<PluginsSectionId>(() => {
    if (typeof window === "undefined") return "custom";
    const hash = window.location.hash.replace("#", "");
    return isSectionId(hash) ? hash : "custom";
  });
  const [servers, setServers] = useState<McpServer[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [registry, setRegistry] = useState<CatalogueEntry[]>([]);
  const [registrySources, setRegistrySources] = useState<RegistrySource[]>([]);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [configureEntry, setConfigureEntry] = useState<CatalogueEntry | null>(null);
  const [configureCommand, setConfigureCommand] = useState("");
  const [configureArgs, setConfigureArgs] = useState("");
  const [configureTags, setConfigureTags] = useState("");
  const [configureEnv, setConfigureEnv] = useState<Record<string, string>>({});
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualCommand, setManualCommand] = useState("");
  const [manualArgs, setManualArgs] = useState("");
  const [manualEnv, setManualEnv] = useState("");
  const [manualTags, setManualTags] = useState("custom");
  const [registryOpen, setRegistryOpen] = useState(false);
  const [registryName, setRegistryName] = useState("");
  const [registryUrl, setRegistryUrl] = useState("");

  const applyServersPayload = useCallback((payload: ServersPayload) => {
    setServers(payload.servers ?? payload.plugins ?? []);
    setCatalogue(payload.catalogue ?? []);
    if (payload.error) setError(payload.error);
  }, []);

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/mcp/servers?includeDisabled=1", { cache: "no-store" });
      const payload = (await response.json()) as ServersPayload;
      if (!response.ok) throw new Error(payload.error || "Failed to load MCP servers.");
      applyServersPayload(payload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load MCP servers.");
    } finally {
      setLoading(false);
    }
  }, [applyServersPayload]);

  const loadRegistry = useCallback(async () => {
    setRegistryLoading(true);
    try {
      const response = await fetch(`/api/mcp/registry?q=${encodeURIComponent(search)}&limit=28`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as RegistryPayload;
      if (!response.ok) throw new Error(payload.error || "Failed to search MCP registry.");
      setRegistry(payload.entries ?? []);
      setRegistrySources(payload.registries ?? []);
      setError(payload.warnings?.length ? payload.warnings.join("; ") : null);
    } catch (loadError) {
      setRegistry([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to search MCP registry.");
    } finally {
      setRegistryLoading(false);
    }
  }, [search]);

  const subscribeServers = useCallback(
    (_notify: () => void) => {
      void loadServers();
      return () => {};
    },
    [loadServers],
  );

  const subscribeRegistry = useCallback(
    (_notify: () => void) => {
      const timeout = setTimeout(() => void loadRegistry(), 250);
      return () => clearTimeout(timeout);
    },
    [loadRegistry],
  );

  const subscribeHashSection = useCallback((_notify: () => void) => {
    if (typeof window === "undefined") return () => {};
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (isSectionId(hash)) setActiveSection(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useSyncExternalStore(subscribeServers, getPluginsSnapshot, getPluginsSnapshot);
  useSyncExternalStore(subscribeRegistry, getPluginsSnapshot, getPluginsSnapshot);
  useSyncExternalStore(subscribeHashSection, getPluginsSnapshot, getPluginsSnapshot);

  const post = useCallback(
    async (body: unknown, busyKey: string) => {
      setBusyId(busyKey);
      setError(null);
      try {
        const response = await fetch("/api/mcp/servers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as ServersPayload;
        if (!response.ok || payload.error) throw new Error(payload.error || "MCP update failed.");
        applyServersPayload(payload);
      } catch (postError) {
        setError(postError instanceof Error ? postError.message : "MCP update failed.");
      } finally {
        setBusyId(null);
      }
    },
    [applyServersPayload],
  );

  const postRegistry = useCallback(
    async (body: unknown, busyKey: string) => {
      setBusyId(busyKey);
      setError(null);
      try {
        const response = await fetch("/api/mcp/registry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as RegistryPayload;
        if (!response.ok || payload.error) {
          throw new Error(payload.error || "Registry update failed.");
        }
        setRegistrySources(payload.registries ?? []);
        await loadRegistry();
        return true;
      } catch (postError) {
        setError(postError instanceof Error ? postError.message : "Registry update failed.");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [loadRegistry],
  );

  const enabledCount = servers.filter((server) => server.enabled).length;
  const installedNames = useMemo(
    () => new Set(servers.map((server) => server.name.toLowerCase())),
    [servers],
  );
  const curated = catalogue.filter((entry) => entry.registry === "curated");

  const beginConfigureEntry = (entry: CatalogueEntry) => {
    setConfigureEntry(entry);
    setConfigureCommand(entry.command || "");
    setConfigureArgs(quoteArgsText(entry.args ?? []));
    setConfigureTags((entry.tags ?? [defaultRegistryTag(entry)]).join(", "));
    setConfigureEnv({ ...(entry.env ?? {}) });
  };

  const submitConfiguredEntry = () => {
    if (!configureEntry) return;
    if (
      configureEntry.registry === "curated" &&
      configureEntry.command &&
      configureCommand === configureEntry.command
    ) {
      void post(
        {
          action: "add_from_catalogue",
          catalogueId: configureEntry.id,
          env: configureEnv,
          args: parseArgsText(configureArgs),
        },
        configureEntry.id,
      ).then(() => setConfigureEntry(null));
      return;
    }
    void post(
      {
        action: "add_manual",
        name: configureEntry.displayName,
        description: configureEntry.description,
        category: configureEntry.category,
        command: configureCommand.trim(),
        args: parseArgsText(configureArgs),
        env: configureEnv,
        tags: parseTagsText(configureTags),
      },
      configureEntry.id,
    ).then(() => setConfigureEntry(null));
  };

  const submitRegistry = () => {
    void postRegistry(
      { action: "add_registry", name: registryName.trim(), url: registryUrl.trim() },
      "registry:add",
    ).then((ok) => {
      if (!ok) return;
      setRegistryOpen(false);
      setRegistryName("");
      setRegistryUrl("");
    });
  };

  const submitManual = () => {
    void post(
      {
        action: "add_manual",
        name: manualName.trim(),
        command: manualCommand.trim(),
        args: parseArgsText(manualArgs),
        env: parseEnvLines(manualEnv),
        tags: parseTagsText(manualTags),
      },
      "manual",
    ).then(() => {
      setManualOpen(false);
      setManualName("");
      setManualCommand("");
      setManualArgs("");
      setManualEnv("");
      setManualTags("custom");
    });
  };

  const saveTags = (server: McpServer) => {
    const value = tagDrafts[server.id] ?? (server.tags ?? []).join(", ");
    void post(
      { action: "set_tags", id: server.id, tags: parseTagsText(value) },
      `${server.id}:tags`,
    );
  };

  const refreshAll = useCallback(() => {
    void loadServers();
    void loadRegistry();
  }, [loadRegistry, loadServers]);

  const selectSection = (section: PluginsSectionId) => {
    setActiveSection(section);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${section}`);
  };

  const layoutStatus = loading
    ? "syncing servers"
    : registryLoading
      ? "searching registry"
      : `${enabledCount} enabled`;

  const errorNotice = error ? (
    <SettingsNotice tone="danger" className="mb-4">
      {error}
    </SettingsNotice>
  ) : null;
  const customPanel = (
    <div className="space-y-5">
      <InstalledMcpServersPanel
        servers={servers}
        enabledCount={enabledCount}
        busyId={busyId}
        tagDrafts={tagDrafts}
        onToggleServer={(server) =>
          void post({ action: "set_enabled", id: server.id, enabled: !server.enabled }, server.id)
        }
        onRemoveServer={(server) => void post({ action: "remove", id: server.id }, server.id)}
        onTagDraftChange={(server, value) =>
          setTagDrafts((drafts) => ({ ...drafts, [server.id]: value }))
        }
        onSaveTags={saveTags}
      />
      <ManualMcpServerPanel
        open={manualOpen}
        name={manualName}
        command={manualCommand}
        args={manualArgs}
        tags={manualTags}
        env={manualEnv}
        busy={busyId === "manual"}
        onToggleOpen={() => setManualOpen((open) => !open)}
        onNameChange={setManualName}
        onCommandChange={setManualCommand}
        onArgsChange={setManualArgs}
        onTagsChange={setManualTags}
        onEnvChange={setManualEnv}
        onCancel={() => setManualOpen(false)}
        onSubmit={submitManual}
      />
      <RegistrySourcesPanel
        sources={registrySources}
        loading={registryLoading}
        open={registryOpen}
        name={registryName}
        url={registryUrl}
        busyId={busyId}
        onToggleOpen={() => setRegistryOpen((open) => !open)}
        onNameChange={setRegistryName}
        onUrlChange={setRegistryUrl}
        onCancel={() => setRegistryOpen(false)}
        onSubmit={submitRegistry}
        onToggleSource={(source) =>
          void postRegistry(
            {
              action: "set_registry_enabled",
              id: source.id,
              enabled: !source.enabled,
            },
            `${source.id}:enabled`,
          )
        }
        onRemoveSource={(source) =>
          void postRegistry({ action: "remove_registry", id: source.id }, `${source.id}:remove`)
        }
      />
    </div>
  );
  const registryPanel = (
    <RegistrySearchPanel
      entries={registry}
      loading={registryLoading}
      search={search}
      installedNames={installedNames}
      busyId={busyId}
      onSearchChange={setSearch}
      onConfigure={beginConfigureEntry}
    />
  );
  const curatedPanel = (
    <CuratedQuickAddPanel
      entries={curated}
      installedNames={installedNames}
      busyId={busyId}
      loading={loading}
      onConfigure={beginConfigureEntry}
    />
  );
  const configurePanel = configureEntry ? (
    <ConfigureEntryPanel
      entry={configureEntry}
      command={configureCommand}
      args={configureArgs}
      tags={configureTags}
      env={configureEnv}
      busy={busyId === configureEntry.id}
      onCommandChange={setConfigureCommand}
      onArgsChange={setConfigureArgs}
      onTagsChange={setConfigureTags}
      onEnvChange={setConfigureEnv}
      onCancel={() => setConfigureEntry(null)}
      onSubmit={submitConfiguredEntry}
    />
  ) : null;

  if (mode === "settings") {
    return (
      <>
        {errorNotice}
        <div className="space-y-5">
          {customPanel}
          {registryPanel}
          {curatedPanel}
        </div>
        {configurePanel}
      </>
    );
  }

  return (
    <>
      <SettingsLayout
        sections={SECTIONS}
        activeSection={activeSection}
        title="Plugins"
        status={layoutStatus}
        loading={loading || registryLoading}
        onReload={refreshAll}
        onSelectSection={selectSection}
        eyebrow="Tooling"
      >
        {errorNotice}
        {activeSection === "custom" ? customPanel : null}
        {activeSection === "registry" ? registryPanel : null}
        {activeSection === "curated" ? curatedPanel : null}
      </SettingsLayout>

      {configurePanel}
    </>
  );
}

function defaultRegistryTag(entry: CatalogueEntry): string {
  if (entry.registry === "official") return "official-registry";
  if (entry.registry === "custom") return "custom-registry";
  return "curated";
}

const getPluginsSnapshot = (): number => 0;
