import { CONTROLLERS_CHANGED_EVENT, CONTROLLERS_STORAGE_KEY } from "@/lib/api/controllers";
import { BACKEND_URL_CHANGED_EVENT, BACKEND_URL_STORAGE_KEY } from "@/lib/api/connection";

type DesktopUiPreferencesBridge = {
  loadUiPreferences?: () => Promise<Record<string, string>>;
  saveUiPreferences?: (prefs: Record<string, string>) => Promise<void>;
};

const DURABLE_EXACT_KEYS = new Set([
  "local-studio-state",
  "local-studio.customThemeTokens",
  CONTROLLERS_STORAGE_KEY,
  "local-studio-setup-complete",
  BACKEND_URL_STORAGE_KEY,
]);

const DURABLE_KEY_PREFIXES = ["local-studio.", "local-studio-", "localstudio_", "local_studio_"];

const EXCLUDED_DURABLE_KEYS = new Set([
  "local-studio.agent.transcripts.v1",
  "local-studio.agent.activeSessions.snapshot",
]);

const EXCLUDED_DURABLE_PREFIXES = ["local-studio.agent.transcript."];
const UI_PREFERENCES_TIMEOUT_MS = 1_500;

let saveTimer: number | null = null;

type StudioSettingsPayload = {
  persisted?: {
    ui_preferences?: Record<string, string>;
  };
};

function bridge(): DesktopUiPreferencesBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (
      window as {
        localStudioDesktop?: DesktopUiPreferencesBridge;
      }
    ).localStudioDesktop ?? null
  );
}

function isDurableUiPreferenceKey(key: string): boolean {
  if (EXCLUDED_DURABLE_KEYS.has(key)) return false;
  if (EXCLUDED_DURABLE_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  return (
    DURABLE_EXACT_KEYS.has(key) || DURABLE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function collectDurableUiPreferences(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !isDurableUiPreferenceKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function withoutControllerCredentials(prefs: Record<string, string>): Record<string, string> {
  const { ...rest } = prefs;
  delete rest[CONTROLLERS_STORAGE_KEY];
  return rest;
}

async function loadControllerUiPreferences(): Promise<Record<string, string>> {
  try {
    const response = await fetch("/api/settings", {
      cache: "no-store",
      signal: AbortSignal.timeout(UI_PREFERENCES_TIMEOUT_MS),
    });
    if (!response.ok) return {};
    const settings = (await response.json()) as StudioSettingsPayload;
    return withoutControllerCredentials(settings.persisted?.ui_preferences ?? {});
  } catch {
    return {};
  }
}

async function saveControllerUiPreferences(prefs: Record<string, string>): Promise<void> {
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ui_preferences: withoutControllerCredentials(prefs) }),
      signal: AbortSignal.timeout(UI_PREFERENCES_TIMEOUT_MS),
    });
  } catch {
    // The controller can be unavailable during first boot/offline desktop use.
    // The desktop bridge remains a local fallback and the next UI change retries.
  }
}

function mergeControllersPreference(
  currentValue: string | null,
  incomingValue: string,
): string | null {
  try {
    const current = JSON.parse(currentValue || "[]") as unknown;
    const incoming = JSON.parse(incomingValue) as unknown;
    if (!Array.isArray(incoming)) return null;
    const byUrl = new Map<string, Record<string, unknown>>();
    for (const entry of Array.isArray(current) ? current : []) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const url =
        typeof (entry as { url?: unknown }).url === "string" ? (entry as { url: string }).url : "";
      if (url) byUrl.set(url, entry as Record<string, unknown>);
    }
    for (const entry of incoming) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const incomingEntry = entry as Record<string, unknown>;
      const url = typeof incomingEntry.url === "string" ? incomingEntry.url : "";
      if (!url) continue;
      const currentEntry = byUrl.get(url);
      byUrl.set(url, {
        ...incomingEntry,
        ...(currentEntry ?? {}),
        apiKey:
          typeof currentEntry?.apiKey === "string" && currentEntry.apiKey.trim()
            ? currentEntry.apiKey
            : incomingEntry.apiKey,
        name:
          typeof currentEntry?.name === "string" && currentEntry.name.trim()
            ? currentEntry.name
            : incomingEntry.name,
      });
    }
    const merged = JSON.stringify([...byUrl.values()]);
    return merged === (currentValue || "") ? null : merged;
  } catch {
    return null;
  }
}

function applyMissingPreferences(prefs: Record<string, string>): Set<string> {
  const applied = new Set<string>();
  if (typeof window === "undefined") return applied;
  for (const [key, value] of Object.entries(prefs ?? {})) {
    if (!isDurableUiPreferenceKey(key) || typeof value !== "string") continue;
    const currentValue = window.localStorage.getItem(key);
    if (key === CONTROLLERS_STORAGE_KEY && currentValue !== null) {
      const merged = mergeControllersPreference(currentValue, value);
      if (merged !== null) {
        window.localStorage.setItem(key, merged);
        applied.add(key);
      }
      continue;
    }
    // Renderer storage wins when present; controller/database is the durable
    // rebuild/reinstall fallback, not a stale override while the user is active.
    if (currentValue === null) {
      window.localStorage.setItem(key, value);
      applied.add(key);
    }
  }
  return applied;
}

function dispatchHydratedPreferenceEvents(keys: ReadonlySet<string>): void {
  if (typeof window === "undefined" || keys.size === 0) return;
  if (keys.has(CONTROLLERS_STORAGE_KEY)) {
    window.dispatchEvent(new Event(CONTROLLERS_CHANGED_EVENT));
  }
  if (keys.has(BACKEND_URL_STORAGE_KEY)) {
    window.dispatchEvent(new Event(BACKEND_URL_CHANGED_EVENT));
  }
  if (keys.has(CONTROLLERS_STORAGE_KEY) || keys.has(BACKEND_URL_STORAGE_KEY)) {
    window.dispatchEvent(new Event("storage"));
  }
}

export async function hydrateDurableUiPreferences(): Promise<void> {
  if (typeof window === "undefined") return;
  const desktop = bridge();
  const controllerPrefs = await loadControllerUiPreferences();
  const applied = applyMissingPreferences(controllerPrefs);
  if (!desktop?.loadUiPreferences) {
    dispatchHydratedPreferenceEvents(applied);
    return;
  }
  try {
    const prefs = await desktop.loadUiPreferences();
    for (const key of applyMissingPreferences(prefs)) applied.add(key);
  } catch {
    // Keep localStorage-only behavior if the desktop bridge is unavailable.
  } finally {
    dispatchHydratedPreferenceEvents(applied);
  }
}

export function scheduleDurableUiPreferencesSave(): void {
  if (typeof window === "undefined") return;
  const desktop = bridge();
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const prefs = collectDurableUiPreferences();
    void saveControllerUiPreferences(prefs);
    void desktop?.saveUiPreferences?.(prefs).catch(() => undefined);
  }, 200);
}
