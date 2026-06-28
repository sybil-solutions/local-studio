"use client";

import { effectInterval } from "@/lib/effect-timers";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  AppPage,
  Button,
  Input,
  PageHeader,
  RefreshIconButton,
  SettingsNotice,
  StatusPill,
} from "@/ui";
import {
  Boxes,
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  File,
  GitBranch,
  Globe,
  Monitor,
  MoreVertical,
  Search,
  Settings,
  type LucideIcon,
} from "@/ui/icon-registry";
import { CuratedMcpSearchPanel } from "./plugins-curated-mcp-search";
import { InstalledMcpServersPanel } from "./plugins-installed-servers";
import { ManualMcpServerPanel } from "./plugins-manual-server";
import {
  OAuthConnectionsPanel,
  oauthBusyId,
  type OAuthClientDrafts,
  type OAuthStatusView,
} from "./plugins-oauth-connections";
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
  const [oauthStatuses, setOAuthStatuses] = useState<OAuthStatusView[]>([]);
  const [oauthDrafts, setOAuthDrafts] = useState<OAuthClientDrafts>({});
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
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const applyServersPayload = useCallback((payload: ServersPayload) => {
    setServers(payload.servers ?? []);
    setCatalogue(payload.catalogue ?? []);
    if (typeof payload.configText === "string") setConfigText(payload.configText);
    if (payload.error) setError(payload.error);
  }, []);

  const applyOAuthStatuses = useCallback((providers: OAuthStatusView[]) => {
    setOAuthStatuses(providers);
  }, []);

  const loadOAuthStatuses = useCallback(async () => {
    try {
      const response = await fetch("/api/oauth", { cache: "no-store" });
      const payload = (await response.json()) as { providers?: OAuthStatusView[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to load OAuth connections.");
      applyOAuthStatuses(payload.providers ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load OAuth connections.",
      );
    }
  }, [applyOAuthStatuses]);

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
      void loadOAuthStatuses();
      return () => {};
    },
    [loadOAuthStatuses, loadServers],
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

  const pollOAuthResult = useCallback(
    (busyKey: string) => {
      let elapsed = 0;
      const poll = effectInterval(() => {
        elapsed += 1;
        void Promise.all([loadServers(), loadOAuthStatuses()]).then(() => {
          if (elapsed >= 40) {
            poll.cancel();
            setBusyId((current) => (current === busyKey ? null : current));
          }
        });
      }, 1500);
    },
    [loadOAuthStatuses, loadServers],
  );

  const openOAuth = useCallback(
    (providerId: string, catalogueId?: string) => {
      const busyKey = catalogueId ?? oauthBusyId(providerId, "connect");
      setBusyId(busyKey);
      setError(null);
      const params = catalogueId ? `?catalogueId=${encodeURIComponent(catalogueId)}` : "";
      window.open(`/api/oauth/${providerId}/start${params}`, "_blank", "noopener,noreferrer");
      pollOAuthResult(busyKey);
    },
    [pollOAuthResult],
  );

  const saveOAuthClient = useCallback(
    async (providerId: string) => {
      const draft = oauthDrafts[providerId];
      if (!draft) return;
      const busyKey = oauthBusyId(providerId, "save");
      setBusyId(busyKey);
      setError(null);
      try {
        const response = await fetch(`/api/oauth/${providerId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "save_client",
            clientId: draft.clientId,
            clientSecret: draft.clientSecret,
          }),
        });
        const status = (await response.json()) as OAuthStatusView & { error?: string };
        if (!response.ok || status.error)
          throw new Error(status.error || "OAuth client save failed.");
        setOAuthStatuses((current) => [
          ...current.filter((item) => item.providerId !== providerId),
          status,
        ]);
        setOAuthDrafts((current) => ({
          ...current,
          [providerId]: { clientId: "", clientSecret: "" },
        }));
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "OAuth client save failed.");
      } finally {
        setBusyId((current) => (current === busyKey ? null : current));
      }
    },
    [oauthDrafts],
  );

  const startGcloudOAuth = useCallback(
    async (providerId: string) => {
      const busyKey = oauthBusyId(providerId, "gcloud");
      setBusyId(busyKey);
      setError(null);
      try {
        const response = await fetch(`/api/oauth/${providerId}/gcloud`, { method: "POST" });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok || payload.error) {
          throw new Error(payload.error || "Could not start gcloud login.");
        }
        pollOAuthResult(busyKey);
      } catch (gcloudError) {
        setError(
          gcloudError instanceof Error ? gcloudError.message : "Could not start gcloud login.",
        );
        setBusyId((current) => (current === busyKey ? null : current));
      }
    },
    [pollOAuthResult],
  );

  const disconnectOAuth = useCallback(async (providerId: string) => {
    const busyKey = oauthBusyId(providerId, "disconnect");
    setBusyId(busyKey);
    setError(null);
    try {
      const response = await fetch(`/api/oauth/${providerId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      const status = (await response.json()) as OAuthStatusView & { error?: string };
      if (!response.ok || status.error) throw new Error(status.error || "OAuth disconnect failed.");
      setOAuthStatuses((current) => [
        ...current.filter((item) => item.providerId !== providerId),
        status,
      ]);
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error ? disconnectError.message : "OAuth disconnect failed.",
      );
    } finally {
      setBusyId((current) => (current === busyKey ? null : current));
    }
  }, []);

  const beginConfigureEntry = (entry: CatalogueEntry) => {
    const providerId = oauthProviderIdForEntry(entry);
    if (providerId) {
      openOAuth(providerId, entry.id);
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
  const selectedEntry = catalogue.find((entry) => entry.id === selectedEntryId) ?? null;

  const errorNotice = error ? (
    <SettingsNotice tone="danger" className="mb-4">
      {error}
    </SettingsNotice>
  ) : null;
  const installedPanel = (
    <InstalledMcpServersPanel
      servers={servers}
      oauthStatuses={oauthStatuses}
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
  );
  const advancedPanel = (
    <div className="space-y-5">
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
  const connectionsPanel = (
    <OAuthConnectionsPanel
      statuses={oauthStatuses}
      drafts={oauthDrafts}
      busyId={busyId}
      onDraftChange={(providerId, draft) =>
        setOAuthDrafts((drafts) => ({ ...drafts, [providerId]: draft }))
      }
      onSaveClient={saveOAuthClient}
      onConnect={(providerId) => openOAuth(providerId)}
      onStartGcloud={startGcloudOAuth}
      onDisconnect={disconnectOAuth}
    />
  );
  const curatedPanel = (
    <CuratedMcpSearchPanel
      title="Add more tools"
      description="Browse reviewed MCP servers after the account-backed tools are connected."
      defaultOpen={false}
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
          {installedPanel}
          {curatedPanel}
          {advancedPanel}
        </div>
        {configurePanel}
      </>
    );
  }

  if (selectedEntry) {
    return (
      <AppPage>
        <PluginDetailView
          entry={selectedEntry}
          server={serverForEntry(servers, selectedEntry)}
          oauthStatus={oauthStatusForEntry(oauthStatuses, selectedEntry)}
          busy={busyId === selectedEntry.id}
          onBack={() => setSelectedEntryId(null)}
          onPrimary={() => void handlePluginPrimaryAction(selectedEntry)}
        />
        {configurePanel}
      </AppPage>
    );
  }

  return (
    <AppPage>
      <div className="mx-auto w-full max-w-5xl px-5 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="inline-flex rounded-xl bg-(--ui-surface) p-1">
            <button className="rounded-lg bg-(--ui-hover) px-3 py-1.5 text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
              Plugins
            </button>
            <button className="rounded-lg px-3 py-1.5 text-[length:var(--fs-base)] text-(--ui-muted)">
              Skills
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <RefreshIconButton onClick={refreshAll} loading={loading} label="Refresh plugins" />
            <Button
              variant="icon"
              size="md"
              title="Plugin settings"
              onClick={() => {
                window.location.href = "/settings#plugins";
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <PageHeader eyebrow="Tooling" title="Plugins" status={layoutStatus} />
        <p className="-mt-3 mb-6 text-[length:var(--fs-lg)] text-(--ui-muted)">
          Work with Local Studio across your favorite tools
        </p>
        {errorNotice}
        <PluginMarketplace
          entries={browseEntries}
          allEntries={catalogue}
          servers={servers}
          oauthStatuses={oauthStatuses}
          search={search}
          busyId={busyId}
          loading={loading}
          onSearchChange={setSearch}
          onOpenEntry={(entry) => setSelectedEntryId(entry.id)}
          onPrimaryAction={(entry) => void handlePluginPrimaryAction(entry)}
        />
      </div>

      {configurePanel}
    </AppPage>
  );

  async function handlePluginPrimaryAction(entry: CatalogueEntry) {
    const server = serverForEntry(servers, entry);
    const oauthProviderId = oauthProviderIdForEntry(entry);
    const oauthStatus = oauthStatusForEntry(oauthStatuses, entry);
    if (server?.enabled && (!oauthProviderId || oauthStatus?.connected)) {
      window.location.href = "/agent";
      return;
    }
    if (oauthProviderId) {
      if (!server) {
        await post({ action: "add_from_catalogue", catalogueId: entry.id }, entry.id);
      }
      if (oauthProviderId === "google" && !oauthStatus?.hasCredentials) {
        await startGcloudOAuth(oauthProviderId);
        return;
      }
      openOAuth(oauthProviderId, entry.id);
      return;
    }
    beginConfigureEntry(entry);
  }
}

function PluginMarketplace({
  entries,
  allEntries,
  servers,
  oauthStatuses,
  search,
  busyId,
  loading,
  onSearchChange,
  onOpenEntry,
  onPrimaryAction,
}: {
  entries: CatalogueEntry[];
  allEntries: CatalogueEntry[];
  servers: McpServer[];
  oauthStatuses: OAuthStatusView[];
  search: string;
  busyId: string | null;
  loading: boolean;
  onSearchChange: (value: string) => void;
  onOpenEntry: (entry: CatalogueEntry) => void;
  onPrimaryAction: (entry: CatalogueEntry) => void;
}) {
  const installedEntries = allEntries.filter((entry) => serverForEntry(servers, entry));
  const visibleEntries = search.trim() ? entries : allEntries;
  const featured = visibleEntries.filter((entry) => featuredPluginNames.has(entry.name));
  const grouped = pluginGroups(visibleEntries);

  return (
    <div className="space-y-10">
      <div className="relative">
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search plugins"
          icon={<Search className="h-5 w-5" />}
          className="h-11 w-full rounded-2xl border border-(--ui-border) bg-(--ui-surface) pl-12 pr-4 text-[length:var(--fs-lg)] text-(--ui-fg) outline-none placeholder:text-(--ui-muted) focus:border-(--ui-accent)/50"
        />
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between border-b border-(--ui-separator) pb-3">
          <h2 className="text-[length:var(--fs-xl)] font-semibold text-(--ui-fg)">Installed</h2>
          <Settings className="h-4 w-4 text-(--ui-muted)" />
        </div>
        <div className="flex flex-wrap gap-3">
          {installedEntries.length ? (
            installedEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onOpenEntry(entry)}
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-(--ui-border) bg-(--ui-surface) text-[length:var(--fs-lg)] font-semibold text-(--ui-fg) transition hover:bg-(--ui-hover)"
                title={entry.displayName}
              >
                <PluginLogo entry={entry} size="sm" />
              </button>
            ))
          ) : (
            <div className="text-[length:var(--fs-base)] text-(--ui-muted)">
              Install a plugin to pin it here.
            </div>
          )}
        </div>
      </section>

      <div className="flex items-center gap-4">
        <button className="rounded-xl bg-(--ui-hover) px-3 py-1.5 text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
          By Local Studio
        </button>
        <button className="px-2 py-1.5 text-[length:var(--fs-base)] text-(--ui-muted)">
          By your workspace
        </button>
        <button className="px-2 py-1.5 text-[length:var(--fs-base)] text-(--ui-muted)">
          Personal
        </button>
      </div>

      {search.trim() ? (
        <PluginSection
          title={loading ? "Searching" : "Results"}
          entries={entries}
          servers={servers}
          oauthStatuses={oauthStatuses}
          busyId={busyId}
          onOpenEntry={onOpenEntry}
          onPrimaryAction={onPrimaryAction}
        />
      ) : (
        <>
          <PluginSection
            title="Featured"
            entries={featured}
            servers={servers}
            oauthStatuses={oauthStatuses}
            busyId={busyId}
            onOpenEntry={onOpenEntry}
            onPrimaryAction={onPrimaryAction}
          />
          {grouped.map(({ title, items }) => (
            <PluginSection
              key={title}
              title={title}
              entries={items}
              servers={servers}
              oauthStatuses={oauthStatuses}
              busyId={busyId}
              onOpenEntry={onOpenEntry}
              onPrimaryAction={onPrimaryAction}
            />
          ))}
        </>
      )}
    </div>
  );
}

function PluginSection({
  title,
  entries,
  servers,
  oauthStatuses,
  busyId,
  onOpenEntry,
  onPrimaryAction,
}: {
  title: string;
  entries: CatalogueEntry[];
  servers: McpServer[];
  oauthStatuses: OAuthStatusView[];
  busyId: string | null;
  onOpenEntry: (entry: CatalogueEntry) => void;
  onPrimaryAction: (entry: CatalogueEntry) => void;
}) {
  if (!entries.length) return null;
  return (
    <section>
      <h2 className="mb-4 border-b border-(--ui-separator) pb-3 text-[length:var(--fs-xl)] font-semibold text-(--ui-fg)">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-x-16 gap-y-5 lg:grid-cols-2">
        {entries.map((entry) => (
          <PluginRow
            key={entry.id}
            entry={entry}
            server={serverForEntry(servers, entry)}
            oauthStatus={oauthStatusForEntry(oauthStatuses, entry)}
            busy={busyId === entry.id}
            onOpen={() => onOpenEntry(entry)}
            onPrimary={() => onPrimaryAction(entry)}
          />
        ))}
      </div>
    </section>
  );
}

function PluginRow({
  entry,
  server,
  oauthStatus,
  busy,
  onOpen,
  onPrimary,
}: {
  entry: CatalogueEntry;
  server: McpServer | undefined;
  oauthStatus: OAuthStatusView | undefined;
  busy: boolean;
  onOpen: () => void;
  onPrimary: () => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-(--ui-hover)/60">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-12 w-12 items-center justify-center rounded-xl border border-(--ui-border) bg-(--ui-surface) text-[length:var(--fs-lg)] font-semibold text-(--ui-fg)"
      >
        <PluginLogo entry={entry} size="sm" />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 text-left">
        <div className="truncate text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">
          {entry.displayName}
        </div>
        <div className="truncate text-[length:var(--fs-base)] text-(--ui-muted)">
          {pluginSubtitle(entry)}
        </div>
      </button>
      <Button
        variant={
          server?.enabled && (!oauthProviderIdForEntry(entry) || oauthStatus?.connected)
            ? "secondary"
            : "primary"
        }
        size="sm"
        loading={busy}
        onClick={onPrimary}
      >
        {pluginActionLabel(entry, server, oauthStatus)}
      </Button>
      <Button variant="icon" size="sm" onClick={onOpen} title={`${entry.displayName} details`}>
        <MoreVertical className="h-4 w-4" />
      </Button>
    </div>
  );
}

function PluginDetailView({
  entry,
  server,
  oauthStatus,
  busy,
  onBack,
  onPrimary,
}: {
  entry: CatalogueEntry;
  server: McpServer | undefined;
  oauthStatus: OAuthStatusView | undefined;
  busy: boolean;
  onBack: () => void;
  onPrimary: () => void;
}) {
  const status = pluginConnectionStatus(entry, server, oauthStatus);
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-8 inline-flex items-center gap-2 text-[length:var(--fs-lg)] text-(--ui-muted) hover:text-(--ui-fg)"
      >
        Plugins <ChevronRight className="h-4 w-4" />{" "}
        <span className="font-medium text-(--ui-fg)">{entry.displayName}</span>
      </button>
      <div className="mb-10 flex items-start justify-between gap-6">
        <div>
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-(--ui-border) bg-(--ui-surface) text-[length:var(--fs-2xl)] font-semibold text-(--ui-fg)">
            <PluginLogo entry={entry} size="lg" />
          </div>
          <h1 className="text-[length:var(--fs-4xl)] font-semibold text-(--ui-fg)">
            {entry.displayName}
          </h1>
          <p className="mt-2 text-[length:var(--fs-xl)] text-(--ui-muted)">
            {pluginSubtitle(entry)}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-28">
          {entry.homepage ? (
            <a
              href={entry.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-lg px-2 text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg)"
              title="Open plugin docs"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <Button size="md" loading={busy} onClick={onPrimary}>
            {pluginActionLabel(entry, server, oauthStatus)}
          </Button>
        </div>
      </div>
      <div className="mb-8 rounded-lg border border-(--ui-border) bg-(--ui-surface) p-8">
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
              {entry.displayName}
            </div>
            <div className="mt-1 max-w-2xl text-[length:var(--fs-lg)] text-(--ui-fg)">
              {pluginSubtitle(entry)}
            </div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-(--ui-hover)">
            <ChevronRight className="h-5 w-5 text-(--ui-muted)" />
          </div>
        </div>
      </div>
      <p className="max-w-4xl text-[length:var(--fs-lg)] leading-relaxed text-(--ui-muted)">
        {entry.description}
      </p>
      <section className="mt-12">
        <h2 className="mb-6 text-[length:var(--fs-xl)] font-semibold text-(--ui-muted)">Apps 1</h2>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-(--ui-border) bg-(--ui-surface) text-[length:var(--fs-lg)] font-semibold text-(--ui-fg)">
              <PluginLogo entry={entry} size="sm" />
            </div>
            <div className="min-w-0">
              <div className="text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">
                {entry.displayName}
              </div>
              <div className="truncate text-[length:var(--fs-base)] text-(--ui-muted)">
                {entry.shortDescription ?? entry.description}
              </div>
            </div>
          </div>
          <StatusPill tone={status.tone} variant="badge">
            {status.label}
          </StatusPill>
        </div>
      </section>
      <section className="mt-12">
        <h2 className="mb-6 text-[length:var(--fs-xl)] font-semibold text-(--ui-muted)">
          Tools {entry.tools?.include?.length ?? 1}
        </h2>
        <div className="space-y-6">
          {(entry.tools?.include ?? [entry.name]).map((tool) => (
            <div key={tool} className="flex items-center gap-4">
              <Boxes className="h-5 w-5 text-(--ui-muted)" />
              <div>
                <div className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
                  {toolLabel(tool)}
                </div>
                <div className="text-[length:var(--fs-base)] text-(--ui-muted)">
                  {toolDescription(tool)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const featuredPluginNames = new Set([
  "github",
  "gmail",
  "calendar",
  "huggingface",
  "computer-use",
  "filesystem",
]);

function pluginGroups(entries: CatalogueEntry[]): { title: string; items: CatalogueEntry[] }[] {
  const sections = [
    { title: "Productivity", categories: new Set(["Google", "Utilities", "Files"]) },
    { title: "Engineering", categories: new Set(["Engineering", "Computer", "Browser", "Web"]) },
    { title: "Data & Analytics", categories: new Set(["Data", "AI"]) },
  ];
  return sections
    .map(({ title, categories }) => ({
      title,
      items: entries.filter(
        (entry) => categories.has(entry.category) && !featuredPluginNames.has(entry.name),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

function serverForEntry(servers: McpServer[], entry: CatalogueEntry): McpServer | undefined {
  return servers.find((server) => server.name.toLowerCase() === entry.name.toLowerCase());
}

function oauthStatusForEntry(
  statuses: OAuthStatusView[],
  entry: CatalogueEntry,
): OAuthStatusView | undefined {
  const providerId = oauthProviderIdForEntry(entry);
  return providerId ? statuses.find((status) => status.providerId === providerId) : undefined;
}

function pluginActionLabel(
  entry: CatalogueEntry,
  server: McpServer | undefined,
  oauthStatus: OAuthStatusView | undefined,
): string {
  const providerId = oauthProviderIdForEntry(entry);
  if (server?.enabled && (!providerId || oauthStatus?.connected)) return "Try in chat";
  if (providerId) return "Connect";
  return server ? "Enable" : "Install";
}

function pluginConnectionStatus(
  entry: CatalogueEntry,
  server: McpServer | undefined,
  oauthStatus: OAuthStatusView | undefined,
): { label: string; tone: "default" | "good" | "warning" | "danger" | "info" } {
  const providerId = oauthProviderIdForEntry(entry);
  if (server?.enabled && (!providerId || oauthStatus?.connected)) {
    return { label: "Connected", tone: "good" };
  }
  if (providerId && server) return { label: "Needs sign-in", tone: "warning" };
  if (server) return { label: "Installed", tone: "info" };
  return { label: "Not installed", tone: "default" };
}

function PluginLogo({ entry, size }: { entry: CatalogueEntry; size: "sm" | "lg" }) {
  const className = size === "lg" ? "h-12 w-12" : "h-7 w-7";
  if (entry.name === "github") return <GitHubLogo className={className} />;
  if (entry.name === "gmail") return <GmailLogo className={className} />;
  if (entry.name === "calendar") return <GoogleCalendarLogo className={className} />;
  if (entry.name === "huggingface") return <HuggingFaceLogo className={className} />;
  const Icon = pluginLucideIcon(entry);
  return <Icon className={className} strokeWidth={1.8} />;
}

function GitHubLogo({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .7a11.3 11.3 0 0 0-3.57 22.02c.57.1.78-.25.78-.55v-2.1c-3.16.69-3.83-1.35-3.83-1.35-.52-1.31-1.27-1.66-1.27-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.3.94.1-.73.4-1.23.72-1.51-2.52-.29-5.18-1.26-5.18-5.61 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.44.11-3 0 0 .96-.31 3.12 1.16a10.77 10.77 0 0 1 5.68 0c2.16-1.47 3.11-1.16 3.11-1.16.62 1.56.23 2.71.11 3 .73.79 1.17 1.8 1.17 3.04 0 4.36-2.66 5.32-5.19 5.6.41.36.77 1.05.77 2.12v3.13c0 .31.21.66.79.55A11.3 11.3 0 0 0 12 .7Z"
      />
    </svg>
  );
}

function GmailLogo({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M3.2 5.5 12 12l8.8-6.5v12.1a1.9 1.9 0 0 1-1.9 1.9h-2.5V10.8L12 14.1 7.6 10.8v8.7H5.1a1.9 1.9 0 0 1-1.9-1.9Z"
      />
      <path fill="#34A853" d="M16.4 19.5V10.8l4.4-3.3v10.1a1.9 1.9 0 0 1-1.9 1.9Z" />
      <path fill="#FBBC04" d="M3.2 7.5v10.1a1.9 1.9 0 0 0 1.9 1.9h2.5V10.8Z" />
      <path fill="#4285F4" d="M16.4 10.8V19.5h2.5a1.9 1.9 0 0 0 1.9-1.9V7.5Z" />
      <path
        fill="#C5221F"
        d="M3.2 5.5c0-1.1 1.25-1.73 2.13-1.06L12 9.4l6.67-4.96c.88-.67 2.13-.04 2.13 1.06v2L12 14.1 3.2 7.5Z"
      />
    </svg>
  );
}

function GoogleCalendarLogo({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3.5" fill="#4285F4" />
      <path fill="#FFFFFF" d="M6 8h12v10.5H6Z" />
      <path fill="#188038" d="M6 5.5A2.5 2.5 0 0 1 8.5 3H12v5H6Z" />
      <path fill="#FBBC04" d="M12 3h3.5A2.5 2.5 0 0 1 18 5.5V8h-6Z" />
      <path fill="#EA4335" d="M6 8h12v2H6Z" />
      <text
        x="12"
        y="16.35"
        textAnchor="middle"
        fontSize="6.4"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="#3C4043"
      >
        31
      </text>
    </svg>
  );
}

function HuggingFaceLogo({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#FFD21E" />
      <circle cx="8.7" cy="10" r="1.25" fill="#3B2F14" />
      <circle cx="15.3" cy="10" r="1.25" fill="#3B2F14" />
      <path
        fill="#3B2F14"
        d="M8.2 13.9c.75 1.7 2.1 2.58 3.8 2.58s3.05-.88 3.8-2.58c.18-.4-.14-.8-.58-.66A10.3 10.3 0 0 1 12 13.8c-1.1 0-2.16-.18-3.22-.56-.44-.14-.76.26-.58.66Z"
      />
      <path
        fill="#3B2F14"
        d="M4.8 12.4c-.1-1.67.65-2.75 1.85-2.87.58-.06 1.1.24 1.17.74.08.55-.34.98-.88 1.08-.56.11-.8.58-.7 1.39.1.76-.16 1.2-.7 1.28-.49.07-.7-.43-.74-1.62Zm14.4 0c.1-1.67-.65-2.75-1.85-2.87-.58-.06-1.1.24-1.17.74-.08.55.34.98.88 1.08.56.11.8.58.7 1.39-.1.76.16 1.2.7 1.28.49.07.7-.43.74-1.62Z"
      />
    </svg>
  );
}

function pluginLucideIcon(entry: CatalogueEntry): LucideIcon {
  const icons: Record<string, LucideIcon> = {
    filesystem: File,
    fetch: Globe,
    git: GitBranch,
    sqlite: Database,
    time: Clock,
    sitegeist: Globe,
    "computer-use": Monitor,
  };
  return icons[entry.name] ?? Boxes;
}

function pluginSubtitle(entry: CatalogueEntry): string {
  return entry.shortDescription ?? entry.description;
}

function toolLabel(tool: string): string {
  return tool
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toolDescription(tool: string): string {
  if (tool.includes("gmail")) return "Read and manage Gmail through the connected account.";
  if (tool.includes("calendar")) return "Read and manage Google Calendar events.";
  if (tool.includes("github")) return "Work with repositories, issues, and pull requests.";
  return "Available to Local Studio agent sessions after this plugin is connected.";
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
