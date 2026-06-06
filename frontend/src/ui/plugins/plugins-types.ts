export type McpServer = {
  id: string;
  name: string;
  displayName?: string;
  source?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  description?: string;
  shortDescription?: string;
  category?: string;
  tags?: string[];
  skillPath?: string;
  mcpConfigPath?: string;
};

export type CatalogueEntry = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  shortDescription?: string;
  category: string;
  command: string;
  args?: string[];
  tags?: string[];
  registry?: "curated" | "official" | "custom";
  registryName?: string;
  registrySourceId?: string;
  registryUrl?: string;
  repositoryUrl?: string;
  attributes?: string[];
  installable?: boolean;
  unsupportedReason?: string;
  env?: Record<string, string>;
  requiredEnv?: string[];
  requiresTargetArg?: boolean;
  homepage?: string;
};

export type RegistrySource = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  builtIn?: boolean;
};

export type ServersPayload = {
  servers?: McpServer[];
  plugins?: McpServer[];
  catalogue?: CatalogueEntry[];
  error?: string;
};

export type RegistryPayload = {
  source: "official";
  sourceUrl: string;
  registries?: RegistrySource[];
  entries: CatalogueEntry[];
  warnings?: string[];
  error?: string;
};
