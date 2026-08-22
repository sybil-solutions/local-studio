"use client";

import { useCallback } from "react";
import api from "@/lib/api/client";
import type { RigNodePayload } from "@/lib/api/rigs";
import { writePageCache } from "@/lib/page-data-cache";
import { usePageResource } from "@/hooks/use-page-resource";
import type { Rig, RigsPayload } from "@/lib/types";

const RIGS_CACHE_KEY = "configure:rigs";

export interface ConfigureState {
  rigs: Rig[];
  localNodeId: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<RigsPayload | null>;
  createRig: (name: string) => Promise<Rig>;
  deleteRig: (rigId: string) => Promise<void>;
  addNode: (rigId: string, payload: RigNodePayload & { name: string }) => Promise<void>;
  updateNode: (rigId: string, nodeId: string, payload: RigNodePayload) => Promise<void>;
  deleteNode: (rigId: string, nodeId: string) => Promise<void>;
}

export function useConfigure(): ConfigureState {
  const load = useCallback(() => api.getRigs(), []);
  const {
    data: rigsPayload,
    setData: setRigsPayload,
    loading,
    refreshing,
    error,
    reload,
  } = usePageResource<RigsPayload>(RIGS_CACHE_KEY, load);

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
  }, [setRigsPayload]);

  const createRig = useCallback(
    async (name: string) => {
      const result = await api.createRig({ name });
      applyRig(result.rig);
      return result.rig;
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
    deleteRig,
    addNode,
    updateNode,
    deleteNode,
  };
}
