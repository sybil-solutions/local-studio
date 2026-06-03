import type { McpCatalogueEntry } from "./types";

const GLAMA_SERVERS_ENDPOINT = "https://glama.ai/api/mcp/v1/servers";
const DEFAULT_LIMIT = 24;
const TIMEOUT_MS = 10_000;

type GlamaServer = {
  attributes?: string[];
  description?: string;
  environmentVariablesJsonSchema?: {
    properties?: Record<string, { description?: string; type?: string }>;
    required?: string[];
  };
  id: string;
  name: string;
  namespace?: string;
  repository?: { url?: string };
  slug?: string;
  spdxLicense?: { name?: string; url?: string } | null;
  tools?: unknown[];
  url?: string;
};

type GlamaResponse = {
  servers?: GlamaServer[];
};

export type GlamaRegistryPayload = {
  source: "glama";
  sourceUrl: string;
  entries: McpCatalogueEntry[];
};

export async function searchGlamaRegistry({
  query,
  limit = DEFAULT_LIMIT,
}: {
  query?: string;
  limit?: number;
}): Promise<GlamaRegistryPayload> {
  const url = new URL(GLAMA_SERVERS_ENDPOINT);
  const trimmed = query?.trim();
  if (trimmed) url.searchParams.set("query", trimmed);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 60)));

  const response = await fetchWithTimeout(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Glama returned ${response.status}.`);
  const payload = (await response.json()) as GlamaResponse;
  return {
    source: "glama",
    sourceUrl: url.toString(),
    entries: (payload.servers ?? []).map(toCatalogueEntry),
  };
}

function toCatalogueEntry(server: GlamaServer): McpCatalogueEntry {
  const env = envDefaults(server);
  const requiredEnv = server.environmentVariablesJsonSchema?.required ?? [];
  const attributes = server.attributes ?? [];
  const official = attributes.some((attribute) => attribute === "author:official");
  const remote = attributes.some((attribute) => attribute === "hosting:remote-capable");
  const tags = [
    "glama",
    official ? "official" : "community",
    remote ? "remote" : "local",
    ...(server.spdxLicense?.name ? ["licensed"] : []),
  ];

  return {
    id: `glama:${server.id}`,
    name: server.slug || slugify(server.name),
    displayName: server.name,
    description: server.description || "Validated MCP server indexed by Glama.",
    shortDescription: server.description?.slice(0, 96),
    category: categoryFromAttributes(attributes),
    command: "",
    args: [],
    tags,
    registry: "glama",
    registryUrl: server.url,
    repositoryUrl: server.repository?.url,
    attributes,
    env,
    requiredEnv,
    homepage: server.url,
  };
}

function envDefaults(server: GlamaServer): Record<string, string> | undefined {
  const properties = server.environmentVariablesJsonSchema?.properties ?? {};
  const keys = Object.keys(properties);
  if (!keys.length) return undefined;
  return Object.fromEntries(keys.map((key) => [key, ""]));
}

function categoryFromAttributes(attributes: string[]): string {
  if (attributes.includes("author:official")) return "Official";
  if (attributes.includes("hosting:remote-capable")) return "Remote";
  return "Community";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
