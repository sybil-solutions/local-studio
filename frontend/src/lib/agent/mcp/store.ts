// Persistent MCP server registry.
//
// User-added (manual + from-catalogue) servers and per-server enable state live
// in `<dataDir>/mcp/servers.json`. On every write we ALSO materialize each
// server's `<dataDir>/mcp/<id>/.mcp.json` so the proven runtime path
// (pi-runtime-helpers `pluginMcpConfigs` → VLLM_STUDIO_MCP_PLUGIN_CONFIGS →
// mcp-plugin.ts) can launch it without any further translation.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";
import type { McpServerDef, McpServerEntry } from "./types";

type StoreFile = {
  version: 1;
  servers: McpServerEntry[];
  /** Legacy field retained so older stores continue to parse cleanly. */
  disabledBuiltins: string[];
  /** User labels for stored servers. */
  serverTags: Record<string, string[]>;
};

const EMPTY_STORE: StoreFile = { version: 1, servers: [], disabledBuiltins: [], serverTags: {} };

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
      serverTags: isRecord(parsed.serverTags) ? normalizeTagsRecord(parsed.serverTags) : {},
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

/** Remove a stored server by id. */
export function removeServer(id: string): boolean {
  const store = readStore();
  const next = store.servers.filter((entry) => entry.def.id !== id);
  if (next.length === store.servers.length) return false;
  store.servers = next;
  writeStore(store);
  return true;
}

/** Toggle enable state for a stored server id. */
export function setServerEnabled(id: string, enabled: boolean): void {
  const store = readStore();
  const entry = store.servers.find((existing) => existing.def.id === id);
  if (!entry) return;
  entry.enabled = enabled;
  writeStore(store);
}

export function setServerTags(id: string, tags: string[]): void {
  const store = readStore();
  const normalized = normalizeTags(tags);
  if (normalized.length) {
    store.serverTags[id] = normalized;
  } else {
    delete store.serverTags[id];
  }
  const entry = store.servers.find((existing) => existing.def.id === id);
  if (entry) {
    if (normalized.length) entry.def.tags = normalized;
    else delete entry.def.tags;
  }
  writeStore(store);
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = tag
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (normalized) seen.add(normalized);
  }
  return [...seen].slice(0, 8);
}

function normalizeTagsRecord(value: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (Array.isArray(raw))
      out[key] = normalizeTags(raw.filter((item): item is string => typeof item === "string"));
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
