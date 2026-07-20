import { resolve } from "node:path";
import { readPrivateTextFile, writePrivateTextFile } from "../core/private-files";

export interface ProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  enabled: boolean;
}

export interface PersistedConfig {
  models_dir?: string;
  providers?: ProviderConfig[];
  selected_runtime_target_ids?: Partial<Record<"vllm" | "sglang" | "llamacpp" | "mlx", string>>;
}

export const getPersistedConfigPath = (dataDirectory: string): string => {
  return resolve(dataDirectory, "studio-settings.json");
};

export const loadPersistedConfig = (dataDirectory: string): PersistedConfig => {
  const path = getPersistedConfigPath(dataDirectory);
  const content = readPrivateTextFile(path);
  if (content === null) return {};
  try {
    const parsed = JSON.parse(content) as PersistedConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

type PersistedConfigUpdates = {
  [K in keyof PersistedConfig]?: PersistedConfig[K] | null;
};

export const savePersistedConfig = (
  dataDirectory: string,
  updates: PersistedConfigUpdates,
): PersistedConfig => {
  const path = getPersistedConfigPath(dataDirectory);
  const current = loadPersistedConfig(dataDirectory);
  const next: PersistedConfig = { ...current };
  const writable = next as Record<
    keyof PersistedConfig,
    PersistedConfig[keyof PersistedConfig] | undefined
  >;
  (Object.keys(updates) as Array<keyof PersistedConfig>).forEach((key) => {
    const value = updates[key];
    if (value === null) {
      delete next[key];
      return;
    }
    if (value !== undefined) {
      writable[key] = value;
    }
  });
  writePrivateTextFile(path, JSON.stringify(next, null, 2));
  return next;
};
