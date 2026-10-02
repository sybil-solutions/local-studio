import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const upstream = JSON.parse(readFileSync("LOCAL_STUDIO_UPSTREAM.json", "utf8"));
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
const source = /\.(?:[cm]?[jt]sx?|py|sh|css|rs)$/;
const tracked = git("diff", "--numstat", upstream.importCommit).trim().split("\n");
let lines = tracked.reduce((sum, row) => {
  const [added, , path] = row.split("\t");
  return sum + (path && source.test(path) ? Number(added) || 0 : 0);
}, 0);
for (const path of git("ls-files", "--others", "--exclude-standard").trim().split("\n")) {
  if (source.test(path)) lines += readFileSync(path, "utf8").split("\n").length - 1;
}
console.log(
  `Local Studio custom source: ${lines}/${upstream.customSourceLineLimit} added lines beyond pinned T3 Code`,
);
if (lines > upstream.customSourceLineLimit) process.exit(1);
if (!process.argv.includes("--budget")) {
  for (const name of [
    "@t3tools/contracts",
    "@t3tools/shared",
    "t3",
    "@t3tools/web",
    "@t3tools/desktop",
    "@t3tools/mobile",
    "@local-studio/controller",
  ]) {
    execFileSync("pnpm", ["--filter", name, "typecheck"], { stdio: "inherit", timeout: 300_000 });
  }
  execFileSync("pnpm", ["--filter", "@t3tools/web", "build"], {
    stdio: "inherit",
    timeout: 300_000,
  });
  execFileSync("node", ["scripts/local-e2e.mjs"], { stdio: "inherit", timeout: 180_000 });
}
