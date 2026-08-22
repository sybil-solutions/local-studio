// Server-side API settings service: the single owner of reading, writing,
// merging, and masking the persisted `<dataDir>/api-settings.json` file.

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolveSettingsDefaultBackendUrl } from "../../../shared/agent/backend-url";
import { atomicWriteJson, resolveSettingsFilePath } from "./data-dir";

export interface ApiSettings {
  backendUrl: string;
  apiKey: string;
}

/** Marker substring used to mask secrets in UI surfaces. */
const MASKED_KEY_MARKER = "••••";

const DEFAULT_SETTINGS: ApiSettings = {
  backendUrl: resolveSettingsDefaultBackendUrl(),
  apiKey: process.env.API_KEY || "",
};

export async function getApiSettings(): Promise<ApiSettings> {
  const settingsFile = resolveSettingsFilePath();
  if (!existsSync(settingsFile)) return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(await readFile(settingsFile, "utf-8")) as Partial<ApiSettings>;
    return {
      backendUrl: saved.backendUrl || DEFAULT_SETTINGS.backendUrl,
      apiKey: saved.apiKey || DEFAULT_SETTINGS.apiKey,
    };
  } catch (error) {
    console.error(`[API Settings] Failed to read ${settingsFile}:`, error);
    return DEFAULT_SETTINGS;
  }
}

export function saveApiSettings(settings: ApiSettings): Promise<void> {
  // Atomic replace: a crash mid-write would truncate the file, and
  // getApiSettings swallows the parse error and returns defaults — silently
  // wiping the persisted API key and backend URL.
  return atomicWriteJson(resolveSettingsFilePath(), settings, { mode: 0o600 });
}

// Mask API key for display (show first 4 and last 4 chars)
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key ? "••••••••" : "";
  return `${key.slice(0, 4)}${MASKED_KEY_MARKER}${key.slice(-4)}`;
}

export class InvalidSettingsError extends Error {}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Validate a partial update, merge it over persisted settings (preserving
// unchanged values, ignoring a masked API key), and persist. Throws
// `InvalidSettingsError` when a provided URL is malformed.
export async function applySettingsUpdate(update: Partial<ApiSettings>): Promise<ApiSettings> {
  const { backendUrl, apiKey } = update;

  if (backendUrl && !isValidUrl(backendUrl)) {
    throw new InvalidSettingsError("Invalid backend URL format");
  }

  const current = await getApiSettings();
  const next: ApiSettings = {
    backendUrl: backendUrl || current.backendUrl,
    // Only update API key if explicitly provided (not the masked value).
    apiKey: apiKey && !apiKey.includes(MASKED_KEY_MARKER) ? apiKey : current.apiKey,
  };

  await saveApiSettings(next);
  return next;
}

/** Public-facing settings shape: API key masked, plus a `hasApiKey` flag. */
export function maskedSettingsView(settings: ApiSettings) {
  return {
    backendUrl: settings.backendUrl,
    apiKey: maskApiKey(settings.apiKey),
    hasApiKey: Boolean(settings.apiKey),
  };
}
