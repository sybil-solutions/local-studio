"use client";

import { useId } from "react";
import { ExternalLink, Plus, ShieldCheck } from "lucide-react";
import { Button } from "../button";
import { EmptySafeNotice } from "../list";
import { ModelButton } from "../model-page";
import { SettingsButton, SettingsGroup, SettingsInput, SettingsRow } from "../settings";
import { StatusPill } from "../status";
import { type CatalogueEntry } from "./plugins-types";
import { missingRequiredEnv, parseArgsText } from "./plugins-utils";

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
  const source = registryLabel(entry);
  return (
    <SettingsRow
      variant="resource"
      label={entry.displayName}
      description={compact ? (entry.shortDescription ?? entry.description) : entry.description}
      value={
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusPill tone={registryTone(entry)} variant="badge">
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
              aria-label={`Open registry profile for ${entry.displayName}`}
              title={`Open registry profile for ${entry.displayName}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <SettingsButton
            onClick={onConfigure}
            disabled={busy}
            aria-label={`${added ? "Add another" : entry.command ? "Add" : "Configure"} ${entry.displayName}`}
            title={`${added ? "Add another" : entry.command ? "Add" : "Configure"} ${entry.displayName}`}
          >
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
  const titleId = useId();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button className="absolute inset-0 bg-black/55" aria-label="Close" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 mx-4 w-full max-w-2xl overflow-hidden rounded-md border border-(--ui-border) bg-(--ui-bg) shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-(--ui-border) px-4 py-3">
          <div className="min-w-0">
            <div className="text-[length:var(--fs-sm)] uppercase tracking-[0.14em] text-(--ui-muted)">
              MCP configuration
            </div>
            <h2
              id={titleId}
              className="truncate text-[length:var(--fs-xl)] font-medium text-(--ui-fg)"
            >
              {entry.displayName}
            </h2>
          </div>
          <StatusPill tone={registryTone(entry)} variant="badge">
            {registryLabel(entry)}
          </StatusPill>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <SettingsGroup title="Launch">
            <SettingsRow
              label="Command"
              description={
                entry.command
                  ? "Registry default can be adjusted before adding."
                  : (entry.unsupportedReason ??
                    "Choose the local stdio launch command before adding this server.")
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
                      aria-label={key}
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
            disabled={!canSubmit}
            title={submitTitle}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add MCP server
          </Button>
        </div>
      </div>
    </div>
  );
}

function registryLabel(entry: CatalogueEntry): string {
  if (entry.registry === "official") return "Official";
  if (entry.registry === "custom") return entry.registryName ?? "Registry";
  return "Curated";
}

function registryTone(entry: CatalogueEntry): "default" | "good" | "info" | "warning" | "danger" {
  if (entry.registry === "custom") return "info";
  return "good";
}

function hasExplicitTargetArg(entry: CatalogueEntry, args: string): boolean {
  const parts = parseArgsText(args);
  const templateLength = entry.args?.length ?? 0;
  return parts.slice(templateLength).some((part) => part.trim() && !part.trim().startsWith("-"));
}
