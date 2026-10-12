import { CONTROLLERS_CHANGED_EVENT, CONTROLLERS_STORAGE_KEY } from "@/lib/api/controllers";
import { BACKEND_URL_CHANGED_EVENT, BACKEND_URL_STORAGE_KEY } from "@/lib/api/connection";
import { Schema } from "effect";

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
  // The sync base itself — uploading it would nest the whole pref set.
  "local-studio.ui-prefs-synced",
]);

const EXCLUDED_DURABLE_PREFIXES = ["local-studio.agent.transcript."];
const UI_PREFERENCES_TIMEOUT_MS = 1_500;
const ControllerPreferenceSchema = Schema.Record(Schema.String, Schema.Unknown);

let saveTimer: number | null = null;

type ControllerPreference = typeof ControllerPreferenceSchema.Type;

type ParsedJson = { valid: true; value: unknown } | { valid: false };

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

// The controller's studio settings store is where preferences live — the
// runtime's /api/settings only knows backendUrl+apiKey and silently dropped
// everything this module sent it, which is why prefs never synced between
// surfaces. The proxy route reaches whichever controller is active and
// injects its stored key server-side.
async function loadControllerUiPreferences(): Promise<Record<string, string>> {
  try {
    const response = await fetch("/api/proxy/studio/settings", {
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

async function saveControllerUiPreferences(prefs: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch("/api/proxy/studio/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ui_preferences: withoutControllerCredentials(prefs) }),
      signal: AbortSignal.timeout(UI_PREFERENCES_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * What each key looked like the last time this surface synced with the
 * controller. With that base, adoption is a three-way merge without clocks:
 * a key the user never changed here follows the controller; a key they did
 * change here wins locally and uploads on the next save.
 */
const SYNC_SNAPSHOT_KEY = "local-studio.ui-prefs-synced";

function readSyncSnapshot(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SYNC_SNAPSHOT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeSyncSnapshot(snapshot: Record<string, string>): void {
  try {
    window.localStorage.setItem(SYNC_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {}
}

function parseJson(value: string): ParsedJson {
  try {
    const parsed: unknown = JSON.parse(value);
    return { valid: true, value: parsed };
  } catch {
    return { valid: false };
  }
}

function controllerPreference(value: unknown): ControllerPreference | null {
  try {
    return Schema.decodeUnknownSync(ControllerPreferenceSchema)(value);
  } catch {
    return null;
  }
}

function controllerPreferences(value: unknown): ControllerPreference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const preference = controllerPreference(entry);
    return preference ? [preference] : [];
  });
}

function preferenceUrl(preference: ControllerPreference): string | null {
  const url = preference.url;
  return typeof url === "string" && url ? url : null;
}

function preferredString(
  current: ControllerPreference | undefined,
  incoming: ControllerPreference,
  key: "apiKey" | "name",
): unknown {
  const currentValue = current?.[key];
  return typeof currentValue === "string" && currentValue.trim() ? currentValue : incoming[key];
}

function mergedControllerPreference(
  current: ControllerPreference | undefined,
  incoming: ControllerPreference,
): ControllerPreference {
  return {
    ...incoming,
    ...(current ?? {}),
    apiKey: preferredString(current, incoming, "apiKey"),
    name: preferredString(current, incoming, "name"),
  };
}

function preferencesByUrl(preferences: ControllerPreference[]): Map<string, ControllerPreference> {
  const byUrl = new Map<string, ControllerPreference>();
  for (const preference of preferences) {
    const url = preferenceUrl(preference);
    if (url) byUrl.set(url, preference);
  }
  return byUrl;
}

function mergeControllersPreference(
  currentValue: string | null,
  incomingValue: string,
): string | null {
  const current = parseJson(currentValue || "[]");
  const incoming = parseJson(incomingValue);
  if (!current.valid || !incoming.valid || !Array.isArray(incoming.value)) return null;
  const byUrl = preferencesByUrl(controllerPreferences(current.value));
  for (const incomingPreference of controllerPreferences(incoming.value)) {
    const url = preferenceUrl(incomingPreference);
    if (url) {
      byUrl.set(url, mergedControllerPreference(byUrl.get(url), incomingPreference));
    }
  }
  const merged = JSON.stringify([...byUrl.values()]);
  return merged === (currentValue || "") ? null : merged;
}

function applyMissingPreferences(prefs: Record<string, string>): Set<string> {
  const applied = new Set<string>();
  if (typeof window === "undefined") return applied;
  const snapshot = readSyncSnapshot();
  const nextSnapshot = { ...snapshot };
  for (const [key, value] of Object.entries(prefs ?? {})) {
    if (!isDurableUiPreferenceKey(key) || typeof value !== "string") continue;
    const currentValue = window.localStorage.getItem(key);
    if (key === CONTROLLERS_STORAGE_KEY && currentValue !== null) {
      const merged = mergeControllersPreference(currentValue, value);
      if (merged !== null) {
        window.localStorage.setItem(key, merged);
        applied.add(key);
      }
      nextSnapshot[key] = value;
      continue;
    }
    // Adopt the controller's value when this surface never set the key, or
    // set it and hasn't touched it since the last sync. A locally-changed
    // key wins here and uploads on the next save.
    if (currentValue === null || currentValue === snapshot[key]) {
      if (currentValue !== value) {
        window.localStorage.setItem(key, value);
        applied.add(key);
      }
      nextSnapshot[key] = value;
    }
  }
  writeSyncSnapshot(nextSnapshot);
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
    void saveControllerUiPreferences(prefs).then((saved) => {
      // The upload is now the shared truth; recording it as the sync base
      // lets the next hydrate treat these values as "unchanged here".
      if (saved) writeSyncSnapshot(withoutControllerCredentials(prefs));
    });
    void desktop?.saveUiPreferences?.(prefs).catch(() => undefined);
  }, 200);
}
