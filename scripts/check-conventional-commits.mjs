#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowedTypes = new Set([
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "micro",
  "perf",
  "refactor",
  "release",
  "revert",
  "style",
  "test",
]);

const ignoredSubjects = [
  /^Merge /,
  /^Revert /,
  /^Initial commit$/,
  /^dependabot\//,
];

const args = process.argv.slice(2);
const messageFileIndex = args.indexOf("--message-file");
const rangeIndex = args.indexOf("--range");
const excludeRefIndex = args.indexOf("--exclude-ref");

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const validateSubject = (subject, label) => {
  if (!subject.trim()) {
    fail(`${label}: empty commit subject`);
    return;
  }

  if (ignoredSubjects.some((pattern) => pattern.test(subject))) {
    return;
  }

  const match = /^(?<type>[a-z]+)(?:\([a-z0-9._/-]+\))?(?<breaking>!)?: (?<summary>.+)$/.exec(subject);

  if (!match?.groups) {
    fail(`${label}: "${subject}" must follow "type(scope): summary"`);
    return;
  }

  const { type, summary } = match.groups;
  if (!allowedTypes.has(type)) {
    fail(`${label}: "${type}" is not an allowed commit type`);
  }

  if (summary.length < 8) {
    fail(`${label}: summary must be at least 8 characters`);
  }

  if (/^[A-Z]/.test(summary)) {
    fail(`${label}: summary should start lowercase`);
  }

  if (/[.]$/.test(summary)) {
    fail(`${label}: summary should not end with a period`);
  }
};

if (messageFileIndex !== -1) {
  const messageFile = args[messageFileIndex + 1];
  const subject = readFileSync(messageFile, "utf8").split(/\r?\n/, 1)[0] ?? "";
  validateSubject(subject, "commit message");
} else {
  const range = rangeIndex === -1 ? args[0] : args[rangeIndex + 1];
  const excludeRef = excludeRefIndex === -1 ? undefined : args[excludeRefIndex + 1];
  if (!range) {
    fail(
      "Usage: check-conventional-commits.mjs --message-file <path> | --range <base..head> [--exclude-ref <ref>]",
    );
  } else {
    const gitArgs = ["log", "--format=%s", range];
    if (excludeRef) gitArgs.push("--not", excludeRef);
    const output = execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
    const subjects = output ? output.split(/\r?\n/) : [];
    subjects.forEach((subject, index) => validateSubject(subject, `commit ${index + 1}`));
  }
}

if (process.exitCode) {
  console.error("\nAllowed types: " + [...allowedTypes].join(", "));
}
