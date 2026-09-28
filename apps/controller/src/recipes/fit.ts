import type { Gpu, GpuGroup, Recipe, RecipeCatalog, RecipeFit, RecipeRow, RecipeStop, RunningModel } from "@local-studio/contracts";
import type { RuntimeView } from "../context";
import type { Match } from "@local-studio/probe";
import { matchCard, normProduct } from "@local-studio/registry";
import type { LoadedCatalog } from "./registry";
import type { WeightIndex } from "./weights";

export const matchHardware = (hardware: RecipeCatalog["hardware"] | null, backend: string, product: string, memMiB: number): string =>
  (hardware ? matchCard(hardware, backend, product, memMiB)?.hardwareId : undefined) ?? `${backend}-${normProduct(product)}`;

export const hardwareMatch =
  (hardware: RecipeCatalog["hardware"] | null): Match =>
  (backend, product, memMiB) =>
    matchHardware(hardware, backend, product, memMiB);

export const hardwareIds = (g: Gpu, hardware: RecipeCatalog["hardware"]): Set<string> => {
  const out = new Set<string>([`${g.backend}-${normProduct(g.product || g.name)}`]);
  if (g.hardwareId) out.add(g.hardwareId);
  const m = matchHardware(hardware, g.backend, g.product || g.name, g.memTotalMiB);
  if (m) out.add(m);
  return out;
};

export const hardwareOf = (g: Gpu, hardware: RecipeCatalog["hardware"]): string | null => {
  const m = matchHardware(hardware, g.backend, g.product || g.name, g.memTotalMiB);
  return m && hardware.some((h) => h.hardwareId === m) ? m : g.hardwareId ?? m;
};

const keyIndex = (k: string): number => Number(k.split(":")[1] ?? 0);

export const availableKeys = (view: { groups: GpuGroup[] }): Set<string> => {
  const out = new Set<string>();
  for (const g of view.groups) if (g.state === "available") for (const k of g.gpuKeys) out.add(k);
  return out;
};

export const servingModel = (models: RunningModel[], servedName: string): RunningModel | undefined =>
  models.find((m) => m.state === "ready" && (m.servedModels.includes(servedName) || m.primaryModel === servedName));

export interface FitResult {
  fit: RecipeFit;
  freeGroups: string[][];
  hardwareKeys: string[];
}

export const fitFor = (hardwareId: string, cards: number, view: RuntimeView, hardware: RecipeCatalog["hardware"], machines = 1): FitResult => {
  const hardwareKeys = view.gpus
    .filter((g) => hardwareIds(g, hardware).has(hardwareId))
    .sort((a, b) => a.index - b.index)
    .map((g) => g.key);
  if (hardwareKeys.length === 0) return { fit: "no-hardware", freeGroups: [], hardwareKeys };
  if (hardwareKeys.length < cards || machines > 1) return { fit: "too-few-gpus", freeGroups: [], hardwareKeys };
  const avail = availableKeys(view);
  const free = hardwareKeys.filter((k) => avail.has(k)).sort((a, b) => keyIndex(a) - keyIndex(b));
  const freeGroups: string[][] = [];
  for (let i = 0; i + cards <= free.length; i += cards) freeGroups.push(free.slice(i, i + cards));
  return { fit: freeGroups.length > 0 ? "fits" : "busy", freeGroups, hardwareKeys };
};

export const stopsFor = (machineId: string, keys: string[], groups: GpuGroup[]): RecipeStop[] =>
  groups
    .filter((g) => g.state !== "available" && g.gpuKeys.some((k) => keys.includes(k)))
    .flatMap((g) => (g.modelIds.length ? g.modelIds : [g.modelId]).map((modelId) => ({ machineId, gpuKeys: g.gpuKeys.filter((k) => keys.includes(k)), state: g.state as RecipeStop["state"], modelId })));

export interface SelectedMachine {
  machineId: string;
  name: string;
  gpus: Gpu[];
  groups: GpuGroup[];
}

export const fitSelection = (r: Recipe, sel: SelectedMachine[], hardware: RecipeCatalog["hardware"]): { fit: RecipeFit; stops: RecipeStop[] } | null => {
  if (sel.length !== (r.machines ?? 1)) return null;
  for (const m of sel) if (m.gpus.length !== r.cards || !m.gpus.every((g) => hardwareIds(g, hardware).has(r.hardwareId))) return null;
  const stops = sel.flatMap((m) =>
    stopsFor(
      m.machineId,
      m.gpus.map((g) => g.key),
      m.groups,
    ),
  );
  return { fit: stops.length ? "busy" : "fits", stops };
};

export const buildRows = (loaded: LoadedCatalog, view: RuntimeView, weights: WeightIndex): RecipeRow[] => {
  const hw = loaded.catalog.hardware;
  const present = new Set(view.gpus.flatMap((g) => [...hardwareIds(g, hw)]));
  return loaded.catalog.recipes.map((r) => {
    const f = fitFor(r.hardwareId, r.cards, view, hw, r.machines ?? 1);
    const raw = loaded.raw.get(r.id);
    const weightsPresent = present.has(r.hardwareId) && raw ? raw.weights.every((w) => weights.resolve(w).present) : null;
    return { ...r, fit: f.fit, freeGroups: f.freeGroups, runningModelId: servingModel(view.models, r.servedName)?.id ?? null, weightsPresent };
  });
};
