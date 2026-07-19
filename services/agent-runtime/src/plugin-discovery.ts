import { readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect, Schema } from "effect";
import { coerce, compare } from "semver";
import { resolveDataDir } from "./data-dir";
import { resolveBundledPluginDirectory } from "./plugin-resources";

const PluginInterfaceSchema = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  shortDescription: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  brandColor: Schema.optional(Schema.String),
});

const PluginManifestSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.String),
  apps: Schema.optional(Schema.String),
  mcpServers: Schema.optional(Schema.String),
  interface: Schema.optional(PluginInterfaceSchema),
});

export type PluginManifest = typeof PluginManifestSchema.Type;

export type PluginSource = {
  label: string;
  dir: string;
  priority: number;
};

export type PluginView = {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  category: string;
  source: string;
  capabilities: readonly string[];
  brandColor?: string;
  provides: {
    skills: boolean;
    mcpServers: boolean;
    apps: boolean;
  };
};

export type PluginBundle = {
  plugin: PluginView;
  manifest: PluginManifest;
  rootDir: string;
  trusted: boolean;
};

type DiscoveredPlugin = {
  bundle: PluginBundle;
  priority: number;
};

export class PluginDiscoveryError extends Error {}

export function defaultPluginSources(): PluginSource[] {
  const home = homedir();
  const bundled = resolveBundledPluginDirectory();
  return [
    { label: "Local Studio", dir: path.join(resolveDataDir(), "plugins"), priority: 5 },
    ...(bundled ? [{ label: "Local Studio", dir: bundled, priority: 4 }] : []),
    { label: "Codex", dir: path.join(home, ".codex", "plugins", "cache"), priority: 2 },
    {
      label: "Codex",
      dir: path.join("/Applications", "Codex.app", "Contents", "Resources", "plugins"),
      priority: 1,
    },
  ];
}

function compareVersions(left: string, right: string): number {
  const leftVersion = coerce(left);
  const rightVersion = coerce(right);
  if (!leftVersion || !rightVersion) return left.localeCompare(right);
  return compare(leftVersion, rightVersion) || left.localeCompare(right);
}

function pluginView(manifest: PluginManifest, source: string): PluginView {
  const version = manifest.version?.trim() || "0.0.0";
  return {
    id: manifest.name,
    name: manifest.name,
    displayName: manifest.interface?.displayName?.trim() || manifest.name,
    version,
    description: manifest.interface?.shortDescription?.trim() || manifest.description?.trim() || "",
    category: manifest.interface?.category?.trim() || "Other",
    source,
    capabilities: manifest.interface?.capabilities ?? [],
    ...(manifest.interface?.brandColor ? { brandColor: manifest.interface.brandColor } : {}),
    provides: {
      skills: Boolean(manifest.skills),
      mcpServers: Boolean(manifest.mcpServers),
      apps: Boolean(manifest.apps),
    },
  };
}

async function manifestInDirectory(
  dir: string,
  source: PluginSource,
): Promise<DiscoveredPlugin | null> {
  try {
    const raw = await readFile(path.join(dir, ".codex-plugin", "plugin.json"), "utf8");
    const manifest = Schema.decodeUnknownSync(PluginManifestSchema)(JSON.parse(raw));
    const bundled = resolveBundledPluginDirectory();
    const trusted = bundled
      ? path.dirname(await realpath(dir)) === (await realpath(bundled))
      : false;
    return {
      bundle: { plugin: pluginView(manifest, source.label), manifest, rootDir: dir, trusted },
      priority: source.priority,
    };
  } catch {
    return null;
  }
}

async function scanDirectory(
  dir: string,
  source: PluginSource,
  depth: number,
  maxDepth: number,
): Promise<DiscoveredPlugin[]> {
  const manifest = await manifestInDirectory(dir, source);
  if (manifest) return [manifest];
  if (depth >= maxDepth) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const childDirectories = entries.filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
    );
    return (
      await Promise.all(
        childDirectories.map((entry) =>
          scanDirectory(path.join(dir, entry.name), source, depth + 1, maxDepth),
        ),
      )
    ).flat();
  } catch {
    return [];
  }
}

function preferredPlugin(
  current: DiscoveredPlugin | undefined,
  candidate: DiscoveredPlugin,
): DiscoveredPlugin {
  if (!current) return candidate;
  if (current.bundle.trusted !== candidate.bundle.trusted) {
    return candidate.bundle.trusted ? candidate : current;
  }
  if (candidate.priority > current.priority) return candidate;
  if (candidate.priority < current.priority) return current;
  return compareVersions(candidate.bundle.plugin.version, current.bundle.plugin.version) > 0
    ? candidate
    : current;
}

export function discoverPluginBundles(
  sources: PluginSource[] = defaultPluginSources(),
  maxDepth = 5,
): Effect.Effect<PluginBundle[], PluginDiscoveryError> {
  return Effect.tryPromise({
    try: async () => {
      const discovered = (
        await Promise.all(sources.map((source) => scanDirectory(source.dir, source, 0, maxDepth)))
      ).flat();
      const plugins = new Map<string, DiscoveredPlugin>();
      for (const candidate of discovered) {
        plugins.set(
          candidate.bundle.plugin.name,
          preferredPlugin(plugins.get(candidate.bundle.plugin.name), candidate),
        );
      }
      return [...plugins.values()]
        .map(({ bundle }) => bundle)
        .sort((left, right) => left.plugin.displayName.localeCompare(right.plugin.displayName));
    },
    catch: (error) => new PluginDiscoveryError(String(error)),
  });
}

export function discoverPlugins(
  sources: PluginSource[] = defaultPluginSources(),
  maxDepth = 5,
): Effect.Effect<PluginView[], PluginDiscoveryError> {
  return discoverPluginBundles(sources, maxDepth).pipe(
    Effect.map((bundles) => bundles.map(({ plugin }) => plugin)),
  );
}
