import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { pluginArtifactDigest, pluginArtifactFileSystem } from "../src/plugin-artifact-digest";

const roots: string[] = [];

async function artifactRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-artifact-"));
  roots.push(root);
  return root;
}

const digest = (root: string) => Effect.runPromise(pluginArtifactDigest(root));

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("plugin artifact digest", () => {
  test("hashes empty and nested bundles independently of creation order", async () => {
    const empty = await artifactRoot();
    expect(await digest(empty)).toMatch(/^sha256:[a-f0-9]{64}$/);
    const first = await artifactRoot();
    const second = await artifactRoot();
    await mkdir(path.join(first, "nested"));
    await writeFile(path.join(first, "z.txt"), "z");
    await writeFile(path.join(first, "nested", "a.txt"), "a");
    await writeFile(path.join(second, "z.txt"), "z");
    await mkdir(path.join(second, "nested"));
    await writeFile(path.join(second, "nested", "a.txt"), "a");
    expect(await digest(first)).toBe(await digest(second));
  });

  test("is stable across mtime changes and changes with bytes, paths, and modes", async () => {
    const root = await artifactRoot();
    await writeFile(path.join(root, "entry.js"), "first");
    const initial = await digest(root);
    await utimes(path.join(root, "entry.js"), new Date(10), new Date(20));
    expect(await digest(root)).toBe(initial);
    await writeFile(path.join(root, "entry.js"), "second");
    const changedBytes = await digest(root);
    expect(changedBytes).not.toBe(initial);
    await rename(path.join(root, "entry.js"), path.join(root, "renamed.js"));
    const changedPath = await digest(root);
    expect(changedPath).not.toBe(changedBytes);
    await chmod(path.join(root, "renamed.js"), 0o755);
    expect(await digest(root)).not.toBe(changedPath);
  });

  test("accepts contained symlinks and rejects escape, dangling, and cyclic targets", async () => {
    const contained = await artifactRoot();
    await writeFile(path.join(contained, "target.js"), "target");
    await symlink("target.js", path.join(contained, "link.js"));
    expect(await digest(contained)).toMatch(/^sha256:[a-f0-9]{64}$/);

    const escaped = await artifactRoot();
    const outside = path.join(path.dirname(escaped), `${path.basename(escaped)}-outside`);
    roots.push(outside);
    await writeFile(outside, "outside");
    await symlink(outside, path.join(escaped, "escape"));
    await expect(digest(escaped)).rejects.toThrow("Plugin symlink escapes its artifact at escape");

    const dangling = await artifactRoot();
    await symlink("missing", path.join(dangling, "dangling"));
    await expect(digest(dangling)).rejects.toThrow("Plugin symlink is invalid at dangling");

    const cyclic = await artifactRoot();
    await symlink("b", path.join(cyclic, "a"));
    await symlink("a", path.join(cyclic, "b"));
    await expect(digest(cyclic)).rejects.toThrow("Plugin symlink is invalid at a");
  });

  test("rejects bounded walks without exposing file contents or absolute paths", async () => {
    const root = await artifactRoot();
    await writeFile(path.join(root, "secret.txt"), "credential-value-never-report");
    await expect(
      Effect.runPromise(pluginArtifactDigest(root, { maxFileBytes: BigInt(4) })),
    ).rejects.toThrow("Plugin file exceeds its size limit at secret.txt");
    try {
      await Effect.runPromise(pluginArtifactDigest(root, { maxFileBytes: BigInt(4) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(root);
      expect(message).not.toContain("credential-value-never-report");
    }
  });

  test("detects a path replacement while a regular file is open", async () => {
    const root = await artifactRoot();
    const entry = path.join(root, "entry.js");
    const replacement = `${root}-replacement`;
    roots.push(replacement);
    await writeFile(entry, "approved");
    await writeFile(replacement, "mutated");
    let replaced = false;
    const fileSystem = {
      ...pluginArtifactFileSystem,
      open: async (file: string, flags: number) => {
        const handle = await pluginArtifactFileSystem.open(file, flags);
        if (path.basename(file) === "entry.js" && !replaced) {
          replaced = true;
          await rename(replacement, entry);
        }
        return handle;
      },
    };
    await expect(Effect.runPromise(pluginArtifactDigest(root, {}, fileSystem))).rejects.toThrow(
      "Plugin artifact changed while hashing at entry.js",
    );
  });

  test.skipIf(process.platform === "win32")("rejects special filesystem entries", async () => {
    const root = await artifactRoot();
    const special = path.join(root, "runtime.pipe");
    const child = Bun.spawn(["mkfifo", special]);
    expect(await child.exited).toBe(0);
    await expect(digest(root)).rejects.toThrow(
      "Plugin artifact contains an unsupported entry at runtime.pipe",
    );
  });
});
