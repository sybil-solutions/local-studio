import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "../context";
import type { V2Weights } from "./registry";

export type WeightSource = "local" | "map" | "models-dir" | "hf-metadata" | "canonical" | "hf-cache" | "missing";

export interface ResolvedWeight {
  repository: string;
  revision: string;
  layout: "dir" | "hub";
  mountPath: string;
  hostPath: string;
  present: boolean;
  source: WeightSource;
  hint: string | null;
}

interface DirEntry {
  name: string;
  path: string;
  hfRevision: string | null;
}

export interface WeightIndex {
  resolve(w: V2Weights): ResolvedWeight;
}

const hfHome = (): string => process.env.HF_HOME ?? join(homedir(), ".cache", "huggingface");

const firstLine = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8").split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
};

const readMap = (home: string): Record<string, string> => {
  try {
    const m = JSON.parse(readFileSync(join(home, "weights.json"), "utf8")) as unknown;
    return m && typeof m === "object" ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const holds = (p: string, w: V2Weights): boolean => {
  if (w.files) return existsSync(join(p, w.files));
  if (w.dir) return isDir(join(p, w.dir));
  return existsSync(join(p, "config.json")) || existsSync(join(p, "model.safetensors.index.json"));
};

export const canonicalDir = (modelsDir: string, w: { repository: string; revision: string }): string =>
  join(modelsDir, `${w.repository.replace("/", "--")}@${w.revision.slice(0, 12)}`);

export const hfSnapshot = (w: { repository: string; revision: string }): string =>
  join(hfHome(), "hub", `models--${w.repository.replace("/", "--")}`, "snapshots", w.revision);

export const hfRevisionOf = (dir: string): string | null => {
  for (const f of ["config.json", "README.md", "model.safetensors.index.json"]) {
    const line = firstLine(join(dir, ".cache", "huggingface", "download", `${f}.metadata`));
    if (line && /^[0-9a-f]{40}$/.test(line)) return line;
  }
  return null;
};

export const createWeightIndex = (ctx: Ctx): WeightIndex => {
  const map = readMap(ctx.config.home);
  let entries: DirEntry[] | null = null;
  const list = (): DirEntry[] => {
    if (entries) return entries;
    try {
      entries = readdirSync(ctx.config.modelsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() || d.isSymbolicLink())
        .map((d) => {
          const path = join(ctx.config.modelsDir, d.name);
          return { name: d.name, path, hfRevision: hfRevisionOf(path) };
        });
    } catch {
      entries = [];
    }
    return entries;
  };

  const resolve = (w: V2Weights): ResolvedWeight => {
    const base = { repository: w.repository, revision: w.revision, layout: w.layout, mountPath: w.mountPath };
    if (w.hostPath) {
      let present = false;
      try {
        present = readdirSync(w.hostPath).some((f) => /\.(safetensors|gguf|bin|pt)$/.test(f));
      } catch {}
      return { ...base, hostPath: w.hostPath, present, source: present ? "local" : "missing", hint: present ? null : `${w.hostPath} is missing` };
    }
    if (w.layout === "hub") {
      const snap = hfSnapshot(w);
      const present = isDir(snap) && (w.files ? existsSync(join(snap, w.files)) : true);
      return {
        ...base,
        hostPath: hfHome(),
        present,
        source: present ? "hf-cache" : "missing",
        hint: present ? null : `hf download ${w.repository} --revision ${w.revision}`,
      };
    }
    const mapped = map[`${w.repository}@${w.revision}`];
    if (mapped && holds(mapped, w)) return { ...base, hostPath: mapped, present: true, source: "map", hint: null };
    const short = w.revision.slice(0, 7);
    const byName = list().find((e) => e.name.includes(short) && holds(e.path, w));
    if (byName) return { ...base, hostPath: byName.path, present: true, source: "models-dir", hint: null };
    const byMeta = list().find((e) => e.hfRevision === w.revision && holds(e.path, w));
    if (byMeta) return { ...base, hostPath: byMeta.path, present: true, source: "hf-metadata", hint: null };
    const canon = canonicalDir(ctx.config.modelsDir, w);
    if (holds(canon, w)) return { ...base, hostPath: canon, present: true, source: "canonical", hint: null };
    const snap = hfSnapshot(w);
    if (holds(snap, w)) return { ...base, hostPath: snap, present: true, source: "hf-cache", hint: null };
    const include = w.files ? ` --include ${w.files}` : "";
    return {
      ...base,
      hostPath: canon,
      present: false,
      source: "missing",
      hint: `hf download ${w.repository} --revision ${w.revision}${include} --local-dir ${canon}`,
    };
  };

  return { resolve };
};
