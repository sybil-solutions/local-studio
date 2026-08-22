"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";

/**
 * Stale-while-revalidate for a page's own payload: paint the last-loaded value
 * instantly on navigation while the fetch behind it refreshes.
 *
 * The two flags are the two questions a page asks. `loading` is "I have nothing
 * to draw yet" — true only until the first load of a page that arrived without
 * a cached value. `refreshing` is "a fetch is in flight" and covers every load,
 * so a refresh control can spin without the page falling back to a skeleton.
 *
 * `load` must be referentially stable (wrap it in `useCallback`) — the mount
 * subscription re-fires when it changes. Whatever it resolves is cached under
 * `key` and returned as `data`, and handed back by `reload` for a caller that
 * needs the fresh value in the same breath; a load that also fills neighbouring
 * state does that inside `load`. A response that lands after a newer one was
 * requested is dropped rather than overwriting it, and reads back as null.
 */
export function usePageResource<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(() => readPageCache<T>(key));
  const [loading, setLoading] = useState(() => readPageCache<T>(key) === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(async (): Promise<T | null> => {
    const requestId = ++requestSequence.current;
    setRefreshing(true);
    setError(null);
    try {
      const next = await load();
      if (requestId !== requestSequence.current) return null;
      writePageCache(key, next);
      setData(next);
      return next;
    } catch (cause) {
      if (requestId === requestSequence.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      return null;
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [key, load]);

  useMountSubscription(() => {
    setData(readPageCache<T>(key));
    void reload();
  }, [key, reload]);

  /** Back to the first-paint state, for a page whose backend changed under it. */
  const reset = useCallback(() => {
    setData(null);
    setLoading(true);
  }, []);

  return { data, setData, loading, refreshing, error, reload, reset };
}
