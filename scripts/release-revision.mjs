#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revisionPattern = /^[0-9a-f]{40}$/;

function verifiedRevision(revision) {
  const value = String(revision ?? "").trim();
  if (!revisionPattern.test(value)) throw new Error("Release revision is invalid");
  return value;
}

export function releaseRevisionIsCurrent(tested, checkedOut, currentMain) {
  const expected = verifiedRevision(tested);
  return expected === verifiedRevision(checkedOut) && expected === verifiedRevision(currentMain);
}

function gitOutput(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function currentMainRevision() {
  execFileSync(
    "git",
    ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"],
    { stdio: "inherit" },
  );
  return gitOutput(["rev-parse", "refs/remotes/origin/main"]);
}

function publishRevisionState(environment = process.env) {
  const output = environment.GITHUB_OUTPUT?.trim();
  if (!output) throw new Error("Release output destination is unavailable");
  const tested = verifiedRevision(environment.TESTED_SHA);
  const checkedOut = gitOutput(["rev-parse", "HEAD"]);
  const currentMain = currentMainRevision();
  const current = releaseRevisionIsCurrent(tested, checkedOut, currentMain);
  appendFileSync(output, `current=${current}\n`);
  console.log(
    current
      ? `Release revision ${tested} is current`
      : `Skipping stale release revision ${tested}; current main is ${currentMain}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishRevisionState();
}
