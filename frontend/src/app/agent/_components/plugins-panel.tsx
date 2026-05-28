"use client";
/* eslint-disable max-lines */
import { useCallback, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2, Package, Plug, Search, Trash2 } from "lucide-react";
import {
  usePluginsCatalogFetchEffect,
  usePluginsPanelInitialLoadEffect,
} from "@/hooks/agent/use-plugins-panel-effects";

type PiPackageListEntry = {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
  enabled: boolean;
};

type PiExtensionResource = {
  path: string;
  source: string;
  enabled: boolean;
  origin: "package" | "top-level";
  scope: "user" | "project" | "temporary";
};

type ExtensionsResponse = {
  agentDir: string;
  cwd: string;
  packages: PiPackageListEntry[];
  resources: {
    extensions: PiExtensionResource[];
    skills: PiExtensionResource[];
    prompts: PiExtensionResource[];
    themes: PiExtensionResource[];
  };
};

type CatalogEntry = {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  author: string;
  date: string;
  npm: string;
  repo?: string;
  homepage?: string;
  weeklyDownloads: number;
  kind: "extension" | "skill" | "prompt" | "theme" | "package";
};

type CatalogResponse = { total: number; entries: CatalogEntry[]; error?: string };

type View = "browse" | "installed";

const KIND_LABEL: Record<CatalogEntry["kind"], string> = {
  extension: "Extension",
  skill: "Skill",
  prompt: "Prompt",
  theme: "Theme",
  package: "Package",
};

function sourceForName(name: string) {
  return `npm:${name}`;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function PluginsPanel() {
  const [data, setData] = useState<ExtensionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [view, setView] = useState<View>("browse");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [installScope, setInstallScope] = useState<"user" | "project">("user");
  const [customSource, setCustomSource] = useState("");
  const [showRestartHint, setShowRestartHint] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/agent/extensions", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Listing failed (HTTP ${response.status})`);
      }
      const payload = (await response.json()) as ExtensionsResponse;
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load extensions");
    } finally {
      setLoading(false);
    }
  }, []);

  usePluginsPanelInitialLoadEffect(refresh);

  // Catalog fetch — debounced when the search text changes.
  const handleCatalogResult = useCallback((entries: unknown) => {
    setCatalog((entries as CatalogEntry[]) ?? []);
  }, []);
  usePluginsCatalogFetchEffect({
    view,
    query,
    onLoad: setCatalogLoading,
    onError: setCatalogError,
    onResult: handleCatalogResult,
  });

  const installedByName = useMemo(() => {
    const map = new Map<string, PiPackageListEntry>();
    for (const pkg of data?.packages ?? []) {
      // Strip "npm:" or "git:" prefix and any version suffix for lookup.
      const raw = pkg.source.replace(/^[a-z]+:/, "");
      const name = raw
        .split("@")
        .slice(0, raw.startsWith("@") ? 2 : 1)
        .join("@");
      map.set(name, pkg);
    }
    return map;
  }, [data?.packages]);

  const installSource = useCallback(
    async (source: string, local: boolean) => {
      const key = `install:${source}`;
      setBusyKey(key);
      setError(null);
      try {
        const response = await fetch("/api/agent/extensions/install", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, local }),
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<ExtensionsResponse> & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(payload.error ?? `Install failed (HTTP ${response.status})`);
        if (payload.packages && payload.resources) {
          setData((d) =>
            d ? { ...d, packages: payload.packages!, resources: payload.resources! } : d,
          );
        } else {
          await refresh();
        }
        setShowRestartHint(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Install failed");
      } finally {
        setBusyKey(null);
      }
    },
    [refresh],
  );

  const handleRemove = useCallback(
    async (pkg: PiPackageListEntry) => {
      const key = `remove:${pkg.source}`;
      setBusyKey(key);
      setError(null);
      try {
        const response = await fetch("/api/agent/extensions/uninstall", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: pkg.source, local: pkg.scope === "project" }),
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<ExtensionsResponse> & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(payload.error ?? `Uninstall failed (HTTP ${response.status})`);
        if (payload.packages && payload.resources) {
          setData((d) =>
            d ? { ...d, packages: payload.packages!, resources: payload.resources! } : d,
          );
        } else {
          await refresh();
        }
        setShowRestartHint(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Uninstall failed");
      } finally {
        setBusyKey(null);
      }
    },
    [refresh],
  );

  const handleToggle = useCallback(async (key: string, nextEnabled: boolean) => {
    setBusyKey(`toggle:${key}`);
    setError(null);
    try {
      const response = await fetch("/api/agent/extensions/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, enabled: nextEnabled }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Toggle failed (HTTP ${response.status})`);
      }
      setData((d) =>
        d
          ? {
              ...d,
              packages: d.packages.map((pkg) =>
                pkg.source === key ? { ...pkg, enabled: nextEnabled } : pkg,
              ),
              resources: {
                ...d.resources,
                extensions: d.resources.extensions.map((res) =>
                  res.path === key || res.source === key ? { ...res, enabled: nextEnabled } : res,
                ),
              },
            }
          : d,
      );
      setShowRestartHint(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusyKey(null);
    }
  }, []);

  const handleCustomInstall = useCallback(() => {
    const source = customSource.trim();
    if (!source) return;
    void installSource(source, installScope === "project").then(() => setCustomSource(""));
  }, [customSource, installScope, installSource]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-(--bg)">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-xs">
        <Plug className="h-3.5 w-3.5 text-(--accent)" />
        <span className="font-medium text-(--fg)">Pi packages</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-(--dim)">
          Catalog from npm · install on click
        </span>
        <div className="flex items-center gap-0.5 rounded border border-(--border) p-0.5">
          <button
            type="button"
            onClick={() => setView("browse")}
            className={`h-5 rounded px-2 text-[10px] ${
              view === "browse"
                ? "bg-(--accent)/15 text-(--accent)"
                : "text-(--dim) hover:text-(--fg)"
            }`}
          >
            Browse
          </button>
          <button
            type="button"
            onClick={() => setView("installed")}
            className={`h-5 rounded px-2 text-[10px] ${
              view === "installed"
                ? "bg-(--accent)/15 text-(--accent)"
                : "text-(--dim) hover:text-(--fg)"
            }`}
          >
            Installed ({data?.packages.length ?? 0})
          </button>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="h-6 rounded px-2 text-[11px] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-xs">
        {error ? (
          <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
            {error}
          </div>
        ) : null}
        {showRestartHint ? (
          <div className="mb-2 flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
            <span className="flex-1">
              Plugin changes apply to the <b>next session</b>. Start a new chat for the model to see
              new tools.
            </span>
            <button
              type="button"
              onClick={() => setShowRestartHint(false)}
              className="rounded px-1.5 text-amber-300/70 hover:text-amber-200"
            >
              ✕
            </button>
          </div>
        ) : null}

        {view === "browse" ? (
          <BrowseView
            query={query}
            onQueryChange={setQuery}
            entries={catalog}
            loading={catalogLoading}
            error={catalogError}
            installedByName={installedByName}
            busyKey={busyKey}
            scope={installScope}
            onScopeChange={setInstallScope}
            onInstall={(name) =>
              void installSource(sourceForName(name), installScope === "project")
            }
            customSource={customSource}
            onCustomSourceChange={setCustomSource}
            onCustomInstall={handleCustomInstall}
          />
        ) : (
          <InstalledView
            data={data}
            busyKey={busyKey}
            onToggle={(key, next) => void handleToggle(key, next)}
            onRemove={(pkg) => void handleRemove(pkg)}
          />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Browse view
// ---------------------------------------------------------------------------

function BrowseView(props: {
  query: string;
  onQueryChange: (q: string) => void;
  entries: CatalogEntry[];
  loading: boolean;
  error: string | null;
  installedByName: Map<string, PiPackageListEntry>;
  busyKey: string | null;
  scope: "user" | "project";
  onScopeChange: (scope: "user" | "project") => void;
  onInstall: (name: string) => void;
  customSource: string;
  onCustomSourceChange: (value: string) => void;
  onCustomInstall: () => void;
}) {
  const {
    query,
    onQueryChange,
    entries,
    loading,
    error,
    installedByName,
    busyKey,
    scope,
    onScopeChange,
    onInstall,
    customSource,
    onCustomSourceChange,
    onCustomInstall,
  } = props;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--dim)" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search pi packages…"
            className="h-7 w-full rounded border border-(--border) bg-(--bg) pl-6 pr-2 text-[11px] text-(--fg) outline-none focus:border-(--accent)/60"
          />
        </div>
        <select
          value={scope}
          onChange={(event) => onScopeChange(event.target.value as "user" | "project")}
          className="h-7 rounded border border-(--border) bg-(--bg) px-1 text-[10px] text-(--fg)"
          title="Install scope"
        >
          <option value="user">User</option>
          <option value="project">Project</option>
        </select>
      </div>

      <details className="rounded border border-(--border)/60 bg-(--surface)/20 px-2 py-1 text-[11px]">
        <summary className="cursor-pointer select-none text-(--dim) hover:text-(--fg)">
          Install from custom source (git, local path, etc.)
        </summary>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={customSource}
            onChange={(event) => onCustomSourceChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCustomInstall();
            }}
            placeholder="npm:@scope/name · git:owner/repo · ./local-path"
            className="min-w-0 flex-1 rounded border border-(--border) bg-(--bg) px-2 py-1 font-mono text-[10px] text-(--fg) outline-none focus:border-(--accent)/60"
          />
          <button
            type="button"
            onClick={onCustomInstall}
            disabled={!customSource.trim() || busyKey?.startsWith("install:")}
            className="h-7 rounded bg-(--accent)/20 px-3 text-[10px] text-(--accent) hover:bg-(--accent)/30 disabled:opacity-50"
          >
            Install
          </button>
        </div>
      </details>

      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      ) : null}

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-(--dim)">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading catalog…
        </div>
      ) : (
        <ul className="grid gap-2">
          {entries.map((entry) => {
            const installed = installedByName.get(entry.name);
            const installBusy = busyKey === `install:${sourceForName(entry.name)}`;
            return (
              <li
                key={entry.name}
                className="rounded border border-(--border) bg-(--surface)/20 px-2.5 py-2"
              >
                <div className="flex items-start gap-2">
                  <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--dim)" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-mono text-[12px] text-(--fg)">
                        {entry.name}
                      </span>
                      <span className="rounded bg-(--bg) px-1 py-px text-[9px] uppercase tracking-wide text-(--dim)">
                        {KIND_LABEL[entry.kind]}
                      </span>
                      <span className="font-mono text-[9px] text-(--dim)">v{entry.version}</span>
                      {installed ? (
                        <span className="rounded bg-(--accent)/15 px-1 py-px text-[9px] uppercase tracking-wide text-(--accent)">
                          Installed
                        </span>
                      ) : null}
                    </div>
                    {entry.description ? (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-(--dim)">
                        {entry.description}
                      </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-(--dim)">
                      {entry.author ? <span>@{entry.author}</span> : null}
                      <span>{formatDownloads(entry.weeklyDownloads)}/wk</span>
                      <span>{timeAgo(entry.date)}</span>
                      <a
                        href={entry.npm}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 hover:text-(--fg)"
                      >
                        npm <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      {entry.repo ? (
                        <a
                          href={entry.repo.replace(/^git\+/, "").replace(/\.git$/, "")}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 hover:text-(--fg)"
                        >
                          repo <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                  {installed ? (
                    <span className="inline-flex h-6 items-center rounded bg-(--bg) px-2 text-[10px] text-(--dim)">
                      ✓
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onInstall(entry.name)}
                      disabled={installBusy}
                      className="inline-flex h-6 items-center gap-1 rounded bg-(--accent)/20 px-2 text-[10px] text-(--accent) hover:bg-(--accent)/30 disabled:opacity-50"
                    >
                      {installBusy ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Download className="h-2.5 w-2.5" />
                      )}
                      Install
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {!loading && entries.length === 0 ? (
            <li className="rounded border border-dashed border-(--border) px-3 py-6 text-center text-[11px] text-(--dim)">
              No packages match your search.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed view
// ---------------------------------------------------------------------------

function InstalledView(props: {
  data: ExtensionsResponse | null;
  busyKey: string | null;
  onToggle: (key: string, next: boolean) => void;
  onRemove: (pkg: PiPackageListEntry) => void;
}) {
  const { data, busyKey, onToggle, onRemove } = props;
  const packages = data?.packages ?? [];
  if (packages.length === 0) {
    return (
      <div className="rounded border border-dashed border-(--border) px-3 py-6 text-center text-[11px] text-(--dim)">
        Nothing installed yet. Switch to <b>Browse</b> to add one.
      </div>
    );
  }
  return (
    <ul className="grid gap-2">
      {packages.map((pkg) => (
        <li
          key={`${pkg.scope}:${pkg.source}`}
          className="rounded border border-(--border) bg-(--surface)/20 px-2.5 py-2"
        >
          <div className="flex items-start gap-2">
            <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--accent)" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-(--fg)">
                <span className="truncate font-mono">{pkg.source}</span>
                <span className="rounded bg-(--bg) px-1 py-px text-[9px] uppercase tracking-wide text-(--dim)">
                  {pkg.scope}
                </span>
                {pkg.filtered ? (
                  <span className="rounded bg-(--bg) px-1 py-px text-[9px] uppercase tracking-wide text-(--dim)">
                    filtered
                  </span>
                ) : null}
              </div>
              {pkg.installedPath ? (
                <div
                  className="mt-0.5 truncate font-mono text-[10px] text-(--dim)"
                  title={pkg.installedPath}
                >
                  {pkg.installedPath}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onToggle(pkg.source, !pkg.enabled)}
              disabled={busyKey === `toggle:${pkg.source}`}
              className={`h-6 rounded px-2 text-[10px] ${
                pkg.enabled
                  ? "bg-(--accent)/15 text-(--accent)"
                  : "bg-(--bg) text-(--dim) hover:text-(--fg)"
              } disabled:opacity-50`}
            >
              {pkg.enabled ? "On" : "Off"}
            </button>
            <button
              type="button"
              onClick={() => onRemove(pkg)}
              disabled={busyKey === `remove:${pkg.source}`}
              className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              title="Uninstall"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
