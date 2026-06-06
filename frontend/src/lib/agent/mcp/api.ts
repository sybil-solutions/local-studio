import {
  MCP_CATALOGUE,
  discoverMcpServers,
  findCatalogueEntry,
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

function mcpOk() {
  return { status: 200, payload: mcpSnapshot(true) };
}

export function handleMcpAction(body: Record<string, unknown> | null) {
  if (!body || typeof body.action !== "string") {
    return mcpBadRequest("Expected { action }.");
  }

  switch (body.action) {
    case "set_enabled":
      return handleSetEnabled(body);
    case "set_tags":
      return handleSetTags(body);
    case "remove":
      return handleRemove(body);
    case "add_from_catalogue":
      return handleAddFromCatalogue(body);
    case "add_manual":
      return handleAddManual(body);
    default:
      return mcpBadRequest(`Unknown action: ${String(body.action)}.`);
  }
}

function handleSetEnabled(body: Record<string, unknown>) {
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || typeof body.enabled !== "boolean") {
    return mcpBadRequest("set_enabled requires { id, enabled }.");
  }
  setServerEnabled(id, body.enabled);
  return mcpOk();
}

function handleSetTags(body: Record<string, unknown>) {
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return mcpBadRequest("set_tags requires { id, tags }.");
  setServerTags(id, parseTags(body.tags));
  return mcpOk();
}

function handleRemove(body: Record<string, unknown>) {
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return mcpBadRequest("remove requires { id }.");
  removeServer(id);
  return mcpOk();
}

function handleAddFromCatalogue(body: Record<string, unknown>) {
  const catalogueId = typeof body.catalogueId === "string" ? body.catalogueId : "";
  const entry = findCatalogueEntry(catalogueId);
  if (!entry) return mcpBadRequest("Unknown catalogue entry.");
  const env = { ...(entry.env ?? {}), ...(parseEnv(body.env) ?? {}) };
  const missing = (entry.requiredEnv ?? []).filter((key) => !env[key]?.trim());
  if (missing.length) return mcpBadRequest(`Missing required values: ${missing.join(", ")}.`);
  const extraArgs = parseArgs(body.args);
  const template = entry.args ?? [];
  if (extraArgs && !argsStartWithTemplate(extraArgs, template)) {
    return mcpBadRequest(`${entry.displayName} launch arguments must keep the reviewed prefix.`);
  }
  const args = extraArgs ?? entry.args;
  if (entry.requiresTargetArg && !hasExplicitTargetArg(args, entry.args)) {
    return mcpBadRequest(`${entry.displayName} requires a local path argument.`);
  }
  upsertServer(
    {
      id: `mcp:${entry.name}:${Date.now().toString(36)}`,
      name: entry.name,
      displayName: entry.displayName,
      description: entry.description,
      ...(entry.shortDescription ? { shortDescription: entry.shortDescription } : {}),
      category: entry.category,
      ...(entry.tags?.length ? { tags: entry.tags } : {}),
      transport: "stdio",
      command: entry.command,
      args,
      ...(Object.keys(env).length ? { env } : {}),
    },
    "marketplace",
  );
  return mcpOk();
}

function handleAddManual(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!name || !command) return mcpBadRequest("add_manual requires { name, command }.");
  upsertServer(manualServerDef(body, name, command), "manual");
  return mcpOk();
}

function manualServerDef(
  body: Record<string, unknown>,
  name: string,
  command: string,
): McpServerDef {
  const slug = slugify(name) || "server";
  const args = parseArgs(body.args);
  const env = parseEnv(body.env);
  const tags = parseTags(body.tags);
  return {
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
      typeof body.category === "string" && body.category.trim() ? body.category.trim() : "Custom",
    ...(tags.length ? { tags } : {}),
    transport: "stdio",
    command,
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(typeof body.cwd === "string" && body.cwd.trim() ? { cwd: body.cwd.trim() } : {}),
  };
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

function argsStartWithTemplate(args: string[], template: string[]): boolean {
  if (!template.length) return true;
  if (args.length < template.length) return false;
  return template.every((part, index) => args[index] === part);
}

function hasExplicitTargetArg(args: string[] | undefined, template: string[] | undefined): boolean {
  if (!args?.length) return false;
  const templateLength = template?.length ?? 0;
  const targets = args.slice(templateLength).filter((arg) => {
    const value = arg.trim();
    return value && !value.startsWith("-");
  });
  return targets.length > 0 && targets.every(isExplicitLocalPathArg);
}

function isExplicitLocalPathArg(arg: string): boolean {
  const value = arg.trim();
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
