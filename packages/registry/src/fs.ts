import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { load } from "./index";
import type { Tree } from "./types";

export const readFiles = (root: string): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p).split("\\").join("/"), readFileSync(p, "utf8"));
    }
  };
  walk(join(root, "registry"));
  return out;
};

export const readTree = (root: string): { tree: Tree; sizes: Map<string, number> } => {
  const files = readFiles(root);
  const sizes = new Map([...files].filter(([p]) => p.startsWith("registry/recipes/")).map(([p, t]) => [p, Buffer.byteLength(t)]));
  return { tree: load(files), sizes };
};
