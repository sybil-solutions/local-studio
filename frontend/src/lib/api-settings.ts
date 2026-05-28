import { chmod, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolveSettingsDefaultBackendUrl } from "./backend-config";
import { resolveDataDir, resolveSettingsFilePath } from "./data-dir";

export interface ApiSettings {
  backendUrl: string;
  apiKey: string;
  voiceUrl: string;
  voiceModel: string;
}

const DEFAULT_SETTINGS: ApiSettings = {
  backendUrl: resolveSettingsDefaultBackendUrl(),
  apiKey: process.env.API_KEY || "",
  voiceUrl: process.env.VOICE_URL || process.env.NEXT_PUBLIC_VOICE_URL || "",
  voiceModel:
    process.env.VOICE_MODEL || process.env.NEXT_PUBLIC_VOICE_MODEL || "whisper-large-v3-turbo",
};

export async function getApiSettings(): Promise<ApiSettings> {
  const settingsFile = resolveSettingsFilePath();
  if (!existsSync(settingsFile)) return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(await readFile(settingsFile, "utf-8")) as Partial<ApiSettings>;
    return {
      backendUrl: saved.backendUrl || DEFAULT_SETTINGS.backendUrl,
      apiKey: saved.apiKey || DEFAULT_SETTINGS.apiKey,
      voiceUrl: saved.voiceUrl || DEFAULT_SETTINGS.voiceUrl,
      voiceModel: saved.voiceModel || DEFAULT_SETTINGS.voiceModel,
    };
  } catch (error) {
    console.error(`[API Settings] Failed to read ${settingsFile}:`, error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  resolveDataDir();
  const settingsFile = resolveSettingsFilePath();
  const payload = JSON.stringify(settings, null, 2);
  await writeFile(settingsFile, payload, "utf-8");
  await chmod(settingsFile, 0o600).catch(() => undefined);
}

// Mask API key for display (show first 4 and last 4 chars)
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key ? "••••••••" : "";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
