"use client";

import { useCallback, useRef, useState } from "react";
import { effectTimeout } from "@/lib/effect-timers";
import type { HuggingFaceModel } from "@/lib/types";
import { fetchHuggingFaceModels, isRecentHuggingFaceModel } from "@/lib/huggingface";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const PAGE_SIZE = 50;

export function useHuggingFaceModelSearch(
  search: string,
  configureParams: (params: URLSearchParams, isBrowsing: boolean) => void,
) {
  const [models, setModels] = useState<HuggingFaceModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const requestSequence = useRef(0);

  const fetchModels = useCallback(
    async (append: boolean, pageIndex: number) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        const isBrowsing = search.trim().length === 0;
        if (!isBrowsing) params.set("search", search);
        configureParams(params, isBrowsing);
        params.set("limit", String(PAGE_SIZE));
        params.set("full", "false");
        params.set("offset", String(pageIndex * PAGE_SIZE));
        const data = await fetchHuggingFaceModels(params);
        if (requestId !== requestSequence.current) return;
        const visible = isBrowsing ? data.filter(isRecentHuggingFaceModel) : data;
        if (append) {
          setModels((current) => [...current, ...visible]);
          setPage(pageIndex);
        } else {
          setModels(visible);
          setPage(0);
        }
        setHasMore(data.length === PAGE_SIZE);
      } catch (error) {
        if (requestId === requestSequence.current) setError((error as Error).message);
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    },
    [configureParams, search],
  );

  useMountSubscription(() => {
    setPage(0);
    const timer = effectTimeout(() => void fetchModels(false, 0), 300);
    return () => timer.cancel();
  }, [fetchModels]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) void fetchModels(true, page + 1);
  }, [fetchModels, hasMore, loading, page]);

  return { models, loading, error, hasMore, loadMore, fetchModels };
}
