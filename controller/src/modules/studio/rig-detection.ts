import { arch, cpus, hostname, platform, release, totalmem } from "node:os";
import type { Rig, RigAccelerator, RigHardwareType, RigNode } from "@local-studio/contracts/rigs";
import type { GpuInfo } from "../models/types";
import { Effect } from "effect";
import { getGpuInfo } from "../system/platform/gpu";

export const LOCAL_RIG_NODE_ID = "local";
export const DEFAULT_RIG_ID = "default";

interface KnownAcceleratorSpec {
  pattern: RegExp;
  hardware_type: RigHardwareType;
  memory_type: string;
  memory_bandwidth_gbs: number;
  unified_memory: boolean;
}

const KNOWN_ACCELERATORS: KnownAcceleratorSpec[] = [
  {
    pattern: /\b(?:GB10|DGX Spark)\b/i,
    hardware_type: "dgx-spark",
    memory_type: "LPDDR5X",
    memory_bandwidth_gbs: 273,
    unified_memory: true,
  },
  {
    pattern: /RTX PRO 6000/i,
    hardware_type: "gpu-server",
    memory_type: "GDDR7",
    memory_bandwidth_gbs: 1792,
    unified_memory: false,
  },
  {
    pattern: /RTX 5090/i,
    hardware_type: "gpu-desktop",
    memory_type: "GDDR7",
    memory_bandwidth_gbs: 1792,
    unified_memory: false,
  },
  {
    pattern: /RTX 4090/i,
    hardware_type: "gpu-desktop",
    memory_type: "GDDR6X",
    memory_bandwidth_gbs: 1008,
    unified_memory: false,
  },
  {
    pattern: /RTX 3090/i,
    hardware_type: "gpu-desktop",
    memory_type: "GDDR6X",
    memory_bandwidth_gbs: 936,
    unified_memory: false,
  },
  {
    pattern: /\bApple\b/i,
    hardware_type: "mac",
    memory_type: "unified",
    memory_bandwidth_gbs: 0,
    unified_memory: true,
  },
];

const findKnownAccelerator = (name: string): KnownAcceleratorSpec | null => {
  for (const spec of KNOWN_ACCELERATORS) {
    if (spec.pattern.test(name)) return spec;
  }
  return null;
};

const groupAccelerators = (gpus: GpuInfo[]): RigAccelerator[] => {
  const groups = new Map<string, { count: number; memoryMb: number }>();
  for (const gpu of gpus) {
    const entry = groups.get(gpu.name) ?? { count: 0, memoryMb: gpu.memory_total_mb };
    entry.count += 1;
    groups.set(gpu.name, entry);
  }
  return [...groups.entries()].map(([name, entry]) => {
    const known = findKnownAccelerator(name);
    return {
      name,
      count: entry.count,
      memory_gb: entry.memoryMb > 0 ? Math.round(entry.memoryMb / 1024) : null,
      memory_type: known?.memory_type ?? null,
      memory_bandwidth_gbs:
        known && known.memory_bandwidth_gbs > 0 ? known.memory_bandwidth_gbs : null,
      unified_memory: known?.unified_memory ?? false,
    };
  });
};

const appleSiliconAccelerator = (cpuModel: string | null): RigAccelerator[] => {
  if (platform() !== "darwin" || arch() !== "arm64") return [];
  return [
    {
      name: cpuModel ?? "Apple Silicon",
      count: 1,
      memory_gb: Math.round(totalmem() / 1024 ** 3),
      memory_type: "unified",
      memory_bandwidth_gbs: null,
      unified_memory: true,
    },
  ];
};

const inferHardwareType = (accelerators: RigAccelerator[]): RigHardwareType => {
  for (const accelerator of accelerators) {
    const known = findKnownAccelerator(accelerator.name);
    if (known?.hardware_type === "dgx-spark") return "dgx-spark";
    if (known?.hardware_type === "mac") return "mac";
  }
  const gpuCount = accelerators.reduce((sum, accelerator) => sum + accelerator.count, 0);
  if (gpuCount >= 3) return "gpu-server";
  if (gpuCount >= 1) return "gpu-desktop";
  return "custom";
};

export const buildDetectedNode = (): Effect.Effect<RigNode> =>
  getGpuInfo().pipe(
    Effect.map((gpus) => {
      const cpuList = cpus();
      const cpuModel = cpuList[0]?.model ?? null;
      const gpuAccelerators = groupAccelerators(gpus);
      const accelerators =
        gpuAccelerators.length > 0 ? gpuAccelerators : appleSiliconAccelerator(cpuModel);
      const host = hostname();
      return {
        id: LOCAL_RIG_NODE_ID,
        name: host,
        hardware_type: inferHardwareType(accelerators),
        role: "standalone",
        source: "detected",
        hostname: host,
        address: null,
        os: `${platform()} ${release()}`,
        cpu_model: cpuModel,
        cpu_cores: cpuList.length,
        memory_gb: Math.round(totalmem() / 1024 ** 3),
        accelerators,
        notes: null,
      };
    }),
  );

const mergeDetectedNode = (stored: RigNode, detected: RigNode): RigNode => ({
  ...stored,
  hostname: detected.hostname,
  os: detected.os,
  cpu_model: detected.cpu_model,
  cpu_cores: detected.cpu_cores,
  memory_gb: detected.memory_gb,
  accelerators: detected.accelerators,
});

export const seedDefaultRig = (detected: RigNode): Rig => {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_RIG_ID,
    name: "My Rig",
    description: null,
    nodes: [detected],
    created_at: now,
    updated_at: now,
  };
};

export const refreshLocalNode = (rigs: Rig[], detected: RigNode): Rig | null => {
  for (const rig of rigs) {
    const index = rig.nodes.findIndex((node) => node.id === LOCAL_RIG_NODE_ID);
    if (index < 0) continue;
    const stored = rig.nodes[index];
    if (!stored) continue;
    rig.nodes[index] = mergeDetectedNode(stored, detected);
    return rig;
  }
  return null;
};
