// The Next standalone lifecycle: clean before build, repair after build,
// assert the result is complete and minimal, and re-assert inside the packaged
// app (afterPack, called by electron-builder).

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { frontendDir, repoRoot, walkUnder } from "./lib.mjs";

const standaloneBase = path.resolve(frontendDir, ".next", "standalone");

const RUNTIME_PREFIXES = [
  "server.js",
  "package.json",
  ".next/",
  "public/",
  "node_modules/",
  "frontend/server.js",
  "frontend/package.json",
  "frontend/.next/",
  "frontend/public/",
  "frontend/node_modules/",
];

function isRuntimeFile(file) {
  const rel = path.relative(standaloneBase, file).replaceAll("\\", "/");
  return RUNTIME_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix));
}

const filesUnder = (directory) => walkUnder(readdirSync, directory, (entry) => entry.isFile());
const symlinksUnder = (directory) =>
  walkUnder(readdirSync, directory, (entry) => entry.isSymbolicLink());

export function prepareNext() {
  rmSync(path.join(frontendDir, ".next"), { recursive: true, force: true });
}

/**
 * Post-`next build` repair: copy the runtime dependencies Next's tracer cannot
 * see, re-point the traced Pi package aliases, and prune every traced file
 * that is a verified copy of a repo source — refusing to prune anything it
 * cannot verify, because deleting an unrecognized file silently would be worse
 * than failing the build.
 */
export function completeStandalone() {
  const standaloneRoots = [path.resolve(standaloneBase, "frontend"), standaloneBase];
  const standaloneRoot = standaloneRoots.find((root) => existsSync(path.resolve(root, "server.js")));
  if (!standaloneRoot) throw Error(`Missing standalone server under: ${standaloneBase}`);

  const runtimeDependencyPaths = [
    "node_modules/typebox",
    "node_modules/@earendil-works/pi-coding-agent",
  ];
  for (const dependencyPath of runtimeDependencyPaths) {
    const source = path.resolve(frontendDir, dependencyPath);
    if (!existsSync(source)) throw Error(`Missing runtime dependency source: ${dependencyPath}`);
    const destination = path.resolve(standaloneRoot, dependencyPath);
    cpSync(source, destination, { recursive: true });
    const executableShimDirectories = readdirSync(destination, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && entry.name === ".bin")
      .map((entry) => path.resolve(entry.parentPath, entry.name));
    for (const directory of executableShimDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const tracedPiPackageDirectory = path.resolve(standaloneRoot, ".next/node_modules/@earendil-works");
  if (existsSync(tracedPiPackageDirectory)) {
    const packageTargets = new Map([
      [
        "pi-ai-",
        path.resolve(
          standaloneRoot,
          "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai",
        ),
      ],
      ["pi-coding-agent-", path.resolve(standaloneRoot, "node_modules/@earendil-works/pi-coding-agent")],
    ]);
    for (const entry of readdirSync(tracedPiPackageDirectory)) {
      const target = [...packageTargets].find(([prefix]) => entry.startsWith(prefix))?.[1];
      if (!target) continue;
      const link = path.resolve(tracedPiPackageDirectory, entry);
      if (!lstatSync(link).isSymbolicLink()) {
        throw Error(`Expected traced Pi package alias to be a symlink: ${link}`);
      }
      unlinkSync(link);
      symlinkSync(path.relative(path.dirname(link), target), link, "dir");
    }
  }

  const isVerifiedCopy = (file, repoRelativePath) => {
    const source = path.resolve(repoRoot, repoRelativePath);
    if (!existsSync(source)) return false;
    const sourceStat = statSync(source);
    const copyStat = statSync(file);
    if (!sourceStat.isFile() || sourceStat.size !== copyStat.size) return false;
    if (!(repoRelativePath === "data" || /(^|\/)data\//.test(repoRelativePath))) return true;
    return readFileSync(source).equals(readFileSync(file));
  };

  const unverified = [];
  let pruned = 0;
  for (const file of filesUnder(standaloneBase)) {
    if (isRuntimeFile(file)) continue;
    const repoRelativePath = path.relative(standaloneBase, file).replaceAll("\\", "/");
    if (!isVerifiedCopy(file, repoRelativePath)) {
      unverified.push(repoRelativePath);
      continue;
    }
    unlinkSync(file);
    pruned += 1;
  }
  if (unverified.length > 0) {
    throw Error(
      `Standalone output contains non-runtime files with no matching repo source; refusing to prune them (move them aside manually if expected):\n${unverified.join("\n")}`,
    );
  }

  const removeEmptyDirectories = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) removeEmptyDirectories(path.resolve(directory, entry.name));
    }
    if (directory !== standaloneBase && readdirSync(directory).length === 0) rmdirSync(directory);
  };
  removeEmptyDirectories(standaloneBase);
  console.log(
    `  standalone repaired: +${runtimeDependencyPaths.length} runtime dependency trees, -${pruned} traced non-runtime files`,
  );
}

/** Verify the standalone tree is complete, self-contained, and minimal. */
export function assertStandalone() {
  const candidates = [
    path.resolve(standaloneBase, "frontend", "server.js"),
    path.resolve(standaloneBase, "server.js"),
  ];
  const runtimeRoots = [path.resolve(standaloneBase, "frontend"), standaloneBase];
  const requiredRuntimeFiles = [
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/value/shared/union_priority_sort.mjs",
  ];

  if (!candidates.some((candidate) => existsSync(candidate))) {
    throw Error(`Missing standalone server: ${candidates.join(", ")}`);
  }
  for (const file of requiredRuntimeFiles) {
    if (!runtimeRoots.some((root) => existsSync(path.resolve(root, file)))) {
      throw Error(`Missing standalone runtime dependency: ${file}`);
    }
  }

  const runtimeRoot = runtimeRoots.find((root) => existsSync(path.resolve(root, "server.js")));
  const unsafeRuntimeLinks = runtimeRoot
    ? symlinksUnder(runtimeRoot).filter((link) => {
        if (path.isAbsolute(readlinkSync(link)) || !existsSync(link)) return true;
        const resolvedLink = path.relative(runtimeRoot, realpathSync(link));
        return (
          resolvedLink === ".." ||
          resolvedLink.startsWith(`..${path.sep}`) ||
          path.isAbsolute(resolvedLink)
        );
      })
    : [];
  if (unsafeRuntimeLinks.length > 0) {
    throw Error(`Unsafe standalone runtime links: ${unsafeRuntimeLinks.join(", ")}`);
  }

  const tracedPackageDirectory = runtimeRoot
    ? path.resolve(runtimeRoot, ".next/node_modules/@earendil-works")
    : undefined;
  const danglingTracedPackages =
    tracedPackageDirectory && existsSync(tracedPackageDirectory)
      ? readdirSync(tracedPackageDirectory)
          .map((entry) => path.resolve(tracedPackageDirectory, entry))
          .filter((entry) => lstatSync(entry).isSymbolicLink() && !existsSync(entry))
      : [];
  if (danglingTracedPackages.length > 0) {
    throw Error(`Dangling traced runtime packages: ${danglingTracedPackages.join(", ")}`);
  }

  const piCodingAgentRoot = runtimeRoot
    ? path.resolve(runtimeRoot, "node_modules/@earendil-works/pi-coding-agent")
    : null;
  const piAiRoot = piCodingAgentRoot
    ? path.resolve(piCodingAgentRoot, "node_modules/@earendil-works/pi-ai")
    : null;
  const piRuntimeEntries =
    piCodingAgentRoot && piAiRoot
      ? [path.resolve(piCodingAgentRoot, "dist/index.js"), path.resolve(piAiRoot, "dist/index.js")]
      : [];
  if (piRuntimeEntries.length !== 2 || piRuntimeEntries.some((entry) => !existsSync(entry))) {
    throw Error("Missing packaged Pi runtime entrypoints");
  }
  for (const entry of piRuntimeEntries) {
    const importCheck = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `import(${JSON.stringify(pathToFileURL(entry).href)})`],
      { cwd: runtimeRoot, encoding: "utf8" },
    );
    if (importCheck.status !== 0) {
      throw Error(
        `Standalone Pi runtime entrypoint is not importable: ${importCheck.stderr || importCheck.stdout}`,
      );
    }
  }

  // Locate each dependency's package directory the way Node's resolver walks
  // node_modules, without resolving an entry point: require.resolve() fails on
  // ESM-only packages (pi-telemetry ships exports with no CJS condition) even
  // when the package sits exactly where it belongs. The escape check only
  // needs the directory.
  const piAiManifestPath = path.resolve(realpathSync(piAiRoot), "package.json");
  const piAiManifest = JSON.parse(readFileSync(piAiManifestPath, "utf8"));
  createRequire(piAiManifestPath);
  for (const dependency of Object.keys(piAiManifest.dependencies ?? {})) {
    let searchRoot = realpathSync(piAiRoot);
    let packageDirectory = null;
    while (searchRoot) {
      const candidate = path.resolve(searchRoot, "node_modules", dependency);
      if (existsSync(path.resolve(candidate, "package.json"))) {
        packageDirectory = candidate;
        break;
      }
      const parent = path.resolve(searchRoot, "..");
      if (parent === searchRoot) break;
      searchRoot = parent;
    }
    if (!packageDirectory) {
      throw Error(`Pi AI dependency missing from standalone runtime: ${dependency}`);
    }
    const resolvedDependency = realpathSync(packageDirectory);
    const runtimeRelativePath = path.relative(runtimeRoot, resolvedDependency);
    if (
      runtimeRelativePath === ".." ||
      runtimeRelativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(runtimeRelativePath)
    ) {
      throw Error(`Pi AI dependency escaped standalone runtime: ${dependency}`);
    }
  }

  const unexpected = filesUnder(standaloneBase).filter((file) => !isRuntimeFile(file));
  if (unexpected.length > 0) {
    throw Error(
      `Standalone build contains non-runtime files:\n${unexpected
        .map((file) => path.relative(standaloneBase, file))
        .join("\n")}`,
    );
  }
  console.log("  standalone server build is minimal");
}

function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

/**
 * electron-builder afterPack hook: refuse to ship a bundle that is missing any
 * runtime piece, because electron-builder can log "file source doesn't exist"
 * for extraResources and still exit 0.
 */
export async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const productFilename = packager.appInfo.productFilename;
  const resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName);
  const packagedStandaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone");
  const candidates = [
    path.join(packagedStandaloneBase, "frontend", "server.js"),
    path.join(packagedStandaloneBase, "server.js"),
  ];
  const standaloneServer = candidates.find((candidate) => existsSync(candidate));

  const appArchive = path.join(resourcesDir, "app.asar");
  const appArchiveBytes = statSync(appArchive).size;
  if (appArchiveBytes > 5 * 1024 * 1024) {
    throw Error(`Packaged app.asar is unexpectedly large: ${appArchiveBytes} bytes`);
  }
  if (!standaloneServer) {
    throw Error(
      [
        "Packaged app is missing the embedded Next standalone server — refusing to sign/ship a broken bundle.",
        `Looked for: ${candidates.join(" or ")}`,
        `electron-builder failed to copy extraResources from .next/standalone (it can log "file source doesn't exist" yet still exit 0).`,
        "Re-run the build (run `npm run build` first if .next/standalone is absent).",
      ].join("\n  "),
    );
  }

  const packagedRoot = path.dirname(standaloneServer);
  const missingRuntimeFile = [
    path.join(packagedRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js"),
    path.join(
      packagedRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "package.json",
    ),
    path.join(
      packagedRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "dist",
      "providers",
      "data",
      "amazon-bedrock.json",
    ),
  ].find((file) => !existsSync(file));
  if (missingRuntimeFile) {
    throw Error(`Packaged app is missing a Pi runtime dependency: ${missingRuntimeFile}`);
  }

  const agentRuntimeRoot = path.join(resourcesDir, "app", "agent-runtime");
  const agentRuntime = path.join(agentRuntimeRoot, "standalone.mjs");
  const missingAgentRuntimeFile = [
    agentRuntime,
    path.join(agentRuntimeRoot, "node_modules", "playwright-core", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "chromium-bidi", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "chromium-bidi", "node_modules", "zod", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "mitt", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "devtools-protocol", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "@silvia-odwyer", "photon-node", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "undici", "package.json"),
  ].find((file) => !existsSync(file));
  if (missingAgentRuntimeFile) {
    throw Error(`Packaged app is missing an agent runtime dependency: ${missingAgentRuntimeFile}`);
  }

  const desktopRuntimeRoot = path.join(resourcesDir, "desktop-runtime", "node_modules", "@lydell");
  const missingDesktopRuntimeFile = [
    path.join(desktopRuntimeRoot, "node-pty", "package.json"),
    path.join(desktopRuntimeRoot, `node-pty-${process.platform}-${process.arch}`, "package.json"),
  ].find((file) => !existsSync(file));
  if (missingDesktopRuntimeFile) {
    throw Error(`Packaged app is missing a desktop runtime dependency: ${missingDesktopRuntimeFile}`);
  }

  const unwantedRuntimeFile = [packagedStandaloneBase, agentRuntimeRoot].flatMap((directory) =>
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:map|[cm]?ts)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name)),
  )[0];
  if (unwantedRuntimeFile) {
    throw Error(`Packaged app contains a non-runtime source artifact: ${unwantedRuntimeFile}`);
  }

  const agentRuntimeSource = readFileSync(agentRuntime, "utf8");
  if (/["'](?:[A-Za-z]:\\|\/(?:Users|home|root)\/)[^"'\n]*node_modules[\\/]/.test(agentRuntimeSource)) {
    throw Error("Packaged agent runtime contains a build-machine dependency path");
  }

  if (electronPlatformName === "darwin") {
    const helperExecutable = path.join(
      path.dirname(resourcesDir),
      "Frameworks",
      `${productFilename} Helper.app`,
      "Contents",
      "MacOS",
      `${productFilename} Helper`,
    );
    if (!existsSync(helperExecutable)) {
      throw Error(`Packaged app is missing its Pi helper executable: ${helperExecutable}`);
    }
  }

  const packagedPiCli = path.join(
    resourcesDir,
    "app",
    "frontend",
    ".next",
    "standalone",
    "frontend",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  if (!existsSync(packagedPiCli)) {
    throw Error(`Packaged app is missing its Pi CLI: ${packagedPiCli}`);
  }
  console.log(
    `  afterPack: embedded frontend and agent runtime present, app.asar ${appArchiveBytes} bytes (${electronPlatformName})`,
  );
}
