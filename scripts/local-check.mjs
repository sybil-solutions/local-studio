import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const upstream = JSON.parse(readFileSync("LOCAL_STUDIO_UPSTREAM.json", "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
const source = /\.(?:[cm]?[jt]sx?|py|sh|css|rs)$/;
let lines = 0;
for (const row of git("diff", "--numstat", upstream.importCommit).trim().split("\n")) {
  const [added, , path] = row.split("\t");
  if (path && source.test(path)) lines += Number(added) || 0;
}
for (const path of git("ls-files", "--others", "--exclude-standard").trim().split("\n")) {
  if (source.test(path)) lines += readFileSync(path, "utf8").split("\n").length - 1;
}
console.log(`Local Studio custom source: ${lines}/${upstream.customSourceLineLimit} added lines beyond pinned T3 Code`);
if (lines > upstream.customSourceLineLimit) process.exit(1);
if (!process.argv.includes("--budget")) {
  const run = (...args) => execFileSync(args[0], args.slice(1), { stdio: "inherit", timeout: 300_000 });
  for (const name of ["@t3tools/contracts", "@t3tools/shared", "t3", "@t3tools/web", "@t3tools/desktop", "@t3tools/mobile", "@local-studio/controller"]) {
    run("pnpm", "--filter", name, "typecheck");
  }
  run("pnpm", "--filter", "@t3tools/web", "build");
  run("node", "scripts/local-e2e.mjs");
}
