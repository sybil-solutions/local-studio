// CRITICAL
import type {
  DistributedAllocation,
  DistributedClusterStatus,
  DistributedNode,
  DistributedTopology,
} from "../types";
import type { ApiCore } from "./core";

export function createDistributedApi(core: ApiCore) {
  return {
    listDistributedNodes: (): Promise<{ nodes: DistributedNode[] }> =>
      core.request("/distributed/nodes"),

    registerDistributedNode: (payload: {
      node_id: string;
      label?: string;
      backend?: string;
      transport?: string;
      host?: string;
      port?: number;
      capabilities?: Record<string, unknown>;
      metrics?: Record<string, unknown>;
    }): Promise<{ node: DistributedNode }> =>
      core.request("/distributed/nodes/register", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    heartbeatDistributedNode: (
      nodeId: string,
      payload: { metrics?: Record<string, unknown>; status?: string } = {},
    ): Promise<{ node: DistributedNode }> =>
      core.request(`/distributed/nodes/${encodeURIComponent(nodeId)}/heartbeat`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    listDistributedAllocations: (modelId?: string): Promise<{ allocations: DistributedAllocation[] }> =>
      core.request(
        modelId
          ? `/distributed/allocations?model_id=${encodeURIComponent(modelId)}`
          : "/distributed/allocations",
      ),

    setDistributedAllocation: (
      nodeId: string,
      payload: { model_id: string; start_layer: number; end_layer: number },
    ): Promise<{ success: boolean }> =>
      core.request(`/distributed/allocations/${encodeURIComponent(nodeId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),

    clearDistributedAllocation: (
      nodeId: string,
      modelId: string,
    ): Promise<{ success: boolean }> =>
      core.request(
        `/distributed/allocations/${encodeURIComponent(nodeId)}?model_id=${encodeURIComponent(modelId)}`,
        { method: "DELETE" },
      ),

    getDistributedTopology: (
      modelId: string,
      totalLayers: number | null = null,
    ): Promise<{ topology: DistributedTopology }> =>
      core.request(
        totalLayers === null
          ? `/distributed/topology/${encodeURIComponent(modelId)}`
          : `/distributed/topology/${encodeURIComponent(modelId)}?total_layers=${totalLayers}`,
      ),

    getDistributedStatus: (): Promise<{ status: DistributedClusterStatus }> =>
      core.request("/distributed/status"),
  };
}
