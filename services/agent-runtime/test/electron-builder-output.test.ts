import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ELECTRON_BUILDER_OUTPUT_PREFIX,
  runElectronBuilder,
  workspaceHasProvenance,
} from "../../../frontend/scripts/electron-builder.mjs";

const roots: string[] = [];
const outputArgument = "--config.directories.output=";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-builder-test-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const frontendRoot = path.join(workspaceRoot, "frontend");
  const tempRoot = path.join(root, "temporary");
  await Promise.all([
    mkdir(frontendRoot, { recursive: true }),
    mkdir(tempRoot, { recursive: true }),
  ]);
  return { frontendRoot, tempRoot: await realpath(tempRoot), workspaceRoot };
}

function isolatedOutput(args: string[]) {
  const argument = args.find((value) => value.startsWith(outputArgument));
  if (!argument) throw new Error("Missing isolated output argument");
  return argument.slice(outputArgument.length);
}

describe("electron builder output isolation", () => {
  test("keeps the desktop output link ignored", () => {
    const repository = fileURLToPath(new URL("../../../", import.meta.url));
    const result = spawnSync("git", ["check-ignore", "-q", "frontend/dist-desktop"], {
      cwd: repository,
    });
    expect(result.status).toBe(0);
  });

  test("checks the frontend and workspace for prohibited provenance", async () => {
    const inspected: string[] = [];
    await expect(
      workspaceHasProvenance(["frontend", "workspace"], async (entry) => {
        inspected.push(entry);
        return entry === "workspace";
      }),
    ).resolves.toBe(true);
    expect(inspected).toEqual(["frontend", "workspace"]);
  });

  test("forwards arguments and links an owned isolated output for tagged Darwin workspaces", async () => {
    const current = await fixture();
    const invocations: string[][] = [];
    const args = ["--dir", "--config", "desktop/electron-builder.yml"];
    await runElectronBuilder(args, {
      ...current,
      platform: "darwin",
      inspectProvenance: async () => true,
      invoke: async (forwarded) => {
        invocations.push([...forwarded]);
        await chmod(isolatedOutput(forwarded), 0o755);
      },
    });
    const link = path.join(current.frontendRoot, "dist-desktop");
    const output = await readlink(link);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(path.dirname(output)).toBe(current.tempRoot);
    expect(path.basename(output).startsWith(ELECTRON_BUILDER_OUTPUT_PREFIX)).toBe(true);
    expect((await lstat(output)).mode & 0o777).toBe(0o700);
    expect(invocations).toEqual([[...args, `--config.directories.output=${output}`]]);
  });

  test("uses normal output on non-Darwin platforms", async () => {
    const current = await fixture();
    const invocations: string[][] = [];
    const args = ["--config", "desktop/electron-builder.yml"];
    await runElectronBuilder(args, {
      ...current,
      ownerId: undefined,
      platform: "linux",
      inspectProvenance: async () => {
        throw new Error("unexpected provenance query");
      },
      invoke: async (forwarded) => invocations.push([...forwarded]),
    });
    expect(invocations).toEqual([args]);
    await expect(lstat(path.join(current.frontendRoot, "dist-desktop"))).rejects.toThrow();
  });

  test("uses normal output for untagged Darwin release workspaces", async () => {
    const current = await fixture();
    const invocations: string[][] = [];
    const args = ["--config", "desktop/electron-builder.yml", "--config.mac.notarize=true"];
    const output = path.join(current.frontendRoot, "dist-desktop");
    const marker = path.join(output, "preserved");
    await mkdir(output);
    await writeFile(marker, "preserved");
    await runElectronBuilder(args, {
      ...current,
      platform: "darwin",
      inspectProvenance: async () => false,
      invoke: async (forwarded) => invocations.push([...forwarded]),
    });
    expect(invocations).toEqual([args]);
    expect(await Bun.file(marker).text()).toBe("preserved");
  });

  test("cleans only a prior owned output before replacing its link", async () => {
    const current = await fixture();
    const previous = path.join(current.tempRoot, `${ELECTRON_BUILDER_OUTPUT_PREFIX}ABC123`);
    const link = path.join(current.frontendRoot, "dist-desktop");
    await mkdir(previous, { mode: 0o700 });
    await chmod(previous, 0o700);
    await symlink(previous, link, "dir");
    await runElectronBuilder([], {
      ...current,
      platform: "darwin",
      inspectProvenance: async () => true,
      invoke: async () => undefined,
    });
    const replacement = await readlink(link);
    expect(replacement).not.toBe(previous);
    await expect(lstat(previous)).rejects.toThrow();
    expect((await lstat(replacement)).isDirectory()).toBe(true);
  });

  test("replaces the exact ignored output directory without following links", async () => {
    const current = await fixture();
    const output = path.join(current.frontendRoot, "dist-desktop");
    await mkdir(output);
    await writeFile(path.join(output, "stale"), "stale");
    await runElectronBuilder([], {
      ...current,
      platform: "darwin",
      inspectProvenance: async () => true,
      invoke: async () => undefined,
    });
    expect((await lstat(output)).isSymbolicLink()).toBe(true);
  });

  test("refuses hostile output links without deleting their targets", async () => {
    const current = await fixture();
    const hostile = path.join(current.tempRoot, "hostile");
    const marker = path.join(hostile, "marker");
    await mkdir(hostile, { mode: 0o700 });
    await writeFile(marker, "preserved");
    await symlink(hostile, path.join(current.frontendRoot, "dist-desktop"), "dir");
    await expect(
      runElectronBuilder([], {
        ...current,
        platform: "darwin",
        inspectProvenance: async () => true,
        invoke: async () => undefined,
      }),
    ).rejects.toThrow("Desktop output link is unsafe");
    expect(await Bun.file(marker).text()).toBe("preserved");
  });

  test("preserves the isolated output when the builder fails", async () => {
    const current = await fixture();
    await expect(
      runElectronBuilder([], {
        ...current,
        platform: "darwin",
        inspectProvenance: async () => true,
        invoke: async (forwarded) => {
          await chmod(isolatedOutput(forwarded), 0o755);
          throw new Error("builder failed");
        },
      }),
    ).rejects.toThrow("builder failed");
    const output = await readlink(path.join(current.frontendRoot, "dist-desktop"));
    expect((await lstat(output)).isDirectory()).toBe(true);
    expect((await lstat(output)).mode & 0o777).toBe(0o700);
  });

  test("fails closed when provenance inspection fails", async () => {
    const current = await fixture();
    let invoked = false;
    await expect(
      runElectronBuilder([], {
        ...current,
        platform: "darwin",
        inspectProvenance: async () => {
          throw new Error("xattr unavailable");
        },
        invoke: async () => {
          invoked = true;
        },
      }),
    ).rejects.toThrow("xattr unavailable");
    expect(invoked).toBe(false);
  });
});
