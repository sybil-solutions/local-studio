"use client";

import { ExternalLink, Plus, ShieldCheck } from "lucide-react";
import { Button } from "../button";
import { EmptySafeNotice } from "../list";
import { ModelButton } from "../model-page";
import { SettingsButton, SettingsGroup, SettingsInput, SettingsRow } from "../settings";
import { StatusPill } from "../status";
import { type CatalogueEntry, type McpServer } from "./plugins-types";
import { missingRequiredEnv } from "./plugins-utils";

export function RegistryRow({
  entry,
  added,
  busy,
  compact,
  onConfigure,
}: {
  entry: CatalogueEntry;
  added: boolean;
  busy: boolean;
  compact?: boolean;
  onConfigure: () => void;
}) {
  const source = entry.registry === "glama" ? "Glama" : "Curated";
  return (
    <SettingsRow
      label={entry.displayName}
      description={compact ? (entry.shortDescription ?? entry.description) : entry.description}
      value={
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusPill tone={entry.registry === "glama" ? "info" : "good"} variant="badge">
            <ShieldCheck className="mr-1 h-3 w-3" />
            {source}
          </StatusPill>
          <StatusPill variant="badge">{entry.category}</StatusPill>
          {(entry.tags ?? []).slice(0, compact ? 2 : 4).map((tag) => (
            <StatusPill key={tag} variant="badge">
              {tag}
            </StatusPill>
          ))}
        </div>
      }
      actions={
        <>
          {entry.homepage || entry.registryUrl || entry.repositoryUrl ? (
            <a
              href={entry.registryUrl ?? entry.homepage ?? entry.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center justify-center rounded-md px-2 text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg)"
              title="Open registry profile"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <SettingsButton onClick={onConfigure} disabled={busy}>
            {added ? "Add another" : entry.command ? "Add" : "Configure"}
          </SettingsButton>
        </>
      }
    />
  );
}

export function ConfigureEntryPanel({
  entry,
  command,
  args,
  tags,
  env,
  busy,
  onCommandChange,
  onArgsChange,
  onTagsChange,
  onEnvChange,
  onCancel,
  onSubmit,
}: {
  entry: CatalogueEntry;
  command: string;
  args: string;
  tags: string;
  env: Record<string, string>;
  busy: boolean;
  onCommandChange: (value: string) => void;
  onArgsChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onEnvChange: (value: Record<string, string>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button className="absolute inset-0 bg-black/55" aria-label="Close" onClick={onCancel} />
      <div className="relative z-10 mx-4 w-full max-w-2xl overflow-hidden rounded-md border border-(--ui-border) bg-(--ui-bg) shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-(--ui-border) px-4 py-3">
          <div className="min-w-0">
            <div className="text-[length:var(--fs-sm)] uppercase tracking-[0.14em] text-(--ui-muted)">
              MCP configuration
            </div>
            <h2 className="truncate text-[length:var(--fs-xl)] font-medium text-(--ui-fg)">
              {entry.displayName}
            </h2>
          </div>
          <StatusPill tone={entry.registry === "glama" ? "info" : "good"} variant="badge">
            {entry.registry === "glama" ? "Glama" : "Curated"}
          </StatusPill>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <SettingsGroup title="Launch">
            <SettingsRow
              label="Command"
              description={
                entry.command
                  ? "Curated default can be adjusted before adding."
                  : "Glama validates the server, but you choose the local stdio launch command."
              }
              control={
                <SettingsInput value={command} onChange={onCommandChange} placeholder="npx" />
              }
            />
            <SettingsRow
              label="Arguments"
              control={
                <SettingsInput
                  value={args}
                  onChange={onArgsChange}
                  placeholder="-y @scope/server"
                />
              }
            />
            <SettingsRow
              label="Tags"
              control={
                <SettingsInput
                  value={tags}
                  onChange={onTagsChange}
                  placeholder="official, github"
                />
              }
            />
          </SettingsGroup>

          <SettingsGroup title="Environment">
            {Object.keys(env).length ? (
              Object.keys(env).map((key) => (
                <SettingsRow
                  key={key}
                  label={key}
                  description={entry.requiredEnv?.includes(key) ? "Required" : "Optional"}
                  control={
                    <SettingsInput
                      type="password"
                      value={env[key]}
                      onChange={(value) => onEnvChange({ ...env, [key]: value })}
                      placeholder={key}
                    />
                  }
                />
              ))
            ) : (
              <EmptySafeNotice>
                No environment variables declared by the registry row.
              </EmptySafeNotice>
            )}
          </SettingsGroup>
        </div>
        <div className="flex items-center justify-end gap-1 border-t border-(--ui-border) px-4 py-3">
          <ModelButton onClick={onCancel}>Cancel</ModelButton>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={!command.trim() || busy || missingRequiredEnv(entry, env)}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add MCP server
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ServerPill({ server }: { server: McpServer }) {
  if (!server.enabled) return <StatusPill>disabled</StatusPill>;
  if (server.source === "marketplace") return <StatusPill tone="info">marketplace</StatusPill>;
  return <StatusPill tone="info">manual</StatusPill>;
}
