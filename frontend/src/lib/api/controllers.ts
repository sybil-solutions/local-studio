export const CONTROLLERS_STORAGE_KEY = "local-studio.controllers";
const LEGACY_CONTROLLERS_STORAGE_KEY = [["v", "llm-studio"].join(""), "controllers"].join(".");
export const CONTROLLERS_CHANGED_EVENT = "vllm:controllers-changed";

export type SavedController = {
  url: string;
  apiKey?: string;
  name?: string;
};

export function normalizeControllerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(/\/v1\/?$/i, "") || "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  }
}

function parseSavedController(entry: unknown): SavedController | null {
  if (typeof entry === "string") {
    const url = normalizeControllerUrl(entry);
    return url ? { url } : null;
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === "string" ? normalizeControllerUrl(record.url) : "";
  if (!url) return null;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const out: SavedController = { url };
  if (apiKey) out.apiKey = apiKey;
  if (name) out.name = name;
  return out;
}

export function loadSavedControllers(): SavedController[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(CONTROLLERS_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_CONTROLLERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const byUrl = new Map<string, SavedController>();
    for (const entry of parsed) {
      const controller = parseSavedController(entry);
      if (!controller) continue;
      byUrl.set(controller.url, { ...byUrl.get(controller.url), ...controller });
    }
    const next = [...byUrl.values()];
    if (
      JSON.stringify(parsed) !== JSON.stringify(next) ||
      !window.localStorage.getItem(CONTROLLERS_STORAGE_KEY)
    ) {
      window.localStorage.setItem(CONTROLLERS_STORAGE_KEY, JSON.stringify(next));
    }
    return next;
  } catch {
    return [];
  }
}

export function saveSavedControllers(controllers: SavedController[]): SavedController[] {
  if (typeof window === "undefined") return [];
  const byUrl = new Map<string, SavedController>();
  for (const controller of controllers) {
    const url = normalizeControllerUrl(controller.url);
    if (!url) continue;
    const apiKey = controller.apiKey?.trim();
    const name = controller.name?.trim();
    const out: SavedController = { url };
    if (apiKey) out.apiKey = apiKey;
    if (name) out.name = name;
    byUrl.set(url, out);
  }
  const next = [...byUrl.values()];
  window.localStorage.setItem(CONTROLLERS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent(CONTROLLERS_CHANGED_EVENT, { detail: { controllers: next } }),
  );
  window.dispatchEvent(new Event("storage"));
  return next;
}

export function getControllerApiKey(url: string): string {
  const normalized = normalizeControllerUrl(url);
  if (!normalized) return "";
  return (
    loadSavedControllers().find(
      (controller) => normalizeControllerUrl(controller.url) === normalized,
    )?.apiKey ?? ""
  );
}
