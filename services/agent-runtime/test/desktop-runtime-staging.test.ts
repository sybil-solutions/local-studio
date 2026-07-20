import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageDesktopRuntime } from "../../../frontend/scripts/stage-desktop-runtime.mjs";

const roots: string[] = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const frontendRoot = path.join(repositoryRoot, "frontend");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "local-studio-runtime-stage-")));
  roots.push(root);
  const stagingRoot = path.join(root, "staging");
  await mkdir(stagingRoot, { mode: 0o700 });
  await chmod(stagingRoot, 0o700);
  return { output: path.join(stagingRoot, "mac-arm64"), root, stagingRoot };
}

async function stage(output: string, dependencies = {}) {
  try {
    await stageDesktopRuntime(
      { electronPlatformName: "darwin", arch: 3 },
      { frontendRoot, output, ...dependencies },
    );
    return null;
  } catch (error) {
    return error;
  }
}

function expectUnsafe(error: unknown) {
  if (!(error instanceof Error)) throw new Error("Expected runtime staging to fail");
  expect(error.message).toContain("Desktop runtime staging path is unsafe");
}

describe("desktop runtime staging boundary", () => {
  test("rejects a symlinked staging parent without deleting external content", async () => {
    const { root } = await fixture();
    const external = path.join(root, "external");
    const marker = path.join(external, "mac-arm64", "valuable-user-file");
    const linkedParent = path.join(root, "linked-parent");
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, "preserved");
    await symlink(external, linkedParent, "dir");
    const error = await stage(path.join(linkedParent, "mac-arm64"));
    expect(await readFile(marker, "utf8")).toBe("preserved");
    expectUnsafe(error);
  });

  test("rejects a symlinked target without deleting external content", async () => {
    const { output, root } = await fixture();
    const external = path.join(root, "external");
    const marker = path.join(external, "valuable-user-file");
    await mkdir(external);
    await writeFile(marker, "preserved");
    await symlink(external, output, "dir");
    const error = await stage(output);
    expect(await readFile(marker, "utf8")).toBe("preserved");
    expectUnsafe(error);
  });

  test("ignores a hostile sibling symlink", async () => {
    const { output, root, stagingRoot } = await fixture();
    const external = path.join(root, "external");
    const marker = path.join(external, "valuable-user-file");
    const sibling = path.join(stagingRoot, "hostile-sibling");
    await mkdir(external);
    await writeFile(marker, "preserved");
    await symlink(external, sibling, "dir");
    await stageDesktopRuntime(
      { electronPlatformName: "darwin", arch: 3 },
      { frontendRoot, output },
    );
    expect(await readFile(marker, "utf8")).toBe("preserved");
    expect((await lstat(sibling)).isSymbolicLink()).toBe(true);
    expect(await readlink(sibling)).toBe(external);
  });

  test("rejects writable and foreign-owned staging roots", async () => {
    const writable = await fixture();
    await chmod(writable.stagingRoot, 0o777);
    expectUnsafe(await stage(writable.output));

    const foreign = await fixture();
    const ownerId = process.getuid?.();
    if (ownerId === undefined) throw new Error("Owner identity is unavailable");
    expectUnsafe(await stage(foreign.output, { ownerId: ownerId + 1 }));
  });

  test("fails closed when a verified target is replaced during promotion", async () => {
    const { output, root, stagingRoot } = await fixture();
    const external = path.join(root, "external");
    const marker = path.join(external, "valuable-user-file");
    await Promise.all([mkdir(output, { mode: 0o700 }), mkdir(external)]);
    await chmod(output, 0o700);
    await writeFile(marker, "preserved");
    let calls = 0;
    const racingRename = async (source: string, destination: string) => {
      calls += 1;
      if (calls === 1) {
        await rm(source, { recursive: true, force: false });
        await symlink(external, source, "dir");
      }
      await rename(source, destination);
    };
    const error = await stage(output, { rename: racingRename });
    expect(await readFile(marker, "utf8")).toBe("preserved");
    await expect(lstat(output)).rejects.toThrow();
    const [holder] = await readdir(stagingRoot);
    expect(holder).toStartWith(".local-studio-runtime-backup-");
    expect(await readlink(path.join(stagingRoot, holder, "previous"))).toBe(external);
    expectUnsafe(error);
  });

  test("restores an existing target when promotion fails", async () => {
    const { output, stagingRoot } = await fixture();
    const marker = path.join(output, "prior-runtime");
    await mkdir(output, { mode: 0o700 });
    await chmod(output, 0o700);
    await writeFile(marker, "preserved");
    let calls = 0;
    const failingRename = async (source: string, destination: string) => {
      calls += 1;
      if (calls === 2) throw new Error("promotion interrupted");
      await rename(source, destination);
    };
    const error = await stage(output, { rename: failingRename });
    if (!(error instanceof Error)) throw new Error("Expected runtime promotion to fail");
    expect(error.message).toBe("promotion interrupted");
    expect(await readFile(marker, "utf8")).toBe("preserved");
    expect((await lstat(output)).isDirectory()).toBe(true);
    expect(await readdir(stagingRoot)).toEqual(["mac-arm64"]);
  });

  test("restores an existing target when the promoted closure fails validation", async () => {
    const { output } = await fixture();
    const marker = path.join(output, "prior-runtime");
    await mkdir(output, { mode: 0o700 });
    await chmod(output, 0o700);
    await writeFile(marker, "preserved");
    let calls = 0;
    const mutatingRename = async (source: string, destination: string) => {
      calls += 1;
      await rename(source, destination);
      if (calls === 2) {
        const license = path.join(destination, "LICENSE.node");
        await chmod(license, 0o600);
        await writeFile(license, "changed closure");
      }
    };
    const error = await stage(output, { rename: mutatingRename });
    if (!(error instanceof Error)) throw new Error("Expected runtime promotion to fail");
    expect(error.message).toContain("Desktop runtime closure is invalid");
    expect(await readFile(marker, "utf8")).toBe("preserved");
    expect((await lstat(output)).isDirectory()).toBe(true);
  });

  test("atomically replaces a verified target and removes owned staging entries", async () => {
    const { output, stagingRoot } = await fixture();
    const marker = path.join(output, "prior-runtime");
    await mkdir(output, { mode: 0o700 });
    await chmod(output, 0o700);
    await writeFile(marker, "replaced");
    const manifest = await stageDesktopRuntime(
      { electronPlatformName: "darwin", arch: 3 },
      { frontendRoot, output },
    );
    expect(manifest.target.key).toBe("darwin-arm64");
    await expect(readFile(marker)).rejects.toThrow();
    expect(await readdir(stagingRoot)).toEqual(["mac-arm64"]);
  });
});
