import type { Gpu, RecipeCatalog, RecipeFit, RecipeRow, RunningModel } from "@local-studio/contracts";
import type { RuntimeView } from "../context";
import type { LoadedCatalog } from "./registry";
import { normHardware } from "./util";
import type { WeightIndex } from "./weights";

export const hardwareOf = (g: Gpu, hardware: RecipeCatalog["hardware"]): string | null => {
  if (g.hardwareId) return g.hardwareId;
  const n = normHardware(g.product || g.name);
  const hit = hardware.find((h) => h.match.backend === g.backend && h.match.names.includes(n) && Math.abs(h.match.vramGb * 1024 - g.memTotalMiB) <= 1024);
  return hit?.hardwareId ?? null;
};

const keyIndex = (k: string): number => Number(k.split(":")[1] ?? 0);

export const availableKeys = (view: RuntimeView): Set<string> => {
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

export const fitFor = (hardwareId: string, cards: number, view: RuntimeView, hardware: RecipeCatalog["hardware"]): FitResult => {
  const hardwareKeys = view.gpus
    .filter((g) => hardwareOf(g, hardware) === hardwareId)
    .sort((a, b) => a.index - b.index)
    .map((g) => g.key);
  if (hardwareKeys.length === 0) return { fit: "no-hardware", freeGroups: [], hardwareKeys };
  if (hardwareKeys.length < cards) return { fit: "too-few-gpus", freeGroups: [], hardwareKeys };
  const avail = availableKeys(view);
  const free = hardwareKeys.filter((k) => avail.has(k)).sort((a, b) => keyIndex(a) - keyIndex(b));
  const freeGroups: string[][] = [];
  for (let i = 0; i + cards <= free.length; i += cards) freeGroups.push(free.slice(i, i + cards));
  return { fit: freeGroups.length > 0 ? "fits" : "busy", freeGroups, hardwareKeys };
};

export const buildRows = (loaded: LoadedCatalog, view: RuntimeView, weights: WeightIndex): RecipeRow[] => {
  const hw = loaded.catalog.hardware;
  const present = new Set(view.gpus.map((g) => hardwareOf(g, hw)).filter((x): x is string => !!x));
  return loaded.catalog.recipes.map((r) => {
    const f = fitFor(r.hardwareId, r.cards, view, hw);
    const raw = loaded.raw.get(r.id);
    const weightsPresent = present.has(r.hardwareId) && raw ? raw.weights.every((w) => weights.resolve(w).present) : null;
    return { ...r, fit: f.fit, freeGroups: f.freeGroups, runningModelId: servingModel(view.models, r.servedName)?.id ?? null, weightsPresent };
  });
};
