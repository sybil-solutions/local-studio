import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { resolve } from "node:path";
import { parse } from "yaml";
import { releaseRevisionIsCurrent } from "../../scripts/release-revision.mjs";

const repository = resolve(import.meta.dirname, "../..");

function workflow(name) {
  return parse(readFileSync(resolve(repository, ".github/workflows", name), "utf8"));
}

function concurrencyOrder(running, pending, queue) {
  return [running, ...(queue === "max" ? pending : pending.slice(-1))];
}

test("rejects an older release that enters after a newer revision", () => {
  const older = "a".repeat(40);
  const newer = "b".repeat(40);
  const acquired = [
    [newer, newer, newer],
    [older, older, newer],
  ];
  assert.deepEqual(
    acquired.filter((entry) => releaseRevisionIsCurrent(...entry)).map(([tested]) => tested),
    [newer],
  );
  assert.deepEqual(
    [
      [older, older, older],
      [newer, newer, newer],
    ]
      .filter((entry) => releaseRevisionIsCurrent(...entry))
      .map(([tested]) => tested),
    [older, newer],
  );
});

test("preserves a pending current release when a stale run enters third", () => {
  const release = workflow("release.yml");
  const running = "c".repeat(40);
  const current = "b".repeat(40);
  const stale = "a".repeat(40);
  const acquired = concurrencyOrder(running, [current, stale], release.concurrency.queue);
  assert.deepEqual(acquired, [running, current, stale]);
  assert.deepEqual(
    acquired
      .slice(1)
      .filter((tested) => releaseRevisionIsCurrent(tested, tested, current)),
    [current],
  );
});

test("binds release publication and write permissions to the tested revision", () => {
  const ci = workflow("ci.yml");
  const release = workflow("release.yml");
  const checkout = release.jobs.release.steps.find((step) => step.uses === "actions/checkout@v4");
  const revision = release.jobs.release.steps.find((step) => step.id === "revision");
  const publication = release.jobs.release.steps.find((step) =>
    String(step.run ?? "").includes("semantic-release"),
  );
  assert.deepEqual(ci.permissions, { contents: "read" });
  assert.deepEqual(ci.jobs.release.needs, ["gates", "controller", "frontend", "agent-runtime"]);
  assert.deepEqual(ci.jobs.release.permissions, {
    contents: "write",
    issues: "write",
    "pull-requests": "write",
  });
  assert.deepEqual(release.permissions, { contents: "read" });
  assert.deepEqual(release.concurrency, {
    group: "release-${{ github.ref }}",
    "cancel-in-progress": false,
    queue: "max",
  });
  assert.deepEqual(release.jobs.release.permissions, {
    contents: "write",
    issues: "write",
    "pull-requests": "write",
  });
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(revision.env.TESTED_SHA, "${{ github.sha }}");
  assert.equal(revision.run, "node scripts/release-revision.mjs");
  assert.ok(release.jobs.release.steps.indexOf(revision) < release.jobs.release.steps.indexOf(publication));
  assert.equal(publication.if, "steps.revision.outputs.current == 'true'");
});

test("pre-push commit validation excludes commits already on the default branch", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "local-studio-pre-push-"));
  const hooks = resolve(fixture, "hooks");
  mkdirSync(hooks);
  const gitEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const runGit = (...args) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", `core.hooksPath=${hooks}`, ...args], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...gitEnvironment,
        GIT_AUTHOR_NAME: "Local Studio",
        GIT_AUTHOR_EMAIL: "local-studio@example.invalid",
        GIT_COMMITTER_NAME: "Local Studio",
        GIT_COMMITTER_EMAIL: "local-studio@example.invalid",
      },
    }).trim();

  try {
    runGit("init", "--initial-branch=main");
    writeFileSync(resolve(fixture, "fixture.txt"), "base\n");
    runGit("add", "fixture.txt");
    runGit("commit", "-m", "chore: create fixture baseline");
    runGit("checkout", "-b", "remote-head");
    writeFileSync(resolve(fixture, "fixture.txt"), "remote\n");
    runGit("commit", "-am", "fix: preserve remote branch state");
    runGit("checkout", "main");
    writeFileSync(resolve(fixture, "fixture.txt"), "upstream\n");
    runGit("commit", "-am", "feat: Upstream maintainer subject");
    runGit("update-ref", "refs/remotes/origin/main", "main");
    runGit("update-ref", "refs/remotes/fork/main", "remote-head");
    runGit("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    runGit("checkout", "-b", "refreshed");
    writeFileSync(resolve(fixture, "fixture.txt"), "refreshed\n");
    runGit("commit", "-am", "fix: preserve refreshed branch state");

    const checker = resolve(repository, "scripts/check-conventional-commits.mjs");
    const range = "remote-head..refreshed";
    const withoutExclusion = spawnSync(process.execPath, [checker, "--range", range], {
      cwd: fixture,
      encoding: "utf8",
      env: gitEnvironment,
    });
    assert.notEqual(withoutExclusion.status, 0);
    const staleForkExclusion = spawnSync(
      process.execPath,
      [checker, "--range", range, "--exclude-ref", "refs/remotes/fork/main"],
      {
        cwd: fixture,
        encoding: "utf8",
        env: gitEnvironment,
      },
    );
    assert.notEqual(staleForkExclusion.status, 0);
    execFileSync(
      process.execPath,
      [
        checker,
        "--range",
        range,
        "--exclude-ref",
        "refs/remotes/fork/main",
        "--exclude-remote-heads",
      ],
      { cwd: fixture, env: gitEnvironment },
    );

    writeFileSync(resolve(fixture, "fixture.txt"), "invalid topic\n");
    runGit("commit", "-am", "fix: Bad newly pushed subject");
    runGit("update-ref", "refs/remotes/untrusted/topic", "refreshed");
    const unrelatedTopicExclusion = spawnSync(
      process.execPath,
      [
        checker,
        "--range",
        range,
        "--exclude-ref",
        "refs/remotes/fork/main",
        "--exclude-remote-heads",
      ],
      {
        cwd: fixture,
        encoding: "utf8",
        env: gitEnvironment,
      },
    );
    assert.notEqual(unrelatedTopicExclusion.status, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
