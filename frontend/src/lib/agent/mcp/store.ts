// Persistent MCP server registry.
//
// User-added (manual + from-catalogue) servers and per-server enable state live
// in `<dataDir>/mcp/servers.json`. On every write we ALSO materialize each
// server's `<dataDir>/mcp/<id>/.mcp.json` so the proven runtime path
// (pi-runtime-helpers `pluginMcpConfigs` → VLLM_STUDIO_MCP_PLUGIN_CONFIGS →
// mcp-plugin.ts) can launch it without any further translation.
//
// Builtins (computer-use, chrome) are NOT stored here — they come from
// `builtins.ts` and already own their bundled `.mcp.json`. Only their
// enable/disable state is overlaid via the `disabledBuiltins` set.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";
import type { McpServerDef, McpServerEntry } from "./types";

type StoreFile = {
  version: 1;
  servers: McpServerEntry[];
  /** Builtin server ids the user has explicitly disabled. */
  disabledBuiltins: string[];
};

const EMPTY_STORE: StoreFile = { version: 1, servers: [], disabledBuiltins: [] };

function mcpRoot(): string {
  const root = path.join(resolveDataDir(), "mcp");
  mkdirSync(root, { recursive: true });
  return root;
}

function storeFilePath(): string {
  return path.join(mcpRoot(), "servers.json");
}

function readStore(): StoreFile {
  try {
    const raw = readFileSync(storeFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return {
      version: 1,
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      disabledBuiltins: Array.isArray(parsed.disabledBuiltins) ? parsed.disabledBuiltins : [],
    };
  } catch {
    return { ...EMPTY_STORE };
  }
}

function writeStore(store: StoreFile): void {
  writeFileSync(storeFilePath(), JSON.stringify(store, null, 2), "utf8");
  // Re-materialize every stored server's .mcp.json so the runtime sees the
  // current command/args/env. Removed servers' stale dirs are harmless (the
  // runtime only loads configs referenced by the selected refs).
  for (const entry of store.servers) materializeServerConfig(entry.def);
}

/** Absolute path to the materialized `.mcp.json` for a stored server id. */
export function serverConfigPath(id: string): string {
  return path.join(mcpRoot(), safeDirName(id), ".mcp.json");
}

/** Absolute path to a stored server's skill dir (if it ships one on disk). */
function serverDir(id: string): string {
  return path.join(mcpRoot(), safeDirName(id));
}

function safeDirName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function materializeServerConfig(def: McpServerDef): void {
  const dir = serverDir(def.id);
  mkdirSync(dir, { recursive: true });
  const config = {
    mcpServers: {
      [def.name]: {
        command: def.command,
        ...(def.args && def.args.length ? { args: def.args } : {}),
        ...(def.env && Object.keys(def.env).length ? { env: def.env } : {}),
        ...(def.cwd ? { cwd: def.cwd } : {}),
      },
    },
  };
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify(config, null, 2), "utf8");
}

/** All user-added stored servers (manual + from-catalogue), with state. */
export function listStoredServers(): McpServerEntry[] {
  return readStore().servers;
}

/** Builtin ids the user has disabled. */
export function disabledBuiltinIds(): Set<string> {
  return new Set(readStore().disabledBuiltins);
}

/**
 * Add or update a user server. Always (re)materializes its `.mcp.json`. Returns
 * the stored entry. `id` collision overwrites in place (edit).
 */
export function upsertServer(def: McpServerDef, source: "manual" | "marketplace"): McpServerEntry {
  const store = readStore();
  const entry: McpServerEntry = { def, enabled: true, source };
  const index = store.servers.findIndex((existing) => existing.def.id === def.id);
  if (index >= 0) {
    // Preserve prior enabled state on edit.
    entry.enabled = store.servers[index].enabled;
    store.servers[index] = entry;
  } else {
    store.servers.push(entry);
  }
  writeStore(store);
  return entry;
}

/** Remove a stored server by id. Builtins cannot be removed (only disabled). */
export function removeServer(id: string): boolean {
  const store = readStore();
  const next = store.servers.filter((entry) => entry.def.id !== id);
  if (next.length === store.servers.length) return false;
  store.servers = next;
  writeStore(store);
  return true;
}

/**
 * Toggle enable state for any server id. For a stored server this flips its
 * `enabled` flag; for a builtin id it adds/removes from `disabledBuiltins`.
 */
export function setServerEnabled(id: string, enabled: boolean, isBuiltin: boolean): void {
  const store = readStore();
  if (isBuiltin) {
    const set = new Set(store.disabledBuiltins);
    if (enabled) set.delete(id);
    else set.add(id);
    store.disabledBuiltins = [...set];
    writeStore(store);
    return;
  }
  const entry = store.servers.find((existing) => existing.def.id === id);
  if (!entry) return;
  entry.enabled = enabled;
  writeStore(store);
}
