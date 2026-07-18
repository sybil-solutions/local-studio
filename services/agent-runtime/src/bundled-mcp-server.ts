import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";

export function resolveBundledMcpServerPath(fileName: string): string | null {
  if (fileName !== "ssh-remote.mjs") return null;
  const packaged = process.env.LOCAL_STUDIO_SSH_REMOTE_MCP_PATH?.trim();
  if (packaged && existsSync(packaged)) return packaged;
  if (process.env.NODE_ENV === "production") return null;
  return (
    [
      path.resolve(process.cwd(), "frontend", "desktop", "resources", "mcp", "ssh-remote.mjs"),
      path.resolve(process.cwd(), "desktop", "resources", "mcp", "ssh-remote.mjs"),
      path.resolve(
        process.cwd(),
        "..",
        "frontend",
        "desktop",
        "resources",
        "mcp",
        "ssh-remote.mjs",
      ),
    ].find(existsSync) ?? null
  );
}

export function resolveExecutablePath(command: string): string | null {
  if (path.isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}
