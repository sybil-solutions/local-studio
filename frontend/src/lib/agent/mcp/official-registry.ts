import type { McpCatalogueEntry } from "./types";
import type { McpRegistrySource } from "./registry-sources";

const DEFAULT_LIMIT = 24;
const TIMEOUT_MS = 10_000;

type RegistryInput = {
  default?: string;
  description?: string;
  format?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  name?: string;
  type?: string;
  value?: string;
};

type RegistryPackage = {
  environmentVariables?: RegistryInput[] | null;
  identifier: string;
  packageArguments?: RegistryInput[] | null;
  registryType: string;
  runtimeArguments?: RegistryInput[] | null;
  runtimeHint?: string;
  transport: { type: string; url?: string };
  version?: string;
};

type RegistryServer = {
  description: string;
  name: string;
  packages?: RegistryPackage[] | null;
  remotes?: Array<{ type: string; url?: string }> | null;
  repository?: { source?: string; subfolder?: string; url?: string };
  title?: string;
  version: string;
  websiteUrl?: string;
};

type RegistryServerRow = {
  server: RegistryServer;
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: {
      isLatest?: boolean;
      status?: string;
    };
  };
};

type RegistryResponse = {
  servers?: RegistryServerRow[];
};

export type RegistrySearchResult = {
  sourceUrl: string;
  entries: McpCatalogueEntry[];
};

export async function searchOfficialCompatibleRegistry({
  source,
  query,
  limit = DEFAULT_LIMIT,
}: {
  source: McpRegistrySource;
  query?: string;
  limit?: number;
}): Promise<RegistrySearchResult> {
  const url = new URL(`${source.url.replace(/\/+$/, "")}/v0/servers`);
  const trimmed = query?.trim();
  if (trimmed) url.searchParams.set("search", trimmed);
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 100)));

  const response = await fetchWithTimeout(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${source.name} returned ${response.status}.`);
  const payload = (await response.json()) as RegistryResponse;
  return {
    sourceUrl: url.toString(),
    entries: (payload.servers ?? []).map((row) => toCatalogueEntry(row, source)),
  };
}

function toCatalogueEntry(row: RegistryServerRow, source: McpRegistrySource): McpCatalogueEntry {
  const server = row.server;
  const selectedPackage = selectInstallablePackage(server.packages ?? []);
  const launch = selectedPackage ? launchFromPackage(selectedPackage) : null;
  const remoteOnly = !selectedPackage && Boolean(server.remotes?.length);
  const registry = source.builtIn ? "official" : "custom";

  return {
    id: `${registry}:${source.id}:${server.name}:${server.version}`,
    name: server.name,
    displayName: server.title || server.name,
    description: server.description || "MCP server from a compatible registry.",
    shortDescription: server.description?.slice(0, 96),
    category: selectedPackage ? categoryFromPackage(selectedPackage) : "Remote",
    command: launch?.command ?? "",
    args: launch?.args ?? [],
    tags: [
      registry,
      ...packageTagsFor(selectedPackage, remoteOnly),
      ...repositorySourceTags(server.repository),
    ],
    registry,
    registryName: source.name,
    registrySourceId: source.id,
    registryUrl: versionUrl(source.url, server.name, server.version),
    repositoryUrl: server.repository?.url,
    attributes: registryAttributes(row, source, selectedPackage, remoteOnly),
    env: selectedPackage ? envDefaults(selectedPackage.environmentVariables ?? []) : undefined,
    requiredEnv: selectedPackage
      ? requiredEnvironmentNames(selectedPackage.environmentVariables ?? [])
      : [],
    homepage: homepageForServer(server, source),
    installable: Boolean(launch),
    unsupportedReason: unsupportedReasonFor(launch, remoteOnly),
  };
}

function registryAttributes(
  row: RegistryServerRow,
  source: McpRegistrySource,
  selectedPackage: RegistryPackage | null,
  remoteOnly: boolean,
): string[] {
  const officialStatus = row._meta?.["io.modelcontextprotocol.registry/official"]?.status;
  return [
    `registry:${source.name}`,
    `version:${row.server.version}`,
    ...(officialStatus ? [`status:${officialStatus}`] : []),
    ...(selectedPackage ? [`package:${selectedPackage.registryType}`] : []),
    ...(remoteOnly ? ["remote-only"] : []),
  ];
}

function packageTagsFor(selectedPackage: RegistryPackage | null, remoteOnly: boolean): string[] {
  if (selectedPackage) return [selectedPackage.registryType, selectedPackage.transport.type];
  return remoteOnly ? ["remote"] : ["metadata"];
}

function repositorySourceTags(repository: RegistryServer["repository"]): string[] {
  return repository?.source ? [repository.source] : [];
}

function requiredEnvironmentNames(inputs: RegistryInput[]): string[] {
  return inputs
    .filter((entry) => entry.isRequired && entry.name)
    .map((entry) => String(entry.name));
}

function homepageForServer(server: RegistryServer, source: McpRegistrySource): string {
  return server.websiteUrl ?? server.repository?.url ?? source.url;
}

function unsupportedReasonFor(
  launch: { command: string; args: string[] } | null,
  remoteOnly: boolean,
): string | undefined {
  if (launch) return undefined;
  return remoteOnly
    ? "Remote MCP transports are listed, but this app currently installs stdio servers."
    : "No supported stdio package is listed for this server.";
}

function selectInstallablePackage(packages: RegistryPackage[]): RegistryPackage | null {
  return packages.find((pkg) => pkg.transport?.type === "stdio" && canLaunchPackage(pkg)) ?? null;
}

function canLaunchPackage(pkg: RegistryPackage): boolean {
  const runtime = runtimeForPackage(pkg);
  return Boolean(runtime && ["npx", "uvx", "docker"].includes(runtime));
}

function launchFromPackage(pkg: RegistryPackage): { command: string; args: string[] } | null {
  const command = runtimeForPackage(pkg);
  if (!command) return null;
  const runtimeArgs = inputsToArgs(pkg.runtimeArguments ?? []);
  const packageArgs = inputsToArgs(pkg.packageArguments ?? []);
  if (command === "npx") {
    const args = runtimeArgs.includes("-y") ? [...runtimeArgs] : ["-y", ...runtimeArgs];
    return { command, args: [...args, packageSpec(pkg, "@"), ...packageArgs] };
  }
  if (command === "uvx") {
    return { command, args: [...runtimeArgs, packageSpec(pkg, "=="), ...packageArgs] };
  }
  if (command === "docker") {
    const args = runtimeArgs.length ? runtimeArgs : ["-i", "--rm"];
    return { command, args: ["run", ...args, pkg.identifier, ...packageArgs] };
  }
  return null;
}

function runtimeForPackage(pkg: RegistryPackage): string {
  const hinted = pkg.runtimeHint?.trim();
  if (hinted) return hinted;
  if (pkg.registryType === "npm") return "npx";
  if (pkg.registryType === "pypi") return "uvx";
  if (pkg.registryType === "oci") return "docker";
  return "";
}

function packageSpec(pkg: RegistryPackage, separator: "@" | "=="): string {
  if (!pkg.version || pkg.version === "latest") return pkg.identifier;
  return `${pkg.identifier}${separator}${pkg.version}`;
}

function inputsToArgs(inputs: RegistryInput[]): string[] {
  return inputs.flatMap((input) => {
    const value = input.value ?? input.default ?? "";
    if (input.type === "named") {
      if (!input.name) return value ? [value] : [];
      if (input.format === "boolean") return value === "true" ? [input.name] : [];
      return value ? [input.name, value] : [];
    }
    return value ? [value] : [];
  });
}

function envDefaults(inputs: RegistryInput[]): Record<string, string> | undefined {
  const entries = inputs
    .filter((entry) => entry.name)
    .map((entry) => [String(entry.name), entry.value ?? entry.default ?? ""]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function categoryFromPackage(pkg: RegistryPackage): string {
  if (pkg.registryType === "npm") return "Node";
  if (pkg.registryType === "pypi") return "Python";
  if (pkg.registryType === "oci") return "Container";
  return "Package";
}

function versionUrl(baseUrl: string, serverName: string, version: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v0/servers/${encodeURIComponent(
    serverName,
  )}/versions/${encodeURIComponent(version || "latest")}`;
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
