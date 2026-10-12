import { existsSync } from "node:fs";
import path from "node:path";

// Bundled desktop resources live at <repo>/frontend/desktop/resources/<kind>/.
// Resolution has to work from every working directory the runtime is started
// from: the repo root (dev), frontend/ (next build), services/agent-runtime
// (the deployed systemd unit), and frontend/.next/standalone/frontend (the
// standalone server `npm run start` spawns). A fixed candidate list only ever
// covers the directories someone remembered, so walk up instead.
export function resolveBundledResource(...segments: string[]): string | null {
  // The desktop shell forks this runtime as a plain Node child, where
  // Electron's `process.resourcesPath` does NOT exist — it forwards the same
  // path via env instead.
  const resourcesRoot = process.env.LOCAL_STUDIO_RESOURCES_PATH?.trim() || process.resourcesPath;
  if (resourcesRoot) {
    const packaged = path.join(resourcesRoot, "desktop", "resources", ...segments);
    if (existsSync(packaged)) return packaged;
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    for (const prefix of [
      ["frontend", "desktop", "resources"],
      ["desktop", "resources"],
    ]) {
      const candidate = path.join(dir, ...prefix, ...segments);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveBundledPluginDirectory(): string | null {
  return resolveBundledResource("plugins");
}
