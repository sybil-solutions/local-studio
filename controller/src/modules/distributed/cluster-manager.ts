// CRITICAL
import type {
  DistributedAllocationRecord,
  DistributedNodeRecord,
  DistributedStore,
} from "../../stores/distributed-store";
import type { AppContext } from "../../types/context";
import { Event } from "../monitoring/event-manager";

export interface DistributedNodeView {
  node_id: string;
  label: string | null;
  backend: string | null;
  transport: string | null;
  host: string | null;
  port: number | null;
  capabilities: Record<string, unknown>;
  metrics: Record<string, unknown>;
  status: string;
  last_heartbeat_at: string;
  stale: boolean;
  created_at: string;
  updated_at: string;
}

export interface TopologyIssue {
  type: "overlap" | "gap";
  start_layer: number;
  end_layer: number;
  nodes?: string[];
}

export interface DistributedTopologyView {
  model_id: string;
  total_layers: number | null;
  allocations: DistributedAllocationRecord[];
  issues: TopologyIssue[];
  contiguous: boolean | null;
}

export interface RegisterNodeInput {
  node_id: string;
  label?: string;
  backend?: string;
  transport?: string;
  host?: string;
  port?: number;
  capabilities?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

export interface HeartbeatInput {
  metrics?: Record<string, unknown>;
  status?: string;
}

const parseJsonObject = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const toNodeView = (record: DistributedNodeRecord, staleAfterMs: number): DistributedNodeView => {
  const lastHeartbeatMs = Date.parse(record.last_heartbeat_at);
  const stale = Number.isNaN(lastHeartbeatMs) ? true : Date.now() - lastHeartbeatMs > staleAfterMs;
  return {
    node_id: record.node_id,
    label: record.label,
    backend: record.backend,
    transport: record.transport,
    host: record.host,
    port: record.port,
    capabilities: parseJsonObject(record.capabilities),
    metrics: parseJsonObject(record.metrics),
    status: record.status,
    last_heartbeat_at: record.last_heartbeat_at,
    stale,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
};

/**
 * Distributed node registry + manual layer allocation manager.
 */
export class DistributedClusterManager {
  private readonly context: AppContext;
  private readonly store: DistributedStore;
  private readonly staleAfterMs: number;

  /**
   * Create manager.
   * @param context - App context.
   * @param store - Backing store.
   * @param staleAfterMs - Node staleness threshold.
   */
  public constructor(context: AppContext, store: DistributedStore, staleAfterMs = 30_000) {
    this.context = context;
    this.store = store;
    this.staleAfterMs = staleAfterMs;
  }

  /**
   * Validate node id format.
   * @param nodeId - Node identifier.
   */
  private assertNodeId(nodeId: string): void {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(nodeId)) {
      throw new Error("Invalid node_id format");
    }
  }

  /**
   * Emit node update event to SSE subscribers.
   * @param nodeId - Node identifier.
   */
  private async emitNodeUpdated(nodeId: string): Promise<void> {
    const node = this.store.getNode(nodeId);
    if (!node) return;
    await this.context.eventManager.publish(
      new Event("distributed_node_updated", { node: toNodeView(node, this.staleAfterMs) }),
    );
  }

  /**
   * Emit topology update event for a model.
   * @param modelId - Model identifier.
   */
  private async emitTopologyUpdated(modelId: string): Promise<void> {
    await this.context.eventManager.publish(
      new Event("distributed_topology_updated", { topology: this.getTopology(modelId, null) }),
    );
  }

  /**
   * Register or update a node record.
   * @param input - Registration payload.
   * @returns Normalized node view.
   */
  public async registerNode(input: RegisterNodeInput): Promise<DistributedNodeView> {
    this.assertNodeId(input.node_id);
    const now = new Date().toISOString();
    this.store.upsertNode({
      node_id: input.node_id,
      label: input.label?.trim() || null,
      backend: input.backend?.trim() || null,
      transport: input.transport?.trim() || null,
      host: input.host?.trim() || null,
      port: input.port ?? null,
      capabilities: JSON.stringify(input.capabilities ?? {}),
      metrics: JSON.stringify(input.metrics ?? {}),
      status: "online",
      last_heartbeat_at: now,
    });
    await this.emitNodeUpdated(input.node_id);
    const node = this.store.getNode(input.node_id);
    if (!node) {
      throw new Error("Failed to register node");
    }
    return toNodeView(node, this.staleAfterMs);
  }

  /**
   * Update heartbeat + metrics for an existing node.
   * @param nodeId - Node id.
   * @param input - Heartbeat payload.
   * @returns Updated node view or null if unknown node.
   */
  public async heartbeat(nodeId: string, input: HeartbeatInput): Promise<DistributedNodeView | null> {
    this.assertNodeId(nodeId);
    const now = new Date().toISOString();
    const metrics = JSON.stringify(input.metrics ?? {});
    const status = input.status?.trim() || "online";
    const ok = this.store.touchHeartbeat(nodeId, metrics, status, now);
    if (!ok) {
      return null;
    }
    await this.emitNodeUpdated(nodeId);
    const node = this.store.getNode(nodeId);
    return node ? toNodeView(node, this.staleAfterMs) : null;
  }

  /**
   * List all registered nodes.
   * @returns Node view list.
   */
  public listNodes(): DistributedNodeView[] {
    return this.store.listNodes().map((row) => toNodeView(row, this.staleAfterMs));
  }

  /**
   * Set manual layer allocation for one node/model pair.
   * @param modelId - Model id.
   * @param nodeId - Node id.
   * @param startLayer - Inclusive start.
   * @param endLayer - Exclusive end.
   */
  public async setAllocation(
    modelId: string,
    nodeId: string,
    startLayer: number,
    endLayer: number,
  ): Promise<void> {
    this.assertNodeId(nodeId);
    if (!modelId.trim()) {
      throw new Error("model_id is required");
    }
    if (!Number.isInteger(startLayer) || startLayer < 0) {
      throw new Error("start_layer must be an integer >= 0");
    }
    if (!Number.isInteger(endLayer) || endLayer <= startLayer) {
      throw new Error("end_layer must be an integer > start_layer");
    }
    if (!this.store.getNode(nodeId)) {
      throw new Error(`Unknown node_id: ${nodeId}`);
    }
    const existing = this.store.listAllocations(modelId);
    for (const row of existing) {
      if (row.node_id === nodeId) continue;
      const overlaps = startLayer < row.end_layer && row.start_layer < endLayer;
      if (overlaps) {
        throw new Error(
          `Allocation overlaps with node ${row.node_id} [${row.start_layer}, ${row.end_layer})`,
        );
      }
    }
    this.store.upsertAllocation(modelId, nodeId, startLayer, endLayer);
    await this.emitTopologyUpdated(modelId);
  }

  /**
   * Clear one node's allocation for a model.
   * @param modelId - Model id.
   * @param nodeId - Node id.
   * @returns True if removed.
   */
  public async clearAllocation(modelId: string, nodeId: string): Promise<boolean> {
    this.assertNodeId(nodeId);
    const deleted = this.store.deleteAllocation(modelId, nodeId);
    if (deleted) {
      await this.emitTopologyUpdated(modelId);
    }
    return deleted;
  }

  /**
   * List allocations with optional model filter.
   * @param modelId - Model filter.
   * @returns Allocation list.
   */
  public listAllocations(modelId?: string): DistributedAllocationRecord[] {
    return this.store.listAllocations(modelId);
  }

  /**
   * Validate/inspect topology for one model.
   * @param modelId - Model id.
   * @param totalLayers - Optional expected total layers.
   * @returns Topology view.
   */
  public getTopology(modelId: string, totalLayers: number | null): DistributedTopologyView {
    const allocations = this.store.listAllocations(modelId);
    const issues: TopologyIssue[] = [];
    const sorted = [...allocations].sort((a, b) => a.start_layer - b.start_layer);

    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1];
      if (!current || !next) continue;
      if (current.end_layer > next.start_layer) {
        issues.push({
          type: "overlap",
          start_layer: next.start_layer,
          end_layer: Math.min(current.end_layer, next.end_layer),
          nodes: [current.node_id, next.node_id],
        });
      }
      if (current.end_layer < next.start_layer) {
        issues.push({
          type: "gap",
          start_layer: current.end_layer,
          end_layer: next.start_layer,
        });
      }
    }

    if (totalLayers !== null && Number.isInteger(totalLayers) && totalLayers > 0) {
      const firstStart = sorted[0]?.start_layer ?? 0;
      const lastEnd = sorted.at(-1)?.end_layer ?? 0;
      if (firstStart > 0) {
        issues.push({ type: "gap", start_layer: 0, end_layer: firstStart });
      }
      if (lastEnd < totalLayers) {
        issues.push({ type: "gap", start_layer: lastEnd, end_layer: totalLayers });
      }
    }

    const contiguous =
      totalLayers === null
        ? null
        : issues.length === 0 &&
          sorted.length > 0 &&
          sorted[0]?.start_layer === 0 &&
          sorted.at(-1)?.end_layer === totalLayers;

    return {
      model_id: modelId,
      total_layers: totalLayers,
      allocations,
      issues,
      contiguous,
    };
  }

  /**
   * Return a lightweight cluster status summary.
   * @returns Status payload.
   */
  public getStatus(): Record<string, unknown> {
    const nodes = this.listNodes();
    const stale = nodes.filter((node) => node.stale).length;
    const online = nodes.length - stale;
    const models = Array.from(new Set(this.listAllocations().map((row) => row.model_id))).sort();
    return {
      nodes_total: nodes.length,
      nodes_online: online,
      nodes_stale: stale,
      models,
      updated_at: new Date().toISOString(),
    };
  }
}
