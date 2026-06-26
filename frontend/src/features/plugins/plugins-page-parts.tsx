"use client";

import { useId } from "react";
import { ExternalLink, Plus, ShieldCheck } from "@/ui/icon-registry";
import {
  Button,
  EmptySafeNotice,
  ModelButton,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsNotice,
  SettingsRow,
  SettingsTextarea,
  StatusPill,
  UiModal,
  UiModalHeader,
} from "@/ui";
import { type CatalogueEntry } from "./plugins-types";
import {
  isManagedOAuthEntry,
  isManagedOAuthEnvKey,
  missingRequiredEnv,
  parseArgsText,
} from "./plugins-utils";

export function CuratedMcpRow({
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
  const actionLabel = isManagedOAuthEntry(entry)
    ? added
      ? "Reconnect"
      : "Connect"
    : added
      ? "Add another"
      : entry.command
        ? "Add"
        : "Configure";
  return (
    <SettingsRow
      variant="resource"
      label={entry.displayName}
      description={compact ? (entry.shortDescription ?? entry.description) : entry.description}
      value={
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusPill tone={curatedTone()} variant="badge">
            <ShieldCheck className="mr-1 h-3 w-3" />
            Curated
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
          {entry.homepage || entry.repositoryUrl ? (
            <a
              href={entry.homepage ?? entry.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center justify-center rounded-md px-2 text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg)"
              aria-label={`Open docs for ${entry.displayName}`}
              title={`Open docs for ${entry.displayName}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <SettingsButton
            onClick={onConfigure}
            disabled={busy}
            aria-label={`${actionLabel} ${entry.displayName}`}
            title={`${actionLabel} ${entry.displayName}`}
          >
            {actionLabel}
          </SettingsButton>
        </>
      }
    />
  );
}

export function McpJsonConfigPanel({
  configText,
  busy,
  onChange,
  onSave,
}: {
  configText: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <SettingsGroup
      title="MCP JSON"
      description="Edit the canonical mcp_servers config directly. Save regenerates the runtime .mcp.json files used by agent turns."
      actions={
        <SettingsButton tone="primary" onClick={onSave} disabled={busy || !configText.trim()}>
          Save JSON
        </SettingsButton>
      }
    >
      <SettingsTextarea
        value={configText}
        onChange={onChange}
        rows={14}
        focusTone="info"
        className="font-mono text-[length:var(--fs-xs)]"
        placeholder={'{\n  "version": 1,\n  "mcp_servers": {}\n}'}
      />
    </SettingsGroup>
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
  const commandId = useId();
  const argsId = useId();
  const tagsId = useId();
  const needsTarget = Boolean(entry.requiresTargetArg);
  const hasTarget = !needsTarget || hasExplicitTargetArg(entry, args);
  const canSubmit =
    Boolean(command.trim()) && !busy && !missingRequiredEnv(entry, env) && hasTarget;
  const submitTitle = hasTarget
    ? `Add ${entry.displayName} MCP server`
    : `Add a local path argument before adding ${entry.displayName}`;
  const envKeys = Object.keys(env);
  const visibleEnvKeys = envKeys.filter((key) => !isManagedOAuthEnvKey(key));
  const managedOAuthEnvCount = envKeys.length - visibleEnvKeys.length;

  return (
    <UiModal isOpen onClose={onCancel} maxWidth="max-w-2xl">
      <UiModalHeader
        title={entry.displayName}
        onClose={onCancel}
        actions={
          <StatusPill tone={curatedTone()} variant="badge">
            Curated
          </StatusPill>
        }
      />
      <div className="max-h-[70vh] overflow-y-auto p-4">
        <SettingsGroup title="Launch">
          <SettingsRow
            label="Command"
            description={
              entry.command
                ? "Curated default can be adjusted before adding."
                : "Choose the local stdio launch command before adding this server."
            }
            control={
              <SettingsInput
                id={commandId}
                value={command}
                onChange={onCommandChange}
                placeholder="npx"
                aria-label="Command"
              />
            }
          />
          <SettingsRow
            label="Arguments"
            description={
              needsTarget
                ? "Add the local directory, repository, or database path this server may access."
                : undefined
            }
            control={
              <SettingsInput
                id={argsId}
                value={args}
                onChange={onArgsChange}
                placeholder="-y @scope/server"
                aria-label="Arguments"
              />
            }
          />
          <SettingsRow
            label="Tags"
            control={
              <SettingsInput
                id={tagsId}
                value={tags}
                onChange={onTagsChange}
                placeholder="official, github"
                aria-label="Tags"
              />
            }
          />
        </SettingsGroup>

        <SettingsGroup title="Environment">
          {managedOAuthEnvCount ? (
            <SettingsNotice tone="info" className="mb-3">
              OAuth values are managed by Local Studio and injected at launch. Connect the account
              in Connections above before using this server.
            </SettingsNotice>
          ) : null}
          {visibleEnvKeys.length ? (
            visibleEnvKeys.map((key) => (
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
                    aria-label={key}
                  />
                }
              />
            ))
          ) : (
            <EmptySafeNotice>
              {managedOAuthEnvCount
                ? "No manual environment variables are needed."
                : "No environment variables declared by this curated server."}
            </EmptySafeNotice>
          )}
        </SettingsGroup>
      </div>
      <div className="flex items-center justify-end gap-1 border-t border-(--ui-border) px-4 py-3">
        <ModelButton onClick={onCancel}>Cancel</ModelButton>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={!canSubmit}
          title={submitTitle}
          icon={<Plus className="h-3.5 w-3.5" />}
        >
          Add MCP server
        </Button>
      </div>
    </UiModal>
  );
}

function curatedTone(): "default" | "good" | "info" | "warning" | "danger" {
  return "good";
}

function hasExplicitTargetArg(entry: CatalogueEntry, args: string): boolean {
  const parts = parseArgsText(args);
  const templateLength = entry.args?.length ?? 0;
  return parts.slice(templateLength).some((part) => part.trim() && !part.trim().startsWith("-"));
}
