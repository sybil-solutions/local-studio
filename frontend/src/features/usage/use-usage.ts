"use client";

import { useCallback } from "react";
import { normalizeUsageStats } from "@local-studio/contracts/usage";
import api from "@/lib/api/client";
import { usePageResource } from "@/hooks/use-page-resource";
import type { UsageStats } from "@/lib/types";

export function useUsage() {
  const load = useCallback(async () => normalizeUsageStats(await api.getUsageStats()), []);
  const { data, loading, refreshing, error, reload } = usePageResource<UsageStats>(
    "usage:stats:provider",
    load,
  );

  return { stats: data, loading: loading || refreshing, error, loadStats: reload };
}
