import { execFileSync } from "node:child_process";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function assertReleaseMain(args = process.argv.slice(2)) {
  const expected = valueAfter(args, "--commit")?.trim().toLowerCase();
  if (!expected || !/^[0-9a-f]{40}$/.test(expected)) {
    throw new Error("--commit must be a full Git commit SHA");
  }

  const output = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
    encoding: "utf8",
  }).trim();
  const current = output.split(/\s+/, 1)[0]?.toLowerCase();
  if (!current || !/^[0-9a-f]{40}$/.test(current)) {
    throw new Error("Could not resolve origin/main");
  }
  if (current !== expected) {
    throw new Error(`Refusing stale release: origin/main is ${current}, build is ${expected}`);
  }

  console.log(`Release source is current origin/main: ${expected}`);
  return expected;
}

assertReleaseMain();
