"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { RefreshIconButton, SearchInput } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { StatusText, type StatusTone } from "./catalog-table-shell";

/**
 * The controller every catalog section runs on: one list fetched on mount,
 * refreshed on demand, and narrowed by a search query.
 *
 * `load` must be referentially stable (wrap it in `useCallback`) — the mount
 * subscription re-fires when it changes. A section whose payload carries more
 * than the list sets that extra state inside `load` and returns the list.
 */

/** The query narrowing on its own, for sections that filter a static list too. */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  searchText: (item: T) => string,
): readonly T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => searchText(item).toLowerCase().includes(normalized));
}

export function useCatalogSection<T>({
  load,
  searchText,
}: {
  load: () => Promise<readonly T[]>;
  searchText?: (item: T) => string;
}) {
  const [items, setItems] = useState<readonly T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load()
      .then((next) => {
        setItems(next);
        setError("");
      })
      .catch((loadError: unknown) => {
        setItems([]);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        setLoaded(true);
        setRefreshing(false);
      });
  }, [load]);

  useMountSubscription(() => {
    refresh();
  }, [refresh]);

  const visible = useMemo(
    () => (searchText ? filterByQuery(items, query, searchText) : items),
    [items, query, searchText],
  );

  return {
    items,
    setItems,
    visible,
    loaded,
    refreshing,
    error,
    setError,
    refresh,
    query,
    setQuery,
  };
}

/**
 * The search / count / refresh cluster every section hangs in its heading,
 * wired straight to the controller. The search box renders only when a
 * placeholder names it.
 */
export function CatalogSectionHeader({
  section,
  searchPlaceholder,
  statusTone,
  statusText,
  refreshLabel,
  children,
}: {
  section: {
    query: string;
    setQuery: (next: string) => void;
    refresh: () => void;
    refreshing: boolean;
  };
  searchPlaceholder?: string;
  statusTone?: StatusTone;
  statusText: ReactNode;
  refreshLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {searchPlaceholder ? (
        <SearchInput
          value={section.query}
          onChange={section.setQuery}
          placeholder={searchPlaceholder}
          className="w-56"
        />
      ) : null}
      <StatusText tone={statusTone}>{statusText}</StatusText>
      <RefreshIconButton
        onClick={section.refresh}
        loading={section.refreshing}
        label={refreshLabel}
      />
      {children}
    </div>
  );
}
