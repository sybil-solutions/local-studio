// Pi package marketplace surface.
//
// Wraps `@earendil-works/pi-coding-agent`'s `DefaultPackageManager` so the
// Next.js API routes can install/remove/list Pi packages without touching
// the running session runtime directly.
//
// Per-session enable/disable lives in `tools/context.tsx`'s ToolSelection
// (the SDK has no concept of "disabled but installed"). We expose a separate
// per-extension JSON config bucket under `<agentDir>/extension-config/` so
// extensions that surface settings can persist them without modifying the
// SDK's `settings.json` directly.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
  type ResolvedPaths,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { resolveDataDir } from "@/lib/data-dir";

// The SDK's PackageManager interface returns this shape from
// listConfiguredPackages() but doesn't re-export the type at the package
// root, so we redeclare it locally to avoid pulling on internal paths.
type ConfiguredPackage = {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
};

export type PiPackageListEntry = ConfiguredPackage & {
  enabled: boolean;
};

export type PiExtensionResource = {
  /** Absolute filesystem path the SDK resolved for this resource. */
  path: string;
  /** Source string from settings, or "auto" for filesystem auto-discovery. */
  source: string;
  /** Whether the SDK's `resolve()` considers this resource enabled. */
  enabled: boolean;
  /** Originating package (npm/git source) when the resource came from a package. */
  origin: "package" | "top-level";
  /** Pi scope this resource was contributed at. */
  scope: "user" | "project" | "temporary";
};

export type PiExtensionListResult = {
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

export type PiPackageProgressEvent = {
  type: "start" | "progress" | "complete" | "error";
  action: "install" | "remove" | "update" | "clone" | "pull";
  source: string;
  message?: string;
};

// ---------------------------------------------------------------------------
// Agent dir resolution + manager construction
// ---------------------------------------------------------------------------

/** `<dataDir>/pi-agent` — the SDK's "agentDir". */
export function agentDir(): string {
  const dir = path.join(resolveDataDir(), "pi-agent");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `<agentDir>/extension-config/` — our per-extension config bucket. */
function extensionConfigDir(): string {
  const dir = path.join(agentDir(), "extension-config");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Cwd to scope project-scope package installs against. The agent CWD comes
 *  from the active session; for management routes we fall back to the agent
 *  dir itself so "user" scope works without a project. */
function defaultCwd(): string {
  return agentDir();
}

function createSettingsManager(cwd: string): SettingsManager {
  return SettingsManager.create(cwd, agentDir());
}

function createPackageManager(
  cwd: string = defaultCwd(),
  settingsManager: SettingsManager = createSettingsManager(cwd),
  onProgress?: (event: PiPackageProgressEvent) => void,
): DefaultPackageManager {
  const manager = new DefaultPackageManager({ cwd, agentDir: agentDir(), settingsManager });
  if (onProgress) {
    manager.setProgressCallback((event) =>
      onProgress({
        type: event.type,
        action: event.action,
        source: event.source,
        message: event.message,
      }),
    );
  }
  return manager;
}

// ---------------------------------------------------------------------------
// Per-extension enable/disable (separate from settings.packages)
// ---------------------------------------------------------------------------

const ENABLED_OVERRIDES_FILE = "enabled.json";

type EnabledOverrides = Record<string, boolean>;

function enabledOverridesPath(): string {
  return path.join(extensionConfigDir(), ENABLED_OVERRIDES_FILE);
}

export function readEnabledOverrides(): EnabledOverrides {
  const file = enabledOverridesPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as EnabledOverrides;
    }
  } catch {
    // Corrupted overrides file is treated as empty.
  }
  return {};
}

function writeEnabledOverrides(next: EnabledOverrides): void {
  writeFileSync(enabledOverridesPath(), JSON.stringify(next, null, 2), "utf8");
}

export function setExtensionEnabled(key: string, enabled: boolean): EnabledOverrides {
  const current = readEnabledOverrides();
  if (enabled) {
    delete current[key];
  } else {
    current[key] = false;
  }
  writeEnabledOverrides(current);
  return current;
}

/**
 * Token that changes whenever the on-disk Pi package configuration changes.
 * Used by the runtime fingerprint to invalidate cached sessions after an
 * install/uninstall/update.
 */
export function packagesConfigToken(): string {
  const file = path.join(agentDir(), "settings.json");
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

// ---------------------------------------------------------------------------
// Per-extension JSON config
// ---------------------------------------------------------------------------

export type PiExtensionConfig = Record<string, unknown>;

function sanitizeConfigKey(key: string): string {
  // Avoid path traversal in the disk layout.
  return key.replace(/[^a-zA-Z0-9._@/-]/g, "_").replace(/^\/+/, "");
}

function configFilePath(key: string): string {
  return path.join(extensionConfigDir(), `${sanitizeConfigKey(key)}.json`);
}

export function readExtensionConfig(key: string): PiExtensionConfig {
  const file = configFilePath(key);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PiExtensionConfig;
    }
  } catch {
    // Treat invalid files as empty so callers don't crash on user edits.
  }
  return {};
}

export function writeExtensionConfig(key: string, config: PiExtensionConfig): void {
  const file = configFilePath(key);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Public API: list, install, uninstall, update
// ---------------------------------------------------------------------------

function mapResolvedResource(
  resource: ResolvedResource,
  overrides: EnabledOverrides,
  applyOverride: boolean,
): PiExtensionResource {
  const sdkEnabled = resource.enabled;
  const overrideEnabled = applyOverride
    ? overrides[resource.path] !== false &&
      (resource.metadata.source === "auto" || overrides[resource.metadata.source] !== false)
    : true;
  return {
    path: resource.path,
    source: resource.metadata.source,
    enabled: sdkEnabled && overrideEnabled,
    origin: resource.metadata.origin,
    scope: resource.metadata.scope,
  };
}

function mapResolvedPaths(paths: ResolvedPaths, overrides: EnabledOverrides) {
  return {
    // Only `extensions` honour the on/off override (skills/prompts/themes
    // don't contribute executable tools, so we leave them alone).
    extensions: paths.extensions.map((res) => mapResolvedResource(res, overrides, true)),
    skills: paths.skills.map((res) => mapResolvedResource(res, overrides, false)),
    prompts: paths.prompts.map((res) => mapResolvedResource(res, overrides, false)),
    themes: paths.themes.map((res) => mapResolvedResource(res, overrides, false)),
  };
}

function packageEnabled(pkg: ConfiguredPackage, overrides: EnabledOverrides): boolean {
  return overrides[pkg.source] !== false && overrides[pkg.installedPath ?? ""] !== false;
}

export async function listInstalledExtensions(): Promise<PiExtensionListResult> {
  const cwd = defaultCwd();
  const manager = createPackageManager(cwd);
  const resolved = await manager.resolve();
  const configured = manager.listConfiguredPackages();
  const overrides = readEnabledOverrides();
  return {
    agentDir: agentDir(),
    cwd,
    packages: configured.map((pkg) => ({ ...pkg, enabled: packageEnabled(pkg, overrides) })),
    resources: mapResolvedPaths(resolved, overrides),
  };
}

export async function installPackage(
  source: string,
  options: { local?: boolean; onProgress?: (event: PiPackageProgressEvent) => void } = {},
): Promise<{ packages: PiPackageListEntry[]; resources: PiExtensionListResult["resources"] }> {
  const cwd = defaultCwd();
  const settingsManager = createSettingsManager(cwd);
  const manager = createPackageManager(cwd, settingsManager, options.onProgress);
  await manager.installAndPersist(source, { local: options.local });
  // Force re-read of settings on next list (`resolve` reads settingsManager
  // state which reflects the file we just persisted).
  return refreshListing(cwd);
}

export async function uninstallPackage(
  source: string,
  options: { local?: boolean; onProgress?: (event: PiPackageProgressEvent) => void } = {},
): Promise<{
  removed: boolean;
  packages: PiPackageListEntry[];
  resources: PiExtensionListResult["resources"];
}> {
  const cwd = defaultCwd();
  const settingsManager = createSettingsManager(cwd);
  const manager = createPackageManager(cwd, settingsManager, options.onProgress);
  const removed = await manager.removeAndPersist(source, { local: options.local });
  const fresh = await refreshListing(cwd);
  return { removed, ...fresh };
}

export async function updatePackages(
  source?: string,
  options: { onProgress?: (event: PiPackageProgressEvent) => void } = {},
): Promise<{ packages: PiPackageListEntry[]; resources: PiExtensionListResult["resources"] }> {
  const cwd = defaultCwd();
  const settingsManager = createSettingsManager(cwd);
  const manager = createPackageManager(cwd, settingsManager, options.onProgress);
  await manager.update(source);
  return refreshListing(cwd);
}

async function refreshListing(cwd: string) {
  const settingsManager = createSettingsManager(cwd);
  const manager = createPackageManager(cwd, settingsManager);
  const resolved = await manager.resolve();
  const overrides = readEnabledOverrides();
  return {
    packages: manager
      .listConfiguredPackages()
      .map((pkg) => ({ ...pkg, enabled: packageEnabled(pkg, overrides) })),
    resources: mapResolvedPaths(resolved, overrides),
  };
}

// ---------------------------------------------------------------------------
// Safety: validate a package looks like a Pi extension before install.
// ---------------------------------------------------------------------------

export type PiPackageValidation = {
  ok: boolean;
  reason?: string;
};

/**
 * Pre-flight check for `npm:` sources. For git/local sources we let the SDK
 * loader do the validation when the package is loaded (its error ends up in
 * `pi-sdk-runtime` diagnostics, which we already surface via setup-checks).
 */
export function validatePiPackageSpec(source: string): PiPackageValidation {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, reason: "Empty package source." };
  // The SDK accepts these prefixes; reject everything else early.
  if (
    !/^(npm:|git:|https?:\/\/|git\+ssh:|ssh:|file:|\.\/|\/|~\/)/.test(trimmed) &&
    !trimmed.startsWith("@") &&
    !/^[a-zA-Z][\w@.-]*$/.test(trimmed)
  ) {
    return {
      ok: false,
      reason:
        "Unsupported package spec. Use npm:<pkg>, git:<owner/repo>, https://…, ssh://…, ./local-path, or a bare npm name.",
    };
  }
  return { ok: true };
}
