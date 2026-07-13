export type RigHardwareType =
  | "dgx-spark"
  | "gpu-desktop"
  | "gpu-server"
  | "mac"
  | "laptop"
  | "mini-pc"
  | "custom";

export type RigNodeRole = "head" | "worker" | "standalone";

export type RigNodeSource = "detected" | "manual";

export interface RigAccelerator {
  name: string;
  count: number;
  memory_gb: number | null;
  memory_type: string | null;
  memory_bandwidth_gbs: number | null;
  unified_memory: boolean;
}

export interface RigNode {
  id: string;
  name: string;
  hardware_type: RigHardwareType;
  role: RigNodeRole;
  source: RigNodeSource;
  hostname: string | null;
  address: string | null;
  os: string | null;
  cpu_model: string | null;
  cpu_cores: number | null;
  memory_gb: number | null;
  accelerators: RigAccelerator[];
  notes: string | null;
}

export interface Rig {
  id: string;
  name: string;
  description: string | null;
  nodes: RigNode[];
  created_at: string;
  updated_at: string;
}

export interface RigsPayload {
  rigs: Rig[];
  local_node_id: string;
}

export const RIG_HARDWARE_TYPES: RigHardwareType[] = [
  "dgx-spark",
  "gpu-desktop",
  "gpu-server",
  "mac",
  "laptop",
  "mini-pc",
  "custom",
];

export const RIG_NODE_ROLES: RigNodeRole[] = ["head", "worker", "standalone"];

export const RIG_HARDWARE_TYPE_LABELS: Record<RigHardwareType, string> = {
  "dgx-spark": "DGX Spark",
  "gpu-desktop": "GPU Desktop",
  "gpu-server": "GPU Server",
  mac: "Mac",
  laptop: "Laptop",
  "mini-pc": "Mini PC",
  custom: "Custom",
};

export const RIG_NODE_ROLE_LABELS: Record<RigNodeRole, string> = {
  head: "Head node",
  worker: "Worker node",
  standalone: "Standalone",
};
