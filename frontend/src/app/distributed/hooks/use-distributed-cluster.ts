// CRITICAL
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import type {
  DistributedAllocation,
  DistributedClusterStatus,
  DistributedNode,
  DistributedTopology,
} from "@/lib/types";

export function useDistributedCluster(modelId: string, totalLayers: number | null) {
  const [nodes, setNodes] = useState<DistributedNode[]>([]);
  const [status, setStatus] = useState<DistributedClusterStatus | null>(null);
  const [allocations, setAllocations] = useState<DistributedAllocation[]>([]);
  const [topology, setTopology] = useState<DistributedTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }
      try {
        const [statusResponse, nodesResponse] = await Promise.all([
          api.getDistributedStatus(),
          api.listDistributedNodes(),
        ]);
        setStatus(statusResponse.status);
        setNodes(nodesResponse.nodes ?? []);

        const scopeModelId = modelId.trim();
        if (!scopeModelId) {
          setAllocations([]);
          setTopology(null);
          setError(null);
          return;
        }

        const [allocationsResponse, topologyResponse] = await Promise.all([
          api.listDistributedAllocations(scopeModelId),
          api.getDistributedTopology(scopeModelId, totalLayers),
        ]);
        setAllocations(allocationsResponse.allocations ?? []);
        setTopology(topologyResponse.topology ?? null);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [modelId, totalLayers],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const onDistributedEvent = () => {
      if (refreshTimerRef.current) {
        return;
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void load(true);
      }, 200);
    };
    window.addEventListener("vllm:distributed-event", onDistributedEvent as EventListener);
    return () => {
      window.removeEventListener("vllm:distributed-event", onDistributedEvent as EventListener);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [load]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void load(true);
    }, 10_000);
    return () => {
      clearInterval(intervalId);
    };
  }, [load]);

  return {
    nodes,
    status,
    allocations,
    topology,
    loading,
    error,
    refresh: () => load(false),
  };
}
