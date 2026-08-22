"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  OAuthAuthorizeResponseSchema,
  OAuthStatusResponseSchema,
  type OAuthConnectorAuthDefinition,
  type OAuthStatusResponse,
} from "@local-studio/agent-runtime/oauth-connector-contract";
import {
  ConnectorsResponseSchema,
  type ConnectorView,
} from "@local-studio/agent-runtime/connector-contract";
import { Alert, Button, FormField, Input, Spinner, StatusPill } from "@/ui";
import { ExternalLink } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { StatusText } from "@/features/recipes/recipes-content/catalog-table-shell";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { jsonBody, requestAgentJson } from "./agent-json";
import { openExternal } from "./google-account-model";
import { renderCommandLine, type CatalogEntry } from "./connector-catalog";

/**
 * The Connect surface for an OAuth-capable catalog connector.
 *
 * There is no token field here, deliberately and permanently: the runtime owns
 * the grant. What this drawer does is narrate the flow — Connect, type the
 * shown code on the provider's site, watch the status flip to connected. The one text input
 * that can appear is the provider's PUBLIC client id, asked for once when the
 * provider ships no baked-in client, with a deep link that pre-fills the
 * provider's registration form so getting one is a click.
 */

const decodeStatus = Schema.decodeUnknownSync(OAuthStatusResponseSchema);
const decodeAuthorize = Schema.decodeUnknownSync(OAuthAuthorizeResponseSchema);
const decodeConnectors = Schema.decodeUnknownSync(ConnectorsResponseSchema);

const statusUrl = (connectorId: string) =>
  `/api/agent/oauth/status?connectorId=${encodeURIComponent(connectorId)}`;

const hostOf = (uri: string) => uri.replace(/^https?:\/\//, "");

function DeviceCodePanel({
  userCode,
  verificationUri,
}: {
  userCode: string;
  verificationUri: string;
}) {
  return (
    <div className="rounded-[var(--rad-lg)] border border-(--ui-border) bg-(--ui-surface) px-4 py-3">
      <div className="text-[length:var(--fs-xs)] uppercase tracking-wider text-(--dim)/70">
        Enter this code at {hostOf(verificationUri)}
      </div>
      <div className="mt-2 select-all font-mono text-2xl tracking-[0.2em] text-(--fg)">
        {userCode}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void openExternal(verificationUri)}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open {hostOf(verificationUri)}
        </Button>
        <span className="inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] text-(--dim)">
          <Spinner size="xs" />
          Waiting for approval
        </span>
      </div>
    </div>
  );
}

function FlowProgress({
  waiting,
  pending,
}: {
  waiting: boolean;
  pending: { userCode: string; verificationUri: string } | null;
}) {
  if (pending) {
    return (
      <div className="mb-6">
        <DeviceCodePanel userCode={pending.userCode} verificationUri={pending.verificationUri} />
      </div>
    );
  }
  if (!waiting) return null;
  return (
    <Alert variant="info" className="mb-6">
      Finish the sign-in in your browser. Local Studio is checking for the connection.
    </Alert>
  );
}

function ClientSetup({
  auth,
  company,
  clientDraft,
  onClientDraft,
}: {
  auth: OAuthConnectorAuthDefinition;
  company: string;
  clientDraft: string;
  onClientDraft: (next: string) => void;
}) {
  return (
    <div className="mb-6 space-y-3">
      <FormField label={`${company} OAuth client ID`} description={auth.setupHint}>
        <Input
          value={clientDraft}
          onChange={(event) => onClientDraft(event.target.value)}
          placeholder="Iv1. or Ov23li…"
          className="font-mono"
        />
      </FormField>
      <Button size="sm" variant="secondary" onClick={() => void openExternal(auth.createClientUrl)}>
        <ExternalLink className="h-3.5 w-3.5" />
        Create the OAuth app on {company} (pre-filled)
      </Button>
    </div>
  );
}

function GrantFacts({
  entry,
  status,
  connector,
}: {
  entry: CatalogEntry;
  status: OAuthStatusResponse | null;
  connector: ConnectorView | null;
}) {
  const connected = Boolean(status?.connected);
  const scopes = (connected && status ? status.scopes : (entry.auth?.scopes ?? [])).join(" · ");
  const rowState = !connector
    ? "Not registered yet — connecting registers it, disabled"
    : connector.enabled
      ? "Registered and enabled — tools are offered to the model"
      : "Registered but disabled — enable it from the MCP servers table";
  return (
    <ResourceDrawerSection title="What connecting grants">
      <ResourceFact
        label="Account"
        value={
          connected ? <StatusText tone="ok">{status?.account ?? "connected"}</StatusText> : "none yet"
        }
      />
      <ResourceFact label="Scopes" value={scopes || "—"} mono />
      <ResourceFact label="Runs" value={renderCommandLine(entry.command, entry.args)} mono />
      {entry.auth ? (
        <ResourceFact
          label="Token handling"
          value={`A fresh access token is injected into ${entry.auth.tokenEnv} when the server starts. It is never stored in the server row and never shown.`}
        />
      ) : null}
      <ResourceFact label="State" value={rowState} />
    </ResourceDrawerSection>
  );
}

function FooterActions({
  entryName,
  waiting,
  connected,
  busy,
  connectDisabled,
  onClose,
  onCancel,
  onDisconnect,
  onConnect,
}: {
  entryName: string;
  waiting: boolean;
  connected: boolean;
  busy: boolean;
  connectDisabled: boolean;
  onClose: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  onConnect: () => void;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Close
      </Button>
      {waiting ? (
        <Button variant="secondary" loading={busy} onClick={onCancel}>
          Cancel sign-in
        </Button>
      ) : connected ? (
        <Button variant="danger" loading={busy} onClick={onDisconnect}>
          Disconnect
        </Button>
      ) : (
        <Button loading={busy} disabled={connectDisabled} onClick={onConnect}>
          Connect {entryName}
        </Button>
      )}
    </>
  );
}

/** Status reads plus the poll that watches a flow finish on the provider's site. */
function useOAuthStatus(
  connectorId: string,
  waiting: boolean,
  onSettled: (status: OAuthStatusResponse) => void,
) {
  const [status, setStatus] = useState<OAuthStatusResponse | null>(null);
  const [error, setError] = useState("");

  const refreshStatus = useCallback(async (): Promise<OAuthStatusResponse | null> => {
    try {
      const next = await requestAgentJson(statusUrl(connectorId), decodeStatus);
      setStatus(next);
      return next;
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "OAuth status failed");
      return null;
    }
  }, [connectorId]);

  useMountSubscription(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useMountSubscription(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void refreshStatus().then((next) => {
        if (next && (next.connected || next.error)) onSettled(next);
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, refreshStatus, onSettled]);

  return { status, setStatus, error, setError, refreshStatus };
}

type ActionContext = {
  entryId: string;
  getConfigured: () => boolean;
  getEditingClient: () => boolean;
  getSeededDraft: () => string;
  setStatus: (next: OAuthStatusResponse) => void;
  setEditingClient: (next: boolean) => void;
  setError: (message: string) => void;
  setWaiting: (next: boolean) => void;
  setBusy: (next: boolean) => void;
  refreshStatus: () => Promise<OAuthStatusResponse | null>;
  refreshConnectors: () => Promise<void>;
};

const failureMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

async function saveClientAction(context: ActionContext): Promise<boolean> {
  const trimmed = context.getSeededDraft().trim();
  if (!trimmed) return false;
  const next = await requestAgentJson(statusUrl(context.entryId), decodeStatus, {
    ...jsonBody({ connectorId: context.entryId, clientId: trimmed }),
    method: "PUT",
  });
  context.setStatus(next);
  context.setEditingClient(false);
  return true;
}

async function connectAction(context: ActionContext): Promise<void> {
  context.setBusy(true);
  context.setError("");
  try {
    if (!context.getConfigured() || context.getEditingClient()) {
      if (!(await saveClientAction(context))) {
        context.setError("Paste the OAuth client ID first.");
        return;
      }
    }
    await requestAgentJson(
      "/api/agent/oauth/authorize",
      decodeAuthorize,
      jsonBody({ connectorId: context.entryId }),
    );
    context.setWaiting(true);
    await context.refreshStatus();
  } catch (connectError) {
    context.setError(failureMessage(connectError, "Connect failed"));
  } finally {
    context.setBusy(false);
  }
}

async function cancelConnectAction(context: ActionContext): Promise<void> {
  context.setBusy(true);
  try {
    await requestAgentJson("/api/agent/oauth/authorize", () => true, {
      ...jsonBody({ connectorId: context.entryId }),
      method: "DELETE",
    });
  } catch {
    // Cancelling a flow that already ended is a success, not a failure.
  } finally {
    context.setWaiting(false);
    context.setBusy(false);
    void context.refreshStatus();
  }
}

async function disconnectAction(context: ActionContext): Promise<void> {
  context.setBusy(true);
  context.setError("");
  try {
    const next = await requestAgentJson(
      `/api/agent/oauth?connectorId=${encodeURIComponent(context.entryId)}`,
      decodeStatus,
      { method: "DELETE" },
    );
    context.setStatus(next);
    await context.refreshConnectors();
  } catch (disconnectError) {
    context.setError(failureMessage(disconnectError, "Disconnect failed"));
  } finally {
    context.setBusy(false);
  }
}

export function ConnectorOAuthDrawer({
  entry,
  connector,
  onClose,
  onChanged,
}: {
  entry: CatalogEntry;
  /** The registered row, when one exists — names the enabled state honestly. */
  connector: ConnectorView | null;
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [clientDraft, setClientDraft] = useState("");
  const [editingClient, setEditingClient] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshConnectors = useCallback(async () => {
    const { connectors } = await requestAgentJson("/api/agent/connectors", decodeConnectors);
    onChanged(connectors);
  }, [onChanged]);

  const onFlowSettled = useCallback(
    (settled: OAuthStatusResponse) => {
      setWaiting(false);
      if (settled.connected) void refreshConnectors();
      else if (settled.error) setError(settled.error);
    },
    [refreshConnectors],
  );

  const { status, setStatus, error, setError, refreshStatus } = useOAuthStatus(
    entry.id,
    waiting,
    onFlowSettled,
  );

  const seededDraft = clientDraft || status?.clientId || "";
  const context: ActionContext = {
    entryId: entry.id,
    getConfigured: () => Boolean(status?.configured),
    getEditingClient: () => editingClient,
    getSeededDraft: () => seededDraft,
    setStatus,
    setEditingClient,
    setError,
    setWaiting,
    setBusy,
    refreshStatus,
    refreshConnectors,
  };

  const connected = Boolean(status?.connected);
  const needsClient = Boolean(status) && !status?.configured;
  const showClientSetup = Boolean(entry.auth && status && (needsClient || editingClient));

  return (
    <ResourceDrawer
      title={entry.name}
      icon={<ResourceLogo identity={entry.id} label={entry.name} company={entry.company} />}
      badge={
        <StatusPill tone={connected ? "good" : "default"}>
          {connected ? "connected" : "not connected"}
        </StatusPill>
      }
      status={
        connected && status?.account
          ? `Connected as ${status.account}`
          : "Connects with the provider's own sign-in — no tokens to paste"
      }
      footer={
        <FooterActions
          entryName={entry.name}
          waiting={waiting}
          connected={connected}
          busy={busy}
          connectDisabled={!status || (needsClient && !seededDraft.trim())}
          onClose={onClose}
          onCancel={() => void cancelConnectAction(context)}
          onDisconnect={() => void disconnectAction(context)}
          onConnect={() => void connectAction(context)}
        />
      }
      onClose={onClose}
      width={620}
    >
      <DrawerBody
        entry={entry}
        connector={connector}
        status={status}
        error={error}
        waiting={waiting}
        connected={connected}
        showClientSetup={showClientSetup}
        seededDraft={seededDraft}
        editingClient={editingClient}
        onClientDraft={setClientDraft}
        onEditClient={() => setEditingClient(true)}
      />
    </ResourceDrawer>
  );
}

function DrawerBody({
  entry,
  connector,
  status,
  error,
  waiting,
  connected,
  showClientSetup,
  seededDraft,
  editingClient,
  onClientDraft,
  onEditClient,
}: {
  entry: CatalogEntry;
  connector: ConnectorView | null;
  status: OAuthStatusResponse | null;
  error: string;
  waiting: boolean;
  connected: boolean;
  showClientSetup: boolean;
  seededDraft: string;
  editingClient: boolean;
  onClientDraft: (next: string) => void;
  onEditClient: () => void;
}) {
  return (
    <>
      <p className="mb-6 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
        {entry.description} Connecting authorizes Local Studio with {entry.company} directly; the
        runtime keeps the grant and hands the launched server a fresh access token each time it
        starts. Nothing secret is typed here and nothing secret is shown here.
      </p>

      {!status && !error ? (
        <div className="mb-6 flex items-center gap-2 text-(--dim)">
          <Spinner size="xs" />
          <span className="text-[length:var(--fs-sm)]">Reading connection state</span>
        </div>
      ) : null}

      {showClientSetup && entry.auth ? (
        <ClientSetup
          auth={entry.auth}
          company={entry.company}
          clientDraft={seededDraft}
          onClientDraft={onClientDraft}
        />
      ) : null}

      <FlowProgress waiting={waiting} pending={waiting ? (status?.pending ?? null) : null} />

      <GrantFacts entry={entry} status={status} connector={connector} />

      {status?.configured && !editingClient && !connected && !waiting ? (
        <button
          type="button"
          onClick={onEditClient}
          className="mt-4 text-[length:var(--fs-sm)] text-(--link) hover:underline"
        >
          Change the OAuth client ID
        </button>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
    </>
  );
}
