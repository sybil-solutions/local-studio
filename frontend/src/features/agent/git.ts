import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GitAction, GitRef, GitState, GitStatusEntry } from "@/features/agent/contracts";

const execFileAsync = promisify(execFile);

export function configuredGitRoots(): string[] {
  const raw = process.env.LOCAL_STUDIO_GIT_DIFF_ROOTS;
  return (raw ? raw.split(path.delimiter) : [os.homedir()])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

export function resolveGitCwd(input: string, roots = configuredGitRoots()): string | null {
  if (!path.isAbsolute(input)) return null;
  const candidate = path.resolve(input);
  return roots.some((root) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
    );
  })
    ? candidate
    : null;
}

export function assertGitCwd(
  input: string | null | undefined,
): { cwd: string; error?: never } | { cwd?: never; error: Response } {
  const requested = input?.trim();
  if (!requested) return { error: Response.json({ error: "cwd is required" }, { status: 400 }) };
  const cwd = resolveGitCwd(requested);
  if (!cwd) return { error: Response.json({ error: "cwd must be absolute" }, { status: 400 }) };
  if (!existsSync(cwd))
    return { error: Response.json({ error: "cwd not found" }, { status: 404 }) };
  return { cwd };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: cleanGitEnv(),
    maxBuffer: 12 * 1024 * 1024,
  });
  return stdout;
}

function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  return env;
}

export async function loadGitState(cwd: string): Promise<GitState> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  if (inside.trim() !== "true") return emptyGitState(false);
  const hasHead = Boolean(
    (await git(cwd, ["rev-parse", "--verify", "HEAD"]).catch(() => "")).trim(),
  );
  const diffArgs = hasHead
    ? ["diff", "--no-ext-diff", "HEAD", "--src-prefix=a/", "--dst-prefix=b/"]
    : ["diff", "--no-ext-diff", "--cached", "--src-prefix=a/", "--dst-prefix=b/"];
  const numstatArgs = hasHead
    ? ["diff", "--numstat", "HEAD", "--"]
    : ["diff", "--numstat", "--cached", "--"];
  const [branch, statusRaw, diff, numstat, untrackedRaw, refsRaw, upstream, remoteUrl] =
    await Promise.all([
      git(cwd, ["branch", "--show-current"]).catch(() => ""),
      git(cwd, ["status", "--short"]),
      git(cwd, diffArgs),
      git(cwd, numstatArgs).catch(() => ""),
      git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).catch(() => ""),
      git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).catch(
        () => "",
      ),
      git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => ""),
      git(cwd, ["remote", "get-url", "origin"]).catch(() => ""),
    ]);
  const current = branch.trim() || null;
  const trackedStats = numstatStats(numstat);
  const untracked = await untrackedFileDiffs(cwd, untrackedRaw);
  const additions = trackedStats.additions + untracked.additions;
  const deletions = trackedStats.deletions + untracked.deletions;
  return {
    isRepo: true,
    branch: current,
    status: statusLines(statusRaw),
    entries: statusEntries(statusRaw),
    // `git diff HEAD` omits untracked (new) files, so a "build me a site"
    // session that creates dozens of new files shows an empty diff while the
    // counter says +N. Append synthesized new-file diffs so the panel reviews
    // them like GitHub does.
    diff: untracked.diff
      ? `${diff}${diff.endsWith("\n") || !diff ? "" : "\n"}${untracked.diff}`
      : diff,
    additions,
    deletions,
    refs: parseRefs(refsRaw, current),
    hasUpstream: Boolean(upstream.trim()),
    remoteUrl: remoteUrl.trim() || null,
    prUrl: pullRequestUrl(remoteUrl.trim(), current),
  };
}

export async function runGitAction(cwd: string, action: GitAction): Promise<GitState> {
  if (action.action === "init") await git(cwd, ["init"]);
  if (action.action === "checkout") await git(cwd, ["switch", action.ref]);
  if (action.action === "createBranch") await git(cwd, ["switch", "-c", action.branch]);
  if (action.action === "commit") {
    await git(cwd, ["add", "--", ...(action.paths.length ? action.paths : ["."])]);
    await git(cwd, ["commit", "-m", action.message]);
  }
  if (action.action === "push") {
    const state = await loadGitState(cwd);
    const branch = state.branch;
    await git(cwd, state.hasUpstream || !branch ? ["push"] : ["push", "-u", "origin", branch]);
  }
  return loadGitState(cwd);
}

function emptyGitState(isRepo: boolean): GitState {
  return {
    isRepo,
    branch: null,
    status: [],
    entries: [],
    diff: "",
    additions: 0,
    deletions: 0,
    refs: [],
    hasUpstream: false,
    remoteUrl: null,
    prUrl: null,
  };
}

function statusLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function statusEntries(raw: string): GitStatusEntry[] {
  return statusLines(raw).map((line) => ({
    code: line.slice(0, 2).trim() || "?",
    path: line.slice(3),
  }));
}

function parseRefs(raw: string, current: string | null): GitRef[] {
  const seen = new Set<string>();
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((name) => {
      if (name.endsWith("/HEAD") || seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((name) => ({ name, current: name === current, remote: name.includes("/") }));
}

export function numstatStats(numstat: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const [added, deleted] = line.split("\t");
    const addedCount = Number.parseInt(added ?? "", 10);
    const deletedCount = Number.parseInt(deleted ?? "", 10);
    if (Number.isFinite(addedCount)) additions += addedCount;
    if (Number.isFinite(deletedCount)) deletions += deletedCount;
  }
  return { additions, deletions };
}

// Per-file and total caps so a session that generates large bundles (e.g. an
// 800KB data.js) can't blow up the diff payload; GitHub collapses huge files
// too. Beyond the cap the file's content is truncated with a marker.
const MAX_UNTRACKED_LINES_PER_FILE = 1000;
const MAX_UNTRACKED_DIFF_BYTES = 1_500_000;

/**
 * Synthesize a unified-diff block for one untracked file so it renders as a
 * GitHub-style "new file" (all additions). Binary files emit a marker instead
 * of their bytes; long files are truncated to MAX_UNTRACKED_LINES_PER_FILE.
 * `additions` is the file's true line count (matching git's working-tree count),
 * not the possibly-truncated number of rendered `+` rows.
 */
export function buildUntrackedFileDiffBlock(
  file: string,
  contents: string,
): { block: string; additions: number } {
  const header = `diff --git a/${file} b/${file}\nnew file mode 100644`;
  if (contents.includes("\0")) {
    return { block: `${header}\nBinary files /dev/null and b/${file} differ\n`, additions: 0 };
  }
  const lines = contents.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const shown = lines.slice(0, MAX_UNTRACKED_LINES_PER_FILE);
  const body = shown.map((line) => `+${line}`).join("\n");
  const truncated =
    lines.length > shown.length ? `\n+… (${lines.length - shown.length} more lines not shown)` : "";
  const block = `${header}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}${truncated}\n`;
  return { block, additions: lines.length };
}

async function untrackedFileDiffs(
  cwd: string,
  raw: string,
): Promise<{ additions: number; deletions: number; diff: string }> {
  const files = raw.split("\0").filter(Boolean);
  let additions = 0;
  let bytes = 0;
  let omitted = 0;
  const blocks: string[] = [];
  for (const file of files) {
    const absolutePath = path.resolve(cwd, file);
    const relative = path.relative(cwd, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    if (bytes >= MAX_UNTRACKED_DIFF_BYTES) {
      omitted += 1;
      continue;
    }
    let contents: string;
    try {
      contents = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }
    const { block, additions: fileAdditions } = buildUntrackedFileDiffBlock(file, contents);
    additions += fileAdditions;
    bytes += block.length;
    blocks.push(block);
  }
  if (omitted > 0) {
    blocks.push(
      `diff --git a/(${omitted} more untracked files) b/(${omitted} more untracked files)\n` +
        `@@ -0,0 +1,1 @@\n+… ${omitted} more untracked file(s) not shown (diff size cap reached)\n`,
    );
  }
  return { additions, deletions: 0, diff: blocks.join("") };
}

function pullRequestUrl(remoteUrl: string, branch: string | null): string | null {
  if (!remoteUrl || !branch) return null;
  const normalized = remoteUrl
    .replace(/^git@github.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  return normalized.startsWith("https://github.com/")
    ? `${normalized}/compare/${encodeURIComponent(branch)}?expand=1`
    : null;
}
