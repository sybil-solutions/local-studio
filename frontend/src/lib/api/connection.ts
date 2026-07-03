/**
 * Controller connection state: where the controller lives (env defaults +
 * browser-stored backend URL) and how we authenticate against it (API key).
 */
import { pickFirstNonEmpty } from "@shared/agent/backend-url";
import { getControllerApiKey, normalizeControllerUrl } from "./controllers";

// --- Env-derived defaults ---

const LOCAL_BACKEND_FALLBACK = "http://localhost:8080";
const CLIENT_PROXY_FALLBACK = "/api/proxy";

/**
 * Server-side API client base URL.
 * Used as a first-run fallback when api-settings.json doesn't exist yet.
 */
export const resolveApiServerBaseUrl = (): string =>
  pickFirstNonEmpty(
    process.env.BACKEND_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.LOCAL_STUDIO_BACKEND_URL,
  ) ?? LOCAL_BACKEND_FALLBACK;

// resolveSettingsDefaultBackendUrl lives in shared/agent/backend-url.ts so the
// agent runtime package's settings service can share it; re-exported here for
// frontend callers.
export { resolveSettingsDefaultBackendUrl } from "@shared/agent/backend-url";

/**
 * Client-side controller event stream base URL.
 */
export const resolveControllerEventsBaseUrl = (): string =>
  pickFirstNonEmpty(
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.LOCAL_STUDIO_BACKEND_URL,
    process.env.BACKEND_URL,
  ) ?? CLIENT_PROXY_FALLBACK;

// --- Browser-stored backend URL ---

export const BACKEND_URL_STORAGE_KEY = "localstudio_backend_url";
const LEGACY_BACKEND_URL_STORAGE = [["v", "llmstudio"].join(""), "backend_url"].join("_");
const LEGACY_BACKEND_URL_COOKIE = LEGACY_BACKEND_URL_STORAGE;
export const BACKEND_URL_CHANGED_EVENT = "vllm:backend-url-changed";

function getCookieValue(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${encodeURIComponent(name)}=`;
  for (const entry of document.cookie.split(";")) {
    const trimmed = entry.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return "";
}

function setBackendCookie(url: string): void {
  if (typeof document === "undefined") return;
  const trimmed = url.trim();
  const encoded = encodeURIComponent(trimmed);
  const maxAge = trimmed ? 60 * 60 * 24 * 365 : 0; // 1 year or delete
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(BACKEND_URL_STORAGE_KEY)}=${encoded}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function getStoredBackendUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = normalizeControllerUrl(
      window.localStorage.getItem(BACKEND_URL_STORAGE_KEY) ||
        getCookieValue(BACKEND_URL_STORAGE_KEY) ||
        window.localStorage.getItem(LEGACY_BACKEND_URL_STORAGE) ||
        getCookieValue(LEGACY_BACKEND_URL_COOKIE) ||
        "",
    );
    if (stored && !window.localStorage.getItem(BACKEND_URL_STORAGE_KEY)) {
      window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, stored);
      setBackendCookie(stored);
    }
    return stored;
  } catch {
    return normalizeControllerUrl(
      getCookieValue(BACKEND_URL_STORAGE_KEY) || getCookieValue(LEGACY_BACKEND_URL_COOKIE) || "",
    );
  }
}

export function setStoredBackendUrl(url: string): void {
  if (typeof window === "undefined") return;
  const previous = getStoredBackendUrl();
  const trimmed = normalizeControllerUrl(url);
  try {
    if (trimmed) {
      window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    }
    setBackendCookie(trimmed);
  } catch {
    // Ignore storage errors
    setBackendCookie(trimmed);
  }
  if (trimmed !== previous) {
    window.dispatchEvent(
      new CustomEvent(BACKEND_URL_CHANGED_EVENT, { detail: { url: trimmed, previous } }),
    );
  }
}

export function clearStoredBackendUrl(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_BACKEND_URL_STORAGE);
    setBackendCookie("");
    document.cookie = `${encodeURIComponent(LEGACY_BACKEND_URL_COOKIE)}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // Ignore storage errors
    setBackendCookie("");
  }
}

// --- API key ---

let runtimeApiKey = "";

/**
 * Get the API key from the active browser/controller state.
 *
 * Do not read NEXT_PUBLIC_* here. This module is bundled into the renderer,
 * so public env values become compiled defaults and can outlive key rotation.
 */
export function getApiKey(): string {
  if (runtimeApiKey) return runtimeApiKey;

  if (typeof window !== "undefined") {
    return getControllerApiKey(getStoredBackendUrl());
  }

  return process.env.LOCAL_STUDIO_API_KEY?.trim() || "";
}

/**
 * Save API key only for the current browser runtime.
 */
export function setApiKey(key: string): void {
  runtimeApiKey = key.trim();
}

/**
 * Remove the in-memory runtime API key.
 */
export function clearApiKey(): void {
  runtimeApiKey = "";
}
