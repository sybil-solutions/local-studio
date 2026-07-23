import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(packageDir, "dist");
const bundlePath = path.join(distDir, "standalone.mjs");
const runtimePackages = [
  "playwright-core",
  "chromium-bidi",
  "mitt",
  "devtools-protocol",
  "@silvia-odwyer/photon-node",
  "undici",
];

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const build = spawnSync(
  "bun",
  [
    "build",
    "src/server.ts",
    "--target=node",
    "--external",
    "fsevents",
    "--external",
    "playwright-core",
    "--external",
    "@silvia-odwyer/photon-node",
    "--external",
    "undici",
    "--outfile=dist/standalone.mjs",
  ],
  { cwd: packageDir, stdio: "inherit" },
);

if (build.status !== 0) {
  throw new Error(`Agent runtime bundle failed with status ${build.status ?? "unknown"}`);
}

for (const packageName of runtimePackages) {
  const segments = packageName.split("/");
  const source = path.join(packageDir, "node_modules", ...segments);
  const destination = path.join(distDir, "node_modules", ...segments);
  if (!existsSync(path.join(source, "package.json"))) {
    throw new Error(`Missing browser runtime package: ${packageName}`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

const bundle = readFileSync(bundlePath, "utf8");
const sourceRoot = realpathSync(path.join(packageDir, "..", ".."));
if (bundle.includes(sourceRoot)) {
  throw new Error(`Agent runtime bundle contains the build-machine root: ${sourceRoot}`);
}

console.log(`Packaged portable browser runtime: ${runtimePackages.join(", ")}`);
