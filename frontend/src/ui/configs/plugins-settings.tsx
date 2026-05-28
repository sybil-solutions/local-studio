import { useCallback, useState, useSyncExternalStore } from "react";
import {
  EmptySafeNotice,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "@/ui";
import { getConfigsViewSnapshot } from "./configs-view-snapshot";

export function PluginsSettings() {
  type Plugin = {
    id: string;
    name: string;
    source?: string;
    path: string;
    installed: boolean;
    enabled: boolean;
    description?: string;
    appIds?: string[];
  };
  type PluginRuntimeCheck = {
    skillConfigured?: boolean;
    mcpConfigured?: boolean;
    appConfigured?: boolean;
    mcpExecutableExists?: boolean;
    runtimeBlockedOutsideCodex?: boolean;
    runtimeCheckRequired?: boolean;
    note?: string;
  };
  type PluginValidation = {
    browserUseAvailable?: boolean;
    browserUseRuntime?: PluginRuntimeCheck | null;
    computerUseAvailable?: boolean;
    computerUseRuntime?: PluginRuntimeCheck | null;
  };
  type Marketplace = { name: string; source?: string; sourceType?: string; lastUpdated?: string };
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [marketplaceSource, setMarketplaceSource] = useState("");
  const [validation, setValidation] = useState<PluginValidation | null>(null);
  const [savingPlugin, setSavingPlugin] = useState<string | null>(null);
  const [upgradingMarketplace, setUpgradingMarketplace] = useState<string | null>(null);
  const browserUse =
    plugins.find((plugin) => plugin.name.toLowerCase().includes("browser-use")) ?? null;
  const computerUse =
    plugins.find((plugin) => plugin.name.toLowerCase().includes("computer-use")) ?? null;
  const loadPlugins = () =>
    fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
      .then(
        (res) =>
          res.json() as Promise<{
            plugins?: Plugin[];
            marketplaces?: Marketplace[];
            validation?: PluginValidation;
          }>,
      )
      .then((payload) => {
        setPlugins(payload.plugins ?? []);
        setMarketplaces(payload.marketplaces ?? []);
        setValidation(payload.validation ?? null);
      })
      .catch(() => {
        setPlugins([]);
        setMarketplaces([]);
        setValidation({ browserUseAvailable: false, computerUseAvailable: false });
      });
  const subscribePlugins = useCallback((_notify: () => void) => {
    void loadPlugins();
    return () => {};
  }, []);

  useSyncExternalStore(subscribePlugins, getConfigsViewSnapshot, getConfigsViewSnapshot);
  const setPluginEnabled = (plugin: Plugin, enabled: boolean) => {
    setSavingPlugin(plugin.id);
    void fetch("/api/agent/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: plugin.name, source: plugin.source, enabled }),
    })
      .then(
        (res) =>
          res.json() as Promise<{
            plugins?: Plugin[];
            marketplaces?: Marketplace[];
            validation?: PluginValidation;
          }>,
      )
      .then((payload) => {
        setPlugins(payload.plugins ?? []);
        setMarketplaces(payload.marketplaces ?? []);
        setValidation(payload.validation ?? null);
      })
      .catch(() => void loadPlugins())
      .finally(() => setSavingPlugin(null));
  };
  const upgradeMarketplace = (marketplace?: Marketplace) => {
    const key = marketplace?.name ?? "all";
    setUpgradingMarketplace(key);
    void fetch("/api/agent/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "upgrade_marketplace", name: marketplace?.name }),
    })
      .then(
        (res) =>
          res.json() as Promise<{
            plugins?: Plugin[];
            marketplaces?: Marketplace[];
            validation?: PluginValidation;
          }>,
      )
      .then((payload) => {
        setPlugins(payload.plugins ?? []);
        setMarketplaces(payload.marketplaces ?? []);
        setValidation(payload.validation ?? null);
      })
      .catch(() => void loadPlugins())
      .finally(() => setUpgradingMarketplace(null));
  };
  const addMarketplace = () => {
    const source = marketplaceSource.trim();
    if (!source) return;
    setUpgradingMarketplace("add");
    void fetch("/api/agent/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add_marketplace", source }),
    })
      .then(
        (res) =>
          res.json() as Promise<{
            plugins?: Plugin[];
            marketplaces?: Marketplace[];
            validation?: PluginValidation;
          }>,
      )
      .then((payload) => {
        setPlugins(payload.plugins ?? []);
        setMarketplaces(payload.marketplaces ?? []);
        setValidation(payload.validation ?? null);
        setMarketplaceSource("");
      })
      .catch(() => void loadPlugins())
      .finally(() => setUpgradingMarketplace(null));
  };
  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Plugin marketplaces"
        description="Uses Codex marketplace metadata and the Codex CLI upgrade path instead of a vLLM-specific plugin registry."
        actions={
          <SettingsButton
            onClick={() => upgradeMarketplace()}
            disabled={upgradingMarketplace === "all"}
          >
            {" "}
            Upgrade all
          </SettingsButton>
        }
      >
        {" "}
        {marketplaces.length ? (
          marketplaces.map((marketplace) => (
            <SettingsRow
              key={marketplace.name}
              label={marketplace.name}
              description={marketplace.source ?? "No source reported"}
              value={
                <SettingsValue>
                  {" "}
                  {marketplace.sourceType ?? "source"} · {marketplace.lastUpdated ?? "never"}
                </SettingsValue>
              }
              actions={
                <SettingsButton
                  onClick={() => upgradeMarketplace(marketplace)}
                  disabled={upgradingMarketplace === marketplace.name}
                >
                  Upgrade{" "}
                </SettingsButton>
              }
            />
          ))
        ) : (
          <EmptySafeNotice>No Codex plugin marketplaces found in config.</EmptySafeNotice>
        )}
        <SettingsRow
          label="Add marketplace"
          description="Accepts the same source syntax as Codex: owner/repo[@ref], Git URL, SSH URL, or a local marketplace root."
          control={
            <SettingsInput
              value={marketplaceSource}
              onChange={setMarketplaceSource}
              placeholder="owner/repo[@ref] or /path/to/marketplace"
            />
          }
          actions={
            <SettingsButton
              onClick={addMarketplace}
              disabled={!marketplaceSource.trim() || upgradingMarketplace === "add"}
            >
              Add{" "}
            </SettingsButton>
          }
        />
      </SettingsGroup>{" "}
      <SettingsGroup
        title="Plugin registry"
        description="Discovers Codex plugin bundles from the local Codex plugin cache. Composer/runtime wiring stays modular."
        actions={
          <StatusPill tone={plugins.length ? "good" : "warning"}>{plugins.length} found</StatusPill>
        }
      >
        <SettingsRow
          label="Browser-use"
          description="Required composer plugin for browser control via @browser-use."
          value={
            <SettingsValue>
              {pluginAvailabilityText(browserUse, validation?.browserUseRuntime)}
            </SettingsValue>
          }
          status={
            <PluginAvailabilityPill
              plugin={browserUse}
              available={validation?.browserUseAvailable}
              runtime={validation?.browserUseRuntime}
            />
          }
        />{" "}
        <SettingsRow
          label="Computer-use"
          description="Specific parity check requested for the Codex computer-use helper."
          value={
            <SettingsValue>
              {pluginAvailabilityText(computerUse, validation?.computerUseRuntime)}
            </SettingsValue>
          }
          status={
            <PluginAvailabilityPill
              plugin={computerUse}
              available={validation?.computerUseAvailable}
              runtime={validation?.computerUseRuntime}
            />
          }
        />
        {plugins
          .filter(
            (plugin) =>
              !plugin.name.toLowerCase().includes("browser-use") &&
              !plugin.name.toLowerCase().includes("computer-use"),
          )
          .slice(0, 40)
          .map((plugin) => (
            <SettingsRow
              key={plugin.path}
              label={plugin.name}
              description={pluginDescription(plugin)}
              value={<SettingsValue mono>{pluginLocation(plugin)}</SettingsValue>}
              status={
                <StatusPill tone={plugin.enabled ? "good" : "default"}>
                  {plugin.installed ? "installed" : "available"}
                </StatusPill>
              }
              actions={
                <SettingsButton
                  onClick={() => setPluginEnabled(plugin, !plugin.enabled)}
                  disabled={savingPlugin === plugin.id}
                >
                  {plugin.enabled ? "Disable" : "Enable"}{" "}
                </SettingsButton>
              }
            />
          ))}{" "}
      </SettingsGroup>
    </div>
  );
}
function pluginAvailabilityText(
  plugin: { enabled: boolean } | null,
  runtime?: {
    mcpConfigured?: boolean;
    mcpExecutableExists?: boolean;
    runtimeBlockedOutsideCodex?: boolean;
    runtimeCheckRequired?: boolean;
    note?: string;
  } | null,
) {
  if (!plugin) return "Not discovered";
  if (!plugin.enabled) return "Discovered but disabled in Codex plugin config";
  if (runtime?.mcpConfigured && runtime.mcpExecutableExists === false) {
    return "Selectable, but its MCP command is missing";
  }
  if (runtime?.runtimeBlockedOutsideCodex) return runtime.note ?? "Runtime blocked outside Codex";
  return runtime?.note ?? "Available and selectable in the composer";
}
function PluginAvailabilityPill({
  plugin,
  available,
  runtime,
}: {
  plugin: { enabled: boolean } | null;
  available?: boolean;
  runtime?: {
    mcpConfigured?: boolean;
    mcpExecutableExists?: boolean;
    runtimeBlockedOutsideCodex?: boolean;
    runtimeCheckRequired?: boolean;
  } | null;
}) {
  if (!plugin) return <StatusPill tone="warning">missing</StatusPill>;
  if (!plugin.enabled || !available) return <StatusPill tone="default">disabled</StatusPill>;
  if (runtime?.mcpConfigured && runtime.mcpExecutableExists === false) {
    return <StatusPill tone="warning">mcp missing</StatusPill>;
  }
  if (runtime?.runtimeBlockedOutsideCodex) return <StatusPill tone="warning">blocked</StatusPill>;
  if (runtime?.runtimeCheckRequired) return <StatusPill tone="info">runtime check</StatusPill>;
  if (runtime?.mcpConfigured) return <StatusPill tone="info">mcp wired</StatusPill>;
  return <StatusPill tone="good">selectable</StatusPill>;
}
function pluginDescription(plugin: { appIds?: string[]; description?: string; path: string }) {
  const summary = plugin.description?.replace(/\s+/g, " ").trim();
  const short = summary && summary.length > 150 ? `${summary.slice(0, 147)}…` : summary;
  const connectors = plugin.appIds?.length ? `Connectors: ${plugin.appIds.join(", ")}` : "";
  return [short, connectors].filter(Boolean).join(" · ") || "Codex plugin bundle";
}
function pluginLocation(plugin: { enabled: boolean; source?: string; path: string }) {
  return `${plugin.enabled ? "enabled" : "disabled"} · ${plugin.source ?? "local"} · ${plugin.path}`;
}
