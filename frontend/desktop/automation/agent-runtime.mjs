// Agent-runtime build steps: the portable bun bundle the desktop app ships,
// the dist clean, and the tsc-output specifier repair.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { repoRoot } from "./lib.mjs";

const packageDir = path.join(repoRoot, "services", "agent-runtime");
const distDir = path.join(packageDir, "dist");

export function prepareAgentRuntime() {
  rmSync(distDir, { recursive: true, force: true });
}

/**
 * Bundle the runtime into one portable file plus the packages that must stay
 * real directories beside it.
 *
 * Pi's extension loader (jiti alias mode) eagerly require.resolve()s typebox
 * and import.meta.resolve()s the pi packages from the bundle's own directory
 * BEFORE loading any extension file. Without those on disk next to
 * standalone.mjs, every bundled extension fails with "Cannot find module
 * 'typebox'" in the packaged app.
 */
export function bundleAgentRuntime() {
  const bundlePath = path.join(distDir, "standalone.mjs");
  const runtimePackages = [
    "playwright-core",
    "chromium-bidi",
    "mitt",
    "devtools-protocol",
    "@silvia-odwyer/photon-node",
    "undici",
    "@lydell/node-pty",
    "typebox",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-tui",
    "@earendil-works/pi-ai",
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
      "--minify",
      "--outfile=dist/standalone.mjs",
    ],
    { cwd: packageDir, stdio: "inherit" },
  );
  if (build.status !== 0) {
    throw Error(`Agent runtime bundle failed with status ${build.status ?? "unknown"}`);
  }

  const lydellDir = path.join(packageDir, "node_modules", "@lydell");
  if (existsSync(lydellDir)) {
    for (const entry of readdirSync(lydellDir)) {
      if (entry.startsWith("node-pty-")) runtimePackages.push(`@lydell/${entry}`);
    }
  }

  for (const packageName of runtimePackages) {
    const segments = packageName.split("/");
    const source = path.join(packageDir, "node_modules", ...segments);
    const destination = path.join(distDir, "node_modules", ...segments);
    if (!existsSync(path.join(source, "package.json"))) {
      throw Error(`Missing browser runtime package: ${packageName}`);
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
  }

  const bundle = readFileSync(bundlePath, "utf8");
  const sourceRoot = realpathSync(repoRoot);
  if (bundle.includes(sourceRoot)) {
    throw Error(`Agent runtime bundle contains the build-machine root: ${sourceRoot}`);
  }
  console.log(`Packaged portable browser runtime: ${runtimePackages.join(", ")}`);
}

function* jsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield full;
  }
}

function resolveSpecifier(fromFile, spec) {
  if (/\.(js|mjs|cjs|json|node)$/.test(spec)) return spec;
  const base = path.resolve(path.dirname(fromFile), spec);
  if (existsSync(`${base}.js`)) return `${spec}.js`;
  if (existsSync(base) && statSync(base).isDirectory() && existsSync(path.join(base, "index.js"))) {
    return `${spec}/index.js`;
  }
  return spec;
}

/**
 * tsc emits extensionless relative imports that Node's ESM loader refuses;
 * rewrite them and write the stable dist/server.js entry shim.
 */
export function postbuildAgentRuntime() {
  const realEntry = path.join(distDir, "services", "agent-runtime", "src", "server.js");
  if (!existsSync(realEntry)) {
    console.error(`[postbuild] expected tsc output missing: ${realEntry}`);
    process.exit(1);
  }
  const SPECIFIER_RE =
    /(from\s+|import\s*\(\s*|export\s+\*\s+from\s+|import\s+)("(\.{1,2}\/[^"]+)"|'(\.{1,2}\/[^']+)')/g;
  let rewrites = 0;
  for (const file of jsFiles(distDir)) {
    const source = readFileSync(file, "utf8");
    const next = source.replace(SPECIFIER_RE, (match, lead, quoted, dq, sq) => {
      const spec = dq ?? sq;
      const fixed = resolveSpecifier(file, spec);
      if (fixed === spec) return match;
      rewrites += 1;
      const quote = quoted[0];
      return `${lead}${quote}${fixed}${quote}`;
    });
    if (next !== source) writeFileSync(file, next);
  }
  const shim = `// Stable entry for "node dist/server.js".\nimport "./services/agent-runtime/src/server.js";\n`;
  writeFileSync(path.join(distDir, "server.js"), shim);
  console.log(`[postbuild] rewrote ${rewrites} relative specifiers; wrote dist/server.js shim`);
}
