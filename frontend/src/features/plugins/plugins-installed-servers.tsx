"use client";

import { Check, CircleAlert, Plug, PlugZap, Tags, Trash2, X } from "@/ui/icon-registry";
import { EmptySafeNotice } from "@/ui/list";
import {
  SettingsButton,
  SettingsFactRows,
  SettingsGroup,
  SettingsInput,
  type SettingsFactRow,
} from "@/ui/settings";
import { StatusPill } from "@/ui/status";
import type { McpServer } from "./plugins-types";
import { serverDescription, serverLocation } from "./plugins-utils";

export function InstalledMcpServersPanel({
  servers,
  enabledCount,
  busyId,
  tagDrafts,
  onToggleServer,
  onRemoveServer,
  onTagDraftChange,
  onSaveTags,
}: {
  servers: McpServer[];
  enabledCount: number;
  busyId: string | null;
  tagDrafts: Record<string, string>;
  onToggleServer: (server: McpServer) => void;
  onRemoveServer: (server: McpServer) => void;
  onTagDraftChange: (server: McpServer, value: string) => void;
  onSaveTags: (server: McpServer) => void;
}) {
  const disabledCount = servers.length - enabledCount;
  const readyCount = servers.filter((s) => s.ready).length;
  const notReadyCount = enabledCount - readyCount;

  const rows: SettingsFactRow[] = servers.map((server) => ({
    key: server.id,
    variant: "resource",
    label: server.displayName ?? server.name,
    description: serverDescription(server),
    value: serverLocation(server),
    mono: true,
    wrap: true,
    status: serverStatus(server),
    actions: (
      <>
        <SettingsButton onClick={() => onToggleServer(server)} disabled={busyId === server.id}>
          {server.enabled ? "Disable" : "Enable"}
        </SettingsButton>
        <SettingsButton
          tone="danger"
          onClick={() => onRemoveServer(server)}
          disabled={busyId === server.id}
          title="Remove MCP server"
        >
          <Trash2 className="h-3 w-3" />
        </SettingsButton>
      </>
    ),
    children: (
      <div className="flex items-center gap-2">
        <Tags className="h-3.5 w-3.5 shrink-0 text-(--ui-muted)" />
        <SettingsInput
          value={tagDrafts[server.id] ?? (server.tags ?? []).join(", ")}
          onChange={(value) => onTagDraftChange(server, value)}
          onBlur={() => onSaveTags(server)}
          placeholder="tag, another-tag"
        />
        <SettingsButton
          onClick={() => onSaveTags(server)}
          disabled={busyId === `${server.id}:tags`}
        >
          Save tags
        </SettingsButton>
      </div>
    ),
  }));

  return (
    <SettingsGroup
      title="Installed MCP servers"
      description="Servers exposed to agent turns when selected in the composer. Tags become local labels for routing and audits."
      actions={
        <div className="flex items-center gap-2">
          {readyCount > 0 ? (
            <StatusPill tone="good" variant="badge">
              <PlugZap className="mr-1 h-3 w-3" />
              {readyCount} connected
            </StatusPill>
          ) : null}
          {notReadyCount > 0 ? (
            <StatusPill tone="warning" variant="badge">
              <CircleAlert className="mr-1 h-3 w-3" />
              {notReadyCount} not ready
            </StatusPill>
          ) : null}
          {disabledCount > 0 ? (
            <StatusPill tone="default" variant="badge">
              <Plug className="mr-1 h-3 w-3" />
              {disabledCount} disabled
            </StatusPill>
          ) : null}
        </div>
      }
    >
      {servers.length ? (
        <SettingsFactRows rows={rows} />
      ) : (
        <EmptySafeNotice>No MCP servers configured yet.</EmptySafeNotice>
      )}
    </SettingsGroup>
  );
}

function serverStatus(server: McpServer): NonNullable<SettingsFactRow["status"]> {
  if (!server.enabled) {
    return {
      label: (
        <span className="flex items-center gap-1">
          <X className="h-3 w-3" />
          disabled
        </span>
      ),
      tone: "default",
    };
  }
  const sourceLabel = server.source === "curated" ? "curated" : "manual";
  if (server.ready) {
    return {
      label: (
        <span className="flex items-center gap-1">
          <Check className="h-3 w-3" />
          connected · {sourceLabel}
        </span>
      ),
      tone: "good",
    };
  }
  return {
    label: (
      <span className="flex items-center gap-1">
        <CircleAlert className="h-3 w-3" />
        not ready · {sourceLabel}
      </span>
    ),
    tone: "warning",
  };
}
