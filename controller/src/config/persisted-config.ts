// CRITICAL
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PersistedConfig {
  models_dir?: string;
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

export const savePersistedConfig = (dataDirectory: string, updates: PersistedConfig): PersistedConfig => {
  const path = getPersistedConfigPath(dataDirectory);
  const current = loadPersistedConfig(dataDirectory);
  const next: PersistedConfig = {
    ...current,
    ...updates,
  };
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
};
