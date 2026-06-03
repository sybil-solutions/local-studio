import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  EmptySafeNotice,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "@/ui";
import { getConfigsViewSnapshot } from "./configs-view-snapshot";

type McpServer = {
  id: string;
  name: string;
  displayName?: string;
  source?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  description?: string;
  shortDescription?: string;
  category?: string;
  skillPath?: string;
  mcpConfigPath?: string;
};

type CatalogueEntry = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  shortDescription?: string;
  category: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  requiredEnv?: string[];
  homepage?: string;
};

type McpPayload = {
  plugins?: McpServer[];
  catalogue?: CatalogueEntry[];
  error?: string;
};

const BUILTIN_SOURCE = "builtin";

export function PluginsSettings() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Catalogue "add" form: selected entry + collected env values.
  const [catalogueDraft, setCatalogueDraft] = useState<CatalogueEntry | null>(null);
  const [catalogueEnv, setCatalogueEnv] = useState<Record<string, string>>({});
  // Manual "add custom" form.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualCommand, setManualCommand] = useState("");
  const [manualArgs, setManualArgs] = useState("");
  const [manualEnv, setManualEnv] = useState("");

  const applyPayload = useCallback((payload: McpPayload) => {
    setServers(payload.plugins ?? []);
    setCatalogue(payload.catalogue ?? []);
    if (payload.error) setError(payload.error);
  }, []);

  const loadServers = useCallback(
    () =>
      fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
        .then((res) => res.json() as Promise<McpPayload>)
        .then(applyPayload)
        .catch(() => {
          setServers([]);
          setCatalogue([]);
        }),
    [applyPayload],
  );

  const subscribe = useCallback(
    (_notify: () => void) => {
      void loadServers();
      return () => {};
    },
    [loadServers],
  );
  useSyncExternalStore(subscribe, getConfigsViewSnapshot, getConfigsViewSnapshot);

  const post = useCallback(
    (body: unknown, busyKey: string) => {
      setBusyId(busyKey);
      setError(null);
      return fetch("/api/agent/plugins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((res) => res.json() as Promise<McpPayload>)
        .then((payload) => {
          if (payload.error) {
            setError(payload.error);
            return;
          }
          applyPayload(payload);
        })
        .catch(() => void loadServers())
        .finally(() => setBusyId(null));
    },
    [applyPayload, loadServers],
  );

  const toggleServer = (server: McpServer) =>
    void post({ action: "set_enabled", id: server.id, enabled: !server.enabled }, server.id);
  const removeServer = (server: McpServer) =>
    void post({ action: "remove", id: server.id }, server.id);

  const beginAddCatalogue = (entry: CatalogueEntry) => {
    setCatalogueDraft(entry);
    setCatalogueEnv({ ...(entry.env ?? {}) });
  };
  const submitCatalogue = () => {
    if (!catalogueDraft) return;
    void post(
      { action: "add_from_catalogue", catalogueId: catalogueDraft.id, env: catalogueEnv },
      catalogueDraft.id,
    ).then(() => {
      setCatalogueDraft(null);
      setCatalogueEnv({});
    });
  };

  const submitManual = () => {
    const args = manualArgs
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const env = parseEnvLines(manualEnv);
    void post(
      {
        action: "add_manual",
        name: manualName.trim(),
        command: manualCommand.trim(),
        ...(args.length ? { args } : {}),
        ...(Object.keys(env).length ? { env } : {}),
      },
      "manual",
    ).then(() => {
      setManualOpen(false);
      setManualName("");
      setManualCommand("");
      setManualArgs("");
      setManualEnv("");
    });
  };

  const installedNames = useMemo(
    () => new Set(servers.map((server) => server.name.toLowerCase())),
    [servers],
  );
  const enabledCount = servers.filter((server) => server.enabled).length;

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-md border border-(--ui-danger)/40 bg-(--ui-danger)/10 px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-danger)">
          {error}
        </div>
      ) : null}

      <SettingsGroup
        title="MCP servers"
        description="Tools the model can use, provided by MCP servers. @-mention a server in the composer to load its tools for that turn. Built-in servers ship with the app; added servers run locally over stdio."
        actions={
          <StatusPill tone={enabledCount ? "good" : "default"}>
            {enabledCount} enabled · {servers.length} total
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
                <div className="flex items-center gap-1">
                  <SettingsButton
                    onClick={() => toggleServer(server)}
                    disabled={busyId === server.id}
                  >
                    {server.enabled ? "Disable" : "Enable"}
                  </SettingsButton>
                  {server.source !== BUILTIN_SOURCE ? (
                    <SettingsButton
                      tone="danger"
                      onClick={() => removeServer(server)}
                      disabled={busyId === server.id}
                    >
                      Remove
                    </SettingsButton>
                  ) : null}
                </div>
              }
            />
          ))
        ) : (
          <EmptySafeNotice>No MCP servers configured yet.</EmptySafeNotice>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Add from catalogue"
        description="Curated, trusted MCP servers. Adding one launches it locally via npx; some require an API key or token."
      >
        {catalogue.map((entry) => {
          const added = installedNames.has(entry.name.toLowerCase());
          const isDraft = catalogueDraft?.id === entry.id;
          return (
            <div key={entry.id}>
              <SettingsRow
                label={entry.displayName}
                description={entry.description}
                value={<SettingsValue>{entry.category}</SettingsValue>}
                actions={
                  <SettingsButton
                    onClick={() => beginAddCatalogue(entry)}
                    disabled={busyId === entry.id || isDraft}
                  >
                    {added ? "Add another" : "Add"}
                  </SettingsButton>
                }
              />
              {isDraft ? (
                <div className="ml-3 mt-1 space-y-2 border-l border-(--ui-separator) pl-3">
                  {Object.keys(catalogueEnv).length ? (
                    Object.keys(catalogueEnv).map((key) => (
                      <SettingsRow
                        key={key}
                        label={key}
                        description={entry.requiredEnv?.includes(key) ? "Required" : "Optional"}
                        control={
                          <SettingsInput
                            type="password"
                            value={catalogueEnv[key]}
                            onChange={(value) =>
                              setCatalogueEnv((current) => ({ ...current, [key]: value }))
                            }
                            placeholder={key}
                          />
                        }
                      />
                    ))
                  ) : (
                    <div className="py-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
                      No configuration needed.
                    </div>
                  )}
                  <div className="flex justify-end gap-1 pb-1">
                    <SettingsButton onClick={() => setCatalogueDraft(null)}>Cancel</SettingsButton>
                    <SettingsButton
                      tone="primary"
                      onClick={submitCatalogue}
                      disabled={busyId === entry.id}
                    >
                      Add server
                    </SettingsButton>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup
        title="Add custom server"
        description="Add any stdio MCP server by its launch command. Runs locally with the command, args, and environment you specify."
        actions={
          <SettingsButton onClick={() => setManualOpen((open) => !open)}>
            {manualOpen ? "Close" : "Add custom"}
          </SettingsButton>
        }
      >
        {manualOpen ? (
          <div className="space-y-2">
            <SettingsRow
              label="Name"
              description="Display name for this server."
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
              description="Executable to launch (e.g. npx, node, python, uvx)."
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
              description="Space-separated args (e.g. -y @scope/server-name)."
              control={
                <SettingsInput
                  value={manualArgs}
                  onChange={setManualArgs}
                  placeholder="-y @scope/server-name"
                />
              }
            />
            <SettingsRow
              label="Environment"
              description="One KEY=value per line. Use for API keys or tokens."
              control={
                <textarea
                  value={manualEnv}
                  onChange={(event) => setManualEnv(event.target.value)}
                  placeholder={"API_KEY=...\nANOTHER=..."}
                  rows={3}
                  className="w-full resize-none rounded-md border border-(--ui-separator) bg-(--ui-bg) px-2.5 py-1.5 text-[length:var(--fs-base)] text-(--ui-fg) outline-none placeholder:text-(--ui-muted)/50 focus:border-(--ui-accent)/40"
                />
              }
            />
            <div className="flex justify-end gap-1">
              <SettingsButton onClick={() => setManualOpen(false)}>Cancel</SettingsButton>
              <SettingsButton
                tone="primary"
                onClick={submitManual}
                disabled={!manualName.trim() || !manualCommand.trim() || busyId === "manual"}
              >
                Add server
              </SettingsButton>
            </div>
          </div>
        ) : (
          <EmptySafeNotice>
            Use “Add custom” to register any stdio MCP server by its launch command.
          </EmptySafeNotice>
        )}
      </SettingsGroup>
    </div>
  );
}

function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function ServerPill({ server }: { server: McpServer }) {
  if (server.source === BUILTIN_SOURCE) {
    return <StatusPill tone={server.enabled ? "good" : "default"}>built-in</StatusPill>;
  }
  return <StatusPill tone={server.enabled ? "info" : "default"}>mcp</StatusPill>;
}

function serverDescription(server: McpServer): string {
  const summary = server.description?.replace(/\s+/g, " ").trim();
  const short = summary && summary.length > 150 ? `${summary.slice(0, 147)}…` : summary;
  return short || "MCP server";
}

function serverLocation(server: McpServer): string {
  const where = server.source ?? "local";
  return `${server.enabled ? "enabled" : "disabled"} · ${where} · @${server.name}`;
}
