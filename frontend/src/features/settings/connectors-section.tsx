"use client";

import { useCallback, useMemo, useState } from "react";
import { Schema } from "effect";
import {
  ConnectorSshPathResponseSchema,
  ConnectorTestResponseSchema,
  ConnectorsResponseSchema,
  GITHUB_CONNECTOR_TOKEN_KEY,
  GitHubConnectorArtifactStatusSchema,
  type ConnectorView,
  type GitHubConnectorArtifactStatus,
} from "@local-studio/agent-runtime/connector-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";
import { Button, Checkbox, FormField, Input, ModelButton, SearchInput, Spinner } from "@/ui";
import { Plus, Trash2 } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
} from "@/features/recipes/recipes-content/model-page";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { githubCredentialUpdate, hasStoredGitHubCredential } from "./github-connector-credentials";

interface CatalogEntry {
  id: string;
  name: string;
  company: string;
  description: string;
  transport: "stdio";
  command: string;
  args: string[];
  envFields: Array<{ key: string; label: string; placeholder?: string }>;
}

const CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    company: "GitHub",
    description: "Repos, issues, pull requests, and code search.",
    transport: "stdio",
    command: "github-mcp-server",
    args: ["stdio", "--read-only", "--toolsets=repos,issues,pull_requests"],
    envFields: [{ key: GITHUB_CONNECTOR_TOKEN_KEY, label: "Personal access token" }],
  },
  {
    id: "x",
    name: "X / Twitter",
    company: "X",
    description: "Read and post with X API credentials.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@enescinar/twitter-mcp"],
    envFields: [
      { key: "API_KEY", label: "X API key" },
      { key: "API_SECRET_KEY", label: "X API secret" },
      { key: "ACCESS_TOKEN", label: "Access token" },
      { key: "ACCESS_TOKEN_SECRET", label: "Access token secret" },
    ],
  },
  {
    id: "computer",
    name: "Remote computer",
    company: "Local Studio",
    description: "Run commands and work with files over SSH on another machine.",
    transport: "stdio",
    command: "node",
    args: ["{{SSH_REMOTE_SERVER}}"],
    envFields: [{ key: "SSH_HOST", label: "SSH host", placeholder: "user@machine" }],
  },
];

function responseError(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ApiErrorResponseSchema)(body).error;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(
  url: string,
  decode: (input: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, `HTTP ${response.status}`));
  return decode(body);
}

const connectorCommand = (connector: ConnectorView): string =>
  connector.transport === "stdio"
    ? [connector.command, ...(connector.args ?? [])].filter(Boolean).join(" ")
    : (connector.url ?? "HTTP endpoint not set");

function GitHubRecoveryFooter({
  token,
  saving,
  confirmingRemoval,
  onClose,
  onCancelRemoval,
  onConfirmRemoval,
  onRemove,
  onUpdate,
}: {
  token: string;
  saving: boolean;
  confirmingRemoval: boolean;
  onClose: () => void;
  onCancelRemoval: () => void;
  onConfirmRemoval: () => void;
  onRemove: () => void;
  onUpdate: () => void;
}) {
  if (confirmingRemoval) {
    return (
      <>
        <Button variant="secondary" disabled={saving} onClick={onCancelRemoval}>
          Keep connector
        </Button>
        <Button variant="danger" loading={saving} onClick={onConfirmRemoval}>
          Confirm removal
        </Button>
      </>
    );
  }
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button variant="danger" onClick={onRemove} disabled={saving}>
        Remove connector
      </Button>
      <Button loading={saving} disabled={!token.trim() || saving} onClick={onUpdate}>
        Update credential and enable
      </Button>
    </>
  );
}

function ConnectorDrawer({
  connector,
  onClose,
  onChanged,
}: {
  connector: ConnectorView;
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [name, setName] = useState(connector.name);
  const [command, setCommand] = useState(connector.command ?? "");
  const [args, setArgs] = useState((connector.args ?? []).join("\n"));
  const [url, setUrl] = useState(connector.url ?? "");
  const [enabled, setEnabled] = useState(connector.enabled);
  const [githubToken, setGitHubToken] = useState("");
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const managed = Boolean(connector.origin);
  const managedGitHub = connector.origin?.kind === "catalog" && connector.origin.id === "github";

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { connectors } = await requestJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: connector.id,
            name: name.trim() || connector.name,
            transport: connector.transport,
            command: command.trim() || undefined,
            args: args
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
            url: url.trim() || undefined,
            env: connector.env,
            cwd: connector.cwd,
            headers: connector.headers,
            allowTools: connector.allowTools,
            enabled,
          }),
        },
      );
      onChanged(connectors);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Connector save failed");
    } finally {
      setSaving(false);
    }
  };

  const updateGitHubCredential = async () => {
    setSaving(true);
    setError("");
    try {
      const { connectors } = await requestJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(githubCredentialUpdate(githubToken)),
        },
      );
      setGitHubToken("");
      onChanged(connectors);
      onClose();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Credential update failed");
    } finally {
      setSaving(false);
    }
  };

  const removeManagedGitHub = async () => {
    setSaving(true);
    setError("");
    try {
      const { connectors } = await requestJson(
        `/api/agent/connectors?id=${encodeURIComponent(connector.id)}`,
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        { method: "DELETE" },
      );
      onChanged(connectors);
      onClose();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Connector removal failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResourceDrawer
      title={connector.name}
      icon={<ResourceLogo identity={connector.id} label={connector.name} />}
      badge={
        <ModelStatus tone={connector.enabled ? "good" : "default"}>
          {connector.enabled ? "enabled" : "disabled"}
        </ModelStatus>
      }
      status={
        connector.origin
          ? `${connector.origin.kind} · ${connector.origin.id}`
          : `${connector.transport} · connectors.json`
      }
      footer={
        managedGitHub ? (
          <GitHubRecoveryFooter
            token={githubToken}
            saving={saving}
            confirmingRemoval={confirmingRemoval}
            onClose={onClose}
            onCancelRemoval={() => setConfirmingRemoval(false)}
            onConfirmRemoval={() => void removeManagedGitHub()}
            onRemove={() => setConfirmingRemoval(true)}
            onUpdate={() => void updateGitHubCredential()}
          />
        ) : managed ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Save connector
            </Button>
          </>
        )
      }
      onClose={onClose}
      width={680}
    >
      <ResourceDrawerSection title="Identity">
        <ResourceFact label="Connector ID" value={connector.id} mono />
        <ResourceFact label="Transport" value={connector.transport} mono />
        <ResourceFact
          label="Managed by"
          value={connector.origin ? `${connector.origin.kind} · ${connector.origin.id}` : "You"}
        />
        <ResourceFact
          label="Secrets"
          value={
            connector.secret_keys.length ? connector.secret_keys.join(" · ") : "No stored secrets"
          }
          mono
        />
      </ResourceDrawerSection>
      {managed ? (
        <ResourceDrawerSection title="Launch configuration">
          <ResourceFact label="Command" value={connectorCommand(connector)} mono />
          <ResourceFact
            label="Allowed tools"
            value={connector.allowTools?.join(" · ") || "All declared tools"}
            mono
          />
        </ResourceDrawerSection>
      ) : (
        <div className="space-y-4">
          <FormField label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          {connector.transport === "stdio" ? (
            <>
              <FormField label="Command">
                <Input
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  className="font-mono"
                />
              </FormField>
              <FormField label="Arguments" description="One argument per line.">
                <textarea
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  rows={7}
                  className="w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 py-2 font-mono text-[length:var(--fs-sm)] text-(--ui-fg) focus:border-(--ui-accent)/60 focus:outline-none"
                />
              </FormField>
            </>
          ) : (
            <FormField label="URL">
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className="font-mono"
              />
            </FormField>
          )}
          <Checkbox checked={enabled} onChange={setEnabled} label="Enabled in Workbench" />
        </div>
      )}
      {managedGitHub ? (
        <ResourceDrawerSection title="Credential recovery">
          <p className="mb-4 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
            Stored credentials are never displayed. Enter a replacement token to repair access, or
            remove the connector and reconnect it later.
          </p>
          <FormField
            label="New personal access token"
            description="The replacement is stored locally and enables the connector after saving."
          >
            <Input
              type="password"
              value={githubToken}
              onChange={(event) => setGitHubToken(event.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </FormField>
        </ResourceDrawerSection>
      ) : null}
      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}

function CatalogDrawer({
  entry,
  existing,
  onClose,
  onChanged,
  onGitHubArtifactChanged,
}: {
  entry: CatalogEntry;
  existing: ConnectorView | null;
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
  onGitHubArtifactChanged: (status: GitHubConnectorArtifactStatus) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const enteredGitHubToken = fields[GITHUB_CONNECTOR_TOKEN_KEY] ?? "";
      const githubUpdate =
        entry.id === "github" && enteredGitHubToken.trim()
          ? githubCredentialUpdate(enteredGitHubToken)
          : null;
      if (entry.id === "github" && !githubUpdate && !hasStoredGitHubCredential(existing)) {
        throw new Error("Enter a personal access token");
      }
      if (entry.id === "github") {
        onGitHubArtifactChanged(
          await requestJson(
            "/api/agent/connectors/github",
            Schema.decodeUnknownSync(GitHubConnectorArtifactStatusSchema),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "install" }),
            },
          ),
        );
      }
      let args = entry.args;
      if (entry.args.includes("{{SSH_REMOTE_SERVER}}")) {
        const { path } = await requestJson(
          "/api/agent/connectors/ssh-server-path",
          Schema.decodeUnknownSync(ConnectorSshPathResponseSchema),
        );
        if (!path) throw new Error("Bundled SSH server not found");
        args = entry.args.map((value) => (value === "{{SSH_REMOTE_SERVER}}" ? path : value));
      }
      const host = fields.SSH_HOST?.trim();
      const id = entry.id === "computer" && host ? `computer-${host.split("@").pop()}` : entry.id;
      const name = entry.id === "computer" && host ? `Computer: ${host}` : entry.name;
      const github = entry.id === "github";
      const { connectors } = await requestJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            github
              ? (githubUpdate ?? {
                  id: "github",
                  catalogId: "github",
                  env: existing?.env,
                  enabled: true,
                })
              : {
                  id: id.toLowerCase().replace(/[^a-z0-9-_]+/g, "-"),
                  name,
                  transport: entry.transport,
                  command: entry.command,
                  args,
                  env: fields,
                  enabled: true,
                },
          ),
        },
      );
      onChanged(connectors);
      onClose();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Connector setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResourceDrawer
      title={`Connect ${entry.name}`}
      icon={<ResourceLogo identity={entry.id} label={entry.name} company={entry.company} />}
      badge={<ModelStatus>catalog</ModelStatus>}
      status={`${entry.company} · ${entry.transport}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void add()}>
            Connect
          </Button>
        </>
      }
      onClose={onClose}
    >
      <p className="mb-6 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
        {entry.description}
      </p>
      <ResourceDrawerSection title="Provider">
        <ResourceFact label="Company" value={entry.company} />
        <ResourceFact label="Transport" value={entry.transport} mono />
        <ResourceFact label="Command" value={[entry.command, ...entry.args].join(" ")} mono />
      </ResourceDrawerSection>
      <div className="space-y-4">
        {entry.envFields.map((field) => (
          <FormField key={field.key} label={field.label}>
            <Input
              value={fields[field.key] ?? ""}
              onChange={(event) =>
                setFields((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder}
              type={/token|secret|key/i.test(field.key) ? "password" : "text"}
              className="font-mono"
            />
          </FormField>
        ))}
      </div>
      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}

function ConnectorRow({
  connector,
  onOpen,
  onChanged,
}: {
  connector: ConnectorView;
  onOpen: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const update = async (init: RequestInit) => {
    const { connectors } = await requestJson(
      "/api/agent/connectors",
      Schema.decodeUnknownSync(ConnectorsResponseSchema),
      init,
    );
    onChanged(connectors);
  };

  const toggle = () => {
    const managedGitHub = connector.origin?.kind === "catalog" && connector.origin.id === "github";
    const body = managedGitHub
      ? {
          id: "github",
          catalogId: "github",
          env: connector.env,
          enabled: !connector.enabled,
        }
      : { ...connector, enabled: !connector.enabled };
    return update({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  const remove = async () => {
    const { connectors } = await requestJson(
      `/api/agent/connectors?id=${encodeURIComponent(connector.id)}`,
      Schema.decodeUnknownSync(ConnectorsResponseSchema),
      { method: "DELETE" },
    );
    onChanged(connectors);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await requestJson(
        "/api/agent/connectors/test",
        Schema.decodeUnknownSync(ConnectorTestResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: connector.id }),
        },
      );
      setTestResult(result.ok ? `${result.tool_count} tools` : (result.error ?? "failed"));
    } catch (testError) {
      setTestResult(testError instanceof Error ? testError.message : "failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <ModelRow
      label={connector.name}
      description={
        connector.origin
          ? `${connector.origin.kind} · ${connector.origin.id}`
          : `${connector.transport} connector`
      }
      leading={<ResourceLogo identity={connector.id} label={connector.name} />}
      value={<ModelValue mono>{connectorCommand(connector)}</ModelValue>}
      status={
        <ModelStatus tone={connector.enabled ? "good" : "default"}>
          {testResult || (connector.enabled ? "enabled" : "disabled")}
        </ModelStatus>
      }
      actions={
        <>
          <ModelButton onClick={() => void test()} disabled={testing}>
            {testing ? <Spinner size="xs" /> : "Test"}
          </ModelButton>
          <ModelButton onClick={() => void toggle()}>
            {connector.enabled ? "Disable" : "Enable"}
          </ModelButton>
          {!connector.origin ? (
            <ModelButton onClick={() => void remove()} tone="danger" title="Remove connector">
              <Trash2 className="h-3 w-3" />
            </ModelButton>
          ) : null}
        </>
      }
      onClick={onOpen}
    />
  );
}

export function ConnectorsSection() {
  const [connectors, setConnectors] = useState<readonly ConnectorView[]>([]);
  const [githubArtifact, setGitHubArtifact] = useState<GitHubConnectorArtifactStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedConnector, setSelectedConnector] = useState<ConnectorView | null>(null);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogEntry | null>(null);

  const refresh = useCallback(() => {
    const connectorsRequest = requestJson(
      "/api/agent/connectors",
      Schema.decodeUnknownSync(ConnectorsResponseSchema),
    )
      .then(({ connectors: list }) => setConnectors(list))
      .catch(() => setConnectors([]));
    const artifactRequest = requestJson(
      "/api/agent/connectors/github",
      Schema.decodeUnknownSync(GitHubConnectorArtifactStatusSchema),
    )
      .then(setGitHubArtifact)
      .catch(() => setGitHubArtifact(null));
    void Promise.allSettled([connectorsRequest, artifactRequest]).then(() => setLoaded(true));
  }, []);

  useMountSubscription(() => {
    refresh();
  }, [refresh]);

  const normalized = query.trim().toLowerCase();
  const visibleConnectors = useMemo(
    () =>
      connectors.filter(
        (connector) =>
          connector.origin?.kind !== "account-adapter" &&
          (!normalized ||
            `${connector.name} ${connector.id} ${connectorCommand(connector)}`
              .toLowerCase()
              .includes(normalized)),
      ),
    [connectors, normalized],
  );
  const visibleCatalog = CATALOG.filter(
    (entry) =>
      !normalized ||
      `${entry.name} ${entry.company} ${entry.description}`.toLowerCase().includes(normalized),
  );

  return (
    <div className="space-y-7">
      <ModelSection
        title="Connectors"
        description="MCP servers, accounts, services, and machines available to Workbench."
        actions={
          <ModelStatus tone={loaded ? "good" : "default"}>
            {loaded ? `${visibleConnectors.length} connected` : "discovering"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search connectors"
          description="Name, company, transport, command, or endpoint."
          control={
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search connectors"
              className="w-full"
            />
          }
          status={<ModelStatus>{visibleConnectors.length + visibleCatalog.length}</ModelStatus>}
        />
        {visibleConnectors.map((connector) => (
          <ConnectorRow
            key={connector.id}
            connector={connector}
            onOpen={() => setSelectedConnector(connector)}
            onChanged={setConnectors}
          />
        ))}
        {loaded && visibleConnectors.length === 0 ? (
          <div className="px-4 py-7 text-center text-[length:var(--fs-md)] text-(--ui-muted)">
            No connected MCP servers match this search.
          </div>
        ) : null}
      </ModelSection>

      <ModelSection
        title="Catalog"
        description="Known integrations with their provider and launch configuration."
        actions={<ModelStatus>{visibleCatalog.length} integrations</ModelStatus>}
      >
        {visibleCatalog.map((entry) => {
          const installedConnector = connectors.find((connector) => connector.id === entry.id);
          const installed = Boolean(installedConnector);
          const managedGitHub =
            entry.id === "github" &&
            installedConnector?.origin?.kind === "catalog" &&
            installedConnector.origin.id === "github";
          const artifactReady = !managedGitHub || githubArtifact?.state === "installed";
          const ready = installed && artifactReady;
          const openEntry = () =>
            installedConnector && artifactReady
              ? setSelectedConnector(installedConnector)
              : setSelectedCatalog(entry);
          return (
            <ModelRow
              key={entry.id}
              label={entry.name}
              description={`${entry.company} · ${entry.description}`}
              leading={
                <ResourceLogo identity={entry.id} label={entry.name} company={entry.company} />
              }
              value={<ModelValue mono>{[entry.command, ...entry.args].join(" ")}</ModelValue>}
              status={
                <ModelStatus tone={ready ? "good" : "default"}>
                  {ready ? "connected" : installed ? "install required" : "available"}
                </ModelStatus>
              }
              actions={
                <ModelButton onClick={openEntry} tone={ready ? "default" : "primary"}>
                  {ready && entry.id !== "computer" ? "Open" : <Plus className="h-3 w-3" />}
                </ModelButton>
              }
              onClick={openEntry}
            />
          );
        })}
      </ModelSection>

      {selectedConnector ? (
        <ConnectorDrawer
          connector={selectedConnector}
          onClose={() => setSelectedConnector(null)}
          onChanged={setConnectors}
        />
      ) : null}
      {selectedCatalog ? (
        <CatalogDrawer
          entry={selectedCatalog}
          existing={connectors.find((connector) => connector.id === selectedCatalog.id) ?? null}
          onClose={() => setSelectedCatalog(null)}
          onChanged={setConnectors}
          onGitHubArtifactChanged={setGitHubArtifact}
        />
      ) : null}
    </div>
  );
}
