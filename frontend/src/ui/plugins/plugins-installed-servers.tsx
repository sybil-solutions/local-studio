"use client";

import { Tags, Trash2 } from "lucide-react";
import { EmptySafeNotice } from "../list";
import {
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
} from "../settings";
import { StatusPill } from "../status";
import { ServerPill } from "./plugins-page-parts";
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
  return (
    <SettingsGroup
      title="Installed MCP servers"
      description="Servers exposed to agent turns when selected in the composer. Tags become local labels for routing and audits."
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
            variant="resource"
            label={server.displayName ?? server.name}
            description={serverDescription(server)}
            value={<SettingsValue mono>{serverLocation(server)}</SettingsValue>}
            status={<ServerPill server={server} />}
            actions={
              <>
                <SettingsButton
                  onClick={() => onToggleServer(server)}
                  disabled={busyId === server.id}
                >
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
            }
          >
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
          </SettingsRow>
        ))
      ) : (
        <EmptySafeNotice>No MCP servers configured yet.</EmptySafeNotice>
      )}
    </SettingsGroup>
  );
}
