// Shared recovery for stale-chunk failures used by the app error boundaries.
//
// After a redeploy, an already-open tab still references the previous build's
// chunk hashes. Those 404 against the new build and throw a ChunkLoadError when
// a route's code (or a layout's shared chunk) is loaded. Reloading once fetches
// the current build; the sessionStorage guard makes it idempotent so a reload
// that does not clear the error can never loop into a refresh storm.

const RELOAD_GUARD_KEY = "local-studio:chunk-reloaded";

export function isChunkLoadError(
  error: { name?: string; message?: string } | null | undefined,
): boolean {
  const signature = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return (
    /ChunkLoadError/i.test(signature) ||
    /Loading (?:CSS )?chunk \S+ failed/i.test(signature) ||
    /(?:Failed to fetch|error loading) dynamically imported module/i.test(signature)
  );
}

/**
 * Reload once per tab session to pick up the current build. Returns true if a
 * reload was triggered, false if we already reloaded this session — so if the
 * reload does not clear the error (e.g. a genuinely broken deploy) the boundary
 * shows a manual fallback instead of looping into a refresh storm. A later
 * redeploy is handled by the user's manual reload.
 */
export function recoverByReload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(RELOAD_GUARD_KEY)) return false;
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  } catch {
    // sessionStorage can be unavailable (private mode); still attempt a reload.
  }
  window.location.reload();
  return true;
}
