"use client";

import { useCallback, useState } from "react";
import api from "@/lib/api/client";
import type { RigNodePayload } from "@/lib/api/rigs";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { Rig, RigsPayload } from "@/lib/types";

const RIGS_CACHE_KEY = "configure:rigs";

export interface ConfigureState {
  rigs: Rig[];
  localNodeId: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createRig: (name: string) => Promise<void>;
  renameRig: (rigId: string, name: string) => Promise<void>;
  describeRig: (rigId: string, description: string) => Promise<void>;
  deleteRig: (rigId: string) => Promise<void>;
  addNode: (rigId: string, payload: RigNodePayload & { name: string }) => Promise<void>;
  updateNode: (rigId: string, nodeId: string, payload: RigNodePayload) => Promise<void>;
  deleteNode: (rigId: string, nodeId: string) => Promise<void>;
}

export function useConfigure(): ConfigureState {
  const [rigsPayload, setRigsPayload] = useState<RigsPayload | null>(() =>
    readPageCache<RigsPayload>(RIGS_CACHE_KEY),
  );
  const [loading, setLoading] = useState(rigsPayload === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const rigs = await api.getRigs();
      writePageCache(RIGS_CACHE_KEY, rigs);
      setRigsPayload(rigs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useMountSubscription(() => {
    void reload();
  }, [reload]);

  const applyRig = useCallback((rig: Rig) => {
    setRigsPayload((current) => {
      if (!current) return current;
      const rigs = current.rigs.some((entry) => entry.id === rig.id)
        ? current.rigs.map((entry) => (entry.id === rig.id ? rig : entry))
        : [...current.rigs, rig];
      const next = { ...current, rigs };
      writePageCache(RIGS_CACHE_KEY, next);
      return next;
    });
  }, []);

  const createRig = useCallback(
    async (name: string) => {
      const result = await api.createRig({ name });
      applyRig(result.rig);
    },
    [applyRig],
  );

  const renameRig = useCallback(
    async (rigId: string, name: string) => {
      const result = await api.updateRig(rigId, { name });
      applyRig(result.rig);
    },
    [applyRig],
  );

  const describeRig = useCallback(
    async (rigId: string, description: string) => {
      const result = await api.updateRig(rigId, { description: description || null });
      applyRig(result.rig);
    },
    [applyRig],
  );

  const deleteRig = useCallback(
    async (rigId: string) => {
      await api.deleteRig(rigId);
      await reload();
    },
    [reload],
  );

  const addNode = useCallback(
    async (rigId: string, payload: RigNodePayload & { name: string }) => {
      const result = await api.addRigNode(rigId, payload);
      applyRig(result.rig);
    },
    [applyRig],
  );

  const updateNode = useCallback(
    async (rigId: string, nodeId: string, payload: RigNodePayload) => {
      const result = await api.updateRigNode(rigId, nodeId, payload);
      applyRig(result.rig);
    },
    [applyRig],
  );

  const deleteNode = useCallback(
    async (rigId: string, nodeId: string) => {
      const result = await api.deleteRigNode(rigId, nodeId);
      applyRig(result.rig);
    },
    [applyRig],
  );

  return {
    rigs: rigsPayload?.rigs ?? [],
    localNodeId: rigsPayload?.local_node_id ?? "local",
    loading,
    refreshing,
    error,
    reload,
    createRig,
    renameRig,
    describeRig,
    deleteRig,
    addNode,
    updateNode,
    deleteNode,
  };
}
