"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Schema } from "effect";
import {
  PluginRuntimeResponseSchema,
  type PluginRuntimeView,
} from "@local-studio/agent-runtime/plugin-runtime-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";
import { Alert, Button, ModelButton, SearchInput, UiModal, UiModalHeader } from "@/ui";
import { Eye, X } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsButton, SettingsGroup, type StatusTone } from "@/features/settings/settings-ui";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
} from "@/features/recipes/recipes-content/model-page";
import { GoogleAccountModal } from "./google-account-modal";
import { ChatterboxVoiceModal } from "./chatterbox-voice-modal";
import { speechStatusLabel, speechStatusTone } from "./chatterbox-voice-model";
import { useSpeechStore, type SpeechSnapshot } from "./chatterbox-voice-store";

type PluginStatus = { label: string; tone: StatusTone };

function responseError(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ApiErrorResponseSchema)(body).error;
  } catch {
    return fallback;
  }
}

async function pluginResponse(response: Response, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, fallback));
  return Schema.decodeUnknownSync(PluginRuntimeResponseSchema)(body);
}

function capabilitySummary(plugin: PluginRuntimeView): string {
  if (plugin.hostCapability?.capability === "speech") {
    return `local speech · voice cloning · v${plugin.version}`;
  }
  return [
    plugin.provides.skills ? "skills" : null,
    plugin.provides.mcpServers || plugin.account
      ? `${plugin.tools.serverCount} ${plugin.account ? "remote " : ""}MCP ${plugin.tools.serverCount === 1 ? "server" : "servers"}`
      : null,
    plugin.provides.apps ? "account app" : null,
    `v${plugin.version}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function pluginStatus(plugin: PluginRuntimeView, speech: SpeechSnapshot): PluginStatus {
  if (plugin.hostCapability?.capability === "speech") {
    if (!speech.available && !speech.loading) return { label: "Unavailable", tone: "danger" };
    if (speech.status) {
      return {
        label: speechStatusLabel(speech.status),
        tone: speechStatusTone(speech.status),
      };
    }
    if (speech.loading) return { label: "Checking", tone: "default" };
    return { label: speech.error ? "Unavailable" : "Configure", tone: "warning" };
  }
  if (plugin.account && !plugin.account.configured) return { label: "Setup", tone: "warning" };
  if (plugin.account && !plugin.account.connected) return { label: "Sign in", tone: "warning" };
  if (plugin.tools.state === "enabled") {
    return {
      label: `Observe · ${plugin.tools.allowedToolCount} ${plugin.tools.allowedToolCount === 1 ? "tool" : "tools"}`,
      tone: "good",
    };
  }
  if (plugin.tools.state === "available") return { label: "Available", tone: "info" };
  if (plugin.tools.state === "disabled") return { label: "Off", tone: "default" };
  if (plugin.tools.state === "invalid") return { label: "Unavailable", tone: "danger" };
  if (plugin.tools.state === "configuration_required" || plugin.provides.apps) {
    return { label: "Adapter needed", tone: "warning" };
  }
  return { label: "Skills", tone: "default" };
}

function activationAction(plugin: PluginRuntimeView): "account" | "connect" | "disconnect" | null {
  if (plugin.hostCapability) return null;
  if (plugin.account && !plugin.account.connected) return "account";
  if (plugin.account) {
    return plugin.tools.state === "available" || plugin.tools.state === "disabled"
      ? "connect"
      : null;
  }
  if (plugin.tools.state === "enabled") return "disconnect";
  if (plugin.tools.state === "available" || plugin.tools.state === "disabled") return "connect";
  return null;
}

function PluginRowsSkeleton() {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <div key={index} className="grid animate-pulse gap-3 px-4 py-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="h-3 w-32 rounded bg-(--ui-hover)" />
            <div className="h-2.5 w-56 max-w-full rounded bg-(--ui-hover)/70" />
          </div>
          <div className="flex items-center justify-end gap-3">
            <div className="h-2.5 w-36 rounded bg-(--ui-hover)/70" />
            <div className="h-5 w-20 rounded-full bg-(--ui-hover)" />
          </div>
        </div>
      ))}
    </>
  );
}

type PluginRowAction = ReturnType<typeof activationAction>;

function pluginActionLabel(plugin: PluginRuntimeView, action: PluginRowAction): string {
  if (action === "account") return plugin.account?.configured ? "Sign in" : "Set up";
  if (action === "connect") return "Connect";
  return "Disconnect";
}

function PluginRowActions({
  plugin,
  action,
  busy,
  hostActionLabel,
  onConnect,
  onDisconnect,
  onAccount,
  onHostCapability,
}: {
  plugin: PluginRuntimeView;
  action: PluginRowAction;
  busy: boolean;
  hostActionLabel: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onAccount: () => void;
  onHostCapability: () => void;
}) {
  const actionLabel = action ? pluginActionLabel(plugin, action) : "";
  const handleAction =
    action === "account" ? onAccount : action === "connect" ? onConnect : onDisconnect;
  return (
    <>
      {plugin.hostCapability ? (
        <ModelButton
          onClick={onHostCapability}
          disabled={busy}
          aria-label={`${hostActionLabel} ${plugin.displayName}`}
        >
          {hostActionLabel}
        </ModelButton>
      ) : null}
      {plugin.account?.connected ? (
        <ModelButton
          onClick={onAccount}
          disabled={busy}
          aria-label={`Manage ${plugin.displayName}`}
        >
          Manage
        </ModelButton>
      ) : null}
      {action ? (
        <ModelButton
          onClick={handleAction}
          disabled={busy}
          aria-label={`${actionLabel} ${plugin.displayName}`}
        >
          {busy ? "Working" : actionLabel}
        </ModelButton>
      ) : null}
    </>
  );
}

function PluginRow({
  plugin,
  speech,
  busy,
  onOpen,
  onConnect,
  onDisconnect,
  onAccount,
  onHostCapability,
}: {
  plugin: PluginRuntimeView;
  speech: SpeechSnapshot;
  busy: boolean;
  onOpen: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAccount: () => void;
  onHostCapability: () => void;
}) {
  const status = pluginStatus(plugin, speech);
  const action = activationAction(plugin);
  const hostActionLabel = speech.status?.install.phase === "ready" ? "Manage" : "Configure";
  return (
    <ModelRow
      label={plugin.displayName}
      description={plugin.description || plugin.category}
      leading={
        <ResourceLogo
          identity={plugin.id}
          label={plugin.displayName}
          company={plugin.source}
          brandColor={plugin.brandColor}
        />
      }
      value={<ModelValue mono>{`${plugin.source} · ${capabilitySummary(plugin)}`}</ModelValue>}
      status={<ModelStatus tone={status.tone}>{status.label}</ModelStatus>}
      actions={
        action || plugin.account?.connected || plugin.hostCapability ? (
          <PluginRowActions
            plugin={plugin}
            action={action}
            busy={busy}
            hostActionLabel={hostActionLabel}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onAccount={onAccount}
            onHostCapability={onHostCapability}
          />
        ) : undefined
      }
      onClick={onOpen}
    >
      {plugin.tools.reason ? (
        <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">{plugin.tools.reason}</div>
      ) : null}
      {plugin.account?.email ? (
        <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">{plugin.account.email}</div>
      ) : null}
    </ModelRow>
  );
}

function PluginDrawer({
  plugin,
  speech,
  busy,
  onClose,
  onConnect,
  onDisconnect,
  onAccount,
  onHostCapability,
}: {
  plugin: PluginRuntimeView;
  speech: SpeechSnapshot;
  busy: boolean;
  onClose: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAccount: () => void;
  onHostCapability: () => void;
}) {
  const status = pluginStatus(plugin, speech);
  const action = activationAction(plugin);
  const hostActionLabel = speech.status?.install.phase === "ready" ? "Manage" : "Configure";
  const capabilities = [
    ...plugin.capabilities,
    plugin.provides.skills ? "Skills" : null,
    plugin.provides.mcpServers ? "MCP tools" : null,
    plugin.provides.apps ? "App integration" : null,
  ].filter((value): value is string => Boolean(value));
  return (
    <ResourceDrawer
      title={plugin.displayName}
      icon={
        <ResourceLogo
          identity={plugin.id}
          label={plugin.displayName}
          company={plugin.source}
          brandColor={plugin.brandColor}
        />
      }
      badge={<ModelStatus tone={status.tone}>{status.label}</ModelStatus>}
      status={`${plugin.source} · ${plugin.category} · v${plugin.version}`}
      footer={
        action || plugin.account?.connected || plugin.hostCapability ? (
          <PluginRowActions
            plugin={plugin}
            action={action}
            busy={busy}
            hostActionLabel={hostActionLabel}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onAccount={onAccount}
            onHostCapability={onHostCapability}
          />
        ) : null
      }
      onClose={onClose}
    >
      <p className="mb-6 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
        {plugin.description || "No plugin description was provided."}
      </p>
      <ResourceDrawerSection title="Identity">
        <ResourceFact label="Company or source" value={plugin.source} />
        <ResourceFact label="Category" value={plugin.category} />
        <ResourceFact label="Plugin ID" value={plugin.id} mono />
        <ResourceFact label="Version" value={plugin.version} mono />
      </ResourceDrawerSection>
      <ResourceDrawerSection title="Capabilities">
        <ResourceFact label="Provides" value={capabilities.join(" · ") || "Skill bundle"} />
        <ResourceFact label="Tool servers" value={String(plugin.tools.serverCount)} mono />
        <ResourceFact label="Allowed tools" value={String(plugin.tools.allowedToolCount)} mono />
        <ResourceFact label="Mode" value={plugin.tools.mode ?? "not connected"} mono />
      </ResourceDrawerSection>
      {plugin.account ? (
        <ResourceDrawerSection title="Account">
          <ResourceFact label="Provider" value={plugin.account.provider} />
          <ResourceFact
            label="Connection"
            value={plugin.account.connected ? "Connected" : "Not connected"}
          />
          {plugin.account.email ? (
            <ResourceFact label="Account" value={plugin.account.email} />
          ) : null}
        </ResourceDrawerSection>
      ) : null}
    </ResourceDrawer>
  );
}

export function PluginsSection() {
  const speech = useSpeechStore();
  const [plugins, setPlugins] = useState<readonly PluginRuntimeView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PluginRuntimeView | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginRuntimeView | null>(null);
  const [accountPlugin, setAccountPlugin] = useState<PluginRuntimeView | null>(null);
  const [speechPlugin, setSpeechPlugin] = useState<PluginRuntimeView | null>(null);
  const requestGeneration = useRef(0);

  const loadPlugins = useCallback(() => {
    const generation = ++requestGeneration.current;
    return fetch("/api/agent/plugins", { cache: "no-store" })
      .then(async (response) => {
        const payload = await pluginResponse(response, "Plugin discovery failed");
        if (generation !== requestGeneration.current) return;
        setPlugins(payload.plugins);
        setError("");
      })
      .catch((loadError: unknown) => {
        if (generation !== requestGeneration.current) return;
        setError(loadError instanceof Error ? loadError.message : "Plugin discovery failed");
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoaded(true);
      });
  }, []);

  useMountSubscription(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const handleAccountChanged = useCallback(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const visiblePlugins = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return plugins;
    return plugins.filter((plugin) =>
      `${plugin.displayName} ${plugin.description} ${plugin.category} ${capabilitySummary(plugin)}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [plugins, query]);

  const setEnabled = async (plugin: PluginRuntimeView, enabled: boolean) => {
    const generation = ++requestGeneration.current;
    setBusyId(plugin.id);
    setError("");
    try {
      const response = await fetch(`/api/agent/plugins/${encodeURIComponent(plugin.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await pluginResponse(response, "Plugin activation failed");
      if (generation !== requestGeneration.current) return;
      setPlugins(payload.plugins);
      setPending(null);
    } catch (activationError) {
      if (generation !== requestGeneration.current) return;
      setError(
        activationError instanceof Error ? activationError.message : "Plugin activation failed",
      );
    } finally {
      setBusyId((current) => (current === plugin.id ? null : current));
    }
  };

  return (
    <>
      {error ? (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      <ModelSection
        title="Plugins"
        description="Capability bundles from Local Studio and Codex, with their company, tools, accounts, and skills."
        actions={
          <ModelStatus tone={error ? "warning" : loaded ? "good" : "default"}>
            {loaded ? `${visiblePlugins.length} of ${plugins.length}` : "discovering"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search plugins"
          description="Name, company, category, capability, or version."
          control={
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search plugins"
              className="w-full"
            />
          }
          status={<ModelStatus>{visiblePlugins.length}</ModelStatus>}
        />
        {!loaded ? (
          <PluginRowsSkeleton />
        ) : visiblePlugins.length ? (
          visiblePlugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              speech={speech}
              busy={busyId === plugin.id}
              onOpen={() => setSelectedPlugin(plugin)}
              onConnect={() => {
                setSelectedPlugin(null);
                setPending(plugin);
              }}
              onDisconnect={() => {
                setSelectedPlugin(null);
                void setEnabled(plugin, false);
              }}
              onAccount={() => {
                setSelectedPlugin(null);
                setAccountPlugin(plugin);
              }}
              onHostCapability={() => {
                setSelectedPlugin(null);
                setSpeechPlugin(plugin);
              }}
            />
          ))
        ) : (
          <div className="px-4 py-8 text-center text-[length:var(--fs-md)] text-(--ui-muted)">
            {plugins.length ? `No plugins match “${query}”.` : "No plugin manifests found."}
          </div>
        )}
      </ModelSection>
      {selectedPlugin ? (
        <PluginDrawer
          plugin={selectedPlugin}
          speech={speech}
          busy={busyId === selectedPlugin.id}
          onClose={() => setSelectedPlugin(null)}
          onConnect={() => {
            setSelectedPlugin(null);
            setPending(selectedPlugin);
          }}
          onDisconnect={() => {
            setSelectedPlugin(null);
            void setEnabled(selectedPlugin, false);
          }}
          onAccount={() => {
            setSelectedPlugin(null);
            setAccountPlugin(selectedPlugin);
          }}
          onHostCapability={() => {
            setSelectedPlugin(null);
            setSpeechPlugin(selectedPlugin);
          }}
        />
      ) : null}
      <UiModal
        isOpen={pending !== null}
        onClose={() => !busyId && setPending(null)}
        maxWidth="max-w-md"
      >
        <UiModalHeader
          title={`Connect ${pending?.displayName ?? "plugin"}?`}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--ui-info)/30 bg-(--ui-info)/10">
              <Eye className="h-4 w-4 text-(--ui-info)" />
            </span>
          }
          onClose={() => !busyId && setPending(null)}
          closeIcon={<X className="h-4 w-4" />}
        />
        <div className="space-y-5 px-6 py-5">
          <Alert variant="info">
            Observe mode starts this plugin locally and exposes only tools it declares read-only.
            Desktop actions stay blocked until Local Studio has an action-time approval prompt.
          </Alert>
          <p className="text-sm leading-6 text-(--ui-muted)">
            The bundle remains in its installed location. Disconnecting stops exposing its tools to
            Workbench sessions.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPending(null)} disabled={Boolean(busyId)}>
              Cancel
            </Button>
            <Button
              onClick={() => pending && void setEnabled(pending, true)}
              disabled={!pending || Boolean(busyId)}
              loading={Boolean(busyId)}
            >
              Connect in observe mode
            </Button>
          </div>
        </div>
      </UiModal>
      {accountPlugin?.account?.provider === "google" ? (
        <GoogleAccountModal
          accountId={accountPlugin.account.id}
          displayName={accountPlugin.displayName}
          onClose={() => setAccountPlugin(null)}
          onChanged={handleAccountChanged}
        />
      ) : null}
      {speechPlugin?.hostCapability?.capability === "speech" ? (
        <ChatterboxVoiceModal key={speech.controllerKey} onClose={() => setSpeechPlugin(null)} />
      ) : null}
    </>
  );
}
