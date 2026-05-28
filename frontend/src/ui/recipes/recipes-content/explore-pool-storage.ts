const STORAGE_KEY = "vllmstudio_explore_pool_gb";

export function readExplorePoolOverrideGb(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim();
    if (!raw) return null;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100) / 100;
  } catch {
    return null;
  }
}

export function writeExplorePoolOverrideGb(value: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value == null || !Number.isFinite(value) || value <= 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, String(Math.round(value * 100) / 100));
  } catch {
    // ignore quota / private mode
  }
}
