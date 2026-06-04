"use client";

import { EmptySafeNotice } from "../list";
import {
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
} from "../settings";
import { StatusPill } from "../status";
import type { RegistrySource } from "./plugins-types";

export function RegistrySourcesPanel({
  sources,
  open,
  name,
  url,
  busyId,
  onToggleOpen,
  onNameChange,
  onUrlChange,
  onCancel,
  onSubmit,
  onToggleSource,
  onRemoveSource,
  loading = false,
}: {
  sources: RegistrySource[];
  open: boolean;
  name: string;
  url: string;
  busyId: string | null;
  onToggleOpen: () => void;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onToggleSource: (source: RegistrySource) => void;
  onRemoveSource: (source: RegistrySource) => void;
  loading?: boolean;
}) {
  return (
    <SettingsGroup
      title="Registry sources"
      description="The official MCP Registry is always available. Add compatible registries only when you trust their operators."
      actions={<SettingsButton onClick={onToggleOpen}>{open ? "Close" : "Add"}</SettingsButton>}
    >
      {sources.length ? (
        sources.map((source) => (
          <SettingsRow
            key={source.id}
            variant="resource"
            label={source.name}
            description={source.url}
            value={<SettingsValue>{source.builtIn ? "official" : "custom"}</SettingsValue>}
            status={
              <StatusPill tone={source.enabled ? "good" : "default"}>
                {source.enabled ? "enabled" : "disabled"}
              </StatusPill>
            }
            actions={
              source.builtIn ? null : (
                <>
                  <SettingsButton
                    onClick={() => onToggleSource(source)}
                    disabled={busyId === `${source.id}:enabled`}
                  >
                    {source.enabled ? "Disable" : "Enable"}
                  </SettingsButton>
                  <SettingsButton
                    tone="danger"
                    onClick={() => onRemoveSource(source)}
                    disabled={busyId === `${source.id}:remove`}
                  >
                    Remove
                  </SettingsButton>
                </>
              )
            }
          />
        ))
      ) : (
        <EmptySafeNotice>
          {loading
            ? "Loading registry sources..."
            : "Official registry source did not load. Refresh to retry."}
        </EmptySafeNotice>
      )}
      {open ? (
        <>
          <SettingsRow
            label="Name"
            control={
              <SettingsInput
                value={name}
                onChange={onNameChange}
                placeholder="Company MCP Registry"
              />
            }
          />
          <SettingsRow
            label="URL"
            description="Must implement the official Registry API. HTTPS required except localhost."
            control={
              <SettingsInput
                value={url}
                onChange={onUrlChange}
                placeholder="https://registry.example.com"
              />
            }
          />
          <div className="flex justify-end gap-1 px-3.5 py-2">
            <SettingsButton onClick={onCancel}>Cancel</SettingsButton>
            <SettingsButton
              tone="primary"
              onClick={onSubmit}
              disabled={!url.trim() || busyId === "registry:add"}
            >
              Add registry
            </SettingsButton>
          </div>
        </>
      ) : null}
    </SettingsGroup>
  );
}
