"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import type { UsageStats } from "@/lib/types";
import { normalizeUsageStats } from "@/features/usage/normalize-usage-stats";

export function useUsage() {
  const [stats, setStats] = useState<UsageStats | null>(() =>
    readPageCache<UsageStats>("usage:stats:provider"),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadStats = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      setLoading(true);
      setError(null);
      const normalized = normalizeUsageStats(await api.getUsageStats());
      if (requestId !== requestSequence.current) return;
      writePageCache("usage:stats:provider", normalized);
      setStats(normalized);
    } catch (cause) {
      if (requestId === requestSequence.current) setError((cause as Error).message);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  useMountSubscription(() => {
    setStats(readPageCache<UsageStats>("usage:stats:provider"));
    void loadStats();
  }, [loadStats]);

  return { stats, loading, error, loadStats };
}
