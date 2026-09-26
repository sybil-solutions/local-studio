import { FOREIGN_USED_MIB } from "@local-studio/contracts";
import type { Gpu, GpuGroup, RunningModel } from "@local-studio/contracts";

export const computeGroups = (gpus: Gpu[], models: RunningModel[]): GpuGroup[] => {
  const index = new Map(gpus.map((g) => [g.key, g.index]));
  const claimed = new Map<string, GpuGroup>();
  const groups: GpuGroup[] = [];
  for (const m of models) {
    const keys = m.gpuKeys.filter((k) => index.has(k));
    if (!keys.length) continue;
    const state = m.state === "ready" ? "running" : "busy";
    const existing = keys.map((k) => claimed.get(k)).find((g) => !!g);
    if (existing) {
      for (const k of keys) if (!existing.gpuKeys.includes(k)) existing.gpuKeys.push(k);
      existing.note = `${existing.note}; ${m.primaryModel} ${m.state}`;
      if (!existing.modelIds.includes(m.id)) existing.modelIds.push(m.id);
      if (state === "busy") existing.state = "busy";
      existing.kind = existing.gpuKeys.length > 1 ? "grouped" : "alone";
      for (const k of keys) claimed.set(k, existing);
      continue;
    }
    const g: GpuGroup = {
      id: `model:${m.id}`,
      gpuKeys: [...keys],
      kind: keys.length > 1 ? "grouped" : "alone",
      state,
      modelId: m.id,
      modelIds: [m.id],
      note: `${m.primaryModel} ${m.state}`,
    };
    groups.push(g);
    for (const k of keys) claimed.set(k, g);
  }
  for (const g of groups) g.gpuKeys.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
  for (const gpu of gpus) {
    if (claimed.has(gpu.key)) continue;
    const foreign =
      gpu.processes.some((p) => !p.modelId && (p.usedMiB === null || p.usedMiB > FOREIGN_USED_MIB / 2)) ||
      (!gpu.unified && gpu.memUsedMiB !== null && gpu.memUsedMiB > FOREIGN_USED_MIB);
    groups.push({
      id: `gpu:${gpu.key}`,
      gpuKeys: [gpu.key],
      kind: "alone",
      state: foreign ? "foreign" : "available",
      modelId: null,
      modelIds: [],
      note: foreign ? "in use by another program" : "free",
    });
  }
  const first = (g: GpuGroup) => Math.min(...g.gpuKeys.map((k) => index.get(k) ?? 0));
  return groups.sort((a, b) => first(a) - first(b));
};
