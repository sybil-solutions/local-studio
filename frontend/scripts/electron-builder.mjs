import { spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, readlink, realpath, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

export const ELECTRON_BUILDER_OUTPUT_PREFIX = "local-studio-electron-builder-";
const PROVENANCE_ATTRIBUTE = "com.apple.provenance";
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.dirname(frontendRoot);
const electronBuilderCli = fileURLToPath(import.meta.resolve("electron-builder/cli.js"));

function operationEffect(operation) {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => (error instanceof Error ? error : new Error("Electron Builder failed")),
  });
}

function provenanceInspection(entry) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/xattr", ["-p", PROVENANCE_ATTRIBUTE, entry], {
      env: { LANG: "C", LC_ALL: "C" },
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr?.on("data", (chunk) => {
      errorOutput = `${errorOutput}${chunk.toString("utf8")}`.slice(-4096);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) reject(new Error("Desktop provenance inspection failed"));
      else if (code === 0) resolve(true);
      else if (code === 1 && errorOutput.includes("No such xattr")) resolve(false);
      else reject(new Error("Desktop provenance inspection failed"));
    });
  });
}

export async function workspaceHasProvenance(entries, inspect = provenanceInspection) {
  return (await Promise.all(entries.map(inspect))).some(Boolean);
}

function outputFailure() {
  return new Error("Desktop output link is unsafe");
}

function missing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function ownedOutputName(target) {
  const name = path.basename(target);
  const suffix = name.slice(ELECTRON_BUILDER_OUTPUT_PREFIX.length);
  return name.startsWith(ELECTRON_BUILDER_OUTPUT_PREFIX) && /^[A-Za-z0-9]{6}$/.test(suffix);
}

async function existingOutput(link) {
  try {
    return await lstat(link);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function removeOwnedLinkedOutput(link, temporaryRoot, ownerId) {
  const target = await readlink(link);
  if (
    !path.isAbsolute(target) ||
    path.dirname(target) !== temporaryRoot ||
    !ownedOutputName(target)
  ) {
    throw outputFailure();
  }
  let stat;
  try {
    stat = await lstat(target);
  } catch {
    throw outputFailure();
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== ownerId ||
    (stat.mode & 0o777) !== 0o700 ||
    (await realpath(target)) !== target
  ) {
    throw outputFailure();
  }
  await rm(target, { recursive: true, force: false });
  await unlink(link);
}

async function clearDesktopOutput(frontend, temporaryRoot, ownerId) {
  const link = path.join(frontend, "dist-desktop");
  const stat = await existingOutput(link);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    await removeOwnedLinkedOutput(link, temporaryRoot, ownerId);
    return;
  }
  if (!stat.isDirectory()) throw outputFailure();
  await rm(link, { recursive: true, force: false });
}

async function isolatedDesktopOutput(frontend, workspace, temporaryRoot, ownerId) {
  const canonicalWorkspace = await realpath(workspace);
  if (contained(canonicalWorkspace, temporaryRoot)) throw outputFailure();
  const link = path.join(frontend, "dist-desktop");
  const output = await mkdtemp(path.join(temporaryRoot, ELECTRON_BUILDER_OUTPUT_PREFIX));
  try {
    await chmod(output, 0o700);
    const stat = await lstat(output);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== ownerId ||
      (stat.mode & 0o777) !== 0o700 ||
      (await realpath(output)) !== output
    ) {
      throw outputFailure();
    }
    await symlink(output, link, "dir");
    return output;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

function invokeElectronBuilder(args, frontend) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [electronBuilderCli, ...args], {
      cwd: frontend,
      env: process.env,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && !signal) resolve();
      else reject(new Error("Electron Builder failed"));
    });
  });
}

async function invokeWithPrivateOutput(invoke, args, output) {
  try {
    await invoke(args);
  } finally {
    if (output) await chmod(output, 0o700);
  }
}

export function electronBuilderEffect(args, options = {}) {
  const frontend = options.frontendRoot ?? frontendRoot;
  const workspace = options.workspaceRoot ?? workspaceRoot;
  const platform = options.platform ?? process.platform;
  const inspect = options.inspectProvenance ?? provenanceInspection;
  const invoke = options.invoke ?? ((forwarded) => invokeElectronBuilder(forwarded, frontend));
  const ownerId = "ownerId" in options ? options.ownerId : process.getuid?.();
  return Effect.gen(function* () {
    if (platform !== "darwin") {
      yield* operationEffect(() => invoke([...args]));
      return;
    }
    if (ownerId === undefined) return yield* Effect.fail(outputFailure());
    const temporaryRoot = yield* operationEffect(() => realpath(options.tempRoot ?? tmpdir()));
    const tagged = yield* operationEffect(() =>
      workspaceHasProvenance([frontend, workspace], inspect),
    );
    if (tagged) {
      yield* operationEffect(() => clearDesktopOutput(frontend, temporaryRoot, ownerId));
    }
    const output = tagged
      ? yield* operationEffect(() =>
          isolatedDesktopOutput(frontend, workspace, temporaryRoot, ownerId),
        )
      : null;
    const forwarded = output ? [...args, `--config.directories.output=${output}`] : [...args];
    yield* operationEffect(() => invokeWithPrivateOutput(invoke, forwarded, output));
  });
}

export function runElectronBuilder(args, options = {}) {
  return Effect.runPromise(electronBuilderEffect(args, options));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runElectronBuilder(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Electron Builder failed");
    process.exitCode = 1;
  }
}
