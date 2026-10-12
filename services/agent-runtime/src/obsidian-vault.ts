import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Which Obsidian vaults exist on this machine, if any.
//
// A vault is a plain folder of markdown files, so the obsidian extension needs
// no Obsidian process, no API and no community plugin — but it does need to
// know WHICH folders are vaults, and only Obsidian itself knows that. It keeps
// the answer in obsidian.json: a `vaults` map of an opaque id to
// `{ path, ts, open }`. That file is the whole discovery mechanism.
//
// Presence of at least one vault is the load gate, on the same principle as the
// `gh` binary gating the github extension: a machine that has never opened
// Obsidian should not be shown seven tools for reading notes it does not have.
// Being *readable* is a separate question the extension answers at call time,
// because a vault directory can be on a volume that is not mounted right now.
//
// Nothing is cached. The file is ~100 bytes and this runs once per session
// start, and not caching means a vault created while the app is running shows
// up in the next session instead of after a restart.

export type ObsidianVault = {
  /** Absolute path to the vault directory. */
  path: string;
  /** The folder name, which is what Obsidian shows and what users call it. */
  name: string;
  /** True when this vault is open in Obsidian right now. */
  open: boolean;
  /** When Obsidian last opened it, ISO-8601, or null when it never recorded one. */
  lastOpened: string | null;
};

type VaultRecord = { path?: unknown; ts?: unknown; open?: unknown };

/**
 * Where Obsidian keeps obsidian.json, per platform. The override exists for
 * tests and for the rare install that relocates its config; everything else
 * uses the platform default.
 */
function configCandidates(): string[] {
  const override = process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG?.trim();
  if (override) return [override];
  const home = homedir();
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "obsidian", "obsidian.json")];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "obsidian", "obsidian.json")];
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [
    path.join(configHome, "obsidian", "obsidian.json"),
    // Flatpak keeps its own config root, and it is how a lot of Linux users
    // install Obsidian.
    path.join(home, ".var", "app", "md.obsidian.Obsidian", "config", "obsidian", "obsidian.json"),
  ];
}

/** The obsidian.json this machine actually has, or null when Obsidian is absent. */
export function obsidianConfigPathSync(): string | null {
  return configCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

function toVault(record: VaultRecord): ObsidianVault | null {
  const vaultPath = typeof record.path === "string" ? record.path.trim() : "";
  if (!vaultPath) return null;
  // A vault whose folder was deleted or lives on an unmounted volume stays in
  // obsidian.json forever. Listing it would hand the model a path every call
  // then fails on.
  try {
    if (!statSync(vaultPath).isDirectory()) return null;
  } catch {
    return null;
  }
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : null;
  return {
    path: vaultPath,
    name: path.basename(vaultPath),
    open: record.open === true,
    lastOpened: ts === null ? null : new Date(ts).toISOString(),
  };
}

/**
 * Every vault Obsidian knows about, best default first: the one open right now,
 * then the most recently opened. "Most recent" is the only defensible default —
 * it is the vault the user was last looking at.
 */
export function listObsidianVaultsSync(): ObsidianVault[] {
  const configPath = obsidianConfigPathSync();
  if (!configPath) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }
  const vaults = (parsed as { vaults?: unknown })?.vaults;
  if (!vaults || typeof vaults !== "object") return [];
  return Object.values(vaults as Record<string, VaultRecord>)
    .map(toVault)
    .filter((vault): vault is ObsidianVault => vault !== null)
    .sort((a, b) => {
      if (a.open !== b.open) return a.open ? -1 : 1;
      return (b.lastOpened ?? "").localeCompare(a.lastOpened ?? "");
    });
}

export function hasObsidianVaultSync(): boolean {
  return listObsidianVaultsSync().length > 0;
}
