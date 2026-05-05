import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function configuredRoots(): string[] {
  const raw = process.env.VLLM_STUDIO_GIT_DIFF_ROOTS;
  if (!raw) return [path.resolve(os.homedir())];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveAllowedWorkingDirectory(input: string, roots: string[]): string | null {
  if (!path.isAbsolute(input)) return null;
  const candidate = path.resolve(input);
  return roots.some((root) => isWithinRoot(candidate, root)) ? candidate : null;
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 12 * 1024 * 1024,
  });
  return stdout;
}

function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

export async function GET(request: NextRequest) {
  const requestedCwd = request.nextUrl.searchParams.get("cwd")?.trim();
  if (!requestedCwd) return Response.json({ error: "cwd is required" }, { status: 400 });
  const cwd = resolveAllowedWorkingDirectory(requestedCwd, configuredRoots());
  if (!cwd) return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  if (!existsSync(cwd)) return Response.json({ error: "cwd not found" }, { status: 404 });

  try {
    const inside = (await git(cwd, ["rev-parse", "--is-inside-work-tree"])).trim();
    if (inside !== "true") return Response.json({ isRepo: false, status: [], diff: "" });

    const [branch, statusRaw, diff] = await Promise.all([
      git(cwd, ["branch", "--show-current"]).catch(() => ""),
      git(cwd, ["status", "--short"]),
      git(cwd, ["diff", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"]),
    ]);

    return Response.json({
      isRepo: true,
      branch: branch.trim() || null,
      status: statusRaw
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean),
      diff,
      ...diffStats(diff),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load git diff" },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const requestedCwd = request.nextUrl.searchParams.get("cwd")?.trim();
  if (!requestedCwd) return Response.json({ error: "cwd is required" }, { status: 400 });
  const cwd = resolveAllowedWorkingDirectory(requestedCwd, configuredRoots());
  if (!cwd) return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  if (!existsSync(cwd)) return Response.json({ error: "cwd not found" }, { status: 404 });

  try {
    await git(cwd, ["init"]);
    const branch = await git(cwd, ["branch", "--show-current"]).catch(() => "");
    return Response.json({ ok: true, isRepo: true, branch: branch.trim() || null });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to initialize git repository" },
      { status: 400 },
    );
  }
}
