const BACKEND_URL_STORAGE = "vllmstudio_backend_url";

export function getStoredBackendUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(BACKEND_URL_STORAGE) || "";
  } catch {
    return "";
  }
}

export function setStoredBackendUrl(url: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = url.trim();
    if (trimmed) {
      window.localStorage.setItem(BACKEND_URL_STORAGE, trimmed);
    } else {
      window.localStorage.removeItem(BACKEND_URL_STORAGE);
    }
  } catch {
    // Ignore storage errors
  }
}

export function clearStoredBackendUrl(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BACKEND_URL_STORAGE);
  } catch {
    // Ignore storage errors
  }
}
