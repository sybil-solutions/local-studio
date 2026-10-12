import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

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
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = readFileSync(path, "utf-8");
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
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  // Write-then-rename so a crash mid-write can't truncate the file — a truncated
  // read is swallowed by loadPersistedConfig, silently resetting models_dir /
  // providers / selected_runtime_target_ids.
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, JSON.stringify(next, null, 2));
  renameSync(temporaryPath, path);
  try {
    chmodSync(dataDirectory, 0o700);
    chmodSync(path, 0o600);
  } catch {
    // Ignore permission hardening failures on unsupported filesystems.
  }
  return next;
};
