// CRITICAL
/**
 * Distributed cluster state surfaced by the controller.
 */

export interface DistributedNode {
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

export interface DistributedAllocation {
  model_id: string;
  node_id: string;
  start_layer: number;
  end_layer: number;
  updated_at: string;
}

export interface DistributedTopologyIssue {
  type: "overlap" | "gap";
  start_layer: number;
  end_layer: number;
  nodes?: string[];
}

export interface DistributedTopology {
  model_id: string;
  total_layers: number | null;
  allocations: DistributedAllocation[];
  issues: DistributedTopologyIssue[];
  contiguous: boolean | null;
}

export interface DistributedClusterStatus {
  nodes_total: number;
  nodes_online: number;
  nodes_stale: number;
  models: string[];
  updated_at: string;
}
