import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const packageDirectory = dirname(import.meta.dirname);
const compiledDirectory = join(
  packageDirectory,
  "dist",
  "services",
  "agent-runtime",
  "src",
);
const filters = process.argv.slice(2);

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.isFile() && entry.name.endsWith(".test.js") ? [path] : [];
  });
}

function run(executable, arguments_) {
  const result = spawnSync(executable, arguments_, { cwd: packageDirectory, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"]);
const files = testFiles(compiledDirectory).filter(
  (file) => filters.length === 0 || filters.some((filter) => file.includes(filter)),
);
if (files.length === 0) throw new Error("No matching agent runtime tests");
run(process.execPath, ["--test", ...files]);
