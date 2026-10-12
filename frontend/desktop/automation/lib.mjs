// Shared plumbing for the automation modules. Everything here is deliberately
// boring: repo-root resolution, arg parsing, and child-process wrappers that
// fail loudly. The modules in this directory are plain ESM with no import-time
// side effects — each exports functions the project.mjs entry dispatches to.

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

/** Repo root: this file lives at frontend/desktop/automation/lib.mjs. */
export const repoRoot = path.resolve(import.meta.dirname, "../../..");
export const frontendDir = path.join(repoRoot, "frontend");

/** The value following a --flag in an argv slice, or undefined. */
export function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** Run a command inheriting stdio; exit the process with its status on failure. */
export function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Run a command and return its trimmed stdout; throws on failure. */
export function commandOutput(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  }).trim();
}

export function git(args, options = {}) {
  return commandOutput("git", args, options);
}

/**
 * Manual walks, NOT readdirSync({recursive:true}): recursive readdir follows
 * symlinked directories, so one self-referential symlink in node_modules
 * expands forever and the build dies OOM. Dirent.isDirectory() is false for
 * symlinks, so these never descend through one.
 */
export function walkUnder(readdirSync, directory, keep) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkUnder(readdirSync, target, keep));
    else if (keep(entry)) found.push(target);
  }
  return found;
}
