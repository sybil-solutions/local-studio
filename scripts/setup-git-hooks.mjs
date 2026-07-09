import { execFileSync } from "node:child_process";
import { chmodSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hooksDir = path.join(repoRoot, ".githooks");

const runGit = (args) =>
  execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });

const markHooksExecutable = () => {
  for (const entry of readdirSync(hooksDir)) {
    try {
      chmodSync(path.join(hooksDir, entry), 0o755);
    } catch {
      continue;
    }
  }
};

try {
  runGit(["rev-parse", "--git-dir"]);
  runGit(["config", "core.hooksPath", ".githooks"]);
  markHooksExecutable();
} catch (error) {
  console.error(`[setup-git-hooks] skipped: ${error}`);
  process.exit(0);
}
