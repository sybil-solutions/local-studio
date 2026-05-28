import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GitAction, GitRef, GitState, GitStatusEntry } from "@/lib/agent/contracts/git";

const execFileAsync = promisify(execFile);

export function configuredGitRoots(): string[] {
  const raw = process.env.VLLM_STUDIO_GIT_DIFF_ROOTS;
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
  const untrackedStats = await untrackedFileStats(cwd, untrackedRaw);
  const additions = trackedStats.additions + untrackedStats.additions;
  const deletions = trackedStats.deletions + untrackedStats.deletions;
  return {
    isRepo: true,
    branch: current,
    status: statusLines(statusRaw),
    entries: statusEntries(statusRaw),
    diff,
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

async function untrackedFileStats(
  cwd: string,
  raw: string,
): Promise<{ additions: number; deletions: number }> {
  const files = raw.split("\0").filter(Boolean);
  const additions = await files.reduce(async (pending, file) => {
    const count = await pending;
    const absolutePath = path.resolve(cwd, file);
    const relative = path.relative(cwd, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return count;
    try {
      const contents = await readFile(absolutePath, "utf8");
      if (!contents) return count;
      return count + contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0);
    } catch {
      return count;
    }
  }, Promise.resolve(0));
  return { additions, deletions: 0 };
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
