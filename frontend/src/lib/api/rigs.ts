import type { Rig, RigNode, RigsPayload } from "../types";
import type { ApiCore } from "./core";

export interface RigNodePayload {
  name?: string;
  hardware_type?: string;
  role?: string;
  hostname?: string | null;
  address?: string | null;
  os?: string | null;
  cpu_model?: string | null;
  memory_gb?: number | null;
  accelerators?: Array<{
    name: string;
    count: number;
    memory_gb: number | null;
    memory_type?: string | null;
    memory_bandwidth_gbs?: number | null;
    unified_memory?: boolean;
  }>;
  notes?: string | null;
}

export function createRigsApi(core: ApiCore) {
  return {
    getRigs: (): Promise<RigsPayload> => core.rpcJson(core.rpc.studio.rigs.$get()),

    createRig: (payload: {
      name: string;
      description?: string | null;
    }): Promise<{ success: boolean; rig: Rig }> =>
      core.rpcJson(
        core.rpc.studio.rigs.$post(undefined, { init: { body: JSON.stringify(payload) } }),
      ),

    updateRig: (
      id: string,
      payload: { name?: string; description?: string | null },
    ): Promise<{ success: boolean; rig: Rig }> =>
      core.rpcJson(
        core.rpc.studio.rigs[":rigId"].$put(
          { param: { rigId: id } },
          { init: { body: JSON.stringify(payload) } },
        ),
      ),

    deleteRig: (id: string): Promise<{ success: boolean }> =>
      core.rpcJson(core.rpc.studio.rigs[":rigId"].$delete({ param: { rigId: id } })),

    addRigNode: (
      rigId: string,
      payload: RigNodePayload & { name: string },
    ): Promise<{ success: boolean; rig: Rig; node: RigNode }> =>
      core.rpcJson(
        core.rpc.studio.rigs[":rigId"].nodes.$post(
          { param: { rigId } },
          { init: { body: JSON.stringify(payload) } },
        ),
      ),

    updateRigNode: (
      rigId: string,
      nodeId: string,
      payload: RigNodePayload,
    ): Promise<{ success: boolean; rig: Rig; node: RigNode }> =>
      core.rpcJson(
        core.rpc.studio.rigs[":rigId"].nodes[":nodeId"].$put(
          { param: { rigId, nodeId } },
          { init: { body: JSON.stringify(payload) } },
        ),
      ),

    deleteRigNode: (rigId: string, nodeId: string): Promise<{ success: boolean; rig: Rig }> =>
      core.rpcJson(
        core.rpc.studio.rigs[":rigId"].nodes[":nodeId"].$delete({
          param: { rigId, nodeId },
        }),
      ),
  };
}
