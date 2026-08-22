// github — GitHub through the `gh` CLI that is already installed and signed in
// on this machine.
//
// The deliberate choice here is to shell out rather than speak to api.github.com
// directly. `gh` already holds the user's credentials in the OS keyring, already
// knows which repo the session directory belongs to, already paginates, and
// already renders diffs and check runs. An in-process API client would have to
// re-solve all of that and would need a token of its own — one more secret to
// store, refresh, and leak. So every tool below is an argv for `gh`, and the
// descriptions say so, because a model that knows the tools are `gh` can reason
// about what they can and cannot do.
//
// The runtime only loads this extension when a `gh` binary exists, so the tools
// never advertise a CLI that is not there. Being *signed in* is a separate
// question the binary answers at call time — `github_status` is the tool that
// asks it.
//
// Arguments are passed as an argv array to execFile: there is no shell, so
// nothing a model puts in a query string can become a command. Commands that
// hand out credentials or destroy things (`gh auth token`, `gh repo delete`,
// `gh secret set`) are refused outright rather than trusted to be used well.

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolResult } from "./bridge.ts";
import { Type, type Static, type TSchema } from "./schema.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const SLOW_TIMEOUT_MS = 180_000;
// Big enough for a real PR diff, small enough that a runaway `--paginate` does
// not push the rest of the conversation out of the context window.
const MAX_OUTPUT_CHARS = 60_000;

type GhRun = { code: number; stdout: string; stderr: string };

type GithubEnv = {
  /** The session's project directory — what `gh` resolves OWNER/REPO from. */
  cwd: string;
  bin: string;
};

// Read at REGISTRATION, not import. The runtime loads this module once per
// process but registers it per session, and the project directory changes
// between sessions; a module-scope constant would pin the first session's repo
// onto every later one and answer questions about the wrong project.
function readEnv(): GithubEnv {
  return {
    cwd: process.env.LOCAL_STUDIO_CWD || process.cwd(),
    bin: process.env.LOCAL_STUDIO_GH_PATH || "gh",
  };
}

function runGh(
  env: GithubEnv,
  args: string[],
  signal: AbortSignal | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<GhRun> {
  return new Promise((resolve) => {
    execFile(
      env.bin,
      args,
      {
        cwd: env.cwd,
        signal,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          // gh pipes into a pager and colourizes when it thinks it has a TTY;
          // both corrupt the text a model reads.
          GH_PAGER: "cat",
          PAGER: "cat",
          NO_COLOR: "1",
          CLICOLOR: "0",
          GH_PROMPT_DISABLED: "1",
        },
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code ?? 1)
            : error
              ? 1
              : 0;
        resolve({
          code,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? (error instanceof Error ? error.message : "")),
        });
      },
    );
  });
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated at ${MAX_OUTPUT_CHARS} characters — narrow the query, lower the limit, or ask for specific fields]`;
}

/** One result shape for every tool: the output, plus what actually ran. */
function present(args: string[], run: GhRun): ToolResult {
  const command = `gh ${args.join(" ")}`;
  const body = run.stdout.trim() || run.stderr.trim() || "(no output)";
  const text = run.code === 0 ? body : `${command} exited ${run.code}\n\n${body}`;
  return {
    content: [{ type: "text", text: truncate(text) }],
    details: { command, exitCode: run.code, ...(run.code === 0 ? {} : { failed: true }) },
  };
}

function refuse(reason: string): ToolResult {
  return {
    content: [{ type: "text", text: reason }],
    details: { refused: true, failed: true },
  };
}

// ─── shared parameters ────────────────────────────────────────────────────

const repoParam = Type.Optional(
  Type.String({
    description:
      "OWNER/REPO. Omit to use the repository checked out in this session's project directory.",
  }),
);
const limitParam = Type.Optional(Type.Number({ description: "Maximum results (default 30)" }));

function repoArgs(repo: string | undefined): string[] {
  return repo ? ["--repo", repo] : [];
}

function limitArgs(limit: number | undefined): string[] {
  const value = Number.isFinite(limit) ? Math.max(1, Math.trunc(Number(limit))) : 30;
  return ["--limit", String(value)];
}

const REPO_DEFAULT =
  "With no `repo`, this resolves the repository from the session's project directory, exactly as running gh in that directory would.";

// ─── tool table ───────────────────────────────────────────────────────────

type ToolSpec<S extends TSchema> = {
  name: string;
  label: string;
  description: string;
  parameters: S;
  argv: (params: Static<S>) => string[];
  timeoutMs?: number;
};

function define<S extends TSchema>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

const SEARCH_FIELDS: Record<string, string> = {
  issues: "number,title,state,repository,labels,author,updatedAt,url",
  prs: "number,title,state,isDraft,repository,labels,author,updatedAt,url",
  repos: "fullName,description,language,stargazersCount,updatedAt,url",
  code: "path,repository,url",
  commits: "sha,commit,repository,url",
};

const TOOLS = [
  define({
    name: "github_search",
    label: "GitHub: Search",
    description: `Search GitHub across all of it — issues, pull requests, repositories, code, or commits — with GitHub's own search syntax (\`is:open label:bug\`, \`org:foo language:go\`, \`author:@me\`). Use this to find things anywhere; use github_issue_list / github_pr_list when you already know the repository and just want its list. Code search only covers indexed default branches of public repos plus repos you can read, and it is not a substitute for grepping a local checkout.`,
    parameters: Type.Object({
      kind: Type.Union(
        [
          Type.Literal("issues"),
          Type.Literal("prs"),
          Type.Literal("repos"),
          Type.Literal("code"),
          Type.Literal("commits"),
        ],
        { description: "What to search for" },
      ),
      query: Type.String({ description: "GitHub search query" }),
      repo: Type.Optional(Type.String({ description: "Restrict to OWNER/REPO" })),
      owner: Type.Optional(Type.String({ description: "Restrict to an owner or org" })),
      limit: limitParam,
    }),
    argv: (p) => [
      "search",
      p.kind,
      p.query,
      ...(p.repo ? ["--repo", p.repo] : []),
      ...(p.owner ? ["--owner", p.owner] : []),
      ...limitArgs(p.limit),
      "--json",
      SEARCH_FIELDS[p.kind] ?? "url",
    ],
  }),
  define({
    name: "github_issue_list",
    label: "GitHub: List Issues",
    description: `List issues in one repository, newest first. Returns titles, state, labels, author and URL — not bodies, so follow up with github_issue_view for the one that matters. ${REPO_DEFAULT}`,
    parameters: Type.Object({
      repo: repoParam,
      state: Type.Optional(
        Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")], {
          description: "Issue state (default open)",
        }),
      ),
      labels: Type.Optional(Type.Array(Type.String(), { description: "Filter by label" })),
      assignee: Type.Optional(Type.String({ description: "Filter by assignee login" })),
      search: Type.Optional(Type.String({ description: "Additional search terms" })),
      limit: limitParam,
    }),
    argv: (p) => [
      "issue",
      "list",
      ...repoArgs(p.repo),
      "--state",
      p.state ?? "open",
      ...(p.labels ?? []).flatMap((label) => ["--label", label]),
      ...(p.assignee ? ["--assignee", p.assignee] : []),
      ...(p.search ? ["--search", p.search] : []),
      ...limitArgs(p.limit),
      "--json",
      "number,title,state,author,labels,createdAt,updatedAt,url",
    ],
  }),
  define({
    name: "github_issue_view",
    label: "GitHub: View Issue",
    description: `Read one issue in full: body, labels, state, and — with \`comments\` — the whole discussion. The comments are usually where the actual decision is, so ask for them before summarizing what an issue "says". ${REPO_DEFAULT}`,
    parameters: Type.Object({
      number: Type.Number({ description: "Issue number" }),
      repo: repoParam,
      comments: Type.Optional(
        Type.Boolean({ description: "Include the comment thread (default true)" }),
      ),
    }),
    argv: (p) => [
      "issue",
      "view",
      String(Math.trunc(p.number)),
      ...repoArgs(p.repo),
      "--json",
      `number,title,state,author,labels,body,createdAt,updatedAt,url${p.comments === false ? "" : ",comments"}`,
    ],
  }),
  define({
    name: "github_pr_list",
    label: "GitHub: List Pull Requests",
    description: `List pull requests in one repository. Returns titles, state, draft flag, branches and author — use github_pr_view for one PR's detail and github_pr_diff for its changes. ${REPO_DEFAULT}`,
    parameters: Type.Object({
      repo: repoParam,
      state: Type.Optional(
        Type.Union(
          [
            Type.Literal("open"),
            Type.Literal("closed"),
            Type.Literal("merged"),
            Type.Literal("all"),
          ],
          { description: "PR state (default open)" },
        ),
      ),
      author: Type.Optional(Type.String({ description: "Filter by author login, or @me" })),
      base: Type.Optional(Type.String({ description: "Filter by base branch" })),
      limit: limitParam,
    }),
    argv: (p) => [
      "pr",
      "list",
      ...repoArgs(p.repo),
      "--state",
      p.state ?? "open",
      ...(p.author ? ["--author", p.author] : []),
      ...(p.base ? ["--base", p.base] : []),
      ...limitArgs(p.limit),
      "--json",
      "number,title,state,isDraft,author,headRefName,baseRefName,createdAt,updatedAt,url",
    ],
  }),
  define({
    name: "github_pr_view",
    label: "GitHub: View Pull Request",
    description: `Read one pull request: body, branches, mergeability, review decision, and line counts. Add \`reviews\` for the review threads and comments — a PR's blocking objection lives there, not in the description. This does not include the diff; call github_pr_diff for that. ${REPO_DEFAULT}`,
    parameters: Type.Object({
      number: Type.Number({ description: "Pull request number" }),
      repo: repoParam,
      reviews: Type.Optional(
        Type.Boolean({ description: "Include reviews and comments (default true)" }),
      ),
    }),
    argv: (p) => [
      "pr",
      "view",
      String(Math.trunc(p.number)),
      ...repoArgs(p.repo),
      "--json",
      `number,title,state,isDraft,author,body,headRefName,baseRefName,additions,deletions,changedFiles,mergeable,mergeStateStatus,reviewDecision,labels,createdAt,updatedAt,url${p.reviews === false ? "" : ",comments,reviews"}`,
    ],
  }),
  define({
    name: "github_pr_diff",
    label: "GitHub: Pull Request Diff",
    description: `Return a pull request's unified diff, or with \`namesOnly\` just the changed file paths. Start with \`namesOnly\` on a large PR — full diffs are truncated, and the file list tells you whether the diff is worth pulling at all. ${REPO_DEFAULT}`,
    parameters: Type.Object({
      number: Type.Number({ description: "Pull request number" }),
      repo: repoParam,
      namesOnly: Type.Optional(
        Type.Boolean({ description: "List changed file paths instead of the diff" }),
      ),
    }),
    argv: (p) => [
      "pr",
      "diff",
      String(Math.trunc(p.number)),
      ...repoArgs(p.repo),
      ...(p.namesOnly ? ["--name-only"] : []),
    ],
  }),
  define({
    name: "github_pr_checks",
    label: "GitHub: Pull Request Checks",
    description: `Return the CI check runs for a pull request with their state and links. A non-zero exit here means checks are failing or pending — that is the answer, not an error. Follow a failure into github_run_view with \`failedLogs\` to see why. ${REPO_DEFAULT}`,
    parameters: Type.Object({
      number: Type.Number({ description: "Pull request number" }),
      repo: repoParam,
    }),
    argv: (p) => ["pr", "checks", String(Math.trunc(p.number)), ...repoArgs(p.repo)],
  }),
  define({
    name: "github_run_list",
    label: "GitHub: List Workflow Runs",
    description: `List recent GitHub Actions runs with their status, conclusion, branch and id. The \`databaseId\` is what github_run_view takes. ${REPO_DEFAULT}`,
    parameters: Type.Object({
      repo: repoParam,
      workflow: Type.Optional(Type.String({ description: "Workflow name or file, e.g. ci.yml" })),
      branch: Type.Optional(Type.String({ description: "Filter by branch" })),
      status: Type.Optional(
        Type.String({ description: "Filter by status/conclusion, e.g. failure, in_progress" }),
      ),
      limit: limitParam,
    }),
    argv: (p) => [
      "run",
      "list",
      ...repoArgs(p.repo),
      ...(p.workflow ? ["--workflow", p.workflow] : []),
      ...(p.branch ? ["--branch", p.branch] : []),
      ...(p.status ? ["--status", p.status] : []),
      ...limitArgs(p.limit),
      "--json",
      "databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,createdAt,url",
    ],
  }),
  define({
    name: "github_run_view",
    label: "GitHub: View Workflow Run",
    description: `Inspect one GitHub Actions run by id — its jobs and their conclusions, or with \`failedLogs\` the log output of just the steps that failed. Reach for \`failedLogs\` when debugging red CI: it is the shortest path from "the build broke" to the actual error, and far smaller than a whole run's logs. ${REPO_DEFAULT}`,
    parameters: Type.Object({
      runId: Type.Number({ description: "Run id (databaseId from github_run_list)" }),
      repo: repoParam,
      failedLogs: Type.Optional(
        Type.Boolean({ description: "Return the logs of failed steps instead of the job summary" }),
      ),
    }),
    argv: (p) => [
      "run",
      "view",
      String(Math.trunc(p.runId)),
      ...repoArgs(p.repo),
      ...(p.failedLogs
        ? ["--log-failed"]
        : [
            "--json",
            "databaseId,displayTitle,workflowName,status,conclusion,headBranch,headSha,event,jobs,url",
          ]),
    ],
    timeoutMs: SLOW_TIMEOUT_MS,
  }),
  define({
    name: "github_api",
    label: "GitHub: REST/GraphQL Read",
    description:
      "Read any GitHub REST endpoint that the named tools do not cover — `repos/{owner}/{repo}/releases`, `notifications`, `users/{login}`, `orgs/{org}/members`. GET only: this tool cannot write, so use github_cli for anything that changes state. Placeholders like {owner} and {repo} are filled in from the session's repository. `jq` filters the response server-side, which is the difference between a useful answer and a truncated one on large endpoints.",
    parameters: Type.Object({
      endpoint: Type.String({
        description: "REST path, e.g. repos/{owner}/{repo}/releases?per_page=5",
      }),
      jq: Type.Optional(Type.String({ description: "jq expression applied to the response" })),
      paginate: Type.Optional(
        Type.Boolean({ description: "Follow pagination and concatenate pages" }),
      ),
    }),
    argv: (p) => [
      "api",
      p.endpoint,
      "--method",
      "GET",
      ...(p.jq ? ["--jq", p.jq] : []),
      ...(p.paginate ? ["--paginate"] : []),
    ],
    timeoutMs: SLOW_TIMEOUT_MS,
  }),
];

// `gh` subcommands that hand out or replace credentials, or install and run
// third-party code. Nothing a task legitimately needs is behind these, and the
// blast radius of getting one wrong is the user's account.
const BLOCKED_COMMANDS = new Set([
  "auth",
  "secret",
  "variable",
  "extension",
  "alias",
  "config",
  "gpg-key",
  "ssh-key",
]);

function blockedReason(args: string[]): string | null {
  const command = args[0] ?? "";
  if (!command) return 'github_cli needs at least one argument, e.g. ["pr", "create", "--fill"].';
  if (command.startsWith("-")) {
    return "github_cli takes a gh subcommand first, not a flag.";
  }
  if (BLOCKED_COMMANDS.has(command)) {
    return `github_cli refuses \`gh ${command}\`: it reads or replaces credentials, or installs code. Use github_status to check the signed-in account; run anything else in this family yourself.`;
  }
  if (args.includes("delete")) {
    return "github_cli refuses `delete` subcommands — they are irreversible. Ask the user to run it themselves if that is really what they want.";
  }
  return null;
}

export default async function registerGithubExtension(pi: ExtensionAPI) {
  const env = readEnv();

  pi.registerTool({
    name: "github_status",
    label: "GitHub: Status",
    description:
      "Report which GitHub account `gh` is signed in as, with which token scopes, and which repository the session's project directory resolves to. Call it first when another tool fails with a permission or 'not found' error: the usual cause is the wrong account, a missing scope, or a directory that is not a GitHub checkout — not a bad query. Also the honest way to answer 'who am I on GitHub' before doing anything that acts as that user.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const auth = await runGh(env, ["auth", "status"], signal);
      const repo = await runGh(
        env,
        ["repo", "view", "--json", "nameWithOwner,url,isPrivate,defaultBranchRef"],
        signal,
      );
      const repoLine =
        repo.code === 0
          ? repo.stdout.trim()
          : `No GitHub repository resolved from ${env.cwd} (${repo.stderr.trim() || "not a checkout with a GitHub remote"}). Pass \`repo\` explicitly to the other tools.`;
      return {
        content: [
          {
            type: "text",
            text: truncate(
              `${auth.stdout.trim() || auth.stderr.trim() || "(no auth output)"}\n\nSession directory: ${env.cwd}\n${repoLine}`,
            ),
          },
        ],
        details: {
          command: "gh auth status",
          exitCode: auth.code,
          cwd: env.cwd,
          ...(auth.code === 0 ? {} : { failed: true }),
        },
      };
    },
  });

  for (const tool of TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, params, signal) {
        const args = tool.argv(params as never);
        return present(args, await runGh(env, args, signal, tool.timeoutMs));
      },
    });
  }

  pi.registerTool({
    name: "github_cli",
    label: "GitHub: Run gh",
    description:
      'Run any other `gh` subcommand as an argv array — `["pr", "create", "--fill"]`, `["issue", "comment", "42", "--body", "..."]`, `["release", "list"]`. This is the write path: it acts on GitHub as the signed-in user and its effects are public and often permanent, so only run a mutating command the user actually asked for, and say what you ran. Prefer the named github_* tools where one exists — they return structured JSON, this returns whatever gh prints. There is no shell here, so pipes, redirects and globs do not work; pass each argument as its own array element. Credential and delete subcommands are refused.',
    parameters: Type.Object({
      args: Type.Array(Type.String(), {
        description: "Arguments after `gh`, one per element",
      }),
    }),
    async execute(_id, params, signal) {
      const args = (params.args ?? []).map(String);
      const blocked = blockedReason(args);
      if (blocked) return refuse(blocked);
      return present(args, await runGh(env, args, signal, SLOW_TIMEOUT_MS));
    },
  });
}
