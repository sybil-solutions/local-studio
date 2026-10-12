// Git hook bodies. The files in .githooks/ are symlinks to project.mjs, which
// dispatches here on its invoked basename — the hooks contain no logic of
// their own.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { frontendDir, git, repoRoot, run } from "./lib.mjs";

/**
 * pre-commit: no commits on main/dev, staged changes capped at 15 files and
 * 600 source lines (lockfiles, snapshots, deletions, and the project.mjs
 * entry exempt; skipped during merges), then the fast per-workspace checks
 * for whatever the commit touches.
 */
export function preCommit() {
  const branch = git(["branch", "--show-current"]);
  if (["main", "dev"].includes(branch)) {
    throw Error(`pre-commit: commits on ${branch} are blocked; use a work branch and PR`);
  }
  const stagedOutput = git(["diff", "--cached", "--name-only"]);
  const files = stagedOutput ? stagedOutput.split("\n") : [];
  const activeFiles = files.filter((file) => existsSync(path.join(repoRoot, file)));
  const lines = git(["diff", "--cached", "--numstat"])
    .split("\n")
    .reduce((total, row) => {
      const [added, removed, file] = row.split("\t");
      if (!/^\d+$/.test(added ?? "") || !/^\d+$/.test(removed ?? "")) return total;
      if (
        ["frontend/desktop/project.mjs", "scripts/project.mjs"].includes(file ?? "") ||
        !existsSync(path.join(repoRoot, file ?? "")) ||
        /(^|\/)(package-lock\.json|bun\.lockb?|.*\.snap)$/.test(file ?? "")
      ) {
        return total;
      }
      return total + Number(added) + Number(removed);
    }, 0);

  let mergeInProgress = false;
  try {
    mergeInProgress = Boolean(git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]));
  } catch {
    mergeInProgress = false;
  }
  if (!mergeInProgress && (activeFiles.length > 15 || lines > 600)) {
    throw Error(
      `pre-commit: staged change is too large (${activeFiles.length} files, ${lines} source lines); limit is 15 files and 600 source lines`,
    );
  }
  if (activeFiles.some((file) => /^(frontend|shared)\//.test(file))) {
    run("npm", ["run", "precommit"], frontendDir);
  }
  if (activeFiles.some((file) => file.startsWith("controller/"))) {
    run("bun", ["run", "typecheck"], path.join(repoRoot, "controller"));
  }
}

/**
 * pre-push: no direct pushes to main/dev, conventional commits across every
 * pushed range, then the frontend quality gates and the standalone assertion.
 */
export function prePush() {
  const remote = process.argv[2];
  const url = process.argv[3];
  const updates = readFileSync(0, "utf8").trim();
  for (const update of updates ? updates.split("\n") : []) {
    const [localRef, localSha, remoteRef, remoteSha] = update.trim().split(/\s+/);
    if (["refs/heads/main", "refs/heads/dev"].includes(remoteRef)) {
      throw Error(`pre-push: direct pushes to ${remoteRef} are blocked; merge through GitHub`);
    }
    if (/^0{40}$/.test(localSha)) continue;

    let defaultRef;
    try {
      defaultRef = git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
    } catch {
      defaultRef = `${remote}/main`;
    }
    let excludedRef = defaultRef;
    try {
      const devRef = `${remote}/dev`;
      git(["rev-parse", "--verify", "--quiet", devRef]);
      git(["merge-base", "--is-ancestor", devRef, localSha]);
      excludedRef = devRef;
    } catch {
      // dev unavailable or not an ancestor — keep the default ref.
    }

    let range;
    if (/^0{40}$/.test(remoteSha)) {
      try {
        range = `${git(["merge-base", defaultRef, localSha])}..${localSha}`;
      } catch {
        range = localSha;
      }
    } else {
      range = `${remoteSha}..${localSha}`;
    }

    const checkArgs = [path.join(repoRoot, "scripts/project.mjs"), "check-commits", "--range", range];
    try {
      git(["rev-parse", "--verify", "--quiet", excludedRef]);
      checkArgs.push("--exclude", excludedRef);
    } catch {
      // excluded ref unavailable — lint the whole range.
    }
    console.log(`Checking conventional commits for ${localRef} -> ${remote}/${remoteRef} (${url})`);
    run(process.execPath, checkArgs);
  }
  run("npm", ["run", "check:static"], frontendDir);
  run("npm", ["run", "check:cleanup"], frontendDir);
  run(process.execPath, [path.join(repoRoot, "scripts/project.mjs"), "assert-standalone"]);
}
