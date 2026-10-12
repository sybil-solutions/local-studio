import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { expandHome } from "./pi-runtime-helpers";
import { isValidPluginId, type PluginRow } from "./plugin-contract";

export { PLUGIN_TEMPLATE, isValidPluginId, type PluginRow } from "./plugin-contract";

/**
 * The store behind the Plugins tab.
 *
 * There is no store to invent here: pi already discovers extensions from
 * `<agentDir>/extensions`, one level deep, and loads every `.ts`/`.js` file it
 * finds plus any subdirectory with an `index` or a `pi` manifest. So this
 * module reads and writes exactly that directory. A separate registry file
 * would have meant the page could show a plugin the runtime never loads, or
 * miss one it does — the two most confusing failures a page like this can have.
 *
 * Disabling renames `foo.ts` to `foo.ts.off`. pi's discovery filter is a suffix
 * test on `.ts`/`.js`, so a renamed file is invisible to it while staying
 * plainly visible to the user in a file listing — which beats a hidden "which
 * of these is on" list that only this app can read.
 */

const DISABLED_SUFFIX = ".off";
const EXTENSION_SUFFIXES = [".ts", ".js"] as const;
/** Generous for a plugin, small enough that a paste accident cannot fill a disk. */
const MAX_SOURCE_BYTES = 256 * 1024;

/**
 * The same directory `getAgentDir()` inside pi resolves.
 *
 * Deliberately re-derived from the environment rather than imported from the
 * SDK: this module is loaded by Next route handlers, and pulling the agent
 * package into that bundle for one `join(homedir(), ".pi", "agent")` costs far
 * more than restating the two-line rule. The rule is stable — it is the
 * package's public config contract — and a drift would show up immediately as
 * an empty plugin list.
 */
export function resolvePiAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (configured) return expandHome(configured);
  return path.join(homedir(), ".pi", "agent");
}

export function resolveUserPluginsDir(): string {
  return path.join(resolvePiAgentDir(), "extensions");
}

const isExtensionFile = (name: string): boolean =>
  EXTENSION_SUFFIXES.some((suffix) => name.endsWith(suffix));

const isDisabledFile = (name: string): boolean =>
  name.endsWith(DISABLED_SUFFIX) && isExtensionFile(name.slice(0, -DISABLED_SUFFIX.length));

/** `foo.ts` and `foo.ts.off` are the same plugin in two states. */
function pluginIdForFile(name: string): string {
  const base = isDisabledFile(name) ? name.slice(0, -DISABLED_SUFFIX.length) : name;
  const suffix = EXTENSION_SUFFIXES.find((candidate) => base.endsWith(candidate));
  return suffix ? base.slice(0, -suffix.length) : base;
}

async function describe(directory: string, file: string, readOnly: boolean): Promise<PluginRow> {
  const target = path.join(directory, file);
  const info = await stat(target).catch(() => null);
  return {
    id: pluginIdForFile(file),
    file,
    path: target,
    enabled: !isDisabledFile(file),
    bytes: info?.size ?? 0,
    updated_at: (info?.mtime ?? new Date(0)).toISOString(),
    read_only: readOnly,
  };
}

/**
 * Does pi load this subdirectory? Mirrors `resolveExtensionEntries`: a
 * package.json carrying a `pi` field, or an `index` file.
 */
function directoryLoads(target: string): boolean {
  const manifest = path.join(target, "package.json");
  if (existsSync(manifest)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, "utf-8"));
      if (parsed && typeof parsed === "object" && "pi" in parsed) return true;
    } catch {
      // A malformed package.json is not a manifest; fall through to index.
    }
  }
  return EXTENSION_SUFFIXES.some((suffix) => existsSync(path.join(target, `index${suffix}`)));
}

export async function listUserPlugins(): Promise<PluginRow[]> {
  const directory = resolveUserPluginsDir();
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const rows: PluginRow[] = [];
  for (const entry of entries) {
    if (entry.isFile() || entry.isSymbolicLink()) {
      if (isExtensionFile(entry.name) || isDisabledFile(entry.name)) {
        rows.push(await describe(directory, entry.name, false));
      }
      continue;
    }
    if (entry.isDirectory() && directoryLoads(path.join(directory, entry.name))) {
      rows.push(await describe(directory, entry.name, true));
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

async function findPlugin(id: string): Promise<PluginRow | null> {
  return (await listUserPlugins()).find((plugin) => plugin.id === id) ?? null;
}

export async function readUserPlugin(id: string): Promise<{ plugin: PluginRow; source: string }> {
  const plugin = await findPlugin(id);
  if (!plugin) throw new Error(`Unknown plugin "${id}"`);
  if (plugin.read_only) throw new Error(`Plugin "${id}" is a directory, not a single file`);
  return { plugin, source: await readFile(plugin.path, "utf-8") };
}

async function ensureDirectory(): Promise<string> {
  const directory = resolveUserPluginsDir();
  await mkdir(directory, { recursive: true });
  await chmod(directory, 0o700).catch(() => undefined);
  return directory;
}

/**
 * Create or overwrite one plugin.
 *
 * The path is never built from the caller's string: an existing plugin is
 * matched by id against the directory listing and written back to the file it
 * was found at, and a new one is only created after the id passes the pattern,
 * which admits no separator, no dot, and no `..`.
 */
export async function writeUserPlugin(id: string, source: string): Promise<PluginRow> {
  if (Buffer.byteLength(source, "utf-8") > MAX_SOURCE_BYTES) {
    throw new Error(`Plugin source exceeds ${Math.floor(MAX_SOURCE_BYTES / 1024)} KB`);
  }
  const existing = await findPlugin(id);
  if (existing?.read_only) throw new Error(`Plugin "${id}" is a directory, not a single file`);
  if (!existing && !isValidPluginId(id)) {
    throw new Error("A plugin name may use lowercase letters, digits, and hyphens");
  }
  const directory = await ensureDirectory();
  const file = existing?.file ?? `${id}.ts`;
  const target = path.join(directory, file);
  await writeFile(target, source, "utf-8");
  await chmod(target, 0o600).catch(() => undefined);
  return describe(directory, file, false);
}

export async function setUserPluginEnabled(id: string, enabled: boolean): Promise<PluginRow> {
  const plugin = await findPlugin(id);
  if (!plugin) throw new Error(`Unknown plugin "${id}"`);
  if (plugin.read_only) throw new Error(`Plugin "${id}" is a directory, not a single file`);
  if (plugin.enabled === enabled) return plugin;
  const directory = resolveUserPluginsDir();
  const file = enabled
    ? plugin.file.slice(0, -DISABLED_SUFFIX.length)
    : `${plugin.file}${DISABLED_SUFFIX}`;
  await rename(plugin.path, path.join(directory, file));
  return describe(directory, file, false);
}

export async function removeUserPlugin(id: string): Promise<void> {
  const plugin = await findPlugin(id);
  if (!plugin) throw new Error(`Unknown plugin "${id}"`);
  if (plugin.read_only) throw new Error(`Plugin "${id}" is a directory, not a single file`);
  await unlink(plugin.path);
}

/**
 * A cheap change-detector for the runtime fingerprint.
 *
 * pi snapshots its extension inventory when a session starts, so an edited
 * plugin only reaches the model once the session is rebuilt. Folding this
 * string into the fingerprint is what makes "save, then send your next
 * message" true — the same contract connectors already have. Only enabled
 * files count: renaming one to `.off` changes the set and therefore the
 * string, which is exactly the restart we want.
 */
export function userPluginsRevisionSync(): string {
  const directory = resolveUserPluginsDir();
  try {
    return readdirSync(directory)
      .filter((name) => isExtensionFile(name))
      .sort()
      .map((name) => {
        const info = statSync(path.join(directory, name));
        return `${name}:${info.mtimeMs}:${info.size}`;
      })
      .join("|");
  } catch {
    return "none";
  }
}
