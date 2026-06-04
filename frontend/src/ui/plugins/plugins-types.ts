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
  registry?: "curated" | "glama";
  registryUrl?: string;
  repositoryUrl?: string;
  attributes?: string[];
  env?: Record<string, string>;
  requiredEnv?: string[];
  homepage?: string;
};

export type ServersPayload = {
  servers?: McpServer[];
  plugins?: McpServer[];
  catalogue?: CatalogueEntry[];
  error?: string;
};

export type RegistryPayload = {
  source: "glama";
  sourceUrl: string;
  entries: CatalogueEntry[];
  error?: string;
};
