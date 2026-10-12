---
name: github
description: GitHub through the gh CLI that is already installed and signed in on this machine — issues, pull requests, diffs, reviews, Actions runs, code search, and the REST API. Load when the user asks about a repo, an issue, a PR, a review, red CI, or anything on github.com.
---

# github

The `github_*` tools are the `gh` CLI, already installed and already authenticated on this machine. That is the whole design: `gh` holds the credentials in the OS keyring, knows which repo the session directory belongs to, paginates, and renders diffs and check runs. Do not write an API client, do not ask the user for a token, and do not go looking for one in the environment.

`github_status` tells you which account you are acting as and which repository this directory resolves to. Call it when something 404s or 403s — the cause is almost always the wrong account, a missing token scope, or a directory that is not a GitHub checkout, not a bad query.

## Tools

- `github_status` — signed-in account, scopes, and the repo this directory resolves to.
- `github_search` — issues, PRs, repos, code, or commits across GitHub, using GitHub search syntax.
- `github_issue_list` / `github_issue_view` — one repo's issues; the view includes the comment thread.
- `github_pr_list` / `github_pr_view` — pull requests; the view includes reviews and comments.
- `github_pr_diff` — the diff, or with `namesOnly` just the changed paths.
- `github_pr_checks` — CI check runs for a PR. A non-zero exit is the answer, not an error.
- `github_run_list` / `github_run_view` — Actions runs; `failedLogs` returns only the failing steps' output.
- `github_api` — any REST endpoint the named tools miss. GET only.
- `github_cli` — any other `gh` subcommand, as an argv array. This is the write path.

Every tool takes an optional `repo` as `OWNER/REPO`. Omit it to use the repository checked out in this session's project directory, exactly as running `gh` there would.

## Protocol

1. Narrow before you read. `github_pr_diff` with `namesOnly`, or `github_issue_list` before `github_issue_view`, costs one call and saves a truncated wall of output.
2. Read the comments. A PR's blocking objection and an issue's actual decision live in the thread, not the description — `github_pr_view` and `github_issue_view` include them by default, so use them rather than summarizing from the title.
3. For red CI, go `github_pr_checks` → `github_run_view` with `failedLogs`. That is the shortest path from "the build broke" to the error line, and it is far smaller than a whole run's logs.
4. Prefer a named tool over `github_cli` when one exists; the named tools return structured JSON, `github_cli` returns whatever `gh` prints.
5. `github_cli` writes. `gh pr create`, `gh issue comment`, `gh pr merge`, `gh release create` are public, attributed to the user, and usually permanent. Only run one the user actually asked for, and say exactly what you ran.
6. There is no shell behind `github_cli` — pass each argument as its own array element. Pipes, redirects, globs, and `&&` do not work.
7. Credential subcommands (`gh auth`, `gh secret`, `gh config`) and every `delete` are refused by design. If the user genuinely wants one, tell them to run it themselves rather than working around the block.
8. For a repository that is checked out locally, plain `git` and reading the files is faster and more accurate than GitHub search. Use these tools for what only GitHub knows: issues, reviews, CI, and other people's repos.
