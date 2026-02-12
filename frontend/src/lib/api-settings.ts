// CRITICAL
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { accessSync, constants, existsSync } from "fs";
import { homedir, tmpdir } from "node:os";
import path from "path";
import { resolveSettingsDefaultBackendUrl } from "./backend-config";

export interface ApiSettings {
  backendUrl: string;
  apiKey: string;
  voiceUrl: string;
  voiceModel: string;
}

const DEFAULT_BACKEND_URL = resolveSettingsDefaultBackendUrl();

const DEFAULT_SETTINGS: ApiSettings = {
  backendUrl: DEFAULT_BACKEND_URL,
  apiKey: process.env.API_KEY || "",
  voiceUrl: process.env.VOICE_URL || process.env.NEXT_PUBLIC_VOICE_URL || "",
  voiceModel: process.env.VOICE_MODEL || process.env.NEXT_PUBLIC_VOICE_MODEL || "whisper-large-v3-turbo",
};

const SETTINGS_FILENAME = "api-settings.json";

// Settings file path - try multiple locations to support dev, monorepo, and standalone builds
const DATA_DIR_CANDIDATES = [
  process.env.VLLM_STUDIO_DATA_DIR,
  path.join(process.cwd(), "data"),
  path.join(process.cwd(), "..", "data"),
  path.join(process.cwd(), "frontend", "data"),
  path.join(homedir(), ".vllm-studio"),
  path.join(tmpdir(), "vllm-studio"),
].filter((dir): dir is string => Boolean(dir));

function resolveSettingsFile() {
  const writableDirs = DATA_DIR_CANDIDATES.filter((dir) => {
    if (!existsSync(dir)) return false;
    try {
      accessSync(dir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  });

  for (const dir of writableDirs) {
    const settingsFile = path.join(dir, SETTINGS_FILENAME);
    if (existsSync(settingsFile)) {
      return { dataDir: dir, settingsFile };
    }
  }

  for (const dir of DATA_DIR_CANDIDATES) {
    const settingsFile = path.join(dir, SETTINGS_FILENAME);
    if (existsSync(settingsFile)) {
      return { dataDir: dir, settingsFile };
    }
  }

  const fallbackDir =
    writableDirs[0] || DATA_DIR_CANDIDATES[0] || path.join(process.cwd(), "data");
  return {
    dataDir: fallbackDir,
    settingsFile: path.join(fallbackDir, SETTINGS_FILENAME),
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
  const payload = JSON.stringify(settings, null, 2);
  let lastError: unknown;
  try {
    for (const dir of DATA_DIR_CANDIDATES) {
      try {
        await mkdir(dir, { recursive: true });
        const settingsFile = path.join(dir, SETTINGS_FILENAME);
        try {
          await writeFile(settingsFile, payload, "utf-8");
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if ((code === "EACCES" || code === "EPERM") && existsSync(settingsFile)) {
            await unlink(settingsFile);
            await writeFile(settingsFile, payload, "utf-8");
          } else {
            throw error;
          }
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("No writable settings directory found");
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
