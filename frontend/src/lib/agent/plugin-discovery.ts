import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";
import { defaultCodexConfigPath, pluginConfigKey } from "./plugin-config";

export type PluginRow = {
  id: string;
  name: string;
  displayName?: string;
  version?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  description?: string;
  shortDescription?: string;
  source?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
  iconPath?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  appConfigPath?: string;
  appIds?: string[];
  appPath?: string;
  instructions?: string;
};

export function defaultPluginRoots(): string[] {
  const home = homedir();
  const config = readCodexConfig(path.join(home, ".codex", "config.toml"));
  return uniquePaths([
    ...config.marketplaces.flatMap((marketplace) => [
      marketplace.source,
      path.join(marketplace.source, "plugins"),
    ]),
    path.join(home, ".codex", "plugins"),
  ]);
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(path.resolve(value))) return false;
    seen.add(path.resolve(value));
    return true;
  });
}

type CodexConfig = {
  marketplaces: Array<{ name: string; source: string }>;
  pluginEnabled: Map<string, boolean>;
};

function readCodexConfig(configPath: string): CodexConfig {
  const config: CodexConfig = { marketplaces: [], pluginEnabled: new Map() };
  try {
    const raw = readFileSync(configPath, "utf8");
    let section: { kind: "marketplace" | "plugin"; key: string } | null = null;
    for (const line of raw.split(/\r?\n/)) {
      const marketplace = /^\[marketplaces\.([^\]]+)\]\s*$/.exec(line);
      if (marketplace) {
        section = { kind: "marketplace", key: marketplace[1].replaceAll('"', "") };
        continue;
      }
      const plugin = /^\[plugins\."([^"]+)"\]\s*$/.exec(line);
      if (plugin) {
        section = { kind: "plugin", key: plugin[1] };
        config.pluginEnabled.set(plugin[1], true);
        continue;
      }
      const source = /^\s*source\s*=\s*"([^"]+)"\s*$/.exec(line)?.[1];
      if (section?.kind === "marketplace" && source) {
        config.marketplaces.push({ name: section.key, source });
      }
      const enabled = /^\s*enabled\s*=\s*(true|false)\s*$/.exec(line)?.[1];
      if (section?.kind === "plugin" && enabled) {
        config.pluginEnabled.set(section.key, enabled === "true");
      }
    }
  } catch {
    // Missing Codex config is fine; we still scan ~/.codex/plugins.
  }
  return config;
}

function hasPluginMarker(dir: string): boolean {
  return (
    existsSync(path.join(dir, ".codex-plugin.toml")) ||
    existsSync(path.join(dir, ".codex-plugin", "plugin.json")) ||
    existsSync(path.join(dir, "plugin.toml")) ||
    existsSync(path.join(dir, "skills"))
  );
}

type PluginManifest = {
  name?: string;
  version?: string;
  description?: string;
  displayName?: string;
  shortDescription?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
  iconPath?: string;
  skillsPath?: string;
  mcpServersPath?: string;
  appsPath?: string;
};

function pluginNameFromPath(dir: string): string {
  const manifest = pluginManifest(dir);
  if (manifest.name) return manifest.name;
  const base = path.basename(dir);
  const parent = path.basename(path.dirname(dir));
  // Cached Codex plugins usually live at `<plugin>/<version-or-hash>/skills`.
  // In that shape the parent is the useful human/plugin name, not the hash.
  if (/^\d/.test(base) || /^[a-f0-9]{12,}$/i.test(base) || /^\d+\.\d+/.test(base)) {
    return parent;
  }
  return base;
}

function pluginManifest(dir: string): PluginManifest {
  try {
    const raw = readFileSync(path.join(dir, ".codex-plugin", "plugin.json"), "utf8");
    const json = JSON.parse(raw) as {
      description?: unknown;
      name?: unknown;
      version?: unknown;
      interface?: {
        displayName?: unknown;
        shortDescription?: unknown;
        category?: unknown;
        capabilities?: unknown;
        defaultPrompt?: unknown;
        brandColor?: unknown;
        composerIcon?: unknown;
        logo?: unknown;
      };
      skills?: unknown;
      mcpServers?: unknown;
      apps?: unknown;
    };
    const iface = json.interface;
    const icon = stringField(iface?.composerIcon) ?? stringField(iface?.logo);
    return {
      name: stringField(json.name),
      version: stringField(json.version),
      description: stringField(json.description),
      displayName: stringField(iface?.displayName),
      shortDescription: stringField(iface?.shortDescription),
      category: stringField(iface?.category),
      capabilities: stringArray(iface?.capabilities),
      defaultPrompts: stringArray(iface?.defaultPrompt),
      brandColor: stringField(iface?.brandColor),
      iconPath: icon ? path.resolve(dir, icon) : undefined,
      skillsPath: resolveManifestPath(dir, json.skills),
      mcpServersPath: resolveManifestPath(dir, json.mcpServers),
      appsPath: resolveManifestPath(dir, json.apps),
    };
  } catch {
    return {};
  }
}

function resolveManifestPath(dir: string, value: unknown): string | undefined {
  const raw = stringField(value);
  return raw ? path.resolve(dir, raw) : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === "string" && !!entry);
  return values.length ? values : undefined;
}

function marketplaceFromPath(dir: string): string | undefined {
  const parts = dir.split(path.sep);
  const cacheIdx = parts.lastIndexOf("cache");
  if (cacheIdx !== -1 && parts[cacheIdx + 1]) return parts[cacheIdx + 1];
  const pluginsIdx = parts.lastIndexOf("plugins");
  if (pluginsIdx > 0 && parts[pluginsIdx - 1]?.startsWith("openai-")) return parts[pluginsIdx - 1];
  return undefined;
}

function pluginResourcePaths(
  dir: string,
  manifest: PluginManifest,
): Pick<PluginRow, "appConfigPath" | "appIds" | "appPath" | "mcpConfigPath" | "skillPath"> {
  const skills = manifest.skillsPath ?? path.join(dir, "skills");
  const mcp = manifest.mcpServersPath ?? path.join(dir, ".mcp.json");
  const apps = manifest.appsPath ?? path.join(dir, ".app.json");
  const appIds = existsSync(apps) ? readAppIds(apps) : [];
  const computerUseApp = path.join(dir, "Codex Computer Use.app");
  return {
    ...(existsSync(skills) ? { skillPath: skills } : {}),
    ...(existsSync(mcp) ? { mcpConfigPath: mcp } : {}),
    ...(existsSync(apps) ? { appConfigPath: apps } : {}),
    ...(appIds.length ? { appIds } : {}),
    ...(existsSync(computerUseApp) ? { appPath: computerUseApp } : {}),
  };
}

function readAppIds(appConfigPath: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(appConfigPath, "utf8")) as { apps?: unknown };
    if (!parsed.apps || typeof parsed.apps !== "object") return [];
    return Object.values(parsed.apps as Record<string, unknown>).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" && id.trim() ? [id.trim()] : [];
    });
  } catch {
    return [];
  }
}

function knownLocalPluginRows(): PluginRow[] {
  const rows: PluginRow[] = [];
  for (const computerUseRoot of localComputerUseRoots()) {
    const computerUseApp = path.join(computerUseRoot, "Codex Computer Use.app");
    const computerUseMcp = path.join(computerUseRoot, ".mcp.json");
    const computerUseSkills = path.join(computerUseRoot, "skills");
    if (!existsSync(computerUseApp)) continue;
    const isSybil = localComputerUseMcpServerNames(computerUseMcp).includes("sybil");
    rows.push({
      id: `builtin:computer-use:${computerUseRoot}`,
      name: isSybil ? "sybil" : "computer-use",
      displayName: isSybil ? "Sybil" : "Computer Use",
      path: computerUseRoot,
      installed: true,
      enabled: true,
      source: "openai-bundled",
      category: "Productivity",
      capabilities: ["Interactive", "Read", "Write"],
      appPath: computerUseApp,
      ...(existsSync(computerUseMcp) ? { mcpConfigPath: computerUseMcp } : {}),
      ...(existsSync(computerUseSkills) ? { skillPath: computerUseSkills } : {}),
      description: isSybil
        ? "Local Sybil desktop-control MCP backed by the clean-room Computer Use implementation."
        : "Local Codex Computer Use helper app.",
      shortDescription: isSybil ? "Desktop UI through Sybil" : undefined,
    });
  }
  return rows;
}

function localComputerUseMcpServerNames(configPath: string): string[] {
  if (!existsSync(configPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return Object.keys(parsed.mcpServers ?? {}).map((name) => name.toLowerCase());
  } catch {
    return [];
  }
}

function localComputerUseRoots(): string[] {
  return [
    path.join(resolveDataDir(), "computer-use"),
    path.join(homedir(), ".codex", "computer-use"),
  ];
}

export function discoverPlugins(
  roots: string[] = defaultPluginRoots(),
  options: { configPath?: string; maxDepth?: number } = {},
): PluginRow[] {
  const codexConfig = readCodexConfig(options.configPath ?? defaultCodexConfigPath());
  const rows = discoverPluginRows(roots, codexConfig, options.maxDepth ?? 8);
  return sortPluginRows(dedupePluginRows(rows).filter((row) => !isOpenAiPluginRow(row)));
}

function discoverPluginRows(
  roots: string[],
  codexConfig: CodexConfig,
  maxDepth: number,
): PluginRow[] {
  const rows: PluginRow[] = [];
  const seen = new Set<string>();
  for (const root of roots) collectPluginRows(root, 0, { codexConfig, maxDepth, rows, seen });
  if (includesDefaultPluginRoot(roots)) rows.push(...knownLocalPluginRows());
  return rows;
}

type PluginDiscoveryState = {
  codexConfig: CodexConfig;
  maxDepth: number;
  rows: PluginRow[];
  seen: Set<string>;
};

function collectPluginRows(dir: string, depth: number, state: PluginDiscoveryState): void {
  if (depth > state.maxDepth || state.seen.has(dir)) return;
  state.seen.add(dir);
  if (!isDirectory(dir)) return;

  if (hasPluginMarker(dir)) {
    state.rows.push(pluginRowFromDirectory(dir, state.codexConfig));
    return;
  }

  for (const entry of readableDirectoryEntries(dir)) {
    if (entry.startsWith(".") && depth > 0) continue;
    collectPluginRows(path.join(dir, entry), depth + 1, state);
  }
}

function pluginRowFromDirectory(dir: string, codexConfig: CodexConfig): PluginRow {
  const manifest = pluginManifest(dir);
  const name = manifest.name ?? pluginNameFromPath(dir);
  const source = marketplaceFromPath(dir);
  const enabled =
    (source ? codexConfig.pluginEnabled.get(pluginConfigKey(name, source)) : undefined) ?? true;

  return {
    id: dir,
    name,
    ...(manifest.displayName ? { displayName: manifest.displayName } : {}),
    ...(manifest.version ? { version: manifest.version } : {}),
    path: dir,
    installed: true,
    enabled,
    ...(source ? { source } : {}),
    ...pluginManifestRowFields(manifest),
    ...pluginResourcePaths(dir, manifest),
  };
}

function pluginManifestRowFields(manifest: PluginManifest): Partial<PluginRow> {
  return {
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.shortDescription ? { shortDescription: manifest.shortDescription } : {}),
    ...(manifest.category ? { category: manifest.category } : {}),
    ...(manifest.capabilities ? { capabilities: manifest.capabilities } : {}),
    ...(manifest.defaultPrompts ? { defaultPrompts: manifest.defaultPrompts } : {}),
    ...(manifest.brandColor ? { brandColor: manifest.brandColor } : {}),
    ...(manifest.iconPath && existsSync(manifest.iconPath) ? { iconPath: manifest.iconPath } : {}),
  };
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readableDirectoryEntries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function includesDefaultPluginRoot(roots: string[]): boolean {
  const defaultRoot = path.resolve(path.join(homedir(), ".codex", "plugins"));
  return roots.some((root) => path.resolve(root) === defaultRoot);
}

function dedupePluginRows(rows: PluginRow[]): PluginRow[] {
  const deduped = new Map<string, PluginRow>();
  for (const row of rows) {
    const key = pluginConfigKey(row.name.toLowerCase(), row.source);
    const current = deduped.get(key);
    deduped.set(key, current ? preferredPluginRow(current, row) : row);
  }
  return [...deduped.values()];
}

function sortPluginRows(rows: PluginRow[]): PluginRow[] {
  return [...rows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled));
}

function isOpenAiPluginRow(row: PluginRow): boolean {
  const source = row.source?.toLowerCase() ?? "";
  if (source.startsWith("openai-")) return true;
  return row.path.split(path.sep).some((part) => part.startsWith("openai-"));
}

function preferredPluginRow(current: PluginRow, candidate: PluginRow): PluginRow {
  if (current.enabled !== candidate.enabled) return candidate.enabled ? candidate : current;
  const candidateLocalComputerUse = isLocalComputerUseHelper(candidate);
  const currentLocalComputerUse = isLocalComputerUseHelper(current);
  if (candidateLocalComputerUse !== currentLocalComputerUse) {
    return candidateLocalComputerUse ? candidate : current;
  }
  if (candidateLocalComputerUse && currentLocalComputerUse) {
    if (Boolean(candidate.mcpConfigPath) !== Boolean(current.mcpConfigPath)) {
      return candidate.mcpConfigPath ? candidate : current;
    }
  }
  const versionDelta = comparePluginVersions(candidate.version, current.version);
  if (versionDelta !== 0) return versionDelta > 0 ? candidate : current;
  const candidateBundled = candidate.path.includes("/Applications/Codex.app/");
  const currentBundled = current.path.includes("/Applications/Codex.app/");
  if (candidateBundled !== currentBundled) return candidateBundled ? candidate : current;
  return candidate;
}

function isLocalComputerUseHelper(row: PluginRow): boolean {
  const name = row.name.toLowerCase();
  const displayName = row.displayName?.toLowerCase() ?? "";
  const localHelperName =
    name.includes("computer-use") || name === "sybil" || displayName.includes("sybil");
  return localHelperName && localComputerUseRoots().some((root) => isPathInside(row.path, root));
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function comparePluginVersions(left?: string, right?: string): number {
  const l = versionParts(left);
  const r = versionParts(right);
  for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
    const delta = (l[i] ?? 0) - (r[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function versionParts(value?: string): number[] {
  return (value ?? "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readSkillMarkdowns(dir: string, maxChars: number): string | undefined {
  const chunks: string[] = [];
  const visit = (current: string, depth: number) => {
    if (depth > 4 || chunks.join("\n\n").length >= maxChars) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    if (entries.includes("SKILL.md")) {
      const raw = readFileSync(path.join(current, "SKILL.md"), "utf8").trim();
      if (raw) chunks.push(raw);
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const candidate = path.join(current, entry);
      try {
        if (statSync(candidate).isDirectory()) visit(candidate, depth + 1);
      } catch {
        // ignore unreadable plugin skill folders
      }
    }
  };
  visit(dir, 0);
  const joined = chunks.join("\n\n---\n\n").slice(0, maxChars).trim();
  return joined || undefined;
}

export function loadPluginInstructions(
  pluginPath: string,
  roots: string[] = defaultPluginRoots(),
  maxChars = 8000,
): PluginRow | null {
  const resolved = path.resolve(pluginPath);
  if (!roots.some((root) => path.resolve(root) === resolved || isInside(resolved, root))) {
    return null;
  }
  const plugin = discoverPlugins([resolved], { maxDepth: 1 })[0];
  if (!plugin) return null;
  const skillsDir = plugin.skillPath;
  const instructions =
    skillsDir && existsSync(skillsDir) ? readSkillMarkdowns(skillsDir, maxChars) : undefined;
  return instructions ? { ...plugin, instructions } : plugin;
}
