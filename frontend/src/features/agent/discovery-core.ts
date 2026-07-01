import { readFileSync } from "node:fs";
import path from "node:path";

export type DiscoverySource = {
  source: string;
  dir: string;
};

export function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function matchSource<S extends DiscoverySource>(
  resolved: string,
  sources: S[],
): S | undefined {
  return sources.find(
    (item) => isInside(resolved, item.dir) || path.resolve(item.dir) === resolved,
  );
}

export function readCapped(file: string, maxChars: number): string | null {
  try {
    return readFileSync(file, "utf8").slice(0, maxChars).trim();
  } catch {
    return null;
  }
}

export function sortedRows<T extends { name: string }>(byKey: Map<string, T>): T[] {
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
