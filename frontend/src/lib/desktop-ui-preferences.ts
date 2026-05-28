type DesktopUiPreferencesBridge = {
  loadUiPreferences?: () => Promise<Record<string, string>>;
  saveUiPreferences?: (prefs: Record<string, string>) => Promise<void>;
};

const CONTROLLERS_STORAGE_KEY = "vllm-studio.controllers";
const BACKEND_URL_STORAGE_KEY = "vllmstudio_backend_url";
const CONTROLLERS_CHANGED_EVENT = "vllm:controllers-changed";
const BACKEND_URL_CHANGED_EVENT = "vllm:backend-url-changed";

const DURABLE_EXACT_KEYS = new Set([
  "vllm-studio-state",
  "vllm-studio.customThemeTokens",
  CONTROLLERS_STORAGE_KEY,
  "vllm-studio-setup-complete",
  BACKEND_URL_STORAGE_KEY,
]);

const DURABLE_KEY_PREFIXES = ["vllm-studio.", "vllm-studio-", "vllmstudio_", "vllm_studio_"];

let saveTimer: number | null = null;

function bridge(): DesktopUiPreferencesBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (
      window as {
        vllmStudioDesktop?: DesktopUiPreferencesBridge;
      }
    ).vllmStudioDesktop ?? null
  );
}

function isDurableUiPreferenceKey(key: string): boolean {
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

async function loadControllerUiPreferences(): Promise<Record<string, string>> {
  try {
    const { default: api } = await import("@/lib/api");
    const settings = await api.getStudioSettings();
    return settings.persisted.ui_preferences ?? {};
  } catch {
    return {};
  }
}

async function saveControllerUiPreferences(prefs: Record<string, string>): Promise<void> {
  try {
    const { default: api } = await import("@/lib/api");
    await api.updateStudioSettings({ ui_preferences: prefs });
  } catch {
    // The controller can be unavailable during first boot/offline desktop use.
    // The desktop bridge remains a local fallback and the next UI change retries.
  }
}

function applyMissingPreferences(prefs: Record<string, string>): Set<string> {
  const applied = new Set<string>();
  if (typeof window === "undefined") return applied;
  for (const [key, value] of Object.entries(prefs ?? {})) {
    if (!isDurableUiPreferenceKey(key) || typeof value !== "string") continue;
    // Renderer storage wins when present; controller/database is the durable
    // rebuild/reinstall fallback, not a stale override while the user is active.
    if (window.localStorage.getItem(key) === null) {
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
