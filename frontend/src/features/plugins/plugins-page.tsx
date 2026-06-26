"use client";

import { effectInterval } from "@/lib/effect-timers";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { AppPage, PageHeader, RefreshIconButton, SettingsNotice } from "@/ui";
import { ConnectionsPanel } from "./plugins-connections";
import { CuratedMcpSearchPanel } from "./plugins-curated-mcp-search";
import { InstalledMcpServersPanel } from "./plugins-installed-servers";
import { ManualMcpServerPanel } from "./plugins-manual-server";
import { ConfigureEntryPanel, McpJsonConfigPanel } from "./plugins-page-parts";
import { type CatalogueEntry, type McpServer, type ServersPayload } from "./plugins-types";
import {
  oauthProviderIdForEntry,
  parseArgsText,
  parseEnvLines,
  parseTagsText,
  quoteArgsText,
} from "./plugins-utils";

export function PluginsPage() {
  return <PluginsManager mode="page" />;
}

export function PluginsSettingsSection() {
  return <PluginsManager mode="settings" />;
}

function PluginsManager({ mode }: { mode: "page" | "settings" }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [configText, setConfigText] = useState("");
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

  const applyServersPayload = useCallback((payload: ServersPayload) => {
    setServers(payload.servers ?? []);
    setCatalogue(payload.catalogue ?? []);
    if (typeof payload.configText === "string") setConfigText(payload.configText);
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

  const subscribeServers = useCallback(
    (_notify: () => void) => {
      void loadServers();
      return () => {};
    },
    [loadServers],
  );

  useSyncExternalStore(subscribeServers, getPluginsSnapshot, getPluginsSnapshot);

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

  const enabledCount = servers.filter((server) => server.enabled).length;
  const installedNames = useMemo(
    () => new Set(servers.map((server) => server.name.toLowerCase())),
    [servers],
  );
  const browseEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalogue.filter((entry) => matchesEntrySearch(entry, query));
  }, [catalogue, search]);

  const beginConfigureEntry = (entry: CatalogueEntry) => {
    const providerId = oauthProviderIdForEntry(entry);
    if (providerId) {
      setBusyId(entry.id);
      setError(null);
      window.open(
        `/api/oauth/${providerId}/start?catalogueId=${encodeURIComponent(entry.id)}`,
        "_blank",
        "noopener,noreferrer",
      );
      let elapsed = 0;
      const poll = effectInterval(() => {
        elapsed += 1;
        void loadServers().then(() => {
          if (elapsed >= 40) {
            poll.cancel();
            setBusyId(null);
          }
        });
      }, 1500);
      return;
    }
    setConfigureEntry(entry);
    setConfigureCommand(entry.command || "");
    setConfigureArgs(quoteArgsText(entry.args ?? []));
    setConfigureTags((entry.tags ?? [defaultCuratedTag(entry)]).join(", "));
    setConfigureEnv({ ...(entry.env ?? {}) });
  };

  const submitConfiguredEntry = () => {
    if (!configureEntry) return;
    if (configureEntry.command && configureCommand === configureEntry.command) {
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
  }, [loadServers]);

  const saveMcpConfig = useCallback(() => {
    void post({ action: "save_config", configText }, "mcp-config");
  }, [configText, post]);

  const layoutStatus = loading ? "syncing servers" : `${enabledCount} enabled`;

  const errorNotice = error ? (
    <SettingsNotice tone="danger" className="mb-4">
      {error}
    </SettingsNotice>
  ) : null;
  const connectionsPanel = <ConnectionsPanel />;
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
      <McpJsonConfigPanel
        configText={configText}
        busy={busyId === "mcp-config"}
        onChange={setConfigText}
        onSave={saveMcpConfig}
      />
    </div>
  );
  const curatedPanel = (
    <CuratedMcpSearchPanel
      entries={browseEntries}
      loading={loading}
      search={search}
      installedNames={installedNames}
      busyId={busyId}
      onSearchChange={setSearch}
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
          {connectionsPanel}
          {curatedPanel}
          {customPanel}
        </div>
        {configurePanel}
      </>
    );
  }

  return (
    <AppPage>
      <div className="mx-auto max-w-5xl px-5 py-6">
        <PageHeader
          eyebrow="Tooling"
          title="Plugins"
          status={layoutStatus}
          actions={
            <RefreshIconButton onClick={refreshAll} loading={loading} label="Refresh plugins" />
          }
        />
        {errorNotice}
        <div className="space-y-5">
          {connectionsPanel}
          {curatedPanel}
          {customPanel}
        </div>
      </div>

      {configurePanel}
    </AppPage>
  );
}

function defaultCuratedTag(entry: CatalogueEntry): string {
  return entry.tags?.[0] ?? "curated";
}

function matchesEntrySearch(entry: CatalogueEntry, query: string): boolean {
  if (!query) return true;
  return [
    entry.name,
    entry.displayName,
    entry.description,
    entry.shortDescription,
    entry.category,
    ...(entry.tags ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

const getPluginsSnapshot = (): number => 0;
