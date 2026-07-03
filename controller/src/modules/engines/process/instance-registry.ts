import type { ProcessManager } from "./process-manager";
import { pidExists } from "./process-utilities";
import type { ProcessInfo } from "../../models/types";

export type InstancePhase = "launching" | "ready";

export interface ModelInstance {
  recipe_id: string;
  port: number;
  pid: number | null;
  phase: InstancePhase;
  started_at: number;
}

export interface InstanceRegistry {
  list: () => ModelInstance[];
  get: (recipeId: string) => ModelInstance | null;
  reserve: (recipeId: string) => number | null;
  attachPid: (recipeId: string, pid: number) => void;
  markReady: (recipeId: string) => void;
  release: (recipeId: string) => ModelInstance | null;
  reconcile: () => Promise<void>;
}

export const createInstanceRegistry = (options: {
  ports: number[];
  processManager: ProcessManager;
  resolveRecipeId: (processInfo: ProcessInfo) => string | null;
}): InstanceRegistry => {
  const entries = new Map<string, ModelInstance>();
  let reconciled = false;

  const pruneDeadPids = (): void => {
    for (const [recipeId, entry] of entries) {
      if (entry.pid !== null && !pidExists(entry.pid)) {
        entries.delete(recipeId);
      }
    }
  };

  const get = (recipeId: string): ModelInstance | null => {
    pruneDeadPids();
    return entries.get(recipeId) ?? null;
  };

  const reserve = (recipeId: string): number | null => {
    pruneDeadPids();
    if (entries.has(recipeId)) return null;
    const usedPorts = new Set<number>();
    for (const entry of entries.values()) {
      usedPorts.add(entry.port);
    }
    for (const port of options.ports) {
      if (!usedPorts.has(port)) {
        entries.set(recipeId, {
          recipe_id: recipeId,
          port,
          pid: null,
          phase: "launching",
          started_at: Date.now(),
        });
        return port;
      }
    }
    return null;
  };

  const attachPid = (recipeId: string, pid: number): void => {
    const entry = entries.get(recipeId);
    if (entry) {
      entry.pid = pid;
    }
  };

  const markReady = (recipeId: string): void => {
    const entry = entries.get(recipeId);
    if (entry) {
      entry.phase = "ready";
    }
  };

  const release = (recipeId: string): ModelInstance | null => {
    const entry = entries.get(recipeId) ?? null;
    if (entry) {
      entries.delete(recipeId);
    }
    return entry;
  };

  const reconcile = async (): Promise<void> => {
    pruneDeadPids();
    const usedPorts = new Set<number>();
    for (const entry of entries.values()) {
      usedPorts.add(entry.port);
    }
    for (const port of options.ports) {
      if (usedPorts.has(port)) continue;
      const proc = await options.processManager.findInferenceProcess(port);
      if (!proc) continue;
      const recipeId = options.resolveRecipeId(proc);
      if (!recipeId) continue;
      entries.set(recipeId, {
        recipe_id: recipeId,
        port,
        pid: proc.pid,
        phase: "ready",
        started_at: Date.now(),
      });
    }
    reconciled = true;
  };

  const list = (): ModelInstance[] => {
    pruneDeadPids();
    if (!reconciled && options.ports.length > 0) {
      void reconcile();
    }
    return [...entries.values()];
  };

  return {
    list,
    get,
    reserve,
    attachPid,
    markReady,
    release,
    reconcile,
  };
};
