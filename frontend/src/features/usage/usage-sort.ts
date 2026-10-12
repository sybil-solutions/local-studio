"use client";

import { useMemo, useState } from "react";

/**
 * Sorting for the Usage tables, stated once.
 *
 * Every table here is "rows, one sort key, one direction", and the alternative
 * is three near-identical comparators drifting apart. The accessor is passed in
 * as a module-level function so the memo actually memoises instead of being
 * invalidated by a fresh object literal on every render.
 *
 * Nulls always sort last regardless of direction: a model that reported no TTFT
 * is not the fastest model, and it is not the slowest one either.
 */
export type SortState<K extends string> = { key: K; desc: boolean };

export function useSortedRows<T, K extends string>(
  rows: readonly T[],
  accessor: (row: T, key: K) => number | string | null,
  initial: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    const direction = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = accessor(a, sort.key);
      const right = accessor(b, sort.key);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (typeof left === "string" || typeof right === "string") {
        return String(left).localeCompare(String(right)) * direction;
      }
      return (left - right) * direction;
    });
  }, [rows, accessor, sort]);

  const head = (key: K) => ({
    active: sort.key === key,
    desc: sort.desc,
    onSort: () =>
      setSort((current) =>
        current.key === key ? { key, desc: !current.desc } : { key, desc: true },
      ),
  });

  return { sorted, head };
}
