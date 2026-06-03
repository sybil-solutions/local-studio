import {
  MCP_CATALOGUE,
  discoverMcpServers,
  findCatalogueEntry,
  isBuiltinServerId,
  removeServer,
  setServerEnabled,
  setServerTags,
  upsertServer,
  type McpServerDef,
} from "@/lib/agent/mcp";

export function mcpSnapshot(includeDisabled: boolean) {
  const all = discoverMcpServers();
  const servers = includeDisabled ? all : all.filter((row) => row.enabled);
  return { servers, plugins: servers, catalogue: MCP_CATALOGUE };
}

export function mcpBadRequest(error: string) {
  return { status: 400, payload: { error } };
}

export function handleMcpAction(body: Record<string, unknown> | null) {
  if (!body || typeof body.action !== "string") {
    return mcpBadRequest("Expected { action }.");
  }

  switch (body.action) {
    case "set_enabled": {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id || typeof body.enabled !== "boolean") {
        return mcpBadRequest("set_enabled requires { id, enabled }.");
      }
      setServerEnabled(id, body.enabled, isBuiltinServerId(id));
      return { status: 200, payload: mcpSnapshot(true) };
    }

    case "set_tags": {
      const id = typeof body.id === "string" ? body.id : "";
      const tags = parseTags(body.tags);
      if (!id) return mcpBadRequest("set_tags requires { id, tags }.");
      setServerTags(id, tags);
      return { status: 200, payload: mcpSnapshot(true) };
    }

    case "remove": {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return mcpBadRequest("remove requires { id }.");
      if (isBuiltinServerId(id)) {
        return mcpBadRequest("Builtin servers can't be removed, only disabled.");
      }
      removeServer(id);
      return { status: 200, payload: mcpSnapshot(true) };
    }

    case "add_from_catalogue": {
      const catalogueId = typeof body.catalogueId === "string" ? body.catalogueId : "";
      const entry = findCatalogueEntry(catalogueId);
      if (!entry) return mcpBadRequest("Unknown catalogue entry.");
      const env = { ...(entry.env ?? {}), ...(parseEnv(body.env) ?? {}) };
      const missing = (entry.requiredEnv ?? []).filter((key) => !env[key]?.trim());
      if (missing.length) {
        return mcpBadRequest(`Missing required values: ${missing.join(", ")}.`);
      }
      const extraArgs = parseArgs(body.args);
      const def: McpServerDef = {
        id: `mcp:${entry.name}:${Date.now().toString(36)}`,
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
        ...(entry.shortDescription ? { shortDescription: entry.shortDescription } : {}),
        category: entry.category,
        ...(entry.tags?.length ? { tags: entry.tags } : {}),
        transport: "stdio",
        command: entry.command,
        args: extraArgs ?? entry.args,
        ...(Object.keys(env).length ? { env } : {}),
      };
      upsertServer(def, "marketplace");
      return { status: 200, payload: mcpSnapshot(true) };
    }

    case "add_manual": {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const command = typeof body.command === "string" ? body.command.trim() : "";
      if (!name || !command) return mcpBadRequest("add_manual requires { name, command }.");
      const slug = slugify(name) || "server";
      const args = parseArgs(body.args);
      const env = parseEnv(body.env);
      const tags = parseTags(body.tags);
      const def: McpServerDef = {
        id:
          typeof body.id === "string" && body.id.trim()
            ? body.id.trim()
            : `mcp:${slug}:${Date.now().toString(36)}`,
        name: slug,
        displayName: name,
        ...(typeof body.description === "string" && body.description.trim()
          ? { description: body.description.trim() }
          : {}),
        category:
          typeof body.category === "string" && body.category.trim()
            ? body.category.trim()
            : "Custom",
        ...(tags.length ? { tags } : {}),
        transport: "stdio",
        command,
        ...(args ? { args } : {}),
        ...(env ? { env } : {}),
        ...(typeof body.cwd === "string" && body.cwd.trim() ? { cwd: body.cwd.trim() } : {}),
      };
      upsertServer(def, "manual");
      return { status: 200, payload: mcpSnapshot(true) };
    }

    default:
      return mcpBadRequest(`Unknown action: ${String(body.action)}.`);
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseArgs(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const args = value.filter((item): item is string => typeof item === "string");
  return args.length ? args : undefined;
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
