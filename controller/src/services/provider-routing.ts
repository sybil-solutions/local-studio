import type { ProviderConfig } from "../config/persisted-config";

export const DEFAULT_CHAT_PROVIDER = "openai";

export const WELL_KNOWN_PROVIDERS: Record<string, { name: string; baseUrl: string }> = {
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com" },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com" },
};

export interface ParsedProviderModel {
  provider: string;
  modelId: string;
}

export interface ProviderRouteConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ControllerProviderRoutingConfig {
  providers?: ProviderConfig[];
}

export const parseProviderModel = (rawModel: string): ParsedProviderModel => {
  const trimmed = rawModel.trim();
  if (!trimmed) {
    return { provider: DEFAULT_CHAT_PROVIDER, modelId: "" };
  }

  const delimiter = trimmed.indexOf("/");
  if (delimiter > 0 && delimiter < trimmed.length - 1) {
    const provider = trimmed.slice(0, delimiter).trim();
    const modelId = trimmed.slice(delimiter + 1).trim();
    if (modelId.length > 0) {
      return { provider: provider || DEFAULT_CHAT_PROVIDER, modelId };
    }
  }

  return { provider: DEFAULT_CHAT_PROVIDER, modelId: trimmed };
};

export const normalizeModelForRequest = (provider: string, modelId: string): string =>
  provider === DEFAULT_CHAT_PROVIDER ? modelId : `${provider}/${modelId}`;

export const resolveConfiguredProviderConfig = (
  providerId: string,
  providers: ProviderConfig[] = []
): ProviderRouteConfig | null => {
  const match = providers.find((p) => p.id.toLowerCase() === providerId.toLowerCase() && p.enabled);
  if (!match || !match.api_key) return null;
  return { baseUrl: match.base_url, apiKey: match.api_key };
};

export const resolveProviderConfig = (
  provider: string,
  config: ControllerProviderRoutingConfig = {}
): ProviderRouteConfig | null => {
  return resolveConfiguredProviderConfig(provider, config.providers);
};

export interface ProviderCompatMetadata {
  supportsDeveloperRole: boolean;
  supportsImageUrl: boolean;
  supportsMessageName: boolean;
  supportsUsageInStreaming: boolean;
  maxTokensField: string;
}

export const getProviderCompatMetadata = (provider: string): ProviderCompatMetadata => {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return {
        supportsDeveloperRole: false,
        supportsImageUrl: false,
        supportsMessageName: false,
        supportsUsageInStreaming: false,
        maxTokensField: "max_tokens",
      };
    case "sglang":
      return {
        supportsDeveloperRole: false,
        supportsImageUrl: true,
        supportsMessageName: true,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens",
      };
    default:
      return {
        supportsDeveloperRole: true,
        supportsImageUrl: true,
        supportsMessageName: true,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens",
      };
  }
};
