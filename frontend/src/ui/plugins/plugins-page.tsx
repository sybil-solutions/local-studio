"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { RefreshCw, Search, Tags, Trash2 } from "lucide-react";
import { Button } from "../button";
import { EmptySafeNotice } from "../list";
import { AppPage, PageHeader } from "../page";
import {
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
} from "../settings";
import { StatusPill } from "../status";
import { ConfigureEntryPanel, RegistryRow, ServerPill } from "./plugins-page-parts";
import {
  type CatalogueEntry,
  type McpServer,
  type RegistryPayload,
  type ServersPayload,
} from "./plugins-types";
import {
  parseArgsText,
  parseEnvLines,
  parseTagsText,
  serverDescription,
  serverLocation,
} from "./plugins-utils";

export function PluginsPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [registry, setRegistry] = useState<CatalogueEntry[]>([]);
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

  useSyncExternalStore(subscribeServers, getPluginsSnapshot, getPluginsSnapshot);
  useSyncExternalStore(subscribeRegistry, getPluginsSnapshot, getPluginsSnapshot);

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
  const curated = catalogue.filter((entry) => entry.registry !== "glama");

  const beginConfigureEntry = (entry: CatalogueEntry) => {
    setConfigureEntry(entry);
    setConfigureCommand(entry.command || "");
    setConfigureArgs((entry.args ?? []).join(" "));
    setConfigureTags((entry.tags ?? [entry.registry === "glama" ? "glama" : "curated"]).join(", "));
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

  return (
    <AppPage>
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:py-7">
        <PageHeader
          eyebrow="Tooling"
          title="Plugins"
          status={
            <StatusPill tone={enabledCount ? "good" : "default"}>
              {loading ? "syncing" : `${enabledCount} enabled`}
            </StatusPill>
          }
          actions={
            <Button variant="icon" size="sm" onClick={loadServers} title="Refresh MCP servers">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          }
        />

        {error ? (
          <div className="mb-4 rounded-md border border-(--ui-danger)/40 bg-(--ui-danger)/10 px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-danger)">
            {error}
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0 space-y-5">
            <SettingsGroup
              title="Enabled MCP servers"
              description="Servers here are exposed to agent turns when selected in the composer. Tags become local labels for routing and audits."
              actions={
                <StatusPill tone={enabledCount ? "good" : "default"} variant="badge">
                  {servers.length} installed
                </StatusPill>
              }
            >
              {servers.length ? (
                servers.map((server) => (
                  <SettingsRow
                    key={server.id}
                    label={server.displayName ?? server.name}
                    description={serverDescription(server)}
                    value={<SettingsValue mono>{serverLocation(server)}</SettingsValue>}
                    status={<ServerPill server={server} />}
                    actions={
                      <>
                        <SettingsButton
                          onClick={() =>
                            void post(
                              { action: "set_enabled", id: server.id, enabled: !server.enabled },
                              server.id,
                            )
                          }
                          disabled={busyId === server.id}
                        >
                          {server.enabled ? "Disable" : "Enable"}
                        </SettingsButton>
                        <SettingsButton
                          tone="danger"
                          onClick={() => void post({ action: "remove", id: server.id }, server.id)}
                          disabled={busyId === server.id}
                          title="Remove MCP server"
                        >
                          <Trash2 className="h-3 w-3" />
                        </SettingsButton>
                      </>
                    }
                  >
                    <div className="flex items-center gap-2">
                      <Tags className="h-3.5 w-3.5 shrink-0 text-(--ui-muted)" />
                      <SettingsInput
                        value={tagDrafts[server.id] ?? (server.tags ?? []).join(", ")}
                        onChange={(value) =>
                          setTagDrafts((drafts) => ({ ...drafts, [server.id]: value }))
                        }
                        onBlur={() => saveTags(server)}
                        placeholder="tag, another-tag"
                      />
                      <SettingsButton
                        onClick={() => saveTags(server)}
                        disabled={busyId === `${server.id}:tags`}
                      >
                        Save tags
                      </SettingsButton>
                    </div>
                  </SettingsRow>
                ))
              ) : (
                <EmptySafeNotice>No MCP servers configured yet.</EmptySafeNotice>
              )}
            </SettingsGroup>

            <SettingsGroup
              title="Glama MCP registry"
              description="Glama indexes the official registry plus sandbox-inspected community servers with maintainer verification and quality signals."
              actions={
                <StatusPill tone={registryLoading ? "info" : "good"} variant="badge">
                  {registryLoading ? "searching" : `${registry.length} results`}
                </StatusPill>
              }
            >
              <SettingsRow
                label="Search registry"
                description="Search server names, providers, and tool descriptions from Glama."
                control={
                  <div className="relative w-full">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ui-muted)" />
                    <SettingsInput
                      value={search}
                      onChange={setSearch}
                      placeholder="GitHub, Postgres, filesystem..."
                      className="pl-8"
                    />
                  </div>
                }
              />
              {registry.map((entry) => (
                <RegistryRow
                  key={entry.id}
                  entry={entry}
                  added={installedNames.has(entry.name.toLowerCase())}
                  busy={busyId === entry.id}
                  onConfigure={() => beginConfigureEntry(entry)}
                />
              ))}
              {!registry.length && !registryLoading ? (
                <EmptySafeNotice>No registry matches. Try a broader search.</EmptySafeNotice>
              ) : null}
            </SettingsGroup>
          </main>

          <aside className="space-y-5">
            <SettingsGroup
              title="Curated quick add"
              description="Fixed stdio launch lines for high-confidence reference servers."
            >
              {curated.map((entry) => (
                <RegistryRow
                  key={entry.id}
                  entry={entry}
                  added={installedNames.has(entry.name.toLowerCase())}
                  busy={busyId === entry.id}
                  compact
                  onConfigure={() => beginConfigureEntry(entry)}
                />
              ))}
            </SettingsGroup>

            <SettingsGroup
              title="Manual MCP server"
              description="Register any stdio MCP server by launch command, args, env, and tags."
              actions={
                <SettingsButton onClick={() => setManualOpen((open) => !open)}>
                  {manualOpen ? "Close" : "Configure"}
                </SettingsButton>
              }
            >
              {manualOpen ? (
                <>
                  <SettingsRow
                    label="Name"
                    control={
                      <SettingsInput
                        value={manualName}
                        onChange={setManualName}
                        placeholder="My MCP server"
                      />
                    }
                  />
                  <SettingsRow
                    label="Command"
                    control={
                      <SettingsInput
                        value={manualCommand}
                        onChange={setManualCommand}
                        placeholder="npx"
                      />
                    }
                  />
                  <SettingsRow
                    label="Arguments"
                    control={
                      <SettingsInput
                        value={manualArgs}
                        onChange={setManualArgs}
                        placeholder="-y @scope/server"
                      />
                    }
                  />
                  <SettingsRow
                    label="Tags"
                    control={
                      <SettingsInput
                        value={manualTags}
                        onChange={setManualTags}
                        placeholder="coding, api"
                      />
                    }
                  />
                  <SettingsRow
                    label="Environment"
                    control={
                      <textarea
                        value={manualEnv}
                        onChange={(event) => setManualEnv(event.target.value)}
                        placeholder={"API_KEY=...\nANOTHER=..."}
                        rows={4}
                        className="w-full resize-none rounded-md border border-(--ui-separator) bg-(--ui-bg) px-2.5 py-1.5 text-[length:var(--fs-base)] text-(--ui-fg) outline-none placeholder:text-(--ui-muted)/50 focus:border-(--ui-info)/50"
                      />
                    }
                  />
                  <div className="flex justify-end gap-1 px-3.5 py-2">
                    <SettingsButton onClick={() => setManualOpen(false)}>Cancel</SettingsButton>
                    <SettingsButton
                      tone="primary"
                      onClick={submitManual}
                      disabled={!manualName.trim() || !manualCommand.trim() || busyId === "manual"}
                    >
                      Add server
                    </SettingsButton>
                  </div>
                </>
              ) : (
                <EmptySafeNotice>
                  Use a command like `npx`, `uvx`, `node`, or `python`.
                </EmptySafeNotice>
              )}
            </SettingsGroup>
          </aside>
        </div>
      </div>

      {configureEntry ? (
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
      ) : null}
    </AppPage>
  );
}

const getPluginsSnapshot = (): number => 0;
