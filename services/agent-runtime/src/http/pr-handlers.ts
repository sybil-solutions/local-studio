// HTTP surface for GitHub pull-request info, backed by the `gh` CLI. Every
// call runs `gh` with cwd pinned to the request's validated project workspace
// (same allowlist as the session/git handlers) and array-form args (no shell),
// so a project path can never inject flags. Missing gh, an unauthenticated
// gh, or a non-repo cwd all come back as clean 200s carrying {error} so the
// panel can render a friendly empty state instead of a 500.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  AGENT_TURN_BODY_LIMIT_BYTES,
  readJsonRequestWithinLimit,
} from "../../../../shared/agent/agent-turn-body";
import { resolveAllowedWorkspace } from "../projects-store";
import { errorMessage, jsonError } from "./helpers";

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 15_000;
const GH_MAX_BUFFER = 4 * 1024 * 1024;
const PR_MERGE_BODY_LIMIT_BYTES = Math.min(AGENT_TURN_BODY_LIMIT_BYTES, 64 * 1024);
const MERGE_METHODS = new Set(["merge", "squash", "rebase"]);

const PR_VIEW_FIELDS = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "headRefName",
  "baseRefName",
  "additions",
  "deletions",
  "reviewRequests",
  "reviews",
  "comments",
  "body",
  "mergeable",
  "statusCheckRollup",
].join(",");

const PR_LIST_FIELDS = ["number", "title", "headRefName", "updatedAt", "isDraft"].join(",");

// ─── Pure normalizers (unit-tested; no gh involved) ───────────────────────

export type CheckBucket = "pending" | "passing" | "failing";

export type PrCheck = {
  name: string;
  status: string;
  conclusion: string | null;
  bucket: CheckBucket;
};

export type PrChecksSummary = {
  pending: number;
  passing: number;
  failing: number;
  total: number;
};

const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const PASSING_STATES = new Set(["SUCCESS"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Classify a single rollup entry into a coarse status bucket. */
function classifyCheck(entry: Record<string, unknown>): CheckBucket {
  // Legacy commit status contexts carry `state`; Actions check runs carry a
  // `status`/`conclusion` pair. Handle whichever is present.
  const state = asString(entry.state)?.toUpperCase();
  if (state) {
    if (PASSING_STATES.has(state)) return "passing";
    if (PENDING_STATES.has(state)) return "pending";
    return "failing";
  }
  const status = asString(entry.status)?.toUpperCase();
  if (status && status !== "COMPLETED") return "pending";
  const conclusion = asString(entry.conclusion)?.toUpperCase();
  if (!conclusion) return "pending";
  return PASSING_CONCLUSIONS.has(conclusion) ? "passing" : "failing";
}

/** statusCheckRollup → normalized checks plus pending/passing/failing counts. */
export function normalizeChecks(rollup: unknown): {
  checks: PrCheck[];
  summary: PrChecksSummary;
} {
  const entries = Array.isArray(rollup) ? rollup : [];
  const summary: PrChecksSummary = { pending: 0, passing: 0, failing: 0, total: 0 };
  const checks: PrCheck[] = [];
  for (const raw of entries) {
    const entry = asRecord(raw);
    const name = asString(entry.name) ?? asString(entry.context) ?? "check";
    const status = asString(entry.status) ?? asString(entry.state) ?? "UNKNOWN";
    const conclusion = asString(entry.conclusion);
    const bucket = classifyCheck(entry);
    summary[bucket] += 1;
    summary.total += 1;
    checks.push({ name, status, conclusion, bucket });
  }
  return { checks, summary };
}

function normalizeReviewers(reviewRequests: unknown): string[] {
  const entries = Array.isArray(reviewRequests) ? reviewRequests : [];
  const names: string[] = [];
  for (const raw of entries) {
    const entry = asRecord(raw);
    const name = asString(entry.login) ?? asString(entry.name) ?? asString(entry.slug);
    if (name) names.push(name);
  }
  return names;
}

export type NormalizedPr = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  reviewers: string[];
  commentsCount: number;
  body: string;
  mergeable: string;
  checks: PrCheck[];
  checksSummary: PrChecksSummary;
};

function asInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `gh pr view --json …` payload → the shape the panel consumes. */
export function normalizePrView(raw: unknown): NormalizedPr {
  const pr = asRecord(raw);
  const { checks, summary } = normalizeChecks(pr.statusCheckRollup);
  return {
    number: asInt(pr.number),
    title: asString(pr.title) ?? "",
    url: asString(pr.url) ?? "",
    state: asString(pr.state) ?? "UNKNOWN",
    isDraft: pr.isDraft === true,
    headRefName: asString(pr.headRefName) ?? "",
    baseRefName: asString(pr.baseRefName) ?? "",
    additions: asInt(pr.additions),
    deletions: asInt(pr.deletions),
    reviewers: normalizeReviewers(pr.reviewRequests),
    commentsCount: asArray(pr.comments).length,
    body: typeof pr.body === "string" ? pr.body : "",
    mergeable: asString(pr.mergeable) ?? "UNKNOWN",
    checks,
    checksSummary: summary,
  };
}

export type PrListItem = {
  number: number;
  title: string;
  headRefName: string;
  updatedAt: string;
  isDraft: boolean;
};

export function normalizePrList(raw: unknown): PrListItem[] {
  return asArray(raw).map((item) => {
    const entry = asRecord(item);
    return {
      number: asInt(entry.number),
      title: asString(entry.title) ?? "",
      headRefName: asString(entry.headRefName) ?? "",
      updatedAt: asString(entry.updatedAt) ?? "",
      isDraft: entry.isDraft === true,
    };
  });
}

// ─── gh execution ─────────────────────────────────────────────────────────

type GhFailure = { code: string | null; stderr: string; message: string };

function ghFailure(error: unknown): GhFailure {
  const err = asRecord(error);
  return {
    code: typeof err.code === "string" ? err.code : null,
    stderr: typeof err.stderr === "string" ? err.stderr : "",
    message: error instanceof Error ? error.message : "gh command failed",
  };
}

async function runGh(args: string[], cwd: string): Promise<{ stdout: string }> {
  return execFileAsync("gh", args, {
    cwd,
    timeout: GH_TIMEOUT_MS,
    maxBuffer: GH_MAX_BUFFER,
    windowsHide: true,
  });
}

function friendlyGhError(failure: GhFailure): string {
  if (failure.code === "ENOENT") {
    return "GitHub CLI (gh) is not installed. Install it to view pull requests.";
  }
  const stderr = failure.stderr.trim();
  if (/gh auth login/i.test(stderr) || /not logged into/i.test(stderr)) {
    return "GitHub CLI is not authenticated. Run `gh auth login` in a terminal.";
  }
  if (stderr) return stderr.split("\n")[0] ?? failure.message;
  return failure.message;
}

function isNoPullRequest(stderr: string): boolean {
  return /no pull requests? found/i.test(stderr) || /no open pull requests/i.test(stderr);
}

function validateCwd(rawCwd: string | null): string | Response {
  const trimmed = rawCwd?.trim() ?? "";
  if (!trimmed) return jsonError("cwd is required");
  if (!path.isAbsolute(trimmed)) return jsonError("cwd must be absolute");
  try {
    return resolveAllowedWorkspace(trimmed);
  } catch (error) {
    return jsonError(errorMessage(error, "cwd is not an allowed workspace"), 403);
  }
}

// ─── GET /api/agent/pr ─────────────────────────────────────────────────────

export async function handlePrGet(request: Request): Promise<Response> {
  const cwd = validateCwd(new URL(request.url).searchParams.get("cwd"));
  if (cwd instanceof Response) return cwd;

  try {
    const { stdout } = await runGh(["pr", "view", "--json", PR_VIEW_FIELDS], cwd);
    const parsed = JSON.parse(stdout) as unknown;
    return Response.json({ pr: normalizePrView(parsed) });
  } catch (error) {
    const failure = ghFailure(error);
    if (failure.code === "ENOENT") {
      return Response.json({ error: friendlyGhError(failure) });
    }
    if (isNoPullRequest(failure.stderr)) {
      return listPullRequests(cwd);
    }
    return Response.json({ error: friendlyGhError(failure) });
  }
}

async function listPullRequests(cwd: string): Promise<Response> {
  try {
    const { stdout } = await runGh(
      ["pr", "list", "--json", PR_LIST_FIELDS, "--limit", "20"],
      cwd,
    );
    const parsed = JSON.parse(stdout) as unknown;
    return Response.json({ prs: normalizePrList(parsed) });
  } catch (error) {
    return Response.json({ error: friendlyGhError(ghFailure(error)) });
  }
}

// ─── POST /api/agent/pr/merge ──────────────────────────────────────────────

export async function handlePrMerge(request: Request): Promise<Response> {
  const body = await readJsonRequestWithinLimit(request, PR_MERGE_BODY_LIMIT_BYTES);
  if (!body.ok) return jsonError(body.error, body.status);
  const payload = asRecord(body.value);

  const cwd = validateCwd(typeof payload.cwd === "string" ? payload.cwd : null);
  if (cwd instanceof Response) return cwd;

  const number = asInt(payload.number);
  if (number <= 0) return jsonError("number must be a positive integer");

  const method = typeof payload.method === "string" ? payload.method : "merge";
  if (!MERGE_METHODS.has(method)) return jsonError("method must be merge, squash, or rebase");

  try {
    await runGh(["pr", "merge", String(number), `--${method}`], cwd);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: friendlyGhError(ghFailure(error)) });
  }
}
