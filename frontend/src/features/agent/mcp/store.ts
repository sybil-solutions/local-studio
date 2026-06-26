import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";
import type {
  McpConfigFile,
  McpConfigServer,
  McpServerDef,
  McpServerEntry,
  McpServerSource,
} from "@/features/agent/mcp/types";

type LegacyStoreFile = {
  servers?: McpServerEntry[];
  serverTags?: Record<string, string[]>;
};

const EMPTY_CONFIG: McpConfigFile = { version: 1, mcp_servers: {} };

function mcpRoot(): string {
  const root = path.join(resolveDataDir(), "mcp");
  mkdirSync(root, { recursive: true });
  return root;
}

export function mcpConfigPath(): string {
  return path.join(mcpRoot(), "mcp.json");
}

function legacyStorePath(): string {
  return path.join(mcpRoot(), "servers.json");
}

function safeDirName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/** Absolute path to the materialized `.mcp.json` for a stored server id. */
export function serverConfigPath(id: string): string {
  return path.join(mcpRoot(), safeDirName(id), ".mcp.json");
}

function serverDir(id: string): string {
  return path.join(mcpRoot(), safeDirName(id));
}

export function readMcpConfigText(): string {
  return JSON.stringify(readConfig(), null, 2);
}

export function saveMcpConfigText(text: string): void {
  const parsed = normalizeConfig(JSON.parse(text) as Partial<McpConfigFile>);
  writeConfig(parsed);
}

function readConfig(): McpConfigFile {
  try {
    return normalizeConfig(
      JSON.parse(readFileSync(mcpConfigPath(), "utf8")) as Partial<McpConfigFile>,
    );
  } catch {
    const migrated = migrateLegacyStore();
    if (Object.keys(migrated.mcp_servers).length) {
      writeConfig(migrated);
      return migrated;
    }
    return { ...EMPTY_CONFIG };
  }
}

function writeConfig(config: McpConfigFile): void {
  writeFileSync(mcpConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  for (const entry of configToEntries(config)) materializeServerConfig(entry.def);
}

function normalizeConfig(value: Partial<McpConfigFile>): McpConfigFile {
  const servers =
    value.mcp_servers && typeof value.mcp_servers === "object" ? value.mcp_servers : {};
  const next: McpConfigFile = { version: 1, mcp_servers: {} };
  for (const [name, raw] of Object.entries(servers)) {
    const server = normalizeServer(raw);
    if (server?.command) next.mcp_servers[slugify(name)] = server;
  }
  return next;
}

function normalizeServer(value: unknown): McpConfigServer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const command = stringField(record, "command");
  if (!command) return null;
  return {
    command,
    ...(stringArrayField(record, "args") ? { args: stringArrayField(record, "args") } : {}),
    ...(stringField(record, "cwd") ? { cwd: stringField(record, "cwd") } : {}),
    ...(recordField(record, "env") ? { env: recordField(record, "env") } : {}),
    ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
    ...(stringField(record, "displayName")
      ? { displayName: stringField(record, "displayName") }
      : {}),
    ...(stringField(record, "description")
      ? { description: stringField(record, "description") }
      : {}),
    ...(stringField(record, "shortDescription")
      ? { shortDescription: stringField(record, "shortDescription") }
      : {}),
    ...(stringField(record, "category") ? { category: stringField(record, "category") } : {}),
    ...(stringArrayField(record, "tags")
      ? { tags: normalizeTags(stringArrayField(record, "tags") ?? []) }
      : {}),
    ...(record.source === "curated" || record.source === "manual"
      ? { source: record.source as McpServerSource }
      : {}),
    ...(toolSelection(record.tools) ? { tools: toolSelection(record.tools) } : {}),
  };
}

function migrateLegacyStore(): McpConfigFile {
  try {
    const legacy = JSON.parse(readFileSync(legacyStorePath(), "utf8")) as LegacyStoreFile;
    const config: McpConfigFile = { version: 1, mcp_servers: {} };
    for (const entry of legacy.servers ?? []) {
      const def = entry.def;
      const tags = legacy.serverTags?.[def.id] ?? def.tags;
      config.mcp_servers[def.name] = {
        command: def.command,
        ...(def.args?.length ? { args: def.args } : {}),
        ...(def.cwd ? { cwd: def.cwd } : {}),
        ...(def.env && Object.keys(def.env).length ? { env: def.env } : {}),
        enabled: entry.enabled,
        ...(def.displayName ? { displayName: def.displayName } : {}),
        ...(def.description ? { description: def.description } : {}),
        ...(def.shortDescription ? { shortDescription: def.shortDescription } : {}),
        ...(def.category ? { category: def.category } : {}),
        ...(tags?.length ? { tags } : {}),
        source: entry.source === "manual" ? "manual" : "curated",
      };
    }
    return config;
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

function configToEntries(config: McpConfigFile): McpServerEntry[] {
  return Object.entries(config.mcp_servers).map(([name, server]) => {
    const source = server.source ?? "manual";
    return {
      enabled: server.enabled !== false,
      source,
      def: {
        id: `mcp:${name}`,
        name,
        ...(server.displayName ? { displayName: server.displayName } : {}),
        ...(server.description ? { description: server.description } : {}),
        ...(server.shortDescription ? { shortDescription: server.shortDescription } : {}),
        ...(server.category ? { category: server.category } : {}),
        ...(server.tags?.length ? { tags: server.tags } : {}),
        transport: "stdio",
        command: server.command,
        ...(server.args?.length ? { args: server.args } : {}),
        ...(server.cwd ? { cwd: server.cwd } : {}),
        ...(server.env && Object.keys(server.env).length ? { env: server.env } : {}),
        ...(server.tools ? { tools: server.tools } : {}),
      },
    };
  });
}

function materializeServerConfig(def: McpServerDef): void {
  const dir = serverDir(def.id);
  mkdirSync(dir, { recursive: true });
  const config = {
    mcpServers: {
      [def.name]: {
        command: def.command,
        ...(def.args?.length ? { args: def.args } : {}),
        ...(def.env && Object.keys(def.env).length ? { env: def.env } : {}),
        ...(def.cwd ? { cwd: def.cwd } : {}),
        ...(def.tools ? { tools: def.tools } : {}),
      },
    },
  };
  writeFileSync(path.join(dir, ".mcp.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function listStoredServers(): McpServerEntry[] {
  return configToEntries(readConfig());
}

export function upsertServer(def: McpServerDef, source: McpServerSource): McpServerEntry {
  const config = readConfig();
  const prior = config.mcp_servers[def.name];
  config.mcp_servers[def.name] = {
    command: def.command,
    ...(def.args?.length ? { args: def.args } : {}),
    ...(def.cwd ? { cwd: def.cwd } : {}),
    ...(def.env && Object.keys(def.env).length ? { env: def.env } : {}),
    enabled: prior?.enabled ?? true,
    ...(def.displayName ? { displayName: def.displayName } : {}),
    ...(def.description ? { description: def.description } : {}),
    ...(def.shortDescription ? { shortDescription: def.shortDescription } : {}),
    ...(def.category ? { category: def.category } : {}),
    ...(def.tags?.length ? { tags: normalizeTags(def.tags) } : {}),
    source,
    ...(def.tools ? { tools: def.tools } : {}),
  };
  writeConfig(config);
  return configToEntries(config).find((entry) => entry.def.name === def.name)!;
}

export function removeServer(id: string): boolean {
  const config = readConfig();
  const name = id.replace(/^mcp:/, "");
  if (!config.mcp_servers[name]) return false;
  delete config.mcp_servers[name];
  writeConfig(config);
  return true;
}

export function setServerEnabled(id: string, enabled: boolean): void {
  const config = readConfig();
  const server = config.mcp_servers[id.replace(/^mcp:/, "")];
  if (!server) return;
  server.enabled = enabled;
  writeConfig(config);
}

export function setServerTags(id: string, tags: string[]): void {
  const config = readConfig();
  const server = config.mcp_servers[id.replace(/^mcp:/, "")];
  if (!server) return;
  const normalized = normalizeTags(tags);
  if (normalized.length) server.tags = normalized;
  else delete server.tags;
  writeConfig(config);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && Boolean(item));
  return strings.length ? strings : undefined;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [envKey, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[envKey] = raw;
  }
  return Object.keys(out).length ? out : undefined;
}

function toolSelection(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const include = stringArrayField(record, "include");
  const exclude = stringArrayField(record, "exclude");
  const resources = typeof record.resources === "boolean" ? record.resources : undefined;
  const prompts = typeof record.prompts === "boolean" ? record.prompts : undefined;
  return include || exclude || resources !== undefined || prompts !== undefined
    ? {
        ...(include ? { include } : {}),
        ...(exclude ? { exclude } : {}),
        ...(resources !== undefined ? { resources } : {}),
        ...(prompts !== undefined ? { prompts } : {}),
      }
    : undefined;
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

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "server"
  );
}
