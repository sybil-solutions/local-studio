"use client";

import { OAUTH_PROVIDERS } from "@/features/agent/oauth/oauth-providers";
import { SettingsButton, SettingsGroup, SettingsInput, SettingsRow, StatusPill } from "@/ui";

export type OAuthStatusView = {
  providerId: string;
  displayName: string;
  hasCredentials: boolean;
  configuredByApp: boolean;
  connected: boolean;
  email: string;
};

export type OAuthClientDraft = {
  clientId: string;
  clientSecret: string;
};

export type OAuthClientDrafts = Record<string, OAuthClientDraft>;

export function OAuthConnectionsPanel({
  statuses,
  drafts,
  busyId,
  onDraftChange,
  onSaveClient,
  onConnect,
  onDisconnect,
}: {
  statuses: OAuthStatusView[];
  drafts: OAuthClientDrafts;
  busyId: string | null;
  onDraftChange: (providerId: string, draft: OAuthClientDraft) => void;
  onSaveClient: (providerId: string) => void;
  onConnect: (providerId: string) => void;
  onDisconnect: (providerId: string) => void;
}) {
  const statusMap = new Map(statuses.map((status) => [status.providerId, status]));
  return (
    <SettingsGroup
      title="Connections"
      description="Connect shared OAuth accounts once. Curated MCP servers use these tokens at launch."
    >
      {OAUTH_PROVIDERS.map((provider) => {
        const status = statusMap.get(provider.id);
        const draft = drafts[provider.id] ?? { clientId: "", clientSecret: "" };
        const saving = busyId === oauthBusyId(provider.id, "save");
        const connecting = busyId === oauthBusyId(provider.id, "connect");
        const disconnecting = busyId === oauthBusyId(provider.id, "disconnect");
        const canSave = Boolean(draft.clientId.trim() && draft.clientSecret.trim());
        return (
          <SettingsRow
            key={provider.id}
            variant="resource"
            label={provider.displayName}
            description={provider.description}
            status={<OAuthStatusPill status={status} />}
            actions={
              <>
                <SettingsButton
                  onClick={() => onConnect(provider.id)}
                  disabled={connecting}
                  title={`Open ${provider.displayName} login`}
                >
                  {status?.connected ? "Reconnect" : connecting ? "Opening" : "Connect"}
                </SettingsButton>
                {status?.connected ? (
                  <SettingsButton
                    tone="danger"
                    onClick={() => onDisconnect(provider.id)}
                    disabled={disconnecting}
                  >
                    Disconnect
                  </SettingsButton>
                ) : null}
              </>
            }
          >
            {status?.email ? (
              <div className="font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
                {status.email}
              </div>
            ) : null}
            {status?.configuredByApp ? (
              <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">
                OAuth client is configured by the app environment.
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                <SettingsInput
                  value={draft.clientId}
                  onChange={(clientId) => onDraftChange(provider.id, { ...draft, clientId })}
                  placeholder={`${provider.displayName} OAuth client ID`}
                  aria-label={`${provider.displayName} OAuth client ID`}
                />
                <SettingsInput
                  type="password"
                  value={draft.clientSecret}
                  onChange={(clientSecret) =>
                    onDraftChange(provider.id, { ...draft, clientSecret })
                  }
                  placeholder={`${provider.displayName} OAuth client secret`}
                  aria-label={`${provider.displayName} OAuth client secret`}
                />
                <SettingsButton
                  tone="primary"
                  onClick={() => onSaveClient(provider.id)}
                  disabled={!canSave || saving}
                >
                  {saving ? "Saving" : status?.hasCredentials ? "Update client" : "Save client"}
                </SettingsButton>
              </div>
            )}
          </SettingsRow>
        );
      })}
    </SettingsGroup>
  );
}

export function oauthBusyId(providerId: string, action: "connect" | "disconnect" | "save") {
  return `oauth:${providerId}:${action}`;
}

function OAuthStatusPill({ status }: { status: OAuthStatusView | undefined }) {
  if (status?.connected) {
    return <StatusPill tone="good">connected</StatusPill>;
  }
  if (status?.hasCredentials) {
    return <StatusPill tone="info">ready</StatusPill>;
  }
  return <StatusPill tone="warning">client needed</StatusPill>;
}
