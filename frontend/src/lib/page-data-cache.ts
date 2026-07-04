/**
 * Stale-while-revalidate store for page data.
 *
 * Page hooks seed their state from here so client-side navigation paints the
 * last-known data instantly while the fresh fetch runs in the background.
 * Controller round-trips go through a tunnel and can take seconds — without
 * this every route switch stares at a spinner for the full fetch.
 *
 * Two layers:
 *  - Module memory (`cache`): survives client-side route switches (same JS
 *    context), instant reads, no serialization cost.
 *  - `sessionStorage` (write-through): survives a hard reload so the very first
 *    paint after refresh still shows last-known data instead of a cold spinner.
 *    Guarded for SSR/no-window and quota errors; large values are kept in module
 *    memory only so we never blow the storage quota on a big config blob.
 */
const cache = new Map<string, unknown>();

const STORAGE_PREFIX = "page-cache:";
// Skip persisting anything larger than this (serialized length). Big blobs stay
// in module memory only — sessionStorage quota is small and shared.
const MAX_PERSISTED_CHARS = 200_000;

const getSessionStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Access can throw in sandboxed/blocked-storage contexts.
    return null;
  }
};

export function readPageCache<T>(key: string): T | null {
  if (cache.has(key)) {
    return (cache.get(key) as T | undefined) ?? null;
  }
  const store = getSessionStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_PREFIX + key);
    if (raw == null) return null;
    const value = JSON.parse(raw) as T;
    // Warm the module layer so subsequent reads skip parsing.
    cache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function writePageCache<T>(key: string, value: T): void {
  cache.set(key, value);
  const store = getSessionStorage();
  if (!store) return;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_PERSISTED_CHARS) {
      // Too big to persist — drop any stale copy and keep module memory only.
      store.removeItem(STORAGE_PREFIX + key);
      return;
    }
    store.setItem(STORAGE_PREFIX + key, serialized);
  } catch {
    // Quota exceeded, serialization failure, or blocked storage — module memory
    // still holds the value, so reads within this session keep working.
  }
}
