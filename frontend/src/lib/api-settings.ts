import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export interface ApiSettings {
  backendUrl: string;
  apiKey: string;
  voiceUrl: string;
  voiceModel: string;
}

const DEFAULT_SETTINGS: ApiSettings = {
  backendUrl: process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080",
  apiKey: process.env.API_KEY || "",
  voiceUrl: process.env.VOICE_URL || process.env.NEXT_PUBLIC_VOICE_URL || "",
  voiceModel: process.env.VOICE_MODEL || process.env.NEXT_PUBLIC_VOICE_MODEL || "whisper-large-v3-turbo",
};

// Settings file path - try multiple locations to support dev, monorepo, and standalone builds
const DATA_DIR_CANDIDATES = [
  process.env.VLLM_STUDIO_DATA_DIR,
  path.join(process.cwd(), "data"),
  path.join(process.cwd(), "..", "data"),
  path.join(process.cwd(), "frontend", "data"),
].filter((dir): dir is string => Boolean(dir));

function resolveSettingsFile() {
  for (const dir of DATA_DIR_CANDIDATES) {
    const settingsFile = path.join(dir, "api-settings.json");
    if (existsSync(settingsFile)) {
      return { dataDir: dir, settingsFile };
    }
  }

  const fallbackDir = DATA_DIR_CANDIDATES[0] || path.join(process.cwd(), "data");
  return {
    dataDir: fallbackDir,
    settingsFile: path.join(fallbackDir, "api-settings.json"),
  };
}

export async function getApiSettings(): Promise<ApiSettings> {
  try {
    const { settingsFile } = resolveSettingsFile();
    if (existsSync(settingsFile)) {
      const content = await readFile(settingsFile, "utf-8");
      const saved = JSON.parse(content) as Partial<ApiSettings>;
      // Merge with defaults (env vars still take precedence if settings file has empty values)
      return {
        backendUrl: saved.backendUrl || DEFAULT_SETTINGS.backendUrl,
        apiKey: saved.apiKey || DEFAULT_SETTINGS.apiKey,
        voiceUrl: saved.voiceUrl || DEFAULT_SETTINGS.voiceUrl,
        voiceModel: saved.voiceModel || DEFAULT_SETTINGS.voiceModel,
      };
    }
  } catch (error) {
    console.error("[API Settings] Failed to read settings file:", error);
  }
  return DEFAULT_SETTINGS;
}

export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  try {
    const { dataDir, settingsFile } = resolveSettingsFile();
    // Ensure data directory exists
    if (!existsSync(dataDir)) {
      await mkdir(dataDir, { recursive: true });
    }
    await writeFile(settingsFile, JSON.stringify(settings, null, 2), "utf-8");
  } catch (error) {
    console.error("[API Settings] Failed to save settings file:", error);
    throw error;
  }
}

// Mask API key for display (show first 4 and last 4 chars)
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key ? "••••••••" : "";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
