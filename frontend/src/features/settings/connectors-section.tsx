"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  ConnectorTestResponseSchema,
  ConnectorsResponseSchema,
  type ConnectorRisk,
  type ConnectorToolPermission,
  type ConnectorView,
} from "@local-studio/agent-runtime/connector-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";
import { Plug, Plus, Trash2 } from "@/ui/icon-registry";
import { Alert, Checkbox, Input, Spinner } from "@/ui";
import { decodeDesktopBridgeJson, embeddedDesktopBridge } from "@/lib/embedded-desktop-bridge";
import { SettingsButton, SettingsGroup } from "./settings-ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

interface CatalogEntry {
  id: "github" | "x" | "computer";
  name: string;
  description: string;
  envFields: Array<{ key: string; label: string; placeholder?: string }>;
}

type ConnectorReviewIdentity = {
  artifactDigest?: string;
  inventoryDigest: string;
};

const CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repos, issues, PRs, code search.",
    envFields: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Personal access token" }],
  },
  {
    id: "x",
    name: "X / Twitter",
    description: "Read and post with X API credentials.",
    envFields: [
      { key: "API_KEY", label: "X API key" },
      { key: "API_SECRET_KEY", label: "X API secret" },
      { key: "ACCESS_TOKEN", label: "Access token" },
      { key: "ACCESS_TOKEN_SECRET", label: "Access token secret" },
    ],
  },
  {
    id: "computer",
    name: "Remote computer (ssh)",
    description: "Run commands and read/write files on one of your machines.",
    envFields: [{ key: "SSH_HOST", label: "user@host", placeholder: "ser@pop-os" }],
  },
];
const exact = { onExcessProperty: "error" } as const;

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

async function listManagedConnectors() {
  const decode = Schema.decodeUnknownSync(ConnectorsResponseSchema, exact);
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decode(await bridge.connectors.list())
    : requestJson("/api/agent/connectors", decode);
}

async function saveManagedConnector(payload: unknown) {
  const decode = Schema.decodeUnknownSync(ConnectorsResponseSchema, exact);
  const serialized = JSON.stringify(payload);
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decode(await bridge.connectors.save(serialized))
    : requestJson("/api/agent/connectors", decode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized,
      });
}

async function removeManagedConnector(id: string) {
  const decode = Schema.decodeUnknownSync(ConnectorsResponseSchema, exact);
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decode(await bridge.connectors.remove(id))
    : requestJson(`/api/agent/connectors?id=${encodeURIComponent(id)}`, decode, {
        method: "DELETE",
      });
}

async function probeConfiguredConnector(id: string) {
  const decode = Schema.decodeUnknownSync(ConnectorTestResponseSchema, exact);
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decodeDesktopBridgeJson(await bridge.connectors.probe(id), decode)
    : requestJson("/api/agent/connectors/test", decode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
}

function catalogId(connector: ConnectorView): CatalogEntry["id"] | null {
  const id = connector.origin?.id;
  return id === "github" || id === "x" || id === "computer" ? id : null;
}

function connectorUpdatePayload(
  connector: ConnectorView,
  enabled: boolean,
  allowTools: readonly string[],
  identity?: ConnectorReviewIdentity,
) {
  const managedCatalogId = catalogId(connector);
  if (managedCatalogId) {
    return {
      id: connector.id,
      catalogId: managedCatalogId,
      ...(connector.env ? { env: connector.env } : {}),
      allowTools,
      permissionReviewed: true,
      enabled,
    };
  }
  return {
    id: connector.id,
    name: connector.name,
    transport: connector.transport,
    ...(connector.command ? { command: connector.command } : {}),
    ...(connector.args ? { args: connector.args } : {}),
    ...(connector.env ? { env: connector.env } : {}),
    ...(connector.cwd ? { cwd: connector.cwd } : {}),
    ...(connector.url ? { url: connector.url } : {}),
    ...(connector.headers ? { headers: connector.headers } : {}),
    allowTools,
    permissionReviewed: true,
    ...(identity?.artifactDigest
      ? {
          reviewedArtifactDigest: identity.artifactDigest,
          reviewedInventoryDigest: identity.inventoryDigest,
        }
      : {}),
    enabled,
  };
}

function riskLabel(risk: ConnectorRisk): string {
  if (risk === "read") return "Read-only · automatic";
  if (risk === "mutating") return "Mutating · approval required";
  return "Critical · highest confirmation";
}

function riskClassName(risk: ConnectorRisk): string {
  if (risk === "read") return "text-(--ui-success)";
  if (risk === "mutating") return "text-(--ui-warning)";
  return "text-(--ui-danger)";
}

function PermissionEditor({
  tools,
  selected,
  busy,
  onToggle,
  onSave,
  onCancel,
}: {
  tools: readonly ConnectorToolPermission[];
  selected: readonly string[];
  busy: boolean;
  onToggle: (tool: string, enabled: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const protectedCount = tools.filter((tool) => tool.risk !== "read").length;
  return (
    <div className="border-t border-(--border) px-4 py-3.5">
      <Alert variant={protectedCount ? "warning" : "info"}>
        Read-only tools run automatically after you grant them. Mutating and critical tools pause
        for a one-use approval every time.
      </Alert>
      <div className="mt-3 space-y-2">
        {tools.length ? (
          tools.map((tool) => (
            <div
              key={tool.name}
              className="rounded-[var(--rad-lg)] border border-(--ui-border) p-3"
            >
              <Checkbox
                checked={selected.includes(tool.name)}
                onChange={(enabled) => onToggle(tool.name, enabled)}
                disabled={busy}
                label={tool.name}
                description={tool.description}
                labelClassName="font-mono"
              />
              <div
                className={`mt-1 pl-6 text-[length:var(--fs-xs)] font-medium ${riskClassName(tool.risk)}`}
              >
                {riskLabel(tool.risk)}
              </div>
            </div>
          ))
        ) : (
          <div className="text-[length:var(--fs-sm)] text-(--dim)">
            This connector advertised no tools. Saving an empty grant exposes nothing.
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <SettingsButton onClick={onCancel} disabled={busy}>
          Cancel
        </SettingsButton>
        <SettingsButton onClick={onSave} disabled={busy} tone="primary">
          {busy ? <Spinner size="xs" /> : "Save grant & enable"}
        </SettingsButton>
      </div>
    </div>
  );
}

function ConnectorRow({
  connector,
  onChanged,
}: {
  connector: ConnectorView;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<readonly ConnectorToolPermission[] | null>(null);
  const [selected, setSelected] = useState<readonly string[]>(connector.allowTools);
  const [reviewIdentity, setReviewIdentity] = useState<ConnectorReviewIdentity | null>(null);

  const loadPermissions = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      const result = await probeConfiguredConnector(connector.id);
      if (!result.ok) throw new Error(result.error ?? "Connector discovery failed");
      setPermissions(result.tools);
      setReviewIdentity({
        ...(result.artifact_digest ? { artifactDigest: result.artifact_digest } : {}),
        inventoryDigest: result.inventory_digest,
      });
      setSelected(
        result.tools
          .filter((tool) =>
            connector.permissionReviewed
              ? connector.allowTools.includes(tool.name)
              : tool.default_granted,
          )
          .map((tool) => tool.name),
      );
      setTestResult(`${result.tool_count} tools`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Connector discovery failed";
      setTestResult(message);
      setError(message);
      setReviewIdentity(null);
    } finally {
      setTesting(false);
    }
  }, [connector.allowTools, connector.id, connector.permissionReviewed]);

  useMountSubscription(() => {
    if (!connector.permissionReviewed) void loadPermissions();
  }, [connector.permissionReviewed, loadPermissions]);

  const updateConnector = async (
    enabled: boolean,
    grant = connector.allowTools,
    identity?: ConnectorReviewIdentity,
  ) => {
    const { connectors } = await saveManagedConnector(
      connectorUpdatePayload(connector, enabled, grant, identity),
    );
    onChanged(connectors);
  };

  const toggle = async () => {
    setError(null);
    try {
      if (!connector.enabled && !connector.permissionReviewed) {
        await loadPermissions();
        return;
      }
      setSaving(true);
      await updateConnector(!connector.enabled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connector could not be updated");
    } finally {
      setSaving(false);
    }
  };

  const saveGrant = async () => {
    if (!permissions) return;
    setSaving(true);
    setError(null);
    try {
      const grant = permissions
        .filter((tool) => selected.includes(tool.name))
        .map((tool) => tool.name);
      await updateConnector(true, grant, reviewIdentity ?? undefined);
      setPermissions(null);
      setReviewIdentity(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Permission grant could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      const { connectors } = await removeManagedConnector(connector.id);
      onChanged(connectors);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connector could not be removed");
    }
  };

  const togglePermission = (tool: string, enabled: boolean) => {
    setSelected((current) =>
      enabled ? [...new Set([...current, tool])] : current.filter((entry) => entry !== tool),
    );
  };

  return (
    <div className="border-b border-(--border) last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Plug className={`h-3.5 w-3.5 ${connector.enabled ? "text-(--accent)" : "text-(--dim)"}`} />
        <div className="min-w-40">
          <div className="text-[length:var(--fs-md)]">{connector.name}</div>
          <div className="text-[11px] font-mono text-(--dim)">
            {connector.transport === "stdio"
              ? [connector.command, ...(connector.args ?? [])].join(" ")
              : connector.url}
          </div>
          {!connector.permissionReviewed ? (
            <div className="mt-1 text-[length:var(--fs-xs)] text-(--ui-warning)">
              Permission review required
            </div>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {testResult ? (
            <span className="text-[11px] font-mono text-(--dim)">{testResult}</span>
          ) : null}
          <SettingsButton onClick={() => void loadPermissions()} disabled={testing || saving}>
            {testing ? <Spinner size="xs" /> : "Review tools"}
          </SettingsButton>
          <SettingsButton onClick={() => void toggle()} disabled={testing || saving}>
            {connector.enabled ? "Disable" : connector.permissionReviewed ? "Enable" : "Review"}
          </SettingsButton>
          <SettingsButton onClick={() => void remove()} title="Remove connector" disabled={saving}>
            <Trash2 className="h-3 w-3" />
          </SettingsButton>
        </div>
      </div>
      {error ? <div className="px-4 pb-3 text-[11px] text-(--err)">{error}</div> : null}
      {permissions ? (
        <PermissionEditor
          tools={permissions}
          selected={selected}
          busy={saving}
          onToggle={togglePermission}
          onSave={() => void saveGrant()}
          onCancel={() => {
            setPermissions(null);
            setReviewIdentity(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CatalogCard({
  entry,
  installed,
  onChanged,
}: {
  entry: CatalogEntry;
  installed: boolean;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const host = fields.SSH_HOST?.trim();
      const id = entry.id === "computer" && host ? `computer-${host.split("@").pop()}` : entry.id;
      const { connectors } = await saveManagedConnector({
        id: id.toLowerCase().replace(/[^a-z0-9-_]+/g, "-"),
        catalogId: entry.id,
        env: fields,
        allowTools: [],
        permissionReviewed: false,
        enabled: false,
      });
      onChanged(connectors);
      setOpen(false);
      setFields({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to add connector");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-(--border) px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[length:var(--fs-md)]">{entry.name}</div>
          <div className="text-[11px] text-(--dim)">{entry.description}</div>
        </div>
        <SettingsButton
          onClick={() => setOpen((value) => !value)}
          disabled={installed && entry.id !== "computer"}
        >
          {installed && entry.id !== "computer" ? (
            "Added"
          ) : (
            <>
              <Plus className="h-3 w-3" />
              Add
            </>
          )}
        </SettingsButton>
      </div>
      {open ? (
        <div className="mt-2 space-y-2">
          {entry.envFields.map((field) => (
            <Input
              key={field.key}
              value={fields[field.key] ?? ""}
              onChange={(event) =>
                setFields((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder ?? field.label}
              spellCheck={false}
              type={/token|secret|key/i.test(field.key) ? "password" : "text"}
              className="font-mono"
            />
          ))}
          {error ? <div className="text-[11px] text-(--err)">{error}</div> : null}
          <SettingsButton onClick={() => void add()} disabled={busy}>
            {busy ? <Spinner size="xs" /> : "Install for review"}
          </SettingsButton>
        </div>
      ) : null}
    </div>
  );
}

export function ConnectorsSection() {
  const [connectors, setConnectors] = useState<readonly ConnectorView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void listManagedConnectors()
      .then(({ connectors: list }) => setConnectors(list))
      .catch(() => setConnectors([]))
      .finally(() => setLoaded(true));
  }, []);

  useMountSubscription(refresh, [refresh]);

  const installedIds = new Set(connectors.map((connector) => connector.id));
  const visibleConnectors = connectors.filter(
    (connector) => connector.origin?.kind !== "account-adapter",
  );

  return (
    <div>
      <SettingsGroup
        title="Connectors"
        description="MCP servers the agent can use — accounts, services, and your other machines. Stored in connectors.json (mcp.json-compatible)."
      >
        {!loaded ? (
          <div className="px-4 py-3.5">
            <Spinner size="xs" />
          </div>
        ) : visibleConnectors.length === 0 ? (
          <div className="px-4 py-3.5 text-[length:var(--fs-md)] text-(--dim)">
            No connectors yet. Add one from the catalog below.
          </div>
        ) : (
          visibleConnectors.map((connector) => (
            <ConnectorRow key={connector.id} connector={connector} onChanged={setConnectors} />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Catalog"
        description="Published MCP servers are installed disabled until you review their exact tool grants and risk tiers."
      >
        <div className="grid gap-2 px-4 py-3.5 md:grid-cols-2">
          {CATALOG.map((entry) => (
            <CatalogCard
              key={entry.id}
              entry={entry}
              installed={installedIds.has(entry.id)}
              onChanged={setConnectors}
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
