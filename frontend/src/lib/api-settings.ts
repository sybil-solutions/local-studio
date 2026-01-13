import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export interface ApiSettings {
  backendUrl: string;
  litellmUrl: string;
  apiKey: string;
}

const DEFAULT_SETTINGS: ApiSettings = {
  backendUrl: process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080',
  litellmUrl: process.env.LITELLM_URL || process.env.NEXT_PUBLIC_LITELLM_URL || 'http://localhost:4100',
  apiKey: process.env.API_KEY || '',
};

// Settings file path - relative to frontend directory
const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'api-settings.json');

export async function getApiSettings(): Promise<ApiSettings> {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const content = await readFile(SETTINGS_FILE, 'utf-8');
      const saved = JSON.parse(content) as Partial<ApiSettings>;
      // Merge with defaults (env vars still take precedence if settings file has empty values)
      return {
        backendUrl: saved.backendUrl || DEFAULT_SETTINGS.backendUrl,
        litellmUrl: saved.litellmUrl || DEFAULT_SETTINGS.litellmUrl,
        apiKey: saved.apiKey || DEFAULT_SETTINGS.apiKey,
      };
    }
  } catch (error) {
    console.error('[API Settings] Failed to read settings file:', error);
  }
  return DEFAULT_SETTINGS;
}

export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  try {
    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }
    await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    console.error('[API Settings] Failed to save settings file:', error);
    throw error;
  }
}

// Mask API key for display (show first 4 and last 4 chars)
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key ? '••••••••' : '';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
