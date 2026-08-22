import type { ProviderConfig } from "../config/persisted-config";

export const DEFAULT_CHAT_PROVIDER = "openai";

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

export const buildProviderApiUrl = (baseUrl: string, pathname: string): string => {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return /\/v1$/i.test(normalizedBase)
    ? `${normalizedBase}${normalizedPath}`
    : `${normalizedBase}/v1${normalizedPath}`;
};

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

export const resolveConfiguredProviderConfig = (
  providerId: string,
  providers: ProviderConfig[] = [],
): ProviderRouteConfig | null => {
  const match = providers.find((p) => p.id.toLowerCase() === providerId.toLowerCase() && p.enabled);
  if (!match || !match.api_key) return null;
  return { baseUrl: match.base_url, apiKey: match.api_key };
};

export const resolveProviderConfig = (
  provider: string,
  config: ControllerProviderRoutingConfig = {},
): ProviderRouteConfig | null => {
  return resolveConfiguredProviderConfig(provider, config.providers);
};
