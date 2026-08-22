"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  PLUGIN_TEMPLATE,
  PluginSourceResponseSchema,
  PluginsResponseSchema,
  isValidPluginId,
  type PluginRow,
} from "@local-studio/agent-runtime/plugin-contract";
import { Alert, Button, FormField, Input, StatusPill } from "@/ui";
import { Plus, Trash2 } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import {
  DataRow,
  EndCell,
  HeadCell,
  IdentityCell,
  RowAction,
  StatusText,
  TableFrame,
  TableNotice,
  TableSection,
  TextCell,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import {
  CatalogSectionHeader,
  useCatalogSection,
} from "@/features/recipes/recipes-content/catalog-section";
import { jsonBody, requestAgentJson } from "./agent-json";

/**
 * Plugins the user writes, in the directory the agent already reads.
 *
 * A plugin here is a pi extension: one TypeScript module that registers tools
 * onto every session. There is no registry file and no install step — the list
 * below *is* the contents of `<agentDir>/extensions`, so what the table says is
 * loaded and what is loaded cannot disagree. Disabling renames the file rather
 * than recording a flag somewhere only this app can see.
 *
 * The honesty this surface owes the user is different from the connectors tab's.
 * A connector runs a command in a child process; a plugin runs *inside* the
 * agent, so it is not sandboxed from anything the agent can touch. Saving still
 * executes nothing — the file is picked up when the next session is built —
 * but "next message" is a short fuse and the drawer says so plainly.
 */

const decodePlugins = Schema.decodeUnknownSync(PluginsResponseSchema);
const decodeSource = Schema.decodeUnknownSync(PluginSourceResponseSchema);

const CODE_CLASS =
  "w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 py-2 font-mono text-[length:var(--fs-sm)] leading-5 text-(--ui-fg) focus:border-(--ui-accent)/60 focus:outline-none";

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 102.4) / 10} KB`;

const PluginBadge = ({ plugin }: { plugin: PluginRow | null }) =>
  plugin ? (
    <StatusPill tone={plugin.enabled ? "good" : "default"}>
      {plugin.enabled ? "loaded" : "disabled"}
    </StatusPill>
  ) : null;

const PluginFacts = ({ plugin }: { plugin: PluginRow }) => (
  <ResourceDrawerSection title="On disk">
    <ResourceFact label="File" value={plugin.file} mono />
    <ResourceFact label="Path" value={plugin.path} mono />
    <ResourceFact
      label="State"
      value={
        plugin.enabled
          ? "Loaded into every new session"
          : "Renamed with a .off suffix, so the agent skips it"
      }
    />
  </ResourceDrawerSection>
);

/**
 * The source lives in the section, not in here.
 *
 * Opening a plugin fetches its file, so the text arrives one tick after the
 * drawer does. A local `useState(initialSource)` would latch the empty string
 * it opened with and there is no effect to re-seed it from — so the section
 * owns the buffer and this component only edits it.
 */
function PluginEditorDrawer({
  plugin,
  source,
  onSourceChange,
  loadingSource,
  onClose,
  onChanged,
}: {
  /** Null while composing a new plugin — the id is still being chosen. */
  plugin: PluginRow | null;
  source: string;
  onSourceChange: (next: string) => void;
  loadingSource: boolean;
  onClose: () => void;
  onChanged: (plugins: readonly PluginRow[]) => void;
}) {
  const [id, setId] = useState(plugin?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const creating = plugin === null;
  const named = id.trim();
  const idError =
    creating && named && !isValidPluginId(named)
      ? "Use lowercase letters, digits, and hyphens."
      : "";

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { plugins } = await requestAgentJson(
        "/api/agent/plugins",
        decodePlugins,
        jsonBody({ id: named, source }),
      );
      onChanged(plugins);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Plugin save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResourceDrawer
      title={plugin?.id ?? "New plugin"}
      icon={<ResourceLogo identity={named || "plugin"} label={named || "plugin"} />}
      badge={<PluginBadge plugin={plugin} />}
      status={plugin?.path ?? "Saved as a .ts file in the agent's extensions directory"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={!named || Boolean(idError) || loadingSource}
            onClick={() => void save()}
          >
            {creating ? "Create plugin" : "Save plugin"}
          </Button>
        </>
      }
      onClose={onClose}
      width={860}
    >
      <Alert variant="warning" className="mb-6">
        A plugin runs inside the agent process with your user account — the same reach as the agent
        itself, with no sandbox between them. Saving writes the file and nothing more; the code
        first runs when your next message rebuilds the session.
      </Alert>

      {creating ? (
        <div className="mb-5">
          <FormField
            label="Plugin name"
            description="Becomes the filename and cannot be changed later."
            error={idError || undefined}
          >
            <Input
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="my-tools"
              className="font-mono"
            />
          </FormField>
        </div>
      ) : null}

      <section className="mb-6">
        <div className="mb-2">
          <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">Source</h3>
          <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
            TypeScript, compiled by the agent on load. Imports resolve against the agent&rsquo;s own
            dependencies.
          </p>
        </div>
        <textarea
          value={loadingSource ? "Loading…" : source}
          onChange={(event) => onSourceChange(event.target.value)}
          readOnly={loadingSource}
          spellCheck={false}
          rows={22}
          aria-label="Plugin source"
          className={CODE_CLASS}
        />
      </section>

      {plugin ? <PluginFacts plugin={plugin} /> : null}

      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}

function PluginRowView({
  plugin,
  onOpen,
  onChanged,
}: {
  plugin: PluginRow;
  onOpen: () => void;
  onChanged: (plugins: readonly PluginRow[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  const run = (url: string, init: RequestInit, failure: string) => {
    setBusy(true);
    setRowError("");
    void requestAgentJson(url, decodePlugins, init)
      .then(({ plugins }) => onChanged(plugins))
      .catch((error: unknown) => setRowError(error instanceof Error ? error.message : failure))
      .finally(() => setBusy(false));
  };

  return (
    <DataRow
      onOpen={plugin.read_only ? undefined : onOpen}
      ariaLabel={`Open ${plugin.id}`}
      dimmed={!plugin.enabled}
    >
      <IdentityCell
        leading={<ResourceLogo identity={plugin.id} label={plugin.id} />}
        label={plugin.id}
        description={
          rowError ||
          (plugin.read_only
            ? "A directory extension — edit it in your editor"
            : `${formatBytes(plugin.bytes)} · ${plugin.file}`)
        }
      />
      <TextCell mono title={plugin.path}>
        {plugin.path}
      </TextCell>
      <EndCell>
        <div className="flex items-center justify-end gap-2">
          <StatusText tone={plugin.enabled ? "ok" : "dim"}>
            {plugin.enabled ? "loaded" : "disabled"}
          </StatusText>
          {plugin.read_only ? null : (
            <>
              <RowAction
                alwaysVisible
                disabled={busy}
                onClick={() =>
                  run(
                    "/api/agent/plugins",
                    jsonBody({ id: plugin.id, enabled: !plugin.enabled }),
                    "Could not change this plugin",
                  )
                }
                title={
                  plugin.enabled
                    ? "Stop loading this plugin into new sessions"
                    : "Load this plugin from your next message"
                }
              >
                {plugin.enabled ? "Disable" : "Enable"}
              </RowAction>
              <RowAction
                alwaysVisible
                disabled={busy}
                onClick={() =>
                  run(
                    `/api/agent/plugins?id=${encodeURIComponent(plugin.id)}`,
                    { method: "DELETE" },
                    "Could not delete this plugin",
                  )
                }
                tone="danger"
                title={`Delete ${plugin.file}`}
              >
                <Trash2 className="h-3 w-3" />
              </RowAction>
            </>
          )}
        </div>
      </EndCell>
    </DataRow>
  );
}

export function PluginsSection() {
  const [directory, setDirectory] = useState("");
  const [editing, setEditing] = useState<PluginRow | null>(null);
  const [composing, setComposing] = useState(false);
  const [source, setSource] = useState("");
  const [loadingSource, setLoadingSource] = useState(false);

  const load = useCallback(
    () =>
      requestAgentJson("/api/agent/plugins", decodePlugins).then((payload) => {
        setDirectory(payload.directory);
        return payload.plugins;
      }),
    [],
  );
  const section = useCatalogSection({
    load,
    searchText: (plugin: PluginRow) => `${plugin.id} ${plugin.file}`,
  });
  const { items: plugins, setItems: setPlugins, visible, loaded, error, query } = section;

  const openPlugin = (plugin: PluginRow) => {
    setEditing(plugin);
    setComposing(false);
    setSource("");
    setLoadingSource(true);
    void requestAgentJson(
      `/api/agent/plugins/source?id=${encodeURIComponent(plugin.id)}`,
      decodeSource,
    )
      .then((payload) => setSource(payload.source))
      .catch((readError: unknown) =>
        setSource(`// ${readError instanceof Error ? readError.message : "could not read"}`),
      )
      .finally(() => setLoadingSource(false));
  };

  const closeDrawer = () => {
    setEditing(null);
    setComposing(false);
    setSource("");
  };

  return (
    <>
      <TableSection
        title="Plugins"
        description={
          directory
            ? `TypeScript modules that add tools to every session. Read from ${directory}.`
            : "TypeScript modules that add tools to every session."
        }
        actions={
          <CatalogSectionHeader
            section={section}
            searchPlaceholder="Search plugins"
            statusTone={error ? "warn" : loaded ? "ok" : "dim"}
            statusText={loaded ? `${visible.length} of ${plugins.length}` : "reading"}
            refreshLabel="Reload plugins"
          >
            <Button
              size="sm"
              onClick={() => {
                setComposing(true);
                setEditing(null);
                setSource(PLUGIN_TEMPLATE);
                setLoadingSource(false);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New plugin
            </Button>
          </CatalogSectionHeader>
        }
      >
        {loaded && visible.length === 0 ? (
          <TableNotice
            title={plugins.length ? `No plugin matches “${query}”` : "No plugins yet"}
            body={
              error ||
              "A plugin is one TypeScript file that registers tools onto every session. New plugin opens a working example you can edit and save — it starts as a file on disk, not as running code."
            }
          />
        ) : (
          <TableFrame minWidthClass="min-w-[40rem]">
            <thead>
              <tr>
                <HeadCell>Plugin</HeadCell>
                <HeadCell>File</HeadCell>
                <HeadCell numeric>State</HeadCell>
              </tr>
            </thead>
            <tbody>
              {visible.map((plugin) => (
                <PluginRowView
                  key={plugin.id}
                  plugin={plugin}
                  onOpen={() => openPlugin(plugin)}
                  onChanged={setPlugins}
                />
              ))}
            </tbody>
          </TableFrame>
        )}
      </TableSection>

      {editing || composing ? (
        <PluginEditorDrawer
          key={editing?.id ?? "new"}
          plugin={editing}
          source={source}
          onSourceChange={setSource}
          loadingSource={loadingSource}
          onClose={closeDrawer}
          onChanged={setPlugins}
        />
      ) : null}
    </>
  );
}
