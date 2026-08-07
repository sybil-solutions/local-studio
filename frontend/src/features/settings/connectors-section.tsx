"use client";

import { useCallback, useMemo, useState } from "react";
import { Schema } from "effect";
import {
  ConnectorSshPathResponseSchema,
  ConnectorTestResponseSchema,
  ConnectorsResponseSchema,
  type ConnectorToolPermission,
  type ConnectorView,
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
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envFields: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Personal access token" }],
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

const probeConnector = (id: string) =>
  requestJson("/api/agent/connectors/test", Schema.decodeUnknownSync(ConnectorTestResponseSchema), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

const updateGrant = (
  current: ReadonlySet<string>,
  tool: string,
  selected: boolean,
): Set<string> => {
  const next = new Set(current);
  if (selected) next.add(tool);
  else next.delete(tool);
  return next;
};

const connectorCommand = (connector: ConnectorView): string =>
  connector.transport === "stdio"
    ? [connector.command, ...(connector.args ?? [])].filter(Boolean).join(" ")
    : (connector.url ?? "HTTP endpoint not set");

function ToolReview({
  tools,
  granted,
  onChange,
}: {
  tools: readonly ConnectorToolPermission[];
  granted: ReadonlySet<string>;
  onChange: (tool: string, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      {tools.map((tool) => (
        <Checkbox
          key={tool.name}
          checked={granted.has(tool.name)}
          onChange={(enabled) => onChange(tool.name, enabled)}
          label={`${tool.name} · ${tool.risk}`}
        />
      ))}
    </div>
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
  const [tools, setTools] = useState<readonly ConnectorToolPermission[] | null>(null);
  const [granted, setGranted] = useState(() => new Set(connector.allowTools));
  const [reviewed, setReviewed] = useState(connector.permissionReviewed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const managed = Boolean(connector.origin);

  const review = async () => {
    setError("");
    try {
      const permissions = (await probeConnector(connector.id)).tools;
      setTools(permissions);
      setGranted(new Set(permissions.flatMap((tool) => (tool.granted ? [tool.name] : []))));
      setReviewed(true);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Tool discovery failed");
    }
  };

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
            allowTools: [...granted],
            permissionReviewed: reviewed,
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
        managed && connector.permissionReviewed && !tools ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={saving} disabled={enabled && !reviewed} onClick={() => void save()}>
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
            value={connector.allowTools.join(" · ") || "None"}
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
      <ResourceDrawerSection title="Tool permissions">
        <Button variant="secondary" onClick={() => void review()}>
          Discover and review tools
        </Button>
        {tools ? (
          <ToolReview
            tools={tools}
            granted={granted}
            onChange={(tool, selected) =>
              setGranted((current) => updateGrant(current, tool, selected))
            }
          />
        ) : null}
      </ResourceDrawerSection>
      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}

function CatalogDrawer({
  entry,
  onClose,
  onChanged,
}: {
  entry: CatalogEntry;
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tools, setTools] = useState<readonly ConnectorToolPermission[] | null>(null);
  const [granted, setGranted] = useState<Set<string>>(new Set());

  const add = async () => {
    setBusy(true);
    setError("");
    try {
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
      const connectorId = id.toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
      const { connectors } = await requestJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: connectorId,
            name,
            transport: entry.transport,
            command: entry.command,
            args,
            env: fields,
            allowTools: [...granted],
            permissionReviewed: tools !== null,
            enabled: tools !== null,
            catalogId: entry.id,
          }),
        },
      );
      onChanged(connectors);
      if (tools) onClose();
      else {
        const permissions = (await probeConnector(connectorId)).tools;
        setTools(permissions);
        setGranted(
          new Set(permissions.flatMap((tool) => (tool.default_granted ? [tool.name] : []))),
        );
      }
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
            {tools ? "Connect" : "Discover permissions"}
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
      {tools ? (
        <ResourceDrawerSection title="Tool permissions">
          <ToolReview
            tools={tools}
            granted={granted}
            onChange={(tool, selected) =>
              setGranted((current) => updateGrant(current, tool, selected))
            }
          />
        </ResourceDrawerSection>
      ) : null}
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

  const toggle = () =>
    update({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...connector, enabled: !connector.enabled }),
    });

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
          <ModelButton onClick={() => (connector.permissionReviewed ? void toggle() : onOpen())}>
            {connector.enabled ? "Disable" : connector.permissionReviewed ? "Enable" : "Review"}
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
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedConnector, setSelectedConnector] = useState<ConnectorView | null>(null);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogEntry | null>(null);

  const refresh = useCallback(() => {
    void requestJson("/api/agent/connectors", Schema.decodeUnknownSync(ConnectorsResponseSchema))
      .then(({ connectors: list }) => setConnectors(list))
      .catch(() => setConnectors([]))
      .finally(() => setLoaded(true));
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
          const openEntry = () =>
            installedConnector
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
                <ModelStatus tone={installed ? "good" : "default"}>
                  {installed ? "connected" : "available"}
                </ModelStatus>
              }
              actions={
                <ModelButton onClick={openEntry} tone={installed ? "default" : "primary"}>
                  {installed && entry.id !== "computer" ? "Open" : <Plus className="h-3 w-3" />}
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
          onClose={() => setSelectedCatalog(null)}
          onChanged={setConnectors}
        />
      ) : null}
    </div>
  );
}
