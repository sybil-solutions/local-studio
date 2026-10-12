import { existsSync } from "node:fs";
import path from "node:path";

// Where the `gh` CLI is on this machine, if anywhere.
//
// The github extension is a thin wrapper over `gh`, so loading it where no gh
// exists would advertise a dozen tools that all fail the same way. Presence is
// the gate; being signed in is a separate question the extension's
// `github_status` tool asks at call time, because a token can expire between
// session start and the call that needs it.
//
// Resolved by walking PATH rather than spawning `gh --version`: this runs on
// every session start. The resolved path is then handed to the extension, so
// the tool calls run the same binary this check found instead of trusting the
// child's PATH to agree.

let cached: string | null | undefined;

function searchPath(): string[] {
  const fromEnv = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  // A packaged desktop app is launched by the window server with a minimal
  // PATH, so the Homebrew/MacPorts locations a user installed gh into are not
  // on it. Probe them too rather than reporting gh missing on a machine that
  // plainly has it.
  return [...fromEnv, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/opt/local/bin"];
}

function locateGithubCli(): string | null {
  const override = process.env.LOCAL_STUDIO_GH_PATH?.trim();
  if (override) return existsSync(override) ? override : null;
  const binary = process.platform === "win32" ? "gh.exe" : "gh";
  for (const dir of searchPath()) {
    const candidate = path.join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function githubCliPathSync(): string | null {
  if (cached === undefined) cached = locateGithubCli();
  return cached;
}

export function hasGithubCliSync(): boolean {
  return githubCliPathSync() !== null;
}
